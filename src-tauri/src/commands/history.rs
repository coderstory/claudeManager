//! Tauri commands for M4.6 / Phase 21 — history page (L1).
//!
//! Each `#[tauri::command]` is a thin wrapper around a pure
//! `*_impl` helper that takes `&HistoryService` directly. The split
//! exists so that:
//!
//! - Services stay platform-independent and unit-testable (see
//!   `crate::services::history_service::tests`).
//! - Tauri commands own the `State<'_, AppState>` extraction + error
//!   stringification (Tauri's IPC requires `Result<T, String>` for
//!   cross-thread invocation).
//! - The pure helpers are directly callable from integration tests
//!   in `tests/history_commands.rs` — the test project has no
//!   `tauri::test` feature enabled, so we cannot construct a real
//!   `State<AppState>` in tests; the pure helpers are the
//!   testable surface.
//!
//! ## Frontend contract
//!
//! Frontend calls these via `invoke<T>(name, args)` from the
//! future `src/lib/api/history.ts` (Plan C). Field names use
//! snake_case to match the Rust `serde(rename_all = "snake_case")`
//! on the row / report DTOs.
//!
//! ## M4.6 / Phase 21 commands (Plan B)
//!
//! - `get_usage_history(filter)` — rows from `usage_history`.
//! - `get_backup_history(filter)` — rows from `backup_history`.
//! - `get_history_stats()` — aggregate counters.
//! - `export_history(format, target_path)` — write JSON / CSV to disk.
//! - `purge_history(older_than_days)` — delete rows older than N days.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::app_state::AppState;
use crate::services::history_service::{
    BackupHistoryFilter, BackupHistoryRow, HistoryService, HistoryStats, PurgeReport,
    UsageHistoryFilter, UsageHistoryRow,
};

/// `Result<T, String>` — Tauri IPC's preferred error type. The `String`
/// is the user-visible message (SPEC §6.5).
type CmdResult<T> = Result<T, String>;

// ---------------------------------------------------------------------------
// Export format DTO (Plan B wire contract)
// ---------------------------------------------------------------------------

/// Export format accepted by `export_history`. Wire form is a
/// lowercase string (`"json"` / `"csv"`); the enum gives the
/// frontend a typed call site.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ExportFormat {
    Json,
    Csv,
}

impl ExportFormat {
    /// Parse from a free-form string. `None` for unknown values
    /// (mirrors `UsageWindow::from_str` for F7).
    pub fn from_str(s: &str) -> Option<Self> {
        match s.to_ascii_lowercase().as_str() {
            "json" => Some(Self::Json),
            "csv" => Some(Self::Csv),
            _ => None,
        }
    }
}

/// Report returned by `export_history`. Mirrors the shape used by
/// other export commands (`export_provider`, `export_optimization_report`).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub struct ExportReport {
    /// Resolved absolute path the export was written to. The frontend
    /// shows this so the user knows where the file landed.
    pub output_path: String,
    /// `"json"` / `"csv"` — mirrors the requested format.
    pub format: String,
    /// Number of `usage_history` rows included.
    pub usage_rows: i64,
    /// Number of `backup_history` rows included.
    pub backup_rows: i64,
    /// Total file size in bytes on disk (post-write).
    pub file_size_bytes: u64,
}

// ---------------------------------------------------------------------------
// Pure helpers — the testable surface (no Tauri runtime needed).
// Each command's body is a 2-line shim: state lookup + helper call.
// ---------------------------------------------------------------------------

/// `get_usage_history` implementation — no Tauri State.
pub fn get_usage_history_impl(
    svc: &HistoryService,
    filter: UsageHistoryFilter,
) -> Result<Vec<UsageHistoryRow>, String> {
    svc.query_usage(&filter).map_err(|e| e.to_string())
}

/// `get_backup_history` implementation.
pub fn get_backup_history_impl(
    svc: &HistoryService,
    filter: BackupHistoryFilter,
) -> Result<Vec<BackupHistoryRow>, String> {
    svc.query_backup(&filter).map_err(|e| e.to_string())
}

/// `get_history_stats` implementation.
pub fn get_history_stats_impl(svc: &HistoryService) -> Result<HistoryStats, String> {
    svc.stats().map_err(|e| e.to_string())
}

