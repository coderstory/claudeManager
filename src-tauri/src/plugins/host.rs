//! Plugin host — registry + lifecycle for [`IPlugin`].
//!
//! `PluginHost` owns a map of plugins keyed by id and an `init_order` list
//! that records the order plugins were registered. `init_all` walks that
//! list and calls `IPlugin::init` on each; `shutdown_all` does the same in
//! reverse for teardown.
//!
//! Tests live at the bottom of this file (`#[cfg(test)] mod tests`).

use std::collections::HashMap;

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

    /// Run `init` on every plugin, in registration order.
    pub fn init_all(&mut self, ctx: &PluginContext) -> Result<(), PluginError> {
        // Clone the order list so we can iterate without holding a borrow
        // on `self.plugins` (we need `get_mut` inside the loop).
        let order: Vec<&'static str> = self.init_order.clone();
        for id in order {
            if let Some(plugin) = self.plugins.get_mut(id) {
                plugin.init(ctx)?;
            }
        }
        Ok(())
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
        fn init(&mut self, _ctx: &PluginContext) -> Result<(), PluginError> {
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
        fn init(&mut self, _ctx: &PluginContext) -> Result<(), PluginError> {
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
        host.init_all(&dummy_ctx()).unwrap();
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
        let err = host.init_all(&dummy_ctx()).unwrap_err();
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
        host.init_all(&dummy_ctx()).unwrap();
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
}
