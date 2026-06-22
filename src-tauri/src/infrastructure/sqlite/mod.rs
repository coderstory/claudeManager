//! `infrastructure::sqlite` — SQLite-backed history persistence
//! (Phase 21, M4.6).
//!
//! The single public entry point is [`history_db::open_history_db`],
//! which returns a `rusqlite::Connection` wrapped in `Arc<Mutex<>>`
//! ready to hand to [`crate::services::history_service::HistoryService`].
//!
//! ## Why a separate module
//!
//! SQLite concerns (WAL pragma, schema migration, corruption recovery)
//! don't belong in `services/`. Per CLAUDE.md §3.1, `services/` calls
//! `infrastructure::*` for I/O — so all SQLite plumbing lives here and
//! `HistoryService` just calls `INSERT` / `SELECT`.
//!
//! ## Migration
//!
//! Schema is managed by [`rusqlite_migration`]. Each migration is an
//! inline `M::up("...")` SQL string declared in
//! [`crate::infrastructure::sqlite::history_db`]. Adding a new schema
//! version = adding a new entry to the `Migrations::new(vec![...])`
//! call; no SQL files to embed.
//!
//! ## Error type
//!
//! [`HistoryError`] is the single error surface every consumer of
//! this module uses. Variants are coarse enough for the F7 / F13
//! callers to log + swallow on failure (CLAUDE.md §7: never silent).
pub mod error;
pub mod history_db;
