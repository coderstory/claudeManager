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

// Phase 43 — MenuRegistry: tray + macOS AppMenu assembly.
pub mod menu_registry;

pub use host::PluginHost;
pub use menu_registry::{
    AppMenuRole, PluginAction, PluginAppMenuItem, PluginAppMenuItemKind,
    PluginTrayItem,
};
pub use service_registry::ServiceRegistry;
pub use traits::{
    IPlugin, PluginContext, PluginError, PluginRoute, PluginService,
};

// ---------------------------------------------------------------------------
// init_all
// ---------------------------------------------------------------------------

/// Build a [`PluginHost`] pre-populated with all stub plugins, run
/// `init_all` on it, and return the wired host.
///
/// `init_all` is the **single** entry point that `lib.rs` should call.
/// Adding a new plugin = (1) write the stub under `stubs/`, (2) register
/// it here, (3) register the corresponding frontend stub in
/// `src/plugins/registry.ts`. No other call site needs to change.
///
/// Takes `&AppHandle` + `&dyn IPlatformPaths` and constructs the
/// `PluginContext` internally — the caller doesn't see ctx. This
/// sidesteps the borrow checker conflict between `&mut host` (needed
/// by `init_all`) and `&host` (held inside `PluginContext`); the host
/// exists before the context so we can take `&host` (the NonNull
/// pointer) without conflicting with `&mut host` on a subsequent line.
pub fn init_all(
    app: &tauri::AppHandle,
    paths: &dyn crate::platform::IPlatformPaths,
) -> Result<PluginHost, PluginError> {
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

    // F2/F6/F13/F18/F19 — 文件操作聚合 (read/write/list)
    host.register(Box::new(stubs::FileOpsPlugin))?;

    // F15 — 错误反馈 / 自动更新 (M4.3, Phase 42 Task 3).
    host.register(Box::new(stubs::UpdaterPlugin))?;

    // Build the context now that the host exists. The host pointer is
    // stashed inside the context as a NonNull so plugins can read
    // peers (e.g. `core` walks tray items) without `&mut host` /
    // `&host` borrow-checker conflicts. `services` stays `None`
    // until Phase 45 populates it (the registry will then be
    // constructed here and passed via `Some(&mut reg)`).
    //
    // `&host as *const _` — the cast to raw pointer happens BEFORE
    // any NLL borrow is established, so `host.init_all(&mut ctx)`
    // below can take `&mut host` cleanly.
    let mut plugin_ctx = PluginContext::new(app, paths, &host as *const _, None);

    // Run startup hooks on every plugin.
    host.init_all(&mut plugin_ctx)?;

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
