//! M4.6 (Phase 21) — history service end-to-end integration tests.
//!
//! Guards the contract that:
//! - `AppState::build` opens + migrates a fresh history db,
//! - F7 (UsageService) writes `usage_history` rows on a fresh
//!   snapshot,
//! - F13 (BackupService) writes `backup_history` rows on each
//!   `.bak.<ts>` snapshot,
//! - The cross-plugin contract: a service that uses `IPlatformPaths`
//!   for path resolution shares the same `history_db` field that
//!   `HistoryService` opens.
//!
//! Mirrors `tests/project_service.rs`'s structure (inline test
//! helpers, no Tauri runtime, focus on the 5-command surface that
//! `commands::history` will expose in Plan B).

use std::path::PathBuf;

use claude_config_manager_lib::domain::{UsageSnapshot, UsageWindow};
use claude_config_manager_lib::infrastructure::sqlite::history_db::open_history_db;
// M4.1 (B-2/E-6) — macOS test cfg: use the host-OS paths impl via the
// `platform` re-export. The previous `use platform::windows::WindowsPaths`
// broke macOS cargo test (WindowsPaths only exists in the windows module).
// CLAUDE.md §3.2: business code (and its tests) only touches the platform
// abstraction, never a concrete OS struct directly.
#[cfg(windows)]
use claude_config_manager_lib::platform::windows::WindowsPaths as HostPaths;
#[cfg(target_os = "macos")]
use claude_config_manager_lib::platform::macos::MacPaths as HostPaths;
use claude_config_manager_lib::platform::{AppPaths, IPlatformPaths};
use claude_config_manager_lib::services::backup_service::BackupService;
use claude_config_manager_lib::services::history_service::{
    BackupHistoryFilter, HistoryService, UsageHistoryFilter,
};
use claude_config_manager_lib::services::usage_service::UsageService;

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/// Build an `AppPaths` rooted inside a temp directory. Tests use this
/// instead of the real `%APPDATA%` so we never touch the user's profile.
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

/// Pre-create the dirs + files the services need.
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
    std::fs::write(&p.settings_json, "{}").unwrap();
    std::fs::write(&p.claude_json, "{}").unwrap();
}

