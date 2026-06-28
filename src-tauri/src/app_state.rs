//! Shared Tauri state.
//!
//! `AppState` is the single struct held in Tauri's `State<>` and shared
//! across all commands. After Phase 45 it owns:
//!
//! - `paths: AppPaths` — resolved once at startup via `IPlatformPaths`,
//!   cached for the lifetime of the process. Commands and services read
//!   from this; they never call `paths.resolve()` again.
//!
//! - `service_registry: Arc<ServiceRegistry>` — the 9 Phase 45 service
//!   plugins (`history` / `backup` / `provider` / `usage` / `mcp` /
//!   `optimizer` / `resource` / `marketplace` / `project`) publish
//!   their `Arc<Service>` into this registry during `init`. Commands
//!   look services up by type via the [`crate::get_service!`] macro.
//!
//!   Per CLAUDE.md §3.2: services must NOT call `IPlatformPaths` directly
//!   when running inside a Tauri command — they read `AppPaths` from state.
//!   This guarantees `ensure_dirs` was called exactly once at startup.
//!
//! ## Phase 45 history
//!
//! Before Phase 45 this struct held 9 separate
//! `Arc<crate::services::XxxService>` fields (`provider_service`,
//! `mcp_service`, …, `history_service`). All 9 fields were removed in
//! commit `feat(v3.4 phase-45): extract 9 services to plugins` —
//! each service is now constructed inside its own plugin's `init`
//! and registered via `service_registry.register_arc`. The "加 1
//! service 只动 1 文件" strong acceptance criterion from
//! `.planning/milestones/v3.4-phases/45-PLAN.md` §1 item 10 depends
//! on this shape.

use std::sync::{Arc, Mutex};

use crate::platform::{runtime, AppPaths};
use crate::plugins::service_registry::ServiceRegistry;

/// Singleton Tauri state.
pub struct AppState {
    /// Resolved at startup; immutable for the process lifetime.
    pub paths: AppPaths,
    /// Phase 45 — 9 services registered into one container instead
    /// of 9 separate `Arc<>` fields. Built empty; populated by each
    /// `services::*` plugin during `init_all_topological`.
    pub service_registry: Arc<ServiceRegistry>,
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
    /// `IPlatformPaths` impl and creating an empty `ServiceRegistry`.
    ///
    /// MUST be called from `lib.rs::run` *after* `platform::init_for_runtime`
    /// and *after* `ensure_dirs` so all app-data subdirs exist.
    ///
    /// Service construction was historically here (the 140-line
    /// `app_state.rs::build` block) — Phase 45 moved it into 9
    /// separate `services::*` plugins that publish into
    /// `service_registry` via `init_all_topological`.
    pub fn build() -> Self {
        let paths_impl = runtime::paths();
        let paths = paths_impl.resolve();
        // We intentionally swallow the error here — if ensure_dirs fails
        // the user has bigger problems and the first command will surface
        // the I/O error with a clear path.
        let _ = paths_impl.ensure_dirs();
        Self {
            paths,
            service_registry: Arc::new(ServiceRegistry::new()),
            // M2.16 — F20 冷启动 .sql 路径缓存,初始 None。
            pending_sql_file: Mutex::new(None),
            // M4.3 — updater pubkey from tauri.conf.json (set during build).
            updater_pubkey: "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEM4Q0I3RjAwREFDRDFFODEKUldTQkhzM2FBSC9MeVBJRU9Yam53cXpEUE1UVGN0RFE5Y0R6SnZidkpWYlhiRzkvUXR4ZVU2VisK".to_string(),
            // M4.3 — updater endpoints: GitHub Releases JSON manifest.
            updater_endpoints: vec!["https://github.com/loonghao/claude-config-manager/releases/latest/download/latest.json".to_string()],
        }
    }
}