//! Domain models — business types with no I/O (or only file-shaped I/O
//! at the leaf). See each submodule for the entity contract:
//!
//! - [`provider`] — F1 + F2 (M2.1)
//!
//! Conventions:
//! - Every struct here is `Serialize + Deserialize` (round-trips through JSON).
//! - I/O is limited to single-file read/write (`from_json_file`,
//!   `to_json_file`). Directory-level work belongs in `services/`.
//! - All paths come in via `&Path` — never call `dirs::home_dir` directly.
//! - Validation lives on the struct itself (`Provider::validate`); services
//!   call it after `from_*` and before `to_*`.

pub mod mcp_server;
pub mod optimization;
pub mod provider;
pub mod resource;
pub mod usage;

pub use mcp_server::{McpError, McpServer, McpTransport};
pub use optimization::{ApplyResult, OptimizationFinding, Severity};
pub use provider::{is_valid_id, Provider, ProviderError};
pub use resource::{ResourceDetail, ResourceItem, ResourceKind};
pub use usage::{UsageSnapshot, UsageWindow};

// F3 SQL-import shape: `infrastructure::sql_parser::ParsedMcpServer`.
// Re-exported here so the rest of the crate can `use crate::domain::ParsedMcpServer;`
// (parser output for the F3 preview; F6 owns the write-side
// `McpServer` declared in `mcp_server`).
pub use crate::infrastructure::sql_parser::ParsedMcpServer;