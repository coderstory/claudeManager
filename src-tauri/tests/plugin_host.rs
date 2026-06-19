//! Integration test: `PluginHost` registry + lifecycle.
//!
//! These tests run against the real `PluginHost` from `claude_config_manager_lib::plugins`.
//! They exercise:
//! - empty host invariants
//! - register / unregister / duplicate detection
//! - registration order is preserved through `iter()`
//! - route aggregation across plugins
//! - LIFO shutdown ordering
//!
//! They do NOT exercise the real Tauri runtime — `PluginContext::for_tests`
//! leaves `app = None`, which is the test-only path that doesn't touch
//! Tauri's `AppHandle`.

use std::sync::{Arc, Mutex};

use claude_config_manager_lib::platform::IPlatformPaths;
use claude_config_manager_lib::plugins::{
    IPlugin, PluginContext, PluginError, PluginHost, PluginRoute,
};

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/// Records every `init` / `shutdown` call into a shared log so we can
/// assert ordering.
struct RecordingPlugin {
    id: &'static str,
    name: &'static str,
    log: Arc<Mutex<Vec<String>>>,
}

impl RecordingPlugin {
    fn new(id: &'static str, name: &'static str, log: Arc<Mutex<Vec<String>>>) -> Self {
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
        self.log
            .lock()
            .unwrap()
            .push(format!("init:{}", self.id));
        Ok(())
    }
    fn shutdown(&mut self) -> Result<(), PluginError> {
        self.log
            .lock()
            .unwrap()
            .push(format!("shutdown:{}", self.id));
        Ok(())
    }
}

struct RoutePlugin;
impl IPlugin for RoutePlugin {
    fn id(&self) -> &'static str {
        "route-plugin"
    }
    fn name(&self) -> &'static str {
        "route-plugin"
    }
    fn routes(&self) -> Vec<PluginRoute> {
        vec![
            PluginRoute {
                path: "/a".into(),
                plugin_id: "route-plugin",
                display_name: "A".into(),
            },
            PluginRoute {
                path: "/b".into(),
                plugin_id: "route-plugin",
                display_name: "B".into(),
            },
        ]
    }
}

struct FailingInitPlugin;
impl IPlugin for FailingInitPlugin {
    fn id(&self) -> &'static str {
        "failing-init"
    }
    fn name(&self) -> &'static str {
        "failing-init"
    }
    fn init(&mut self, _ctx: &PluginContext) -> Result<(), PluginError> {
        Err(PluginError::InitFailed("boom".into()))
    }
}

/// EmptyPaths: satisfies `IPlatformPaths` for tests that don't read any
/// path. The trait isn't `mockall`-mocked here because we want to exercise
/// the real `PluginHost` ↔ trait wiring end-to-end; we just don't need
/// any real filesystem access.
mod empty_paths {
    use std::path::PathBuf;

    use claude_config_manager_lib::platform::{AppPaths, IPlatformPaths, PlatformError};

    pub struct EmptyPaths;
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
}

