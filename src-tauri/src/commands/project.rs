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

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use crate::app_state::AppState;
use crate::domain::{Project, ProjectsFile};
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
    let pf = state.project_service.load().map_err(|e| e.to_string())?;
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
    state
        .project_service
        .add(name, root)
        .map_err(|e| e.to_string())
}

/// M3.10 — remove a user project. Refuses to remove the system
/// project (UI surfaces the rejection via the InfoBar).
#[tauri::command]
pub async fn remove_project(state: State<'_, AppState>, id: Uuid) -> CmdResult<()> {
    state
        .project_service
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
    let project = state
        .project_service
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
    let pf = state.project_service.load().map_err(|e| e.to_string())?;
    Ok(pf.current().cloned())
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
}