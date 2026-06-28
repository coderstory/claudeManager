//! F6 — MCP 管理 (plugin commands).
//!
//! Phase 42 — physical migration of the 7 mcp-management commands
//! from `src-tauri/src/commands/mcp.rs` to this plugin's commands
//! module. The frontend invoke names (`list_mcp_servers`,
//! `list_mcp_servers_with_warnings`, `toggle_mcp_server`,
//! `add_mcp_server`, `update_mcp_server`, `remove_mcp_server`,
//! `parse_mcp_deeplink`) are preserved verbatim — Tauri uses them as
//! the global IPC namespace, so they must match the pre-migration
//! command set exactly.
//!
//! Behaviour preserved verbatim from the source command file:
//! - `list_mcp_servers`              → reads `mcpServers` from active `mcp.json`.
//! - `list_mcp_servers_with_warnings`→ same + parse warning (None/Some).
//! - `toggle_mcp_server`             → flip `enabled` flag, return updated server.
//! - `add_mcp_server`                → push new server; errors on duplicate name.
//! - `update_mcp_server`             → replace existing; returns updated server.
//! - `remove_mcp_server`             → drop by UUID.
//! - `parse_mcp_deeplink`            → pure URL parser, no I/O.
//!
//! All 7 wrap the corresponding `McpService` method via
//! `tauri::async_runtime::block_on` (mirrors the original `async fn`
//! signature so the service's existing concurrency / cancellation
//! semantics carry over verbatim).
//!
//! Args are pulled from `invoke.message.payload()` (an `InvokeBody`)
//! — `InvokeBody::Json(value)` is matched and individual keys are
//! extracted via `serde_json::Value::get`. Missing args fall back to
//! `serde_json::Value::Null` to keep type inference straightforward.
//!
//! App state is fetched via `invoke.message.state_ref().get::<AppState>()`
//! (matches the in-tree pattern from
//! [`crate::plugins::stubs::updater::commands`] — `Invoke` has no
//! `app_handle` field, so we go through `InvokeMessage::state_ref`).
//!
//! ## M3.12 (A1#4) — `active_root_dir` 接入
//!
//! Each mcp command (except `parse_mcp_deeplink`, which is a pure URL
//! parser with no on-disk dependency) reads the live `active_root_dir`
//! from the platform shim (`crate::platform::runtime::paths()`) and
//! dispatches through `McpService::with_root(...)`. `state.mcp_service`
//! is the user-level snapshot from app startup; the per-call
//! `with_root` re-resolves the path so project-mode (active project in
//! `projects.json`) immediately affects reads/writes without
//! requiring an app restart.

use tauri::ipc::{Invoke, InvokeBody};

use crate::app_state::AppState;
use crate::domain::McpServer;
use crate::infrastructure::deeplink_parser::{parse_deeplink_url as parse_dl, ParsedDeeplink};
use crate::plugins::dispatch::CommandSpec;

// ---------------------------------------------------------------------------
// Args extraction helpers
// ---------------------------------------------------------------------------

/// Pull the JSON args off an `InvokeMessage` payload. Returns
/// `Value::Null` for `Raw` payloads (testing-only path) so missing
/// args produce a clean `None` deserialisation downstream.
fn json_args(invoke: &Invoke<tauri::Wry>) -> serde_json::Value {
    match invoke.message.payload() {
        InvokeBody::Json(v) => v.clone(),
        InvokeBody::Raw(_) => serde_json::Value::Null,
    }
}

/// Extract a string key from the JSON payload. Returns `None` when
/// the payload is `Null` / `Raw` or the key is missing / not a string.
fn payload_str(args: &serde_json::Value, key: &str) -> Option<String> {
    args.get(key)
        .and_then(|x| x.as_str())
        .map(|s| s.to_string())
}

/// Extract a bool key from the JSON payload. Returns `None` when
/// the payload is `Null` or the key is missing / not a bool.
fn payload_bool(args: &serde_json::Value, key: &str) -> Option<bool> {
    args.get(key).and_then(|x| x.as_bool())
}

/// Extract an `McpServer` from the payload under `key`. Missing /
/// wrong-typed args error out at the IPC boundary.
fn payload_mcp_server(args: &serde_json::Value, key: &str) -> Result<McpServer, String> {
    let v = args
        .get(key)
        .ok_or_else(|| format!("缺少 '{key}' 参数"))?;
    serde_json::from_value::<McpServer>(v.clone())
        .map_err(|e| format!("'{key}' 不是合法的 MCP server: {e}"))
}

