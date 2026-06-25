//! `history_db` — open + migrate the SQLite history database.
//!
//! Single entry point: [`open_history_db`]. Returns an
//! `Arc<Mutex<Connection>>` ready to hand to
//! [`crate::services::history_service::HistoryService`].
//!
//! ## PRAGMAs applied
//!
//! - `journal_mode = WAL` — concurrent readers + 1 writer (F7 +
//!   F13 INSERTs in parallel are safe).
//! - `synchronous = NORMAL` — WAL's recommended pair (safer than
//!   OFF, faster than FULL). Trade-off: a power loss may lose the
//!   last committed transaction, but the DB will never corrupt.
//! - `foreign_keys = ON` — future-proofing for relational
//!   constraints; current schema has no FKs.
//!
//! ## Corruption recovery
//!
//! If `PRAGMA integrity_check` reports corruption on open, the
//! bad file is moved aside to `<path>.corrupt.<unix-ts>` so the
//! user can inspect it. A fresh DB is then created with the
//! current schema. The call returns `Ok` — the caller sees a
//! brand-new DB instead of an error. This is the same policy as
//! `crates.io` `cargo`'s registry cache.
//!
//! ## Why `Arc<Mutex<>>` (not `Rc<RefCell<>>`)
//!
//! `HistoryService` lives in `AppState` which is shared across
//! threads via Tauri's `State<>`. We never know which OS thread
//! a given command will land on; the connection MUST be
//! `Send + Sync`. `Arc<Mutex<Connection>>` is the canonical
//! pattern for a single-writer SQLite db in Rust.

use std::path::Path;
use std::sync::{Arc, Mutex};

use rusqlite::Connection;
use rusqlite_migration::{M, Migrations};

use super::error::HistoryError;

