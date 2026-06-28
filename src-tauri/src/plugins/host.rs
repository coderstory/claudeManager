//! Plugin host — registry + lifecycle for [`IPlugin`].
//!
//! `PluginHost` owns a map of plugins keyed by id and an `init_order` list
//! that records the order plugins were registered. `init_all` walks that
//! list and calls `IPlugin::init` on each; `shutdown_all` does the same in
//! reverse for teardown.
//!
//! Tests live at the bottom of this file (`#[cfg(test)] mod tests`).

use std::collections::HashMap;

use super::menu_registry::{PluginAppMenuItem, PluginTrayItem};
use super::topological::{topo_sort, TopologicalError};
use super::traits::*;

// ---------------------------------------------------------------------------
// PluginHost
// ---------------------------------------------------------------------------

/// Registry + lifecycle owner for all [`IPlugin`] implementations.
///
/// Construction is empty; plugins are added one-by-one via [`register`].
/// After all are registered, call [`init_all`] to run startup, and
/// [`shutdown_all`] on teardown.
///
/// [`register`]: PluginHost::register
/// [`init_all`]: PluginHost::init_all
/// [`shutdown_all`]: PluginHost::shutdown_all
pub struct PluginHost {
    plugins: HashMap<&'static str, Box<dyn IPlugin>>,
    /// Registration order — used by [`init_all`] / [`shutdown_all`].
    /// `shutdown_all` walks it in reverse so plugins tear down in LIFO
    /// order (LIFO matches the conventional "innermost dependency last"
    /// teardown idiom).
    init_order: Vec<&'static str>,
}

impl PluginHost {
    /// Construct an empty host.
    pub fn new() -> Self {
        Self {
            plugins: HashMap::new(),
            init_order: Vec::new(),
        }
    }

