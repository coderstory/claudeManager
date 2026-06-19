//! Windows implementation of [`IPlatformReveal`] — opens `explorer.exe
//! /select,<path>` to highlight a file in the file manager.
//!
//! We use `explorer /select,...` rather than `explorer <path>` because the
//! former opens the *parent* directory with the target file pre-selected,
//! which is what users expect when they click "Reveal in Explorer" on a
//! log file, backup, etc.

use std::path::Path;
use std::process::Command;

use crate::platform::traits::{IPlatformReveal, PlatformError};

pub struct WindowsReveal;

impl IPlatformReveal for WindowsReveal {
    fn reveal(&self, path: &Path) -> Result<(), PlatformError> {
        if !path.exists() {
            return Err(PlatformError::Path(format!(
                "cannot reveal: path does not exist: {}",
                path.display()
            )));
        }

        let status = Command::new("explorer.exe")
            // NOTE: explorer.exe takes the comma as a separator and the args
            // as a single string. The leading `/select,` is the trigger; we
            // pass the *whole* string as one arg so Windows parses it
            // correctly (Cargo's `Command` will quote it for us).
            .arg(format!("/select,{}", path.display()))
            .status()
            .map_err(|e| PlatformError::Command {
                cmd: "explorer.exe".into(),
                message: e.to_string(),
            })?;

        if !status.success() {
            return Err(PlatformError::Command {
                cmd: "explorer.exe".into(),
                message: format!("exit status: {status}"),
            });
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn windows_reveal_returns_err_for_nonexistent_path() {
        let r = WindowsReveal.reveal(Path::new("Z:\\does\\not\\exist.xyz"));
        assert!(r.is_err(), "must return Err for nonexistent path");
        match r.unwrap_err() {
            PlatformError::Path(_) => {}
            other => panic!("expected PlatformError::Path, got {other:?}"),
        }
    }

    #[test]
    fn windows_reveal_does_not_panic_on_existing_path() {
        // We don't actually launch a GUI explorer from headless CI — but on
        // a developer machine the call should at least not panic. We
        // *create* a temp file so the existence check passes, then attempt
        // the spawn. Even if explorer fails (e.g. headless test runner),
        // the call returned Ok/Err without panicking.
        let tmp = TempDir::new().expect("create tempdir");
        let f = tmp.path().join("sample.txt");
        fs::write(&f, b"hello").expect("write file");
        let _ = WindowsReveal.reveal(&f);
        // If we got here, we did not panic.
    }
}
