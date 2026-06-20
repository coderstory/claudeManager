//! Tauri commands for F13 — 备份与恢复 (M2.6).
//!
//! Each `#[tauri::command]` is a thin wrapper around the
//! corresponding `BackupService` method. See `services::backup_service`
//! for the underlying business logic; see `infrastructure::backup_scanner`
//! and `infrastructure::json_diff` for the read-side primitives.

use tauri::State;

use crate::app_state::AppState;
use crate::infrastructure::backup_scanner::BackupEntry;
use crate::infrastructure::json_diff::DiffEntry;
use crate::services::backup_service::ManualBackupResult;

/// Tauri-friendly error type.
type CmdResult<T> = Result<T, String>;

/// F13 — list all backups across all allowed directories, newest
/// first. An empty list is not an error.
#[tauri::command]
pub async fn list_backups(state: State<'_, AppState>) -> CmdResult<Vec<BackupEntry>> {
    Ok(state.backup_service.list_backups())
}

/// F13 — read the full text content of a single backup file.
/// The path is validated against the allow-list before any read.
#[tauri::command]
pub async fn read_backup_content(
    state: State<'_, AppState>,
    path: String,
) -> CmdResult<String> {
    state
        .backup_service
        .read_backup_content(std::path::Path::new(&path))
        .map_err(|e| e.to_string())
}

/// F13 — field-level diff between two backup files.
#[tauri::command]
pub async fn diff_backups(
    state: State<'_, AppState>,
    path1: String,
    path2: String,
) -> CmdResult<Vec<DiffEntry>> {
    state
        .backup_service
        .diff_backups(std::path::Path::new(&path1), std::path::Path::new(&path2))
        .map_err(|e| e.to_string())
}

/// F13 — restore a backup to its original location. Takes a
/// double-backup of the current file first (CLAUDE.md §7).
#[tauri::command]
pub async fn restore_backup(
    state: State<'_, AppState>,
    backup_path: String,
) -> CmdResult<()> {
    state
        .backup_service
        .restore_backup(std::path::Path::new(&backup_path))
        .map_err(|e| e.to_string())
}

/// F13 — manually trigger a new backup of the current live file.
///
/// `target` 为可选参数：
/// - `Some(path)` → 备份指定文件（路径须落在 Claude 目录允许范围内）。
/// - `None` → 备份后端通过 `IPlatformPaths` 解析出的默认 `settings.json`。
///
/// 前端 webview 里 `process` 未定义，不能在前端猜 OS 路径
/// （CLAUDE.md §3.2：所有 OS 差异必须由后端 platform 层处理）。
#[tauri::command]
pub async fn backup_now(
    state: State<'_, AppState>,
    target: Option<String>,
) -> CmdResult<ManualBackupResult> {
    // 默认备份目标由后端 AppPaths 提供——前端不在 webview 里判断 OS。
    let target_path = match target {
        Some(t) => std::path::PathBuf::from(t),
        None => state.paths.settings_json.clone(),
    };
    let entry = state
        .backup_service
        .backup_now(&target_path)
        .map_err(|e| e.to_string())?;
    Ok(ManualBackupResult {
        path: entry.path,
        original_path: entry.original_path,
        size_bytes: entry.size_bytes,
        source: entry.source,
    })
}