// ---------------------------------------------------------------------------
// Shared result type (was `pub struct` in commands/mcp.rs)
// ---------------------------------------------------------------------------

/// Result of `list_mcp_servers_with_warnings` — same shape as the
/// pre-migration command. Lives here (instead of `commands/mcp.rs`)
/// because the command is now part of this plugin's surface.
#[derive(Debug, serde::Serialize)]
pub struct ListMcpServersResult {
    pub servers: Vec<McpServer>,
    pub warning: Option<String>,
}

// ---------------------------------------------------------------------------
// dispatch_list_mcp_servers
// ---------------------------------------------------------------------------

/// Dispatch wrapper for `list_mcp_servers`.
///
/// F6 — list all MCP servers in the active `mcp.json`. Reads
/// `~/.claude/mcp.json` (user-level) when no project is active, or
/// `<active_root>/.claude/mcp.json` (project mode) when a project is
/// selected. Returns an empty Vec if the file is missing or
/// `mcpServers` is absent.
pub fn dispatch_list_mcp_servers(invoke: Invoke<tauri::Wry>) -> bool {
    let state = invoke.message.state_ref().get::<AppState>();
    let active_root = crate::platform::runtime::paths().active_root_dir();
    let result: Result<Vec<McpServer>, tauri::ipc::InvokeError> =
        tauri::async_runtime::block_on(async move {
            let v: Vec<McpServer> = state
                .mcp_service
                .with_root(active_root.as_deref())
                .list();
            Ok(v)
        });
    invoke.resolver.respond(result);
    true
}

// ---------------------------------------------------------------------------
// dispatch_list_mcp_servers_with_warnings
// ---------------------------------------------------------------------------

/// Dispatch wrapper for `list_mcp_servers_with_warnings`.
///
/// F6+ — same as `list_mcp_servers` but also returns a parse
/// warning (if any) so the UI can show a non-fatal InfoBar.
pub fn dispatch_list_mcp_servers_with_warnings(invoke: Invoke<tauri::Wry>) -> bool {
    let state = invoke.message.state_ref().get::<AppState>();
    let active_root = crate::platform::runtime::paths().active_root_dir();
    let result: Result<ListMcpServersResult, tauri::ipc::InvokeError> =
        tauri::async_runtime::block_on(async move {
            let (servers, warning) = state
                .mcp_service
                .with_root(active_root.as_deref())
                .list_with_warnings();
            Ok(ListMcpServersResult { servers, warning })
        });
    invoke.resolver.respond(result);
    true
}

// ---------------------------------------------------------------------------
// dispatch_toggle_mcp_server
// ---------------------------------------------------------------------------

/// Dispatch wrapper for `toggle_mcp_server`.
///
/// F6 — toggle the `enabled` flag for the MCP server with the
/// given UUID. Returns the updated server on success.
pub fn dispatch_toggle_mcp_server(invoke: Invoke<tauri::Wry>) -> bool {
    let args = json_args(&invoke);
    let id = payload_str(&args, "id").unwrap_or_default();
    let enabled = payload_bool(&args, "enabled").unwrap_or(true);
    let state = invoke.message.state_ref().get::<AppState>();
    let active_root = crate::platform::runtime::paths().active_root_dir();
    let result: Result<McpServer, tauri::ipc::InvokeError> =
        tauri::async_runtime::block_on(async move {
            state
                .mcp_service
                .with_root(active_root.as_deref())
                .toggle(&id, enabled)
                .map_err(|e| e.to_string().into())
        });
    invoke.resolver.respond(result);
    true
}

// ---------------------------------------------------------------------------
// dispatch_add_mcp_server
// ---------------------------------------------------------------------------

/// Dispatch wrapper for `add_mcp_server`.
///
/// F6 — add a new MCP server. Errors if a server with the same
/// `name` already exists.
pub fn dispatch_add_mcp_server(invoke: Invoke<tauri::Wry>) -> bool {
    let args = json_args(&invoke);
    let server = match payload_mcp_server(&args, "server") {
        Ok(s) => s,
        Err(e) => {
            let result: Result<(), tauri::ipc::InvokeError> = Err(e.into());
            invoke.resolver.respond(result);
            return true;
        }
    };
    let state = invoke.message.state_ref().get::<AppState>();
    let active_root = crate::platform::runtime::paths().active_root_dir();
    let result: Result<(), tauri::ipc::InvokeError> = tauri::async_runtime::block_on(async move {
        state
            .mcp_service
            .with_root(active_root.as_deref())
            .add(server)
            .map_err(|e| e.to_string().into())
    });
    invoke.resolver.respond(result);
    true
}

