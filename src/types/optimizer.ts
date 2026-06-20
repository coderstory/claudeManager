/**
 * F18 — TypeScript mirror of the Rust `OptimizationFinding` and
 * `ApplyResult` domain types (see
 * `src-tauri/src/domain/optimization.rs`).
 *
 * Field names match the Rust `#[serde(rename_all = "snake_case")]`
 * exactly; severity values match the lowercase tag.
 */

export type Severity = 'info' | 'warning' | 'error';

export interface OptimizationFinding {
  id: string;
  rule_id: string;
  severity: Severity;
  title: string;
  description: string;
  affected_path: string;
  suggested_action: string;
  auto_apply: boolean;
}

export interface ApplyResult {
  finding_id: string;
  applied: boolean;
  backup_path: string | null;
  error: string | null;
}

/** UI label / colour for a severity. */
export function severityLabel(s: Severity): string {
  switch (s) {
    case 'info':
      return '提示';
    case 'warning':
      return '建议';
    case 'error':
      return '错误';
  }
}

export function severityColour(s: Severity): string {
  switch (s) {
    case 'info':
      return 'var(--text-secondary)';
    case 'warning':
      return 'var(--warning)';
    case 'error':
      return 'var(--danger)';
  }
}
