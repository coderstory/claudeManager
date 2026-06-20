//! Tauri commands for F6 — MCP 管理 (M2.5).
//!
//! Each `#[tauri::command]` is a thin wrapper around the
//! corresponding `McpService` method. The split exists so that:
//!
//! - Services stay platform-independent and unit-testable (see
//!   `crate::services::mcp_service::tests`).
//! - Tauri commands own the `State<'_, AppState>` extraction + error
//!   stringification (Tauri's IPC requires `Result<T, String>` for
//!   cross-thread invocation).
//!
//! ## Frontend contract
//!
//! Frontend calls these via `invoke<T>(name, args)` from
//! `src/lib/api/mcp.ts`. Field names use snake_case to match the
//! Rust `serde(rename_all = "snake_case")` on `McpServer` — the
//! TS mirror `src/types/mcp.ts` declares the same shape.
//!
//! ## Error semantics
//!
//! On any failure, the command returns `Err(msg)` where `msg` is a
//! user-readable string (SPEC §6.5: "不允许静默吞错"). Frontend
//! surfaces it via the page InfoBar.

use tauri::State;

use crate::app_state::AppState;
use crate::domain::McpServer;
use crate::infrastructure::deeplink_parser::{parse_deeplink_url as parse_dl, ParsedDeeplink};

/// `Result<T, String>` — Tauri IPC's preferred error type. The `String`
/// is the user-visible message (SPEC §6.5).
type CmdResult<T> = Result<T, String>;

/// F6 — list all MCP servers in `~/.claude/mcp.json`.
///
/// Returns an empty Vec if the file is missing or `mcpServers` is
/// absent. Corrupt JSON is silently treated as empty (the page
/// can call `list_mcp_servers_with_warnings` to surface that).
#[tauri::command]
pub async fn list_mcp_servers(state: State<'_, AppState>) -> CmdResult<Vec<McpServer>> {
    Ok(state.mcp_service.list())
}

/// F6+ — same as `list_mcp_servers` but also returns a parse
/// warning (if any) so the UI can show a non-fatal InfoBar.
#[tauri::command]
pub async fn list_mcp_servers_with_warnings(
    state: State<'_, AppState>,
) -> CmdResult<ListMcpServersResult> {
    let (servers, warning) = state.mcp_service.list_with_warnings();
    Ok(ListMcpServersResult { servers, warning })
}

#[derive(Debug, serde::Serialize)]
pub struct ListMcpServersResult {
    pub servers: Vec<McpServer>,
    pub warning: Option<String>,
}

/// F6 — toggle the `enabled` flag for the MCP server with the
/// given UUID. Returns the updated server on success.
#[tauri::command]
pub async fn toggle_mcp_server(
    state: State<'_, AppState>,
    id: String,
    enabled: bool,
) -> CmdResult<McpServer> {
    state
        .mcp_service
        .toggle(&id, enabled)
        .map_err(|e| e.to_string())
}

/// F6 — add a new MCP server. Errors if a server with the same
/// `name` already exists.
#[tauri::command]
pub async fn add_mcp_server(state: State<'_, AppState>, server: McpServer) -> CmdResult<()> {
    state.mcp_service.add(server).map_err(|e| e.to_string())
}

/// F6 — update an existing MCP server (identified by `id`).
/// Returns the updated server on success.
#[tauri::command]
pub async fn update_mcp_server(
    state: State<'_, AppState>,
    id: String,
    server: McpServer,
) -> CmdResult<McpServer> {
    state
        .mcp_service
        .update(&id, server)
        .map_err(|e| e.to_string())
}

/// F6 — remove the MCP server with the given UUID.
#[tauri::command]
pub async fn remove_mcp_server(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    state.mcp_service.remove(&id).map_err(|e| e.to_string())
}

/// F6+ — parse a `ccswitch://v1/import?resource=mcp&...` URL into
/// a `ParsedDeeplink` (M2.5 extension of the F4 deeplink protocol).
///
/// Reuses the same `parse_deeplink_url` command surface so the
/// frontend only needs one entry point; the `resource` query param
/// discriminates the result shape.
#[tauri::command]
pub async fn parse_mcp_deeplink(url: String) -> CmdResult<ParsedDeeplink> {
    parse_dl(&url).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// Tests — pin the command contract (signatures, error stringification).
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    /// Compile-time check: `list_mcp_servers` takes `State<'_, AppState>`
    /// and returns `CmdResult<Vec<McpServer>>`.
    #[allow(dead_code)]
    fn _list_mcp_servers_signature(s: State<'_, AppState>) -> CmdResult<Vec<McpServer>> {
        let _ = s;
        unimplemented!()
    }

    /// Compile-time check: `toggle_mcp_server` signature.
    #[allow(dead_code)]
    fn _toggle_mcp_server_signature(
        s: State<'_, AppState>,
        id: String,
        enabled: bool,
    ) -> CmdResult<McpServer> {
        let _ = (s, id, enabled);
        unimplemented!()
    }

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
