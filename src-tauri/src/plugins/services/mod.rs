//! Phase 45 — service plugins.
//!
//! Each submodule wraps an existing `crate::services::XxxService` as
//! an [`IPlugin`]. The plugin's `init` constructs the service
//! (best-effort — IO failures log a warning and register an in-memory
//! / no-op variant so the main app still starts), wires up its
//! inter-service dependencies via [`ServiceRegistry`], and publishes
//! the resulting `Arc<Service>` for downstream plugins + Tauri
//! commands to consume.
//!
//! ## Why each service is a plugin
//!
//! - **Dependency order is explicit.** `depends_on()` declares which
//!   other services must init first; `init_all_topological` resolves
//!   the order at startup. No more "build `backup_service` BEFORE
//!   `provider_service` because the latter calls `.with_backup_service(...)`"
//!   scattered comments in `app_state.rs`.
//! - **Adding a new service = adding one file.** The "加 1 service 只动
//!   1 文件" strong acceptance criterion — Phase 45 PLAN §1, item 10.
//! - **Commands stop holding raw `Arc<crate::services::>` on
//!   `AppState`.** Instead, `AppState` holds a single
//!   `Arc<ServiceRegistry>`; commands look up services via the
//!   [`get_service!`] macro at call time.
//!
//! ## Failure handling
//!
//! Per G9 (history-service best-effort), every service plugin uses a
//! 3-tier fallback on IO failure:
//!
//! 1. Try the "happy path" (real disk / real DB / real git).
//! 2. On failure, log a warning + try the "in-memory" variant.
//! 3. On second failure, log + try a "raw no-op" variant
//!    (e.g. raw `rusqlite::Connection::open_in_memory`).
//!
//! Every tier ends with `register_arc` so the registry is never
//! empty after `init_all_topological` returns — a missing service
//! would later panic a command at runtime, which is harder to
//! diagnose than a startup warning.
//!
//! [`get_service!`]: crate::commands::macros::get_service

pub mod backup_service;
pub mod history_service;
pub mod mcp_service;
pub mod optimizer_service;
pub mod project_service;
pub mod provider_service;
pub mod resource_service;
pub mod marketplace_service;
pub mod usage_service;

pub use backup_service::BackupServicePlugin;
pub use history_service::HistoryServicePlugin;
pub use mcp_service::McpServicePlugin;
pub use optimizer_service::OptimizerServicePlugin;
pub use project_service::ProjectServicePlugin;
pub use provider_service::ProviderServicePlugin;
pub use resource_service::ResourceServicePlugin;
pub use marketplace_service::MarketplaceServicePlugin;
pub use usage_service::UsageServicePlugin;
