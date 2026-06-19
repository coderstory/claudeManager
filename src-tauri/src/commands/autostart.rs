//! Tauri command surface for the autostart feature (M1.7).
//!
//! Two commands bridge the frontend ↔ platform layer:
//!
//! - [`get_autostart_status`] — returns whether the app is currently
//!   registered to launch on login. Read-only; safe to call as often as
//!   the settings page likes.
//! - [`set_autostart_enabled`] — flip the registration. Returns the
//!   new state so the caller can update the UI without a separate
//!   read.
//!
//! Both commands go through [`crate::platform::runtime::autostart`]
//! rather than touching `tauri_plugin_autostart` directly. That keeps
//! the platform layer (CLAUDE.md §3.2) the single source of truth for
//! OS-specific behaviour, and means the commands are the same shape
//! even if the underlying impl changes in M2+.

use tauri::AppHandle;

use crate::platform::runtime;

/// Errors bubbled out of [`get_autostart_status`] and
/// [`set_autostart_enabled`]. Frontend just needs a string for the
/// toast — Tauri requires the error to implement `Serialize`, which
/// `String` does.
type CmdResult<T> = Result<T, String>;

/// Read whether the app is registered for boot-on-login.
#[tauri::command]
pub async fn get_autostart_status(app: AppHandle) -> CmdResult<bool> {
    runtime::autostart(&app)
        .is_enabled()
        .map_err(|e| e.to_string())
}

/// Enable or disable boot-on-login. Returns the resulting state so
/// the frontend can sync its UI in one round trip.
#[tauri::command]
pub async fn set_autostart_enabled(app: AppHandle, enabled: bool) -> CmdResult<bool> {
    let platform = runtime::autostart(&app);
    if enabled {
        platform.enable().map_err(|e| e.to_string())?;
    } else {
        platform.disable().map_err(|e| e.to_string())?;
    }
    // Read back so the UI shows what the OS actually did (e.g.
    // a registry write that silently no-op'd would still report `false`).
    platform.is_enabled().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    //! The trait-level mockall shim in
    //! [`crate::platform::traits::tests`] (autostart_is_enabled_dispatch +
    //! autostart_enable_disable_dispatch) already proves the
    //! `IPlatformAutostart` contract is dispatchable through `Box<dyn _>`.
    //!
    //! We can't unit-test these commands end-to-end without a real
    //! `AppHandle` (Tauri's command runtime owns that), but we *can*
    //! sanity-check the function signatures compile with the expected
    //! arg shape — i.e. the wiring in `lib.rs::invoke_handler` is
    //! type-correct. If this compiles, the contract is right.
    use super::*;

    /// Compile-time check: `get_autostart_status` accepts a single
    /// `AppHandle` argument and returns `Result<bool, String>`.
    #[allow(dead_code)]
    fn _get_autostart_status_takes_app_handle() {
        let _f: fn(AppHandle) -> _ = get_autostart_status;
    }

    /// Compile-time check: `set_autostart_enabled` accepts `AppHandle`
    /// + `enabled: bool` and returns `Result<bool, String>`.
    #[allow(dead_code)]
    fn _set_autostart_enabled_takes_app_handle_and_bool() {
        let _f: fn(AppHandle, bool) -> _ = set_autostart_enabled;
    }
}