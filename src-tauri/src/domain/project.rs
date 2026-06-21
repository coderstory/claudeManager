//! Project — domain model (M3.10 — F-core architecture, 清单 23).
//!
//! Introduces the "user / project" dual-mode. `Project` is the unit of
//! resource scoping: every plugin reads/writes under the *active*
//! project's root (via `IPlatformPaths::active_root_dir()`) rather
//! than always `~/.claude/`.
//!
//! ## Backwards compatibility
//!
//! On first launch M3.10 auto-seeds a single `is_system = true`
//! project whose `root_dir` = `home`. Every existing M2.x user
//! gets the same behaviour they had yesterday — only the data
//! model has a new wrapper.
//!
//! ## Conventions
//!
//! - `is_system = true` projects can NEVER be removed (UI rejects +
//!   service rejects). This is the safety net that keeps the M2.x
//!   "user-level" behaviour reachable forever.
//! - `id` is `uuid::Uuid::nil()` for the system project (a fixed
//!   constant) so `current_project_id == Some(SYSTEM_PROJECT_ID)`
//!   is a stable signal across machines / reinstalls.
//! - `root_dir` is the project ROOT — plugin code joins `.claude`.
//!   For the system project we store `home` (NOT `home/.claude`) so
//!   the plugin code path is identical: `active_root.join(".claude")`.
//!   This means a future "system project becomes a normal project"
//!   refactor is purely a `projects.json` rewrite, no plugin changes.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use thiserror::Error;
use uuid::Uuid;

/// Fixed UUID for the implicit "user-level" system project.
///
/// `Uuid::nil()` (all-zeros) is intentionally chosen so the value
/// is byte-stable and survives a copy of `projects.json` between
/// machines. Regular projects use `Uuid::new_v4()` (random).
pub const SYSTEM_PROJECT_ID: Uuid = Uuid::nil();

/// A single project entry in the local library (M3.10, 清单 23).
///
/// Persisted in `<app_data>/projects.json` as part of [`ProjectsFile`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct Project {
    /// Unique ID. System project uses [`SYSTEM_PROJECT_ID`] (nil);
    /// user-added projects use `Uuid::new_v4()`.
    pub id: Uuid,
    /// Display name. User-editable. Validated non-empty + ≤ 64 chars.
    pub name: String,
    /// Project root directory (absolute path).
    ///
    /// System project = `home` (NOT `home/.claude`) — the plugin
    /// joins `.claude` itself, so the path layout is uniform across
    /// system and user projects.
    ///
    /// User-added projects = the directory the user selected; must
    /// already contain a `.claude/` subdir at creation time
    /// (validated by [`ProjectService::add`]).
    pub root_dir: PathBuf,
    /// Unix seconds. Matches `Provider::created_at`'s convention so
    /// we don't need a chrono dep for one call (CLAUDE.md §2.3).
    pub created_at: i64,
    /// `true` = user-level / system project. Cannot be removed.
    pub is_system: bool,
}

/// On-disk shape: `<app_data>/projects.json`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProjectsFile {
    /// Format version. M3.10 = 1. Bump on breaking field changes.
    pub version: u32,
    /// Active project. `None` only on the very first launch before
    /// [`ProjectService::load`] has seeded the system project.
    pub current_project_id: Option<Uuid>,
    /// All known projects. Always contains ≥1 entry (the system
    /// project) once seeded.
    pub projects: Vec<Project>,
}

impl Default for ProjectsFile {
    fn default() -> Self {
        Self {
            version: 1,
            current_project_id: None,
            projects: Vec::new(),
        }
    }
}

impl ProjectsFile {
    /// Current format version this code can read.
    pub const FORMAT_VERSION: u32 = 1;

    /// Find a project by id (linear scan — N is small, usually ≤ 5).
    pub fn find(&self, id: Uuid) -> Option<&Project> {
        self.projects.iter().find(|p| p.id == id)
    }

    /// Mutable counterpart of [`find`].
    pub fn find_mut(&mut self, id: Uuid) -> Option<&mut Project> {
        self.projects.iter_mut().find(|p| p.id == id)
    }

    /// Current active project (resolved).
    pub fn current(&self) -> Option<&Project> {
        self.current_project_id.and_then(|id| self.find(id))
    }

    /// Current project id, falling back to the system project if
    /// the stored `current_project_id` is dangling (e.g. user
    /// hand-edited `projects.json`).
    pub fn resolved_current_id(&self) -> Uuid {
        match self.current_project_id {
            Some(id) if self.find(id).is_some() => id,
            _ => SYSTEM_PROJECT_ID,
        }
    }
}

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