/// `purge_history` implementation.
pub fn purge_history_impl(
    svc: &HistoryService,
    older_than_days: u32,
) -> Result<PurgeReport, String> {
    svc.purge(older_than_days).map_err(|e| e.to_string())
}

/// `export_history` implementation — writes a JSON or CSV dump of
/// both history tables to `target_path`. Pure helper: no Tauri State,
/// the caller passes the resolved `&HistoryService` and target path.
///
/// Returns `ExportReport` with the resolved output path + row counts.
/// On I/O failure the helper returns an `Err(String)` (CLAUDE.md §7:
/// never silent).
pub fn export_history_impl(
    svc: &HistoryService,
    format: ExportFormat,
    target_path: &Path,
) -> Result<ExportReport, String> {
    // Pull every row in both tables. We deliberately do NOT apply
    // the `default` 1000-row limit — an export must be complete or
    // it's misleading. The query path uses the service's own
    // limit-clamping (10k max) for safety.
    let usage = svc
        .query_usage(&UsageHistoryFilter {
            limit: Some(10_000),
            ..Default::default()
        })
        .map_err(|e| format!("query_usage failed: {e}"))?;
    let backup = svc
        .query_backup(&BackupHistoryFilter {
            limit: Some(10_000),
            ..Default::default()
        })
        .map_err(|e| format!("query_backup failed: {e}"))?;

    let payload = match format {
        ExportFormat::Json => serde_json::to_string_pretty(&serde_json::json!({
            "exported_at_unix": now_unix_secs(),
            "usage_history": usage,
            "backup_history": backup,
        }))
        .map_err(|e| format!("serialize JSON: {e}"))?,
        ExportFormat::Csv => render_csv(&usage, &backup),
    };

    // Ensure parent dir exists — the caller may pass a brand new
    // path chosen in a Save dialog. If the parent is empty (relative
    // path with no parent), best-effort create_dir_all is a no-op.
    if let Some(parent) = target_path.parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("create parent dir {}: {e}", parent.display()))?;
        }
    }

    // Atomic write: write to a sibling `.partial` then rename.
    // Mirrors the pattern in `infrastructure::fs_atomic` but we
    // don't pull that dep into commands — the partial+rename dance
    // is 6 lines, not worth a dep.
    let partial: PathBuf = {
        let mut p = target_path.as_os_str().to_owned();
        p.push(".partial");
        PathBuf::from(p)
    };
    std::fs::write(&partial, payload.as_bytes())
        .map_err(|e| format!("write {}: {e}", partial.display()))?;
    std::fs::rename(&partial, target_path)
        .map_err(|e| format!("rename to {}: {e}", target_path.display()))?;

    let file_size_bytes = std::fs::metadata(target_path)
        .map(|m| m.len())
        .unwrap_or(payload.len() as u64);

    Ok(ExportReport {
        output_path: target_path.to_string_lossy().into_owned(),
        format: match format {
            ExportFormat::Json => "json".into(),
            ExportFormat::Csv => "csv".into(),
        },
        usage_rows: usage.len() as i64,
        backup_rows: backup.len() as i64,
        file_size_bytes,
    })
}

/// Render a 2-table CSV dump. The format is two stacked sections,
/// each prefixed by a comment line (`# section`) and a header row.
/// Excel-compatible: no BOM, CRLF line endings.
fn render_csv(usage: &[UsageHistoryRow], backup: &[BackupHistoryRow]) -> String {
    use std::fmt::Write;
    let mut out = String::new();
    let _ = writeln!(out, "# usage_history");
    let _ = writeln!(
        out,
        "id,snapshot_id,provider_id,provider_name,window,used_pct,reset_at,recorded_at,active_root"
    );
    for r in usage {
        // CSV escaping: if the field contains comma / quote / newline,
        // wrap in quotes and double inner quotes. None of the row
        // fields are user-supplied strings except `active_root` and
        // `provider_id` / `provider_name` — be defensive anyway.
        let _ = writeln!(
            out,
            "{},{},{},{},{},{},{},{},{}",
            r.id,
            csv_field(&r.snapshot_id),
            csv_field(&r.provider_id),
            csv_field(&r.provider_name),
            csv_field(&r.window),
            r.used_pct,
            r.reset_at
                .map(|v| v.to_string())
                .unwrap_or_else(|| "".into()),
            r.recorded_at,
            r.active_root
                .as_deref()
                .map(csv_field)
                .unwrap_or_else(|| "".into()),
        );
    }
    let _ = writeln!(out);
    let _ = writeln!(out, "# backup_history");
    let _ = writeln!(
        out,
        "id,backup_id,file_name,file_size,scope,active_root,trigger_kind,file_hash,created_at"
    );
    for r in backup {
        let _ = writeln!(
            out,
            "{},{},{},{},{},{},{},{},{}",
            r.id,
            csv_field(&r.backup_id),
            csv_field(&r.file_name),
            r.file_size,
            csv_field(&r.scope),
            r.active_root
                .as_deref()
                .map(csv_field)
                .unwrap_or_else(|| "".into()),
            csv_field(&r.trigger_kind),
            r.file_hash
                .as_deref()
                .map(csv_field)
                .unwrap_or_else(|| "".into()),
            r.created_at,
        );
    }
    out
}

