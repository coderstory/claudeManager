//! F1..F24 core scaffolding plugin — owns the system tray and the
//! macOS application menu.
//!
//! Phase 43 (D-CC-A) — every `MenuItem` the user sees on the tray
//! icon OR in the macOS menu bar is contributed by *some* plugin via
//! [`IPlugin::tray_items`] / [`IPlugin::app_menu_items`]. The `core`
//! plugin owns the **standard** entries (Show / Quit on the tray,
//! App / Edit / View / Window on macOS) so feature plugins don't
//! have to re-declare the standard macOS / Windows chrome.
//!
//! `init` is where the work happens: `core` walks the host's tray /
//! app-menu contributions, asks [`MenuRegistry`] to assemble the
//! OS-native surface, and installs the dispatch map. After Phase 43
//! lands, `lib.rs::setup` should have **zero** `MenuItem::with_id`
//! calls — every menu item lives here or in another plugin.
//!
//! [`MenuRegistry`]: crate::plugins::menu_registry

use super::super::traits::*;
use crate::plugins::menu_registry::{
    build_app_menu, build_tray, install_tray, AppMenuRole, PluginAction, PluginAppMenuItem,
    PluginAppMenuItemKind, PluginTrayItem,
};
use tauri::Manager;

/// Core plugin — owns the standard tray + macOS AppMenu entries.
pub struct CorePlugin;

