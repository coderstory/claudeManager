/**
 * Frontend wrapper for the F13 backup & restore Tauri commands.
 *
 * Mirrors `src/lib/api/mcp.ts` and `src/lib/api/providers.ts` —
 * pages must import the helpers from here, NOT call
 * `invoke('list_backups', ...)` directly.
 */
import { invoke } from '@tauri-apps/api/core';
import type {
  BackupEntry,
  DiffEntry,
  ManualBackupResult,
} from '../../types/backup';

/** F13 — list all backups across the app-data backups dir and
 *  the live Claude dir, newest first. */
export function listBackups(): Promise<BackupEntry[]> {
  return invoke<BackupEntry[]>('list_backups');
}

/** F13 — read a single backup file's full text content. */
export function readBackupContent(path: string): Promise<string> {
  return invoke<string>('read_backup_content', { path });
}

/** F13 — field-level diff between two backup files. */
export function diffBackups(path1: string, path2: string): Promise<DiffEntry[]> {
  return invoke<DiffEntry[]>('diff_backups', { path1, path2 });
}

/** F13 — restore a backup to its original location. Takes a
 *  double-backup of the current file first. */
export function restoreBackup(backupPath: string): Promise<void> {
  return invoke<void>('restore_backup', { backupPath });
}

/**
 * F13 — manually trigger a new backup of the current live file.
 *
 * `target` 可选：省略时后端用 `AppPaths.settings_json`（由
 * `IPlatformPaths` 按 OS 解析）作为默认备份对象。前端 webview
 * 里 `process` 未定义，不能在前端猜 OS 路径（CLAUDE.md §3.2）。
 */
export function backupNow(target?: string): Promise<ManualBackupResult> {
  // 省略 target 时不传该字段，让后端走默认值。
  const args = target === undefined ? {} : { target };
  return invoke<ManualBackupResult>('backup_now', args);
}
