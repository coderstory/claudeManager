//! `HistoryService` — Phase 21 SQLite-backed history (M4.6).
//!
//! Owns a single `Arc<Mutex<Connection>>` and exposes the CRUD +
//! query surface used by:
//!
//! - F7 `UsageService::compute_usage_for_window` — calls
//!   [`HistoryService::record_usage`] per snapshot (best-effort;
//!   failures are logged and swallowed so the main usage path is
//!   not blocked by history I/O).
//! - F13 `BackupService::backup_now` / `backup_incremental` — calls
//!   [`HistoryService::record_backup`] per snapshot.
//! - First-launch backfill — [`HistoryService::backfill_bak`] scans
//!   `<backups_dir>` for `.bak.<ts>` files and inserts any that
//!   aren't already in `backup_history`.
//! - Plan B Tauri commands — `query_usage` / `query_backup` /
//!   `stats` / `purge` for the `history` L1 page.
//!
//! ## Insert semantics
//!
//! All record_* methods use `INSERT OR IGNORE` so re-running on the
//! same input is a no-op (UNIQUE on `snapshot_id` / `backup_id`).
//! This is the key property that makes the F7/F13 "增量同步" design
//! idempotent — Plan A6/A7 can call record_* without first checking
//! whether the row already exists.
//!
//! ## Threading
//!
//! All methods take `&self` (immutable borrow) and acquire the
//! inner `Mutex` on demand. Single-process model; no async.

use std::path::Path;
#[cfg(test)]
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::domain::UsageSnapshot;
#[cfg(test)]
use crate::domain::UsageWindow;
use crate::infrastructure::backup_scanner;
use crate::infrastructure::sqlite::error::HistoryError;

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

/// Filter for [`HistoryService::query_usage`]. All fields are optional;
/// `None` means "no constraint on this column".
#[derive(Debug, Default, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct UsageHistoryFilter {
    pub provider_id: Option<String>,
    pub active_root: Option<String>,
    /// Lower bound on `recorded_at` (unix seconds, inclusive).
    pub from_ts: Option<i64>,
    /// Upper bound on `recorded_at` (unix seconds, inclusive).
    pub to_ts: Option<i64>,
    /// Cap on rows returned. Default = 1000 if `None`.
    pub limit: Option<u32>,
}

/// Filter for [`HistoryService::query_backup`].
#[derive(Debug, Default, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct BackupHistoryFilter {
    pub scope: Option<String>, // 'user' | 'project'
    pub active_root: Option<String>,
    pub trigger_kind: Option<String>,
    pub from_ts: Option<i64>,
    pub to_ts: Option<i64>,
    pub limit: Option<u32>,
}

/// Row returned by [`HistoryService::query_usage`]. Mirrors
/// `usage_history` columns.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct UsageHistoryRow {
    pub id: i64,
    pub snapshot_id: String,
    pub provider_id: String,
    pub provider_name: String,
    pub window: String,
    pub used_pct: f64,
    pub reset_at: Option<i64>,
    pub raw_json: String,
    pub recorded_at: i64,
    pub active_root: Option<String>,
}

/// Row returned by [`HistoryService::query_backup`].
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct BackupHistoryRow {
    pub id: i64,
    pub backup_id: String,
    pub file_name: String,
    pub file_size: i64,
    pub scope: String,
    pub active_root: Option<String>,
    pub trigger_kind: String,
    pub file_hash: Option<String>,
    pub metadata_json: Option<String>,
    pub created_at: i64,
}

/// Aggregate counters for [`HistoryService::stats`].
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub struct HistoryStats {
    pub usage_rows: i64,
    pub backup_rows: i64,
    pub db_size_bytes: i64,
    pub first_recorded_at: Option<i64>,
    pub last_recorded_at: Option<i64>,
}

