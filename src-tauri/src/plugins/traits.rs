//! Plugin system — trait surface.
//!
//! Every large feature module in Claude Config Manager is a *plugin*
//! implementing [`IPlugin`]. The plugin system (M1.3) ships only
//! **stubs** — real business logic lands in M2+ per [`CLAUDE.md` §3.3`].
//!
//! Layout under this module:
//! - [`traits`]  — the `IPlugin` contract, [`PluginRoute`], [`PluginService`]
//!                 and [`PluginContext`]
//! - [`host`]    — `PluginHost` (registry + lifecycle)
//! - [`stubs`]   — one stub plugin per F1..F12 feature
//!
//! [`CLAUDE.md` §3.3`]: ../../../../../CLAUDE.md

use std::fmt;
use std::ptr::NonNull;
use thiserror::Error;

use tauri::AppHandle;

use crate::platform::{IPlatformPaths, PlatformError};
use crate::plugins::menu_registry::{PluginAppMenuItem, PluginTrayItem};
use crate::plugins::service_registry::ServiceRegistry;

// ---------------------------------------------------------------------------
// PluginRoute
// ---------------------------------------------------------------------------

/// A single route a plugin contributes to the frontend router.
///
/// Frontend mirror lives in `src/plugins/types.ts::RouteDef` — keep the
/// `path` + `display_name` shape in sync.
#[derive(Debug, Clone)]
pub struct PluginRoute {
    /// URL path, e.g. `"/mcp"`. The frontend uses this as the React Router
    /// `path` prop.
    pub path: String,
    /// Owning plugin id (kebab-case). The frontend uses it to attribute
    /// rendered routes back to the plugin.
    pub plugin_id: &'static str,
    /// Human-readable name shown in nav, e.g. `"MCP 管理"`.
    pub display_name: String,
}

// ---------------------------------------------------------------------------
// PluginService
// ---------------------------------------------------------------------------

/// A backend service a plugin registers (for future DI / cross-plugin use).
///
/// For M1.3 every stub returns an empty `services()` list — real services
/// land in M2+. The trait exists now so the host's API is stable.
pub trait PluginService: Send + Sync {
    /// Stable kebab-case service name, e.g. `"provider-service"`.
    fn name(&self) -> &'static str;
}

// ---------------------------------------------------------------------------
// PluginContext
// ---------------------------------------------------------------------------

/// Context provided to each plugin during [`IPlugin::init`].
///
/// **Phase 43 / D-CC-A** — this struct is now 4-field and final. The
/// decision lives in `.planning/milestones/v3.4-DECISIONS.md`
/// (D-CC-A block). Adding/removing fields here is a breaking change
/// and must go through the CLAUDE.md §2.5 negotiation process.
///
/// Carries references to the Tauri [`AppHandle`], the platform
/// abstraction layer, the plugin host (so a plugin can look up its
/// peers — used by the `core` plugin to wire the tray / AppMenu),
/// and the [`ServiceRegistry`] for DI (Phase 45 fills it).
///
/// [`CLAUDE.md` §3.2`]: ../../../../../CLAUDE.md
pub struct PluginContext<'a> {
    /// Tauri app handle. `None` only in unit tests that don't exercise
    /// plugins that touch the Tauri runtime; production code should
    /// always populate it via [`PluginContext::new`].
    pub app: Option<&'a AppHandle>,
    pub paths: &'a dyn IPlatformPaths,
    /// The plugin host (Phase 43, D-CC-A 4th field). Lets a plugin's
    /// `init` look up other plugins — e.g. the `core` plugin walks
    /// `host.iter()` to collect tray / AppMenu contributions.
    ///
    /// Stored as a `NonNull<PluginHost>` (raw pointer + niche) instead
    /// of a `&PluginHost` because `PluginHost::init_all` needs
    /// `&mut self` on the host while the context holds a reference
    /// to it. The borrow checker rejects `&mut host` + `&host` held
    /// simultaneously; a raw pointer sidesteps that without forcing
    /// the entire host through `Arc<Mutex<…>>`. The contract is that
    /// the host outlives the context — Tauri holds the host for the
    /// lifetime of the app, and init runs before any plugin drops
    /// the context, so this is upheld trivially in practice.
    ///
    /// Access via [`PluginContext::host`].
    host: Option<NonNull<crate::plugins::host::PluginHost>>,
    /// The service registry (Phase 42 / D-45-A). Phase 45 plugins
    /// call `ctx.services.register_arc::<T>(svc)` from `init`; today
    /// it stays empty.
    pub services: Option<&'a mut ServiceRegistry>,
}

impl<'a> PluginContext<'a> {
    /// Production constructor — pass the live [`AppHandle`], paths,
    /// host, and (when needed) the mutable [`ServiceRegistry`].
    ///
    /// `services` is optional so legacy callers that haven't yet
    /// built a registry (or test code) can pass `None`. `host` is
    /// required because the `core` plugin's `init` depends on it.
    ///
    /// `host` is taken as `*const PluginHost` (raw pointer) so the
    /// caller can keep `&mut host` for `PluginHost::init_all` after
    /// constructing the context — a normal `&PluginHost` parameter
    /// would create a shared borrow that NLL extends across the
    /// `init_all` call and reject it.
    ///
    /// # Safety contract
    ///
    /// Caller must guarantee that the host outlives the context.
    /// In production this is upheld because `init_all` constructs
    /// both the host and the context together, and the host lives
    /// in `app.manage(Mutex::new(host))` for the rest of the app.
    pub fn new(
        app: &'a AppHandle,
        paths: &'a dyn IPlatformPaths,
        host: *const crate::plugins::host::PluginHost,
        services: Option<&'a mut ServiceRegistry>,
    ) -> Self {
        Self {
            app: Some(app),
            paths,
            host: NonNull::new(host as *mut _),
            services,
        }
    }

