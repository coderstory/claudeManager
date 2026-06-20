/**
 * Frontend wrapper for the F7 用量查询 Tauri commands.
 *
 * Mirrors `src/lib/api/providers.ts` — pages must import the helpers
 * from here, NOT call `invoke('get_current_usage', ...)` directly.
 *
 * ## Tauri IPC arg-name convention
 *
 * Tauri converts camelCase JS arg names to snake_case on the Rust
 * side (and back). So `getCurrentUsage({ window: '5h' })` arrives
 * at the Rust command as `window: String`. We use snake_case keys
 * here to match the Rust convention.
 */
import { invoke } from '@tauri-apps/api/core';
import type { UsageSnapshot, UsageWindow } from '../../types/usage';

/**
 * F7 — return the cached usage snapshot for the active provider
 * in the requested window. Cache TTL is 5 minutes; the page can
 * call `refreshUsage` to force a re-read.
 *
 * @throws Error on Rust-side error (e.g. unknown window). The page
 *         surfaces the message via the InfoBar.
 */
export function getCurrentUsage(window: UsageWindow): Promise<UsageSnapshot> {
  return invoke<UsageSnapshot>('get_current_usage', { window });
}

/**
 * F7 — drop the cache entry for `(active_provider, window)` and
 * re-read `~/.claude/usage.json`. Returns the fresh snapshot.
 */
export function refreshUsage(window: UsageWindow): Promise<UsageSnapshot> {
  return invoke<UsageSnapshot>('refresh_usage', { window });
}