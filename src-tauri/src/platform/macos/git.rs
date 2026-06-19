//! macOS stub of [`IGitHost`]. The `git` CLI is identical on every
//! platform, so this could share the Windows CLI shim. We keep a separate
//! stub for now to mirror the per-platform split; once the mac build is
//! up, the `MacGitHost` can be a type alias to `GitHostCli` if the team
//! prefers, or a real wrapper that handles mac-specific keychain prompts.

use std::path::Path;

use crate::platform::traits::{IGitHost, PlatformError};

pub struct MacGitHost;

impl IGitHost for MacGitHost {
    fn clone(&self, _url: &str, _dest: &Path, _depth: u32) -> Result<(), PlatformError> {
        unimplemented!("MacGitHost::clone — will share GitHostCli or wrap it")
    }

    fn ls_remote(&self, _url: &str) -> Result<Vec<String>, PlatformError> {
        unimplemented!("MacGitHost::ls_remote — will share GitHostCli or wrap it")
    }

    fn current_head(&self, _repo: &Path) -> Result<String, PlatformError> {
        unimplemented!("MacGitHost::current_head — will share GitHostCli or wrap it")
    }
}
