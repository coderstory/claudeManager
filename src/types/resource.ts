/**
 * F16 — TypeScript mirror of the Rust `ResourceItem` and
 * `ResourceKind` domain types (see
 * `src-tauri/src/domain/resource.rs`).
 *
 * Field names match Rust `#[serde(rename_all = "lowercase")]` exactly;
 * the `kind` field uses the same lowercase tag the Rust
 * `ResourceKind::as_str` emits.
 */

export type ResourceKind =
  | 'plugin'
  | 'skill'
  | 'command'
  | 'lsp'
  | 'mcp';

export interface ResourceItem {
  id: string;
  name: string;
  kind: ResourceKind;
  path: string;
  size_bytes: number;
  enabled: boolean;
}

/** Ordered list of all 5 kinds for tab rendering. */
export const ALL_RESOURCE_KINDS: ReadonlyArray<ResourceKind> = [
  'plugin',
  'skill',
  'command',
  'lsp',
  'mcp',
] as const;

/** Chinese label per kind (tab heading + table column). */
export function resourceKindLabel(kind: ResourceKind): string {
  switch (kind) {
    case 'plugin':
      return 'Plugins';
    case 'skill':
      return 'Skills';
    case 'command':
      return 'Commands';
    case 'lsp':
      return 'LSP';
    case 'mcp':
      return 'MCP';
  }
}

/** Sub-directory name where the kind lives (used by reveal copy
 *  in the UI — the user sees "<kind> 位于 ~/.claude/<sub>/"). */
export function resourceKindSubdir(kind: ResourceKind): string {
  switch (kind) {
    case 'plugin':
      return 'plugins';
    case 'skill':
      return 'skills';
    case 'command':
      return 'commands';
    case 'lsp':
      return 'lsp';
    case 'mcp':
      return 'mcp.json';
  }
}

/** Human-readable byte size ("1.2 KB" / "3.4 MB" / "12 B"). */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}