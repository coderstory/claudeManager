//! macOS stub of [`IPlatformSingleInstance`]. Real impl will use
//! `NSAppleEventManager` + `kAEGetURL` to forward `.sql` double-clicks
//! into the running instance.

use crate::platform::traits::{IPlatformSingleInstance, PlatformError, SingleInstanceGuard};

pub struct MacSingleInstance;

impl IPlatformSingleInstance for MacSingleInstance {
    fn try_acquire(&self) -> Result<SingleInstanceGuard, PlatformError> {
        unimplemented!("MacSingleInstance::try_acquire — will use NSAppleEventManager")
    }
}
