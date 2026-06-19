//! Windows stub of [`IPlatformAppMenu`].
//!
//! The app menu (NSMenu / global menubar) is a macOS concept. Windows uses
//! per-window menus instead, which Tauri's tray-icon menu already covers
//! (see `lib.rs` tray setup). The Windows impl therefore returns
//! [`PlatformError::NotSupported`] for any caller that mistakenly wires this
//! trait on a non-mac build.

use crate::platform::traits::{IPlatformAppMenu, PlatformError};

pub struct WindowsAppMenu;

impl IPlatformAppMenu for WindowsAppMenu {
    fn build_app_menu(&self) -> Result<(), PlatformError> {
        Err(PlatformError::NotSupported)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_app_menu_is_not_supported() {
        let r = WindowsAppMenu.build_app_menu();
        assert!(matches!(r, Err(PlatformError::NotSupported)));
    }
}
