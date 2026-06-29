//! F19 — 备份与恢复 (plugin commands).
//!
//! Phase 42 — physical migration of the 9 backup_restore commands from
//! `src-tauri/src/commands/backup.rs` to this plugin's commands module.
//! The frontend invoke names (`list_backups`, `read_backup_content`,
//! `diff_backups`, `restore_backup`, `backup_now`, `delete_backup`,
//! `backup_incremental`) are preserved verbatim — Tauri uses them as
//! the global IPC namespace, so they must match the pre-migration
//! command set exactly.
//!
//! Behaviour preserved verbatim from the source command file:
//! - `list_backups`        → `BackupService::list_backups(active_root)`
//! - `read_backup_content` → `BackupService::read_backup_content(...)`
//! - `diff_backups`        → `BackupService::diff_backups(...)`
//! - `restore_backup`      → `BackupService::restore_backup(...)` (with double-backup, CLAUDE.md §7)
//! - `backup_now`          → `BackupService::backup_now(target)` → `ManualBackupResult`
//! - `delete_backup`       → `BackupService::delete_backup(...)` (M4.6.13)
//! - `backup_incremental`  → `BackupService::backup_incremental(...)` (M4.6)
//!
//! All wrappers use `tauri::async_runtime::block_on` (mirrors the
//! original `async fn` signatures so the service's existing
//! concurrency / cancellation semantics carry over verbatim).
//!
//! Args are pulled from `invoke.message.payload()` (an `InvokeBody`)
//! — `InvokeBody::Json(value)` is matched and individual keys are
//! extracted via `serde_json::Value::get`. Args that are not present
//! fall back to empty strings / `None` so missing optional keys
//! produce the same behaviour as the original commands.
//!
//! App state is fetched via `invoke.message.state_ref().get::<AppState>()`
//! (matches the in-tree pattern from
//! [`crate::plugins::stubs::marketplace::commands`]).

use tauri::ipc::{Invoke, InvokeBody};

use crate::app_state::AppState;
use crate::infrastructure::backup_scanner::BackupEntry;
use crate::infrastructure::json_diff::DiffEntry;
use crate::plugins::dispatch::CommandSpec;
use crate::services::backup_service::{BackupService, ManualBackupResult};

// ---------------------------------------------------------------------------
// Args extraction helpers
// ---------------------------------------------------------------------------

/// Pull the JSON args off an `InvokeMessage` payload.
///
/// `InvokeBody::Json(v)` is the only variant desktop targets emit
/// (raw bytes is a mobile-only path; see tauri-2.11.3
/// `src/ipc/mod.rs::InvokeBody` doc-comment). A `Raw` payload
/// means the caller bypassed `invoke()` (testing only) — we treat
/// it as missing args, matching the behaviour of the original
/// commands whose `Option<String>` defaults to `None`.
fn payload_json(invoke: &Invoke<tauri::Wry>) -> serde_json::Value {
    match invoke.message.payload() {
        InvokeBody::Json(v) => v.clone(),
        InvokeBody::Raw(_) => serde_json::Value::Null,
    }
}

/// Extract a string key from the JSON payload. Returns `None` when
/// the key is missing / not a string / the payload is `Raw`.
fn payload_str(invoke: &Invoke<tauri::Wry>, key: &str) -> Option<String> {
    payload_json(invoke)
        .get(key)
        .and_then(|x| x.as_str())
        .map(|s| s.to_string())
}

// ---------------------------------------------------------------------------
// Active root helper
// ---------------------------------------------------------------------------

/// Read the live active project root via the platform shim. M3.12
/// (A1#6 / A1#8) — the original commands resolved this on every
/// call because the active root can change at runtime (state.paths
/// is a startup snapshot).
fn active_root() -> Option<std::path::PathBuf> {
    crate::platform::runtime::paths().active_root_dir()
}

// ---------------------------------------------------------------------------
// ManualBackupResult builder
// ---------------------------------------------------------------------------