/// Quote a CSV field if it contains a comma, quote, or newline.
fn csv_field(s: &str) -> String {
    if s.contains(',') || s.contains('"') || s.contains('\n') {
        let escaped = s.replace('"', "\"\"");
        format!("\"{escaped}\"")
    } else {
        s.to_string()
    }
}

fn now_unix_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

// ---------------------------------------------------------------------------
// Tauri commands — 2-line shims that extract `&HistoryService` from
// `State<AppState>` and delegate to the helpers above. The macro
// requires `pub async fn` with `State<'_, AppState>` as the first
// arg; Tauri will reject anything else.
// ---------------------------------------------------------------------------

/// F21 / Phase 21 — read usage_history rows.
///
/// IPC name: `get_usage_history_rows` — disambiguates from the F7
/// `get_usage_history` command (`commands::usage::get_usage_history`,
/// window-string filter, returns `UsageHistoryEntry`). This one
/// takes a `UsageHistoryFilter` and returns `UsageHistoryRow`s
/// (SQLite-backed, M4.6). The distinct IPC name is required because
/// Tauri's `generate_handler!` rejects duplicate command names.
#[tauri::command]
pub async fn get_usage_history_rows(
    state: State<'_, AppState>,
    filter: UsageHistoryFilter,
) -> CmdResult<Vec<UsageHistoryRow>> {
    get_usage_history_impl(state.history_service.as_ref(), filter)
}

/// F21 / Phase 21 — read backup_history rows.
#[tauri::command]
pub async fn get_backup_history(
    state: State<'_, AppState>,
    filter: BackupHistoryFilter,
) -> CmdResult<Vec<BackupHistoryRow>> {
    get_backup_history_impl(state.history_service.as_ref(), filter)
}

/// F21 / Phase 21 — aggregate counters + db size.
#[tauri::command]
pub async fn get_history_stats(state: State<'_, AppState>) -> CmdResult<HistoryStats> {
    get_history_stats_impl(state.history_service.as_ref())
}

/// F21 / Phase 21 — export both history tables to a JSON or CSV file.
///
/// `target_path` is the resolved absolute path chosen by the
/// frontend (typically via `dialog:allow-save`). The command does
/// NOT pop a save dialog itself — that's a frontend concern.
#[tauri::command]
pub async fn export_history(
    state: State<'_, AppState>,
    format: ExportFormat,
    target_path: String,
) -> CmdResult<ExportReport> {
    export_history_impl(
        state.history_service.as_ref(),
        format,
        Path::new(&target_path),
    )
}

/// F21 / Phase 21 — delete rows older than `older_than_days`.
#[tauri::command]
pub async fn purge_history(
    state: State<'_, AppState>,
    older_than_days: u32,
) -> CmdResult<PurgeReport> {
    purge_history_impl(state.history_service.as_ref(), older_than_days)
}

