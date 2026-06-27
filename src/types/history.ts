/**
 * History types — TS mirror of `src-tauri/src/services/history_service.rs`.
 *
 * Why a frontend mirror (vs importing from Rust):
 *   - Tauri v2 generates TS types at build time but the project doesn't
 *     use `tauri-build` for type emission (keeps the bundle small).
 *   - Pages import these mirrors so the .tsx compiles in plain
 *     `vite build` without invoking Rust.
 *   - The shape MUST stay in sync with the Rust DTOs — when the
 *     Rust struct changes, edit this file too. There is no
 *     compile-time guard; the snapshot test in
 *     `src/__tests__/pages/history/__snapshots__/index.test.tsx.snap`
 *     catches shape drift in CI.
 *
 * Field naming: snake_case on the wire (Rust serde), camelCase in
 * TS — Tauri v2 does NOT auto-convert, so we use snake_case here
 * to match the Rust convention used by `invoke<T>('...')` (see
 * `src/lib/api/backup.ts` for the established pattern).
 */

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export interface UsageHistoryFilter {
  provider_id?: string | null;
  active_root?: string | null;
  /** Lower bound on `recorded_at` (unix seconds, inclusive). */
  from_ts?: number | null;
  /** Upper bound on `recorded_at` (unix seconds, inclusive). */
  to_ts?: number | null;
  /** Cap on rows returned. Default = 1000 if undefined. */
  limit?: number | null;
  /**
   * BUG-RF-08 — cursor pagination: rows with `id > after_id` (server
   * is expected to apply this filter to the indexed `id` column).
   * `null` = start from the beginning. The page consumer (HistoryPage)
   * uses this to load the next batch via a "Load more" button.
   */
  after_id?: number | null;
}

export interface BackupHistoryFilter {
  scope?: string | null; // 'user' | 'project'
  active_root?: string | null;
  trigger_kind?: string | null;
  from_ts?: number | null;
  to_ts?: number | null;
  limit?: number | null;
  /** BUG-RF-08 — cursor pagination. See UsageHistoryFilter::after_id. */
  after_id?: number | null;
}

// ---------------------------------------------------------------------------
// Daily aggregation (usage_daily_stats table)
// ---------------------------------------------------------------------------

/** Filter for `getDailyStatsHistory`. */
export interface DailyStatsFilter {
  provider_id?: string | null;
  /** Lower bound on `stat_date` ('YYYY-MM-DD', inclusive). */
  from_date?: string | null;
  /** Upper bound on `stat_date` ('YYYY-MM-DD', inclusive). */
  to_date?: string | null;
  /** Cap on rows returned. Default = 1000 if undefined. */
  limit?: number | null;
  /** BUG-RF-08 — cursor pagination. See UsageHistoryFilter::after_id. */
  after_id?: number | null;
}

/** Mirrors `DailyStatRow` in Rust (`usage_daily_stats` table). */
export interface DailyStatRow {
  provider_id: string;
  stat_date: string;
  /** Day's incremental token delta (MAX(today) − prev_day_max). */
  tokens_used: number;
  /** Number of raw `usage_history` snapshots aggregated into this bucket. */
  snapshot_count: number;
  last_aggregated_recorded_at: number;
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export interface UsageHistoryRow {
  id: number;
  snapshot_id: string;
  provider_id: string;
  provider_name: string;
  /** '5h' | '7d' | '30d' — backend stores String; frontend narrows. */
  window: string;
  used_pct: number;
  reset_at: number | null;
  raw_json: string;
  recorded_at: number;
  active_root: string | null;
}

export interface BackupHistoryRow {
  id: number;
  backup_id: string;
  file_name: string;
  file_size: number;
  scope: string; // 'user' | 'project'
  active_root: string | null;
  trigger_kind: string; // 'manual' | 'auto_before_switch' | 'auto_incremental'
  file_hash: string | null;
  metadata_json: string | null;
  created_at: number;
}

// ---------------------------------------------------------------------------
// Aggregate / report
// ---------------------------------------------------------------------------

/** Mirrors `HistoryStats` in Rust. */
export interface HistoryStats {
  usage_rows: number;
  backup_rows: number;
  db_size_bytes: number;
  first_recorded_at: number | null;
  last_recorded_at: number | null;
}

/** Mirrors `PurgeReport` in Rust (returned by `purge_history`). */
export interface PurgeReport {
  usage_rows_deleted: number;
  backup_rows_deleted: number;
  cutoff_ts: number;
}

/**
 * Mirrors `ExportReport` in Rust (`commands/history.rs:78-90`).
 *
 * Phase 32-01 (P1-01): the old shape `{ path; count; format }` drifted
 * from the Rust struct — the backend serialises `output_path` /
 * `usage_rows` / `backup_rows` / `file_size_bytes` (serde snake_case).
 * Reading `result.path` / `result.count` returned `undefined` at
 * runtime. This interface now matches the wire shape 1:1 so consumers
 * (history page success banner) render real data.
 */
export interface ExportReport {
  /** Resolved absolute path the export was written to. */
  output_path: string;
  /** `"json"` / `"csv"` — mirrors the requested format. */
  format: 'json' | 'csv';
  /** Number of `usage_history` rows included. */
  usage_rows: number;
  /** Number of `backup_history` rows included. */
  backup_rows: number;
  /** Total file size in bytes on disk (post-write). */
  file_size_bytes: number;
}

export type ExportFormat = 'json' | 'csv';