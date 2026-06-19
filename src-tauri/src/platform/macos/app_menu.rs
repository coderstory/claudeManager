//! macOS implementation stub of [`IPlatformAppMenu`]. This is one of the
//! two traits that **only** apply to macOS (the other being
//! `IPlatformWindowChrome::apply(vibrancy=…)`). Real impl will call
//! `[NSApp setMainMenu:]` with a programmatically constructed `NSMenu`.
//!
//! On non-mac builds the trait method is expected to return
//! [`PlatformError::NotSupported`]; this stub follows the same pattern
//! (signature exists, body unimplemented) so the macOS code path is
//! discoverable when the mac build lands.

use crate::platform::traits::{IPlatformAppMenu, PlatformError};

pub struct MacAppMenu;

impl IPlatformAppMenu for MacAppMenu {
    fn build_app_menu(&self) -> Result<(), PlatformError> {
        unimplemented!("MacAppMenu::build_app_menu — will build NSMenu and set [NSApp setMainMenu:]")
    }
}
