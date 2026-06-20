/**
 * Frontend wrapper for the F8 app-metadata Tauri command (M2.8).
 *
 * Mirrors `src/lib/api/usage.ts`. Pages must import the helper from
 * here, NOT call `invoke('get_app_metadata')` directly.
 */
import { invoke } from '@tauri-apps/api/core';
import type { AppMetadata } from '../../types/app';

/**
 * F8 — return the running app's metadata (version, identifier, git
 * commit, build target, build timestamp).
 *
 * Infallible by construction on the Rust side; rejects only on IPC
 * transport failure (process killed, etc.).
 */
export function getAppMetadata(): Promise<AppMetadata> {
  return invoke<AppMetadata>('get_app_metadata');
}
