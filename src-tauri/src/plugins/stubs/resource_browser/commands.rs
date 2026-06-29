//! F16 — 资源浏览 (plugin commands).
//!
//! Migrated from `crate::commands::resource` as part of Phase 42 IPC
//! dispatch refactor (see `.planning/milestones/v3.4-phases/42-HANDOFF.md`).
//! The original `#[tauri::command]` async wrappers are now sync `dispatch_*`
//! fns that bridge `Invoke<tauri::Wry>` to the underlying service calls.
//!
//! ## Architecture
//!
//! ```text
//!  frontend `invoke("list_resources", { kind })`
//!      ↓
//!  lib.rs::setup invokes DispatchTable::dispatch
//!      ↓
//!  DispatchTable looks up "list_resources" → dispatch_list_resources
//!      ↓
//!  tauri::async_runtime::block_on → ResourceService::list_with_active_root
//! ```
//!
//! ## State extraction
//!
//! `Invoke` exposes only `message` / `resolver` / `acl` (not `app_handle`).
//! The Webview is reachable via `invoke.message.webview()` and implements
//! the `Manager` trait, so `webview().state::<AppState>()` returns the
//! shared state — the same shape the original `async fn` commands got
//! from Tauri's `state: State<'_, AppState>` parameter.
//!
//! ## Error stringification
//!
//! `InvokeResolver::respond` takes `Result<T, InvokeError>` where
//! `T: IpcResponse`. `InvokeError` has a blanket `From<T: Serialize>`
//! impl, so `Result<T, String>` → `Result<T, InvokeError>` via
//! `.map_err(Into::into)`. We construct both branches up front to keep
//! type inference straightforward.
//!
//! ## Reveal error shape (M3.5)
//!
//! `reveal_in_file_manager` is the one exception: its `Err` is the
//! structured `RevealFailure` (kind / message / path) so the frontend
//! `formatRevealError` helper can route by `kind` (`"not_found"` /
//! `"permission_denied"` / `"network_path"` / `"launcher_failed"`).
//! `RevealFailure` derives `Serialize`, so it converts to
//! `InvokeError` the same way `String` does.
//!
//! Phase 45 service-registry refactor: `ResourceService` is looked up
//! via `crate::get_service!` (registered in `service_registry` by
//! `plugins::host` at startup).

use std::path::PathBuf;

use tauri::ipc::{Invoke, InvokeBody};
use tauri::Manager;

use crate::app_state::AppState;
use crate::domain::{ResourceDetail, ResourceItem, ResourceKind};
use crate::get_service;
use crate::plugins::dispatch::CommandSpec;
use crate::services::resource_service::{RevealFailure, ResourceServiceError};

// ---------------------------------------------------------------------------
// Args extraction
// ---------------------------------------------------------------------------
//
// `InvokeBody::Json(v)` is the only variant desktop targets emit
// (raw bytes is a mobile-only path; see tauri-2.11.3
// `src/ipc/mod.rs::InvokeBody` doc-comment). We panic on Raw —
// that's a Tauri API contract violation, not a runtime condition.

fn json_args(invoke: &Invoke<tauri::Wry>) -> serde_json::Value {
    match invoke.message.payload() {
        InvokeBody::Json(v) => v.clone(),
        InvokeBody::Raw(_) => panic!(
            "resource_browser dispatch received raw InvokeBody — \
             Tauri desktop only sends JSON, this is an API misuse"
        ),
    }
}

fn kind_from_args(args: &serde_json::Value) -> Result<ResourceKind, String> {
    let kind = args
        .get("kind")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "缺少 kind 参数".to_string())?;
    ResourceKind::from_str_opt(kind).ok_or_else(|| {
        format!("未知资源类型: '{kind}'(允许: plugin, skill, command, lsp, mcp)")
    })
}

fn path_from_args(args: &serde_json::Value) -> Result<PathBuf, String> {
    let p = args
        .get("path")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "缺少 path 参数".to_string())?;
    if p.trim().is_empty() {
        return Err("路径为空".into());
    }
    Ok(PathBuf::from(p))
}

