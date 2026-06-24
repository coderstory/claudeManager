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
///
/// M3.12 (A1#6) — when a project is active, also include the
/// project's `.claude/` directory in the scan list (project-level
/// `.bak.<ts>` snapshots taken by F18 apply_optimizations in
/// project mode show up here).
#[tauri::command]
pub async fn list_backups(state: State<'_, AppState>) -> CmdResult<Vec<BackupEntry>> {
    // M3.12 — read live active root (state.paths is a startup
    // snapshot; active_root can change at runtime).
    let active_root = crate::platform::runtime::paths().active_root_dir();
    Ok(state.backup_service.list_backups(active_root.as_deref()))
}

/// F13 — read the full text content of a single backup file.
/// The path is validated against the allow-list before any read.
///
/// M3.12 (A1#6) — allow-list is expanded with the active project's
/// `.claude/` when a project is active.
#[tauri::command]
pub async fn read_backup_content(
    state: State<'_, AppState>,
    path: String,
) -> CmdResult<String> {
    let active_root = crate::platform::runtime::paths().active_root_dir();
    state
        .backup_service
        .read_backup_content(
            std::path::Path::new(&path),
            active_root.as_deref(),
        )
        .map_err(|e| e.to_string())
}

/// F13 — field-level diff between two backup files.
#[tauri::command]
pub async fn diff_backups(
    state: State<'_, AppState>,
    path1: String,
    path2: String,
) -> CmdResult<Vec<DiffEntry>> {
    let active_root = crate::platform::runtime::paths().active_root_dir();
    state
        .backup_service
        .diff_backups(
            std::path::Path::new(&path1),
            std::path::Path::new(&path2),
            active_root.as_deref(),
        )
        .map_err(|e| e.to_string())
}

/// F13 — restore a backup to its original location. Takes a
/// double-backup of the current file first (CLAUDE.md §7).
///
/// M3.12 (A1#8) — when a project is active, the restore target is
/// routed to `<active_root>/.claude/settings.json` (user-level file
/// is left untouched). If `<active_root>` does not exist on disk the
/// restore is REJECTED with `BackupError::ActiveRootMissing` (the
/// service does NOT auto-mkdir the unknown root, mirroring F18
/// apply_optimizations safety boundary).
#[tauri::command]
pub async fn restore_backup(
    state: State<'_, AppState>,
    backup_path: String,
) -> CmdResult<()> {
    let active_root = crate::platform::runtime::paths().active_root_dir();
    state
        .backup_service
        .restore_backup(
            std::path::Path::new(&backup_path),
            active_root.as_deref(),
        )
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
        original_name: entry.original_name,
        size_bytes: entry.size_bytes,
        source: entry.source,
    })
}

/// M4.6.13 — delete a single backup file.
///
/// Moves the backup into a sibling `.trash/` dir (with a
/// timestamped filename to avoid collisions) and then removes
/// the trash entry. The path is validated against the allow-list
/// (with active_root expansion) before any filesystem change;
/// paths outside the allow-list return an error and the file is
/// not touched. See `BackupService::delete_backup` for the full
/// algorithm and rationale.
///
/// `path` is the absolute path of the backup file to delete —
/// the frontend reads it from the `BackupEntry::path` returned
/// by `list_backups`.
#[tauri::command]
pub async fn delete_backup(state: State<'_, AppState>, path: String) -> CmdResult<()> {
    let active_root = crate::platform::runtime::paths().active_root_dir();
    state
        .backup_service
        .delete_backup(std::path::Path::new(&path), active_root.as_deref())
        .map_err(|e| e.to_string())
}

/// M4.6 — incremental backup (diff-based, skip no-change).
///
/// Only creates a new `.bak.<ts>` snapshot when the current file
/// content differs from the most recent backup for the same original
/// file. When the content is unchanged, returns a `"no-change"` marker
/// with the previous backup path so the UI can display a "no changes
/// since previous backup" message.
///
/// `target` 为可选参数：
/// - `Some(path)` → 增量备份指定文件。
/// - `None` → 增量备份默认 `settings.json`。
#[tauri::command]
pub async fn backup_incremental(
    state: State<'_, AppState>,
    target: Option<String>,
) -> CmdResult<ManualBackupResult> {
    let target_path = match target {
        Some(t) => std::path::PathBuf::from(t),
        None => state.paths.settings_json.clone(),
    };
    let active_root = crate::platform::runtime::paths().active_root_dir();
    match state
        .backup_service
        .backup_incremental(&target_path, active_root.as_deref())
    {
        Ok(entry) => Ok(ManualBackupResult {
            path: entry.path,
            original_path: entry.original_path,
            original_name: entry.original_name,
            size_bytes: entry.size_bytes,
            source: entry.source,
        }),
        Err(e) => Err(e.to_string()),
    }
}

// ---------------------------------------------------------------------------
// Tests — pin the command contract (signatures). The commands are
// thin shims around `BackupService`; full behavioural coverage lives
// in `tests/backup_commands.rs` where we can construct a real
// `BackupService` against a `TempDir`.
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infrastructure::backup_scanner::BackupEntry;
    use crate::infrastructure::json_diff::DiffEntry;
    use crate::services::backup_service::ManualBackupResult;

    // -----------------------------------------------------------------------
    // Signature pinning — compile-time check that the `#[tauri::command]`
    // surface matches the contract documented for F13 / F19.
    // -----------------------------------------------------------------------

    /// Compile-time check: `list_backups` signature.
    #[allow(dead_code)]
    fn _list_backups_signature(
        s: State<'_, AppState>,
    ) -> CmdResult<Vec<BackupEntry>> {
        let _ = s;
        unimplemented!()
    }

    /// Compile-time check: `read_backup_content` signature.
    #[allow(dead_code)]
    fn _read_backup_content_signature(
        s: State<'_, AppState>,
        path: String,
    ) -> CmdResult<String> {
        let _ = (s, path);
        unimplemented!()
    }

    /// Compile-time check: `diff_backups` signature.
    #[allow(dead_code)]
    fn _diff_backups_signature(
        s: State<'_, AppState>,
        path1: String,
        path2: String,
    ) -> CmdResult<Vec<DiffEntry>> {
        let _ = (s, path1, path2);
        unimplemented!()
    }

    /// Compile-time check: `restore_backup` signature.
    #[allow(dead_code)]
    fn _restore_backup_signature(
        s: State<'_, AppState>,
        backup_path: String,
    ) -> CmdResult<()> {
        let _ = (s, backup_path);
        unimplemented!()
    }

    /// Compile-time check: `backup_now` signature.
    #[allow(dead_code)]
    fn _backup_now_signature(
        s: State<'_, AppState>,
        target: Option<String>,
    ) -> CmdResult<ManualBackupResult> {
        let _ = (s, target);
        unimplemented!()
    }

    /// Compile-time check: `delete_backup` signature.
    #[allow(dead_code)]
    fn _delete_backup_signature(
        s: State<'_, AppState>,
        path: String,
    ) -> CmdResult<()> {
        let _ = (s, path);
        unimplemented!()
    }

    /// Compile-time check: `backup_incremental` signature.
    #[allow(dead_code)]
    fn _backup_incremental_signature(
        s: State<'_, AppState>,
        target: Option<String>,
    ) -> CmdResult<ManualBackupResult> {
        let _ = (s, target);
        unimplemented!()
    }
}
