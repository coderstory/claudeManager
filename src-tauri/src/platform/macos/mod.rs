//! macOS-side stub implementations of the platform traits.
//!
//! On the mac build these will be filled in. On the current Windows-only
//! dev machine they exist only so the trait contract is verifiable at
//! compile time. See each submodule for what the real implementation
//! will do.

pub mod app_menu;
pub mod autostart;
pub mod git;
pub mod notifier;
pub mod paths;
pub mod reveal;
pub mod single_instance;
pub mod window_chrome;

pub use app_menu::MacAppMenu;
pub use autostart::MacAutostart;
pub use git::MacGitHost;
pub use notifier::MacNotifier;
pub use paths::MacPaths;
pub use reveal::MacReveal;
pub use single_instance::MacSingleInstance;
pub use window_chrome::MacWindowChrome;