// ---------------------------------------------------------------------------
// dispatch_list_resources
// ---------------------------------------------------------------------------

/// Dispatch wrapper for `list_resources(kind)`.
///
/// F16 — scan the kind-specific subdirectory of the live `~/.claude/`
/// (or `<active_root>/.claude/` in project mode, M3.12 A1#11) and
/// return the matching resources. Returns an empty Vec if the
/// subdirectory is missing (cold-start case for first-time users).
pub fn dispatch_list_resources(invoke: Invoke<tauri::Wry>) -> bool {
    let args = json_args(&invoke);
    let webview = invoke.message.webview();
    let state = webview.state::<AppState>();
    let result: Result<Vec<ResourceItem>, String> =
        tauri::async_runtime::block_on(async move {
            let kind = kind_from_args(&args)?;
            // M3.12 (A1#11) — read live active root via the platform
            // shim (state.paths is a one-shot startup snapshot).
            let active_root = crate::platform::runtime::paths().active_root_dir();
            let svc = get_service!(state, crate::services::resource_service::ResourceService);
            svc.list_with_active_root(kind, active_root.as_deref())
                .map_err(|e| e.to_string())
        });
    let response: Result<Vec<ResourceItem>, tauri::ipc::InvokeError> =
        result.map_err(Into::into);
    invoke.resolver.respond(response);
    true
}

// ---------------------------------------------------------------------------
// dispatch_get_resource_detail
// ---------------------------------------------------------------------------

/// Dispatch wrapper for `get_resource_detail(path, kind)`.
///
/// F22 — read the manifest + file list for a single resource.
/// `path` must come from a previous `list_resources` call.
/// Best-effort: a missing or malformed manifest is not an error,
/// the corresponding fields are `None` in the response.
pub fn dispatch_get_resource_detail(invoke: Invoke<tauri::Wry>) -> bool {
    let args = json_args(&invoke);
    let webview = invoke.message.webview();
    let state = webview.state::<AppState>();
    let result: Result<ResourceDetail, String> =
        tauri::async_runtime::block_on(async move {
            let path = path_from_args(&args)?;
            let kind = kind_from_args(&args)?;
            let svc = get_service!(state, crate::services::resource_service::ResourceService);
            svc.detail(&path, kind).map_err(|e| e.to_string())
        });
    let response: Result<ResourceDetail, tauri::ipc::InvokeError> =
        result.map_err(Into::into);
    invoke.resolver.respond(response);
    true
}

// ---------------------------------------------------------------------------
// dispatch_reveal_in_file_manager
// ---------------------------------------------------------------------------

/// Dispatch wrapper for `reveal_in_file_manager(path)`.
///
/// F16 — open the system file manager with `path` selected.
/// Windows: `explorer /select,<path>`. macOS: `open -R <path>`.
///
/// Returns `Result<(), RevealFailure>` (structured, M3.5) so the
/// frontend can route by `kind`. We map the service-side
/// `ResourceServiceError` to `RevealFailure` here at the IPC boundary
/// (the service error type does not derive `Serialize` to avoid
/// leaking internal types — see `resource_service.rs`).
pub fn dispatch_reveal_in_file_manager(invoke: Invoke<tauri::Wry>) -> bool {
    let args = json_args(&invoke);
    let webview = invoke.message.webview();
    let state = webview.state::<AppState>();
    let result: Result<(), RevealFailure> = tauri::async_runtime::block_on(async move {
        // Missing path → synthetic `permission_denied` (the
        // path-validation family), so the frontend routes it
        // consistently with other validation errors instead of
        // leaking a bare string.
        let path_str = args
            .get("path")
            .and_then(|v| v.as_str())
            .ok_or_else(|| RevealFailure {
                kind: "permission_denied".into(),
                message: "缺少 path 参数".into(),
                path: String::new(),
            })?;
        if path_str.trim().is_empty() {
            return Err(RevealFailure {
                kind: "permission_denied".into(),
                message: "路径为空".into(),
                path: String::new(),
            });
        }
        let svc = get_service!(state, crate::services::resource_service::ResourceService);
        svc.reveal(&PathBuf::from(path_str))
            .map_err(|e| match e {
                ResourceServiceError::Reveal { kind, message, path } => {
                    RevealFailure { kind, message, path }
                }
                other => RevealFailure {
                    kind: "launcher_failed".into(),
                    message: other.to_string(),
                    path: path_str.to_string(),
                },
            })
    });
    let response: Result<(), tauri::ipc::InvokeError> = result.map_err(Into::into);
    invoke.resolver.respond(response);
    true
}

