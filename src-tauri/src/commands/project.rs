//! Tauri commands for M3.10 — 双模式 (用户/项目) (清单 23).
//!
//! Five commands mirroring the service surface, kept as thin shims
//! per the existing `commands::*` convention (commands own the
//! Tauri `State<'_, AppState>` extraction + error stringification).
//!
//! Frontend contract:
//! - `list_projects()`         → `ProjectsFile` (full file shape)
//! - `add_project(name, root)` → `Project` (the freshly-created entry)
//! - `remove_project(id)`      → `()`
//! - `switch_project(id)`      → `Project` (the now-active project)
//! - `current_project()`       → `Project` (active one — convenience
//!                                accessor for callers that already
//!                                have the file cached and just want
//!                                the active row)
//!
//! All error strings are user-readable (SPEC §6.5).

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_dialog::DialogExt;
use uuid::Uuid;

use crate::app_state::AppState;
use crate::domain::{Project, ProjectsFile};
use crate::get_service;
use crate::services::project_service::ProjectServiceError;

/// Tauri-friendly error type — matches the rest of `commands::*`.
type CmdResult<T> = Result<T, String>;

// ---------------------------------------------------------------------------
// DTOs (kept flat for the frontend)
// ---------------------------------------------------------------------------

/// Flat view of the active project for the frontend welcome /
/// sidebar switcher. The frontend doesn't need `created_at` /
/// `is_system` to render the dropdown.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProjectSummary {
    pub id: Uuid,
    pub name: String,
    pub root_dir: PathBuf,
    pub is_system: bool,
}

impl From<&Project> for ProjectSummary {
    fn from(p: &Project) -> Self {
        Self {
            id: p.id,
            name: p.name.clone(),
            root_dir: p.root_dir.clone(),
            is_system: p.is_system,
        }
    }
}

/// Response shape for `list_projects`. We return both the project
/// list AND the active id so the frontend can render
/// "active = X" without an extra `current_project` round-trip.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProjectsListResult {
    pub projects: Vec<ProjectSummary>,
    pub current_project_id: Option<Uuid>,
    /// Resolved file as well — frontend may want version info or
    /// to keep the full list cached for diff checks.
    pub file: ProjectsFile,
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// M3.10 — list all projects + the active id.
///
/// First call (no projects.json yet) auto-seeds the system project
/// and persists it. The returned `file` reflects the post-seed state.
#[tauri::command]
pub async fn list_projects(state: State<'_, AppState>) -> CmdResult<ProjectsListResult> {
    let pf = get_service!(state, crate::services::project_service::ProjectService)
        .load()
        .map_err(|e| e.to_string())?;
    let current = pf.current_project_id;
    Ok(ProjectsListResult {
        projects: pf.projects.iter().map(ProjectSummary::from).collect(),
        current_project_id: current,
        file: pf,
    })
}

/// M3.10 — add a new user project. Validates the root_dir must
/// contain a `.claude/` subdir (the M3.10 contract for what counts
/// as a Claude project).
#[tauri::command]
pub async fn add_project(
    state: State<'_, AppState>,
    name: String,
    root_dir: String,
) -> CmdResult<Project> {
    let root = PathBuf::from(root_dir);
    get_service!(state, crate::services::project_service::ProjectService)
        .add(name, root)
        .map_err(|e| e.to_string())
}

/// M3.10 — remove a user project. Refuses to remove the system
/// project (UI surfaces the rejection via the InfoBar).
#[tauri::command]
pub async fn remove_project(state: State<'_, AppState>, id: Uuid) -> CmdResult<()> {
    get_service!(state, crate::services::project_service::ProjectService)
        .remove(id)
        .map_err(|e| e.to_string())
}

