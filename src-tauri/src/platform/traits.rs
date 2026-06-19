//! OS abstraction layer — traits + shared types.
//!
//! All OS-specific behaviour (paths, single-instance, autostart, file manager
//! reveal, system notifications, app menu, window chrome, git) is hidden behind
//! a small set of traits so that business code never has to `#[cfg(target_os)]`.
//!
//! The split between [`crate::platform::windows`] and [`crate::platform::macos`]
//! mirrors the contract: each platform provides one struct per trait. On
//! non-target platforms the structs still exist (so the contract compiles) but
//! their bodies are `unimplemented!()` or [`PlatformError::NotSupported`].
//!
//! Scope: M1.x architecture phase. No business logic — just trait definitions,
//! Windows implementations with unit tests, and macOS signature-only stubs.

use std::fmt;
use std::path::{Path, PathBuf};

use thiserror::Error;

// ---------------------------------------------------------------------------
// AppPaths
// ---------------------------------------------------------------------------

/// Paths the app needs at runtime, resolved per platform.
///
/// `settings_json` and `claude_json` point at Claude Code's *own* config files
/// (which the app reads and writes on behalf of the user). The other paths
/// belong to this app and live under `<app-data>`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppPaths {
    /// User home directory (e.g. `C:\Users\foo`).
    pub home: PathBuf,
    /// App-specific data dir (e.g. `%APPDATA%\ClaudeConfigManager`).
    pub app_data: PathBuf,
    /// Claude Code's own settings file, e.g. `~/.claude/settings.json`.
    /// **Not** our app's config — we read/write this on the user's behalf.
    pub settings_json: PathBuf,
    /// Claude Code's own MCP file, e.g. `~/.claude.json`.
    /// **Not** our app's config.
    pub claude_json: PathBuf,
    /// `<app_data>/backups/` — rotated snapshots of `settings.json` and
    /// `~/.claude.json` taken before any write (F13 / F19).
    pub backups_dir: PathBuf,
    /// `<app_data>/marketplaces/` — git-cloned plugin/skill/command
    /// repositories (F17).
    pub marketplaces_dir: PathBuf,
    /// `<app_data>/logs/` — app log output.
    pub logs_dir: PathBuf,
}

impl AppPaths {
    /// Convenience: parent dir of `settings_json` (i.e. `~/.claude/`).
    pub fn claude_dir(&self) -> Option<&Path> {
        self.settings_json.parent()
    }
}

// ---------------------------------------------------------------------------
// WindowChrome
// ---------------------------------------------------------------------------

/// What the platform's window decorator should do.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WindowChromeOptions {
    /// macOS: enable `NSVisualEffectView` vibrancy behind the window.
    /// No effect on Windows.
    pub vibrancy: bool,
    /// Windows 11: enable the DWM Mica backdrop.
    /// No effect on macOS.
    pub mica: bool,
    /// Title bar style — see [`TitleBarStyle`].
    pub title_bar_style: TitleBarStyle,
}