// ---------------------------------------------------------------------------
// Tests — pin the command contract (signatures, error stringification,
// ExportFormat parsing, ExportReport shape).
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infrastructure::sqlite::history_db::open_history_db;
    use crate::services::history_service::BackupHistoryInsert;
    use tempfile::TempDir;

    /// Open a fresh in-memory-ish service for unit tests.
    fn open_svc() -> (TempDir, std::sync::Arc<HistoryService>) {
        let tmp = TempDir::new().unwrap();
        let conn = open_history_db(&tmp.path().join("h.db")).unwrap();
        let svc = HistoryService::new(conn);
        svc.init().unwrap();
        (tmp, std::sync::Arc::new(svc))
    }

    #[test]
    fn export_format_parses_lowercase() {
        assert_eq!(ExportFormat::from_str("json"), Some(ExportFormat::Json));
        assert_eq!(ExportFormat::from_str("csv"), Some(ExportFormat::Csv));
    }

    #[test]
    fn export_format_rejects_unknown() {
        assert_eq!(ExportFormat::from_str("JSON"), Some(ExportFormat::Json)); // ascii_lowercase
        assert_eq!(ExportFormat::from_str("xml"), None);
        assert_eq!(ExportFormat::from_str(""), None);
    }

    #[test]
    fn get_usage_history_impl_round_trips_recorded_rows() {
        let (_tmp, svc) = open_svc();
        let snap = crate::domain::UsageSnapshot {
            provider_id: "p1".into(),
            window: crate::domain::UsageWindow::OneMonth,
            tokens_used: 100,
            cost_usd: None,
            balance_usd: None,
            timestamp: 1_700_000_000,
            breakdown: Vec::new(),
            model_count: 0,
        };
        svc.record_usage(&snap, Some("/root-a")).unwrap();

        let rows = get_usage_history_impl(svc.as_ref(), UsageHistoryFilter::default()).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].provider_id, "p1");
        assert_eq!(rows[0].active_root.as_deref(), Some("/root-a"));
    }

    #[test]
    fn get_backup_history_impl_filters_by_scope() {
        let (_tmp, svc) = open_svc();
        svc.record_backup(
            &BackupHistoryInsert {
                backup_id: "u.bak.1".into(),
                file_name: "u.bak.1".into(),
                file_size: 100,
                scope: "user".into(),
                trigger_kind: "manual".into(),
                file_hash: None,
                metadata_json: None,
                created_at: 1,
            },
            None,
        )
        .unwrap();
        svc.record_backup(
            &BackupHistoryInsert {
                backup_id: "p.bak.1".into(),
                file_name: "p.bak.1".into(),
                file_size: 200,
                scope: "project".into(),
                trigger_kind: "manual".into(),
                file_hash: None,
                metadata_json: None,
                created_at: 2,
            },
            Some("/proj"),
        )
        .unwrap();

        let user_only = get_backup_history_impl(
            svc.as_ref(),
            BackupHistoryFilter {
                scope: Some("user".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(user_only.len(), 1);
        assert_eq!(user_only[0].backup_id, "u.bak.1");

        let project_only = get_backup_history_impl(
            svc.as_ref(),
            BackupHistoryFilter {
                scope: Some("project".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(project_only.len(), 1);
        assert_eq!(project_only[0].backup_id, "p.bak.1");
    }

    #[test]
    fn get_history_stats_impl_reports_zero_for_empty_db() {
        let (_tmp, svc) = open_svc();
        let stats = get_history_stats_impl(svc.as_ref()).unwrap();
        assert_eq!(stats.usage_rows, 0);
        assert_eq!(stats.backup_rows, 0);
        assert!(stats.db_size_bytes > 0, "even empty db has page overhead");
        assert!(stats.first_recorded_at.is_none());
        assert!(stats.last_recorded_at.is_none());
    }

    #[test]
    fn purge_history_impl_rejects_zero_days() {
        let (_tmp, svc) = open_svc();
        let err = purge_history_impl(svc.as_ref(), 0).unwrap_err();
        assert!(
            err.contains("older_than_days"),
            "error should mention argument name, got: {err}"
        );
    }

    #[test]
    fn export_history_impl_writes_json_with_both_tables() {
        let (tmp, svc) = open_svc();
        let snap = crate::domain::UsageSnapshot {
            provider_id: "p1".into(),
            window: crate::domain::UsageWindow::OneMonth,
            tokens_used: 50,
            cost_usd: None,
            balance_usd: None,
            timestamp: 1_700_000_000,
            breakdown: Vec::new(),
            model_count: 0,
        };
        svc.record_usage(&snap, None).unwrap();
        svc.record_backup(
            &BackupHistoryInsert {
                backup_id: "x.bak.1".into(),
                file_name: "x.bak.1".into(),
                file_size: 10,
                scope: "user".into(),
                trigger_kind: "manual".into(),
                file_hash: None,
                metadata_json: None,
                created_at: 1,
            },
            None,
        )
        .unwrap();

        let target = tmp.path().join("export.json");
        let report = export_history_impl(svc.as_ref(), ExportFormat::Json, &target).unwrap();
        assert_eq!(report.format, "json");
        assert_eq!(report.usage_rows, 1);
        assert_eq!(report.backup_rows, 1);
        assert!(report.file_size_bytes > 0);
        assert!(target.exists());
        // No leftover .partial sibling.
        let mut leftover = target.as_os_str().to_owned();
        leftover.push(".partial");
        assert!(
            !std::path::PathBuf::from(&leftover).exists(),
            "atomic rename must not leave .partial"
        );

        // Sanity: the file parses as JSON and contains both keys.
        let raw = std::fs::read_to_string(&target).unwrap();
        let v: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert!(v["usage_history"].is_array());
        assert!(v["backup_history"].is_array());
        assert_eq!(v["usage_history"].as_array().unwrap().len(), 1);
        assert_eq!(v["backup_history"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn export_history_impl_writes_csv_with_headers() {
        let (tmp, svc) = open_svc();
        let snap = crate::domain::UsageSnapshot {
            provider_id: "p1".into(),
            window: crate::domain::UsageWindow::OneMonth,
            tokens_used: 50,
            cost_usd: None,
            balance_usd: None,
            timestamp: 1_700_000_000,
            breakdown: Vec::new(),
            model_count: 0,
        };
        svc.record_usage(&snap, None).unwrap();

        let target = tmp.path().join("export.csv");
        let report = export_history_impl(svc.as_ref(), ExportFormat::Csv, &target).unwrap();
        assert_eq!(report.format, "csv");
        assert_eq!(report.usage_rows, 1);
        assert_eq!(report.backup_rows, 0);
        let raw = std::fs::read_to_string(&target).unwrap();
        // Section markers + headers.
        assert!(raw.contains("# usage_history"));
        assert!(raw.contains("# backup_history"));
        assert!(raw.contains("snapshot_id,provider_id"));
        assert!(raw.contains("backup_id,file_name"));
    }

    #[test]
    fn csv_field_quotes_commas_and_quotes() {
        assert_eq!(csv_field("plain"), "plain");
        assert_eq!(csv_field("a,b"), "\"a,b\"");
        assert_eq!(csv_field("a\"b"), "\"a\"\"b\"");
        assert_eq!(csv_field("a\nb"), "\"a\nb\"");
    }

    // -----------------------------------------------------------------------
    // Signature pinning — compile-time check that the `#[tauri::command]`
    // surface matches the contract documented in PLAN.md §Plan B.
    // -----------------------------------------------------------------------

    /// Compile-time check: `get_usage_history_rows` signature.
    #[allow(dead_code)]
    fn _get_usage_history_rows_signature(
        s: State<'_, AppState>,
        filter: UsageHistoryFilter,
    ) -> CmdResult<Vec<UsageHistoryRow>> {
        let _ = (s, filter);
        unimplemented!()
    }

    /// Compile-time check: `get_backup_history` signature.
    #[allow(dead_code)]
    fn _get_backup_history_signature(
        s: State<'_, AppState>,
        filter: BackupHistoryFilter,
    ) -> CmdResult<Vec<BackupHistoryRow>> {
        let _ = (s, filter);
        unimplemented!()
    }

    /// Compile-time check: `get_history_stats` signature.
    #[allow(dead_code)]
    fn _get_history_stats_signature(s: State<'_, AppState>) -> CmdResult<HistoryStats> {
        let _ = s;
        unimplemented!()
    }

    /// Compile-time check: `export_history` signature.
    #[allow(dead_code)]
    fn _export_history_signature(
        s: State<'_, AppState>,
        format: ExportFormat,
        target_path: String,
    ) -> CmdResult<ExportReport> {
        let _ = (s, format, target_path);
        unimplemented!()
    }

    /// Compile-time check: `purge_history` signature.
    #[allow(dead_code)]
    fn _purge_history_signature(
        s: State<'_, AppState>,
        older_than_days: u32,
    ) -> CmdResult<PurgeReport> {
        let _ = (s, older_than_days);
        unimplemented!()
    }
}