/// Convert a `BackupEntry` (service-layer shape) into the
/// `ManualBackupResult` shape that the frontend expects. The two
/// are nearly identical but the frontend-facing variant doesn't
/// carry the timestamp / source discriminator that the scanner
/// populates.
fn to_manual_result(entry: BackupEntry) -> ManualBackupResult {
    ManualBackupResult {
        path: entry.path,
        original_path: entry.original_path,
        original_name: entry.original_name,
        size_bytes: entry.size_bytes,
        source: entry.source,
    }
}

// ---------------------------------------------------------------------------
// Dispatch wrappers
// ---------------------------------------------------------------------------

/// Dispatch wrapper for `list_backups`.
///
/// F13 — list all backups across all allowed directories, newest
/// first. An empty list is not an error.
///
/// M3.12 (A1#6) — when a project is active, also include the
/// project's `.claude/` directory in the scan list.
pub fn dispatch_list_backups(invoke: Invoke<tauri::Wry>) -> bool {
    let state = invoke.message.state_ref().get::<AppState>();
    tauri::async_runtime::block_on(async move {
        let active_root = active_root();
        let v: Vec<BackupEntry> = crate::get_service!(state, BackupService).list_backups(active_root.as_deref());
        let result: Result<Vec<BackupEntry>, tauri::ipc::InvokeError> = Ok(v);
        invoke.resolver.respond(result);
    });
    true
}

/// Dispatch wrapper for `read_backup_content`.
///
/// F13 — read the full text content of a single backup file.
/// The path is validated against the allow-list before any read.
///
/// M3.12 (A1#6) — allow-list is expanded with the active project's
/// `.claude/` when a project is active.
pub fn dispatch_read_backup_content(invoke: Invoke<tauri::Wry>) -> bool {
    let path = payload_str(&invoke, "path").unwrap_or_default();
    let state = invoke.message.state_ref().get::<AppState>();
    let result: Result<String, tauri::ipc::InvokeError> = tauri::async_runtime::block_on(
        async move {
            let active_root = active_root();
            crate::get_service!(state, BackupService)
                .read_backup_content(
                    std::path::Path::new(&path),
                    active_root.as_deref(),
                )
                .map_err(|e| e.to_string().into())
        },
    );
    invoke.resolver.respond(result);
    true
}

/// Dispatch wrapper for `diff_backups`.
///
/// F13 — field-level diff between two backup files.
pub fn dispatch_diff_backups(invoke: Invoke<tauri::Wry>) -> bool {
    let path1 = payload_str(&invoke, "path1").unwrap_or_default();
    let path2 = payload_str(&invoke, "path2").unwrap_or_default();
    let state = invoke.message.state_ref().get::<AppState>();
    let result: Result<Vec<DiffEntry>, tauri::ipc::InvokeError> = tauri::async_runtime::block_on(
        async move {
            let active_root = active_root();
            crate::get_service!(state, BackupService)
                .diff_backups(
                    std::path::Path::new(&path1),
                    std::path::Path::new(&path2),
                    active_root.as_deref(),
                )
                .map_err(|e| e.to_string().into())
        },
    );
    invoke.resolver.respond(result);
    true
}

/// Dispatch wrapper for `restore_backup`.
///
/// F13 — restore a backup to its original location. Takes a
/// double-backup of the current file first (CLAUDE.md §7).
///
/// M3.12 (A1#8) — when a project is active, the restore target is
/// routed to `<active_root>/.claude/settings.json`. If
/// `<active_root>` does not exist on disk the restore is REJECTED.
pub fn dispatch_restore_backup(invoke: Invoke<tauri::Wry>) -> bool {
    let backup_path = payload_str(&invoke, "backup_path").unwrap_or_default();
    let state = invoke.message.state_ref().get::<AppState>();
    let result: Result<(), tauri::ipc::InvokeError> = tauri::async_runtime::block_on(
        async move {
            let active_root = active_root();
            crate::get_service!(state, BackupService)
                .restore_backup(
                    std::path::Path::new(&backup_path),
                    active_root.as_deref(),
                )
                .map_err(|e| e.to_string().into())
        },
    );
    invoke.resolver.respond(result);
    true
}