impl Default for WindowChromeOptions {
    fn default() -> Self {
        Self {
            vibrancy: false,
            mica: false,
            title_bar_style: TitleBarStyle::Default,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TitleBarStyle {
    /// Use the platform's default decorated title bar.
    Default,
    /// Transparent / custom-drawn title bar. The app draws its own
    /// min/max/close buttons.
    Transparent,
}

// ---------------------------------------------------------------------------
// SingleInstanceGuard
// ---------------------------------------------------------------------------

/// RAII guard returned by [`IPlatformSingleInstance::try_acquire`]. When
/// dropped, the underlying lock is released.
///
/// On Windows this is the owned `HANDLE` returned by `CreateMutexW`. The guard
/// holds the handle and on `Drop` calls `CloseHandle` so we never leak it.
pub struct SingleInstanceGuard {
    /// Opaque platform handle. Windows: `HANDLE` to a named mutex.
    /// macOS: stub (a `Box<dyn Any>` would be cleaner but we don't need to
    /// hold anything on the macOS stub path).
    inner: SingleInstanceGuardInner,
}

#[doc(hidden)]
pub(crate) enum SingleInstanceGuardInner {
    #[cfg(windows)]
    Windows(windows::Win32::Foundation::HANDLE),
    #[cfg(not(windows))]
    Stub,
}

impl SingleInstanceGuard {
    /// Internal constructor for platform-specific code. Not part of the
    /// public trait surface — the contract is "construct via
    /// `IPlatformSingleInstance::try_acquire`".
    #[cfg(windows)]
    #[doc(hidden)]
    pub(crate) fn from_windows_handle(
        h: windows::Win32::Foundation::HANDLE,
    ) -> Self {
        Self {
            inner: SingleInstanceGuardInner::Windows(h),
        }
    }

    /// macOS stub constructor. When the mac build lands, this will be
    /// replaced with a proper `from_ns_lock(...)` constructor.
    #[cfg(not(windows))]
    #[doc(hidden)]
    pub(crate) fn from_stub() -> Self {
        Self {
            inner: SingleInstanceGuardInner::Stub,
        }
    }
}

impl fmt::Debug for SingleInstanceGuard {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("SingleInstanceGuard").finish_non_exhaustive()
    }
}

#[cfg(windows)]
impl Drop for SingleInstanceGuard {
    fn drop(&mut self) {
        use windows::Win32::Foundation::CloseHandle;
        // SAFETY: `HANDLE` came from `CreateMutexW` and ownership is transferred
        // to this guard. Closing it twice is a programming error, but the OS
        // just returns `ERROR_INVALID_HANDLE` — we don't care.
        // On Windows builds `inner` is always the `Windows` variant.
        let SingleInstanceGuardInner::Windows(h) = self.inner;
        if !h.is_invalid() {
            unsafe {
                let _ = CloseHandle(h);
            }
        }
    }
}

#[cfg(not(windows))]
impl Drop for SingleInstanceGuard {
    fn drop(&mut self) {
        // macOS stub: nothing to release.
    }
}

// ---------------------------------------------------------------------------
// PlatformError
// ---------------------------------------------------------------------------

#[derive(Debug, Error)]
pub enum PlatformError {
    /// Operation is not applicable on this platform (e.g. `install_app_menu`
    /// on Windows, `apply(vibrancy)` on Windows).
    #[error("operation not supported on this platform")]
    NotSupported,

    /// Underlying I/O error (file create, write, etc.).
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    /// Failed to parse / interpret an OS-level value (registry, plist, etc.).
    #[error("parse error: {0}")]
    Parse(String),

    /// External command (`git`, `explorer`, …) failed.
    #[error("command `{cmd}` failed: {message}")]
    Command {
        cmd: String,
        message: String,
    },

    /// Path-related error (e.g. the user's home dir could not be resolved).
    #[error("path error: {0}")]
    Path(String),

    /// Autostart backend (tauri-plugin-autostart) failed.
    #[error("autostart error: {0}")]
    Autostart(String),

    /// Catch-all for unexpected platform-specific failures.
    #[error("platform error: {0}")]
    Other(String),
}

// ---------------------------------------------------------------------------
// Traits
// ---------------------------------------------------------------------------

/// Resolves and creates the per-platform app paths.
pub trait IPlatformPaths: Send + Sync {
    /// Compute the absolute paths this app needs. Pure function — does not
    /// touch the filesystem.
    fn resolve(&self) -> AppPaths;

    /// Create any required directories that don't yet exist (`app_data`,
    /// `backups_dir`, `marketplaces_dir`, `logs_dir`). Idempotent.
    fn ensure_dirs(&self) -> Result<(), PlatformError>;
}

/// Acquire a per-user single-instance lock. Returns `Err` if another instance
/// is already running.
pub trait IPlatformSingleInstance: Send + Sync {
    /// Try to take the lock. On success, hold the returned guard for the
    /// lifetime of the process — the lock is released when it's dropped.
    fn try_acquire(&self) -> Result<SingleInstanceGuard, PlatformError>;
}

/// Launch-on-login integration.
pub trait IPlatformAutostart: Send + Sync {
    fn is_enabled(&self) -> Result<bool, PlatformError>;
    fn enable(&self) -> Result<(), PlatformError>;
    fn disable(&self) -> Result<(), PlatformError>;
}

/// Open the system file manager with `path` selected (Win: `explorer
/// /select,…`; mac: `open -R …`).
pub trait IPlatformReveal: Send + Sync {
    fn reveal(&self, path: &Path) -> Result<(), PlatformError>;
}

/// Show a native OS notification (toast / NSUserNotification).
pub trait IPlatformNotifier: Send + Sync {
    fn notify(&self, title: &str, body: &str) -> Result<(), PlatformError>;
}

/// macOS-only: install the application menu in the system menu bar using
/// `NSMenu`. On non-mac platforms this returns [`PlatformError::NotSupported`].
pub trait IPlatformAppMenu: Send + Sync {
    fn build_app_menu(&self) -> Result<(), PlatformError>;
}

/// Apply native window-chrome effects (Mica, vibrancy, transparent title
/// bar).
pub trait IPlatformWindowChrome: Send + Sync {
    fn apply(&self, options: &WindowChromeOptions) -> Result<(), PlatformError>;
}

/// Wrapper around the `git` CLI. We delegate to git rather than linking
/// libgit2 — keeps the binary small and we only need a handful of operations.
pub trait IGitHost: Send + Sync {
    /// Shallow-clone `url` into `dest`. `depth = 0` means full clone.
    fn clone(&self, url: &str, dest: &Path, depth: u32) -> Result<(), PlatformError>;

    /// List the remote refs of `url` (one ref name per line, e.g. `HEAD`,
    /// `refs/heads/main`).
    fn ls_remote(&self, url: &str) -> Result<Vec<String>, PlatformError>;

    /// Return the current `HEAD` commit SHA of an on-disk repo.
    fn current_head(&self, repo: &Path) -> Result<String, PlatformError>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use mockall::mock;

    mock! {
        pub PathsShim {}
        impl IPlatformPaths for PathsShim {
            fn resolve(&self) -> AppPaths;
            fn ensure_dirs(&self) -> Result<(), PlatformError>;
        }
    }

    mock! {
        pub SingleInstanceShim {}
        impl IPlatformSingleInstance for SingleInstanceShim {
            fn try_acquire(&self) -> Result<SingleInstanceGuard, PlatformError>;
        }
    }

    mock! {
        pub AutostartShim {}
        impl IPlatformAutostart for AutostartShim {
            fn is_enabled(&self) -> Result<bool, PlatformError>;
            fn enable(&self) -> Result<(), PlatformError>;
            fn disable(&self) -> Result<(), PlatformError>;
        }
    }

    mock! {
        pub RevealShim {}
        impl IPlatformReveal for RevealShim {
            fn reveal(&self, path: &Path) -> Result<(), PlatformError>;
        }
    }

    mock! {
        pub NotifierShim {}
        impl IPlatformNotifier for NotifierShim {
            fn notify(&self, title: &str, body: &str) -> Result<(), PlatformError>;
        }
    }

    mock! {
        pub AppMenuShim {}
        impl IPlatformAppMenu for AppMenuShim {
            fn build_app_menu(&self) -> Result<(), PlatformError>;
        }
    }

    mock! {
        pub WindowChromeShim {}
        impl IPlatformWindowChrome for WindowChromeShim {
            fn apply(&self, options: &WindowChromeOptions) -> Result<(), PlatformError>;
        }
    }

    mock! {
        pub GitHostShim {}
        impl IGitHost for GitHostShim {
            fn clone(&self, url: &str, dest: &Path, depth: u32) -> Result<(), PlatformError>;
            fn ls_remote(&self, url: &str) -> Result<Vec<String>, PlatformError>;
            fn current_head(&self, repo: &Path) -> Result<String, PlatformError>;
        }
    }

    // The tests below prove two things at once:
    // 1. Each trait can be mocked with `mockall` (object-safe, no Tauri-bound
    //    generic params, no `&self` lifetime gotchas).
    // 2. Code that takes `&dyn IPlatformXxx` will dispatch to the mock —
    //    i.e. business code can be written against the trait and unit-tested
    //    without touching OS APIs.

    /// Verifies `dyn IPlatformPaths` dispatch: build a `Box<dyn IPlatformPaths>`
    /// out of a mock, call `resolve()`, and confirm the mock's stub data
    /// comes back through the trait object.
    #[test]
    fn paths_trait_dispatch_through_dyn() {
        let want = AppPaths {
            home: PathBuf::from("/home/mock"),
            app_data: PathBuf::from("/home/mock/.config/CCM"),
            settings_json: PathBuf::from("/home/mock/.claude/settings.json"),
            claude_json: PathBuf::from("/home/mock/.claude.json"),
            backups_dir: PathBuf::from("/home/mock/.config/CCM/backups"),
            marketplaces_dir: PathBuf::from("/home/mock/.config/CCM/marketplaces"),
            logs_dir: PathBuf::from("/home/mock/.config/CCM/logs"),
        };
        let mut m = MockPathsShim::new();
        m.expect_resolve().times(1).return_once(move || want.clone());

        let p: Box<dyn IPlatformPaths> = Box::new(m);
        let got = p.resolve();
        assert_eq!(got.app_data, PathBuf::from("/home/mock/.config/CCM"));
    }

    #[test]
    fn paths_ensure_dirs_dispatch() {
        let mut m = MockPathsShim::new();
        m.expect_ensure_dirs().times(1).returning(|| Ok(()));
        let p: Box<dyn IPlatformPaths> = Box::new(m);
        assert!(p.ensure_dirs().is_ok());
    }

    #[test]
    fn single_instance_try_acquire_dispatch() {
        // We can't construct a real SingleInstanceGuard from outside
        // `platform::windows`, but we can verify the trait is dispatchable
        // by making the mock return Err — that's still a valid result
        // (means "another instance is running").
        let mut m = MockSingleInstanceShim::new();
        m.expect_try_acquire()
            .times(1)
            .returning(|| Err(PlatformError::Other("already running".into())));
        let s: Box<dyn IPlatformSingleInstance> = Box::new(m);
        let r = s.try_acquire();
        assert!(matches!(r, Err(PlatformError::Other(_))));
    }

    #[test]
    fn autostart_is_enabled_dispatch() {
        let mut m = MockAutostartShim::new();
        m.expect_is_enabled().times(1).returning(|| Ok(true));
        let a: Box<dyn IPlatformAutostart> = Box::new(m);
        assert_eq!(a.is_enabled().unwrap(), true);
    }

    #[test]
    fn autostart_enable_disable_dispatch() {
        let mut m = MockAutostartShim::new();
        m.expect_enable().times(1).returning(|| Ok(()));
        m.expect_disable().times(1).returning(|| Ok(()));
        let a: Box<dyn IPlatformAutostart> = Box::new(m);
        a.enable().unwrap();
        a.disable().unwrap();
    }

    #[test]
    fn reveal_dispatch() {
        let mut m = MockRevealShim::new();
        m.expect_reveal()
            .withf(|p| p == Path::new("/x/y.txt"))
            .times(1)
            .returning(|_| Ok(()));
        let r: Box<dyn IPlatformReveal> = Box::new(m);
        r.reveal(Path::new("/x/y.txt")).unwrap();
    }

    #[test]
    fn notifier_notify_dispatch() {
        let mut m = MockNotifierShim::new();
        m.expect_notify()
            .withf(|t, b| t == "T" && b == "B")
            .times(1)
            .returning(|_, _| Ok(()));
        let n: Box<dyn IPlatformNotifier> = Box::new(m);
        n.notify("T", "B").unwrap();
    }

    #[test]
    fn app_menu_build_dispatch() {
        let mut m = MockAppMenuShim::new();
        m.expect_build_app_menu()
            .times(1)
            .returning(|| Err(PlatformError::NotSupported));
        let am: Box<dyn IPlatformAppMenu> = Box::new(m);
        assert!(matches!(am.build_app_menu(), Err(PlatformError::NotSupported)));
    }

    #[test]
    fn window_chrome_apply_dispatch() {
        let opts = WindowChromeOptions {
            vibrancy: true,
            mica: true,
            title_bar_style: TitleBarStyle::Transparent,
        };
        let mut m = MockWindowChromeShim::new();
        m.expect_apply()
            .withf(|o| o.vibrancy && o.mica && matches!(o.title_bar_style, TitleBarStyle::Transparent))
            .times(1)
            .returning(|_| Ok(()));
        let wc: Box<dyn IPlatformWindowChrome> = Box::new(m);
        wc.apply(&opts).unwrap();
    }

    #[test]
    fn git_host_clone_dispatch() {
        let mut m = MockGitHostShim::new();
        m.expect_clone()
            .withf(|url, _dest, depth| url == "https://example/r" && depth == &1)
            .times(1)
            .returning(|_, _, _| Ok(()));
        let g: Box<dyn IGitHost> = Box::new(m);
        g.clone("https://example/r", Path::new("/tmp/r"), 1).unwrap();
    }

    #[test]
    fn git_host_ls_remote_dispatch() {
        let mut m = MockGitHostShim::new();
        m.expect_ls_remote()
            .times(1)
            .returning(|_| Ok(vec!["refs/heads/main".into(), "HEAD".into()]));
        let g: Box<dyn IGitHost> = Box::new(m);
        let refs = g.ls_remote("https://example/r").unwrap();
        assert_eq!(refs.len(), 2);
        assert!(refs.contains(&"refs/heads/main".to_string()));
    }

    #[test]
    fn git_host_current_head_dispatch() {
        let mut m = MockGitHostShim::new();
        m.expect_current_head()
            .times(1)
            .returning(|_| Ok("a".repeat(40)));
        let g: Box<dyn IGitHost> = Box::new(m);
        let sha = g.current_head(Path::new("/tmp/r")).unwrap();
        assert_eq!(sha.len(), 40);
    }

    #[test]
    fn app_paths_claude_dir_returns_parent_of_settings_json() {
        let p = AppPaths {
            home: PathBuf::from("/home/foo"),
            app_data: PathBuf::from("/home/foo/.config/ClaudeConfigManager"),
            settings_json: PathBuf::from("/home/foo/.claude/settings.json"),
            claude_json: PathBuf::from("/home/foo/.claude.json"),
            backups_dir: PathBuf::from("/home/foo/.config/ClaudeConfigManager/backups"),
            marketplaces_dir: PathBuf::from(
                "/home/foo/.config/ClaudeConfigManager/marketplaces",
            ),
            logs_dir: PathBuf::from("/home/foo/.config/ClaudeConfigManager/logs"),
        };
        assert_eq!(p.claude_dir(), Some(Path::new("/home/foo/.claude")));
    }

    #[test]
    fn window_chrome_options_default_is_off() {
        let o = WindowChromeOptions::default();
        assert!(!o.vibrancy);
        assert!(!o.mica);
        assert_eq!(o.title_bar_style, TitleBarStyle::Default);
    }
}
