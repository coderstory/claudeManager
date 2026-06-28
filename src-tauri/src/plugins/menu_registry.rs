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

use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;

use tauri::menu::{AboutMetadata, Menu, MenuBuilder, MenuItem, Submenu, SubmenuBuilder};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager};

use crate::plugins::host::PluginHost;

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
///
/// `PluginAction` defaults to `PluginAction<tauri::Wry>` so the common
/// case (desktop app on the default Tauri stack) doesn't need a type
/// parameter at the use site. Tests / non-Wry runtimes can override.
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
///
/// Phase 43 pins `PluginAction` to the default Tauri runtime
/// (`tauri::Wry`). All four variants use Wry-aware APIs
/// (`app.exit`, `app.get_webview_window`, `Emitter::emit`), but the
/// Wry-ness is encapsulated here so callers don't have to thread a
/// runtime type parameter through. If we ever ship a non-Wry
/// runtime (e.g. `tauri::test::MockRuntime` for in-memory tests) this
/// becomes `PluginAction<R: Runtime>` — the cost will be visible in
/// every plugin stub.
///
/// `Clone` is derive-able here (vs. the generic version we'd need
/// for a runtime-parameterised enum) because the only field that
/// needs cloning is `String` (in `SwitchView`) and `Arc<dyn Fn>`
/// (in `Custom`), both of which are `Clone` regardless of runtime.
///
/// `Custom`'s inner closure is `+ 'static` because Tauri's
/// `TrayIconBuilder::on_menu_event` requires the handler closure
/// to be `Fn(&AppHandle, MenuEvent) + Send + Sync + 'static` (the
/// tray lives for the full app lifetime, and the closure is moved
/// into a long-lived slot).
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
    /// subprocess. The closure MUST be `Send + Sync + 'static` because
    /// `on_menu_event` runs on whichever thread the OS event loop
    /// uses AND the tray icon lives for the full app lifetime.
    /// The `Arc` makes this cheap.
    Custom(Arc<dyn Fn(&AppHandle) + Send + Sync + 'static>),
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
// Tray assembly (cross-platform — Windows + macOS)
// ---------------------------------------------------------------------------

/// Build the system tray menu from every registered plugin's
/// `tray_items()` and pair each item with its [`PluginAction`] in a
/// dispatch map.
///
/// Returns `(Menu, dispatch_map)` so the caller can:
/// - attach the `Menu` to a `TrayIconBuilder`
/// - install the dispatch map inside the `on_menu_event` closure
///
/// The `Menu<R>` is generic over the Tauri runtime; callers on the
/// default Tauri stack use `tauri::Wry` (re-exported as
/// `tauri::Wry` here via the `Runtime` trait bound).
///
/// The dispatch map is shared via `Arc` so `on_menu_event` closures
/// can capture it cheaply and stay `Send + Sync`.
pub fn build_tray(
    host: &PluginHost,
    app: &AppHandle<tauri::Wry>,
) -> tauri::Result<(Menu<tauri::Wry>, Arc<HashMap<String, PluginAction>>)> {
    let mut items: Vec<MenuItem<tauri::Wry>> = Vec::new();
    let mut actions: HashMap<String, PluginAction> = HashMap::new();

    // Walk plugins in registration order so the tray menu's first item
    // is the first plugin's first item (deterministic + matches
    // `all_tray_items` order on the host).
    for (_id, plugin) in host.iter() {
        for item in plugin.tray_items() {
            let mi = MenuItem::with_id(
                app,
                &item.id,
                &item.label,
                item.enabled,
                item.accelerator.as_deref(),
            )?;
            items.push(mi);
            actions.insert(item.id.clone(), item.action);
        }
    }

    // Convert Vec<MenuItem<Wry>> to a slice of trait objects. After
    // `Menu::with_items` returns, the Menu owns its copies — the local
    // Vec is dropped at the end of this fn and lifetime ties are gone.
    let item_refs: Vec<&dyn tauri::menu::IsMenuItem<tauri::Wry>> = items
        .iter()
        .map(|i| i as &dyn tauri::menu::IsMenuItem<tauri::Wry>)
        .collect();
    let menu = Menu::with_items(app, &item_refs)?;
    Ok((menu, Arc::new(actions)))
}

/// Install a `TrayIcon` (id = `"main-tray"`) with the given menu +
/// dispatch map. The `on_menu_event` closure looks the clicked id up
/// in `actions` and dispatches the bound [`PluginAction`] against the
/// live [`AppHandle`].
///
/// `icon` is the application icon (caller resolves
/// `app.default_window_icon().cloned()`). `tooltip` shows on hover.
///
/// Pinned to the `tauri::Wry` runtime — lib.rs always uses Wry
/// (desktop), so the concrete type matches `PluginAction`'s default.
pub fn install_tray(
    app: &AppHandle<tauri::Wry>,
    menu: &Menu<tauri::Wry>,
    actions: Arc<HashMap<String, PluginAction>>,
    icon: tauri::image::Image<'_>,
    tooltip: &str,
) -> tauri::Result<()> {
    // The `on_menu_event` closure only needs `actions` (cheaply
    // cloneable via Arc). The `app: &AppHandle<R>` parameter to the
    // closure is supplied by Tauri at click-time — we don't capture
    // the outer `app` here so the outer `app` is still available
    // for `TrayIconBuilder::build(app)` below.
    TrayIconBuilder::with_id("main-tray")
        .icon(icon)
        .tooltip(tooltip)
        .menu(menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| {
            let id = event.id.as_ref();
            if let Some(action) = actions.get(id) {
                action.dispatch(app);
            } else {
                log::warn!("[menu] no action for id={id}");
            }
        })
        .build(app)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// macOS application menu (no-op on Windows / Linux)
// ---------------------------------------------------------------------------

/// Build and install the macOS application menu (NSMenu in the system
/// menu bar) from every registered plugin's `app_menu_items()`. On
/// non-mac targets this is a no-op — `core-plugin::init` calls it
/// unconditionally and the cfg guards Windows / Linux from accidentally
/// walking the macOS branch.
///
/// Items are grouped by their `submenu` field ("App" / "Edit" / "View"
/// / "Window") with a `BTreeMap` so the menu order is deterministic
/// across runs (alphabetical by submenu label). The first submenu
/// rendered becomes the application menu (its label is replaced by
/// the app name on macOS — this is how the OS works).
#[cfg(target_os = "macos")]
pub fn build_app_menu(
    host: &PluginHost,
    app: &AppHandle<tauri::Wry>,
) -> tauri::Result<()> {
    let mut groups: BTreeMap<String, Vec<PluginAppMenuItem>> = BTreeMap::new();
    for (_id, plugin) in host.iter() {
        for item in plugin.app_menu_items() {
            groups.entry(item.submenu.clone()).or_default().push(item);
        }
    }

    let mut root = MenuBuilder::new(app);
    for (submenu_label, items) in groups {
        let sb = SubmenuBuilder::new(app, &submenu_label);
        let submenu = build_submenu_from_items(app, sb, items)?;
        root = root.item(&submenu);
    }

    let menu = root.build()?;
    app.set_menu(menu)?;
    Ok(())
}

/// Non-macOS stub: the macOS App menu is a no-op everywhere else so
/// `core-plugin::init` can call this unconditionally. The cfg on
/// `build_app_menu` already filters macOS-vs-rest at compile time —
/// this stub just keeps the symbol available so `core.rs` compiles
/// on all targets.
#[cfg(not(target_os = "macos"))]
pub fn build_app_menu(
    _host: &PluginHost,
    _app: &AppHandle<tauri::Wry>,
) -> tauri::Result<()> {
    Ok(())
}

#[cfg(target_os = "macos")]
fn build_submenu_from_items<'a>(
    app: &AppHandle<tauri::Wry>,
    mut sb: SubmenuBuilder<'a, tauri::Wry, AppHandle<tauri::Wry>>,
    items: Vec<PluginAppMenuItem>,
) -> tauri::Result<Submenu<tauri::Wry>> {
    // Chain the builder instead of passing it through helpers — keeps
    // the `'m` lifetime short and avoids tying builder types across
    // function boundaries.
    for item in items {
        sb = match item.kind {
            PluginAppMenuItemKind::Predefined(role) => apply_predefined_role(app, sb, role)?,
            PluginAppMenuItemKind::Separator => sb.separator(),
            PluginAppMenuItemKind::Custom {
                id,
                label,
                accelerator,
            } => {
                let mi = MenuItem::with_id(app, &id, &label, true, accelerator.as_deref())?;
                sb.item(&mi)
            }
        };
    }
    sb.build().map_err(Into::into)
}

#[cfg(target_os = "macos")]
fn apply_predefined_role<'a>(
    app: &AppHandle<tauri::Wry>,
    sb: SubmenuBuilder<'a, tauri::Wry, AppHandle<tauri::Wry>>,
    role: AppMenuRole,
) -> tauri::Result<SubmenuBuilder<'a, tauri::Wry, AppHandle<tauri::Wry>>> {
    let pkg = app.package_info();
    let bundle = &app.config().bundle;
    Ok(match role {
        AppMenuRole::About => {
            let meta = AboutMetadata {
                name: Some(pkg.name.clone()),
                version: Some(pkg.version.to_string()),
                copyright: bundle.copyright.clone(),
                authors: bundle.publisher.clone().map(|p| vec![p]),
                ..Default::default()
            };
            sb.about(Some(meta))
        }
        AppMenuRole::Hide => sb.hide(),
        AppMenuRole::HideOthers => sb.hide_others(),
        AppMenuRole::ShowAll => sb.show_all(),
        AppMenuRole::Quit => sb.quit(),
        AppMenuRole::Undo => sb.undo(),
        AppMenuRole::Redo => sb.redo(),
        AppMenuRole::Cut => sb.cut(),
        AppMenuRole::Copy => sb.copy(),
        AppMenuRole::Paste => sb.paste(),
        AppMenuRole::SelectAll => sb.select_all(),
        AppMenuRole::Minimize => sb.minimize(),
        AppMenuRole::Maximize => sb.maximize(),
        AppMenuRole::Fullscreen => sb.fullscreen(),
        AppMenuRole::CloseWindow => sb.close_window(),
    })
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