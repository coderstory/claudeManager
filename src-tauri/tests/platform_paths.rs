//! Integration test: `IPlatformPaths::resolve()` returns sensible paths
//! for the host OS.
//!
//! These tests run against the real per-OS impl (`WindowsPaths` on this
//! dev box, `MacPaths` on a Mac). They check invariants, not exact paths,
//! so they stay green across user-name / locale variation.
//!
//! They live in `tests/` (not `src/platform/windows/paths.rs`) so we test
//! the **public** trait surface — exactly what business code will see.

use claude_config_manager_lib::platform::runtime;

// ---------------------------------------------------------------------------
// resolve()
// ---------------------------------------------------------------------------

#[test]
fn resolve_returns_non_empty_app_data_dir() {
    let paths = runtime::paths();
    let p = paths.resolve();
    assert!(
        !p.app_data.as_os_str().is_empty(),
        "app_data must not be empty"
    );
    assert!(
        p.app_data.is_absolute(),
        "app_data must be absolute, got {:?}",
        p.app_data
    );
}

#[test]
fn resolve_app_data_ends_with_app_name() {
    let paths = runtime::paths();
    let p = paths.resolve();
    // Every per-OS impl resolves `<config>/ClaudeConfigManager`. The leaf
    // is the contract business code depends on.
    let leaf = p
        .app_data
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("");
    assert_eq!(
        leaf, "ClaudeConfigManager",
        "app_data leaf must be ClaudeConfigManager, got {leaf}"
    );
}

#[test]
fn resolve_settings_json_points_into_claude_dir() {
    let paths = runtime::paths();
    let p = paths.resolve();
    let s = p.settings_json.to_string_lossy();
    assert!(
        s.contains(".claude"),
        "settings_json must live under .claude, got {s}"
    );
    assert!(
        s.ends_with("settings.json"),
        "settings_json must end with settings.json, got {s}"
    );
}

#[test]
fn resolve_claude_json_lives_at_home_root() {
    let paths = runtime::paths();
    let p = paths.resolve();
    let s = p.claude_json.to_string_lossy();
    assert!(
        s.ends_with(".claude.json"),
        "claude_json must end with .claude.json, got {s}"
    );
    // It must NOT be under .claude/ — that's where settings.json lives.
    assert!(
        !s.contains(".claude/") && !s.contains(".claude\\"),
        "claude_json must be a sibling of .claude/, not inside it; got {s}"
    );
}

#[test]
fn resolve_subdirs_are_distinct() {
    let paths = runtime::paths();
    let p = paths.resolve();
    // backups / marketplaces / logs are siblings under app_data, not nested
    // in each other.
    assert_ne!(p.backups_dir, p.marketplaces_dir);
    assert_ne!(p.backups_dir, p.logs_dir);
    assert_ne!(p.marketplaces_dir, p.logs_dir);
    // And all three live under app_data.
    assert!(p.backups_dir.starts_with(&p.app_data));
    assert!(p.marketplaces_dir.starts_with(&p.app_data));
    assert!(p.logs_dir.starts_with(&p.app_data));
}

#[test]
fn app_paths_claude_dir_is_parent_of_settings_json() {
    let paths = runtime::paths();
    let p = paths.resolve();
    let claude_dir = p.claude_dir().expect("settings_json has a parent");
    assert_eq!(
        claude_dir,
        p.settings_json.parent().unwrap(),
        "claude_dir() must equal parent of settings_json"
    );
}

// ---------------------------------------------------------------------------
// ensure_dirs()
// ---------------------------------------------------------------------------

#[test]
fn ensure_dirs_is_idempotent() {
    let paths = runtime::paths();
    // First call creates (or no-ops if present).
    paths.ensure_dirs().expect("first ensure_dirs failed");
    // Second call must not fail — `create_dir_all` is idempotent on
    // existing dirs.
    paths.ensure_dirs().expect("second ensure_dirs failed (should be idempotent)");
}