//! macOS implementation of [`IPlatformAppMenu`].
//!
//! 构建 macOS 标准应用菜单（App / Edit / View / Window），通过 Tauri v2
//! 跨平台 menu API 实现——在 macOS 上自动渲染为顶部菜单栏（NSMenu）。
//!
//! 菜单项全部用 `PredefinedMenuItem`（About / Hide / Quit / Undo 等），
//! macOS 自动绑定标准快捷键（Cmd+Q 退出 / Cmd+H 隐藏 / Cmd+M 最小化 /
//! Ctrl+Cmd+F 全屏 等）和系统行为，无需手写 `on_menu_event` 处理。
//!
//! Tauri v2 menu API 本身跨平台，但本项目只打算在 macOS 上挂全局菜单
//! 栏——Windows 用托盘菜单（见 `lib.rs` 的 `TrayIconBuilder`），不调本
//! impl（`runtime::app_menu` 的 cfg 分发保证 Windows 走 `WindowsAppMenu`
//! 返回 `NotSupported`）。
//!
//! 非 mac target：结构体仍存在（保持 trait 契约 object-safe，且
//! `macos/mod.rs` 在 Windows 编译时也会引用本模块），`build_app_menu`
//! 返回 [`PlatformError::NotSupported`]，与 `WindowsAppMenu` 一致。

use crate::platform::traits::{IPlatformAppMenu, PlatformError};

/// macOS 应用菜单安装器。持有 [`tauri::AppHandle`] 以便在
/// `build_app_menu` 时构建 `NSMenu` 并 `set_menu`。
///
/// 构造方式与 [`crate::platform::macos::MacAutostart`] 对称：由
/// [`crate::platform::runtime::app_menu`] factory 从 `lib.rs` setup 注入
/// live `AppHandle`。
pub struct MacAppMenu {
    /// Live Tauri 句柄，用于 `SubmenuBuilder::new` / `MenuBuilder::new` /
    /// `set_menu`。`AppHandle` 是 `Clone + Send + Sync`，满足 trait 的
    /// `Send + Sync` 约束。
    #[cfg(target_os = "macos")]
    app: tauri::AppHandle,
}

#[cfg(target_os = "macos")]
impl MacAppMenu {
    /// 构造一个持有 app handle 的菜单安装器。
    pub fn new(app: &tauri::AppHandle) -> Self {
        Self { app: app.clone() }
    }
}

impl IPlatformAppMenu for MacAppMenu {
    #[cfg(target_os = "macos")]
    fn build_app_menu(&self) -> Result<(), PlatformError> {
        use tauri::menu::{AboutMetadata, MenuBuilder, SubmenuBuilder};

        // ---- App 菜单（第一个 submenu，macOS 自动放到 app 名菜单下）----
        // Tauri v2 文档：macOS 上所有顶层项必须归入 submenu，且第一个
        // submenu 会自动挂到应用名菜单下（无论 text 标签是什么）。
        // About / Separator / Hide (Cmd+H) / Hide Others / Show All /
        // Separator / Quit (Cmd+Q)
        let about_meta = AboutMetadata::default();
        let app_menu = SubmenuBuilder::new(&self.app, "App")
            .about(Some(about_meta))
            .separator()
            .hide()
            .hide_others()
            .show_all()
            .separator()
            .quit()
            .build()
            .map_err(|e| PlatformError::Other(format!("build app submenu: {e}")))?;

        // ---- Edit 菜单（标准编辑操作，WKWebView 自动响应）----
        // Undo / Redo / Separator / Cut / Copy / Paste / Select All
        let edit_menu = SubmenuBuilder::new(&self.app, "Edit")
            .undo()
            .redo()
            .separator()
            .cut()
            .copy()
            .paste()
            .select_all()
            .build()
            .map_err(|e| PlatformError::Other(format!("build edit submenu: {e}")))?;

        // ---- View 菜单（Toggle Full Screen, Ctrl+Cmd+F）----
        let view_menu = SubmenuBuilder::new(&self.app, "View")
            .fullscreen()
            .build()
            .map_err(|e| PlatformError::Other(format!("build view submenu: {e}")))?;

        // ---- Window 菜单（Minimize Cmd+M / Zoom）----
        // `maximize` 在 macOS 上由系统本地化显示为 "Zoom"（对应 NSWindow
        // 的 zoom: 在窗口化的"标准"尺寸与上次用户拖动尺寸间切换）。
        let window_menu = SubmenuBuilder::new(&self.app, "Window")
            .minimize()
            .maximize()
            .build()
            .map_err(|e| PlatformError::Other(format!("build window submenu: {e}")))?;

        // ---- 组装并安装到 app（macOS = 顶部菜单栏）----
        let menu = MenuBuilder::new(&self.app)
            .items(&[&app_menu, &edit_menu, &view_menu, &window_menu])
            .build()
            .map_err(|e| PlatformError::Other(format!("build root menu: {e}")))?;

        self.app
            .set_menu(menu)
            .map_err(|e| PlatformError::Other(format!("set_menu: {e}")))?;

        Ok(())
    }

    #[cfg(not(target_os = "macos"))]
    fn build_app_menu(&self) -> Result<(), PlatformError> {
        // 非 mac target：app menu 是 macOS 专属概念，返回 NotSupported
        // （与 WindowsAppMenu 一致）。此分支在 Windows dev box 上编译，
        // 保证 cargo check --target x86_64-pc-windows-msvc 不依赖 mac
        // 专属符号。
        Err(PlatformError::NotSupported)
    }
}
