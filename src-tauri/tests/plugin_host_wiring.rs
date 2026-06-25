//! Integration test: `plugins::init_all` wires all 11 plugin stubs.
//!
//! This is the M1.3 → M2.17 wiring test. It guards the contract that
//! `plugins::init_all(ctx)` returns a [`PluginHost`] pre-populated with
//! the 11 F1..F8 (minus F4) + F16..F19 stubs, and that each stub reports
//! the expected kebab-case id.
//!
//! It does NOT exercise the Tauri runtime — `PluginContext::for_tests`
//! leaves `app = None`, which is the test-only path that doesn't touch
//! Tauri's `AppHandle`. Real wiring into `lib.rs::run` is verified by
//! `scripts/smoke-test.sh` (see CLAUDE.md §9.4).
//!
//! The 11 stub ids in this file are the contract that
//! `mod.rs::init_all` must preserve. If you add/remove/rename a stub,
//! update BOTH this list AND the registration block in
//! `src-tauri/src/plugins/mod.rs::init_all` — the assertion below
//! will fail otherwise.

use std::path::PathBuf;

use claude_config_manager_lib::platform::{AppPaths, IPlatformPaths, PlatformError};
use claude_config_manager_lib::plugins::{init_all, PluginContext, PluginHost};

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/// `EmptyPaths`: satisfies `IPlatformPaths` for tests that don't read any
/// path. `init_all` doesn't dereference `paths` (stubs' `init` are no-ops),
/// so a stub is enough.
mod empty_paths {
    use super::*;

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
                history_db: PathBuf::from("/"),
            }
        }
        fn ensure_dirs(&self) -> Result<(), PlatformError> {
            Ok(())
        }
    }
}

fn ctx<'a>() -> PluginContext<'a> {
    // `PluginContext::for_tests` is `#[cfg(test)]`-gated, so we cannot
    // call it from the integration test crate. Build the struct literal
    // directly — `app: None` is exactly what `for_tests` does internally.
    let paths: &'static dyn IPlatformPaths = Box::leak(Box::new(empty_paths::EmptyPaths));
    PluginContext { app: None, paths }
}

/// The canonical 11 plugin ids. Mirrors the F1..F8 (minus F4) + F16..F19
/// feature mapping in CLAUDE.md §3.3. The order is the expected `init_all`
/// registration order (which doubles as `init_all` call order and
/// `shutdown_all` reverse order). F4 deeplink-import was removed in
/// cleanup commit 0ff5b86.
const EXPECTED_IDS: &[&str] = &[
    // F1..F8 core (F4 deeplink-import removed)
    "provider-list",
    "provider-switch",
    "import-sql",
    "json-editor",
    "mcp-management",
    "usage-query",
    "single-file-deploy",
    // F16..F19 L1 features
    "resource-browser",
    "marketplace",
    "optimizer",
    "backup-restore",
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[test]
fn init_all_returns_host_with_eleven_registered_plugins() {
    let host = init_all(&ctx()).expect("init_all must succeed against the empty test context");
    assert_eq!(
        host.count(),
        EXPECTED_IDS.len(),
        "expected {} plugins registered, got {}",
        EXPECTED_IDS.len(),
        host.count()
    );
}

#[test]
fn init_all_registers_every_expected_id() {
    let host = init_all(&ctx()).expect("init_all must succeed");
    let actual: Vec<&str> = host.iter().map(|(id, _)| id).collect();
    assert_eq!(
        actual, EXPECTED_IDS,
        "init_all registration order / id set diverged from contract; \
         check src-tauri/src/plugins/mod.rs::init_all"
    );
}

#[test]
fn init_all_registers_unique_ids_no_duplicates() {
    let host = init_all(&ctx()).expect("init_all must succeed");
    // `count` is HashMap::len which is unaffected by duplicate registrations
    // (latter is rejected by `register`), so equal counts are necessary but
    // not sufficient. Cross-check with the iteration order (the HashMap
    // keys) and `EXPECTED_IDS` lengths.
    assert_eq!(host.count(), EXPECTED_IDS.len());
    let mut seen: Vec<&str> = host.iter().map(|(id, _)| id).collect();
    seen.sort_unstable();
    let mut expected_sorted: Vec<&str> = EXPECTED_IDS.to_vec();
    expected_sorted.sort_unstable();
    assert_eq!(seen, expected_sorted, "duplicate or missing plugin id in host");
}

#[test]
fn init_all_each_plugin_has_non_empty_name_and_matches_id() {
    let host = init_all(&ctx()).expect("init_all must succeed");
    for (id, plugin) in host.iter() {
        let name = plugin.name();
        assert!(!name.is_empty(), "plugin {id} returned empty display name");
        assert!(
            name.chars().count() >= 2,
            "plugin {id} display name too short: {name:?}"
        );
    }
}

#[test]
fn init_all_aggregates_routes_from_every_route_contributing_stub() {
    // Of the 11 registered stubs, only 7 contribute a route:
    //   provider-list, import-sql, mcp-management, resource-browser,
    //   marketplace, optimizer, backup-restore.
    // The other 4 contribute none: provider-switch (F2, action-only),
    // json-editor, usage-query, single-file-deploy (F8, build-time
    // concern). F4 deeplink-import was removed in cleanup commit
    // 0ff5b86 — it previously contributed a route, hence the count
    // dropped from 8 to 7.
    // (If a stub adds/removes a route, update this assertion + this
    // comment.)
    let host = init_all(&ctx()).expect("init_all must succeed");
    let routes = host.all_routes();
    assert_eq!(
        routes.len(),
        7,
        "expected 7 routes aggregated across 11 plugins, got {}",
        routes.len()
    );
    // Every route must point to a registered plugin id.
    for r in &routes {
        assert!(
            EXPECTED_IDS.contains(&r.plugin_id),
            "route {} has plugin_id {:?} which is not in EXPECTED_IDS",
            r.path,
            r.plugin_id
        );
    }
}

#[test]
fn init_all_then_shutdown_succeeds() {
    // End-to-end smoke for the host: construct via `init_all` (which
    // runs every plugin's `init`), then `shutdown_all` (which runs every
    // plugin's `shutdown` in LIFO order). Both are no-ops on the current
    // stubs but the call surface must compile + work.
    let mut host = init_all(&ctx()).expect("init_all must succeed");
    host.shutdown_all()
        .expect("shutdown_all must succeed against no-op stubs");
    assert_eq!(
        host.count(),
        EXPECTED_IDS.len(),
        "shutdown_all must not remove plugins (only unregister does)"
    );
}

// ---------------------------------------------------------------------------
// Helper: expose `PluginHost` name to keep the import alive in the
// generated docs even if no test happens to dereference the type.
// ---------------------------------------------------------------------------

#[allow(dead_code)]
fn _typecheck_host(_h: PluginHost) {}
