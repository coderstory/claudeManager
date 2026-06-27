/**
 * Frontend wrapper for the M4.6 history Tauri commands.
 *
 * Mirrors `src/lib/api/backup.ts` — pages must import the helpers
 * from here, NOT call `invoke('get_usage_history', ...)` directly.
 *
 * ## IPC contract
 *
 * Plan B (P21-B subagent) registers these commands. Until Plan B
 * ships, every call resolves to `[]` (mock IPC in tests). The page
 * UI renders an empty table when this happens — graceful degradation
 * by design (CLAUDE.md §7: errors must be visible, not silent).
 */
import { invoke } from '@tauri-apps/api/core';
import type {
  BackupHistoryFilter,
  BackupHistoryRow,
  DailyStatsFilter,
  DailyStatRow,
  ExportFormat,
  ExportReport,
  HistoryStats,
  PurgeReport,
  UsageHistoryFilter,
  UsageHistoryRow,
} from '../../types/history';

/**
 * F7 — return usage history rows from the SQLite store, optionally
 * filtered by provider / project / time range.
 *
 * `filter` may be omitted → backend applies default (limit=1000).
 */
export function getUsageHistory(
  filter?: UsageHistoryFilter,
): Promise<UsageHistoryRow[]> {
  // Omit `filter` arg entirely when undefined so the backend can
  // pick its own default. Mirrors the pattern in
  // `src/lib/api/backup.ts::backupNow`.
  //
  // v3.0 (M4.6 history fix): route to the SQLite-backed
  // `get_usage_history_rows` command (commands/history.rs), not the
  // older `get_usage_history` in commands/usage.rs which expects a
  // `window: String` for the cached JSONL re-scan path. Calling the
  // old command with `{ filter }` triggers Tauri's arg-validation
  // error: "command get_usage_history missing required key window".
  const args = filter === undefined ? {} : { filter };
  return invoke<UsageHistoryRow[]>('get_usage_history_rows', args);
}

/**
 * F21 — return daily-aggregated usage stats from the SQLite
 * `usage_daily_stats` table. One row per (provider, date), sorted by
 * `stat_date DESC` (most recent first). `tokens_used` is the day's
 * incremental delta — see Rust `DailyStatRow` docs.
 */
export function getDailyStatsHistory(
  filter?: DailyStatsFilter,
): Promise<DailyStatRow[]> {
  const args = filter === undefined ? {} : { filter };
  return invoke<DailyStatRow[]>('get_daily_stats_history', args);
}

/**
 * F13 — return backup history rows from the SQLite store, optionally
 * filtered by scope / project / trigger / time range.
 */
export function getBackupHistory(
  filter?: BackupHistoryFilter,
): Promise<BackupHistoryRow[]> {
  const args = filter === undefined ? {} : { filter };
  return invoke<BackupHistoryRow[]>('get_backup_history', args);
}

/** Aggregate counters for the history database. */
export function getHistoryStats(): Promise<HistoryStats> {
  return invoke<HistoryStats>('get_history_stats');
}

/**
 * Export the current view to a JSON or CSV file. `format` selects
 * the serialiser; `targetPath` is the absolute path chosen by the
 * user via a native save dialog on the **frontend** side.
 *
 * Phase 32-01 (P1-02): the Rust command `export_history` requires
 * `target_path: String` (commands/history.rs:357-367) — it does NOT
 * pop a save dialog itself (unlike F14 `export_provider` / F23
 * `export_optimization_report`, which call `blocking_save_file` on
 * the Rust side). The previous wrapper sent only `{ format }`, so
 * Tauri v2 IPC arg-validation rejected every call at runtime
 * ("missing required key target_path"). The mock in
 * `__tests__/pages/history/index.test.tsx` shadowed the bug.
 *
 * The save dialog is popped via `invoke('plugin:dialog|save', ...)`
 * in the page (see `src/pages/history/index.tsx::handleExport`),
 * NOT via `@tauri-apps/plugin-dialog` — that JS wrapper is
 * intentionally not installed (CLAUDE.md §2.3 dependency
 * discipline; documented in F14/F23 command doc-comments). The
 * `dialog:allow-save` capability is already granted in
 * `src-tauri/capabilities/default.json:27`.
 */
export function exportHistory(
  format: ExportFormat,
  targetPath: string,
): Promise<ExportReport> {
  return invoke<ExportReport>('export_history', {
    format,
    targetPath,
  });
}

/**
 * Delete rows older than N days. Returns the breakdown of how many
 * rows were removed from each table.
 */
export function purgeHistory(olderThanDays: number): Promise<PurgeReport> {
  return invoke<PurgeReport>('purge_history', { older_than_days: olderThanDays });
}