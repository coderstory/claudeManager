//! macOS stub of [`IPlatformPaths`].
//!
//! Real implementation lands when this project gets a mac build. The
//! signature exists now so the trait contract is verifiable at compile
//! time — the only Windows build is exercised today.

use crate::platform::traits::{AppPaths, IPlatformPaths, PlatformError};

pub struct MacPaths;

impl IPlatformPaths for MacPaths {
    fn resolve(&self) -> AppPaths {
        unimplemented!("MacPaths::resolve — will land when mac build starts")
    }

    fn ensure_dirs(&self) -> Result<(), PlatformError> {
        unimplemented!("MacPaths::ensure_dirs — will land when mac build starts")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// We don't have a Mac build to actually exercise this; the test
    /// simply confirms the struct exists and that `resolve` is callable
    /// from a `dyn IPlatformPaths` (i.e. the trait object is well-formed).
    #[test]
    fn mac_paths_is_object_safe() {
        let p: Box<dyn IPlatformPaths> = Box::new(MacPaths);
        let _ = p;
    }
}
