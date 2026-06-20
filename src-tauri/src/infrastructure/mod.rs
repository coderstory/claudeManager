//! Infrastructure — primitive I/O helpers used by services.
//!
//! Per CLAUDE.md §3.1, all filesystem + OS-shell primitives live here.
//! Services / domain MUST NOT call `std::fs::*` directly when the
//! operation has a "user-data" semantics (atomic write, backup,
//! rollback). They go through the helpers in this module.

pub mod backup_scanner;
pub mod deeplink_parser;
pub mod fs_atomic;
pub mod json_diff;
pub mod sql_parser;