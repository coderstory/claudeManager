//! OS abstraction layer.
//!
//! Business code MUST go through these traits. Direct OS API calls in
//! `services/`, `domain/`, etc. are forbidden by [`CLAUDE.md` §3.2`].
//!
//! Layout:
//! - [`traits`]   — the 7 platform traits + shared types (`AppPaths`,
//!                  `PlatformError`, …)
//! - [`windows`] — Windows implementations (`WindowsPaths`,
//!                  `WindowsSingleInstance`, …)
//! - [`macos`]   — macOS stubs (matching signatures, `unimplemented!()`
//!                  bodies; real impls land when the mac build starts)
//!
//! [`CLAUDE.md` §3.2`]: ../../../../../CLAUDE.md
//!
//! Per the project spec, the **macOS** impls are stubbed at M1.2 — the
//! Windows impls are the only ones exercised today (this dev machine is
//! Windows-only). Both halves are kept so the trait contract stays
//! object-safe and so a mac build can be added later without touching
//! every call site.
//!
//! M4.8 — IPlatformWindowChrome / WindowChromeOptions / TitleBarStyle /
//! WindowChromeShim 全删 (4 轮 vibrancy 失败后用户决定"纯 CSS 模拟").
//! 5 主题的 glass 视觉由 tokens.css / base.css / 组件 backdrop-filter
//! 保留, 调用路径移除。

pub mod traits;
pub mod windows;
pub mod macos;

pub use traits::{
    AppPaths, IGitHost, IPlatformAppMenu, IPlatformAutostart, IPlatformNotifier,
    IPlatformPaths, IPlatformReveal, IPlatformSingleInstance, PlatformError, RevealError,
    SingleInstanceGuard,
};

// ---------------------------------------------------------------------------
// Runtime factory
// ---------------------------------------------------------------------------
//
// `init_for_runtime` is the single entry point used by `lib.rs` to pick the
// right per-OS implementation. We do the `cfg` selection here so that
// `lib.rs` doesn't have to think about target_os — the rest of the codebase
// just uses `Box<dyn IPlatformXxx>` returned from these helpers.

pub mod runtime {
    use tauri::AppHandle;

    use super::*;

    /// Path resolver for the host OS.
    pub fn paths() -> Box<dyn IPlatformPaths> {
        #[cfg(windows)]
        {
            Box::new(windows::WindowsPaths)
        }
        #[cfg(target_os = "macos")]
        {
            Box::new(macos::MacPaths)
        }
    }

    /// Single-instance lock for the host OS.
    pub fn single_instance() -> Box<dyn IPlatformSingleInstance> {
        #[cfg(windows)]
        {
            Box::new(windows::WindowsSingleInstance)
        }
        #[cfg(target_os = "macos")]
        {
            Box::new(macos::MacSingleInstance)
        }
    }

    /// Boot-on-login integration for the host OS.
    ///
    /// Requires a live [`AppHandle`] because the underlying
    /// `tauri-plugin-autostart` registers its `AutoLaunchManager` as
    /// Tauri state. The plugin must be `.plugin(...::init(...))`-ed in
    /// `lib.rs` before this is called.
    pub fn autostart(app: &AppHandle) -> Box<dyn IPlatformAutostart> {
        #[cfg(windows)]
        {
            Box::new(windows::WindowsAutostart::new(app))
        }
        #[cfg(target_os = "macos")]
        {
            Box::new(macos::MacAutostart::new(app))
        }
    }

    /// "Reveal in file manager" integration for the host OS.
    pub fn reveal() -> Box<dyn IPlatformReveal> {
        #[cfg(windows)]
        {
            Box::new(windows::WindowsReveal)
        }
        #[cfg(target_os = "macos")]
        {
            Box::new(macos::MacReveal)
        }
    }

    /// System notifications for the host OS.
    ///
    /// Requires a live [`AppHandle`] because the macOS impl uses
    /// `tauri-plugin-notification`'s `NotificationExt` (registered as Tauri
    /// state in `lib.rs`, M1.6). Windows impl still needs no handle but is
    /// passed one for API symmetry with the other runtime factories.
    pub fn notifier(app: &AppHandle) -> Box<dyn IPlatformNotifier> {
        #[cfg(windows)]
        {
            let _ = app;
            Box::new(windows::WindowsNotifier)
        }
        #[cfg(target_os = "macos")]
        {
            Box::new(macos::MacNotifier::new(app))
        }
    }

    /// App menu (macOS-only concept; Windows returns NotSupported).
    ///
    /// M2.16 — macOS 实现需要 live [`AppHandle`] 来构建 `NSMenu` 并
    /// `set_menu`（与 [`autostart`] / [`notifier`] 对称）。Windows 分支
    /// 忽略该参数。
    pub fn app_menu(app: &AppHandle) -> Box<dyn IPlatformAppMenu> {
        #[cfg(windows)]
        {
            let _ = app;
            Box::new(windows::WindowsAppMenu)
        }
        #[cfg(target_os = "macos")]
        {
            Box::new(macos::MacAppMenu::new(app))
        }
    }

    /// Git operations (CLI shim) for the host OS.
    pub fn git_host() -> Box<dyn IGitHost> {
        #[cfg(windows)]
        {
            Box::new(windows::WindowsGitHost)
        }
        #[cfg(target_os = "macos")]
        {
            Box::new(macos::MacGitHost)
        }
    }
}

/// `init_for_runtime` is the single entry point used by `lib.rs` to pick
/// the right per-OS implementation. It is intentionally a thin wrapper —
/// all the cfg work is in [`runtime`]. We keep this as a function (not a
/// const) so the implementation is allowed to do OS detection, env probes,
/// etc. in the future without changing the call site.
///
/// Today this returns `()` because no platform impl requires a startup
/// handshake — the Win registry `Run` key is read on demand by the
/// autostart impl, not pre-initialised. Future phases may add real init
/// steps (e.g. NSAppleEventManager registration on macOS).
pub fn init_for_runtime() {
    // No-op for M1.2. Each `runtime::xxx()` function constructs a fresh
    // `Box<dyn ...>` on demand; the static structs (`WindowsPaths`,
    // `WindowsAutostart`, …) are zero-sized and need no setup.
    let _ = runtime::paths();
}
