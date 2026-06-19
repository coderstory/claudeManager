//! macOS stub of [`IPlatformReveal`]. Real impl will spawn `open -R <path>`.

use std::path::Path;

use crate::platform::traits::{IPlatformReveal, PlatformError};

pub struct MacReveal;

impl IPlatformReveal for MacReveal {
    fn reveal(&self, _path: &Path) -> Result<(), PlatformError> {
        unimplemented!("MacReveal::reveal — will spawn `open -R`")
    }
}
