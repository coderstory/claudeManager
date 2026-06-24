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
    /// M4.6 (Phase 21) — `<app_data>/history.db` — SQLite database
    /// for F7 usage_history + F13 backup_history + schema_version
    /// (plan 21-01-PLAN-A). Bundled SQLite, opened in WAL mode
    /// by `infrastructure::sqlite::history_db::open_history_db`.
    /// Lives next to `backups_dir` so the user sees a single
    /// app-managed directory tree in `<app_data>/`.
    pub history_db: PathBuf,
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
    ///
    /// `dead_code` allow on non-windows: on macOS this struct only carries
    /// the `Stub` variant (read in the `Drop` impl on `cfg(windows)` only,
    /// and the `Drop` impl on macOS is a no-op). The field exists so the
    /// struct shape matches across targets and the Windows code can
    /// unconditionally destructure `inner` in its `Drop`.
    #[cfg_attr(not(windows), allow(dead_code))]
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

    /// M3.10 (清单 23) — return the active project's root directory.
    ///
    /// Semantics:
    /// - `None` = user-level ("system project"). Plugin code reads
    ///   from `~/.claude/` exactly like M2.x did.
    /// - `Some(p)` = user-added project whose `.claude/` lives at
    ///   `p.join(".claude")`.
    ///
    /// Default implementation returns `None` so the trait change is
    /// backwards-compatible (mock implementations and any future
    /// platform we haven't ported yet keep working unchanged).
    ///
    /// The Windows implementation reads `<app_data>/projects.json`
    /// (via `ProjectService`) and looks up the project whose id
    /// matches `current_project_id`. The macOS implementation
    /// returns `None` (compile-only stub; M4 backlog).
    ///
    /// # Why a method, not an `AppPaths` field
    ///
    /// `AppPaths` is resolved once in `lib.rs::setup` and stored in
    /// `Tauri State`. The active project can change at RUNTIME
    /// (user clicks "switch project" in the sidebar). A trait
    /// method called on demand lets us read the live state without
    /// rebuilding `AppPaths` or restarting the process.
    fn active_root_dir(&self) -> Option<PathBuf> {
        None
    }

    /// M3.2 polish — confirm `path` lives under one of the
    /// app-managed directories (`backups_dir`, `claude_dir`).
    ///
    /// Returns `Ok(canonicalized_path)` when the path is allowed,
    /// `Err(PlatformError::Path)` otherwise. This is a trait-level
    /// helper so the business code in `BackupService` doesn't need
    /// to know the concrete allow-list — each platform keeps its
    /// own list (`backups_dir` for Win/Mac is straightforward,
    /// `claude_dir` may shift with project mode in future).
    ///
    /// Default implementation accepts any path under
    /// `<app_data>/backups/`. Concrete impls on Win/Mac extend the
    /// allow-list with the active project's `.claude/` directory.
    fn validate_backup_path(&self, path: &Path) -> Result<PathBuf, PlatformError> {
        let resolved = self.resolve();
        let candidate = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
        let backups_root =
            std::fs::canonicalize(&resolved.backups_dir).unwrap_or(resolved.backups_dir);
        if candidate.starts_with(&backups_root) {
            return Ok(candidate);
        }
        Err(PlatformError::Path(format!(
            "path {} is outside allowed backup directories",
            path.display()
        )))
    }
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
///
/// M3.5 (清单 15) — 错误类型从通用 `PlatformError` 拆出独立的
/// [`RevealError`],因为 `explorer.exe` / `open -R` 的失败原因
/// 必须由调用方按类别路由到不同的用户文案:
///
/// - `NotFound` — 路径不存在 (最常见,scanner 之后用户在外部删了文件)
/// - `PermissionDenied` — ACL 拒绝 (低频,Windows 无 cheap reliable
///   预检,主要靠前端启发式回退)
/// - `NetworkPath` — `\\server\share` / `//host` 形式,explorer/open
///   行为不稳定,前端文案明确告知「不支持」
/// - `LauncherFailed` — `explorer.exe` / `open` spawn 成功但
///   `status.success() == false`。注意:explorer.exe 的 exit code
///   **不可信**(Microsoft 从未文档化),前端文案应弱化退出码。
///
/// 详见 `docs/investigations/m3.5-reveal-bug.md`。
pub trait IPlatformReveal: Send + Sync {
    fn reveal_file(&self, path: &Path) -> Result<(), RevealError>;
}

/// M3.5 — 结构化 reveal 错误。前端按 [`RevealError::kind`] 字段
/// 路由中文文案(`formatRevealError` in `src/components/ErrorBanner.tsx`)。
///
/// `thiserror::Error` 给到的 `Display` 用于 Rust 侧日志 / 测试断言,
/// 前端不应直接解析 `Display`,而应通过 IPC 序列化中的 `kind`
/// 字段路由(参见 `ResourceServiceError::Reveal` 的实现)。
#[derive(Debug, thiserror::Error, Clone, PartialEq, Eq)]
pub enum RevealError {
    #[error("Path does not exist: {0}")]
    NotFound(PathBuf),
    #[error("Permission denied: {0}")]
    PermissionDenied(PathBuf),
    #[error("Network path not supported: {0}")]
    NetworkPath(PathBuf),
    #[error("Explorer/launcher failed (exit {code:?}): {path:?}")]
    LauncherFailed {
        code: Option<i32>,
        path: PathBuf,
    },
}

