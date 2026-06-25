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

use std::sync::{Arc, Mutex};

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
    /// M3.10 (清单 23) — 双模式 (用户/项目) service. Owns
    /// `<app_data>/projects.json`. Used by the 5 project commands
    /// (list / add / remove / switch / current) and indirectly by
    /// `IPlatformPaths::active_root_dir()` (Windows impl reads the
    /// same file).
    pub project_service: Arc<crate::services::project_service::ProjectService>,
    /// M4.6 (Phase 21) — SQLite-backed history persistence. Owns
    /// the `<app_data>/history.db` connection. The same instance
    /// is shared with F7 (UsageService) and F13 (BackupService) so
    /// every fresh snapshot / new backup appends one row to the
    /// corresponding history table. Plan B Tauri commands will
    /// dispatch into this service for query / stats / purge.
    pub history_service: Arc<crate::services::history_service::HistoryService>,
    /// M2.16 — F20 冷启动 .sql 文件关联:
    ///
    /// setup 阶段(`lib.rs::run`)扫描 argv 时拿到 `.sql` 路径,但此时
    /// webview 还没挂载、前端 listener 还没注册。emit `import-sql-file`
    /// 会丢(broadcast 不缓存给晚注册的 listener)。所以把路径先存到
    /// 这里,前端 `App.tsx` mount 后调 [`crate::commands::fs::take_pending_sql_file`]
    /// 主动拉一次。
    ///
    /// 单值 + take 语义(读后清空),避免重复触发同一文件。
    pub pending_sql_file: Mutex<Option<String>>,
    /// M4.3 — updater public key (from tauri.conf.json plugins.updater.pubkey).
    /// Read by the updater commands and the frontend for update config display.
    pub updater_pubkey: String,
    /// M4.3 — updater endpoints (from tauri.conf.json plugins.updater.endpoints).
    /// JSON endpoint(s) that serve the latest.json manifest for auto-update.
    pub updater_endpoints: Vec<String>,
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
        // M4.6 (Phase 21) — open the SQLite history db FIRST so we
        // can attach it to BackupService and UsageService below.
        // Best-effort: if the db is corrupt or unopenable we LOG
        // the error and proceed with a no-op in-memory service
        // stub so the main app starts cleanly. Plan A never
        // blocks startup on history.
        let history_service = match crate::infrastructure::sqlite::history_db::open_history_db(
            &paths.history_db,
        ) {
            Ok(conn) => {
                let svc = crate::services::history_service::HistoryService::new(conn);
                if let Err(e) = svc.init() {
                    eprintln!("[app_state] history.init() failed: {e}");
                }
                // First-launch backfill — scan the existing
                // `.bak.<ts>` files in `<backups_dir>` and
                // `<claude_dir>` so a returning user sees their
                // old backups in the F13 timeline. Failure here
                // is also best-effort.
                let claude_dir = paths
                    .claude_dir()
                    .map(|p| p.to_path_buf())
                    .unwrap_or_else(|| paths.home.join(".claude"));
                match svc.backfill_bak(&paths.backups_dir, Some(&claude_dir)) {
                    Ok(n) if n > 0 => {
                        eprintln!("[app_state] backfilled {n} backups into history")
                    }
                    Ok(_) => {}
                    Err(e) => eprintln!("[app_state] backfill_bak failed: {e}"),
                }
                Arc::new(svc)
            }
            Err(e) => {
                eprintln!(
                    "[app_state] history.db open failed: {e} — continuing with in-memory history"
                );
                // M5 bug #2 fix: the previous code opened a raw
                // `Connection::open_in_memory()` here, which has
                // no schema applied. Any subsequent query failed
                // with `no such table: usage_history` etc. Now we
                // delegate to `open_in_memory_db()` which runs the
                // V1 + V2 migrations on the in-memory connection
                // before handing it to `HistoryService`.
                match crate::infrastructure::sqlite::history_db::open_in_memory_db() {
                    Ok(conn) => Arc::new(crate::services::history_service::HistoryService::new(conn)),
                    Err(e2) => {
                        eprintln!(
                            "[app_state] in-memory history.db also failed: {e2} — giving up"
                        );
                        use std::sync::{Arc, Mutex};
                        let conn = rusqlite::Connection::open_in_memory()
                            .expect("in-memory sqlite must always open");
                        Arc::new(crate::services::history_service::HistoryService::new(
                            Arc::new(Mutex::new(conn)),
                        ))
                    }
                }
            }
        };
        let provider_service = Arc::new(
            crate::services::provider_service::ProviderService::new(paths.clone()),
        );
        let mcp_service = Arc::new(
            crate::services::mcp_service::McpService::new(paths.clone()),
        );
        // M4.6 — attach the history sink to F13 so every new
        // `.bak.<ts>` writes a row to `backup_history`.
        let backup_service = Arc::new(
            crate::services::backup_service::BackupService::new(paths.clone())
                .with_history(history_service.clone()),
        );
        // M4.6 — attach the history sink to F7 so every fresh
        // snapshot writes a row to `usage_history`.
        let usage_service = Arc::new(
            crate::services::usage_service::UsageService::new(paths.clone())
                .with_history(history_service.clone()),
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
        // M3.10 (清单 23) — 双模式 (用户/项目) service. Holds the
        // same AppPaths snapshot as the other services. Built
        // unconditionally so the 5 project commands are always
        // available (no feature-flag gating).
        let project_service = Arc::new(
            crate::services::project_service::ProjectService::new(paths.clone()),
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
            project_service,
            history_service,
            // M2.16 — F20 冷启动 .sql 路径缓存,初始 None。
            pending_sql_file: Mutex::new(None),
            // M4.3 — updater pubkey from tauri.conf.json (set during build).
            updater_pubkey: "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEM4Q0I3RjAwREFDRDFFODEKUldTQkhzM2FBSC9MeVBJRU9Yam53cXpEUE1UVGN0RFE5Y0R6SnZidkpWYlhiRzkvUXR4ZVU2VisK".to_string(),
            // M4.3 — updater endpoints: GitHub Releases JSON manifest.
            updater_endpoints: vec!["https://github.com/loonghao/claude-config-manager/releases/latest/download/latest.json".to_string()],
        }
    }
}