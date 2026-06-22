//! Errors emitted by `infrastructure::sqlite` and surfaced by
//! `services::history_service`.
//!
//! Coarse-grained on purpose: callers (F7 / F13) are expected to log
//! the error and swallow it (CLAUDE.md §7: never silent) — they
//! should not match on individual variants to drive UX, just to
//! decide whether to retry once. Plan B's Tauri commands will route
//! the `Display` text into the IPC error payload.

use std::path::PathBuf;

use thiserror::Error;

#[derive(Debug, Error)]
pub enum HistoryError {
    /// Underlying SQLite I/O / SQL error. Most frequent cause is
    /// disk full, lock contention, or schema corruption.
    #[error("sqlite error: {0}")]
    Sqlite(#[from] rusqlite::Error),

    /// Underlying rusqlite_migration error (e.g. SQL syntax in a
    /// migration step is bad). Surfaces during `open_history_db`.
    #[error("migration error: {0}")]
    Migration(String),

    /// Caller passed an argument that we rejected at the service
    /// boundary (e.g. `purge(0)` — purge of "older than zero days"
    /// would be a delete-everything command).
    #[error("invalid argument: {0}")]
    InvalidArgument(String),

    /// JSON serialization failed. Wraps `serde_json::Error` so
    /// callers don't need to add a dep on it.
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    /// Underlying `std::fs` error during corruption recovery
    /// (move-aside bad db, etc). Wraps the original.
    #[error("filesystem error: {0}")]
    Io(#[from] std::io::Error),

    /// `Arc<Mutex<Connection>>` lock was poisoned — another thread
    /// panicked while holding the lock. Indicates a bug; the
    /// service is now in an undefined state and the caller should
    /// drop the service.
    #[error("history.db mutex poisoned — another thread panicked")]
    MutexPoisoned,

    /// Corruption detected: the bad db file was moved aside to
    /// `path` so a fresh DB can be created. Caller can surface a
    /// soft warning ("history reset") but should not block the
    /// main flow.
    #[error("history.db was corrupt and has been quarantined to {0}")]
    Quarantined(PathBuf),
}
