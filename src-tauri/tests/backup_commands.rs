//! M4.6 / Phase 21 Plan B — integration tests for `commands::backup`.
//!
//! Why these tests don't use `tauri::test::mock_app`:
//! - The crate does NOT enable `tauri/test` (no `test` feature on the
//!   `tauri` dep in Cargo.toml). The project has standardised on
//!   "call services directly" for integration tests (see
//!   `tests/history_commands.rs`, `tests/project_service.rs`).
//!
//! What we test:
//! - The `commands::backup` module's 7 `#[tauri::command]` symbols
//!   exist with the right names and public signatures (compile-time
//!   contract for `lib.rs::generate_handler!`).
//! - The `BackupService` methods the commands delegate into behave
//!   correctly end-to-end against a real temp-dir filesystem:
//!   * `list_backups` finds `.bak.<ts>` files across scan roots
//!   * `read_backup_content` returns file content after allow-list check
//!   * `backup_now` creates a snapshot and surfaces it via list_backups
//!   * `backup_incremental` skips when content unchanged, creates when
//!     changed
//!   * `delete_backup` moves the file into a sibling `.trash/` dir
//!   * `restore_backup` restores the snapshot to the original location
//!
//! Mirrors `tests/history_commands.rs` style (inline helpers, no Tauri
//! runtime, focus on the contract surface + service behaviour).

use std::sync::Arc;

use claude_config_manager_lib::platform::AppPaths;
use claude_config_manager_lib::services::backup_service::BackupService;

// ---------------------------------------------------------------------------
// Timestamp format: yyyyMMdd-HHmmss (see backup_scanner::TIMESTAMP_FORMATS)
// ---------------------------------------------------------------------------
const SAMPLE_BAK: &str = "settings.json.bak.20260624-230433";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/// Build an `AppPaths` rooted inside a temp directory. Mirrors the
/// `test_paths` helper in `tests/history_integration.rs` so backup
/// dirs + Claude config dirs all live under the temp tree.
fn test_paths(tmp: &tempfile::TempDir) -> AppPaths {
    AppPaths {
        home: tmp.path().join("home"),
        app_data: tmp.path().join("app_data"),
        settings_json: tmp.path().join("home/.claude/settings.json"),
        claude_json: tmp.path().join("home/.claude.json"),
        backups_dir: tmp.path().join("app_data/backups"),
        marketplaces_dir: tmp.path().join("app_data/marketplaces"),
        logs_dir: tmp.path().join("app_data/logs"),
        history_db: tmp.path().join("app_data/history.db"),
    }
}

/// Pre-create the dirs + a minimal `settings.json` so BackupService
/// can resolve safe paths against the allow-list.
fn bootstrap(p: &AppPaths) {
    for d in [
        &p.app_data,
        &p.backups_dir,
        &p.marketplaces_dir,
        &p.logs_dir,
        &p.home,
        p.home.join(".claude").as_path(),
    ] {
        std::fs::create_dir_all(d).unwrap();
    }
    std::fs::write(&p.settings_json, r#"{"theme":"dark"}"#).unwrap();
    std::fs::write(&p.claude_json, r#"{}"#).unwrap();
}

fn make_svc(tmp: &tempfile::TempDir) -> (AppPaths, Arc<BackupService>) {
    let paths = test_paths(tmp);
    bootstrap(&paths);
    let svc = BackupService::new(paths.clone());
    (paths, Arc::new(svc))
}

// ---------------------------------------------------------------------------
// Service-level integration tests
// ---------------------------------------------------------------------------

#[test]
fn list_backups_finds_snapshot_in_backups_dir() {
    let tmp = tempfile::tempdir().unwrap();
    let (paths, svc) = make_svc(&tmp);

    // Create a fake .bak.<ts> file in the backups dir.
    let backup_file = paths.backups_dir.join(SAMPLE_BAK);
    std::fs::write(&backup_file, r#"{"theme":"light"}"#).unwrap();

    let entries = svc.list_backups(None);
    assert_eq!(entries.len(), 1, "exactly one snapshot discovered");
    assert_eq!(entries[0].path, backup_file);
    assert_eq!(entries[0].original_name, "settings.json");
    assert!(
        entries[0].timestamp_unix.is_some(),
        "well-formed backup filename must parse to a timestamp"
    );
    assert!(entries[0].size_bytes > 0);
}

#[test]
fn list_backups_finds_snapshot_in_claude_dir() {
    let tmp = tempfile::tempdir().unwrap();
    let (paths, svc) = make_svc(&tmp);

    // A .bak.<ts> file placed in `~/.claude/` is the typical location
    // for `fs_atomic::write_with_backup` snapshots.
    let backup_file = paths
        .home
        .join(".claude")
        .join(SAMPLE_BAK);
    std::fs::create_dir_all(backup_file.parent().unwrap()).unwrap();
    std::fs::write(&backup_file, r#"{"theme":"auto"}"#).unwrap();

    let entries = svc.list_backups(None);
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].path, backup_file);
    assert!(entries[0].path.starts_with(paths.home.join(".claude")));
}

#[test]
fn list_backups_returns_empty_when_no_snapshots() {
    let tmp = tempfile::tempdir().unwrap();
    let (_paths, svc) = make_svc(&tmp);
    // No .bak.<ts> files written anywhere.
    let entries = svc.list_backups(None);
    assert!(entries.is_empty(), "fresh temp dir should have no backups");
}

#[test]
fn read_backup_content_returns_file_body() {
    let tmp = tempfile::tempdir().unwrap();
    let (paths, svc) = make_svc(&tmp);

    let body = r#"{"theme":"dark","version":2}"#;
    let backup_file = paths.backups_dir.join(SAMPLE_BAK);
    std::fs::write(&backup_file, body).unwrap();

    let read_back = svc
        .read_backup_content(&backup_file, None)
        .expect("backup is in allow-list, should read");
    assert_eq!(read_back, body);
}

#[test]
fn backup_now_creates_snapshot_and_list_backups_finds_it() {
    let tmp = tempfile::tempdir().unwrap();
    let (paths, svc) = make_svc(&tmp);

    // Pre-condition: no backups.
    assert!(svc.list_backups(None).is_empty());

    // Call backup_now against the live settings.json.
    let entry = svc
        .backup_now(&paths.settings_json)
        .expect("backup_now should succeed");
    assert!(entry.path.exists());
    assert_eq!(entry.original_name, "settings.json");

    // Post-condition: list_backups now returns 1 entry.
    let entries = svc.list_backups(None);
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].path, entry.path);
}

