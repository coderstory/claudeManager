//! F8 (removed M5 #18, kept for About page) — app metadata (plugin commands).
//!
//! Phase 42 physical migration: 1 `#[tauri::command]` fn from
//! `src-tauri/src/commands/app.rs::get_app_metadata` → this module's
//! `dispatch_get_app_metadata` shim + 1 `inventory::submit!` registration.
//!
//! Why a stub (not just delete): the About page frontend
//! (`src/pages/about/index.tsx`) calls `invoke('get_app_metadata')`
//! on mount. Without the command registered via inventory, Tauri
//! returns "Command get_app_metadata not found" and the About page
//! crashes.

use tauri::ipc::Invoke;
use tauri::Manager;

use crate::app_state::AppState;
use crate::plugins::dispatch::CommandSpec;

// ---------------------------------------------------------------------------
// AppMetadata (mirror of commands::app::AppMetadata)
// ---------------------------------------------------------------------------

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub struct AppMetadata {
    pub version: String,
    pub identifier: String,
    pub product_name: String,
    pub git_commit: String,
    pub build_target: String,
    pub build_timestamp: i64,
    pub homepage_url: String,
}

const PRODUCT_NAME: &str = "ClaudeManager";
const DISPLAY_IDENTIFIER: &str = "com.claudemanager.app";
const HOMEPAGE_URL: &str = "https://github.com/coderstory/claudeManager";

impl AppMetadata {
    fn current() -> Self {
        let git_commit = env!("BUILD_GIT_COMMIT").to_string();
        let build_timestamp: i64 = env!("BUILD_TIMESTAMP").parse().unwrap_or(0);
        let build_target = format!("{}/{}", std::env::consts::OS, std::env::consts::ARCH);
        Self {
            version: env!("CARGO_PKG_VERSION").to_string(),
            identifier: DISPLAY_IDENTIFIER.to_string(),
            product_name: PRODUCT_NAME.to_string(),
            git_commit,
            build_target,
            build_timestamp,
            homepage_url: HOMEPAGE_URL.to_string(),
        }
    }
}

// ---------------------------------------------------------------------------
// dispatch_get_app_metadata
// ---------------------------------------------------------------------------

/// F8 (removed) → About page — return build-time + runtime app
/// metadata. Pure (no I/O); `state` is unused but threaded for
/// parity with the other commands.
pub fn dispatch_get_app_metadata(invoke: Invoke<tauri::Wry>) -> bool {
    let app = invoke.message.webview().app_handle().clone();
    tauri::async_runtime::block_on(async move {
        let _s: tauri::State<AppState> = app.state::<AppState>();
        let result: Result<AppMetadata, String> = Ok(AppMetadata::current());
        invoke.resolver.respond(result.map_err(Into::into));
    });
    true
}

// ---------------------------------------------------------------------------
// inventory::submit! registrations
// ---------------------------------------------------------------------------

inventory::submit!(CommandSpec {
    name: "get_app_metadata",
    plugin_id: "app",
    dispatch: dispatch_get_app_metadata,
});
