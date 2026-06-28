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

// Phase 45 — DFS 3-color topological sort for plugin init ordering.
pub mod topological;

// Phase 45 — 9 service plugins (history/backup/provider/usage/mcp/
// optimizer/resource/marketplace/project). Each wraps an existing
// `crate::services::XxxService` as an `IPlugin` so its construction
// participates in topological init ordering.
pub mod services;

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
///
/// **Deprecated**: Phase 45 ships [`init_all_topological`] which
/// supports service plugins via `depends_on()`. `init_all` is kept
/// for the unit-test path (which doesn't need the ServiceRegistry)
/// but `lib.rs::run` calls `init_all_topological` instead.
pub fn init_all(
    app: &tauri::AppHandle,
    paths: &dyn crate::platform::IPlatformPaths,
) -> Result<PluginHost, PluginError> {
    let mut host = PluginHost::new();

    // Phase 43 (G-5 strong acceptance) — `core` must register FIRST
    // so its `init` runs before any feature plugin and the OS menu
    // surface is in place before plugins start emitting events.
    // Q43-5 — id is `"core"` so `unregister_actions` can prefix-match
    // all of its contributions.
    host.register(Box::new(stubs::CorePlugin))?;

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

// ---------------------------------------------------------------------------
// init_all_topological (Phase 45)
// ---------------------------------------------------------------------------

/// **Phase 45** — like [`init_all`] but:
/// - Registers **9 service plugins** (history / backup / provider /
///   usage / mcp / optimizer / resource / marketplace / project) in
///   addition to the 13 business plugins.
/// - Resolves init order via [`crate::plugins::topological::topo_sort`]
///   so services that depend on other services (`provider-service`
///   depends on `backup-service` + `history-service`) init after
///   their dependencies.
/// - Builds the `PluginContext` with `services: Some(&mut
///   state.service_registry)` — service plugins register themselves
///   into it during `init`; commands later look them up via
///   [`crate::get_service!`].
///
/// **Caller contract**: `state.service_registry` must be an
/// `Arc<ServiceRegistry>` with refcount=1 (no `app.manage(state)`
/// yet). The host is returned for `app.manage(Mutex::new(host))`.
pub fn init_all_topological(
    app: &tauri::AppHandle,
    paths: &dyn crate::platform::IPlatformPaths,
    state: &mut crate::app_state::AppState,
) -> Result<PluginHost, PluginError> {
    let mut host = PluginHost::new();

    // -------- 9 service plugins --------
    // Order here is intentionally NOT significant — topological
    // resolution sorts them by `depends_on()` at init time.
    host.register(Box::new(services::HistoryServicePlugin))?;
    host.register(Box::new(services::BackupServicePlugin))?;
    host.register(Box::new(services::ProviderServicePlugin))?;
    host.register(Box::new(services::UsageServicePlugin))?;
    host.register(Box::new(services::McpServicePlugin))?;
    host.register(Box::new(services::OptimizerServicePlugin))?;
    host.register(Box::new(services::ResourceServicePlugin))?;
    host.register(Box::new(services::MarketplaceServicePlugin))?;
    host.register(Box::new(services::ProjectServicePlugin))?;

    // -------- 13 business plugins --------
    // Phase 43 (G-5 strong acceptance) — `core` must register FIRST
    // so its `init` runs before any feature plugin and the OS menu
    // surface is in place before plugins start emitting events.
    host.register(Box::new(stubs::CorePlugin))?;

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

    // -------- Build context --------
    // The registry Arc has refcount=1 (caller hasn't done
    // `app.manage(state)` yet) so `Arc::get_mut` succeeds and we
    // can hand `&mut ServiceRegistry` to the context without an
    // unsafe block. After `init_all_topological` returns the caller
    // bumps refcount to 2 via `app.manage(state)`, after which
    // `Arc::get_mut` would no longer work — but by then init is done
    // and we don't need `&mut` anymore.
    //
    // SAFETY: the raw pointer `&host as *const _` is taken before
    // `&mut host` is needed by `init_all_topological`; the host
    // lives until the caller drops it (held in `Mutex<PluginHost>`
    // managed by Tauri).
    let mut plugin_ctx = {
        let services_reg = std::sync::Arc::get_mut(&mut state.service_registry)
            .ok_or_else(|| PluginError::InitFailed(
                "ServiceRegistry Arc has multiple owners before init — caller must defer app.manage".into(),
            ))?;
        PluginContext::new(
            app,
            paths,
            &host as *const _,
            Some(services_reg),
        )
    };

    // -------- Topological init --------
    let order = host.init_all_topological(&mut plugin_ctx)?;

    log::info!(
        "[Phase 45] PluginHost wired ({} plugins, topo order: {:?})",
        host.count(),
        order
    );

    Ok(host)
}
