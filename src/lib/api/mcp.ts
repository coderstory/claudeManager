/**
 * Frontend wrapper for the F6 MCP management Tauri commands.
 *
 * Mirrors `src/lib/api/providers.ts` — pages must import the helpers
 * from here, NOT call `invoke('list_mcp_servers', ...)` directly.
 *
 * ## Tauri IPC arg-name convention
 *
 * Tauri converts camelCase JS arg names to snake_case on the Rust
 * side (and back). So `toggleMcpServer({ id, enabled })` arrives
 * at the Rust command as `id: String, enabled: bool`. We use
 * snake_case keys here to match the Rust convention.
 */
import { invoke } from '@tauri-apps/api/core';
import type { McpServer, ListMcpServersResult } from '../../types/mcp';
import type { ParsedDeeplink } from './providers';

/**
 * F6 — list all MCP servers. Returns `[]` if mcp.json is missing
 * or has no mcpServers. Corrupt JSON is silently treated as empty
 * (use `listMcpServersWithWarnings` to surface it).
 */
export function listMcpServers(): Promise<McpServer[]> {
  return invoke<McpServer[]>('list_mcp_servers');
}

/**
 * F6+ — list with optional parse warning.
 */
export function listMcpServersWithWarnings(): Promise<ListMcpServersResult> {
  return invoke<ListMcpServersResult>('list_mcp_servers_with_warnings');
}

/**
 * F6 — toggle the `enabled` flag for the server with the given id.
 * Returns the updated server.
 */
export function toggleMcpServer(id: string, enabled: boolean): Promise<McpServer> {
  return invoke<McpServer>('toggle_mcp_server', { id, enabled });
}

/**
 * F6 — add a new MCP server. Errors if a server with the same
 * `name` already exists.
 */
export function addMcpServer(server: McpServer): Promise<void> {
  return invoke<void>('add_mcp_server', { server });
}

/**
 * F6 — update an existing MCP server (identified by `id`).
 * Returns the updated server.
 */
export function updateMcpServer(id: string, server: McpServer): Promise<McpServer> {
  return invoke<McpServer>('update_mcp_server', { id, server });
}

/**
 * F6 — remove the MCP server with the given id.
 */
export function removeMcpServer(id: string): Promise<void> {
  return invoke<void>('remove_mcp_server', { id });
}

/**
 * F6+ — parse a `ccswitch://v1/import?resource=mcp&...` URL.
 * Reuses the same parser as the F4 provider deeplink; the result
 * `action.kind === "import_mcp"` discriminates the shape.
 */
export function parseMcpDeeplink(url: string): Promise<ParsedDeeplink> {
  return invoke<ParsedDeeplink>('parse_mcp_deeplink', { url });
}