// ---------------------------------------------------------------------------
// dispatch_update_mcp_server
// ---------------------------------------------------------------------------

/// Dispatch wrapper for `update_mcp_server`.
///
/// F6 — update an existing MCP server (identified by `id`).
/// Returns the updated server on success.
pub fn dispatch_update_mcp_server(invoke: Invoke<tauri::Wry>) -> bool {
    let args = json_args(&invoke);
    let id = payload_str(&args, "id").unwrap_or_default();
    let server = match payload_mcp_server(&args, "server") {
        Ok(s) => s,
        Err(e) => {
            let result: Result<McpServer, tauri::ipc::InvokeError> = Err(e.into());
            invoke.resolver.respond(result);
            return true;
        }
    };
    let state = invoke.message.state_ref().get::<AppState>();
    let active_root = crate::platform::runtime::paths().active_root_dir();
    let result: Result<McpServer, tauri::ipc::InvokeError> =
        tauri::async_runtime::block_on(async move {
            state
                .mcp_service
                .with_root(active_root.as_deref())
                .update(&id, server)
                .map_err(|e| e.to_string().into())
        });
    invoke.resolver.respond(result);
    true
}

// ---------------------------------------------------------------------------
// dispatch_remove_mcp_server
// ---------------------------------------------------------------------------

/// Dispatch wrapper for `remove_mcp_server`.
///
/// F6 — remove the MCP server with the given UUID.
pub fn dispatch_remove_mcp_server(invoke: Invoke<tauri::Wry>) -> bool {
    let args = json_args(&invoke);
    let id = payload_str(&args, "id").unwrap_or_default();
    let state = invoke.message.state_ref().get::<AppState>();
    let active_root = crate::platform::runtime::paths().active_root_dir();
    let result: Result<(), tauri::ipc::InvokeError> = tauri::async_runtime::block_on(async move {
        state
            .mcp_service
            .with_root(active_root.as_deref())
            .remove(&id)
            .map_err(|e| e.to_string().into())
    });
    invoke.resolver.respond(result);
    true
}

// ---------------------------------------------------------------------------
// dispatch_parse_mcp_deeplink
// ---------------------------------------------------------------------------

/// Dispatch wrapper for `parse_mcp_deeplink`.
///
/// F6+ — parse a `ccswitch://v1/import?resource=mcp&...` URL into
/// a `ParsedDeeplink` (M2.5 extension of the F4 deeplink protocol).
/// Reuses the same `parse_deeplink_url` command surface so the
/// frontend only needs one entry point; the `resource` query param
/// discriminates the result shape.
///
/// Intentionally NOT adapted for `active_root_dir` — pure URL parser
/// with no on-disk dependency.
pub fn dispatch_parse_mcp_deeplink(invoke: Invoke<tauri::Wry>) -> bool {
    let args = json_args(&invoke);
    let url = payload_str(&args, "url").unwrap_or_default();
    let result: Result<ParsedDeeplink, tauri::ipc::InvokeError> =
        parse_dl(&url).map_err(|e| e.to_string().into());
    invoke.resolver.respond(result);
    true
}

// ---------------------------------------------------------------------------
// inventory::submit! registrations
// ---------------------------------------------------------------------------
//
// `name` is the string the frontend uses in `invoke("name", ...)` and
// MUST match the original `#[tauri::command]` fn name exactly — Tauri
// uses it as the global IPC namespace (never namespaced by `plugin_id`).

inventory::submit!(CommandSpec {
    name: "list_mcp_servers",
    plugin_id: "mcp-management",
    dispatch: dispatch_list_mcp_servers,
});

inventory::submit!(CommandSpec {
    name: "list_mcp_servers_with_warnings",
    plugin_id: "mcp-management",
    dispatch: dispatch_list_mcp_servers_with_warnings,
});

inventory::submit!(CommandSpec {
    name: "toggle_mcp_server",
    plugin_id: "mcp-management",
    dispatch: dispatch_toggle_mcp_server,
});

inventory::submit!(CommandSpec {
    name: "add_mcp_server",
    plugin_id: "mcp-management",
    dispatch: dispatch_add_mcp_server,
});

inventory::submit!(CommandSpec {
    name: "update_mcp_server",
    plugin_id: "mcp-management",
    dispatch: dispatch_update_mcp_server,
});

inventory::submit!(CommandSpec {
    name: "remove_mcp_server",
    plugin_id: "mcp-management",
    dispatch: dispatch_remove_mcp_server,
});