#[derive(Debug, Error)]
pub enum ProjectError {
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("invalid JSON: {0}")]
    Json(#[from] serde_json::Error),

    #[error("project name must be non-empty")]
    EmptyName,

    #[error("project name must be ≤ 64 characters (got {0})")]
    NameTooLong(usize),

    #[error("project root_dir must be an absolute path: {0}")]
    NotAbsolute(PathBuf),

    #[error("project root_dir does not exist: {0}")]
    RootNotFound(PathBuf),

    #[error("project root_dir must contain a .claude/ subdirectory: {0}")]
    MissingClaudeSubdir(PathBuf),

    #[error("project id {0} not found")]
    NotFound(Uuid),

    #[error("cannot remove the system project (is_system = true)")]
    CannotRemoveSystem,

    #[error("cannot switch to the already-active project")]
    AlreadyActive,
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

const MAX_NAME_LEN: usize = 64;

impl Project {
    /// Construct a new user-added (non-system) project with
    /// `created_at = now`.
    pub fn new(name: impl Into<String>, root_dir: PathBuf) -> Self {
        Self {
            id: Uuid::new_v4(),
            name: name.into(),
            root_dir,
            created_at: now_unix_secs(),
            is_system: false,
        }
    }

    /// Build the canonical system project.
    pub fn system(home: PathBuf) -> Self {
        Self {
            id: SYSTEM_PROJECT_ID,
            name: "用户级（默认）".to_string(),
            root_dir: home,
            created_at: now_unix_secs(),
            is_system: true,
        }
    }

    /// Validate invariants used at create time.
    pub fn validate_for_create(&self) -> Result<(), ProjectError> {
        validate_name(&self.name)?;
        validate_root(&self.root_dir)?;
        Ok(())
    }

    /// Path to this project's `.claude/` directory. Empty if
    /// `root_dir` is empty (defensive — should never happen after
    /// validation).
    pub fn claude_dir(&self) -> Option<PathBuf> {
        if self.root_dir.as_os_str().is_empty() {
            None
        } else {
            Some(self.root_dir.join(".claude"))
        }
    }
}

pub fn validate_name(name: &str) -> Result<(), ProjectError> {
    if name.is_empty() {
        return Err(ProjectError::EmptyName);
    }
    if name.chars().count() > MAX_NAME_LEN {
        return Err(ProjectError::NameTooLong(name.chars().count()));
    }
    Ok(())
}

pub fn validate_root(root: &Path) -> Result<(), ProjectError> {
    if !root.is_absolute() {
        return Err(ProjectError::NotAbsolute(root.to_path_buf()));
    }
    if !root.exists() {
        return Err(ProjectError::RootNotFound(root.to_path_buf()));
    }
    // For user-added projects we require the directory to already
    // contain a .claude/ subdir — that's the M3.10 contract for what
    // counts as a Claude project. The system project gets a free
    // pass (its root is `home` and we don't want to require it to
    // have a .claude/ on first launch).
    let claude_subdir = root.join(".claude");
    if !claude_subdir.exists() || !claude_subdir.is_dir() {
        return Err(ProjectError::MissingClaudeSubdir(root.to_path_buf()));
    }
    Ok(())
}

/// Unix seconds. Same trick as `Provider::now_unix_secs`.
fn now_unix_secs() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

// ---------------------------------------------------------------------------
// Tests — TDD coverage for the domain model.
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn sample_project(id: Uuid, name: &str, root: PathBuf) -> Project {
        Project {
            id,
            name: name.into(),
            root_dir: root,
            created_at: 1_700_000_000,
            is_system: false,
        }
    }

    #[test]
    fn system_project_id_is_nil_uuid() {
        // Pinned — the all-zeros UUID is the M3.10 contract for the
        // implicit system project. Tests in `project_service` rely on
        // this being stable.
        assert_eq!(SYSTEM_PROJECT_ID, Uuid::nil());
    }

    #[test]
    fn new_project_uses_random_uuid_and_current_time() {
        let p = Project::new("foo", PathBuf::from("/x"));
        assert_ne!(p.id, SYSTEM_PROJECT_ID);
        assert!(p.created_at >= 1_700_000_000);
        assert!(!p.is_system);
    }

    #[test]
    fn system_project_helper_has_fixed_id_and_is_system_true() {
        let p = Project::system(PathBuf::from("/home/user"));
        assert_eq!(p.id, SYSTEM_PROJECT_ID);
        assert!(p.is_system);
        assert_eq!(p.name, "用户级（默认）");
        assert_eq!(p.root_dir, PathBuf::from("/home/user"));
    }

    #[test]
    fn validate_name_accepts_normal_inputs() {
        for n in ["a", "Project A", "项目 A", &"x".repeat(MAX_NAME_LEN)] {
            assert!(validate_name(n).is_ok(), "should accept: {n:?}");
        }
    }

    #[test]
    fn validate_name_rejects_empty() {
        assert!(matches!(validate_name(""), Err(ProjectError::EmptyName)));
    }

    #[test]
    fn validate_name_rejects_over_64_chars() {
        let too_long = "x".repeat(MAX_NAME_LEN + 1);
        assert!(matches!(
            validate_name(&too_long),
            Err(ProjectError::NameTooLong(65))
        ));
    }

    #[test]
    fn validate_root_rejects_relative_path() {
        let p = PathBuf::from("relative/path");
        assert!(matches!(
            validate_root(&p),
            Err(ProjectError::NotAbsolute(_))
        ));
    }

    #[test]
    fn validate_root_rejects_nonexistent_path() {
        let p = PathBuf::from("/this/does/not/exist/at/all/anywhere/12345");
        assert!(matches!(
            validate_root(&p),
            Err(ProjectError::RootNotFound(_))
        ));
    }

    #[test]
    fn validate_root_rejects_dir_without_claude_subdir() {
        let tmp = TempDir::new().unwrap();
        // tmp exists but has no .claude/ inside it
        assert!(matches!(
            validate_root(tmp.path()),
            Err(ProjectError::MissingClaudeSubdir(_))
        ));
    }

    #[test]
    fn validate_root_accepts_dir_with_claude_subdir() {
        let tmp = TempDir::new().unwrap();
        std::fs::create_dir(tmp.path().join(".claude")).unwrap();
        assert!(validate_root(tmp.path()).is_ok());
    }

    #[test]
    fn projects_file_default_is_empty() {
        let pf = ProjectsFile::default();
        assert_eq!(pf.version, 1);
        assert_eq!(pf.current_project_id, None);
        assert!(pf.projects.is_empty());
    }

    #[test]
    fn projects_file_find_returns_some_for_existing_id() {
        let id1 = Uuid::new_v4();
        let id2 = Uuid::new_v4();
        let pf = ProjectsFile {
            version: 1,
            current_project_id: Some(id1),
            projects: vec![
                sample_project(id1, "A", PathBuf::from("/a")),
                sample_project(id2, "B", PathBuf::from("/b")),
            ],
        };
        assert_eq!(pf.find(id1).unwrap().name, "A");
        assert_eq!(pf.find(id2).unwrap().name, "B");
        assert!(pf.find(Uuid::new_v4()).is_none());
    }

    #[test]
    fn projects_file_current_resolves_id() {
        let id = Uuid::new_v4();
        let pf = ProjectsFile {
            version: 1,
            current_project_id: Some(id),
            projects: vec![sample_project(id, "X", PathBuf::from("/x"))],
        };
        assert_eq!(pf.current().unwrap().name, "X");
    }

    #[test]
    fn projects_file_resolved_current_id_falls_back_to_system_on_dangling() {
        let id = Uuid::new_v4();
        let pf = ProjectsFile {
            version: 1,
            current_project_id: Some(id), // points to non-existent
            projects: vec![sample_project(
                Uuid::new_v4(),
                "Other",
                PathBuf::from("/other"),
            )],
        };
        assert_eq!(pf.resolved_current_id(), SYSTEM_PROJECT_ID);
    }

    #[test]
    fn projects_file_resolved_current_id_uses_none_when_empty() {
        let pf = ProjectsFile::default();
        assert_eq!(pf.resolved_current_id(), SYSTEM_PROJECT_ID);
    }

    #[test]
    fn serde_roundtrip_preserves_all_fields() {
        let tmp = TempDir::new().unwrap();
        let original = ProjectsFile {
            version: 1,
            current_project_id: Some(SYSTEM_PROJECT_ID),
            projects: vec![
                Project::system(PathBuf::from("/home/u")),
                Project::new("Project A", tmp.path().to_path_buf()),
            ],
        };
        let json = serde_json::to_string_pretty(&original).unwrap();
        let restored: ProjectsFile = serde_json::from_str(&json).unwrap();
        assert_eq!(restored, original);
    }

    #[test]
    fn serde_json_field_names_use_snake_case() {
        let tmp = TempDir::new().unwrap();
        let pf = ProjectsFile {
            version: 1,
            current_project_id: Some(SYSTEM_PROJECT_ID),
            projects: vec![Project::system(tmp.path().to_path_buf())],
        };
        let raw = serde_json::to_string_pretty(&pf).unwrap();
        // Snake-case on disk, matching Provider convention.
        assert!(raw.contains("\"root_dir\":"));
        assert!(raw.contains("\"created_at\":"));
        assert!(raw.contains("\"is_system\":"));
        assert!(raw.contains("\"current_project_id\":"));
        // No camelCase leakage.
        assert!(!raw.contains("rootDir"));
        assert!(!raw.contains("isSystem"));
    }

    #[test]
    fn claude_dir_joins_dot_claude() {
        let p = Project::system(PathBuf::from("/home/u"));
        assert_eq!(
            p.claude_dir(),
            Some(PathBuf::from("/home/u/.claude"))
        );
    }

    #[test]
    fn claude_dir_returns_none_for_empty_root() {
        let mut p = Project::system(PathBuf::from("/home/u"));
        p.root_dir = PathBuf::new();
        assert_eq!(p.claude_dir(), None);
    }
}