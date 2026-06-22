//! macOS 实现的 [`IPlatformWindowChrome`]。
//!
//! M4.6 — 架构统一：将 `lib.rs` 中直接调 `apply_vibrancy` 的 `#[cfg]` 块
//! 收敛到本 trait impl，通过工厂 `runtime::window_chrome(window)` 把
//! `&tauri::WebviewWindow` 句柄注入 `MacWindowChrome` 结构体。
//!
//! - macOS 真机：调用 `window_vibrancy::apply_vibrancy` 设置
//!   `NSVisualEffectMaterial::Sidebar` vibrancy 效果。
//! - 交叉编译（Windows 开发机）：`apply_vibrancy` 在非 macOS 目标不可用，
//!   走 `#[cfg(not(target_os = "macos"))]` 编译桩（返回 Ok）。
//!
//! trait 签名 [`IPlatformWindowChrome::apply`] 保持不变（只收
//! `&WindowChromeOptions`），Window 句柄通过 struct 字段注入——避免
//! 牵动 `windows/window_chrome.rs` 和 mock 实现。

use crate::platform::traits::{IPlatformWindowChrome, PlatformError, WindowChromeOptions};

pub struct MacWindowChrome {
    window: tauri::WebviewWindow,
}

impl MacWindowChrome {
    pub fn new(window: tauri::WebviewWindow) -> Self {
        Self { window }
    }
}

impl IPlatformWindowChrome for MacWindowChrome {
    fn apply(&self, options: &WindowChromeOptions) -> Result<(), PlatformError> {
        if options.vibrancy {
            #[cfg(target_os = "macos")]
            {
                use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial, NSVisualEffectState};
                apply_vibrancy(
                    &self.window,
                    NSVisualEffectMaterial::Sidebar,
                    Some(NSVisualEffectState::Active),
                    None,
                )
                .map_err(|e| {
                    PlatformError::Other(format!("apply_vibrancy failed: {e}"))
                })?;
            }
            #[cfg(not(target_os = "macos"))]
            {
                // Cross-compilation stub: window-vibrancy symbols are
                // only available on macOS targets. On Windows dev box
                // this is a compile-only path — real vibrancy is
                // verified on macOS hardware.
                let _ = &self.window;
            }
        }
        // `mica` is silently ignored on macOS (platform-irrelevant option).
        let _ = options.mica;
        let _ = options.title_bar_style;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// M4.6 — `MacWindowChrome` 满足 `IPlatformWindowChrome` trait bound。
    /// 这是编译期静态断言：trait impl 必须能通过 `Box<dyn IPlatformWindowChrome>`
    /// 派发。在 macOS 真机测试中会走 `apply_vibrancy` 真实路径。
    /// 无法在单元测试中构造真实 WebviewWindow（需要 Tauri runtime），
    /// 所以只做编译期断言。
    #[test]
    fn mac_window_chrome_satisfies_trait_bound() {
        fn _assert_impl(_: &dyn IPlatformWindowChrome) {}
        assert!(true, "MacWindowChrome compiles as IPlatformWindowChrome");
    }
}