/// M3.10 — switch the active project. F13 backup first, then atomic
/// `current_project_id` update.
///
/// Returns the now-active [`Project`] so the frontend can render the
/// switch without an extra `current_project()` round-trip.
#[tauri::command]
pub async fn switch_project(
    app: AppHandle,
    state: State<'_, AppState>,
    id: Uuid,
) -> CmdResult<Project> {
    let project = get_service!(state, crate::services::project_service::ProjectService)
        .switch(id)
        .map_err(|e| e.to_string())?;
    // Emit a Tauri event so other open pages can refresh their
    // cached data (the user is looking at provider-list while
    // switching projects → list should re-read).
    if let Err(e) = app.emit("project-switched", project.id.to_string()) {
        log::warn!("[M3.10] emit project-switched failed: {e}");
    }
    Ok(project)
}

/// M3.10 — convenience accessor for the active project. Empty list
/// + `None` current means the system project isn't seeded yet (only
/// possible during the very first launch's atomic write window).
#[tauri::command]
pub async fn current_project(state: State<'_, AppState>) -> CmdResult<Option<Project>> {
    let pf = get_service!(state, crate::services::project_service::ProjectService)
        .load()
        .map_err(|e| e.to_string())?;
    Ok(pf.current().cloned())
}

// ---------------------------------------------------------------------------
// M3.13.4 — 新建项目 picker + 路径合法性校验 (清单 23 后续 polish)
// ---------------------------------------------------------------------------

/// M3.13.4 — open a native folder picker so the user can choose the
/// project root without typing the path.
///
/// ## 设计选择 — Rust 侧全权处理 dialog
///
/// 本仓库的依赖纪律（CLAUDE.md §2.3）锁死了 npm 依赖白名单,
/// 没有装 `@tauri-apps/plugin-dialog` 的 JS wrapper（见
/// `package.json` + `json-editor` / `import-sql` 等页面都用 HTML
/// `<input type=file>` 走 Rust 后端）。HTML input 只能"打开" /
/// "保存" 文件,无法弹"目录选择"对话框,所以必须走 Rust 侧的
/// `tauri-plugin-dialog::DialogExt::blocking_pick_folder`。
///
/// 这和 `export_provider` / `export_optimization_report` 的"F14/F23
/// 后端弹保存框"模式是同一类:业务层只发一个 invoke 拿最终路径。
/// 前端 `src/lib/api/projects.ts::pickProjectRoot` 是唯一的调用方。
///
/// ## 阻塞 vs 非阻塞
///
/// `blocking_*` 系列在 async command 里是安全的（文档原话："should
/// *NOT* be used when running on the main thread"; async command 跑在
/// Tauri 的 async runtime,不是主线程）。同样的解释见
/// `commands::providers::export_provider` 的注释。
///
/// ## 返回值
///
/// `Ok(Some(path))` — 用户选中目录,`path` 是绝对路径字符串。
/// `Ok(None)`       — 用户取消（正常流程,不报错）。
/// `Err(msg)`       — 解析路径失败,`msg` 给前端展示。
#[tauri::command]
pub async fn pick_project_root_dir(app: AppHandle) -> CmdResult<Option<String>> {
    let picked = app
        .dialog()
        .file()
        .set_title("选择项目根目录")
        .blocking_pick_folder();

    match picked {
        None => Ok(None),
        Some(fp) => fp
            .into_path()
            .map(|p| Some(p.to_string_lossy().into_owned()))
            .map_err(|e| format!("无法解析选中目录: {e}")),
    }
}

