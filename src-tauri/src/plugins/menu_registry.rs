//! Plugin-driven system tray + macOS application menu.
//!
//! Phase 43 — replaces the hand-written tray / AppMenu blocks in
//! `lib.rs::setup` with a single entry point (`MenuRegistry`) that walks
//! every registered plugin's `tray_items()` / `app_menu_items()` and
//! assembles the OS-native menu surface.
//!
//! ## Two platforms, one source of truth
//!
//! - **Tray** (Windows + macOS): every plugin can contribute
//!   `PluginTrayItem`s. We build a `tauri::menu::Menu` and wire
//!   `on_menu_event` to an `Arc<HashMap<id, PluginAction>>` so any
//!   click dispatches the right action — including async ones like
//!   `ShowMainWindow` or `SwitchView("providers")`.
//!
//! - **App menu** (macOS only): `tauri::menu::MenuBuilder` +
//!   `SubmenuBuilder` from the same `PluginAppMenuItem` declarations,
//!   grouped by `submenu` field. On Windows the function is a no-op so
//!   `core-plugin::init` can call it unconditionally.
//!
//! ## Why this lives in `plugins/`, not `platform/`
//!
//! Both surfaces are **declared** by plugins (the `core` plugin owns
//! the standard items) and **assembled** at one site. The platform
//! layer is for OS-call abstractions — it has no business knowing what
//! menu items the application chose to expose.

use std::collections::HashMap;
use std::sync::Arc;

use tauri::{AppHandle, Emitter, Manager};

// ---------------------------------------------------------------------------
// PluginTrayItem
// ---------------------------------------------------------------------------

/// A single entry the plugin wants to appear in the system tray menu.
///
/// `id` is the dispatch key — convention is `"<plugin-id>:<action>"`
/// (e.g. `"core:show"`, `"core:quit"`). The `PluginHost` collect
/// helpers don't enforce this; `unregister_actions` relies on the
/// `<plugin_id>:` prefix to filter a plugin's contributions out of a
/// dispatch map.
#[derive(Debug, Clone)]
pub struct PluginTrayItem {
    /// Unique menu id (used as `MenuItem::with_id` arg + dispatch key).
    pub id: String,
    /// Visible label (e.g. `"显示主窗口"`).
    pub label: String,
    /// Whether the item is clickable. Disable + grey out via
    /// `MenuItem::with_id(..., enabled=false, ...)`.
    pub enabled: bool,
    /// Keyboard accelerator (e.g. `"Cmd+Q"`). Phase 43 ships `None`
    /// everywhere (Q43-3 decision — Phase 47 evaluates cross-platform
    /// accelerator strategy).
    pub accelerator: Option<String>,
    /// Action dispatched when the user clicks this item.
    pub action: PluginAction,
}

// ---------------------------------------------------------------------------
// PluginAppMenuItem / AppMenuRole
// ---------------------------------------------------------------------------

/// One slot in the macOS application menu. Items are grouped by
/// `submenu` ("App", "Edit", "View", "Window") — `build_app_menu`
/// sorts them with a `BTreeMap` so the menu order is deterministic
/// across runs.
#[derive(Debug, Clone)]
pub struct PluginAppMenuItem {
    /// Submenu label — `"App"` / `"Edit"` / `"View"` / `"Window"` in
    /// Phase 43. macOS treats the first submenu specially (it's
    /// attached to the application name menu regardless of label).
    pub submenu: String,
    /// What kind of entry to render.
    pub kind: PluginAppMenuItemKind,
}

#[derive(Debug, Clone)]
pub enum PluginAppMenuItemKind {
    /// A `PredefinedMenuItem` — macOS binds standard behaviour +
    /// accelerator automatically (e.g. `Quit` → Cmd+Q). Defined by
    /// [`AppMenuRole`].
    Predefined(AppMenuRole),
    /// A horizontal separator line in the submenu.
    Separator,
    /// A plugin-defined custom item. `id` becomes the dispatch key
    /// for `on_menu_event`; `label` is the visible text.
    Custom {
        id: String,
        label: String,
        accelerator: Option<String>,
    },
}

/// Roles the core plugin wires into the macOS App / Edit / View /
/// Window submenus. Tauri v2 maps each to a `PredefinedMenuItem`
/// constructor on `SubmenuBuilder`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AppMenuRole {
    About,
    Hide,
    HideOthers,
    ShowAll,
    Quit,
    Undo,
    Redo,
    Cut,
    Copy,
    Paste,
    SelectAll,
    Minimize,
    Maximize,
    Fullscreen,
    CloseWindow,
}

// ---------------------------------------------------------------------------
// PluginAction
// ---------------------------------------------------------------------------

/// What to do when the user activates a tray or app-menu item.
///
/// `Clone` is required because the dispatch map is held in an
/// `Arc<HashMap<_, _>>` and individual actions get cloned into
/// `on_menu_event` closures. `Custom` carries an `Arc<dyn Fn>` which
/// is itself cheaply cloneable, so the derive works.
#[derive(Clone)]
pub enum PluginAction {
    /// Show + focus + unminimize the main window. Mirrors the
    /// `single_instance` callback behaviour — used for the tray
    /// "show" item and for the macOS app menu "Window" → "Show All".
    ShowMainWindow,
    /// Quit the application (`app.exit(0)`).
    Quit,
    /// Switch the frontend view. Emits
    /// `frontend://switch-view` (Q43-2) with the view id as payload.
    /// Phase 44 will wire `App.tsx` to listen for this event.
    SwitchView(String),
    /// Escape hatch for plugins that need full control over the
    /// dispatch — e.g. opening a non-standard window, spawning a
    /// subprocess. The closure MUST be `Send + Sync` because
    /// `on_menu_event` runs on whichever thread the OS event loop
    /// uses; the `Arc` makes this cheap.
    Custom(Arc<dyn Fn(&AppHandle) + Send + Sync>),
}

