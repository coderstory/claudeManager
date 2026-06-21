/**
 * Frontend wrapper for the F16 资源浏览 Tauri commands (M2.13).
 *
 * Mirrors the M2.5 / M2.6 / M2.7 wrapper pattern — pages must import
 * the helpers from here, NOT call `invoke('list_resources', ...)`
 * directly.
 */
import { invoke } from '@tauri-apps/api/core';
import type { ResourceDetail, ResourceItem, ResourceKind } from '../../types/resource';

/** F16 — list resources of the given kind. Returns an empty array
 *  if the kind's subdirectory is missing (cold-start case). */
export function listResources(kind: ResourceKind): Promise<ResourceItem[]> {
  return invoke<ResourceItem[]>('list_resources', { kind });
}

/** F22 — 读取单个资源的详情(manifest 描述 + 文件列表)。
 *  读取是 best-effort:manifest 缺失 → description/manifest 为 null。
 *  path 必须是 listResources 返回的 ResourceItem.path。
 *  Throws on 空 path / `..` 穿越 / 未知 kind。 */
export function getResourceDetail(
  path: string,
  kind: ResourceKind,
): Promise<ResourceDetail> {
  return invoke<ResourceDetail>('get_resource_detail', { path, kind });
}

/** F16 — open the system file manager with `path` selected.
 *  Windows: `explorer /select,<path>`. macOS: `open -R <path>`
 *  (stub today, real impl ships with the macOS milestone).
 *
 *  Throws on failure — caller should surface via a non-blocking modal
 *  per CLAUDE.md §7 (don't crash the UI). */
export function revealInFileManager(path: string): Promise<void> {
  return invoke<void>('reveal_in_file_manager', { path });
}