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
 * the serialiser; the file path is chosen by the user via a native
 * save dialog on the Rust side.
 */
export function exportHistory(format: ExportFormat): Promise<ExportReport> {
  return invoke<ExportReport>('export_history', { format });
}

/**
 * Delete rows older than N days. Returns the breakdown of how many
 * rows were removed from each table.
 */
export function purgeHistory(olderThanDays: number): Promise<PurgeReport> {
  return invoke<PurgeReport>('purge_history', { older_than_days: olderThanDays });
}