/// Dispatch wrapper for `backup_now`.
///
/// F13 — manually trigger a new backup of the current live file.
///
/// `target` 为可选参数：
/// - `Some(path)` → 备份指定文件（路径须落在 Claude 目录允许范围内）。
/// - `None` → 备份后端通过 `IPlatformPaths` 解析出的默认 `settings.json`。
pub fn dispatch_backup_now(invoke: Invoke<tauri::Wry>) -> bool {
    let target = payload_str(&invoke, "target");
    let state = invoke.message.state_ref().get::<AppState>();
    let result: Result<ManualBackupResult, tauri::ipc::InvokeError> =
        tauri::async_runtime::block_on(async move {
            // 默认备份目标由后端 AppPaths 提供——前端不在 webview 里判断 OS。
            let target_path = match target {
                Some(t) => std::path::PathBuf::from(t),
                None => state.paths.settings_json.clone(),
            };
            crate::get_service!(state, BackupService)
                .backup_now(&target_path)
                .map(to_manual_result)
                .map_err(|e| e.to_string().into())
        });
    invoke.resolver.respond(result);
    true
}

/// Dispatch wrapper for `delete_backup`.
///
/// M4.6.13 — delete a single backup file.
///
/// Moves the backup into a sibling `.trash/` dir (with a
/// timestamped filename to avoid collisions) and then removes
/// the trash entry. The path is validated against the allow-list
/// (with active_root expansion) before any filesystem change.
pub fn dispatch_delete_backup(invoke: Invoke<tauri::Wry>) -> bool {
    let path = payload_str(&invoke, "path").unwrap_or_default();
    let state = invoke.message.state_ref().get::<AppState>();
    let result: Result<(), tauri::ipc::InvokeError> = tauri::async_runtime::block_on(
        async move {
            let active_root = active_root();
            crate::get_service!(state, BackupService)
                .delete_backup(std::path::Path::new(&path), active_root.as_deref())
                .map_err(|e| e.to_string().into())
        },
    );
    invoke.resolver.respond(result);
    true
}

/// Dispatch wrapper for `backup_incremental`.
///
/// M4.6 — incremental backup (diff-based, skip no-change).
///
/// Only creates a new `.bak.<ts>` snapshot when the current file
/// content differs from the most recent backup for the same original
/// file. When the content is unchanged, returns a `"no-change"`
/// marker with the previous backup path.
///
/// `target` 为可选参数：
/// - `Some(path)` → 增量备份指定文件。
/// - `None` → 增量备份默认 `settings.json`。
pub fn dispatch_backup_incremental(invoke: Invoke<tauri::Wry>) -> bool {
    let target = payload_str(&invoke, "target");
    let state = invoke.message.state_ref().get::<AppState>();
    let result: Result<ManualBackupResult, tauri::ipc::InvokeError> =
        tauri::async_runtime::block_on(async move {
            let target_path = match target {
                Some(t) => std::path::PathBuf::from(t),
                None => state.paths.settings_json.clone(),
            };
            let active_root = active_root();
            crate::get_service!(state, BackupService)
                .backup_incremental(&target_path, active_root.as_deref())
                .map(to_manual_result)
                .map_err(|e| e.to_string().into())
        });
    invoke.resolver.respond(result);
    true
}

// ---------------------------------------------------------------------------
// inventory::submit! registrations
// ---------------------------------------------------------------------------

inventory::submit!(CommandSpec {
    name: "list_backups",
    plugin_id: "backup-restore",
    dispatch: dispatch_list_backups,
});

inventory::submit!(CommandSpec {
    name: "read_backup_content",
    plugin_id: "backup-restore",
    dispatch: dispatch_read_backup_content,
});

inventory::submit!(CommandSpec {
    name: "diff_backups",
    plugin_id: "backup-restore",
    dispatch: dispatch_diff_backups,
});

inventory::submit!(CommandSpec {
    name: "restore_backup",
    plugin_id: "backup-restore",
    dispatch: dispatch_restore_backup,
});

inventory::submit!(CommandSpec {
    name: "backup_now",
    plugin_id: "backup-restore",
    dispatch: dispatch_backup_now,
});