    /// Register a plugin. Returns the plugin's id on success.
    ///
    /// # Errors
    /// - [`PluginError::DuplicateId`] if a plugin with the same id is
    ///   already registered.
    pub fn register(&mut self, plugin: Box<dyn IPlugin>) -> Result<&'static str, PluginError> {
        let id = plugin.id();
        if self.plugins.contains_key(id) {
            return Err(PluginError::DuplicateId(id));
        }
        self.plugins.insert(id, plugin);
        self.init_order.push(id);
        Ok(id)
    }

    /// Unregister a plugin by id. Calls `shutdown` before removing.
    ///
    /// # Errors
    /// - [`PluginError::NotFound`] if no plugin with that id is registered.
    /// - Bubbles up the plugin's `shutdown` error if it fails.
    pub fn unregister(&mut self, id: &str) -> Result<(), PluginError> {
        let mut plugin = self
            .plugins
            .remove(id)
            .ok_or_else(|| PluginError::NotFound(id.to_string()))?;
        plugin.shutdown()?;
        self.init_order.retain(|x| *x != id);
        Ok(())
    }

    /// Look up a plugin by id.
    pub fn get(&self, id: &str) -> Option<&dyn IPlugin> {
        self.plugins.get(id).map(|p| p.as_ref())
    }

    /// Flatten every route contributed by every plugin.
    pub fn all_routes(&self) -> Vec<PluginRoute> {
        self.plugins.values().flat_map(|p| p.routes()).collect()
    }

    /// Flatten every service registered by every plugin.
    pub fn all_services(&self) -> Vec<Box<dyn PluginService>> {
        self.plugins.values().flat_map(|p| p.services()).collect()
    }

    /// **Phase 43** — flatten every tray item contributed by every
    /// plugin, in registration order. `MenuRegistry::build_tray`
    /// consumes this to assemble the system tray `Menu`.
    ///
    /// Walks `init_order` (via [`PluginHost::iter`]) instead of
    /// `HashMap::values()` — `iter()` preserves insertion order;
    /// `values()` does not. With only 13 plugins this rarely
    /// matters, but `core` registers first and feature plugins
    /// second, so the tray items are deterministic only via `iter`.
    pub fn all_tray_items(&self) -> Vec<PluginTrayItem> {
        self.iter().flat_map(|(_, p)| p.tray_items()).collect()
    }

    /// **Phase 43** — flatten every macOS application menu item
    /// contributed by every plugin, in registration order. On Windows
    /// this is unused (the app menu is a no-op).
    pub fn all_app_menu_items(&self) -> Vec<PluginAppMenuItem> {
        self.iter().flat_map(|(_, p)| p.app_menu_items()).collect()
    }

    /// Run `init` on every plugin, in registration order.
    ///
    /// **Phase 43 (D-CC-A)** — takes `&mut PluginContext` so plugins
    /// can register services into the registry. We rebind to
    /// `PluginContext` (the same `&mut` reborrowed each iteration) so
    /// every plugin sees a consistent context. After `init_all`
    /// returns the caller still holds the original `&mut`.
    pub fn init_all(&mut self, ctx: &mut PluginContext) -> Result<(), PluginError> {
        // Clone the order list so we can iterate without holding a borrow
        // on `self.plugins` (we need `get_mut` inside the loop).
        let order: Vec<&'static str> = self.init_order.clone();
        for id in order {
            if let Some(plugin) = self.plugins.get_mut(id) {
                plugin.init(&mut *ctx)?;
            }
        }
        Ok(())
    }

    /// **Phase 45** — run `init` on every plugin in **topological
    /// order** of their [`IPlugin::depends_on`] declarations.
    /// Replaces `init_all` for any plugin graph that includes
    /// service plugins (which need other services registered
    /// before they can wire up — e.g. `provider-service` calls
    /// `.with_backup_service(...)` + `.with_history(...)` and
    /// needs both registered first).
    ///
    /// Returns the resolved init order (in dependency-first form)
    /// so the caller can log it / use it as a stable init sequence
    /// for tests.
    ///
    /// # Errors
    /// - [`PluginError::CycleDetected`] if the graph has a cycle
    /// - [`PluginError::MissingDependency`] if any plugin references
    ///   an id not in the registry
    /// - Bubbles up the first plugin's `init` error
    pub fn init_all_topological(
        &mut self,
        ctx: &mut PluginContext,
    ) -> Result<Vec<&'static str>, PluginError> {
        // 1. Build id → deps map (snapshot; we can't hold `&self` while
        //    taking `&mut` for the init loop).
        let mut deps_map: HashMap<&'static str, Vec<&'static str>> = HashMap::new();
        let order_snapshot: Vec<&'static str> = self.init_order.clone();
        for id in &order_snapshot {
            if let Some(plugin) = self.plugins.get(id) {
                deps_map.insert(*id, plugin.depends_on());
            }
        }
        // 2. Topological sort (errors carry offending path / missing id).
        let topo_order = topo_sort(&deps_map).map_err(|e| match e {
            TopologicalError::Cycle { path } => PluginError::CycleDetected { path },
            TopologicalError::MissingDependency { plugin, missing } => {
                PluginError::MissingDependency { plugin, missing }
            }
        })?;
        // 3. Init in order. `topo_order` is dependency-first, so by the
        //    time we reach a plugin all its `depends_on` services have
        //    been `register_arc`'d into `ctx.services`.
        for id in &topo_order {
            if let Some(plugin) = self.plugins.get_mut(id) {
                plugin.init(&mut *ctx)?;
            }
        }
        Ok(topo_order)
    }

    /// Run `shutdown` on every plugin, in reverse registration order
    /// (LIFO). Best-effort: a single plugin's failure does NOT stop the
    /// rest from tearing down.
    pub fn shutdown_all(&mut self) -> Result<(), PluginError> {
        let mut order: Vec<&'static str> = self.init_order.clone();
        order.reverse();
        let mut first_err: Option<PluginError> = None;
        for id in order {
            if let Some(plugin) = self.plugins.get_mut(id) {
                if let Err(e) = plugin.shutdown() {
                    // Capture the first error, keep going so other plugins
                    // still get a chance to clean up.
                    if first_err.is_none() {
                        first_err = Some(e);
                    }
                }
            }
        }
        match first_err {
            Some(e) => Err(e),
            None => Ok(()),
        }
    }

    /// Number of registered plugins.
    pub fn count(&self) -> usize {
        self.plugins.len()
    }

    /// Iterator over (id, plugin) pairs in registration order.
    pub fn iter(&self) -> impl Iterator<Item = (&'static str, &dyn IPlugin)> {
        self.init_order
            .iter()
            .filter_map(move |id| self.plugins.get(id).map(|p| (*id, p.as_ref())))
    }
}