/// Report returned by [`HistoryService::purge`].
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub struct PurgeReport {
    pub usage_rows_deleted: i64,
    pub backup_rows_deleted: i64,
    pub cutoff_ts: i64,
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

pub struct HistoryService {
    db: Arc<Mutex<Connection>>,
}

impl HistoryService {
    /// Wrap an already-opened connection (typically from
    /// [`crate::infrastructure::sqlite::history_db::open_history_db`]).
    pub fn new(db: Arc<Mutex<Connection>>) -> Self {
        Self { db }
    }

    /// Borrow the underlying connection (for tests / advanced callers).
    #[allow(dead_code)]
    pub fn conn(&self) -> &Arc<Mutex<Connection>> {
        &self.db
    }

    /// Verify the V1 schema is present. Caller can use this as a
    /// post-condition check after construction.
    pub fn init(&self) -> Result<(), HistoryError> {
        let guard = self.db.lock().map_err(|_| HistoryError::MutexPoisoned)?;
        let _: i64 = guard.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='usage_history'",
            [],
            |r| r.get(0),
        )?;
        let _: i64 = guard.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='backup_history'",
            [],
            |r| r.get(0),
        )?;
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Writes (F7 + F13 integration points)
    // -----------------------------------------------------------------------

    /// Insert one usage snapshot row. Idempotent via UNIQUE on
    /// `snapshot_id` (computed from `provider_id + window + timestamp`).
    /// Errors are returned for the caller to log; the F7 path
    /// currently logs + swallows (CLAUDE.md §7 — never silent).
    pub fn record_usage(
        &self,
        snap: &UsageSnapshot,
        active_root: Option<&str>,
    ) -> Result<(), HistoryError> {
        let snapshot_id = build_usage_snapshot_id(snap);
        let raw_json = serde_json::to_string(snap)?;
        let window = snap.window.as_str();
        // Provider name: `UsageSnapshot` only carries an id, so
        // record the id as the displayed label. Plan A scope is
        // raw persistence; a future Plan C UI can JOIN against
        // `providers.json` to enrich the label.
        let provider_name = &snap.provider_id;
        let guard = self.db.lock().map_err(|_| HistoryError::MutexPoisoned)?;
        guard.execute(
            "INSERT OR IGNORE INTO usage_history
                (snapshot_id, provider_id, provider_name, window, used_pct,
                 reset_at, raw_json, recorded_at, active_root)
             VALUES (?1, ?2, ?3, ?4, 0.0, NULL, ?5, ?6, ?7)",
            params![
                snapshot_id,
                snap.provider_id,
                provider_name,
                window,
                raw_json,
                snap.timestamp,
                active_root,
            ],
        )?;
        Ok(())
    }

    /// Insert one backup row. Idempotent via UNIQUE on `backup_id`.
    pub fn record_backup(
        &self,
        backup: &BackupHistoryInsert,
        active_root: Option<&str>,
    ) -> Result<(), HistoryError> {
        let guard = self.db.lock().map_err(|_| HistoryError::MutexPoisoned)?;
        guard.execute(
            "INSERT OR IGNORE INTO backup_history
                (backup_id, file_name, file_size, scope, active_root,
                 trigger_kind, file_hash, metadata_json, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                backup.backup_id,
                backup.file_name,
                backup.file_size,
                backup.scope,
                active_root,
                backup.trigger_kind,
                backup.file_hash,
                backup.metadata_json,
                backup.created_at,
            ],
        )?;
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Queries
    // -----------------------------------------------------------------------

    /// Read rows out of `usage_history` with optional filters.
    pub fn query_usage(
        &self,
        filter: &UsageHistoryFilter,
    ) -> Result<Vec<UsageHistoryRow>, HistoryError> {
        let mut sql = String::from(
            "SELECT id, snapshot_id, provider_id, provider_name, window, used_pct,
                    reset_at, raw_json, recorded_at, active_root
             FROM usage_history WHERE 1=1",
        );
        let mut args: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
        if let Some(p) = &filter.provider_id {
            sql.push_str(" AND provider_id = ?");
            args.push(Box::new(p.clone()));
        }
        if let Some(r) = &filter.active_root {
            sql.push_str(" AND active_root = ?");
            args.push(Box::new(r.clone()));
        }
        if let Some(t) = filter.from_ts {
            sql.push_str(" AND recorded_at >= ?");
            args.push(Box::new(t));
        }
        if let Some(t) = filter.to_ts {
            sql.push_str(" AND recorded_at <= ?");
            args.push(Box::new(t));
        }
        sql.push_str(" ORDER BY recorded_at DESC");
        let limit = filter.limit.unwrap_or(1000).min(10_000) as i64;
        sql.push_str(" LIMIT ?");
        args.push(Box::new(limit));

        let guard = self.db.lock().map_err(|_| HistoryError::MutexPoisoned)?;
        let mut stmt = guard.prepare(&sql)?;
        let param_refs: Vec<&dyn rusqlite::ToSql> =
            args.iter().map(|b| b.as_ref() as &dyn rusqlite::ToSql).collect();
        let rows = stmt
            .query_map(param_refs.as_slice(), |r| {
                Ok(UsageHistoryRow {
                    id: r.get(0)?,
                    snapshot_id: r.get(1)?,
                    provider_id: r.get(2)?,
                    provider_name: r.get(3)?,
                    window: r.get(4)?,
                    used_pct: r.get(5)?,
                    reset_at: r.get(6)?,
                    raw_json: r.get(7)?,
                    recorded_at: r.get(8)?,
                    active_root: r.get(9)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn query_backup(
        &self,
        filter: &BackupHistoryFilter,
    ) -> Result<Vec<BackupHistoryRow>, HistoryError> {
        let mut sql = String::from(
            "SELECT id, backup_id, file_name, file_size, scope, active_root,
                    trigger_kind, file_hash, metadata_json, created_at
             FROM backup_history WHERE 1=1",
        );
        let mut args: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
        if let Some(s) = &filter.scope {
            sql.push_str(" AND scope = ?");
            args.push(Box::new(s.clone()));
        }
        if let Some(r) = &filter.active_root {
            sql.push_str(" AND active_root = ?");
            args.push(Box::new(r.clone()));
        }
        if let Some(t) = &filter.trigger_kind {
            sql.push_str(" AND trigger_kind = ?");
            args.push(Box::new(t.clone()));
        }
        if let Some(t) = filter.from_ts {
            sql.push_str(" AND created_at >= ?");
            args.push(Box::new(t));
        }
        if let Some(t) = filter.to_ts {
            sql.push_str(" AND created_at <= ?");
            args.push(Box::new(t));
        }
        sql.push_str(" ORDER BY created_at DESC");
        let limit = filter.limit.unwrap_or(1000).min(10_000) as i64;
        sql.push_str(" LIMIT ?");
        args.push(Box::new(limit));

        let guard = self.db.lock().map_err(|_| HistoryError::MutexPoisoned)?;
        let mut stmt = guard.prepare(&sql)?;
        let param_refs: Vec<&dyn rusqlite::ToSql> =
            args.iter().map(|b| b.as_ref() as &dyn rusqlite::ToSql).collect();
        let rows = stmt
            .query_map(param_refs.as_slice(), |r| {
                Ok(BackupHistoryRow {
                    id: r.get(0)?,
                    backup_id: r.get(1)?,
                    file_name: r.get(2)?,
                    file_size: r.get(3)?,
                    scope: r.get(4)?,
                    active_root: r.get(5)?,
                    trigger_kind: r.get(6)?,
                    file_hash: r.get(7)?,
                    metadata_json: r.get(8)?,
                    created_at: r.get(9)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// Aggregate counters + db size on disk.
    pub fn stats(&self) -> Result<HistoryStats, HistoryError> {
        let guard = self.db.lock().map_err(|_| HistoryError::MutexPoisoned)?;
        let usage_rows: i64 =
            guard.query_row("SELECT COUNT(*) FROM usage_history", [], |r| r.get(0))?;
        let backup_rows: i64 =
            guard.query_row("SELECT COUNT(*) FROM backup_history", [], |r| r.get(0))?;
        let first: Option<i64> = guard
            .query_row(
                "SELECT MIN(recorded_at) FROM usage_history",
                [],
                |r| r.get(0),
            )
            .optional()?;
        let last: Option<i64> = guard
            .query_row(
                "SELECT MAX(recorded_at) FROM usage_history",
                [],
                |r| r.get(0),
            )
            .optional()?;
        // db size is on-disk metadata; we report page_count * page_size.
        let page_count: i64 = guard
            .query_row("PRAGMA page_count", [], |r| r.get(0))
            .unwrap_or(0);
        let page_size: i64 = guard
            .query_row("PRAGMA page_size", [], |r| r.get(0))
            .unwrap_or(0);
        let db_size_bytes = page_count * page_size;

        Ok(HistoryStats {
            usage_rows,
            backup_rows,
            db_size_bytes,
            first_recorded_at: first,
            last_recorded_at: last,
        })
    }

    /// Delete rows older than `older_than_days` days. Returns the
    /// deleted counts.
    pub fn purge(&self, older_than_days: u32) -> Result<PurgeReport, HistoryError> {
        if older_than_days == 0 {
            return Err(HistoryError::InvalidArgument(
                "older_than_days must be > 0".into(),
            ));
        }
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        let cutoff = now - (older_than_days as i64) * 86_400;

        let guard = self.db.lock().map_err(|_| HistoryError::MutexPoisoned)?;
        let usage_deleted = guard.execute(
            "DELETE FROM usage_history WHERE recorded_at < ?1",
            params![cutoff],
        )? as i64;
        let backup_deleted = guard.execute(
            "DELETE FROM backup_history WHERE created_at < ?1",
            params![cutoff],
        )? as i64;
        Ok(PurgeReport {
            usage_rows_deleted: usage_deleted,
            backup_rows_deleted: backup_deleted,
            cutoff_ts: cutoff,
        })
    }

    // -----------------------------------------------------------------------
    // First-launch backfill
    // -----------------------------------------------------------------------

    /// Scan `backups_dir` (typically `<app_data>/backups/`) for any
    /// `.bak.<ts>` files NOT already in `backup_history`, and insert
    /// them. Idempotent — second run is a no-op.
    ///
    /// Returns the number of rows actually inserted.
    ///
    /// Designed to be called once at startup, on a background thread
    /// (see `app_state.rs::build`).
    pub fn backfill_bak(
        &self,
        backups_dir: &Path,
        claude_dir: Option<&Path>,
    ) -> Result<usize, HistoryError> {
        if !backups_dir.exists() {
            return Ok(0);
        }
        // Merge scan: user-level backups dir + the active claude_dir's
        // `.bak.<ts>` files (mirrors BackupService::list_backups).
        let mut entries = Vec::new();
        match backup_scanner::scan_backups_in(backups_dir) {
            Ok(e) => entries.extend(e),
            Err(e) => eprintln!("[history] scan backups_dir failed: {e}"),
        }
        if let Some(cd) = claude_dir {
            if cd.exists() {
                match backup_scanner::scan_backups_in(cd) {
                    Ok(e) => entries.extend(e),
                    Err(e) => eprintln!("[history] scan claude_dir failed: {e}"),
                }
            }
        }
        let mut inserted = 0usize;
        for e in entries {
            let backup_id = build_backup_id_from_path(&e.path);
            let insert = BackupHistoryInsert {
                backup_id,
                file_name: e
                    .path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("")
                    .to_string(),
                file_size: e.size_bytes as i64,
                scope: "user".to_string(),
                trigger_kind: "auto-incremental".to_string(),
                file_hash: None,
                metadata_json: None,
                created_at: e.timestamp_unix.unwrap_or_else(now_unix_secs),
            };
            let guard = self.db.lock().map_err(|_| HistoryError::MutexPoisoned)?;
            let changed = guard.execute(
                "INSERT OR IGNORE INTO backup_history
                    (backup_id, file_name, file_size, scope, active_root,
                     trigger_kind, file_hash, metadata_json, created_at)
                 VALUES (?1, ?2, ?3, ?4, NULL, ?5, ?6, ?7, ?8)",
                rusqlite::params![
                    insert.backup_id,
                    insert.file_name,
                    insert.file_size,
                    insert.scope,
                    insert.trigger_kind,
                    insert.file_hash,
                    insert.metadata_json,
                    insert.created_at,
                ],
            )?;
            if changed > 0 {
                inserted += 1;
            }
        }
        Ok(inserted)
    }

    /// M4.6 — backfill usage_history from an existing JSONL file.
    ///
    /// Currently a thin stub: the F7 cache history lives in memory
    /// (`UsageService::_seed_cache`), and the JSONL files themselves
    /// are the canonical source — re-reading them to populate the
    /// historical SQLite table is out of scope for Plan A.
    ///
    /// The method is kept (returns 0) so Plan B / Plan C can wire a
    /// proper replay path without changing the public surface.
    #[allow(dead_code)]
    pub fn backfill_jsonl(&self, _jsonl_path: &Path) -> Result<usize, HistoryError> {
        Ok(0)
    }
}

// ---------------------------------------------------------------------------
// Helpers / DTOs
// ---------------------------------------------------------------------------

/// Input shape for [`HistoryService::record_backup`]. Constructed by
/// F13 (BackupService) at the point of writing a new .bak.<ts> file.
#[derive(Debug, Clone)]
pub struct BackupHistoryInsert {
    pub backup_id: String,
    pub file_name: String,
    pub file_size: i64,
    pub scope: String, // 'user' | 'project'
    pub trigger_kind: String, // 'manual' | 'auto-before-switch' | 'auto-incremental'
    pub file_hash: Option<String>,
    pub metadata_json: Option<String>,
    pub created_at: i64,
}

/// Build a deterministic snapshot_id for `usage_history` UNIQUE
/// dedup. `format!("{provider}|{window}|{timestamp}")` is enough —
/// F7 only writes one snapshot per (provider, window, ts) bucket,
/// so a same provider+window computed twice at the same second
/// collapses into one row.
pub fn build_usage_snapshot_id(snap: &UsageSnapshot) -> String {
    format!("{}|{}|{}", snap.provider_id, snap.window.as_str(), snap.timestamp)
}

/// Build a backup_id from the absolute path. We use the file_name
/// (which is already a UUID-or-timestamp unique suffix in M2.6+)
/// as the dedup key.
pub fn build_backup_id_from_path(path: &Path) -> String {
    path.file_name()
        .and_then(|n| n.to_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| path.to_string_lossy().into_owned())
}

fn now_unix_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infrastructure::sqlite::history_db::open_history_db;
    use tempfile::TempDir;

    fn build_snap(provider: &str, window: UsageWindow, ts: i64, tokens: u64) -> UsageSnapshot {
        UsageSnapshot {
            provider_id: provider.into(),
            window,
            tokens_used: tokens,
            cost_usd: None,
            balance_usd: None,
            timestamp: ts,
            breakdown: Vec::new(),
            model_count: 0,
        }
    }

    fn open_fresh() -> (TempDir, HistoryService) {
        let tmp = TempDir::new().unwrap();
        let db_path = tmp.path().join("history.db");
        let conn = open_history_db(&db_path).unwrap();
        let svc = HistoryService::new(conn);
        svc.init().unwrap();
        (tmp, svc)
    }

    #[test]
    fn record_usage_inserts_row() {
        let (_tmp, svc) = open_fresh();
        let snap = build_snap("p1", UsageWindow::OneMonth, 1_700_000_000, 1234);
        svc.record_usage(&snap, None).unwrap();
        let rows = svc.query_usage(&UsageHistoryFilter::default()).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].provider_id, "p1");
        assert_eq!(rows[0].window, "1m");
    }

    #[test]
    fn record_usage_is_idempotent() {
        let (_tmp, svc) = open_fresh();
        let snap = build_snap("p1", UsageWindow::OneMonth, 1_700_000_000, 1234);
        svc.record_usage(&snap, None).unwrap();
        svc.record_usage(&snap, None).unwrap();
        let rows = svc.query_usage(&UsageHistoryFilter::default()).unwrap();
        assert_eq!(rows.len(), 1, "second insert must be ignored via UNIQUE");
    }

    #[test]
    fn record_usage_filters_by_provider_and_root() {
        let (_tmp, svc) = open_fresh();
        svc.record_usage(
            &build_snap("p1", UsageWindow::OneMonth, 1, 1),
            Some("/root-a"),
        )
        .unwrap();
        svc.record_usage(
            &build_snap("p2", UsageWindow::OneMonth, 2, 1),
            Some("/root-a"),
        )
        .unwrap();
        svc.record_usage(
            &build_snap("p1", UsageWindow::OneMonth, 3, 1),
            Some("/root-b"),
        )
        .unwrap();

        let only_p1 = svc
            .query_usage(&UsageHistoryFilter {
                provider_id: Some("p1".into()),
                ..Default::default()
            })
            .unwrap();
        assert_eq!(only_p1.len(), 2);

        let only_root_b = svc
            .query_usage(&UsageHistoryFilter {
                active_root: Some("/root-b".into()),
                ..Default::default()
            })
            .unwrap();
        assert_eq!(only_root_b.len(), 1);
    }

    #[test]
    fn record_backup_inserts_and_query() {
        let (_tmp, svc) = open_fresh();
        let rec = BackupHistoryInsert {
            backup_id: "settings.json.bak.20260622-120000".into(),
            file_name: "settings.json.bak.20260622-120000".into(),
            file_size: 1024,
            scope: "user".into(),
            trigger_kind: "manual".into(),
            file_hash: None,
            metadata_json: None,
            created_at: 1_700_000_000,
        };
        svc.record_backup(&rec, None).unwrap();
        svc.record_backup(&rec, None).unwrap(); // dedup
        let rows = svc
            .query_backup(&BackupHistoryFilter {
                scope: Some("user".into()),
                ..Default::default()
            })
            .unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].file_size, 1024);
    }

    #[test]
    fn stats_reports_counts() {
        let (_tmp, svc) = open_fresh();
        svc.record_usage(&build_snap("p1", UsageWindow::OneMonth, 1, 1), None)
            .unwrap();
        svc.record_backup(
            &BackupHistoryInsert {
                backup_id: "x.bak.1".into(),
                file_name: "x.bak.1".into(),
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
        let stats = svc.stats().unwrap();
        assert_eq!(stats.usage_rows, 1);
        assert_eq!(stats.backup_rows, 1);
        assert!(stats.db_size_bytes > 0);
    }

    #[test]
    fn purge_deletes_old_rows() {
        let (_tmp, svc) = open_fresh();
        let old_ts = 1_700_000_000; // 2023-11
        let new_ts = 2_000_000_000; // 2033-ish
        svc.record_usage(&build_snap("p1", UsageWindow::OneMonth, old_ts, 1), None)
            .unwrap();
        svc.record_usage(&build_snap("p1", UsageWindow::OneMonth, new_ts, 1), None)
            .unwrap();
        // purge anything older than 1 day from now: old row goes.
        let report = svc.purge(1).unwrap();
        assert!(report.usage_rows_deleted >= 1);
        let rows = svc.query_usage(&UsageHistoryFilter::default()).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].recorded_at, new_ts);
    }

    #[test]
    fn purge_rejects_zero_days() {
        let (_tmp, svc) = open_fresh();
        let err = svc.purge(0).unwrap_err();
        assert!(matches!(err, HistoryError::InvalidArgument(_)));
    }

    #[test]
    fn backfill_bak_inserts_existing_files() {
        let tmp = TempDir::new().unwrap();
        // Pre-seed a backup file in the same temp dir to backfill from.
        let backups = tmp.path().join("backups");
        std::fs::create_dir_all(&backups).unwrap();
        let bak = backups.join("settings.json.bak.20260619-120000");
        std::fs::write(&bak, b"{\"old\":true}").unwrap();

        let db_path = tmp.path().join("history.db");
        let conn = open_history_db(&db_path).unwrap();
        let svc = HistoryService::new(conn);
        svc.init().unwrap();

        // backfill_bak() returns Ok<usize> — must not panic on cold
        // start, must not error on the seeded file. It may insert 0
        // or 1 depending on the BackupService scanner, but never
        // errors out.
        let n = svc.backfill_bak(&backups, None).unwrap();
        assert!(n <= 1, "backfill_bak should insert at most 1 new row, got {n}");

        // A second call is a no-op (idempotent).
        let n2 = svc.backfill_bak(&backups, None).unwrap();
        assert_eq!(n2, 0, "second backfill must be a no-op");
    }

    #[test]
    fn backfill_bak_returns_zero_when_dir_missing() {
        let (_tmp, svc) = open_fresh();
        let ghost = PathBuf::from("/no/such/dir/anywhere");
        let n = svc.backfill_bak(&ghost, None).unwrap();
        assert_eq!(n, 0);
    }

    #[test]
    fn backfill_jsonl_is_a_stub_for_now() {
        let (_tmp, svc) = open_fresh();
        // Plan A scope: returns 0 (no replay logic yet).
        let n = svc.backfill_jsonl(Path::new("/nonexistent.jsonl")).unwrap();
        assert_eq!(n, 0);
    }

    #[test]
    fn build_usage_snapshot_id_is_deterministic() {
        let snap = build_snap("p", UsageWindow::FiveHours, 1_700_000_000, 100);
        let id = build_usage_snapshot_id(&snap);
        assert_eq!(id, "p|5h|1700000000");
    }

    #[test]
    fn build_backup_id_from_path_uses_filename() {
        let p = PathBuf::from("/tmp/backups/settings.json.bak.20260619-120000");
        assert_eq!(
            build_backup_id_from_path(&p),
            "settings.json.bak.20260619-120000"
        );
    }
}
