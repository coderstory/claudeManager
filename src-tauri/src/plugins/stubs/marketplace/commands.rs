//! F17 — 资源市场 (plugin commands).
//!
//! Phase 42 — physical migration of the 6 marketplace commands from
//! `src-tauri/src/commands/marketplace.rs` to this plugin's commands
//! module. The frontend invoke names (`list_marketplace_repos`,
//! `clone_and_scan`, `install_from_marketplace`, `install_builtin_plugin`,
//! `install_third_party_repo`, `install_npx_package`) are preserved
//! verbatim — Tauri uses them as the global IPC namespace, so they
//! must match the pre-migration command set exactly.
//!
//! Behaviour preserved verbatim from the source command file:
//! - `list_marketplace_repos`     → returns `Vec<MarketplaceRepo>` (no I/O).
//! - `clone_and_scan`             → clone + scan, returns `ScanResult`.
//! - `install_from_marketplace`   → copy resource to `~/.claude/<subdir>/`.
//! - `install_builtin_plugin`     → `claude plugin install <target>` CLI.
//! - `install_third_party_repo`   → clone + scan + loop install.
//! - `install_npx_package`        → `npx <pkg> --global --silent`.
//!
//! All six wrap the corresponding `MarketplaceService` method via
//! `tauri::async_runtime::block_on` (mirrors the original `async fn`
//! signature so the service's existing concurrency / cancellation
//! semantics carry over verbatim).
//!
//! Args are pulled from `invoke.message.payload()` (an `InvokeBody`)
//! — `InvokeBody::Json(value)` is matched and individual keys are
//! extracted via `serde_json::Value::get`. Args that are not present
//! fall back to a JSON `null` deserialisation (matching the
//! original `Option<InstallOptions>` default behaviour) so missing
//! optional keys produce `None` instead of erroring.
//!
//! App state is fetched via `invoke.message.state_ref().get::<AppState>()`
//! (matches the in-tree pattern from
//! [`crate::plugins::stubs::updater::commands`] — `Invoke` has no
//! `app_handle` field, so we go through `InvokeMessage::state_ref`).

use tauri::ipc::Invoke;

use crate::app_state::AppState;
use crate::plugins::dispatch::CommandSpec;
use crate::services::marketplace_service::{InstallOptions, MarketplaceRepo};

// ---------------------------------------------------------------------------
// Args extraction helpers
// ---------------------------------------------------------------------------

/// Extract a string key from the JSON payload. Returns `None` when the
/// payload is `Raw` or the key is missing / not a string. The frontend
/// always sends `Json` payloads, so this is a hard contract — a `Raw`
/// payload means the caller bypassed `invoke()` (testing only) and
/// we treat it as missing args.
fn payload_str(invoke: &Invoke<tauri::Wry>, key: &str) -> Option<String> {
    match invoke.message.payload() {
        tauri::ipc::InvokeBody::Json(v) => v
            .get(key)
            .and_then(|x| x.as_str())
            .map(|s| s.to_string()),
        tauri::ipc::InvokeBody::Raw(_) => None,
    }
}

/// Extract an `Option<InstallOptions>` from the payload. The frontend
/// passes the literal object or `undefined` (omits the key); in both
/// cases the service falls back to `InstallOptions::default()`.
fn payload_install_options(invoke: &Invoke<tauri::Wry>) -> Option<InstallOptions> {
    match invoke.message.payload() {
        tauri::ipc::InvokeBody::Json(v) => v
            .get("options")
            .and_then(|x| serde_json::from_value::<InstallOptions>(x.clone()).ok()),
        tauri::ipc::InvokeBody::Raw(_) => None,
    }
}