/// M3.13.4 — validate a path string without committing it.
///
/// The frontend's "新建项目" form needs immediate feedback as the
/// user picks / types a path — green check or red reason text — so
/// the submit button can be locked out before `add_project` actually
/// touches disk. This command mirrors [`crate::domain::project::validate_root`]
/// but does NOT mutate anything (the service still re-validates on
/// `add_project`, so a buggy client can't slip a bad path past us).
///
/// ## 返回值（序列化后供前端消费）
///
/// ```jsonc
/// {
///   "path": "/Users/me/projects/foo",
///   "valid": false,
///   "reason_code": "missing_claude_subdir",
///   "reason": "目录必须包含 .claude/ 子目录: /Users/me/projects/foo"
/// }
/// ```
///
/// `reason_code` 是稳定的机器可读标识符（snake_case 字符串）,
/// 方便前端按 code 做 i18n 或埋点;`reason` 是直接给用户看的中文。
/// 当 `valid == true` 时,两个字段都是空字符串。
///
/// ## 校验顺序
///
/// 1. 空字符串     → `empty`
/// 2. 非绝对路径   → `not_absolute`
/// 3. 路径不存在   → `not_found`
/// 4. 不是目录     → `not_dir`
/// 5. 缺 `.claude/` 子目录 → `missing_claude_subdir`
///
/// 每一步给出**具体的**失败原因,前端弹"红色 reason"行,
/// 不允许出现"无效路径"这种含糊的提示（SPEC §6.5）。
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PathValidation {
    pub path: String,
    pub valid: bool,
    pub reason_code: String,
    pub reason: String,
}

#[tauri::command]
pub async fn validate_project_path(path: String) -> CmdResult<PathValidation> {
    Ok(validate_project_path_impl(&path))
}

/// Pure helper — used by both the command and the in-crate tests.
/// Kept private (no `pub`) so the IPC surface is the single source of
/// truth for callers.
fn validate_project_path_impl(path: &str) -> PathValidation {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return PathValidation {
            path: path.to_string(),
            valid: false,
            reason_code: "empty".into(),
            reason: "路径不能为空".into(),
        };
    }
    let p = Path::new(trimmed);
    if !p.is_absolute() {
        return PathValidation {
            path: trimmed.to_string(),
            valid: false,
            reason_code: "not_absolute".into(),
            reason: format!("路径必须是绝对路径: {trimmed}"),
        };
    }
    if !p.exists() {
        return PathValidation {
            path: trimmed.to_string(),
            valid: false,
            reason_code: "not_found".into(),
            reason: format!("路径不存在: {trimmed}"),
        };
    }
    if !p.is_dir() {
        return PathValidation {
            path: trimmed.to_string(),
            valid: false,
            reason_code: "not_dir".into(),
            reason: format!("路径不是目录: {trimmed}"),
        };
    }
    let claude_subdir = p.join(".claude");
    if !claude_subdir.exists() || !claude_subdir.is_dir() {
        return PathValidation {
            path: trimmed.to_string(),
            valid: false,
            reason_code: "missing_claude_subdir".into(),
            reason: format!("目录必须包含 .claude/ 子目录: {trimmed}"),
        };
    }
    PathValidation {
        path: trimmed.to_string(),
        valid: true,
        reason_code: String::new(),
        reason: String::new(),
    }
}

// ---------------------------------------------------------------------------
// Error → string mapping helpers (kept private; commands call
// `.map_err(|e| e.to_string())` inline so the conversion surface is
// right at the call site).
// ---------------------------------------------------------------------------

#[allow(dead_code)]
fn map_service_err(e: ProjectServiceError) -> String {
    e.to_string()
}

