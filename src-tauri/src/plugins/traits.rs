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
use thiserror::Error;

use tauri::AppHandle;

use crate::platform::{IPlatformPaths, PlatformError};

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
/// Carries references to the Tauri [`AppHandle`] and to the platform
/// abstraction layer. Plugins MUST go through [`IPlatformPaths`] for any
/// file path resolution (per [`CLAUDE.md` §3.2`]).
///
/// Future: services registry, event bus, etc.
///
/// [`CLAUDE.md` §3.2`]: ../../../../../CLAUDE.md
pub struct PluginContext<'a> {
    /// Tauri app handle. `None` only in unit tests that don't exercise
    /// plugins that touch the Tauri runtime; production code should
    /// always populate it via [`PluginContext::new`].
    pub app: Option<&'a AppHandle>,
    pub paths: &'a dyn IPlatformPaths,
}

impl<'a> PluginContext<'a> {
    /// Production constructor — pass the live [`AppHandle`].
    pub fn new(app: &'a AppHandle, paths: &'a dyn IPlatformPaths) -> Self {
        Self { app: Some(app), paths }
    }

    /// Test-only constructor — builds a context with no Tauri handle.
    /// Real plugins must not be initialised through this in production.
    #[cfg(test)]
    pub fn for_tests(paths: &'a dyn IPlatformPaths) -> Self {
        Self { app: None, paths }
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

    /// Called once at app startup. Use to register Tauri commands,
    /// IPC handlers, etc. Default = no-op.
    fn init(&mut self, _ctx: &PluginContext) -> Result<(), PluginError> {
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
