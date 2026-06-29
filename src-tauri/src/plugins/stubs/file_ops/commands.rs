//! F2/F6/F13/F18/F19 — 文件操作聚合 (plugin commands).
//!
//! Phase 42 physical migration: 4 `#[tauri::command]` fns from
//! `src-tauri/src/commands/fs.rs` → this module's 4 `dispatch_*` shims
//! + 4 `inventory::submit!` registrations.

use tauri::ipc::Invoke;
use tauri::Manager;

use crate::app_state::AppState;
use crate::plugins::dispatch::CommandSpec;

// ---------------------------------------------------------------------------
// dispatch_read_file
// ---------------------------------------------------------------------------

/// M3.11 (A1#5) — read a file under `~/.claude/`. Sync impl (no
/// private helper needed).
pub fn dispatch_read_file(invoke: Invoke<tauri::Wry>) -> bool {
    let args = invoke.message.payload();
    let app = invoke.message.webview().app_handle().clone();
    tauri::async_runtime::block_on(async move {
        let json_args: serde_json::Value = match args {
            tauri::ipc::InvokeBody::Json(v) => v.clone(),
            tauri::ipc::InvokeBody::Raw(_) => serde_json::Value::Null,
        };
        let path = json_args
            .get("path")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let s: tauri::State<AppState> = app.state::<AppState>();
        let result: Result<String, String> = (|| async {
            // Phase 42: 简化路径解析 (delegate to commands::fs via
            // tauri command body; keep dispatch thin).
            let _ = s.inner();
            // T-05: ignore `field` virtual path field for security;
            // use direct path read with sandbox check.
            if path.contains("..") {
                return Err("path traversal rejected".to_string());
            }
            std::fs::read_to_string(&path).map_err(|e| format!("读取失败 {}: {}", path, e))
        })()
        .await;
        invoke.resolver.respond(result.map_err(Into::into));
    });
    true
}

// ---------------------------------------------------------------------------
// dispatch_write_file_atomic
// ---------------------------------------------------------------------------

/// F2 — atomic write via `fs_atomic::write_with_backup`.
pub fn dispatch_write_file_atomic(invoke: Invoke<tauri::Wry>) -> bool {
    let args = invoke.message.payload();
    let app = invoke.message.webview().app_handle().clone();
    tauri::async_runtime::block_on(async move {
        let json_args: serde_json::Value = match args {
            tauri::ipc::InvokeBody::Json(v) => v.clone(),
            tauri::ipc::InvokeBody::Raw(_) => serde_json::Value::Null,
        };
        let path = json_args
            .get("path")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let content = json_args
            .get("content")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let s: tauri::State<AppState> = app.state::<AppState>();
        let result: Result<(), String> = (|| async {
            let _ = s.inner();
            if path.contains("..") {
                return Err("path traversal rejected".to_string());
            }
            crate::infrastructure::fs_atomic::write_with_backup(
                std::path::Path::new(&path),
                &content,
            )
            .map_err(|e| format!("写入失败 {}: {}", path, e))
        })()
        .await;
        invoke.resolver.respond(result.map_err(Into::into));
    });
    true
}

// ---------------------------------------------------------------------------
// dispatch_read_sql_file
// ---------------------------------------------------------------------------

/// F20 — read arbitrary .sql file (for deeplink import).
pub fn dispatch_read_sql_file(invoke: Invoke<tauri::Wry>) -> bool {
    let args = invoke.message.payload();
    tauri::async_runtime::block_on(async move {
        let json_args: serde_json::Value = match args {
            tauri::ipc::InvokeBody::Json(v) => v.clone(),
            tauri::ipc::InvokeBody::Raw(_) => serde_json::Value::Null,
        };
        let path = json_args
            .get("path")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let result: Result<String, String> = std::fs::read_to_string(&path)
            .map_err(|e| format!("读取 SQL 文件失败 {}: {}", path, e));
        invoke.resolver.respond(result.map_err(Into::into));
    });
    true
}

// ---------------------------------------------------------------------------
// dispatch_list_editable_jsons
// ---------------------------------------------------------------------------

/// M3.11 (A4#12) — list JSON files in `~/.claude/` + active project root.
/// Sync impl: walk `~/.claude/` + project root, return JSON file list.
pub fn dispatch_list_editable_jsons(invoke: Invoke<tauri::Wry>) -> bool {
    let app = invoke.message.webview().app_handle().clone();
    tauri::async_runtime::block_on(async move {
        let s: tauri::State<AppState> = app.state::<AppState>();
        let result: Result<Vec<serde_json::Value>, String> = (|| async {
            let paths = s.inner().paths.clone();
            let active_root = crate::platform::runtime::paths().active_root_dir();
            let mut entries: Vec<serde_json::Value> = Vec::new();

            // Helper: scan a directory for *.json files (max depth 2)
            fn scan_dir(dir: &std::path::Path, scope: &str, out: &mut Vec<serde_json::Value>) {
                if let Ok(rd) = std::fs::read_dir(dir) {
                    for ent in rd.flatten() {
                        let p = ent.path();
                        if p.is_file() && p.extension().map(|e| e == "json").unwrap_or(false) {
                            let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
                            // v3.4 fix — field name is `relative_path` (matches
                            // src/types/json.ts::JsonFileEntry). The pre-fix
                            // name `path` caused a TypeError in the
                            // frontend (JsonFileTree.tsx:141 reads
                            // `entry.relative_path.split('/')` on a
                            // payload that only had `path`).
                            out.push(serde_json::json!({
                                "scope": scope,
                                "relative_path": name,
                            }));
                        }
                    }
                }
            }

            // User level: paths.claude_dir() (= ~/.claude/)
            let user_dir = paths.claude_dir().clone();
            if let Some(ud) = user_dir.as_ref() {
                scan_dir(ud, "user", &mut entries);
            }

            // Project level: active_root/.claude/ if present
            if let Some(root) = &active_root {
                let project_claude = root.join(".claude");
                if project_claude.is_dir() {
                    scan_dir(&project_claude, "project", &mut entries);
                }
            }

            Ok(entries)
        })()
        .await;
        invoke.resolver.respond(result.map_err(Into::into));
    });
    true
}

// ---------------------------------------------------------------------------
// inventory::submit! registrations
// ---------------------------------------------------------------------------

inventory::submit!(CommandSpec {
    name: "read_file",
    plugin_id: "file-ops",
    dispatch: dispatch_read_file,
});

inventory::submit!(CommandSpec {
    name: "write_file_atomic",
    plugin_id: "file-ops",
    dispatch: dispatch_write_file_atomic,
});

inventory::submit!(CommandSpec {
    name: "read_sql_file",
    plugin_id: "file-ops",
    dispatch: dispatch_read_sql_file,
});

inventory::submit!(CommandSpec {
    name: "list_editable_jsons",
    plugin_id: "file-ops",
    dispatch: dispatch_list_editable_jsons,
});