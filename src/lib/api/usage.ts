/**
 * Frontend wrapper for the F7 用量查询 Tauri commands (M2.7 → M3.8).
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
import type { UsageHistoryEntry, UsageSnapshot, UsageWindow } from '../../types/usage';

/**
 * F7 — return the cached usage snapshot for the active provider
 * in the requested window. Cache TTL is 5 minutes; the page can
 * call `refreshUsage` to force a re-scan of JSONL.
 *
 * @throws Error on Rust-side error (e.g. unknown window). The page
 *         surfaces the message via the localised error banner.
 */
export function getCurrentUsage(window: UsageWindow): Promise<UsageSnapshot> {
  return invoke<UsageSnapshot>('get_current_usage', { window });
}

/**
 * F7 — drop the cache entry for `(active_provider, window)` and
 * re-scan the JSONL files under ~/.claude/projects/<encoded>/*.jsonl.
 * Returns the fresh snapshot.
 */
export function refreshUsage(window: UsageWindow): Promise<UsageSnapshot> {
  return invoke<UsageSnapshot>('refresh_usage', { window });
}

/**
 * F7 — return per-day per-model history for the active provider
 * in the requested window. Used by the usage chart.
 *
 * Shares the same `(provider_id, window)` cache key as
 * `getCurrentUsage`, so a subsequent `getCurrentUsage(window)`
 * will hit the cache and avoid re-scanning.
 */
export function getUsageHistory(window: UsageWindow): Promise<UsageHistoryEntry[]> {
  return invoke<UsageHistoryEntry[]>('get_usage_history', { window });
}