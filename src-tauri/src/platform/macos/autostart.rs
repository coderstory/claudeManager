//! macOS stub of [`IPlatformAutostart`]. Real impl will write a
//! `~/Library/LaunchAgents/com.claudeconfigmanager.app.plist` file with
//! the standard `LaunchAgent` keys (Label / ProgramArguments / RunAtLoad).

use crate::platform::traits::{IPlatformAutostart, PlatformError};

pub struct MacAutostart;

impl IPlatformAutostart for MacAutostart {
    fn is_enabled(&self) -> Result<bool, PlatformError> {
        unimplemented!("MacAutostart::is_enabled — will inspect LaunchAgent plist")
    }

    fn enable(&self) -> Result<(), PlatformError> {
        unimplemented!("MacAutostart::enable — will write LaunchAgent plist")
    }

    fn disable(&self) -> Result<(), PlatformError> {
        unimplemented!("MacAutostart::disable — will remove LaunchAgent plist")
    }
}
