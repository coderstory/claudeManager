//! macOS 实现的 [`IPlatformWindowChrome`]。
//!
//! M2.16 — 真正的 macOS vibrancy 效果（`NSVisualEffectView`）已在 `lib.rs`
//! 的 setup hook 里通过 `window_vibrancy::apply_vibrancy` 直接应用到主窗口
//! （与 Windows 侧 `apply_mica` 对称）。该调用绕过了本 trait，因为
//! `apply_vibrancy` 需要持有 `&tauri::WebviewWindow` 句柄，而当前 trait 签名
//! [`IPlatformWindowChrome::apply`] 只收 `&WindowChromeOptions`，不携带 Window
//! 参数。
//!
//! 要让 trait 接入真实 vibrancy，必须改 trait 签名以传入 Window 句柄，这会
//! 牵动 `traits.rs`（trait 定义 + mock）+ `windows/window_chrome.rs`（Windows
//! 侧 impl + 2 个单测），超 2 文件白名单；且 `lib.rs` 的 `apply_mica` /
//! `apply_vibrancy` 调用已被 M2.16 N 任务真机验证可用（三套主题生效），不
//! 允许改动（见任务反事故）。
//!
//! 因此本 impl 退化为 no-op：[`MacWindowChrome::apply`] 返回 `Ok(())`，与
//! Windows 侧 [`crate::platform::windows::WindowsWindowChrome::apply`] 在无
//! HWND 时的 no-op 行为对称。trait 结构保留以维持合约对象安全，待未来统一
//! window-chrome 层（把 Window 句柄通过工厂 `window_chrome(window)` 传入）时
//! 再接入真实现。
//!
//! P2 审查项「lib.rs cfg 块绕过 window_chrome trait（§3.2 违规）」的处置：
//! 本任务范围内不重构 trait 签名（超白名单），仅消除 `unimplemented!()` 死
//! 代码 panic 风险。§3.2 违规作为已知限制留待后续迭代。

use crate::platform::traits::{IPlatformWindowChrome, PlatformError, WindowChromeOptions};

pub struct MacWindowChrome;

impl IPlatformWindowChrome for MacWindowChrome {
    fn apply(&self, _options: &WindowChromeOptions) -> Result<(), PlatformError> {
        // No-op：真实 vibrancy 由 lib.rs 直接调 window-vibrancy 应用。
        // 详见模块文档。保留 trait 方法以满足合约，不 panic。
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::platform::traits::TitleBarStyle;

    /// apply() 在无 Window 句柄时必须短路返回 Ok，而不是 panic。
    /// 与 Windows 侧 `windows_window_chrome_apply_is_noop_without_hwnd`
    /// 对称——真机 vibrancy 由 lib.rs 直接调 window-vibrancy 应用，trait
    /// 路径只是合约占位。
    #[test]
    fn mac_window_chrome_apply_is_noop() {
        let opts = WindowChromeOptions {
            vibrancy: true, // macOS 才有意义，但 trait 路径仍 no-op
            mica: true,     // macOS 忽略
            title_bar_style: TitleBarStyle::Transparent,
        };
        let r = MacWindowChrome.apply(&opts);
        assert!(r.is_ok(), "apply() 必须返回 Ok（vibrancy 由 lib.rs 直接应用）: {r:?}");
    }

    /// 默认 options 也必须返回 Ok。
    #[test]
    fn mac_window_chrome_default_apply_is_noop() {
        let r = MacWindowChrome.apply(&WindowChromeOptions::default());
        assert!(r.is_ok());
    }
}
