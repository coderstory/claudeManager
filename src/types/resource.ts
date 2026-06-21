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

/**
 * F22 — 资源详情(M2.16)。对应 Rust `ResourceDetail`。
 *
 * 由 `get_resource_detail` 命令按需读取(列表层 ResourceItem 不含这些
 * 字段)。读取是 best-effort:manifest 缺失 → description/manifest 为
 * null;单文件资源 → files 为空数组。
 */
export interface ResourceDetail {
  /** 目录下的相对路径列表(深度 ≤ 2,上限 200 项)。单文件资源为空。 */
  files: string[];
  /** manifest 提取的描述。无 manifest 时为 null。 */
  description: string | null;
  /** 解析后的 manifest(JSON 对象)。无 manifest 时为 null。 */
  manifest: Record<string, unknown> | null;
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