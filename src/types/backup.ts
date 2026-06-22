/**
 * F13 — TypeScript mirror of the Rust `BackupEntry` and `DiffEntry`
 * domain types.
 *
 * Field names match the Rust `#[serde(rename_all = "snake_case")]`
 * exactly; Tauri converts camelCase JS → snake_case at the IPC
 * boundary so this round-trips cleanly.
 *
 * On-disk source: `src-tauri/src/infrastructure/backup_scanner.rs`
 * (BackupEntry) and `src-tauri/src/infrastructure/json_diff.rs`
 * (DiffEntry).
 */

export type BackupSource = 'settings' | 'claude' | 'provider' | 'manual' | 'unknown';

export interface BackupEntry {
  path: string;
  original_path: string;
  /** M3.2 polish — basename of `original_path` (alias: `original_filename`). */
  original_name: string;
  timestamp_unix: number | null;
  size_bytes: number;
  source: BackupSource;
}

export type DiffOp = 'add' | 'remove' | 'change';

export interface DiffEntry {
  path: string;
  op: DiffOp;
  old: unknown | null;
  new: unknown | null;
}

export interface ManualBackupResult {
  path: string;
  original_path: string;
  /** M3.2 polish — basename alias (see BackupEntry). */
  original_name: string;
  size_bytes: number;
  source: BackupSource;
}

/** Format unix seconds as `YYYY-MM-DD HH:MM:SS` in local time. */
export function formatBackupTimestamp(unix: number | null): string {
  if (unix == null) return '未知时间';
  const d = new Date(unix * 1000);
  const pad = (n: number): string => n.toString().padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

/** Human-readable size in B / KB / MB. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Source label for the UI. */
export function sourceLabel(s: BackupSource): string {
  switch (s) {
    case 'settings': return 'settings.json';
    case 'claude': return '.claude.json';
    case 'provider': return 'provider';
    case 'manual': return '手动触发';
    case 'unknown': return '其他';
  }
}
