//! Infrastructure — primitive I/O helpers used by services.
//!
//! Per CLAUDE.md §3.1, all filesystem + OS-shell primitives live here.
//! Services / domain MUST NOT call `std::fs::*` directly when the
//! operation has a "user-data" semantics (atomic write, backup,
//! rollback). They go through the helpers in this module.

pub mod backup_scanner;
pub mod deeplink_parser;
// Phase 2 — non-UTF-8 .sql 编码探测 + 解码 helper。`commands::fs` 的
// `read_sql_file` 与 `commands::providers` 的 `parse_sql_preview` /
// `import_providers_from_sql` 都走 `decode_sql_bytes`。
pub mod encoding;
pub mod fs_atomic;
pub mod json_diff;
pub mod optimizer_rules;
pub mod resource_detail;
pub mod resource_scanner;
pub mod sql_parser;
// M4.6 (Phase 21) — SQLite-backed history persistence (F7 + F13).
pub mod sqlite;