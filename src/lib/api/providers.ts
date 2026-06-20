/**
 * Frontend wrapper for the F1 / F2 Tauri commands.
 *
 * The functions in this module are the single source of truth for
 * "how the frontend talks to the Rust provider service". Pages must
 * import `listProviders` / `switchProvider` from here — they MUST NOT
 * call `invoke('list_providers', ...)` directly (so the IPC shape is
 * refactorable in one place).
 *
 * ## Tauri IPC arg-name convention
 *
 * Tauri converts camelCase JS arg names to snake_case on the Rust side
 * (and back). So `switchProvider({ providerId })` arrives at the Rust
 * command as `provider_id: String`. We keep snake_case keys here to
 * match the Rust convention, which keeps the contract obvious for
 * anyone reading both files.
 */
import { invoke } from '@tauri-apps/api/core';
import type {
  ImportResult,
  McpServer as F3McpServer,
  Provider,
  ListProvidersResult,
  SqlPreview,
} from '../../types/provider';
import type { McpServer } from '../../types/mcp';

/**
 * F1 — list all providers. Returns `[]` if `<app_data>/providers/` is
 * missing or empty. Corrupt files are skipped silently.
 */
export function listProviders(): Promise<Provider[]> {
  return invoke<Provider[]>('list_providers');
}

/**
 * F1 — list with warnings. The returned `warnings` array contains
 * file paths of provider JSON files that failed to parse, so the UI
 * can show a non-fatal InfoBar.
 */
export function listProvidersWithWarnings(): Promise<ListProvidersResult> {
  return invoke<ListProvidersResult>('list_providers_with_warnings');
}

/**
 * F2 — switch the active provider. Returns the activated Provider
 * with `last_used_at` stamped.
 *
 * Throws on failure (Tauri's invoke() rejects the promise). The
 * caller (page) is responsible for catching + showing an InfoBar.
 */
export function switchProvider(providerId: string): Promise<Provider> {
  return invoke<Provider>('switch_provider', { providerId });
}

/**
 * F3 — parse a SQL dump and return a preview without writing files.
 *
 * The frontend calls this after the user picks a .sql file (via
 * tauri-plugin-dialog) and the page reads its content. The returned
 * preview shows "importable / skipped" counts + the actual list of
 * providers that will be imported.
 *
 * NOTE: the dialog plugin's `open()` returns a `File` object whose
 * `.text()` method gives the raw content — the frontend does the
 * file reading, not Rust.
 */
export function parseSqlPreview(content: string): Promise<SqlPreview> {
  return invoke<SqlPreview>('parse_sql_preview', { content });
}

/**
 * F3 — bulk-import providers from a SQL dump.
 *
 * Returns the full ImportResult including any per-row errors. The
 * page surfaces the error list in a details panel — they are NOT
 * silently swallowed.
 */
export function importProvidersFromSql(content: string): Promise<ImportResult> {
  return invoke<ImportResult>('import_providers_from_sql', { content });
}

// ---------------------------------------------------------------------------
// F4 — deeplink 导入 (M2.3)
// ---------------------------------------------------------------------------

/**
 * Parsed deeplink request shape (mirror of the Rust
 * `ParsedDeeplink` in src-tauri/src/infrastructure/deeplink_parser.rs).
 *
 * M2.3: `action.kind === 'import'` and `provider` is populated.
 * M2.5: `action.kind === 'import_mcp'` and `mcp_server` is populated.
 * The `resource` query param of the URL discriminates the shape.
 */
export interface ParsedDeeplink {
  action: { kind: 'import' } | { kind: 'import_mcp' };
  provider: Provider | null;
  mcp_server: McpServer | null;
}

/**
 * Parse a `ccswitch://v1/import?...` URL into a `ParsedDeeplink`.
 *
 * Pure function on the Rust side; the only IPC overhead is the
 * string round-trip. Throws on parse failure (bad URL, missing
 * required params, unsupported resource type, …).
 */
export function parseDeeplinkUrl(url: string): Promise<ParsedDeeplink> {
  return invoke<ParsedDeeplink>('parse_deeplink_url', { url });
}

/**
 * Persist a single provider JSON file. Called AFTER the user
 * confirms the import in the modal. Throws `"provider '<id>'
 * already exists"` if the id is on disk; the page renders that
 * as a "rename and retry" hint.
 */
export function importSingleProvider(provider: Provider): Promise<void> {
  return invoke<void>('import_single_provider', { provider });
}

// Re-export the F3 McpServer type (parser shape, used in SqlPreview
// `preview_mcp`) for the page so callers don't need a second import.
// The F6 write-side `McpServer` lives in `../../types/mcp` and is
// imported directly by F6 modules.
export type { F3McpServer as McpServer };