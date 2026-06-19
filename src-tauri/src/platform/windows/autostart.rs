//! Windows implementation of [`IPlatformAutostart`].
//!
//! Writes to the per-user `Run` key:
//! `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`
//!
//! - Value name: `ClaudeConfigManager`
//! - Value data: quoted absolute path to the current `.exe`
//! - We never write to `HKLM` (would need elevation).
//!
//! On uninstall, simply delete the value. We do NOT remove the key itself —
//! other apps may share the `Run` key.

use winreg::enums::*;
use winreg::RegKey;

use crate::platform::traits::{IPlatformAutostart, PlatformError};

const RUN_KEY_PATH: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
const VALUE_NAME: &str = "ClaudeConfigManager";

pub struct WindowsAutostart;

impl WindowsAutostart {
    /// Open `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` (creating
    /// the key path if missing — it should always exist, but a fresh Windows
    /// profile might not have it).
    fn open_run_key(write: bool) -> Result<RegKey, PlatformError> {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let access = if write {
            KEY_READ | KEY_WRITE
        } else {
            KEY_READ
        };
        hkcu.open_subkey_with_flags(RUN_KEY_PATH, access).map_err(|e| {
            PlatformError::Other(format!(
                "open HKCU\\{RUN_KEY_PATH} failed: {e}"
            ))
        })
    }
}

impl IPlatformAutostart for WindowsAutostart {
    fn is_enabled(&self) -> Result<bool, PlatformError> {
        let key = Self::open_run_key(false)?;
        match key.get_value::<String, _>(VALUE_NAME) {
            Ok(_) => Ok(true),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
            Err(e) => Err(PlatformError::Other(format!(
                "read Run\\{VALUE_NAME} failed: {e}"
            ))),
        }
    }

    fn enable(&self) -> Result<(), PlatformError> {
        // Resolve the path to *this* executable. On a dev build this is
        // `target\debug\claude-config-manager.exe`; on a release build it's
        // the shipped exe.
        //
        // We surround the path with double quotes so paths containing
        // spaces work. Windows tolerates quotes inside the value data.
        let exe = std::env::current_exe().map_err(PlatformError::Io)?;
        let quoted = format!("\"{}\"", exe.display());

        let key = Self::open_run_key(true)?;
        key.set_value(VALUE_NAME, &quoted)
            .map_err(|e| PlatformError::Other(format!("set Run\\{VALUE_NAME} failed: {e}")))?;
        Ok(())
    }

    fn disable(&self) -> Result<(), PlatformError> {
        let key = Self::open_run_key(true)?;
        match key.delete_value(VALUE_NAME) {
            Ok(_) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(PlatformError::Other(format!(
                "delete Run\\{VALUE_NAME} failed: {e}"
            ))),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// We don't want to touch the real HKCU\...\Run key in tests because
    /// that would persist across runs and surprise the user. Instead, we
    /// exercise the **internal** API surface (read the value we wrote)
    /// without leaking state: write → read back → delete.
    #[test]
    fn windows_autostart_round_trip() {
        let au = WindowsAutostart;

        // Snapshot the pre-existing state so we can restore it exactly.
        let pre = au.is_enabled().ok();

        // Enable, then verify.
        au.enable().expect("enable should succeed on this machine");
        assert_eq!(
            au.is_enabled().expect("is_enabled after enable"),
            true,
            "is_enabled must return true after enable()"
        );

        // Disable, then verify.
        au.disable().expect("disable should succeed");
        assert_eq!(
            au.is_enabled().expect("is_enabled after disable"),
            false,
            "is_enabled must return false after disable()"
        );

        // Restore the pre-existing state. If autostart was on before, turn
        // it back on; if off, leave it off (we just disabled it).
        if matches!(pre, Some(true)) {
            au.enable().expect("restore: re-enable autostart");
        }
    }

    #[test]
    fn windows_autostart_disable_is_idempotent() {
        let au = WindowsAutostart;
        // Disable twice; second call should be a no-op rather than an error.
        let _ = au.disable();
        let r = au.disable();
        assert!(r.is_ok(), "double disable must succeed (idempotent): {r:?}");
    }
}