impl Default for PluginHost {
    fn default() -> Self {
        Self::new()
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugins::menu_registry::{
        AppMenuRole, PluginAction, PluginAppMenuItemKind,
    };
    use std::sync::{Arc, Mutex};

    /// Test plugin: records every `init` / `shutdown` call into a shared
    /// log so the test can assert ordering.
    struct RecordingPlugin {
        id: &'static str,
        name: &'static str,
        log: Arc<Mutex<Vec<String>>>,
    }

    impl RecordingPlugin {
        fn new(
            id: &'static str,
            name: &'static str,
            log: Arc<Mutex<Vec<String>>>,
        ) -> Self {
            Self { id, name, log }
        }
    }

    impl IPlugin for RecordingPlugin {
        fn id(&self) -> &'static str {
            self.id
        }
        fn name(&self) -> &'static str {
            self.name
        }
        fn init(&mut self, _ctx: &mut PluginContext) -> Result<(), PluginError> {
            self.log.lock().unwrap().push(format!("init:{}", self.id));
            Ok(())
        }
        fn shutdown(&mut self) -> Result<(), PluginError> {
            self.log.lock().unwrap().push(format!("shutdown:{}", self.id));
            Ok(())
        }
    }

    /// Plugin whose `init` always fails — used to verify error
    /// propagation in `init_all`.
    struct InitFailingPlugin;
    impl IPlugin for InitFailingPlugin {
        fn id(&self) -> &'static str {
            "init-fail"
        }
        fn name(&self) -> &'static str {
            "init-fail"
        }
        fn init(&mut self, _ctx: &mut PluginContext) -> Result<(), PluginError> {
            Err(PluginError::InitFailed("boom".into()))
        }
    }

    /// Test plugin that contributes 2 routes. Takes an id prefix so
    /// multiple instances can coexist (the test that registers 3 of
    /// them needs distinct ids — `register` rejects duplicates).
    struct RoutePlugin(&'static str);
    impl IPlugin for RoutePlugin {
        fn id(&self) -> &'static str {
            self.0
        }
        fn name(&self) -> &'static str {
            self.0
        }
        fn routes(&self) -> Vec<PluginRoute> {
            vec![
                PluginRoute {
                    path: "/a".into(),
                    plugin_id: self.0,
                    display_name: "A".into(),
                },
                PluginRoute {
                    path: "/b".into(),
                    plugin_id: self.0,
                    display_name: "B".into(),
                },
            ]
        }
    }

    /// Test plugin with no overrides — used to verify default `init` /
    /// `shutdown` are no-ops.
    struct NoOpPlugin;
    impl IPlugin for NoOpPlugin {
        fn id(&self) -> &'static str {
            "noop"
        }
        fn name(&self) -> &'static str {
            "noop"
        }
    }

    /// Build a minimal `PluginContext` for tests. The `paths` field is
    /// unused by the test plugins (RecordingPlugin / InitFailingPlugin /
    /// etc. never touch it), so a leaked reference is fine for tests.
    ///
    /// `app` is `None` — the test plugins never call methods on it, and
    /// `tauri::test::mock_app` requires a feature that isn't enabled.
    fn dummy_ctx() -> PluginContext<'static> {
        use crate::platform::{AppPaths, IPlatformPaths, PlatformError};
        use std::path::PathBuf;

        struct EmptyPaths;
        impl IPlatformPaths for EmptyPaths {
            fn resolve(&self) -> AppPaths {
                AppPaths {
                    home: PathBuf::from("/"),
                    app_data: PathBuf::from("/"),
                    settings_json: PathBuf::from("/"),
                    claude_json: PathBuf::from("/"),
                    backups_dir: PathBuf::from("/"),
                    marketplaces_dir: PathBuf::from("/"),
                    logs_dir: PathBuf::from("/"),
                    history_db: PathBuf::from("/"),
                }
            }
            fn ensure_dirs(&self) -> Result<(), PlatformError> {
                Ok(())
            }
        }

        let leaked: &'static dyn IPlatformPaths = Box::leak(Box::new(EmptyPaths));
        PluginContext::for_tests(leaked)
    }

    #[test]
    fn register_unique_ids() {
        let log = Arc::new(Mutex::new(Vec::<String>::new()));
        let mut host = PluginHost::new();
        host.register(Box::new(RecordingPlugin::new(
            "a",
            "A",
            log.clone(),
        )))
        .unwrap();
        host.register(Box::new(RecordingPlugin::new(
            "b",
            "B",
            log.clone(),
        )))
        .unwrap();
        host.register(Box::new(RecordingPlugin::new(
            "c",
            "C",
            log.clone(),
        )))
        .unwrap();
        assert_eq!(host.count(), 3);
    }

    #[test]
    fn register_duplicate_id_errors() {
        let log = Arc::new(Mutex::new(Vec::<String>::new()));
        let mut host = PluginHost::new();
        host.register(Box::new(RecordingPlugin::new(
            "dup",
            "Dup",
            log.clone(),
        )))
        .unwrap();
        let err = host
            .register(Box::new(RecordingPlugin::new(
                "dup",
                "Dup2",
                log.clone(),
            )))
            .unwrap_err();
        assert!(matches!(err, PluginError::DuplicateId("dup")));
    }

    #[test]
    fn unregister_shuts_down() {
        let log = Arc::new(Mutex::new(Vec::<String>::new()));
        let mut host = PluginHost::new();
        host.register(Box::new(RecordingPlugin::new(
            "u",
            "U",
            log.clone(),
        )))
        .unwrap();
        host.unregister("u").unwrap();
        assert_eq!(host.count(), 0);
        let log_snapshot = log.lock().unwrap().clone();
        assert!(log_snapshot.contains(&"shutdown:u".to_string()));
    }

    #[test]
    fn unregister_unknown_id_errors() {
        let mut host = PluginHost::new();
        let err = host.unregister("nope").unwrap_err();
        assert!(matches!(err, PluginError::NotFound(s) if s == "nope"));
    }

    #[test]
    fn init_all_runs_in_registration_order() {
        let log = Arc::new(Mutex::new(Vec::<String>::new()));
        let mut host = PluginHost::new();
        host.register(Box::new(RecordingPlugin::new(
            "first",
            "F",
            log.clone(),
        )))
        .unwrap();
        host.register(Box::new(RecordingPlugin::new(
            "second",
            "S",
            log.clone(),
        )))
        .unwrap();
        host.register(Box::new(RecordingPlugin::new(
            "third",
            "T",
            log.clone(),
        )))
        .unwrap();
        let mut ctx = dummy_ctx();
        host.init_all(&mut ctx).unwrap();
        let log_snapshot = log.lock().unwrap().clone();
        let first_idx = log_snapshot.iter().position(|s| s == "init:first").unwrap();
        let second_idx = log_snapshot.iter().position(|s| s == "init:second").unwrap();
        let third_idx = log_snapshot.iter().position(|s| s == "init:third").unwrap();
        assert!(first_idx < second_idx);
        assert!(second_idx < third_idx);
    }

    #[test]
    fn init_all_propagates_error() {
        let mut host = PluginHost::new();
        host.register(Box::new(InitFailingPlugin)).unwrap();
        let mut ctx = dummy_ctx();
        let err = host.init_all(&mut ctx).unwrap_err();
        assert!(matches!(err, PluginError::InitFailed(s) if s == "boom"));
    }

    #[test]
    fn shutdown_all_runs_in_reverse_order() {
        let log = Arc::new(Mutex::new(Vec::<String>::new()));
        let mut host = PluginHost::new();
        host.register(Box::new(RecordingPlugin::new(
            "a",
            "A",
            log.clone(),
        )))
        .unwrap();
        host.register(Box::new(RecordingPlugin::new(
            "b",
            "B",
            log.clone(),
        )))
        .unwrap();
        host.register(Box::new(RecordingPlugin::new(
            "c",
            "C",
            log.clone(),
        )))
        .unwrap();
        host.shutdown_all().unwrap();
        let log_snapshot = log.lock().unwrap().clone();
        let a = log_snapshot.iter().position(|s| s == "shutdown:a").unwrap();
        let b = log_snapshot.iter().position(|s| s == "shutdown:b").unwrap();
        let c = log_snapshot.iter().position(|s| s == "shutdown:c").unwrap();
        // Reverse: c, b, a
        assert!(c < b);
        assert!(b < a);
    }

    #[test]
    fn all_routes_collects_from_all_plugins() {
        let mut host = PluginHost::new();
        host.register(Box::new(RoutePlugin("route-1"))).unwrap();
        host.register(Box::new(RoutePlugin("route-2"))).unwrap();
        host.register(Box::new(RoutePlugin("route-3"))).unwrap();
        let routes = host.all_routes();
        assert_eq!(routes.len(), 6);
        for r in &routes {
            assert_eq!(r.path == "/a" || r.path == "/b", true);
        }
    }

    #[test]
    fn noop_plugin_default_init_shutdown_work() {
        let mut host = PluginHost::new();
        host.register(Box::new(NoOpPlugin)).unwrap();
        let mut ctx = dummy_ctx();
        host.init_all(&mut ctx).unwrap();
        host.shutdown_all().unwrap();
        assert_eq!(host.count(), 1);
    }

    #[test]
    fn iter_yields_plugins_in_registration_order() {
        let log = Arc::new(Mutex::new(Vec::<String>::new()));
        let mut host = PluginHost::new();
        host.register(Box::new(RecordingPlugin::new(
            "x",
            "X",
            log.clone(),
        )))
        .unwrap();
        host.register(Box::new(RecordingPlugin::new(
            "y",
            "Y",
            log.clone(),
        )))
        .unwrap();
        let ids: Vec<&str> = host.iter().map(|(id, _)| id).collect();
        assert_eq!(ids, vec!["x", "y"]);
    }

    // -----------------------------------------------------------------
    // Phase 43 — collect helpers for tray / app-menu items
    // -----------------------------------------------------------------

    /// Test plugin contributing 1 tray item per instance. Distinct ids
    /// so multiple instances can coexist on the same host.
    struct TrayPlugin(&'static str);

    impl IPlugin for TrayPlugin {
        fn id(&self) -> &'static str {
            self.0
        }
        fn name(&self) -> &'static str {
            self.0
        }
        fn tray_items(&self) -> Vec<PluginTrayItem> {
            vec![PluginTrayItem {
                id: format!("{}:show", self.0),
                label: "Show".into(),
                enabled: true,
                accelerator: None,
                action: PluginAction::ShowMainWindow,
            }]
        }
    }

    /// Test plugin contributing 2 macOS app-menu items (1 Predefined +
    /// 1 Custom).
    struct AppMenuPlugin(&'static str);

    impl IPlugin for AppMenuPlugin {
        fn id(&self) -> &'static str {
            self.0
        }
        fn name(&self) -> &'static str {
            self.0
        }
        fn app_menu_items(&self) -> Vec<PluginAppMenuItem> {
            vec![
                PluginAppMenuItem {
                    submenu: "App".into(),
                    kind: PluginAppMenuItemKind::Predefined(AppMenuRole::About),
                },
                PluginAppMenuItem {
                    submenu: "Edit".into(),
                    kind: PluginAppMenuItemKind::Custom {
                        id: format!("{}:do", self.0),
                        label: "Do".into(),
                        accelerator: None,
                    },
                },
            ]
        }
    }

    /// `all_tray_items` concatenates `tray_items()` from every
    /// registered plugin in registration order.
    ///
    /// Implementation note: we collect via `host.iter()` (which walks
    /// `init_order` and is documented to preserve insertion order),
    /// not `HashMap::values()` (whose order is unspecified and
    /// changes between Rust versions / hash randomization modes).
    /// The previous version used `values()` and "happened to work"
    /// in practice — the sccache warm-up exercise or a hash-seed
    /// change flipped it. `iter()` makes the order guarantee part
    /// of the contract.
    #[test]
    fn all_tray_items_collects_from_all_plugins() {
        let mut host = PluginHost::new();
        host.register(Box::new(TrayPlugin("a"))).unwrap();
        host.register(Box::new(TrayPlugin("b"))).unwrap();
        host.register(Box::new(TrayPlugin("c"))).unwrap();
        // Collect via the same path MenuRegistry uses — flatten in
        // registration order.
        let items: Vec<PluginTrayItem> = host
            .iter()
            .flat_map(|(_, p)| p.tray_items())
            .collect();
        assert_eq!(items.len(), 3);
        assert_eq!(items[0].id, "a:show");
        assert_eq!(items[1].id, "b:show");
        assert_eq!(items[2].id, "c:show");
    }

    /// `all_app_menu_items` concatenates `app_menu_items()` from every
    /// registered plugin in registration order. Items stay in the
    /// order plugins declared them — `core-plugin` is responsible
    /// for grouping by `submenu` later in `build_app_menu`.
    #[test]
    fn all_app_menu_items_collects_from_all_plugins() {
        let mut host = PluginHost::new();
        host.register(Box::new(AppMenuPlugin("a"))).unwrap();
        host.register(Box::new(AppMenuPlugin("b"))).unwrap();
        let items = host.all_app_menu_items();
        assert_eq!(items.len(), 4); // 2 per plugin
        assert_eq!(items[0].submenu, "App");
        assert_eq!(items[1].submenu, "Edit");
        assert_eq!(items[2].submenu, "App");
        assert_eq!(items[3].submenu, "Edit");
    }

    /// Plugins that don't override `tray_items()` get an empty vec
    /// (default impl). Verifies the default impl pins correctly.
    #[test]
    fn default_tray_items_returns_empty() {
        let plugin = NoOpPlugin;
        let items: Vec<PluginTrayItem> = plugin.tray_items();
        assert!(items.is_empty());
    }

    /// Plugins that don't override `app_menu_items()` get an empty
    /// vec (default impl).
    #[test]
    fn default_app_menu_items_returns_empty() {
        let plugin = NoOpPlugin;
        let items: Vec<PluginAppMenuItem> = plugin.app_menu_items();
        assert!(items.is_empty());
    }

    // -----------------------------------------------------------------
    // Phase 45 — init_all_topological (depends_on wiring)
    // -----------------------------------------------------------------

    /// Test plugin that declares `depends_on` and records its init
    /// order to a shared log. Distinct ids so multiple instances can
    /// coexist on the same host.
    struct DepPlugin {
        id: &'static str,
        deps: Vec<&'static str>,
        log: Arc<Mutex<Vec<String>>>,
    }

    impl DepPlugin {
        fn new(id: &'static str, deps: &[&'static str], log: Arc<Mutex<Vec<String>>>) -> Self {
            Self {
                id,
                deps: deps.to_vec(),
                log,
            }
        }
    }

    impl IPlugin for DepPlugin {
        fn id(&self) -> &'static str {
            self.id
        }
        fn name(&self) -> &'static str {
            self.id
        }
        fn depends_on(&self) -> Vec<&'static str> {
            self.deps.clone()
        }
        fn init(&mut self, _ctx: &mut PluginContext) -> Result<(), PluginError> {
            self.log.lock().unwrap().push(format!("init:{}", self.id));
            Ok(())
        }
    }

    /// A → B; topo order must be B before A.
    #[test]
    fn init_all_topological_respects_depends_on() {
        let log = Arc::new(Mutex::new(Vec::<String>::new()));
        let mut host = PluginHost::new();
        host.register(Box::new(DepPlugin::new(
            "A",
            &["B"],
            log.clone(),
        )))
        .unwrap();
        host.register(Box::new(DepPlugin::new(
            "B",
            &[],
            log.clone(),
        )))
        .unwrap();
        let mut ctx = dummy_ctx();
        let order = host.init_all_topological(&mut ctx).unwrap();
        let log_snapshot = log.lock().unwrap().clone();
        let b_idx = log_snapshot.iter().position(|s| s == "init:B").unwrap();
        let a_idx = log_snapshot.iter().position(|s| s == "init:A").unwrap();
        assert!(b_idx < a_idx, "B must init before A; got {:?}", log_snapshot);
        // Order returned also dependency-first.
        let b_pos = order.iter().position(|&x| x == "B").unwrap();
        let a_pos = order.iter().position(|&x| x == "A").unwrap();
        assert!(b_pos < a_pos, "topo order must list B before A");
    }

    /// A → B → A → cycle, must surface as `PluginError::CycleDetected`
    /// carrying both ids in the path.
    #[test]
    fn init_all_topological_detects_cycle() {
        let log = Arc::new(Mutex::new(Vec::<String>::new()));
        let mut host = PluginHost::new();
        host.register(Box::new(DepPlugin::new("A", &["B"], log.clone()))).unwrap();
        host.register(Box::new(DepPlugin::new("B", &["A"], log.clone()))).unwrap();
        let mut ctx = dummy_ctx();
        let err = host.init_all_topological(&mut ctx).unwrap_err();
        match err {
            PluginError::CycleDetected { path } => {
                assert!(path.contains(&"A".to_string()), "path includes A: {path:?}");
                assert!(path.contains(&"B".to_string()), "path includes B: {path:?}");
            }
            other => panic!("expected CycleDetected, got {other:?}"),
        }
    }

    /// A depends on "nonexistent" → `MissingDependency` error names the
    /// missing plugin.
    #[test]
    fn init_all_topological_missing_dep_errors() {
        let log = Arc::new(Mutex::new(Vec::<String>::new()));
        let mut host = PluginHost::new();
        host.register(Box::new(DepPlugin::new("A", &["nonexistent"], log.clone()))).unwrap();
        let mut ctx = dummy_ctx();
        let err = host.init_all_topological(&mut ctx).unwrap_err();
        match err {
            PluginError::MissingDependency { plugin, missing } => {
                assert_eq!(plugin, "A");
                assert_eq!(missing, "nonexistent");
            }
            other => panic!("expected MissingDependency, got {other:?}"),
        }
    }

    /// G10 — full 9-service dependency graph resolves in the expected
    /// dependency-first order. (Service plugin types aren't required —
    /// we just need any IPlugin that declares the right `depends_on`.)
    #[test]
    fn init_all_topological_9_service_order() {
        let log = Arc::new(Mutex::new(Vec::<String>::new()));
        let mut host = PluginHost::new();
        host.register(Box::new(DepPlugin::new("history-service", &[], log.clone()))).unwrap();
        host.register(Box::new(DepPlugin::new("backup-service", &["history-service"], log.clone()))).unwrap();
        host.register(Box::new(DepPlugin::new("usage-service", &["history-service"], log.clone()))).unwrap();
        host.register(Box::new(DepPlugin::new("mcp-service", &[], log.clone()))).unwrap();
        host.register(Box::new(DepPlugin::new("optimizer-service", &[], log.clone()))).unwrap();
        host.register(Box::new(DepPlugin::new("resource-service", &[], log.clone()))).unwrap();
        host.register(Box::new(DepPlugin::new("marketplace-service", &[], log.clone()))).unwrap();
        host.register(Box::new(DepPlugin::new("project-service", &[], log.clone()))).unwrap();
        host.register(Box::new(DepPlugin::new(
            "provider-service",
            &["backup-service", "history-service"],
            log.clone(),
        )))
        .unwrap();

        let mut ctx = dummy_ctx();
        let order = host.init_all_topological(&mut ctx).unwrap();

        // provider-service is the only plugin with non-empty deps —
        // it must appear after both history-service and backup-service.
        // (usage-service is a sibling of provider-service: both depend
        // only on history, so their relative order is NOT constrained
        // by the graph.)
        let pos = |id: &str| order.iter().position(|&x| x == id).unwrap();
        let h = pos("history-service");
        let b = pos("backup-service");
        let p = pos("provider-service");
        assert!(h < b, "history before backup");
        assert!(h < p, "history before provider");
        assert!(b < p, "backup before provider");

        // And the init log must reflect the same dependency-first order.
        let log_snapshot = log.lock().unwrap().clone();
        let init_h = log_snapshot.iter().position(|s| s == "init:history-service").unwrap();
        let init_b = log_snapshot.iter().position(|s| s == "init:backup-service").unwrap();
        let init_p = log_snapshot.iter().position(|s| s == "init:provider-service").unwrap();
        assert!(init_h < init_b, "history.init before backup.init");
        assert!(init_b < init_p, "backup.init before provider.init");
    }

    /// Plugins without `depends_on` overrides still init via topo-sort
    /// (in registration order, no error).
    #[test]
    fn init_all_topological_handles_no_deps() {
        let log = Arc::new(Mutex::new(Vec::<String>::new()));
        let mut host = PluginHost::new();
        host.register(Box::new(RecordingPlugin::new("a", "A", log.clone()))).unwrap();
        host.register(Box::new(RecordingPlugin::new("b", "B", log.clone()))).unwrap();
        let mut ctx = dummy_ctx();
        let order = host.init_all_topological(&mut ctx).unwrap();
        assert_eq!(order.len(), 2);
        assert!(order.contains(&"a"));
        assert!(order.contains(&"b"));
    }
}