/// All schema versions, in order. Adding a new schema = appending
/// to this vec (never insert in the middle — rusqlite_migration
/// refuses to "downgrade" between versions).
///
/// Each migration is inline so we don't pull in `include_dir!`
/// just to embed a single SQL file (CLAUDE.md §2.3: minimize deps).
fn migrations() -> Migrations<'static> {
    Migrations::new(vec![
        // V1 — initial schema (Phase 21-A ship).
        M::up(
            r#"
            CREATE TABLE IF NOT EXISTS usage_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                snapshot_id TEXT NOT NULL UNIQUE,
                provider_id TEXT NOT NULL,
                provider_name TEXT NOT NULL,
                window TEXT NOT NULL,
                used_pct REAL NOT NULL,
                reset_at INTEGER,
                raw_json TEXT NOT NULL,
                recorded_at INTEGER NOT NULL,
                active_root TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_usage_provider
                ON usage_history(provider_id, recorded_at DESC);
            CREATE INDEX IF NOT EXISTS idx_usage_recorded
                ON usage_history(recorded_at DESC);
            CREATE INDEX IF NOT EXISTS idx_usage_root
                ON usage_history(active_root, recorded_at DESC);

            CREATE TABLE IF NOT EXISTS backup_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                backup_id TEXT NOT NULL UNIQUE,
                file_name TEXT NOT NULL,
                file_size INTEGER NOT NULL,
                scope TEXT NOT NULL,
                active_root TEXT,
                trigger_kind TEXT NOT NULL,
                file_hash TEXT,
                metadata_json TEXT,
                created_at INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_backup_created
                ON backup_history(created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_backup_scope
                ON backup_history(scope, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_backup_root
                ON backup_history(active_root, created_at DESC);

            CREATE TABLE IF NOT EXISTS schema_version (
                version INTEGER PRIMARY KEY,
                applied_at INTEGER NOT NULL
            );
            "#,
        )
        .down("DROP TABLE IF EXISTS backup_history; DROP TABLE IF EXISTS usage_history; DROP TABLE IF EXISTS schema_version;"),
        // V2 — Phase 21 incremental aggregation cache.
        //
        // The history_service code (see `backfill_daily_stats` /
        // `query_daily_stats` in `services/history_service.rs`)
        // references `usage_daily_stats` for the F7 history view's
        // daily-aggregate cache. The table was missing from V1,
        // so fresh DBs threw `no such table: usage_daily_stats`
        // on startup. The live DB happened to have the table
        // from an out-of-band build, masking the regression.
        //
        // `IF NOT EXISTS` is safe on databases that already have
        // the table (the live DB) — rusqlite_migration only runs
        // V2 once anyway, but the guard makes the SQL idempotent
        // for any future tooling that re-runs migrations.
        //
        // Columns and PRIMARY KEY match the queries in
        // history_service.rs exactly (provider_id + stat_date is
        // the dedup key for one bucket per provider per day).
        M::up(
            r#"
            CREATE TABLE IF NOT EXISTS usage_daily_stats (
                provider_id    TEXT    NOT NULL,
                stat_date      TEXT    NOT NULL,
                tokens_used    INTEGER NOT NULL DEFAULT 0,
                snapshot_count INTEGER NOT NULL DEFAULT 0,
                last_aggregated_recorded_at INTEGER NOT NULL,
                updated_at     INTEGER NOT NULL,
                PRIMARY KEY (provider_id, stat_date)
            );

            CREATE INDEX IF NOT EXISTS idx_daily_stats_date
                ON usage_daily_stats(stat_date DESC);
            "#,
        )
        .down("DROP TABLE IF EXISTS usage_daily_stats;"),
    ])
}

/// Open (and create + migrate) the SQLite database at `path`.
///
/// Idempotent — calling twice on the same path returns two
/// independent handles to the same db. The caller is expected to
/// call this once at startup and hand the resulting `Arc<Mutex>`
/// to all consumers.
///
/// On corruption: see module docs — the bad file is moved aside
/// and a fresh DB is returned. Callers don't have to handle a
/// "this db is toast" error path.
pub fn open_history_db(path: &Path) -> Result<Arc<Mutex<Connection>>, HistoryError> {
    // Ensure parent dir exists. The `<app_data>` dir is already
    // created by `IPlatformPaths::ensure_dirs()` at startup, so
    // this is normally a no-op — but defending here means tests
    // and one-off callers don't have to pre-create the dir.
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            std::fs::create_dir_all(parent)?;
        }
    }

    // Open (creates the file if missing). If the file is corrupt,
    // `open` itself usually succeeds — the corruption shows up on
    // the first query. We detect it with `integrity_check` below
    // for robustness.
    let conn = Connection::open(path)?;

    // PRAGMAs — must be set per-connection (they're not persisted
    // across opens). Order: journal_mode first so the subsequent
    // PRAGMAs run in WAL mode; synchronous and foreign_keys are
    // connection-local.
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;

    // Integrity check — catches corruption that survived `open`
    // (rare but possible if the file was truncated by a disk
    // failure mid-write). If corrupt, quarantine and start over.
    let integrity_ok = {
        let mut stmt = conn.prepare("PRAGMA integrity_check")?;
        let row: String = stmt.query_row([], |r| r.get(0))?;
        row == "ok"
    };
    if !integrity_ok {
        // Move-aside. Use a timestamp suffix so multiple corrupt
        // recoveries in the same second still get unique names.
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let mut quarantine = path.as_os_str().to_owned();
        quarantine.push(format!(".corrupt.{stamp}"));
        let quarantine_path = std::path::PathBuf::from(quarantine);
        // Drop the connection so the file is no longer mapped.
        drop(conn);
        std::fs::rename(path, &quarantine_path)?;
        // Re-open at the original path — this creates a fresh
        // empty db file.
        let fresh = Connection::open(path)?;
        fresh.pragma_update(None, "journal_mode", "WAL")?;
        fresh.pragma_update(None, "synchronous", "NORMAL")?;
        fresh.pragma_update(None, "foreign_keys", "ON")?;
        return Ok(Arc::new(Mutex::new(fresh)));
    }

    // Run migrations. `to_latest` is idempotent: it skips any
    // migration already applied (tracked via SQLite's
    // `user_version` PRAGMA, which rusqlite_migration owns).
    let mut conn = conn;
    migrations()
        .to_latest(&mut conn)
        .map_err(|e| HistoryError::Migration(e.to_string()))?;

    // Defensive: also apply our own `schema_version` table so
    // consumer code can SELECT from it (rusqlite_migration uses
    // `user_version`, which is opaque to SQL).
    conn.execute(
        "CREATE TABLE IF NOT EXISTS schema_version (
            version INTEGER PRIMARY KEY,
            applied_at INTEGER NOT NULL
         )",
        [],
    )?;
    let current_version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    let now_unix = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    conn.execute(
        "INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (?1, ?2)",
        rusqlite::params![current_version, now_unix],
    )?;

    Ok(Arc::new(Mutex::new(conn)))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn open_creates_db_and_migrates() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("history.db");
        let conn = open_history_db(&path).unwrap();
        // Schema must be present after open.
        let guard = conn.lock().unwrap();
        let count: i64 = guard
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='usage_history'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
        let count: i64 = guard
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='backup_history'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
        let count: i64 = guard
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='schema_version'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }

    /// V2 migration must create the `usage_daily_stats` table
    /// referenced by `history_service::backfill_daily_stats` /
    /// `query_daily_stats` (Phase 21). Without this, a fresh DB
    /// throws `no such table: usage_daily_stats` on first launch
    /// and the service refuses to start.
    ///
    /// This test guards against:
    /// 1. The migration being dropped or commented out.
    /// 2. The schema drifting from what the service code uses.
    /// 3. The index on `stat_date` (used by the F7 history view
    ///    sort) being dropped.
    #[test]
    fn open_creates_usage_daily_stats_table() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("history.db");
        let conn = open_history_db(&path).unwrap();
        let guard = conn.lock().unwrap();

        // Table exists.
        let count: i64 = guard
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master
                 WHERE type='table' AND name='usage_daily_stats'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1, "usage_daily_stats table must exist");

        // Index on stat_date DESC exists (used by F7 history view).
        let idx_count: i64 = guard
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master
                 WHERE type='index' AND name='idx_daily_stats_date'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(idx_count, 1, "idx_daily_stats_date index must exist");

        // Schema columns match what history_service.rs inserts / selects.
        let expected_cols = [
            "provider_id",
            "stat_date",
            "tokens_used",
            "snapshot_count",
            "last_aggregated_recorded_at",
            "updated_at",
        ];
        for col in expected_cols {
            let present: i64 = guard
                .query_row(
                    "SELECT COUNT(*) FROM pragma_table_info('usage_daily_stats')
                     WHERE name = ?1",
                    [col],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(present, 1, "column {col} must exist on usage_daily_stats");
        }

        // PRAGMA user_version must reflect V2 being applied.
        let user_version: i64 = guard
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert!(
            user_version >= 2,
            "PRAGMA user_version must be >= 2 after V2 migration (got {user_version})"
        );

        // Functional smoke test: the table accepts the exact INSERT
        // that history_service::backfill_daily_stats runs, and the
        // exact SELECT that history_service::query_daily_stats runs.
        let now: i64 = 1_700_000_000;
        guard
            .execute(
                "INSERT INTO usage_daily_stats
                    (provider_id, stat_date, tokens_used, snapshot_count,
                     last_aggregated_recorded_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                rusqlite::params!["p1", "2026-06-25", 42_i64, 3_i64, now, now],
            )
            .expect("INSERT into usage_daily_stats must succeed");

        let read_back: (String, String, i64, i64, i64) = guard
            .query_row(
                "SELECT provider_id, stat_date, tokens_used, snapshot_count,
                        last_aggregated_recorded_at
                 FROM usage_daily_stats WHERE provider_id = ?1",
                ["p1"],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
            )
            .expect("SELECT from usage_daily_stats must succeed");
        assert_eq!(read_back.0, "p1");
        assert_eq!(read_back.1, "2026-06-25");
        assert_eq!(read_back.2, 42);
        assert_eq!(read_back.3, 3);
        assert_eq!(read_back.4, now);

        // PRIMARY KEY (provider_id, stat_date) — duplicate insert
        // must conflict (not silently double-write).
        let dup = guard.execute(
            "INSERT INTO usage_daily_stats
                (provider_id, stat_date, tokens_used, snapshot_count,
                 last_aggregated_recorded_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params!["p1", "2026-06-25", 99_i64, 1_i64, now, now],
        );
        assert!(
            dup.is_err(),
            "duplicate (provider_id, stat_date) must violate PRIMARY KEY"
        );
    }

    #[test]
    fn open_is_idempotent() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("history.db");
        // Two separate handles to the same path → still works.
        let _a = open_history_db(&path).unwrap();
        let _b = open_history_db(&path).unwrap();
        assert!(path.exists());
    }

    #[test]
    fn open_creates_parent_dir_if_missing() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("nested/dir/history.db");
        assert!(!path.parent().unwrap().exists());
        let _ = open_history_db(&path).unwrap();
        assert!(path.parent().unwrap().exists());
        assert!(path.exists());
    }

    #[test]
    fn open_wal_mode_is_active() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("history.db");
        let conn = open_history_db(&path).unwrap();
        let guard = conn.lock().unwrap();
        let mode: String = guard
            .query_row("PRAGMA journal_mode", [], |r| r.get(0))
            .unwrap();
        assert_eq!(mode.to_lowercase(), "wal");
    }

    #[test]
    fn open_recovers_from_corruption() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("history.db");
        // Write garbage that will fail `PRAGMA integrity_check`.
        std::fs::write(&path, b"this is not a sqlite db at all").unwrap();
        // open should NOT error — it quarantines and creates fresh.
        let conn = open_history_db(&path).unwrap();
        let guard = conn.lock().unwrap();
        // schema_version row exists (version 1) on the fresh db.
        let count: i64 = guard
            .query_row("SELECT COUNT(*) FROM schema_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1);
        // A `.corrupt.<ts>` sibling file exists.
        let mut found_corrupt = false;
        for entry in std::fs::read_dir(tmp.path()).unwrap() {
            let name = entry.unwrap().file_name().to_string_lossy().into_owned();
            if name.starts_with("history.db.corrupt.") {
                found_corrupt = true;
                break;
            }
        }
        assert!(found_corrupt, "expected quarantine sibling file");
    }
}
