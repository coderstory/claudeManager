//! Plugin stubs — one per F1..F12 feature.
//!
//! M1.3 ships only **stubs** per [`CLAUDE.md` §3.3`]. Each stub:
//! - returns a stable id + display name,
//! - contributes routes / services as appropriate,
//! - does no business logic (default `init` / `shutdown` no-ops).
//!
//! Real implementations land in M2+.
//!
//! [`CLAUDE.md` §3.3`]: ../../../../../CLAUDE.md

pub mod provider_list;
pub mod import_sql;
pub mod json_editor;
pub mod mcp_management;
pub mod usage_query;
pub mod resource_browser;
pub mod marketplace;
pub mod optimizer;
pub mod backup_restore;
pub mod updater;
pub mod history_view;
pub mod project_mode;

pub use provider_list::ProviderListPlugin;
pub use import_sql::ImportSqlPlugin;
pub use json_editor::JsonEditorPlugin;
pub use mcp_management::McpManagementPlugin;
pub use usage_query::UsageQueryPlugin;
pub use resource_browser::ResourceBrowserPlugin;
pub use marketplace::MarketplacePlugin;
pub use optimizer::OptimizerPlugin;
pub use backup_restore::BackupRestorePlugin;
pub use updater::UpdaterPlugin;
pub use history_view::HistoryViewPlugin;
pub use project_mode::ProjectModePlugin;