    /// Test-only constructor — builds a context with no Tauri handle,
    /// no host, and no registry. Real plugins must not be initialised
    /// through this in production.
    #[cfg(test)]
    pub fn for_tests(paths: &'a dyn IPlatformPaths) -> Self {
        Self {
            app: None,
            paths,
            host: None,
            services: None,
        }
    }

    /// Borrow the plugin host immutably. `None` in test contexts that
    /// didn't wire a host. The returned reference is tied to
    /// `&self` (not `'a`) — that's fine because `PluginHost::init_all`
    /// only borrows the host mutably while the iteration runs, not
    /// for the whole lifetime of the context.
    ///
    /// # Safety contract
    ///
    /// Caller must guarantee that the host outlives the borrow. In
    /// production this is upheld because:
    /// 1. The host is built in `lib.rs::setup` and stored via
    ///    `app.manage(Mutex::new(host))` for the lifetime of the app.
    /// 2. `PluginContext` is only constructed inside `setup` and
    ///    dropped before `setup` returns.
    pub fn host(&self) -> Option<&crate::plugins::host::PluginHost> {
        self.host.map(|p| unsafe { p.as_ref() })
    }
}

// ---------------------------------------------------------------------------
// IPlugin
// ---------------------------------------------------------------------------

/// The plugin contract. Every feature module implements this trait.
///
/// # Object safety
/// The trait is object-safe: `Box<dyn IPlugin>` is the storage form used by
/// [`crate::plugins::host::PluginHost`]. All methods take `&self` / `&mut self`
/// (not `Self`), and there are no associated types or generic params.
pub trait IPlugin: Send + Sync {
    /// Stable, kebab-case identifier (e.g. `"provider-list"`).
    /// Must be unique across the whole registry.
    fn id(&self) -> &'static str;

    /// Human-readable name (e.g. `"Provider 列表"`).
    fn name(&self) -> &'static str;

    /// Routes the plugin contributes to the frontend router.
    /// Empty for action-only plugins (e.g. `provider-switch`).
    fn routes(&self) -> Vec<PluginRoute> {
        Vec::new()
    }

    /// Backend services this plugin registers.
    /// Empty for frontend-only plugins.
    fn services(&self) -> Vec<Box<dyn PluginService>> {
        Vec::new()
    }

    /// **Phase 43 (D-CC-A / Q43-1..3)** — system tray menu entries this
    /// plugin contributes. Empty by default (the 13 feature stubs in
    /// M1.x don't touch the tray). The `core` plugin owns the standard
    /// "show / quit" entries.
    ///
    /// `MenuRegistry::build_tray` walks the plugin host in registration
    /// order and concatenates every plugin's `tray_items()` into one
    /// `Menu`. Action ids should follow the `"<plugin_id>:<action>"`
    /// convention so `unregister_actions` can clean them up by prefix.
    fn tray_items(&self) -> Vec<PluginTrayItem> {
        Vec::new()
    }

    /// **Phase 43 (D-CC-A / Q43-1..3)** — macOS application menu
    /// entries this plugin contributes. Empty on Windows (the `core`
    /// plugin owns the standard App / Edit / View / Window submenus).
    /// On macOS, `MenuRegistry::build_app_menu` groups items by the
    /// `submenu` field.
    fn app_menu_items(&self) -> Vec<PluginAppMenuItem> {
        Vec::new()
    }

    /// Called once at app startup. Use to register Tauri commands,
    /// IPC handlers, etc. Default = no-op.
    ///
    /// **Phase 43 (D-CC-A)** — `ctx` is `&mut PluginContext` so plugins
    /// can register services into [`ServiceRegistry`]. Plugins that
    /// don't need to mutate the context can ignore it.
    fn init(&mut self, _ctx: &mut PluginContext) -> Result<(), PluginError> {
        Ok(())
    }

    /// Called at app shutdown. Reverse of [`init`]. Default = no-op.
    fn shutdown(&mut self) -> Result<(), PluginError> {
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// PluginError
// ---------------------------------------------------------------------------

#[derive(Debug, Error)]
pub enum PluginError {
    /// `init` returned Err from a plugin. Wraps the plugin's error message.
    #[error("plugin init failed: {0}")]
    InitFailed(String),

    /// Two plugins were registered with the same id.
    #[error("duplicate plugin id: {0}")]
    DuplicateId(&'static str),

    /// `unregister` was called with an id that isn't in the registry.
    #[error("plugin not found: {0}")]
    NotFound(String),

    /// Platform-layer error (file I/O, registry, etc.) bubbled up through
    /// a plugin's `init` / `shutdown`.
    #[error("platform error: {0}")]
    Platform(#[from] PlatformError),
}

// ---------------------------------------------------------------------------
// Display helper for plugins (used in debug logs)
// ---------------------------------------------------------------------------

impl fmt::Display for dyn IPlugin {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Plugin(id={}, name={})", self.id(), self.name())
    }
}