// ---------------------------------------------------------------------------
// inventory::submit! — register all 3 commands into the global dispatch table.
// ---------------------------------------------------------------------------
//
// `name` is the string the frontend uses in `invoke("name", ...)` and
// MUST match the original `#[tauri::command]` fn name exactly — Tauri
// uses it as the global IPC namespace (never namespaced by `plugin_id`).

inventory::submit!(CommandSpec {
    name: "list_resources",
    plugin_id: "resource-browser",
    dispatch: dispatch_list_resources,
});

inventory::submit!(CommandSpec {
    name: "get_resource_detail",
    plugin_id: "resource-browser",
    dispatch: dispatch_get_resource_detail,
});

inventory::submit!(CommandSpec {
    name: "reveal_in_file_manager",
    plugin_id: "resource-browser",
    dispatch: dispatch_reveal_in_file_manager,
});

// ---------------------------------------------------------------------------
// Tests — verify all 3 commands register under plugin_id="resource-browser"
// and that the global dispatch table can route them by name (the frontend
// `invoke("list_resources", ...)` etc. must hit the dispatch fn we wrote).
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    /// Walk the global inventory and return every CommandSpec whose
    /// `plugin_id` is "resource-browser". Used by the test below to
    /// assert the stub registered exactly 3 commands (no more, no fewer).
    fn resource_browser_specs() -> Vec<&'static CommandSpec> {
        inventory::iter::<CommandSpec>()
            .filter(|c| c.plugin_id == "resource-browser")
            .collect()
    }

    /// TDD RED gate — guard the 3-command contract. If a future
    /// refactor accidentally drops an `inventory::submit!`, or adds
    /// a 4th one, this test fails first (before the smoke test).
    #[test]
    fn inventory_registers_three_resource_browser_commands() {
        let specs = resource_browser_specs();
        let names: Vec<&str> = specs.iter().map(|c| c.name).collect();
        assert!(
            names.contains(&"list_resources"),
            "missing list_resources in inventory: {:?}",
            names
        );
        assert!(
            names.contains(&"get_resource_detail"),
            "missing get_resource_detail in inventory: {:?}",
            names
        );
        assert!(
            names.contains(&"reveal_in_file_manager"),
            "missing reveal_in_file_manager in inventory: {:?}",
            names
        );
        assert_eq!(
            specs.len(),
            3,
            "resource_browser plugin should register exactly 3 commands, got {} ({:?})",
            specs.len(),
            names
        );
    }

    /// TDD GREEN gate — DispatchTable::from_inventory must surface
    /// every `resource-browser` command under its original IPC name
    /// (Tauri uses the `name` field as the global namespace; renaming
    /// would silently break the frontend).
    #[test]
    fn dispatch_table_routes_resource_browser_commands() {
        let table = crate::plugins::dispatch::DispatchTable::from_inventory();
        for name in &[
            "list_resources",
            "get_resource_detail",
            "reveal_in_file_manager",
        ] {
            let spec = table.get(name).unwrap_or_else(|| {
                panic!(
                    "resource_browser command `{}` must be in dispatch table",
                    name
                )
            });
            assert_eq!(
                spec.plugin_id, "resource-browser",
                "command `{}` should belong to resource-browser",
                name
            );
        }
    }
}