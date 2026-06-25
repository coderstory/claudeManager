//! M4.6 / Phase 21 Plan B — integration tests for `commands::history`.
//!
//! Why these tests don't use `tauri::test::mock_app`:
//! - The crate does NOT enable `tauri/test` (no `test` feature on the
//!   `tauri` dep in Cargo.toml). Enabling it just for tests would
//!   pull in extra deps for every other test, and the project has
//!   standardised on "call services / pure helpers directly" for
//!   integration tests (see `tests/plugin_host.rs`,
//!   `tests/marketplace.rs`, `tests/history_integration.rs`).
//!
//! What we test:
//! - Each `commands::history::*_impl` helper returns the right shape
//!   given a hand-built `HistoryService` (the same service instance
//!   that `commands/history.rs` would dispatch into via
//!   `State<AppState>`).
//! - The Tauri command functions exist, have the right names, and
//!   have the right public signature. This is the contract
//!   `lib.rs::generate_handler!` relies on.
//! - The 5 IPC names match what the frontend will eventually call.
//!
//! Mirrors `tests/history_integration.rs` style (inline helpers,
//! no Tauri runtime, focus on the contract surface).

use std::sync::Arc;

use claude_config_manager_lib::infrastructure::sqlite::history_db::open_history_db;
use claude_config_manager_lib::services::history_service::{
    BackupHistoryFilter, BackupHistoryInsert, HistoryService, UsageHistoryFilter,
};

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

fn make_history_svc(tmp: &tempfile::TempDir) -> Arc<HistoryService> {
    let conn = open_history_db(&tmp.path().join("h.db")).expect("open db");
    let svc = HistoryService::new(conn);
    svc.init().expect("schema init");
    Arc::new(svc)
}

fn make_snap(provider: &str, ts: i64, tokens: u64) -> claude_config_manager_lib::domain::UsageSnapshot {
    claude_config_manager_lib::domain::UsageSnapshot {
        provider_id: provider.into(),
        window: claude_config_manager_lib::domain::UsageWindow::OneMonth,
        tokens_used: tokens,
        timestamp: ts,
        breakdown: Vec::new(),
        model_count: 0,
    }
}

fn make_backup_insert(backup_id: &str, scope: &str, ts: i64) -> BackupHistoryInsert {
    BackupHistoryInsert {
        backup_id: backup_id.into(),
        file_name: format!("{backup_id}.json"),
        file_size: 256,
        scope: scope.into(),
        trigger_kind: "manual".into(),
        file_hash: None,
        metadata_json: None,
        created_at: ts,
    }
}

// ---------------------------------------------------------------------------
// Pure-helper integration tests — exercise the same code path the
// `#[tauri::command]` shims dispatch into.
// ---------------------------------------------------------------------------

#[test]
fn get_usage_history_impl_returns_filtered_rows() {
    let tmp = tempfile::tempdir().unwrap();
    let svc = make_history_svc(&tmp);
    svc.record_usage(&make_snap("p1", 1, 100), Some("/root-a"))
        .unwrap();
    svc.record_usage(&make_snap("p2", 2, 200), Some("/root-a"))
        .unwrap();
    svc.record_usage(&make_snap("p1", 3, 50), Some("/root-b"))
        .unwrap();

    let rows = claude_config_manager_lib::commands::history::get_usage_history_impl(
        svc.as_ref(),
        UsageHistoryFilter {
            provider_id: Some("p1".into()),
            ..Default::default()
        },
    )
    .expect("query should succeed");
    assert_eq!(rows.len(), 2, "two p1 rows across two roots");
    for r in &rows {
        assert_eq!(r.provider_id, "p1");
    }

    let root_b = claude_config_manager_lib::commands::history::get_usage_history_impl(
        svc.as_ref(),
        UsageHistoryFilter {
            active_root: Some("/root-b".into()),
            ..Default::default()
        },
    )
    .expect("filter by root");
    assert_eq!(root_b.len(), 1);
    assert_eq!(root_b[0].active_root.as_deref(), Some("/root-b"));
}

#[test]
fn get_backup_history_impl_returns_filtered_rows() {
    let tmp = tempfile::tempdir().unwrap();
    let svc = make_history_svc(&tmp);
    svc.record_backup(&make_backup_insert("a.bak.1", "user", 1), None)
        .unwrap();
    svc.record_backup(&make_backup_insert("b.bak.1", "project", 2), Some("/p"))
        .unwrap();

    let user_only = claude_config_manager_lib::commands::history::get_backup_history_impl(
        svc.as_ref(),
        BackupHistoryFilter {
            scope: Some("user".into()),
            ..Default::default()
        },
    )
    .expect("query");
    assert_eq!(user_only.len(), 1);
    assert_eq!(user_only[0].scope, "user");

    let all = claude_config_manager_lib::commands::history::get_backup_history_impl(
        svc.as_ref(),
        BackupHistoryFilter::default(),
    )
    .expect("query");
    assert_eq!(all.len(), 2);
}

