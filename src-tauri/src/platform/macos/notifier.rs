//! macOS implementation of [`IPlatformNotifier`].
//!
//! M2.16 — 通过 `tauri-plugin-notification` 发送系统通知（跨平台 plugin，
//! 底层在 macOS 走 `notify-rust` → `mac-notification-sys` →
//! `UNUserNotificationCenter`，已取代 macOS 11 起废弃的 `NSUserNotification`）。
//!
//! ## 权限模型
//! macOS 首次发通知时，系统会自动弹出权限请求（由 `UNUserNotificationCenter`
//! 触发，无需应用显式 prompt）。`tauri-plugin-notification` 在 **desktop** 端的
//! `Notification::request_permission` / `Notification::permission_state` 目前是
//! no-op（直接返回 `Granted`，真正弹窗只在 mobile 端实现）。
//!
//! 尽管如此，本实现仍遵循官方 JS 端 "check → request → send" 模式，在 `notify`
//! 内先调一次 [`MacNotifier::request_permission`]：
//! 1. 与官方文档示例一致，便于 review；
//! 2. 前向兼容——若 Tauri 未来让 desktop 端真正请求权限，本代码无需改动。
//!
//! macOS 真机验证（权限弹窗 + 通知实际显示）留给用户在 mac 上完成。

use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;

use crate::platform::traits::{IPlatformNotifier, PlatformError};

/// macOS 系统通知器。持有 [`AppHandle`] 以访问
/// `tauri-plugin-notification` 的 `NotificationExt` API。
///
/// 构造方式见 [`MacNotifier::new`]；业务代码统一通过 trait 对象
/// `Box<dyn IPlatformNotifier>` 使用（由 `platform::runtime::notifier` 工厂返回）。
pub struct MacNotifier {
    app: AppHandle,
}

impl MacNotifier {
    /// 构造一个持有 [`AppHandle`] 的通知器。`app` 必须来自已注册
    /// `tauri_plugin_notification::init()` 的 Tauri 应用（在 `lib.rs` 完成，M1.6）。
    pub fn new(app: &AppHandle) -> Self {
        Self { app: app.clone() }
    }

    /// 请求 macOS 通知权限。
    ///
    /// **注意**：`tauri-plugin-notification` 在 desktop 端此方法是 no-op
    /// （直接返回 `Granted`）。macOS 真正的权限弹窗由系统在首次发通知时
    /// 自动触发。保留此调用以遵循官方 "request → send" 模式并前向兼容
    /// （详见模块级文档"权限模型"）。
    ///
    /// 返回 `Ok(())` 表示请求调用本身未出错（不代表用户一定授权——desktop
    /// 端恒为 `Granted`，授权与否由系统在首次通知时判定）。
    pub fn request_permission(&self) -> Result<(), PlatformError> {
        self.app
            .notification()
            .request_permission()
            .map(|_| ())
            .map_err(|e| PlatformError::Other(e.to_string()))
    }
}

impl IPlatformNotifier for MacNotifier {
    fn notify(&self, title: &str, body: &str) -> Result<(), PlatformError> {
        // macOS：发通知前先请求权限（desktop 端当前 no-op，遵循官方模式 +
        // 前向兼容）。失败不阻断——权限请求失败时仍尝试发送，让系统在首次
        // 通知时兜底弹窗。
        let _ = self.request_permission();

        self.app
            .notification()
            .builder()
            .title(title)
            .body(body)
            .show()
            .map_err(|e| PlatformError::Other(e.to_string()))
    }
}
