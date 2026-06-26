/**
 * F7 — 用量查询 (M2.7 → M3.8).
 *
 * TypeScript mirror of the Rust `UsageSnapshot` / `UsageBreakdownEntry`
 * / `UsageHistoryEntry` structs (src-tauri/src/domain/usage.rs).
 * Field names use snake_case to match the Rust
 * `#[serde(rename_all = "snake_case")]`; this keeps the IPC
 * contract obvious in both files.
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
  /** Per-model token breakdown (M3.8). */
  breakdown?: UsageBreakdownEntry[];
  /** Distinct models that contributed to the snapshot (M3.8). */
  model_count?: number;
  /**
   * Phase 27 Fix 2 (BUG-CR-02 / D-09) — number of rows written to
   * SQLite `usage_history` by the most recent `refresh_usage`
   * cycle. Surfaced in the UI so the user sees "已写入 N 条" (CLAUDE.md
   * §7 — never silently swallow failures). Omitted on the read
   * path (`get_current_usage`); only `refresh_usage` populates it.
   */
  inserted_rows?: number;
}

/** One row in the per-model breakdown table (M3.8). */
export interface UsageBreakdownEntry {
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  total_tokens: number;
  cost_usd?: number;
  message_count: number;
}

/** One history entry — (date, model) bucket (M3.8). */
export interface UsageHistoryEntry {
  /** ISO date YYYY-MM-DD. */
  date: string;
  model: string;
  tokens: number;
  cost_usd?: number;
}

/**
 * Error category surfaced from the backend. Mapped from
 * `UsageError` variants — UI uses this to pick a localised
 * banner message and severity colour.
 */
export type UsageErrorKind =
  | 'io'
  | 'json'
  | 'path_unresolved'
  | 'permission_denied'
  | 'encoding_error'
  | 'unknown_window'
  | 'unknown';

export const USAGE_ERROR_MESSAGES: Record<UsageErrorKind, string> = {
  io: '读取用量数据失败：磁盘 I/O 错误',
  json: '用量数据格式损坏，请尝试"立即同步"或重启 Claude Code',
  path_unresolved: '无法定位 ~/.claude 目录，请检查 Claude Code 安装',
  permission_denied: '部分 JSONL 文件权限被拒绝，已跳过；可在管理员模式重试',
  encoding_error: '部分 JSONL 文件编码错误（可能为非 UTF-8），已跳过',
  unknown_window: '未知的时间窗（请使用 5h / 1w / 1m）',
  unknown: '查询失败：未知错误',
};

/** Parse a Rust error string into a structured category, best-effort. */
export function classifyUsageError(msg: string): UsageErrorKind {
  if (msg.includes('未知的窗口')) return 'unknown_window';
  if (msg.includes('权限被拒绝')) return 'permission_denied';
  if (msg.includes('编码错误')) return 'encoding_error';
  if (msg.includes('~/.claude 目录')) return 'path_unresolved';
  if (msg.includes('I/O') || msg.includes('i/o')) return 'io';
  if (msg.includes('JSON') || msg.includes('json')) return 'json';
  return 'unknown';
}