impl IPlugin for CorePlugin {
    fn id(&self) -> &'static str {
        // Convention: id = "core" so unregister_actions can prefix-match
        // all of its contributions. Phase 43 Q43-5 decision.
        "core"
    }

    fn name(&self) -> &'static str {
        "核心"
    }

    /// Two tray items:
    ///
    /// - `core:show` — show + focus + unminimize the main window.
    /// - `core:quit` — quit the application.
    ///
    /// Convention: id is `"core:<action>"` so `unregister_actions`
    /// can filter this plugin's contributions by prefix.
    fn tray_items(&self) -> Vec<PluginTrayItem> {
        vec![
            PluginTrayItem {
                id: "core:show".into(),
                label: "显示主窗口".into(),
                enabled: true,
                // Q43-3 — no accelerator in Phase 43; Phase 47 evaluates
                // a cross-platform accelerator story.
                accelerator: None,
                action: PluginAction::ShowMainWindow,
            },
            PluginTrayItem {
                id: "core:quit".into(),
                label: "退出".into(),
                enabled: true,
                accelerator: None,
                action: PluginAction::Quit,
            },
        ]
    }

    /// Four submenus matching the macOS HIG: App / Edit / View / Window.
    /// 17 items total (App 7 + Edit 7 + View 1 + Window 2).
    ///
    /// PITFALL-43-6 — every macOS top-level menu must be a Submenu;
    /// raw `MenuItem`s at the root don't render in the system menu
    /// bar. `build_app_menu` wraps each group with `SubmenuBuilder`.
    ///
    /// PITFALL-43-4 — `build_app_menu` is cfg-gated by target_os so
    /// the caller can call it unconditionally; on Windows / Linux
    /// it's a no-op.
    fn app_menu_items(&self) -> Vec<PluginAppMenuItem> {
        vec![
            // ---- App submenu (7 items) ----
            // About (Cmd+Comma... no, About has no default accel on
            // macOS — App > About opens the system "About" panel).
            predef("App", AppMenuRole::About),
            sep("App"),
            predef("App", AppMenuRole::Hide),         // Cmd+H
            predef("App", AppMenuRole::HideOthers),  // Cmd+Opt+H
            predef("App", AppMenuRole::ShowAll),
            sep("App"),
            predef("App", AppMenuRole::Quit),         // Cmd+Q
            // ---- Edit submenu (7 items) ----
            predef("Edit", AppMenuRole::Undo),       // Cmd+Z
            predef("Edit", AppMenuRole::Redo),       // Cmd+Shift+Z
            sep("Edit"),
            predef("Edit", AppMenuRole::Cut),        // Cmd+X
            predef("Edit", AppMenuRole::Copy),       // Cmd+C
            predef("Edit", AppMenuRole::Paste),      // Cmd+V
            predef("Edit", AppMenuRole::SelectAll),  // Cmd+A
            // ---- View submenu (1 item) ----
            predef("View", AppMenuRole::Fullscreen), // Ctrl+Cmd+F
            // ---- Window submenu (2 items) ----
            predef("Window", AppMenuRole::Minimize), // Cmd+M
            predef("Window", AppMenuRole::Maximize), // "Zoom" on macOS
        ]
    }

    /// Build the system tray + macOS application menu from every
    /// plugin's contributions. This is the **only** place in the
    /// app where the OS menu surface is assembled — `lib.rs::setup`
    /// should not need to know about `MenuItem::with_id` /
    /// `SubmenuBuilder` / etc.
    fn init(&mut self, ctx: &mut PluginContext) -> Result<(), PluginError> {
        let app = ctx
            .app
            .ok_or_else(|| PluginError::InitFailed("core: ctx.app is None".into()))?;
        let host = ctx
            .host()
            .ok_or_else(|| PluginError::InitFailed("core: ctx.host() is None".into()))?;

        // ---- Tray (Windows + macOS) ----
        let (menu, actions) = build_tray(host, app).map_err(|e| {
            PluginError::InitFailed(format!("core: build_tray failed: {e}"))
        })?;
        // Default-window-icon is set by the bundle; on Windows it
        // comes from `tauri.conf.json`, on macOS from the .icns.
        let icon = app
            .default_window_icon()
            .cloned()
            .ok_or_else(|| PluginError::InitFailed("core: no default_window_icon".into()))?;
        install_tray(app, &menu, actions, icon, "Claude 配置管理器").map_err(|e| {
            PluginError::InitFailed(format!("core: install_tray failed: {e}"))
        })?;

        // ---- macOS AppMenu (no-op on Windows / Linux via cfg) ----
        build_app_menu(host, app).map_err(|e| {
            PluginError::InitFailed(format!("core: build_app_menu failed: {e}"))
        })?;

        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Tiny helpers — keep the app_menu_items() table readable.
// ---------------------------------------------------------------------------

/// Build a [`PluginAppMenuItem`] for a standard role (About / Hide /
/// Quit / etc.). See [`AppMenuRole`] for the full list.
fn predef(submenu: &'static str, role: AppMenuRole) -> PluginAppMenuItem {
    PluginAppMenuItem {
        submenu: submenu.into(),
        kind: PluginAppMenuItemKind::Predefined(role),
    }
}

/// Build a [`PluginAppMenuItem`] that renders as a horizontal
/// separator within `submenu`.
fn sep(submenu: &'static str) -> PluginAppMenuItem {
    PluginAppMenuItem {
        submenu: submenu.into(),
        kind: PluginAppMenuItemKind::Separator,
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::platform::AppPaths;
    use std::path::PathBuf;

    /// `id()` is the stable identifier used in `unregister_actions`
    /// prefix-matching. Must be `"core"` (Phase 43 Q43-5).
    #[test]
    fn core_plugin_id_is_core() {
        assert_eq!(CorePlugin.id(), "core");
    }

    /// Two tray entries — Show + Quit. PLAN Task 5 acceptance:
    /// `tray_items().len() == 2`.
    #[test]
    fn core_plugin_tray_items_count_is_two() {
        let items = CorePlugin.tray_items();
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].id, "core:show");
        assert_eq!(items[1].id, "core:quit");
    }

    /// 17 macOS application menu items grouped into 4 submenus.
    /// PLAN Task 5 acceptance: 4 submenu groups, matching the
    /// standard macOS HIG (App / Edit / View / Window).
    #[test]
    fn core_plugin_app_menu_items_count_and_groups() {
        let items = CorePlugin.app_menu_items();
        // App 7 + Edit 7 + View 1 + Window 2 = 17
        assert_eq!(items.len(), 17);

        // Submenu counts — App + Edit get separators, View / Window
        // don't.
        let app = items
            .iter()
            .filter(|i| i.submenu == "App")
            .count();
        let edit = items
            .iter()
            .filter(|i| i.submenu == "Edit")
            .count();
        let view = items
            .iter()
            .filter(|i| i.submenu == "View")
            .count();
        let window = items
            .iter()
            .filter(|i| i.submenu == "Window")
            .count();
        assert_eq!(app, 7, "App submenu should have 7 items");
        assert_eq!(edit, 7, "Edit submenu should have 7 items");
        assert_eq!(view, 1, "View submenu should have 1 item");
        assert_eq!(window, 2, "Window submenu should have 2 items");
    }

    /// `init` is callable in a unit test as long as `ctx.app` and
    /// `ctx.host()` are populated. We can't construct a real
    /// `AppHandle` here without `tauri::test`, so this test only
    /// proves the `init` signature matches the trait and that the
    /// "missing app / missing host" errors surface with a helpful
    /// message.
    #[test]
    fn core_plugin_init_rejects_missing_app() {
        // Build a context with `app: None` so `init` returns Err.
        struct EmptyPaths;
        impl crate::platform::IPlatformPaths for EmptyPaths {
            fn resolve(&self) -> AppPaths {
                AppPaths {
                    home: PathBuf::from("/"),
                    app_data: PathBuf::from("/"),
                    settings_json: PathBuf::from("/"),
                    claude_json: PathBuf::from("/"),
                    backups_dir: PathBuf::from("/"),
                    marketplaces_dir: PathBuf::from("/"),
                    logs_dir: PathBuf::from("/"),
                    history_db: PathBuf::from("/"),
                }
            }
            fn ensure_dirs(&self) -> Result<(), crate::platform::PlatformError> {
                Ok(())
            }
        }
        let leaked: &'static dyn crate::platform::IPlatformPaths =
            Box::leak(Box::new(EmptyPaths));
        let mut ctx = PluginContext::for_tests(leaked);
        let err = CorePlugin.init(&mut ctx).unwrap_err();
        // Either "ctx.app is None" or "ctx.host() is None" — both
        // are surfaced with descriptive PluginError::InitFailed.
        assert!(matches!(err, PluginError::InitFailed(_)));
    }
}