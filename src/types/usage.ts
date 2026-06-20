/**
 * F7 — 用量查询 (M2.7).
 *
 * TypeScript mirror of the Rust `UsageSnapshot` struct
 * (`src-tauri/src/domain/usage.rs`). Field names use snake_case to
 * match the Rust `#[serde(rename_all = "snake_case")]` on the Rust
 * side; this keeps the IPC contract obvious in both files.
 */

/** Time window for the usage snapshot. */
export type UsageWindow = '5h' | '1w' | '1m';

/** Display label per window — used by the toggle group. */
export const WINDOW_LABELS: Record<UsageWindow, string> = {
  '5h': '5 小时',
  '1w': '1 周',
  '1m': '1 月',
};

/** One usage snapshot for the active provider. */
export interface UsageSnapshot {
  /** Active provider fingerprint (set by Rust from settings.json). */
  provider_id: string;
  /** Time window the snapshot covers. */
  window: UsageWindow;
  /** Cumulative tokens used in this window. */
  tokens_used: number;
  /** Optional cost in USD. */
  cost_usd?: number;
  /** Optional remaining balance in USD. */
  balance_usd?: number;
  /** Unix seconds when the snapshot was taken. */
  timestamp: number;
}