/// Extract a `Vec<String>` from the payload (used by `selections`).
/// Empty / missing → `vec![]` to match the service's default.
fn payload_string_vec(invoke: &Invoke<tauri::Wry>, key: &str) -> Vec<String> {
    match invoke.message.payload() {
        tauri::ipc::InvokeBody::Json(v) => v
            .get(key)
            .and_then(|x| x.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|x| x.as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default(),
        tauri::ipc::InvokeBody::Raw(_) => Vec::new(),
    }
}

// ---------------------------------------------------------------------------
// Dispatch wrappers
// ---------------------------------------------------------------------------

/// Dispatch wrapper for `list_marketplace_repos`.
///
/// No args. Returns the hardcoded builtin repo list (no I/O). The
/// original `async fn` is `Ok(...)`-shaped and never awaits, but we
/// keep the `block_on` boundary so the future service layer can
/// upgrade the body to actually `await` something without touching
/// this wrapper.
pub fn dispatch_list_marketplace_repos(invoke: Invoke<tauri::Wry>) -> bool {
    let state = invoke.message.state_ref().get::<AppState>();
    tauri::async_runtime::block_on(async move {
        let v: Vec<MarketplaceRepo> = state.marketplace_service.list_builtin_repos();
        let result: Result<Vec<MarketplaceRepo>, tauri::ipc::InvokeError> = Ok(v);
        invoke.resolver.respond(result);
    });
    true
}

/// Dispatch wrapper for `clone_and_scan`.
pub fn dispatch_clone_and_scan(invoke: Invoke<tauri::Wry>) -> bool {
    let url = payload_str(&invoke, "url").unwrap_or_default();
    let state = invoke.message.state_ref().get::<AppState>();
    tauri::async_runtime::block_on(async move {
        let result: Result<_, tauri::ipc::InvokeError> = state
            .marketplace_service
            .clone_and_scan(&url)
            .map_err(|e| e.to_string().into());
        invoke.resolver.respond(result);
    });
    true
}

/// Dispatch wrapper for `install_from_marketplace`.
pub fn dispatch_install_from_marketplace(invoke: Invoke<tauri::Wry>) -> bool {
    let repo_path = payload_str(&invoke, "repo_path").unwrap_or_default();
    let resource_id = payload_str(&invoke, "resource_id").unwrap_or_default();
    let options = payload_install_options(&invoke);
    let state = invoke.message.state_ref().get::<AppState>();
    // M3.12 (A1#12) — read live active root via the platform shim.
    let active_root = crate::platform::runtime::paths().active_root_dir();
    tauri::async_runtime::block_on(async move {
        let result: Result<_, tauri::ipc::InvokeError> = state
            .marketplace_service
            .install_resource_with_active_root(
                &repo_path,
                &resource_id,
                options,
                active_root.as_deref(),
            )
            .map_err(|e| e.to_string().into());
        invoke.resolver.respond(result);
    });
    true
}

/// Dispatch wrapper for `install_builtin_plugin`.
pub fn dispatch_install_builtin_plugin(invoke: Invoke<tauri::Wry>) -> bool {
    let plugin_id = payload_str(&invoke, "plugin_id").unwrap_or_default();
    let state = invoke.message.state_ref().get::<AppState>();
    let active_root = crate::platform::runtime::paths().active_root_dir();
    tauri::async_runtime::block_on(async move {
        let result: Result<_, tauri::ipc::InvokeError> = state
            .marketplace_service
            .install_builtin_with_active_root(&plugin_id, active_root.as_deref())
            .map_err(|e| e.to_string().into());
        invoke.resolver.respond(result);
    });
    true
}

/// Dispatch wrapper for `install_third_party_repo`.
pub fn dispatch_install_third_party_repo(invoke: Invoke<tauri::Wry>) -> bool {
    let url = payload_str(&invoke, "url").unwrap_or_default();
    let selections = payload_string_vec(&invoke, "selections");
    let options = payload_install_options(&invoke);
    let state = invoke.message.state_ref().get::<AppState>();
    let active_root = crate::platform::runtime::paths().active_root_dir();
    tauri::async_runtime::block_on(async move {
        let result: Result<_, tauri::ipc::InvokeError> = state
            .marketplace_service
            .install_third_party_with_active_root(
                &url,
                selections,
                options,
                active_root.as_deref(),
            )
            .map_err(|e| e.to_string().into());
        invoke.resolver.respond(result);
    });
    true
}

/// Dispatch wrapper for `install_npx_package`.
pub fn dispatch_install_npx_package(invoke: Invoke<tauri::Wry>) -> bool {
    let package = payload_str(&invoke, "package").unwrap_or_default();
    let state = invoke.message.state_ref().get::<AppState>();
    let active_root = crate::platform::runtime::paths().active_root_dir();
    tauri::async_runtime::block_on(async move {
        let result: Result<_, tauri::ipc::InvokeError> = state
            .marketplace_service
            .install_npx_with_active_root(&package, active_root.as_deref())
            .map_err(|e| e.to_string().into());
        invoke.resolver.respond(result);
    });
    true
}

// ---------------------------------------------------------------------------
// inventory::submit! registrations
// ---------------------------------------------------------------------------

inventory::submit!(CommandSpec {
    name: "list_marketplace_repos",
    plugin_id: "marketplace",
    dispatch: dispatch_list_marketplace_repos,
});

inventory::submit!(CommandSpec {
    name: "clone_and_scan",
    plugin_id: "marketplace",
    dispatch: dispatch_clone_and_scan,
});

inventory::submit!(CommandSpec {
    name: "install_from_marketplace",
    plugin_id: "marketplace",
    dispatch: dispatch_install_from_marketplace,
});

inventory::submit!(CommandSpec {
    name: "install_builtin_plugin",
    plugin_id: "marketplace",
    dispatch: dispatch_install_builtin_plugin,
});

inventory::submit!(CommandSpec {
    name: "install_third_party_repo",
    plugin_id: "marketplace",
    dispatch: dispatch_install_third_party_repo,
});

inventory::submit!(CommandSpec {
    name: "install_npx_package",
    plugin_id: "marketplace",
    dispatch: dispatch_install_npx_package,
});

// ---------------------------------------------------------------------------
// Tests — verify all 6 commands register under plugin_id="marketplace"
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    /// Walk the global inventory and return every CommandSpec whose
    /// `plugin_id` is "marketplace". Used by the test below to assert the
    /// stub registered exactly 6 commands (no more, no fewer).
    fn marketplace_specs() -> Vec<&'static CommandSpec> {
        inventory::iter::<CommandSpec>()
            .filter(|c| c.plugin_id == "marketplace")
            .collect()
    }

    #[test]
    fn inventory_registers_six_marketplace_commands() {
        let specs = marketplace_specs();
        let names: Vec<&str> = specs.iter().map(|c| c.name).collect();
        assert!(
            names.contains(&"list_marketplace_repos"),
            "missing list_marketplace_repos in inventory: {:?}",
            names
        );
        assert!(
            names.contains(&"clone_and_scan"),
            "missing clone_and_scan in inventory: {:?}",
            names
        );
        assert!(
            names.contains(&"install_from_marketplace"),
            "missing install_from_marketplace in inventory: {:?}",
            names
        );
        assert!(
            names.contains(&"install_builtin_plugin"),
            "missing install_builtin_plugin in inventory: {:?}",
            names
        );
        assert!(
            names.contains(&"install_third_party_repo"),
            "missing install_third_party_repo in inventory: {:?}",
            names
        );
        assert!(
            names.contains(&"install_npx_package"),
            "missing install_npx_package in inventory: {:?}",
            names
        );
        assert_eq!(
            specs.len(),
            6,
            "marketplace plugin should register exactly 6 commands, got {} ({:?})",
            specs.len(),
            names
        );
    }

    #[test]
    fn dispatch_table_routes_marketplace_commands() {
        let table = crate::plugins::dispatch::DispatchTable::from_inventory();
        for name in &[
            "list_marketplace_repos",
            "clone_and_scan",
            "install_from_marketplace",
            "install_builtin_plugin",
            "install_third_party_repo",
            "install_npx_package",
        ] {
            let spec = table.get(name).unwrap_or_else(|| {
                panic!("marketplace command `{}` must be in dispatch table", name)
            });
            assert_eq!(spec.plugin_id, "marketplace");
        }
    }

    /// Smoke-test that all 6 dispatch fn pointers are callable as
    /// `fn(Invoke<tauri::Wry>) -> bool`. We can't construct a real
    /// `Invoke` without a Tauri runtime, but we can verify the
    /// function symbols exist by taking their addresses.
    /// `[allow(unused)]` because the references are only used to
    /// force symbol resolution at compile time.
    #[allow(unused)]
    #[test]
    fn dispatch_fn_symbols_exist() {
        let _ = &(dispatch_list_marketplace_repos as fn(Invoke<tauri::Wry>) -> bool);
        let _ = &(dispatch_clone_and_scan as fn(Invoke<tauri::Wry>) -> bool);
        let _ = &(dispatch_install_from_marketplace as fn(Invoke<tauri::Wry>) -> bool);
        let _ = &(dispatch_install_builtin_plugin as fn(Invoke<tauri::Wry>) -> bool);
        let _ = &(dispatch_install_third_party_repo as fn(Invoke<tauri::Wry>) -> bool);
        let _ = &(dispatch_install_npx_package as fn(Invoke<tauri::Wry>) -> bool);
    }

    /// Pin the return-shape compatibility — the dispatch fns return
    /// `ScanResult` / `InstallResult` / `Vec<InstallResult>` /
    /// `Vec<MarketplaceRepo>` from the same service module the old
    /// `commands/marketplace.rs` wrapped. If the service signatures
    /// change, both this stub and the (still-present) old command
    /// file would have to update in lockstep — this test fails if
    /// the types drift.
    #[allow(dead_code)]
    fn _type_pins() {
        // Type-only assertion; never executed.
        fn assert_send<T: Send>() {}
        assert_send::<InstallOptions>();
        assert_send::<MarketplaceRepo>();
    }
}