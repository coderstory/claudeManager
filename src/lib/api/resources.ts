/**
 * Frontend wrapper for the F16 资源浏览 Tauri commands (M2.13).
 *
 * Mirrors the M2.5 / M2.6 / M2.7 wrapper pattern — pages must import
 * the helpers from here, NOT call `invoke('list_resources', ...)`
 * directly.
 */
import { invoke } from '@tauri-apps/api/core';
import type { ResourceItem, ResourceKind } from '../../types/resource';

/** F16 — list resources of the given kind. Returns an empty array
 *  if the kind's subdirectory is missing (cold-start case). */
export function listResources(kind: ResourceKind): Promise<ResourceItem[]> {
  return invoke<ResourceItem[]>('list_resources', { kind });
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