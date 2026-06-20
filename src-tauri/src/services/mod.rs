//! Services — business logic that combines domain models +
//! infrastructure primitives + platform traits. Each service is
//! a plain struct with methods; no Tauri's State or async machinery
//! here — that lives in `commands/`.
//!
//! Per CLAUDE.md §3.1, services never touch `std::fs` or `std::env`
//! directly; they receive an `IPlatformPaths` and call
//! `crate::infrastructure::*` for any I/O.

pub mod backup_service;
pub mod mcp_service;
pub mod optimizer_service;
pub mod provider_service;
pub mod usage_service;