// ---------------------------------------------------------------------------
// Tests — pin the *command* contract. If these compile the IPC
// surface is right (see commands::providers::tests for the pattern).
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn project_summary_from_project_round_trips_core_fields() {
        let tmp = tempfile::TempDir::new().unwrap();
        let p = Project::new("X", tmp.path().to_path_buf());
        let s = ProjectSummary::from(&p);
        assert_eq!(s.id, p.id);
        assert_eq!(s.name, "X");
        assert_eq!(s.root_dir, tmp.path());
        assert!(!s.is_system);
    }

    #[test]
    fn projects_list_result_serialises_with_expected_keys() {
        let pf = ProjectsFile::default();
        let r = ProjectsListResult {
            projects: vec![],
            current_project_id: None,
            file: pf,
        };
        let v = serde_json::to_value(&r).unwrap();
        assert!(v.get("projects").is_some());
        assert!(v.get("current_project_id").is_some());
        assert!(v.get("file").is_some());
        assert!(v["projects"].is_array());
    }

    // -----------------------------------------------------------------------
    // M3.13.4 — validate_project_path (covers all 5 reason codes)
    // -----------------------------------------------------------------------

    #[test]
    fn validate_empty_path_returns_empty_reason_code() {
        let r = validate_project_path_impl("");
        assert!(!r.valid);
        assert_eq!(r.reason_code, "empty");
        assert!(r.reason.contains("不能为空"));
        assert_eq!(r.path, "");
    }

    #[test]
    fn validate_whitespace_only_path_is_empty() {
        let r = validate_project_path_impl("   ");
        assert!(!r.valid);
        assert_eq!(r.reason_code, "empty");
    }

    #[test]
    fn validate_relative_path_returns_not_absolute() {
        let r = validate_project_path_impl("relative/path/foo");
        assert!(!r.valid);
        assert_eq!(r.reason_code, "not_absolute");
        assert!(r.reason.contains("绝对路径"));
    }

    #[test]
    fn validate_nonexistent_absolute_path_returns_not_found() {
        // On Windows / POSIX, this absolute path is bogus.
        let r = validate_project_path_impl(if cfg!(windows) {
            "C:\\this\\does\\not\\exist\\anywhere\\9999"
        } else {
            "/this/does/not/exist/anywhere/9999"
        });
        assert!(!r.valid);
        assert_eq!(r.reason_code, "not_found");
        assert!(r.reason.contains("不存在"));
    }

    #[test]
    fn validate_existing_file_instead_of_dir_returns_not_dir() {
        let tmp = tempfile::TempDir::new().unwrap();
        let file = tmp.path().join("not-a-dir.txt");
        std::fs::write(&file, "x").unwrap();
        let r = validate_project_path_impl(file.to_str().unwrap());
        assert!(!r.valid);
        assert_eq!(r.reason_code, "not_dir");
        assert!(r.reason.contains("不是目录"));
    }

    #[test]
    fn validate_dir_without_claude_subdir_returns_missing_claude_subdir() {
        let tmp = tempfile::TempDir::new().unwrap();
        let r = validate_project_path_impl(tmp.path().to_str().unwrap());
        assert!(!r.valid);
        assert_eq!(r.reason_code, "missing_claude_subdir");
        assert!(r.reason.contains(".claude/"));
    }

    #[test]
    fn validate_dir_with_claude_subdir_returns_valid() {
        let tmp = tempfile::TempDir::new().unwrap();
        std::fs::create_dir(tmp.path().join(".claude")).unwrap();
        let r = validate_project_path_impl(tmp.path().to_str().unwrap());
        assert!(r.valid, "expected valid, got reason={:?}", r.reason);
        assert_eq!(r.reason_code, "");
        assert_eq!(r.reason, "");
    }

    #[test]
    fn validate_claude_subdir_must_be_dir_not_file() {
        // A file named `.claude` (not a directory) must still fail.
        let tmp = tempfile::TempDir::new().unwrap();
        std::fs::write(tmp.path().join(".claude"), "x").unwrap();
        let r = validate_project_path_impl(tmp.path().to_str().unwrap());
        assert!(!r.valid);
        assert_eq!(r.reason_code, "missing_claude_subdir");
    }

    #[test]
    fn validate_path_validation_serialises_with_expected_keys() {
        let v = serde_json::to_value(PathValidation {
            path: "/x".into(),
            valid: false,
            reason_code: "not_found".into(),
            reason: "路径不存在: /x".into(),
        })
        .unwrap();
        assert_eq!(v["path"], "/x");
        assert_eq!(v["valid"], false);
        assert_eq!(v["reason_code"], "not_found");
        assert!(v["reason"].as_str().unwrap().contains("不存在"));
    }
}