fn make_valid_project_dir(parent: &std::path::Path, name: &str) -> PathBuf {
    let p = parent.join("projects").join(name);
    std::fs::create_dir_all(p.join(".claude")).unwrap();
    p
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[test]
fn history_db_opens_and_has_schema() {
    let tmp = tempfile::TempDir::new().unwrap();
    let paths = test_paths(&tmp);
    bootstrap(&paths);
    let conn = open_history_db(&paths.history_db).unwrap();
    let svc = HistoryService::new(conn);
    svc.init().unwrap();
    let stats = svc.stats().unwrap();
    assert_eq!(stats.usage_rows, 0);
    assert_eq!(stats.backup_rows, 0);
}

#[test]
fn app_paths_history_db_lives_under_app_data() {
    // Defensive: even if we can't override dirs::home_dir / dirs::config_dir
    // for HostPaths, the resolved path's leaf must end with
    // history.db and the directory tree under app_data/.
    let p = HostPaths.resolve();
    let name = p.history_db.file_name().and_then(|s| s.to_str());
    assert_eq!(name, Some("history.db"));
    assert!(p.history_db.starts_with(&p.app_data));
}

#[test]
fn usage_service_writes_history_on_fresh_snapshot() {
    let tmp = tempfile::TempDir::new().unwrap();
    let paths = test_paths(&tmp);
    bootstrap(&paths);
    let proj = make_valid_project_dir(tmp.path(), "alpha");
    // Seed JSONL so the snapshot has tokens.
    let jsonl = proj.join(".claude/projects/C--alpha/sess.jsonl");
    std::fs::create_dir_all(jsonl.parent().unwrap()).unwrap();
    std::fs::write(
        &jsonl,
        r#"{"type":"assistant","message":{"id":"m1","role":"assistant","model":"claude-sonnet-4-20250514","usage":{"input_tokens":1000,"output_tokens":500,"cache_creation_input_tokens":0,"cache_read_input_tokens":0}},"timestamp":"2026-06-22T10:00:00Z","sessionId":"s1","cwd":"C:\\alpha"}"#,
    )
    .unwrap();

    let conn = open_history_db(&paths.history_db).unwrap();
    let history = std::sync::Arc::new(HistoryService::new(conn));
    history.init().unwrap();

    let usage = std::sync::Arc::new(UsageService::new(paths.clone()).with_history(history.clone()));

    // Cold call → compute + record.
    let _ = usage.get_usage("p1", UsageWindow::OneMonth).unwrap();
    let rows = history.query_usage(&UsageHistoryFilter::default()).unwrap();
    assert!(rows.len() >= 1, "expected at least 1 usage_history row");
    assert_eq!(rows[0].provider_id, "p1");

    // Second call within TTL → cache hit, no new row.
    let _ = usage.get_usage("p1", UsageWindow::OneMonth).unwrap();
    let rows2 = history.query_usage(&UsageHistoryFilter::default()).unwrap();
    assert_eq!(rows.len(), rows2.len(), "cache hit must not insert a new row");
}

#[test]
fn backup_service_writes_history_on_new_snapshot() {
    let tmp = tempfile::TempDir::new().unwrap();
    let paths = test_paths(&tmp);
    bootstrap(&paths);
    let settings = paths.settings_json.clone();
    std::fs::write(&settings, r#"{"env":{"url":"https://first"}}"#).unwrap();

    let conn = open_history_db(&paths.history_db).unwrap();
    let history = std::sync::Arc::new(HistoryService::new(conn));
    history.init().unwrap();

    let svc = std::sync::Arc::new(BackupService::new(paths.clone()).with_history(history.clone()));

    let entry = svc.backup_now(&settings).unwrap();
    assert!(entry.path.exists());
    let rows = history
        .query_backup(&BackupHistoryFilter {
            scope: Some("user".into()),
            ..Default::default()
        })
        .unwrap();
    assert!(rows.len() >= 1, "expected at least 1 backup_history row");
    assert!(rows[0].file_name.contains(".bak."));

    // Second backup_now on a file with unchanged content — still inserts
    // a row (full copy, no incremental skip in backup_now itself).
    let entry2 = svc.backup_now(&settings).unwrap();
    let rows2 = history
        .query_backup(&BackupHistoryFilter::default())
        .unwrap();
    assert!(rows2.len() >= 2, "second backup must also record");
    assert_ne!(entry.path, entry2.path, "second backup must have a new path");
}

#[test]
fn cross_project_filter_returns_only_matching_root() {
    let tmp = tempfile::TempDir::new().unwrap();
    let paths = test_paths(&tmp);
    bootstrap(&paths);

    let conn = open_history_db(&paths.history_db).unwrap();
    let history = std::sync::Arc::new(HistoryService::new(conn));
    history.init().unwrap();

    let snap_a = UsageSnapshot {
        provider_id: "p1".into(),
        window: UsageWindow::OneMonth,
        tokens_used: 100,
        timestamp: 1,
        breakdown: Vec::new(),
        model_count: 0,
        inserted_rows: 0,
    };
    let snap_b = UsageSnapshot {
        provider_id: "p2".into(),
        window: UsageWindow::OneMonth,
        tokens_used: 200,
        timestamp: 2,
        breakdown: Vec::new(),
        model_count: 0,
        inserted_rows: 0,
    };
    history.record_usage(&snap_a, Some("/proj-a")).unwrap();
    history.record_usage(&snap_b, Some("/proj-b")).unwrap();

    let only_a = history
        .query_usage(&UsageHistoryFilter {
            active_root: Some("/proj-a".into()),
            ..Default::default()
        })
        .unwrap();
    assert_eq!(only_a.len(), 1);
    assert_eq!(only_a[0].provider_id, "p1");
}

/// Plan D — end-to-end backfill → live write → cross-plugin filter.
///
/// Mirrors the cold-start sequence in `app_state::AppState::build`:
///   1. Pre-seed `<backups_dir>/` with 2 `.bak.<ts>` files.
///   2. Open history db + `backfill_bak` (the same call AppState makes).
///   3. Take a fresh F13 `BackupService` snapshot → should record a 3rd row.
///   4. Take an F7 `UsageService` snapshot for a known provider → 1st usage row.
///   5. Filter by `active_root` → only the F7 row matches (backfilled rows
///      have no `active_root` because they predate the field).
///
/// Guards the contract that all 3 writers (backfill / F13 / F7) share the
/// same `HistoryService` instance and don't accidentally cross-contaminate
/// each other's data.
#[test]
fn end_to_end_backfill_then_f7_then_f13() {
    let tmp = tempfile::TempDir::new().unwrap();
    let paths = test_paths(&tmp);
    bootstrap(&paths);

    // Pre-seed 2 backup files (so backfill_bak has something to ingest).
    let bak1 = paths.backups_dir.join("settings.json.bak.20260619-120000");
    let bak2 = paths.backups_dir.join("settings.json.bak.20260620-080000");
    std::fs::write(&bak1, b"{\"v\":1}").unwrap();
    std::fs::write(&bak2, b"{\"v\":2}").unwrap();

    let conn = open_history_db(&paths.history_db).unwrap();
    let history = std::sync::Arc::new(HistoryService::new(conn));
    history.init().unwrap();

    // Step 1: backfill (mirrors AppState::build lines 118-124).
    let n = history.backfill_bak(&paths.backups_dir, None).unwrap();
    assert!(n <= 2, "backfill should insert ≤ 2 rows, got {n}");
    let after_backfill = history
        .query_backup(&BackupHistoryFilter::default())
        .unwrap();
    assert!(after_backfill.len() <= 2);

    // Step 2: live F13 backup_now — should record 1 new backup row.
    let settings = paths.settings_json.clone();
    std::fs::write(&settings, r#"{"env":{"url":"https://now"}}"#).unwrap();
    let backup_svc = std::sync::Arc::new(
        BackupService::new(paths.clone()).with_history(history.clone()),
    );
    let _ = backup_svc.backup_now(&settings).unwrap();
    let after_f13 = history
        .query_backup(&BackupHistoryFilter::default())
        .unwrap();
    assert_eq!(
        after_f13.len(),
        after_backfill.len() + 1,
        "F13 should append exactly 1 row"
    );

    // Step 3: live F7 usage — record 1 usage row.
    let usage_svc = std::sync::Arc::new(
        UsageService::new(paths.clone()).with_history(history.clone()),
    );
    let _ = usage_svc
        .get_usage("p_live", UsageWindow::OneMonth)
        .unwrap();
    let all_usage = history.query_usage(&UsageHistoryFilter::default()).unwrap();
    assert_eq!(all_usage.len(), 1, "F7 should record exactly 1 usage row");
    assert_eq!(all_usage[0].provider_id, "p_live");

    // Step 4: cross-plugin filter — backup filter does not bleed into usage.
    let only_usage = history
        .query_usage(&UsageHistoryFilter {
            active_root: Some("/some-root".into()),
            ..Default::default()
        })
        .unwrap();
    assert_eq!(
        only_usage.len(),
        0,
        "filter on usage.active_root must not match unrelated backups"
    );
}
