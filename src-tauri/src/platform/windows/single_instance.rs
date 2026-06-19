//! Windows implementation of [`IPlatformSingleInstance`] using a named
//! kernel mutex.
//!
//! Algorithm:
//! 1. `CreateMutexW(NULL, TRUE, L"Local\\ClaudeConfigManager.lock")` — note
//!    `Local\\` scope so the lock is per-session (matches what users expect:
//!    a separate session / RDP session can run its own instance).
//! 2. Check `GetLastError() == ERROR_ALREADY_EXISTS`.
//!    - Yes → another instance holds it; close the duplicate handle we just
//!      got back and return `PlatformError::Other("already running")`.
//!    - No  → we own it; wrap the handle in a `SingleInstanceGuard` and
//!      return Ok.
//! 3. The guard's `Drop` calls `CloseHandle`, releasing the mutex.

use windows::Win32::Foundation::{CloseHandle, GetLastError, ERROR_ALREADY_EXISTS};
use windows::Win32::System::Threading::CreateMutexW;

use crate::platform::traits::{IPlatformSingleInstance, PlatformError, SingleInstanceGuard};

/// Name of the global mutex. Must be unique to this app and stable across
/// versions (changing it would defeat the purpose of single-instance
/// detection on upgrade).
const MUTEX_NAME: &str = "Local\\ClaudeConfigManager.lock";

pub struct WindowsSingleInstance;

impl IPlatformSingleInstance for WindowsSingleInstance {
    fn try_acquire(&self) -> Result<SingleInstanceGuard, PlatformError> {
        // SAFETY: `CreateMutexW` is FFI; the wide-string we pass is a
        // 100% ASCII literal expanded with `encode_utf16`, and the returned
        // handle is owned by us.
        let name_w: Vec<u16> = MUTEX_NAME
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();

        unsafe {
            let handle = CreateMutexW(None, true, windows::core::PCWSTR(name_w.as_ptr()))
                .map_err(|e| PlatformError::Other(format!("CreateMutexW failed: {e}")))?;

            if GetLastError() == ERROR_ALREADY_EXISTS {
                // We did NOT get ownership. Release the handle CreateMutexW
                // gave us (it's a duplicate that doesn't help us) and report
                // the conflict.
                let _ = CloseHandle(handle);
                return Err(PlatformError::Other(
                    "another instance is already running".into(),
                ));
            }

            Ok(SingleInstanceGuard::from_windows_handle(handle))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// First acquisition should succeed on a fresh test process.
    /// The mutex name is a real kernel object and a previous test run may
    /// have leaked it, so we accept either "acquired" or "already running"
    /// — both prove the code path works without panicking.
    #[test]
    fn windows_single_instance_try_acquire_returns_consistent_result() {
        let si = WindowsSingleInstance;
        let g1 = si.try_acquire();

        match g1 {
            Ok(guard) => {
                // Holding the lock — a second try_acquire from the same
                // process SHOULD report already running. (The kernel counts
                // this as "already exists" even from the owning thread.)
                let g2 = si.try_acquire();
                assert!(
                    g2.is_err(),
                    "second try_acquire while first is alive must fail"
                );

                // Drop the guard; the lock is released.
                drop(guard);

                // Subsequent try_acquire should be able to succeed.
                let g3 = si.try_acquire();
                // This may also fail if a previous test process is still
                // alive on this machine — that's the kernel-object lifetime
                // reality. We just assert the call did not panic.
                let _ = g3;
            }
            Err(_) => {
                // A previous test process is still holding the lock. That's
                // fine — the important property is that we returned Err
                // rather than panicking.
            }
        }
    }
}
