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

/**
 * M5 bug #16 — fetch the past N days of aggregated daily usage stats
 * from the SQLite-backed `usage_daily_stats` table. Returns rows
 * ordered by `stat_date DESC`. Used by the usage trend chart so
 * users see the last 7 days even when the in-memory JSONL scan only
 * covers "today".
 */
export interface DailyStatRow {
  provider_id: string;
  stat_date: string;
  tokens_used: number;
  snapshot_count: number;
  last_aggregated_recorded_at: number;
}

export function getDailyStatsHistory(filter: {
  provider_id?: string;
  from_date?: string;
  to_date?: string;
  limit?: number;
}): Promise<DailyStatRow[]> {
  return invoke<DailyStatRow[]>('get_daily_stats_history', { filter });
}