//! Shared Tauri state.
//!
//! `AppState` is the single struct held in Tauri's `State<>` and shared
//! across all commands. Currently it owns:
//!
//! - `paths: AppPaths` — resolved once at startup via `IPlatformPaths`,
//!   cached for the lifetime of the process. Commands and services read
//!   from this; they never call `paths.resolve()` again.
//!
//! Per CLAUDE.md §3.2: services must NOT call `IPlatformPaths` directly
//! when running inside a Tauri command — they read `AppPaths` from state.
//! This guarantees `ensure_dirs` was called exactly once at startup.

use std::sync::Arc;

use crate::platform::{runtime, AppPaths};

/// Singleton Tauri state.
pub struct AppState {
    /// Resolved at startup; immutable for the process lifetime.
    pub paths: AppPaths,
    /// Shared service instances. `Arc` so the same instance is used by
    /// any future commands that need cross-command caching (e.g. F19
    /// backup cache). M2.1 uses `provider_service`; M2.5 adds
    /// `mcp_service` for F6.
    pub provider_service: Arc<crate::services::provider_service::ProviderService>,
    /// M2.5 — F6 MCP 管理 service. Owns `~/.claude/mcp.json` read/write.
    pub mcp_service: Arc<crate::services::mcp_service::McpService>,
    /// M2.6 — F13 备份与恢复 service. Scans `*.bak.<ts>` files
    /// across the app-data backups dir and the live Claude dir,
    /// exposes restore (with double-backup safety) and field-level
    /// diff. Owned here so commands can dispatch into it from the
    /// shared Tauri state.
    pub backup_service: Arc<crate::services::backup_service::BackupService>,
    /// M2.7 — F7 用量查询 service. Owns the 5-minute in-memory
    /// snapshot cache for `(provider_id, window)` and reads
    /// `~/.claude/usage.json` on miss.
    pub usage_service: Arc<crate::services::usage_service::UsageService>,
    /// M2.9 — F18 配置优化 service. Composes 13 OptimizerRules,
    /// scans settings.json + providers/ + mcp.json, applies fixes
    /// via fs_atomic with auto-backup.
    pub optimizer_service: Arc<crate::services::optimizer_service::OptimizerService>,
    /// M2.13 — F16 资源浏览 service. Scans 5 resource kinds
    /// (plugins/skills/commands/lsp/mcp) under `<claude_dir>/` and
    /// delegates file-manager reveals to `IPlatformReveal`.
    pub resource_service: Arc<crate::services::resource_service::ResourceService>,
    /// M2.16 — F17 在线安装 service. Clones git repos into
    /// `<app_data>/marketplaces/<slug>/`, scans 5 resource kinds,
    /// copies selected resources into `~/.claude/<subdir>/`.
    pub marketplace_service: Arc<crate::services::marketplace_service::MarketplaceService>,
}

impl AppState {
    /// Build the state by resolving `AppPaths` from the current OS's
    /// `IPlatformPaths` impl and creating the services that need it.
    ///
    /// MUST be called from `lib.rs::run` *after* `platform::init_for_runtime`
    /// and *after* `ensure_dirs` so all app-data subdirs exist.
    pub fn build() -> Self {
        let paths_impl = runtime::paths();
        let paths = paths_impl.resolve();
        // We intentionally swallow the error here — if ensure_dirs fails
        // the user has bigger problems and the first command will surface
        // the I/O error with a clear path.
        let _ = paths_impl.ensure_dirs();
        let provider_service = Arc::new(
            crate::services::provider_service::ProviderService::new(paths.clone()),
        );
        let mcp_service = Arc::new(
            crate::services::mcp_service::McpService::new(paths.clone()),
        );
        let backup_service = Arc::new(
            crate::services::backup_service::BackupService::new(paths.clone()),
        );
        let usage_service = Arc::new(
            crate::services::usage_service::UsageService::new(paths.clone()),
        );
        let optimizer_service = Arc::new(
            crate::services::optimizer_service::OptimizerService::new(paths.clone()),
        );
        // M2.13 — F16 资源浏览. Resolves `<claude_dir>/` from the
        // cached `AppPaths`, then takes a `Box<dyn IPlatformReveal>`
        // from `platform::runtime::reveal()` (WindowsReveal on Win,
        // MacReveal stub on macOS).
        let claude_dir = paths
            .claude_dir()
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| paths.home.join(".claude"));
        let resource_service = Arc::new(
            crate::services::resource_service::ResourceService::new(
                claude_dir.clone(),
                runtime::reveal(),
            ),
        );
        // M2.16 — F17 在线安装. clone 缓存根 = `<app_data>/marketplaces/`,
        // install 目标根 = `~/.claude/`(跟 resource_service 同源),
        // git 走 `runtime::git_host()`(Windows: GitHostCli / macOS: MacGitHost)。
        let marketplace_service = Arc::new(
            crate::services::marketplace_service::MarketplaceService::new(
                paths.marketplaces_dir.clone(),
                claude_dir,
                runtime::git_host(),
            ),
        );
        Self {
            paths,
            provider_service,
            mcp_service,
            backup_service,
            usage_service,
            optimizer_service,
            resource_service,
            marketplace_service,
        }
    }
}