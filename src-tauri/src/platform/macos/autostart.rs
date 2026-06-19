//! macOS implementation of [`IPlatformAutostart`].
//!
//! M1.7 — delegates to [`tauri_plugin_autostart`]. With
//! `MacosLauncher::LaunchAgent` (set in `lib.rs`), the plugin writes a
//! `~/Library/LaunchAgents/<bundle-id>.plist` on enable and deletes it
//! on disable.
//!
//! The plugin's own implementation handles `.app` bundle path resolution
//! and the `LSUIElement` quirks of a background app, so this wrapper
//! stays trivially thin. Any M2+ customisation (e.g. injecting
//! `RunAtLoad` keys that cc-switch manages by hand) can be done here
//! without touching the trait surface.

use tauri::AppHandle;
use tauri_plugin_autostart::ManagerExt;

use crate::platform::traits::{IPlatformAutostart, PlatformError};

pub struct MacAutostart {
    app: AppHandle,
}

impl MacAutostart {
    pub fn new(app: &AppHandle) -> Self {
        Self { app: app.clone() }
    }
}

impl IPlatformAutostart for MacAutostart {
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