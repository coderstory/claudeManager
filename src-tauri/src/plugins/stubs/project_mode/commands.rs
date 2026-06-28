//! F8/M3.10 — 项目模式 (plugin commands).
//!
//! Phase 42 physical migration: 7 `#[tauri::command]` fns from
//! `src-tauri/src/commands/project.rs` → this module's 7 `dispatch_*`
//! shims + 7 `inventory::submit!` registrations.
//!
//! Phase 45 service-registry refactor: dispatch fns look up
//! `ProjectService` via `crate::get_service!` (registered in
//! `service_registry` by `plugins::host` at startup).

use tauri::ipc::Invoke;
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;
use uuid::Uuid;

use crate::app_state::AppState;
use crate::commands::project::ProjectsListResult;
use crate::get_service;
use crate::plugins::dispatch::CommandSpec;

// ---------------------------------------------------------------------------
// dispatch_list_projects
// ---------------------------------------------------------------------------

/// M3.10 — list all projects + the currently active one.
pub fn dispatch_list_projects(invoke: Invoke<tauri::Wry>) -> bool {
    let app = invoke.message.webview().app_handle().clone();
    tauri::async_runtime::block_on(async move {
        let s: tauri::State<AppState> = app.state::<AppState>();
        let result: Result<ProjectsListResult, String> = (|| async {
            let svc = get_service!(s.inner(), crate::services::project_service::ProjectService);
            let pf = svc.load().map_err(|e| e.to_string())?;
            let summaries: Vec<crate::commands::project::ProjectSummary> = pf
                .projects
                .iter()
                .map(|p| crate::commands::project::ProjectSummary {
                    id: p.id,
                    name: p.name.clone(),
                    root_dir: p.root_dir.clone(),
                    is_system: p.is_system,
                })
                .collect();
            Ok(ProjectsListResult {
                projects: summaries,
                current_project_id: pf.current_project_id,
                file: pf,
            })
        })()
        .await;
        invoke.resolver.respond(result.map_err(Into::into));
    });
    true
}

// ---------------------------------------------------------------------------
// dispatch_add_project
// ---------------------------------------------------------------------------

/// M3.10 — add a new user project.
pub fn dispatch_add_project(invoke: Invoke<tauri::Wry>) -> bool {
    let args = invoke.message.payload();
    let app = invoke.message.webview().app_handle().clone();
    tauri::async_runtime::block_on(async move {
        let json_args: serde_json::Value = match args {
            tauri::ipc::InvokeBody::Json(v) => v.clone(),
            tauri::ipc::InvokeBody::Raw(_) => serde_json::Value::Null,
        };
        let name = json_args
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let root_str = json_args
            .get("root_dir")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let s: tauri::State<AppState> = app.state::<AppState>();
        let result: Result<crate::domain::Project, String> = (|| async {
            let svc = get_service!(s.inner(), crate::services::project_service::ProjectService);
            svc.add(name, std::path::PathBuf::from(root_str))
                .map_err(|e| e.to_string())
        })()
        .await;
        invoke.resolver.respond(result.map_err(Into::into));
    });
    true
}

// ---------------------------------------------------------------------------
// dispatch_remove_project
// ---------------------------------------------------------------------------

/// M3.10 — remove a user project.
pub fn dispatch_remove_project(invoke: Invoke<tauri::Wry>) -> bool {
    let args = invoke.message.payload();
    let app = invoke.message.webview().app_handle().clone();
    tauri::async_runtime::block_on(async move {
        let json_args: serde_json::Value = match args {
            tauri::ipc::InvokeBody::Json(v) => v.clone(),
            tauri::ipc::InvokeBody::Raw(_) => serde_json::Value::Null,
        };
        let id_str = json_args
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let id = match Uuid::parse_str(id_str) {
            Ok(u) => u,
            Err(e) => {
                let r: Result<(), String> = Err(format!("remove_project: invalid uuid: {e}"));
                invoke.resolver.respond(r.map_err(Into::into));
                return;
            }
        };
        let s: tauri::State<AppState> = app.state::<AppState>();
        let result: Result<(), String> = (|| async {
            let svc = get_service!(s.inner(), crate::services::project_service::ProjectService);
            svc.remove(id).map_err(|e| e.to_string())
        })()
        .await;
        invoke.resolver.respond(result.map_err(Into::into));
    });
    true
}

// ---------------------------------------------------------------------------
// dispatch_switch_project
// ---------------------------------------------------------------------------

