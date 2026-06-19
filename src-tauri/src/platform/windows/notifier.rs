//! Windows implementation of [`IPlatformNotifier`].
//!
//! Uses the standard `tauri-plugin-notification` API. The plugin wraps the
//! WinRT `Windows.UI.Notifications` toast APIs, which require an AUMID
//! (Application User Model ID) on Windows 10+; the app identifier from
//! `tauri.conf.json` (`com.claudeconfigmanager.app`) is used automatically.
//!
//! We do NOT take a direct dependency on the plugin crate here — it's the
//! app's responsibility to register the plugin. This impl just provides a
//! `Notify` shim that callers can use without pulling plugin types into
//! the platform layer. In M1 we keep it dependency-free and document that
//! the real wiring lands in M1.4 (capabilities + plugin registration).

use crate::platform::traits::{IPlatformNotifier, PlatformError};

pub struct WindowsNotifier;

impl IPlatformNotifier for WindowsNotifier {
    fn notify(&self, title: &str, body: &str) -> Result<(), PlatformError> {
        // The actual toast is wired up in M1.4 via tauri-plugin-notification.
        // For M1.2 we just log the intent so callers can be plumbed through
        // business code without panic.
        //
        // M1.4 follow-up: replace this stub with:
        //   use tauri_plugin_notification::NotificationExt;
        //   app_handle
        //       .notification()
        //       .builder()
        //       .title(title)
        //       .body(body)
        //       .show()
        //       .map_err(|e| PlatformError::Other(e.to_string()))?;
        eprintln!("[WindowsNotifier] (stub) title={title:?} body_len={}", body.len());
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_notifier_stub_returns_ok() {
        let r = WindowsNotifier.notify("hello", "world");
        assert!(r.is_ok(), "stub notifier must succeed: {r:?}");
    }

    #[test]
    fn windows_notifier_stub_handles_empty_strings() {
        let r = WindowsNotifier.notify("", "");
        assert!(r.is_ok(), "empty inputs must not panic");
    }
}
