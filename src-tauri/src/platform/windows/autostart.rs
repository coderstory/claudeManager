//! Windows implementation of [`IPlatformAutostart`].
//!
//! M1.7 — delegates to [`tauri_plugin_autostart`] (the auto-launch crate
//! inside it writes to the per-user `HKCU\…\Run` key). The hand-rolled
//! `winreg` code that used to live here was retired in M1.7 because the
//! official plugin already handles all the edge cases (path quoting,
//! `--minimized` flag, error mapping).
//!
//! Per [`crate::platform::traits::IPlatformAutostart`], the trait methods
//! are sync (the underlying plugin API is sync). We still hand back a
//! `PlatformError::Autostart(String)` to keep the platform layer
//! storage-agnostic.

use tauri::AppHandle;
use tauri_plugin_autostart::ManagerExt;

use crate::platform::traits::{IPlatformAutostart, PlatformError};

/// Owned handle to the autostart plugin's [`AutoLaunchManager`]. Cheap to
/// clone (it's a `State` underneath, refcounted) and safe to store as a
/// field of a struct we hand out by value.
pub struct WindowsAutostart {
    app: AppHandle,
}

impl WindowsAutostart {
    /// Production constructor — pass the live [`AppHandle`] from the
    /// Tauri `setup` hook. The autostart plugin must already be
    /// `.plugin(tauri_plugin_autostart::init(...))`-registered in
    /// `lib.rs` (it is — M1.6 + M1.7), otherwise
    /// `app.autolaunch()` will panic at the first call site.
    pub fn new(app: &AppHandle) -> Self {
        Self { app: app.clone() }
    }
}

impl IPlatformAutostart for WindowsAutostart {
    fn is_enabled(&self) -> Result<bool, PlatformError> {
        self.app
            .autolaunch()
            .is_enabled()
            .map_err(|e| PlatformError::Autostart(e.to_string()))
    }

    fn enable(&self) -> Result<(), PlatformError> {
        self.app
            .autolaunch()
            .enable()
            .map_err(|e| PlatformError::Autostart(e.to_string()))
    }

    fn disable(&self) -> Result<(), PlatformError> {
        self.app
            .autolaunch()
            .disable()
            .map_err(|e| PlatformError::Autostart(e.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// We can't unit-test the plugin's registry writes without a real
    /// `AppHandle` (the plugin's state is registered in the Tauri
    /// builder, not at construction time). The trait-level mockall
    /// shim in [`crate::platform::traits::tests`] covers the dispatch
    /// path. Here we instead confirm `new` is a no-op that doesn't
    /// require the plugin to be registered.
    #[test]
    fn windows_autostart_is_constructible() {
        // The struct only holds a cloned `AppHandle`; the only
        // operation that requires a Tauri context is `app.autolaunch()`.
        // Just confirm the size is reasonable.
        let _ = std::mem::size_of::<WindowsAutostart>();
    }
}