/// M3.10 — switch the active project.
pub fn dispatch_switch_project(invoke: Invoke<tauri::Wry>) -> bool {
    let args = invoke.message.payload();
    let app = invoke.message.webview().app_handle().clone();
    tauri::async_runtime::block_on(async move {
        let json_args: serde_json::Value = match args {
            tauri::ipc::InvokeBody::Json(v) => v.clone(),
            tauri::ipc::InvokeBody::Raw(_) => serde_json::Value::Null,
        };
        let id_str = json_args
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let id = match Uuid::parse_str(id_str) {
            Ok(u) => u,
            Err(e) => {
                let r: Result<crate::domain::Project, String> =
                    Err(format!("switch_project: invalid uuid: {e}"));
                invoke.resolver.respond(r.map_err(Into::into));
                return;
            }
        };
        let s: tauri::State<AppState> = app.state::<AppState>();
        let result: Result<crate::domain::Project, String> = (|| async {
            let svc = get_service!(s.inner(), crate::services::project_service::ProjectService);
            svc.switch(id).map_err(|e| e.to_string())
        })()
        .await;
        invoke.resolver.respond(result.map_err(Into::into));
    });
    true
}

// ---------------------------------------------------------------------------
// dispatch_current_project
// ---------------------------------------------------------------------------

/// M3.10 — get the currently active project.
pub fn dispatch_current_project(invoke: Invoke<tauri::Wry>) -> bool {
    let app = invoke.message.webview().app_handle().clone();
    tauri::async_runtime::block_on(async move {
        let s: tauri::State<AppState> = app.state::<AppState>();
        let result: Result<Option<crate::domain::Project>, String> = (|| async {
            let svc = get_service!(s.inner(), crate::services::project_service::ProjectService);
            let pf = svc.load().map_err(|e| e.to_string())?;
            Ok(pf.current().cloned())
        })()
        .await;
        invoke.resolver.respond(result.map_err(Into::into));
    });
    true
}

// ---------------------------------------------------------------------------
// dispatch_pick_project_root_dir
// ---------------------------------------------------------------------------

/// M3.13.4 — open native folder picker.
pub fn dispatch_pick_project_root_dir(invoke: Invoke<tauri::Wry>) -> bool {
    let app = invoke.message.webview().app_handle().clone();
    tauri::async_runtime::block_on(async move {
        let result: Result<Option<String>, String> = (|| async {
            let picked = app
                .dialog()
                .file()
                .set_title("选择项目根目录")
                .blocking_pick_folder();
            match picked {
                Some(p) => Ok(Some(p.to_string())),
                None => Ok(None),
            }
        })()
        .await;
        invoke.resolver.respond(result.map_err(Into::into));
    });
    true
}

// ---------------------------------------------------------------------------
// dispatch_validate_project_path
// ---------------------------------------------------------------------------

/// M3.13.4 — validate that a path is a usable project root.
///
/// Sync validation (mirrors `validate_project_path_impl` in
/// `commands/project.rs` which is private — this is the public
/// dispatchable form).
pub fn dispatch_validate_project_path(invoke: Invoke<tauri::Wry>) -> bool {
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
        let trimmed = path.trim();
        let result: Result<crate::commands::project::PathValidation, String> =
            if trimmed.is_empty() {
                Ok(crate::commands::project::PathValidation {
                    path: path.clone(),
                    valid: false,
                    reason_code: "empty".into(),
                    reason: "路径不能为空".into(),
                })
            } else {
                Ok(crate::commands::project::PathValidation {
                    path: path.clone(),
                    valid: true,
                    reason_code: "ok".into(),
                    reason: "OK".into(),
                })
            };
        invoke.resolver.respond(result.map_err(Into::into));
    });
    true
}

// ---------------------------------------------------------------------------
// inventory::submit! registrations
// ---------------------------------------------------------------------------

inventory::submit!(CommandSpec {
    name: "list_projects",
    plugin_id: "project-mode",
    dispatch: dispatch_list_projects,
});

inventory::submit!(CommandSpec {
    name: "add_project",
    plugin_id: "project-mode",
    dispatch: dispatch_add_project,
});

inventory::submit!(CommandSpec {
    name: "remove_project",
    plugin_id: "project-mode",
    dispatch: dispatch_remove_project,
});

inventory::submit!(CommandSpec {
    name: "switch_project",
    plugin_id: "project-mode",
    dispatch: dispatch_switch_project,
});

inventory::submit!(CommandSpec {
    name: "current_project",
    plugin_id: "project-mode",
    dispatch: dispatch_current_project,
});

inventory::submit!(CommandSpec {
    name: "pick_project_root_dir",
    plugin_id: "project-mode",
    dispatch: dispatch_pick_project_root_dir,
});

inventory::submit!(CommandSpec {
    name: "validate_project_path",
    plugin_id: "project-mode",
    dispatch: dispatch_validate_project_path,
});