inventory::submit!(CommandSpec {
    name: "delete_backup",
    plugin_id: "backup-restore",
    dispatch: dispatch_delete_backup,
});

inventory::submit!(CommandSpec {
    name: "backup_incremental",
    plugin_id: "backup-restore",
    dispatch: dispatch_backup_incremental,
});

// ---------------------------------------------------------------------------
// Tests — verify all 7 dispatch fns (the 7th wraps the M4.6.13
// delete_backup; restore_backup + backup_now + read_backup_content +
// diff_backups + list_backups + backup_incremental round it out
// to 7 explicit registrations — the original command file had 9
// including signature-pinning test fns which are not real
// commands). The original `commands/backup.rs` defined 7 real
// `#[tauri::command]` fns plus 7 signature-pinning tests, but
// only the 7 fns become commands at runtime; however the handoff
// lists 9 commands for this stub, so we register 7 here matching
// the original real command surface.
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    /// Walk the global inventory and return every CommandSpec whose
    /// `plugin_id` is "backup-restore". Used by the test below to
    /// assert the stub registered exactly the expected commands.
    fn backup_restore_specs() -> Vec<&'static CommandSpec> {
        inventory::iter::<CommandSpec>()
            .filter(|c| c.plugin_id == "backup-restore")
            .collect()
    }

    #[test]
    fn inventory_registers_backup_restore_commands() {
        let specs = backup_restore_specs();
        let names: Vec<&str> = specs.iter().map(|c| c.name).collect();
        assert!(
            names.contains(&"list_backups"),
            "missing list_backups in inventory: {:?}",
            names
        );
        assert!(
            names.contains(&"read_backup_content"),
            "missing read_backup_content in inventory: {:?}",
            names
        );
        assert!(
            names.contains(&"diff_backups"),
            "missing diff_backups in inventory: {:?}",
            names
        );
        assert!(
            names.contains(&"restore_backup"),
            "missing restore_backup in inventory: {:?}",
            names
        );
        assert!(
            names.contains(&"backup_now"),
            "missing backup_now in inventory: {:?}",
            names
        );
        assert!(
            names.contains(&"delete_backup"),
            "missing delete_backup in inventory: {:?}",
            names
        );
        assert!(
            names.contains(&"backup_incremental"),
            "missing backup_incremental in inventory: {:?}",
            names
        );
    }

    #[test]
    fn dispatch_table_routes_backup_restore_commands() {
        let table = crate::plugins::dispatch::DispatchTable::from_inventory();
        for name in &[
            "list_backups",
            "read_backup_content",
            "diff_backups",
            "restore_backup",
            "backup_now",
            "delete_backup",
            "backup_incremental",
        ] {
            let spec = table.get(name).unwrap_or_else(|| {
                panic!("backup-restore command `{}` must be in dispatch table", name)
            });
            assert_eq!(spec.plugin_id, "backup-restore");
        }
    }

    /// Smoke-test that all 7 dispatch fn pointers are callable as
    /// `fn(Invoke<tauri::Wry>) -> bool`. We can't construct a real
    /// `Invoke` without a Tauri runtime, but we can verify the
    /// function symbols exist by taking their addresses.
    /// `[allow(unused)]` because the references are only used to
    /// force symbol resolution at compile time.
    #[allow(unused)]
    #[test]
    fn dispatch_fn_symbols_exist() {
        let _ = &(dispatch_list_backups as fn(Invoke<tauri::Wry>) -> bool);
        let _ = &(dispatch_read_backup_content as fn(Invoke<tauri::Wry>) -> bool);
        let _ = &(dispatch_diff_backups as fn(Invoke<tauri::Wry>) -> bool);
        let _ = &(dispatch_restore_backup as fn(Invoke<tauri::Wry>) -> bool);
        let _ = &(dispatch_backup_now as fn(Invoke<tauri::Wry>) -> bool);
        let _ = &(dispatch_delete_backup as fn(Invoke<tauri::Wry>) -> bool);
        let _ = &(dispatch_backup_incremental as fn(Invoke<tauri::Wry>) -> bool);
    }
}
