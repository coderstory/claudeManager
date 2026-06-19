//! Windows / cross-platform implementation of [`IGitHost`] — wraps the
//! system `git` CLI via [`std::process::Command`].
//!
//! Why a CLI shim and not libgit2? Three reasons:
//! 1. **Binary size** — libgit2 pulls in tens of MB of C. The `git` CLI is
//!    already on every developer machine and on the target Windows
//!    installer image.
//! 2. **Auth surface** — when the user clones a private repo, the system
//!    `git` already knows about their SSH keys / credential helpers.
//!    libgit2 would need a custom auth callback.
//! 3. **M1 scope** — we only need `clone`, `ls-remote`, `current-commit`.
//!    A 30-line Command shim is much smaller than a libgit2 wrapper.

use std::path::Path;
use std::process::Command;

use crate::platform::traits::{IGitHost, PlatformError};

pub struct GitHostCli;

impl GitHostCli {
    fn run(&self, args: &[&str]) -> Result<std::process::Output, PlatformError> {
        Command::new("git")
            .args(args)
            .output()
            .map_err(|e| PlatformError::Command {
                cmd: "git".into(),
                message: format!("failed to spawn git (is git installed?): {e}"),
            })
    }
}

impl IGitHost for GitHostCli {
    fn clone(&self, url: &str, dest: &Path, depth: u32) -> Result<(), PlatformError> {
        if dest.exists() {
            return Err(PlatformError::Path(format!(
                "clone destination already exists: {}",
                dest.display()
            )));
        }

        let mut args: Vec<String> = vec!["clone".into()];
        if depth > 0 {
            args.push(format!("--depth={depth}"));
        }
        args.push(url.to_string());
        args.push(dest.display().to_string());

        let argv: Vec<&str> = args.iter().map(String::as_str).collect();
        let out = self.run(&argv)?;
        if !out.status.success() {
            return Err(PlatformError::Command {
                cmd: "git clone".into(),
                message: String::from_utf8_lossy(&out.stderr).into_owned(),
            });
        }
        Ok(())
    }

    fn ls_remote(&self, url: &str) -> Result<Vec<String>, PlatformError> {
        let out = self.run(&["ls-remote", "--heads", "--tags", url])?;
        if !out.status.success() {
            return Err(PlatformError::Command {
                cmd: "git ls-remote".into(),
                message: String::from_utf8_lossy(&out.stderr).into_owned(),
            });
        }
        // Each line is "<sha>\t<refname>". We only need the refname.
        let text = String::from_utf8_lossy(&out.stdout);
        let refs = text
            .lines()
            .filter_map(|line| line.split('\t').nth(1))
            .map(|s| s.to_string())
            .collect();
        Ok(refs)
    }

    fn current_head(&self, repo: &Path) -> Result<String, PlatformError> {
        if !repo.is_dir() {
            return Err(PlatformError::Path(format!(
                "not a git repo: {}",
                repo.display()
            )));
        }
        let out = self.run(&["-C", &repo.display().to_string(), "rev-parse", "HEAD"])?;
        if !out.status.success() {
            return Err(PlatformError::Command {
                cmd: "git rev-parse HEAD".into(),
                message: String::from_utf8_lossy(&out.stderr).into_owned(),
            });
        }
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    /// Smoke test: build a real local git repo with one commit, then ask
    /// `GitHostCli` to read its HEAD. This validates the spawn / argument
    /// handling without depending on the network.
    ///
    /// Skipped if `git` is not on PATH (e.g. minimal CI image).
    #[test]
    fn git_host_current_commit_reads_local_repo() {
        if Command::new("git").arg("--version").output().is_err() {
            eprintln!("git not on PATH — skipping test");
            return;
        }

        let tmp = TempDir::new().expect("tempdir");
        let repo = tmp.path().join("repo");
        fs::create_dir(&repo).expect("create repo dir");

        // Init + commit a single file so rev-parse HEAD has something to say.
        let run = |args: &[&str]| Command::new("git").args(args).current_dir(&repo).output();
        run(&["init", "-q"]).expect("git init");
        run(&["config", "user.email", "test@example.com"]).expect("git config email");
        run(&["config", "user.name", "Test"]).expect("git config name");
        fs::write(repo.join("README.md"), "hi").expect("write readme");
        run(&["add", "."]).expect("git add");
        run(&["commit", "-q", "-m", "init"]).expect("git commit");

        let sha = GitHostCli.current_head(&repo).expect("current_head");
        assert_eq!(sha.len(), 40, "expected full SHA-1, got {sha}");
        assert!(sha.chars().all(|c| c.is_ascii_hexdigit()));
    }

    /// `ls-remote` on the local repo should list the default branch ref.
    /// We use `file://` URL to keep this offline.
    #[test]
    fn git_host_ls_remote_local_repo() {
        if Command::new("git").arg("--version").output().is_err() {
            eprintln!("git not on PATH — skipping test");
            return;
        }
        let tmp = TempDir::new().expect("tempdir");
        let repo = tmp.path().join("repo");
        fs::create_dir(&repo).expect("create repo dir");
        let run = |args: &[&str]| Command::new("git").args(args).current_dir(&repo).output();
        run(&["init", "-q", "-b", "main"]).expect("git init");
        run(&["config", "user.email", "test@example.com"]).expect("cfg email");
        run(&["config", "user.name", "Test"]).expect("cfg name");
        fs::write(repo.join("README.md"), "hi").expect("write");
        run(&["add", "."]).expect("git add");
        run(&["commit", "-q", "-m", "init"]).expect("git commit");

        let url = format!("file://{}", repo.display());
        let refs = GitHostCli.ls_remote(&url).expect("ls-remote");
        assert!(
            refs.iter().any(|r| r.contains("refs/heads/main")),
            "expected refs/heads/main in {:?}",
            refs
        );
    }

    /// `clone` reuses the same code path as `current_commit`. Here we
    /// verify that cloning into a pre-existing destination is rejected
    /// (caller is expected to clean up / pick a fresh dir).
    #[test]
    fn git_host_clone_rejects_existing_destination() {
        let tmp = TempDir::new().expect("tempdir");
        let dest = tmp.path().join("preexists");
        fs::create_dir(&dest).expect("create dest");

        let r = GitHostCli.clone("https://example.invalid/repo.git", &dest, 1);
        assert!(matches!(r, Err(PlatformError::Path(_))));
    }
}
