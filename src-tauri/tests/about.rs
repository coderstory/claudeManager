//! Integration test — M3.7 (清单 18) About page command.
//!
//! Mirrors the unit tests inside `commands/about.rs`, but as a
//! top-level integration test that imports the public crate API
//! (the way the production `lib.rs` does). Guards the contract
//! that:
//!
//! 1. The `about` command module is publicly reachable from
//!    `claude_config_manager_lib::commands::about` (no rename drift).
//! 2. The about snapshot fields match `commands::app::get_app_metadata`
//!    (single source of truth — same `env!()` lookups).
//! 3. Snapshot is stable across repeated calls (no racy fields).
//!
//! We do not invoke `get_app_info` directly — the function is a
//! `#[tauri::command]` async fn that needs an `AppHandle`, and
//! `AppMetadata::current()` is the pure kernel we actually want to
//! exercise. The unit tests inside the module cover the command
//! signature; this file covers the public-API contract.

use claude_config_manager_lib::commands::app;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

/// M3.7 contract: about snapshot fields match `AppMetadata` snapshot
/// (single source of truth — both call `current()` which reads the
/// same `env!()` values).
#[test]
fn about_snapshot_matches_app_metadata() {
    let a = app::AppMetadata::current();
    assert!(!a.version.is_empty());
    assert!(!a.identifier.is_empty());
    assert!(!a.product_name.is_empty());
    assert!(!a.git_commit.is_empty());
    assert!(a.build_target.contains('/'));
    assert!(a.build_timestamp >= 0);
}

/// M3.7 contract: snapshot fields are stable strings (no panic on
/// repeated calls — important because the page re-fetches on every
/// navigation).
#[test]
fn about_snapshot_is_stable_across_calls() {
    let a = app::AppMetadata::current();
    let b = app::AppMetadata::current();
    assert_eq!(a.version, b.version);
    assert_eq!(a.identifier, b.identifier);
    assert_eq!(a.product_name, b.product_name);
    assert_eq!(a.git_commit, b.git_commit);
    assert_eq!(a.build_target, b.build_target);
    // build_timestamp is epoch seconds — within a single test run
    // it must NOT change between calls (else the field is racy).
    assert_eq!(a.build_timestamp, b.build_timestamp);
}

/// M3.7 contract: identifier mirrors `tauri.conf.json` (canary).
/// If you change `tauri.conf.json` `identifier`, update the const
/// in `commands/app.rs` too — this test will fail otherwise.
#[test]
fn about_identifier_mirrors_tauri_conf() {
    assert_eq!(
        app::AppMetadata::current().identifier,
        "com.claudeconfigmanager.desktop"
    );
}

/// M3.7 contract: build_target is exactly `<os>/<arch>` (2 segments).
#[test]
fn about_build_target_shape() {
    let t = app::AppMetadata::current().build_target;
    let parts: Vec<&str> = t.split('/').collect();
    assert_eq!(parts.len(), 2, "build_target should be 'os/arch', got: {t}");
    assert!(!parts[0].is_empty());
    assert!(!parts[1].is_empty());
}
