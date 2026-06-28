//! Plugin system (M1.3).
//!
//! Re-exports the plugin trait surface, the [`PluginHost`], and the 10
//! stub plugins. The single entry point used by `lib.rs` is
//! [`init_all`], which builds a populated host and calls `init_all` on it.
//!
//! See each submodule for detail:
//! - [`traits`] — the `IPlugin` contract
//! - [`host`]   — `PluginHost` (registry + lifecycle)
//! - [`stubs`]  — the 10 stub plugins (F1, F2, F3, F5, F6, F7,
//!                F16, F17, F18, F19; F4 deeplink-import removed in
//!                cleanup commit 0ff5b86, F8 removed in M5 #18)

pub mod host;
pub mod traits;

pub mod stubs;

// Phase 42 — dispatch module (Tauri command routing via inventory).
pub mod dispatch;
pub mod service_registry;

pub use host::PluginHost;
pub use service_registry::ServiceRegistry;
pub use traits::{
    IPlugin, PluginContext, PluginError, PluginRoute, PluginService,
};

// ---------------------------------------------------------------------------
// init_all
// ---------------------------------------------------------------------------

/// Build a [`PluginHost`] pre-populated with all 10 stub plugins, and run
/// `init_all` on it against `ctx`.
///
/// `init_all` is the **single** entry point that `lib.rs` should call.
/// Adding a new plugin = (1) write the stub under `stubs/`, (2) register
/// it here, (3) register the corresponding frontend stub in
/// `src/plugins/registry.ts`. No other call site needs to change.
pub fn init_all(ctx: &PluginContext) -> Result<PluginHost, PluginError> {
    let mut host = PluginHost::new();

    // F1..F7 core (F4 deeplink-import removed in cleanup commit 0ff5b86;
    // F8 removed in M5 #18; F2 provider_switch merged into provider_list
    // per v3.4 SHIP-A decision)
    host.register(Box::new(stubs::ProviderListPlugin))?;
    host.register(Box::new(stubs::ImportSqlPlugin))?;
    host.register(Box::new(stubs::JsonEditorPlugin))?;
    host.register(Box::new(stubs::McpManagementPlugin))?;
    host.register(Box::new(stubs::UsageQueryPlugin))?;

    // F16..F19 L1 features
    host.register(Box::new(stubs::ResourceBrowserPlugin))?;
    host.register(Box::new(stubs::MarketplacePlugin))?;
    host.register(Box::new(stubs::OptimizerPlugin))?;
    host.register(Box::new(stubs::BackupRestorePlugin))?;

    // Phase 21 — history page (SQLite 查询 UI, M4.6)
    host.register(Box::new(stubs::HistoryViewPlugin))?;

    // M3.10 — 项目模式 (用户/项目双模式)
    host.register(Box::new(stubs::ProjectModePlugin))?;

    // F15 — 错误反馈 / 自动更新 (M4.3, Phase 42 Task 3).
    host.register(Box::new(stubs::UpdaterPlugin))?;

    // Run startup hooks on every plugin.
    host.init_all(ctx)?;

    // M2.17 — observability for the wiring step. tauri-plugin-log
    // captures this via the `log` facade and writes to a per-app log
    // file; operators can grep for the marker to confirm 10 plugins
    // were registered at this process. Per-plugin id is logged so a
    // broken registration (missing import) shows up as an absent line.
    log::info!(
        "[M2.17] PluginHost wired: {} plugins registered: {:?}",
        host.count(),
        host.iter().map(|(id, _)| id).collect::<Vec<_>>()
    );

    Ok(host)
}