/// Build a `PluginContext` for integration tests.
///
/// `for_tests` is `#[cfg(test)]` gated and only callable from inside the
/// crate, not from `tests/`. We use the struct literal directly here —
/// `app: None` is exactly what `for_tests` does internally.
fn ctx<'a>() -> PluginContext<'a> {
    let paths: &'static dyn IPlatformPaths = Box::leak(Box::new(empty_paths::EmptyPaths));
    PluginContext { app: None, paths }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[test]
fn host_starts_empty() {
    let host = PluginHost::new();
    assert_eq!(host.count(), 0);
    assert!(host.all_routes().is_empty());
    assert!(host.all_services().is_empty());
}

#[test]
fn register_then_count() {
    let log = Arc::new(Mutex::new(Vec::<String>::new()));
    let mut host = PluginHost::new();
    host.register(Box::new(RecordingPlugin::new(
        "alpha",
        "Alpha",
        log.clone(),
    )))
    .unwrap();
    host.register(Box::new(RecordingPlugin::new(
        "beta",
        "Beta",
        log.clone(),
    )))
    .unwrap();
    assert_eq!(host.count(), 2);
}

#[test]
fn register_duplicate_id_errors_and_does_not_overwrite() {
    let log = Arc::new(Mutex::new(Vec::<String>::new()));
    let mut host = PluginHost::new();
    host.register(Box::new(RecordingPlugin::new(
        "dup",
        "First",
        log.clone(),
    )))
    .unwrap();
    let err = host
        .register(Box::new(RecordingPlugin::new(
            "dup",
            "Second",
            log.clone(),
        )))
        .unwrap_err();
    assert!(matches!(err, PluginError::DuplicateId("dup")));
    // Still only one plugin — the duplicate wasn't inserted.
    assert_eq!(host.count(), 1);
    // And the original plugin's name is preserved (not overwritten).
    assert_eq!(host.get("dup").unwrap().name(), "First");
}

#[test]
fn unregister_removes_and_calls_shutdown() {
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
    let snapshot = log.lock().unwrap().clone();
    assert!(
        snapshot.contains(&"shutdown:u".to_string()),
        "unregister must call shutdown, log was {snapshot:?}"
    );
}

#[test]
fn unregister_unknown_id_errors() {
    let mut host = PluginHost::new();
    let err = host.unregister("does-not-exist").unwrap_err();
    assert!(matches!(err, PluginError::NotFound(ref s) if s == "does-not-exist"));
}

#[test]
fn get_returns_registered_plugin() {
    let mut host = PluginHost::new();
    host.register(Box::new(RoutePlugin)).unwrap();
    assert!(host.get("route-plugin").is_some());
    assert!(host.get("nope").is_none());
}

#[test]
fn iter_yields_plugins_in_registration_order() {
    let log = Arc::new(Mutex::new(Vec::<String>::new()));
    let mut host = PluginHost::new();
    host.register(Box::new(RecordingPlugin::new("x", "X", log.clone())))
        .unwrap();
    host.register(Box::new(RecordingPlugin::new("y", "Y", log.clone())))
        .unwrap();
    host.register(Box::new(RecordingPlugin::new("z", "Z", log.clone())))
        .unwrap();
    let ids: Vec<&str> = host.iter().map(|(id, _)| id).collect();
    assert_eq!(ids, vec!["x", "y", "z"]);
}

#[test]
fn all_routes_aggregates_across_plugins() {
    let mut host = PluginHost::new();
    host.register(Box::new(RoutePlugin)).unwrap();
    host.register(Box::new(RoutePlugin)).unwrap();
    let routes = host.all_routes();
    // 2 routes per plugin × 2 plugins = 4
    assert_eq!(routes.len(), 4);
    for r in &routes {
        assert_eq!(r.plugin_id, "route-plugin");
        assert!(r.path == "/a" || r.path == "/b");
    }
}

#[test]
fn init_all_runs_in_registration_order() {
    let log = Arc::new(Mutex::new(Vec::<String>::new()));
    let mut host = PluginHost::new();
    host.register(Box::new(RecordingPlugin::new("first", "F", log.clone())))
        .unwrap();
    host.register(Box::new(RecordingPlugin::new("second", "S", log.clone())))
        .unwrap();
    host.register(Box::new(RecordingPlugin::new("third", "T", log.clone())))
        .unwrap();
    host.init_all(&ctx()).unwrap();
    let snapshot = log.lock().unwrap().clone();
    let f = snapshot.iter().position(|s| s == "init:first").unwrap();
    let s = snapshot.iter().position(|s| s == "init:second").unwrap();
    let t = snapshot.iter().position(|s| s == "init:third").unwrap();
    assert!(f < s && s < t, "init order wrong: {snapshot:?}");
}

#[test]
fn init_all_propagates_init_error() {
    let mut host = PluginHost::new();
    host.register(Box::new(FailingInitPlugin)).unwrap();
    let err = host.init_all(&ctx()).unwrap_err();
    assert!(matches!(err, PluginError::InitFailed(ref s) if s == "boom"));
}

#[test]
fn shutdown_all_runs_in_reverse_registration_order() {
    let log = Arc::new(Mutex::new(Vec::<String>::new()));
    let mut host = PluginHost::new();
    host.register(Box::new(RecordingPlugin::new("a", "A", log.clone())))
        .unwrap();
    host.register(Box::new(RecordingPlugin::new("b", "B", log.clone())))
        .unwrap();
    host.register(Box::new(RecordingPlugin::new("c", "C", log.clone())))
        .unwrap();
    host.shutdown_all().unwrap();
    let snapshot = log.lock().unwrap().clone();
    let a = snapshot.iter().position(|s| s == "shutdown:a").unwrap();
    let b = snapshot.iter().position(|s| s == "shutdown:b").unwrap();
    let c = snapshot.iter().position(|s| s == "shutdown:c").unwrap();
    // Reverse: c, b, a
    assert!(c < b && b < a, "shutdown order wrong: {snapshot:?}");
}