impl PluginAction {
    /// Execute the action against the live `AppHandle`. Errors are
    /// intentionally swallowed (matches Tauri's own `on_menu_event`
    /// idioms — failures here mean "the user clicked something but
    /// the app couldn't do it", and the best UI is to log + carry on).
    pub fn dispatch(&self, app: &AppHandle) {
        match self {
            PluginAction::ShowMainWindow => show_main_window(app),
            PluginAction::Quit => app.exit(0),
            PluginAction::SwitchView(view_id) => {
                let _ = app.emit("frontend://switch-view", view_id.clone());
            }
            PluginAction::Custom(f) => f(app),
        }
    }
}

impl std::fmt::Debug for PluginAction {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PluginAction::ShowMainWindow => write!(f, "ShowMainWindow"),
            PluginAction::Quit => write!(f, "Quit"),
            PluginAction::SwitchView(v) => write!(f, "SwitchView({v})"),
            PluginAction::Custom(_) => write!(f, "Custom(<fn>)"),
        }
    }
}

/// Show + focus + unminimize the `main` window. Shared by the tray
/// "show" action and the macOS `ShowAll` predefined role.
pub fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
        let _ = window.unminimize();
    }
}

// ---------------------------------------------------------------------------
// unregister_actions
// ---------------------------------------------------------------------------

/// Remove all actions contributed by `plugin_id` from the dispatch map.
///
/// Convention: action ids are prefixed `"<plugin_id>:"`. This is the
/// mechanism `PluginHost::shutdown` uses (or hot-reload will use) to
/// garbage-collect a plugin's menu contributions without touching
/// another plugin's entries.
///
/// # Example
///
/// ```ignore
/// let mut actions: HashMap<String, PluginAction> = HashMap::new();
/// actions.insert("core:show".into(), PluginAction::ShowMainWindow);
/// actions.insert("other:show".into(), PluginAction::ShowMainWindow);
/// unregister_actions(&mut actions, "core");
/// assert!(!actions.contains_key("core:show"));
/// assert!(actions.contains_key("other:show"));
/// ```
pub fn unregister_actions(actions: &mut HashMap<String, PluginAction>, plugin_id: &str) {
    let prefix = format!("{plugin_id}:");
    actions.retain(|k, _| !k.starts_with(&prefix));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    /// All 4 variants of `PluginAction` must be `Clone` because the
    /// dispatch map is `Arc<HashMap<_, _>>` and individual entries get
    /// cloned into the `on_menu_event` closure. `Custom` carries an
    /// `Arc<dyn Fn>` so the derive `Clone` works there too.
    ///
    /// We can't actually `dispatch` (would need a real `AppHandle`),
    /// so the test only proves the variants exist + clone.
    #[test]
    fn action_variants_are_cloneable_and_debug() {
        let a = PluginAction::ShowMainWindow;
        let b = PluginAction::Quit;
        let c = PluginAction::SwitchView("providers".into());
        let d: PluginAction = PluginAction::Custom(Arc::new(|_app| {
            // no-op
        }));

        let a2 = a.clone();
        let b2 = b.clone();
        let c2 = c.clone();
        let d2 = d.clone();

        // Debug formatting compiles + produces something non-empty.
        assert!(!format!("{:?}", a2).is_empty());
        assert!(!format!("{:?}", b2).is_empty());
        assert!(!format!("{:?}", c2).is_empty());
        assert!(!format!("{:?}", d2).is_empty());
    }

    /// `unregister_actions` must remove ONLY the keys with the given
    /// `<plugin_id>:` prefix — never another plugin's entries. This
    /// pins the hot-reload / shutdown cleanup contract.
    #[test]
    fn unregister_actions_removes_only_target_plugin() {
        let mut actions: HashMap<String, PluginAction> = HashMap::new();
        actions.insert("a:show".into(), PluginAction::ShowMainWindow);
        actions.insert("a:quit".into(), PluginAction::Quit);
        actions.insert("b:show".into(), PluginAction::ShowMainWindow);
        actions.insert("c:switch".into(), PluginAction::SwitchView("x".into()));

        unregister_actions(&mut actions, "a");

        assert!(!actions.contains_key("a:show"));
        assert!(!actions.contains_key("a:quit"));
        assert!(actions.contains_key("b:show"));
        assert!(actions.contains_key("c:switch"));
    }

    /// Edge case: empty map + nonexistent plugin id must not panic.
    /// Also covers the case where `plugin_id` doesn't end with `:`
    /// (no key starts with `"<plugin_id>:"` because there's no colon).
    #[test]
    fn unregister_actions_empty_input_no_panic() {
        let mut actions: HashMap<String, PluginAction> = HashMap::new();
        unregister_actions(&mut actions, "never-registered");
        assert_eq!(actions.len(), 0);

        // No trailing colon in the prefix — still safe.
        let mut actions: HashMap<String, PluginAction> = HashMap::new();
        actions.insert("foo".into(), PluginAction::Quit);
        unregister_actions(&mut actions, "foo");
        assert_eq!(actions.len(), 1);
    }
}