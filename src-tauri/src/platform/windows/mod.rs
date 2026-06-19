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
pub mod window_chrome;

pub use app_menu::WindowsAppMenu;
pub use autostart::WindowsAutostart;
pub use git::GitHostCli as WindowsGitHost;
pub use notifier::WindowsNotifier;
pub use paths::WindowsPaths;
pub use reveal::WindowsReveal;
pub use single_instance::WindowsSingleInstance;
pub use window_chrome::WindowsWindowChrome;