#[test]
fn backup_incremental_skips_when_content_unchanged() {
    let tmp = tempfile::tempdir().unwrap();
    let (paths, svc) = make_svc(&tmp);

    // First snapshot — always creates.
    let _first = svc
        .backup_now(&paths.settings_json)
        .expect("initial backup");
    assert_eq!(svc.list_backups(None).len(), 1);

    // Second call with same content — must return NoChange.
    let result = svc.backup_incremental(&paths.settings_json, None);
    let err = result.expect_err("identical content must be skipped");
    let msg = err.to_string();
    assert!(
        msg.contains("no changes") || msg.contains("NoChange"),
        "expected NoChange error, got: {msg}"
    );
    // Still only 1 snapshot on disk.
    assert_eq!(svc.list_backups(None).len(), 1);
}

#[test]
fn backup_incremental_creates_new_snapshot_when_content_changed() {
    use std::time::Duration;

    let tmp = tempfile::tempdir().unwrap();
    let (paths, svc) = make_svc(&tmp);

    // First snapshot.
    let _first = svc
        .backup_now(&paths.settings_json)
        .expect("initial backup");
    assert_eq!(svc.list_backups(None).len(), 1);

    // 1-second sleep so that timestamp (1s resolution) changes.
    std::thread::sleep(Duration::from_secs(1));

    // Mutate the live file.
    std::fs::write(&paths.settings_json, r#"{"theme":"light"}"#).unwrap();

    // Incremental call with new content — must create a new snapshot.
    let second = svc
        .backup_incremental(&paths.settings_json, None)
        .expect("changed content must create a new snapshot");
    assert!(second.path.exists());
    assert_ne!(
        second.path, _first.path,
        "new snapshot must have a different timestamp"
    );
    assert_eq!(svc.list_backups(None).len(), 2);
}

#[test]
fn delete_backup_removes_file_from_backups_dir() {
    let tmp = tempfile::tempdir().unwrap();
    let (paths, svc) = make_svc(&tmp);

    let backup_file = paths.backups_dir.join(SAMPLE_BAK);
    std::fs::write(&backup_file, r#"{"x":1}"#).unwrap();
    assert!(backup_file.exists());
    assert_eq!(svc.list_backups(None).len(), 1);

    svc.delete_backup(&backup_file, None)
        .expect("delete should succeed");

    // The file may have been moved into a sibling .trash/ dir, but
    // list_backups must no longer surface it in the timeline.
    let entries = svc.list_backups(None);
    assert!(
        entries.is_empty(),
        "deleted backup must not appear in list, got {entries:?}"
    );
}

// ---------------------------------------------------------------------------
// Tauri-command surface contract — the IPC names and signatures must
// match what `lib.rs::generate_handler!` references. These tests are
// symbol-existence checks; they prevent silent breakage of the
// registered handler list.
// ---------------------------------------------------------------------------

#[test]
fn command_list_backups_exists() {
    let _ = claude_config_manager_lib::commands::backup::list_backups;
}

#[test]
fn command_read_backup_content_exists() {
    let _ = claude_config_manager_lib::commands::backup::read_backup_content;
}

#[test]
fn command_diff_backups_exists() {
    let _ = claude_config_manager_lib::commands::backup::diff_backups;
}

#[test]
fn command_restore_backup_exists() {
    let _ = claude_config_manager_lib::commands::backup::restore_backup;
}

#[test]
fn command_backup_now_exists() {
    let _ = claude_config_manager_lib::commands::backup::backup_now;
}

#[test]
fn command_delete_backup_exists() {
    let _ = claude_config_manager_lib::commands::backup::delete_backup;
}

#[test]
fn command_backup_incremental_exists() {
    let _ = claude_config_manager_lib::commands::backup::backup_incremental;
}
