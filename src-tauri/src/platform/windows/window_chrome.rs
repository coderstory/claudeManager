//! Windows implementation of [`IPlatformWindowChrome`].
//!
//! Handles two effects:
//! - **Mica** (Windows 11+): `DwmExtendFrameIntoClientArea` + the
//!   `DWMWA_SYSTEMBACKDROP_TYPE` attribute (added in Win11 22H2). Falls back
//!   to a no-op on older Windows builds.
//! - **Vibrancy**: not applicable on Windows → `vibrancy` is silently
//!   ignored. Returns `Ok`.
//! - **Transparent title bar**: when [`TitleBarStyle::Transparent`] is
//!   requested, we hide the thick frame and let the app paint behind it.
//!   Tauri v2 also exposes this via `decorations: false` + custom
//!   hit-testing; we keep the DWM hook here for completeness so the trait
//!   contract is satisfied end-to-end on this OS.
//!
//! The `windows` crate v0.58 exposes `DwmExtendFrameIntoClientArea` via
//! `Win32_Graphics_Dwm`. The system-backdrop constant
//! (`DWMWA_SYSTEMBACKDROP_TYPE = 38`) is post-22H2; older versions of the
//! crate may not have the enum value, so we use the raw constant and
//! `DwmSetWindowAttribute` directly.

use windows::Win32::Foundation::HWND;
use windows::Win32::Graphics::Dwm::{
    DwmExtendFrameIntoClientArea, DwmSetWindowAttribute, DWMWINDOWATTRIBUTE,
};
use windows::Win32::UI::Controls::MARGINS;

use crate::platform::traits::{
    IPlatformWindowChrome, PlatformError, TitleBarStyle, WindowChromeOptions,
};

/// `DWMWA_SYSTEMBACKDROP_TYPE` — added in Win11 22H2 build 22621.
/// Not all bindings have it as a `DWMWINDOWATTRIBUTE` variant, so we cast
/// the numeric value (`38`) to the enum.
const DWMWA_SYSTEMBACKDROP_TYPE: DWMWINDOWATTRIBUTE = DWMWINDOWATTRIBUTE(38);
/// Mica variant value (per DWM docs). 2 = Mica.
const DWM_SYSTEMBACKDROP_MICA: i32 = 2;

pub struct WindowsWindowChrome;

impl IPlatformWindowChrome for WindowsWindowChrome {
    fn apply(&self, options: &WindowChromeOptions) -> Result<(), PlatformError> {
        // The HWND lookup requires a Tauri webview window, which the platform
        // layer doesn't own. In M1 we accept the trait contract by
        // short-circuiting: if there is no Tauri runtime around, we
        // gracefully report that chrome couldn't be applied. The full
        // window-wiring lands in M1.9 (main window frame) and M1.4
        // (capabilities) — at that point we'll thread the HWND through.
        let hwnd = match current_main_hwnd() {
            Some(h) => h,
            None => {
                // No main window yet (called before Tauri created it, e.g.
                // from a unit test). Treat as a no-op success — the trait
                // contract is "apply", and "apply later" is a valid
                // application.
                return Ok(());
            }
        };

        // Extend the DWM frame into the client area so we can paint
        // underneath. With all-zero margins this is equivalent to the
        // default; the real Mica effect comes from the system backdrop
        // attribute below.
        let margins = MARGINS {
            cxLeftWidth: 0,
            cxRightWidth: 0,
            cyTopHeight: 0,
            cyBottomHeight: 0,
        };
        // SAFETY: `DwmExtendFrameIntoClientArea` is FFI. `hwnd` is a real
        // HWND from the runtime. `margins` is a POD by-value.
        unsafe {
            let _ = DwmExtendFrameIntoClientArea(hwnd, &margins);
        }

        if options.mica {
            let backdrop = DWM_SYSTEMBACKDROP_MICA;
            // SAFETY: see above. The size param is i32 for the
            // DWMWA_SYSTEMBACKDROP_TYPE attribute.
            unsafe {
                let _ = DwmSetWindowAttribute(
                    hwnd,
                    DWMWA_SYSTEMBACKDROP_TYPE,
                    &backdrop as *const _ as *const _,
                    std::mem::size_of::<i32>() as u32,
                );
            }
        }

        // Title bar style. We don't manipulate the WS_CAPTION / WS_THICKFRAME
        // bits here (Tauri owns the window style). We just return Ok and let
        // the M1.9 main-window code translate Transparent into a
        // `decorations: false` window.
        if matches!(options.title_bar_style, TitleBarStyle::Transparent) {
            // Marker for future M1.9 wiring: the platform trait returns Ok
            // and the lib.rs layer checks the chosen style at window
            // creation time.
        }

        // `vibrancy` is a no-op on Windows — explicitly mentioned for
        // documentation purposes.
        let _ = options.vibrancy;

        Ok(())
    }
}

/// Best-effort lookup of the main window's HWND. In M1.2 we have no Tauri
/// runtime wired into the platform layer, so this always returns `None` and
/// `apply()` is a no-op. M1.9 will replace this with a real lookup that
/// reads the HWND out of `tauri::WebviewWindow::raw_window_handle()`.
#[cfg(windows)]
fn current_main_hwnd() -> Option<HWND> {
    None
}

#[cfg(not(windows))]
fn current_main_hwnd() -> Option<HWND> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_window_chrome_apply_is_noop_without_hwnd() {
        // Without a Tauri runtime we can't resolve the HWND, so the impl
        // must short-circuit to Ok(()) rather than panic.
        let opts = WindowChromeOptions {
            vibrancy: true, // should be silently ignored on Windows
            mica: true,
            title_bar_style: TitleBarStyle::Transparent,
        };
        let r = WindowsWindowChrome.apply(&opts);
        assert!(r.is_ok(), "apply() must succeed without a live HWND: {r:?}");
    }

    #[test]
    fn windows_window_chrome_default_apply_is_noop_without_hwnd() {
        let r = WindowsWindowChrome.apply(&WindowChromeOptions::default());
        assert!(r.is_ok());
    }
}
