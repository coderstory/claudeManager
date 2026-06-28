//! F15 — 错误反馈 / 自动更新 (plugin commands).
//!
//! Phase 42 — physical migration of the 3 updater commands from
//! `src-tauri/src/commands/updater.rs` to this plugin's commands
//! module. The frontend invoke names (`get_updater_pubkey`,
//! `get_updater_endpoints`, `check_update`) are preserved verbatim —
//! Tauri uses them as the global IPC namespace, so they must match
//! the pre-migration command set exactly.
//!
//! Behaviour preserved verbatim from the source command file:
//! - `get_updater_pubkey`    → returns `state.updater_pubkey.clone()`
//! - `get_updater_endpoints` → returns `state.updater_endpoints.clone()`
//! - `check_update`          → returns `Err("not implemented in Phase 1")`
//!   (M4.3 Phase 1 stub — heavy lifting lives in tauri-plugin-updater)

use tauri::ipc::Invoke;

use crate::app_state::AppState;
use crate::plugins::dispatch::CommandSpec;

// ---------------------------------------------------------------------------
// dispatch wrappers
// ---------------------------------------------------------------------------

/// Dispatch wrapper for `get_updater_pubkey`.
///
/// Reads the pubkey baked into `AppState` from `tauri.conf.json`
/// (`plugins.updater.pubkey`) and returns it as a `String`. Mirrors
/// the original `#[tauri::command]` 1:1 — no service layer in M4.3
/// Phase 1, so we go straight to `AppState`.
pub fn dispatch_get_updater_pubkey(invoke: Invoke<tauri::Wry>) -> bool {
    let state = invoke.message.state_ref().get::<AppState>();
    let result: Result<String, tauri::ipc::InvokeError> = Ok(state.updater_pubkey.clone());
    invoke.resolver.respond(result);
    true
}

/// Dispatch wrapper for `get_updater_endpoints`.
///
/// Reads the updater endpoints (GitHub Releases JSON manifest in
/// production) baked into `AppState` from `tauri.conf.json`
/// (`plugins.updater.endpoints`) and returns them as `Vec<String>`.
pub fn dispatch_get_updater_endpoints(invoke: Invoke<tauri::Wry>) -> bool {
    let state = invoke.message.state_ref().get::<AppState>();
    let result: Result<Vec<String>, tauri::ipc::InvokeError> = Ok(state.updater_endpoints.clone());
    invoke.resolver.respond(result);
    true
}

/// Dispatch wrapper for `check_update`.
///
/// M4.3 Phase 1 stub: returns
/// `"check_update: not implemented in Phase 1 (pubkey + endpoint only)"`
/// to the frontend. The real check/download/install flow lives in
/// `tauri-plugin-updater`'s built-in commands (registered separately
/// by the plugin's own `Builder` step in `lib.rs`).
///
/// Wrapped in `tauri::async_runtime::block_on` to mirror the
/// original `async fn` signature — even though the current stub
/// returns synchronously, keeping the async boundary makes the
/// Phase 2 upgrade a one-line body change.
pub fn dispatch_check_update(invoke: Invoke<tauri::Wry>) -> bool {
    tauri::async_runtime::block_on(async move {
        let result: Result<String, tauri::ipc::InvokeError> = Err(
            "check_update: not implemented in Phase 1 (pubkey + endpoint only)"
                .into(),
        );
        invoke.resolver.respond(result);
    });
    true
}

// ---------------------------------------------------------------------------
// inventory::submit! registrations
// ---------------------------------------------------------------------------

inventory::submit!(CommandSpec {
    name: "get_updater_pubkey",
    plugin_id: "updater",
    dispatch: dispatch_get_updater_pubkey,
});

inventory::submit!(CommandSpec {
    name: "get_updater_endpoints",
    plugin_id: "updater",
    dispatch: dispatch_get_updater_endpoints,
});

inventory::submit!(CommandSpec {
    name: "check_update",
    plugin_id: "updater",
    dispatch: dispatch_check_update,
});

// ---------------------------------------------------------------------------
// Tests — verify all 3 commands register under plugin_id="updater"
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    /// Walk the global inventory and return every CommandSpec whose
    /// `plugin_id` is "updater". Used by the test below to assert the
    /// stub registered exactly 3 commands (no more, no fewer).
    fn updater_specs() -> Vec<&'static CommandSpec> {
        inventory::iter::<CommandSpec>()
            .filter(|c| c.plugin_id == "updater")
            .collect()
    }

    #[test]
    fn inventory_registers_three_updater_commands() {
        let specs = updater_specs();
        let names: Vec<&str> = specs.iter().map(|c| c.name).collect();
        assert!(
            names.contains(&"get_updater_pubkey"),
            "missing get_updater_pubkey in inventory: {:?}",
            names
        );
        assert!(
            names.contains(&"get_updater_endpoints"),
            "missing get_updater_endpoints in inventory: {:?}",
            names
        );
        assert!(
            names.contains(&"check_update"),
            "missing check_update in inventory: {:?}",
            names
        );
        assert_eq!(
            specs.len(),
            3,
            "updater plugin should register exactly 3 commands, got {} ({:?})",
            specs.len(),
            names
        );
    }

    #[test]
    fn dispatch_table_routes_updater_commands() {
        let table = crate::plugins::dispatch::DispatchTable::from_inventory();
        for name in &["get_updater_pubkey", "get_updater_endpoints", "check_update"] {
            let spec = table
                .get(name)
                .unwrap_or_else(|| panic!("updater command `{}` must be in dispatch table", name));
            assert_eq!(spec.plugin_id, "updater");
        }
    }
}