inventory::submit!(CommandSpec {
    name: "parse_mcp_deeplink",
    plugin_id: "mcp-management",
    dispatch: dispatch_parse_mcp_deeplink,
});

// ---------------------------------------------------------------------------
// Tests — verify all 7 commands register under plugin_id="mcp-management"
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    /// Walk the global inventory and return every CommandSpec whose
    /// `plugin_id` is "mcp-management". Used by the tests below to
    /// assert the stub registered exactly 7 commands (no more, no
    /// fewer).
    fn mcp_specs() -> Vec<&'static CommandSpec> {
        inventory::iter::<CommandSpec>()
            .filter(|c| c.plugin_id == "mcp-management")
            .collect()
    }

    #[test]
    fn inventory_registers_seven_mcp_commands() {
        let specs = mcp_specs();
        let names: Vec<&str> = specs.iter().map(|c| c.name).collect();
        assert!(
            names.contains(&"list_mcp_servers"),
            "missing list_mcp_servers in inventory: {:?}",
            names
        );
        assert!(
            names.contains(&"list_mcp_servers_with_warnings"),
            "missing list_mcp_servers_with_warnings in inventory: {:?}",
            names
        );
        assert!(
            names.contains(&"toggle_mcp_server"),
            "missing toggle_mcp_server in inventory: {:?}",
            names
        );
        assert!(
            names.contains(&"add_mcp_server"),
            "missing add_mcp_server in inventory: {:?}",
            names
        );
        assert!(
            names.contains(&"update_mcp_server"),
            "missing update_mcp_server in inventory: {:?}",
            names
        );
        assert!(
            names.contains(&"remove_mcp_server"),
            "missing remove_mcp_server in inventory: {:?}",
            names
        );
        assert!(
            names.contains(&"parse_mcp_deeplink"),
            "missing parse_mcp_deeplink in inventory: {:?}",
            names
        );
        assert_eq!(
            specs.len(),
            7,
            "mcp-management plugin should register exactly 7 commands, got {} ({:?})",
            specs.len(),
            names
        );
    }

    #[test]
    fn dispatch_table_routes_mcp_commands() {
        let table = crate::plugins::dispatch::DispatchTable::from_inventory();
        for name in &[
            "list_mcp_servers",
            "list_mcp_servers_with_warnings",
            "toggle_mcp_server",
            "add_mcp_server",
            "update_mcp_server",
            "remove_mcp_server",
            "parse_mcp_deeplink",
        ] {
            let spec = table.get(name).unwrap_or_else(|| {
                panic!("mcp-management command `{name}` must be in dispatch table")
            });
            assert_eq!(spec.plugin_id, "mcp-management");
        }
    }

    /// Smoke-test that all 7 dispatch fn pointers are callable as
    /// `fn(Invoke<tauri::Wry>) -> bool`. We can't construct a real
    /// `Invoke` without a Tauri runtime, but we can verify the
    /// function symbols exist by taking their addresses.
    /// `[allow(unused)]` because the references are only used to
    /// force symbol resolution at compile time.
    #[allow(unused)]
    #[test]
    fn dispatch_fn_symbols_exist() {
        let _ = &(dispatch_list_mcp_servers as fn(Invoke<tauri::Wry>) -> bool);
        let _ = &(dispatch_list_mcp_servers_with_warnings as fn(Invoke<tauri::Wry>) -> bool);
        let _ = &(dispatch_toggle_mcp_server as fn(Invoke<tauri::Wry>) -> bool);
        let _ = &(dispatch_add_mcp_server as fn(Invoke<tauri::Wry>) -> bool);
        let _ = &(dispatch_update_mcp_server as fn(Invoke<tauri::Wry>) -> bool);
        let _ = &(dispatch_remove_mcp_server as fn(Invoke<tauri::Wry>) -> bool);
        let _ = &(dispatch_parse_mcp_deeplink as fn(Invoke<tauri::Wry>) -> bool);
    }

    /// Pin the `ListMcpServersResult` serialisation shape (servers +
    /// warning keys) so the frontend contract stays stable.
    #[test]
    fn list_mcp_servers_result_serialises_with_servers_and_warning_keys() {
        let r = ListMcpServersResult {
            servers: vec![],
            warning: Some("parse failed".into()),
        };
        let v = serde_json::to_value(&r).unwrap();
        assert!(v.get("servers").is_some());
        assert!(v.get("warning").is_some());
        assert_eq!(v["warning"], "parse failed");
    }
}
