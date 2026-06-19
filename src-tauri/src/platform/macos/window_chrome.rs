//! macOS stub of [`IPlatformWindowChrome`]. Real impl will use
//! `NSVisualEffectView` to set the window's `backgroundColor` / `appearance`
//! for the vibrancy effect, and `window.titlebarAppearsTransparent` +
//! `window.titleVisibility` for the transparent title bar.

use crate::platform::traits::{IPlatformWindowChrome, PlatformError, WindowChromeOptions};

pub struct MacWindowChrome;

impl IPlatformWindowChrome for MacWindowChrome {
    fn apply(&self, _options: &WindowChromeOptions) -> Result<(), PlatformError> {
        unimplemented!("MacWindowChrome::apply — will use NSVisualEffectView + NSWindow APIs")
    }
}
