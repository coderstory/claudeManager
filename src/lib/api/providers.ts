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
import type { Provider, ListProvidersResult } from '../../types/provider';

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