impl RevealError {
    /// Stable category tag for IPC serialization (kebab-case, frontend
    /// routing key). DO NOT localize — frontend maps this to localized
    /// text.
    pub fn kind(&self) -> &'static str {
        match self {
            RevealError::NotFound(_) => "not_found",
            RevealError::PermissionDenied(_) => "permission_denied",
            RevealError::NetworkPath(_) => "network_path",
            RevealError::LauncherFailed { .. } => "launcher_failed",
        }
    }

    /// Path the error pertains to (cloned). For `LauncherFailed` it is
    /// the `path` field.
    pub fn path(&self) -> &Path {
        match self {
            RevealError::NotFound(p)
            | RevealError::PermissionDenied(p)
            | RevealError::NetworkPath(p)
            | RevealError::LauncherFailed { path: p, .. } => p,
        }
    }
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
            fn active_root_dir(&self) -> Option<PathBuf>;
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
            fn reveal_file(&self, path: &Path) -> Result<(), RevealError>;
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
            history_db: PathBuf::from("/home/mock/.config/CCM/history.db"),
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

    /// M3.10 — the new `active_root_dir` method dispatches through
    /// the trait object and returns whatever the impl says.
    #[test]
    fn paths_active_root_dir_dispatch() {
        let mut m = MockPathsShim::new();
        m.expect_active_root_dir()
            .times(1)
            .return_const(Some(PathBuf::from("/proj-a")));
        let p: Box<dyn IPlatformPaths> = Box::new(m);
        assert_eq!(p.active_root_dir(), Some(PathBuf::from("/proj-a")));
    }

    /// M3.10 — when no impl overrides `active_root_dir`, the default
    /// returns `None` (user-level / system project). This is the
    /// backwards-compat safety net for mocks and future platforms.
    #[test]
    fn paths_active_root_dir_default_is_none() {
        struct DefaultOnly;
        impl IPlatformPaths for DefaultOnly {
            fn resolve(&self) -> AppPaths {
                AppPaths {
                    home: PathBuf::from("/h"),
                    app_data: PathBuf::from("/h/.config/CCM"),
                    settings_json: PathBuf::from("/h/.claude/settings.json"),
                    claude_json: PathBuf::from("/h/.claude.json"),
                    backups_dir: PathBuf::from("/h/.config/CCM/backups"),
                    marketplaces_dir: PathBuf::from("/h/.config/CCM/marketplaces"),
                    logs_dir: PathBuf::from("/h/.config/CCM/logs"),
                    history_db: PathBuf::from("/h/.config/CCM/history.db"),
                }
            }
            fn ensure_dirs(&self) -> Result<(), PlatformError> {
                Ok(())
            }
            // Note: NO override of active_root_dir — relies on the
            // default. The test confirms the default returns None.
        }
        let p: Box<dyn IPlatformPaths> = Box::new(DefaultOnly);
        assert_eq!(p.active_root_dir(), None);
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
    fn reveal_file_dispatch() {
        let mut m = MockRevealShim::new();
        m.expect_reveal_file()
            .withf(|p| p == Path::new("/x/y.txt"))
            .times(1)
            .returning(|_| Ok(()));
        let r: Box<dyn IPlatformReveal> = Box::new(m);
        r.reveal_file(Path::new("/x/y.txt")).unwrap();
    }

    /// M3.5 — `RevealError` 4 个 variant 的 `kind()` 标签稳定,
    /// 前端 IPC 路由靠这个字符串(不解析 `Display`)。
    #[test]
    fn reveal_error_kind_is_stable_string() {
        let p = PathBuf::from("/x");
        assert_eq!(
            RevealError::NotFound(p.clone()).kind(),
            "not_found"
        );
        assert_eq!(
            RevealError::PermissionDenied(p.clone()).kind(),
            "permission_denied"
        );
        assert_eq!(
            RevealError::NetworkPath(p.clone()).kind(),
            "network_path"
        );
        assert_eq!(
            RevealError::LauncherFailed { code: Some(1), path: p.clone() }.kind(),
            "launcher_failed"
        );
    }

    /// M3.5 — `RevealError::path()` 在 4 个 variant 下都能正确
    /// 取回路径,IPC 序列化用得到。
    #[test]
    fn reveal_error_path_returns_inner() {
        let p = PathBuf::from("/a/b.txt");
        assert_eq!(RevealError::NotFound(p.clone()).path(), p);
        assert_eq!(
            RevealError::LauncherFailed { code: None, path: p.clone() }.path(),
            p
        );
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
            history_db: PathBuf::from("/home/foo/.config/ClaudeConfigManager/history.db"),
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
