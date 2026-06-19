//! macOS stub of [`IPlatformNotifier`]. Real impl will use
//! `UNUserNotificationCenter` (the modern `NSUserNotification` API is
//! deprecated since macOS 11).

use crate::platform::traits::{IPlatformNotifier, PlatformError};

pub struct MacNotifier;

impl IPlatformNotifier for MacNotifier {
    fn notify(&self, _title: &str, _body: &str) -> Result<(), PlatformError> {
        unimplemented!("MacNotifier::notify — will use UNUserNotificationCenter")
    }
}