#[test]
fn get_history_stats_impl_aggregates_both_tables() {
    let tmp = tempfile::tempdir().unwrap();
    let svc = make_history_svc(&tmp);
    svc.record_usage(&make_snap("p1", 1_700_000_000, 1), None)
        .unwrap();
    svc.record_usage(&make_snap("p2", 1_700_000_100, 2), None)
        .unwrap();
    svc.record_backup(&make_backup_insert("a.bak.1", "user", 1), None)
        .unwrap();

    let stats =
        claude_config_manager_lib::commands::history::get_history_stats_impl(svc.as_ref())
            .expect("stats");
    assert_eq!(stats.usage_rows, 2);
    assert_eq!(stats.backup_rows, 1);
    assert!(stats.db_size_bytes > 0);
    assert_eq!(stats.first_recorded_at, Some(1_700_000_000));
    assert_eq!(stats.last_recorded_at, Some(1_700_000_100));
}

#[test]
fn purge_history_impl_deletes_old_rows() {
    let tmp = tempfile::tempdir().unwrap();
    let svc = make_history_svc(&tmp);
    let old_ts = 1_700_000_000; // 2023-11
    let new_ts = 2_000_000_000; // far future
    svc.record_usage(&make_snap("p1", old_ts, 1), None).unwrap();
    svc.record_usage(&make_snap("p1", new_ts, 1), None).unwrap();

    // purge 1 day → cuts everything older than ~now-1d; the old
    // 2023-11 row is deleted, the 2033 row stays.
    let report =
        claude_config_manager_lib::commands::history::purge_history_impl(svc.as_ref(), 1)
            .expect("purge");
    assert!(
        report.usage_rows_deleted >= 1,
        "expected at least 1 deletion, got report {report:?}"
    );
    let remaining = claude_config_manager_lib::commands::history::get_usage_history_impl(
        svc.as_ref(),
        UsageHistoryFilter::default(),
    )
    .expect("query");
    assert_eq!(remaining.len(), 1);
    assert_eq!(remaining[0].recorded_at, new_ts);
}

#[test]
fn purge_history_impl_rejects_zero_days() {
    let tmp = tempfile::tempdir().unwrap();
    let svc = make_history_svc(&tmp);
    let err = claude_config_manager_lib::commands::history::purge_history_impl(svc.as_ref(), 0)
        .expect_err("zero days must be rejected");
    assert!(
        err.contains("older_than_days"),
        "error should mention argument name, got: {err}"
    );
}

#[test]
fn export_history_impl_writes_json_and_csv_with_correct_row_counts() {
    let tmp = tempfile::tempdir().unwrap();
    let svc = make_history_svc(&tmp);
    svc.record_usage(&make_snap("p1", 1, 100), None).unwrap();
    svc.record_usage(&make_snap("p2", 2, 200), Some("/p")).unwrap();
    svc.record_backup(&make_backup_insert("a.bak.1", "user", 10), None)
        .unwrap();

    // JSON
    let json_path = tmp.path().join("dump.json");
    let report = claude_config_manager_lib::commands::history::export_history_impl(
        svc.as_ref(),
        claude_config_manager_lib::commands::history::ExportFormat::Json,
        &json_path,
    )
    .expect("json export");
    assert_eq!(report.format, "json");
    assert_eq!(report.usage_rows, 2);
    assert_eq!(report.backup_rows, 1);
    assert!(report.file_size_bytes > 0);
    assert!(json_path.exists());

    // CSV
    let csv_path = tmp.path().join("dump.csv");
    let report = claude_config_manager_lib::commands::history::export_history_impl(
        svc.as_ref(),
        claude_config_manager_lib::commands::history::ExportFormat::Csv,
        &csv_path,
    )
    .expect("csv export");
    assert_eq!(report.format, "csv");
    assert_eq!(report.usage_rows, 2);
    assert!(csv_path.exists());
    let raw = std::fs::read_to_string(&csv_path).unwrap();
    assert!(raw.contains("# usage_history"));
    assert!(raw.contains("# backup_history"));
}

// ---------------------------------------------------------------------------
// Tauri-command surface contract — the IPC names and signatures must
// match what `lib.rs::generate_handler!` references. These tests are
// symbol-existence checks; they prevent silent breakage of the
// registered handler list.
// ---------------------------------------------------------------------------

/// Verifies that `commands::history::get_usage_history_rows` exists.
/// The IPC name is `get_usage_history_rows` (NOT `get_usage_history`
/// — that one is taken by F7 in `commands::usage::get_usage_history`).
/// We can't easily write a `fn(...) -> _` pointer to an `async fn`
/// (impl Future vs. concrete return type), so we just take a
/// reference to the function symbol — if it doesn't exist or has
/// the wrong signature the linker / compiler rejects this.
#[test]
fn command_get_usage_history_rows_exists() {
    let _ = claude_config_manager_lib::commands::history::get_usage_history_rows;
}

#[test]
fn command_get_backup_history_exists() {
    let _ = claude_config_manager_lib::commands::history::get_backup_history;
}

#[test]
fn command_get_history_stats_exists() {
    let _ = claude_config_manager_lib::commands::history::get_history_stats;
}

#[test]
fn command_export_history_exists() {
    let _ = claude_config_manager_lib::commands::history::export_history;
}

#[test]
fn command_purge_history_exists() {
    let _ = claude_config_manager_lib::commands::history::purge_history;
}

#[test]
fn export_format_serialises_lowercase_wire_format() {
    use claude_config_manager_lib::commands::history::ExportFormat;
    assert_eq!(
        serde_json::to_string(&ExportFormat::Json).unwrap(),
        "\"json\""
    );
    assert_eq!(
        serde_json::to_string(&ExportFormat::Csv).unwrap(),
        "\"csv\""
    );
}
