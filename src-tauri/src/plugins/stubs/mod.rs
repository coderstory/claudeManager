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
pub mod file_ops;
// Phase 47 fix — F8 (removed M5 #18) `get_app_metadata` was missed
// in Phase 42 IPC dispatch migration; the About page on mount calls
// invoke('get_app_metadata'). Without inventory registration, Tauri
// returns "Command not found" and the About page crashes.
pub mod app;
// Phase 43 — core plugin owns the system tray + macOS application
// menu. Registered FIRST in `plugins::mod::init_all` so its `init`
// runs before any feature plugin and the OS menu surface is in
// place before plugins start emitting events.
pub mod core;

pub use provider_list::ProviderListPlugin;
pub use core::CorePlugin;
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
pub use file_ops::FileOpsPlugin;
pub use app::AppPlugin;
