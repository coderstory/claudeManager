//! Windows 平台抽象层 — 所有 Windows-only 代码
//!
//! 模块级 cfg 确保即使在其他平台编译, 也只暴露空 stub,
//! 防止 rust-analyzer 在 macOS / Linux 上误报 "unresolved import"。
//! 这是 rust-analyzer 友好化, 非编译必需 (impl 自身已有 #[cfg(windows)])。

#![cfg(target_os = "windows")]

//! Windows-specific implementations of the platform traits.
//!
//! Each submodule is a single trait impl + its unit tests, kept small
//! enough to reason about in isolation. Re-exported flat here so callers
//! can write `use crate::platform::windows::WindowsPaths`.

pub mod app_menu;
pub mod autostart;
pub mod git;
pub mod notifier;
pub mod paths;
pub mod reveal;
pub mod single_instance;

pub use app_menu::WindowsAppMenu;
pub use autostart::WindowsAutostart;
pub use git::GitHostCli as WindowsGitHost;
pub use notifier::WindowsNotifier;
pub use paths::WindowsPaths;
pub use reveal::WindowsReveal;
pub use single_instance::WindowsSingleInstance;
