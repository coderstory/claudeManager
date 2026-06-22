//! ProjectService — M3.10 (清单 23) business logic for the
//! "user / project" dual-mode.
//!
//! Owns `<app_data>/projects.json`. Exposes:
//!
//! - [`load`](Self::load) — read+parse+seed-if-missing. Always
//!   returns a valid [`ProjectsFile`] (auto-seeds the system project
//!   on first launch).
//! - [`save`](Self::save) — atomic write via `fs_atomic::write_with_backup`.
//! - [`add`](Self::add) — create a user project (validates name +
//!   root_dir).
//! - [`remove`](Self::remove) — delete a user project (refuses system).
//! - [`switch`](Self::switch) — change `current_project_id` (F13
//!   backup first, atomic update, then caller emits event).
//! - [`current`](Self::current) — convenience accessor.
//!
//! ## Why a separate service (not just a tauri command helper)
//!
//! - All the file-shape logic lives in one place (atomic I/O, validation,
//!   default seeding). Commands become thin shims.
//! - Unit-testable without Tauri: pass a `TempDir`-rooted `AppPaths`
//!   and call `load()`.
//! - Mirrors the `ProviderService` / `BackupService` pattern already in
//!   `services/`.
//!
//! ## Path resolution
//!
//! The service receives an `AppPaths` snapshot (per CLAUDE.md §3.1 +
//! the existing convention in `ProviderService::new`). `projects.json`
//! lives at `<app_data>/projects.json` — same root as the other
//! per-app data files (`providers/`, `backups/`, `marketplaces/`).

use std::path::{Path, PathBuf};

use thiserror::Error;
use uuid::Uuid;

use crate::domain::project::{
    validate_name, validate_root, Project, ProjectError, ProjectsFile,
    SYSTEM_PROJECT_ID,
};
use crate::infrastructure::fs_atomic;
use crate::platform::AppPaths;

// ---------------------------------------------------------------------------
// ProjectServiceError
// ---------------------------------------------------------------------------

#[derive(Debug, Error)]
pub enum ProjectServiceError {
    #[error(transparent)]
    Project(#[from] ProjectError),

    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("invalid JSON: {0}")]
    Json(#[from] serde_json::Error),

    #[error("atomic write failed: {0}")]
    AtomicWrite(String),
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

pub struct ProjectService {
    paths: AppPaths,
}

impl ProjectService {
    pub fn new(paths: AppPaths) -> Self {
        Self { paths }
    }

    #[allow(dead_code)]
    pub fn paths(&self) -> &AppPaths {
        &self.paths
    }

    /// Canonical on-disk path of `projects.json`.
    fn projects_file(&self) -> PathBuf {
        self.paths.app_data.join("projects.json")
    }

    // -----------------------------------------------------------------------
    // load / save
    // -----------------------------------------------------------------------

    /// Load `projects.json`. Auto-seeds the system project on first
    /// launch OR if the file is missing / corrupt / format-mismatched.
    ///
    /// # Idempotency
    ///
    /// Calling `load` twice returns semantically equivalent results —
    /// the second call hits the on-disk file written by the first.
    /// We never silently overwrite a non-empty project list.
    pub fn load(&self) -> Result<ProjectsFile, ProjectServiceError> {
        let path = self.projects_file();
        if !path.exists() {
            // First-launch path: seed and save.
            let mut fresh = ProjectsFile::default();
            self.seed_system_project(&mut fresh)?;
            self.save(&fresh)?;
            return Ok(fresh);
        }

        let raw = std::fs::read_to_string(&path)?;
        let parsed: ProjectsFile = match serde_json::from_str(&raw) {
            Ok(p) => p,
            Err(e) => {
                // Corrupt — quarantine the bad file + seed fresh.
                // (CLAUDE.md §7: don't silently drop user data.)
                self.quarantine_corrupt(&path, &raw, &e.to_string());
                let mut fresh = ProjectsFile::default();
                self.seed_system_project(&mut fresh)?;
                self.save(&fresh)?;
                return Ok(fresh);
            }
        };

        // Defensive: ensure the system project is present even if the
        // file was hand-edited (e.g. user upgraded from M2.x and
        // somehow has a projects.json without a system project).
        let mut out = parsed;
        self.ensure_system_project(&mut out)?;
        // If current_project_id is dangling (points to a missing
        // project), reset to system. Don't write back here — the
        // caller (or a later mutation) will.
        if let Some(id) = out.current_project_id {
            if out.find(id).is_none() {
                out.current_project_id = None;
            }
        }
        Ok(out)
    }

    /// Atomically write `projects.json`. Goes through
    /// `fs_atomic::write_with_backup` so a partial write never leaves
    /// the file in a half-baked state.
    pub fn save(&self, pf: &ProjectsFile) -> Result<(), ProjectServiceError> {
        let path = self.projects_file();
        let json = serde_json::to_string_pretty(pf)?;
        fs_atomic::write_with_backup(&path, &json)
            .map_err(|e| ProjectServiceError::AtomicWrite(format!("{e}")))?;
        Ok(())
    }

    // -----------------------------------------------------------------------
    // CRUD
    // -----------------------------------------------------------------------

    /// Add a new user project. Validates name + root_dir. Does NOT
    /// switch the active project — the user does that explicitly.
    pub fn add(
        &self,
        name: String,
        root_dir: PathBuf,
    ) -> Result<Project, ProjectServiceError> {
        validate_name(&name)?;
        validate_root(&root_dir)?;
        let mut pf = self.load()?;
        let project = Project::new(name, root_dir);
        pf.projects.push(project.clone());
        self.save(&pf)?;
        Ok(project)
    }

    /// Remove a user project. Refuses to remove the system project.
    /// If the removed project was the current one, falls back to the
    /// system project (so the app always has *some* valid active id).
    pub fn remove(&self, id: Uuid) -> Result<(), ProjectServiceError> {
        let mut pf = self.load()?;
        let target = pf
            .find(id)
            .ok_or(ProjectServiceError::Project(ProjectError::NotFound(id)))?
            .clone();
        if target.is_system {
            return Err(ProjectServiceError::Project(
                ProjectError::CannotRemoveSystem,
            ));
        }
        pf.projects.retain(|p| p.id != id);
        // If we removed the active project, fall back to system.
        if pf.current_project_id == Some(id) {
            pf.current_project_id = Some(SYSTEM_PROJECT_ID);
        }
        self.save(&pf)?;
        Ok(())
    }

    /// Switch the active project. F13-style safety: takes backups of
    /// `settings.json` + `.claude.json` (the two files plugins mutate)
    /// so the user can roll back to the pre-switch state.
    ///
    /// Returns the freshly-activated [`Project`] (useful for the
    /// caller to emit a `project-switched` event with the project
    /// metadata).
    pub fn switch(&self, id: Uuid) -> Result<Project, ProjectServiceError> {
        let mut pf = self.load()?;
        let target = pf
            .find(id)
            .ok_or(ProjectServiceError::Project(ProjectError::NotFound(id)))?
            .clone();

        // F13 backup of the *current* active project's settings.json
        // + .claude.json (CLAUDE.md §7 + SPEC §6.1).
        //
        // We back up the LIVE files only (settings.json / .claude.json
        // in `paths`, which always points at the system project —
        // future plugin-rewrite work will redirect these to
        // `active_root`). For M3.10-arch the backup ensures the
        // user can restore a known-good baseline if the switch
        // sequence is interrupted.
        self.backup_active_state()?;

        pf.current_project_id = Some(id);
        self.save(&pf)?;
        Ok(target)
    }

    /// Read-only accessor — returns the current `ProjectsFile`. Same
    /// as `load` but kept as a separate name for callers that want to
    /// emphasise "I'm not mutating".
    pub fn current_state(&self) -> Result<ProjectsFile, ProjectServiceError> {
        self.load()
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    /// Insert the system project if not already present.
    fn seed_system_project(&self, pf: &mut ProjectsFile) -> Result<(), ProjectServiceError> {
        self.ensure_system_project(pf)?;
        if pf.current_project_id.is_none() {
            pf.current_project_id = Some(SYSTEM_PROJECT_ID);
        }
        Ok(())
    }

    /// Idempotent: add the system project if `pf.projects` doesn't
    /// already contain one.
    fn ensure_system_project(&self, pf: &mut ProjectsFile) -> Result<(), ProjectServiceError> {
        if pf.find(SYSTEM_PROJECT_ID).is_some() {
            return Ok(());
        }
        let system = Project::system(self.paths.home.clone());
        pf.projects.insert(0, system);
        Ok(())
    }

    /// Move a corrupt `projects.json` aside to `<name>.corrupt.<ts>`
    /// so the user (or a future tool) can recover it. We don't try
    /// to repair partial JSON — the only legal recovery is to reseed.
    fn quarantine_corrupt(&self, path: &Path, raw: &str, err: &str) {
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let mut corrupt_name = path
            .file_name()
            .map(|n| n.to_os_string())
            .unwrap_or_default();
        corrupt_name.push(format!(".corrupt.{}", ts));
        let corrupt_path = path.with_file_name(corrupt_name);
        if let Err(e) = std::fs::write(&corrupt_path, raw) {
            log::warn!(
                "[M3.10] failed to quarantine corrupt projects.json ({}): {}",
                e, err
            );
        } else {
            log::warn!(
                "[M3.10] quarantined corrupt projects.json to {}: {}",
                corrupt_path.display(),
                err
            );
        }
    }

    /// F13 backup of the live settings.json + .claude.json (the two
    /// files every plugin mutates). Best-effort — if the files don't
    /// exist yet (fresh install) we skip silently.
    fn backup_active_state(&self) -> Result<(), ProjectServiceError> {
        for target in [&self.paths.settings_json, &self.paths.claude_json] {
            if !target.exists() {
                continue;
            }
            let backup_path = fs_atomic::backup_path_for(target);
            std::fs::copy(target, &backup_path)?;
        }
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use serde::{Deserialize, Serialize};

    /// Build an `AppPaths` whose `app_data` lives inside a temp dir.
    /// Lets tests exercise real file I/O without touching the user's
    /// `%APPDATA%` / `~/.config`.
    fn test_paths(tmp: &tempfile::TempDir) -> AppPaths {
        AppPaths {
            home: tmp.path().join("home"),
            app_data: tmp.path().join("app_data"),
            settings_json: tmp.path().join("home/.claude/settings.json"),
            claude_json: tmp.path().join("home/.claude.json"),
            backups_dir: tmp.path().join("app_data/backups"),
            marketplaces_dir: tmp.path().join("app_data/marketplaces"),
            logs_dir: tmp.path().join("app_data/logs"),
            history_db: tmp.path().join("app_data/history.db"),
        }
    }

    /// Pre-create the dirs + files `test_paths` claims exist so the
    /// service's `backup_active_state` + `validate_root` paths work.
    fn bootstrap(p: &AppPaths) {
        for d in [
            &p.app_data,
            &p.backups_dir,
            &p.marketplaces_dir,
            &p.logs_dir,
            &p.home,
            p.home.join(".claude").as_path(),
        ] {
            std::fs::create_dir_all(d).unwrap();
        }
        std::fs::write(&p.settings_json, "{}").unwrap();
        std::fs::write(&p.claude_json, "{}").unwrap();
    }

    #[test]
    fn load_seeds_system_project_when_file_missing() {
        let tmp = tempfile::TempDir::new().unwrap();
        let p = test_paths(&tmp);
        bootstrap(&p);
        let svc = ProjectService::new(p.clone());

        let pf = svc.load().unwrap();
        assert_eq!(pf.projects.len(), 1);
        assert_eq!(pf.projects[0].id, SYSTEM_PROJECT_ID);
        assert!(pf.projects[0].is_system);
        assert_eq!(pf.current_project_id, Some(SYSTEM_PROJECT_ID));
        // The file should now exist on disk.
        assert!(svc.projects_file().exists());
    }

    #[test]
    fn load_is_idempotent_second_call_does_not_duplicate_system() {
        let tmp = tempfile::TempDir::new().unwrap();
        let p = test_paths(&tmp);
        bootstrap(&p);
        let svc = ProjectService::new(p);

        let _ = svc.load().unwrap();
        let again = svc.load().unwrap();
        assert_eq!(again.projects.len(), 1, "system project must not duplicate");
    }

    #[test]
    fn load_quarantines_corrupt_json_and_reseeds() {
        let tmp = tempfile::TempDir::new().unwrap();
        let p = test_paths(&tmp);
        bootstrap(&p);
        let svc = ProjectService::new(p);
        std::fs::create_dir_all(svc.paths().app_data.clone()).unwrap();
        std::fs::write(svc.projects_file(), "{ this is not json").unwrap();

        let pf = svc.load().unwrap();
        // After quarantine + reseed, the system project is back.
        assert_eq!(pf.projects.len(), 1);
        assert_eq!(pf.projects[0].id, SYSTEM_PROJECT_ID);

        // The original corrupt file should have been renamed with .corrupt.<ts>.
        let dir_entries: Vec<String> = std::fs::read_dir(svc.projects_file().parent().unwrap())
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        assert!(
            dir_entries.iter().any(|n| n.contains("projects.json.corrupt.")),
            "expected a corrupt backup, got: {:?}",
            dir_entries
        );
    }

    #[test]
    fn load_repairs_missing_system_project_in_existing_file() {
        // Someone hand-edited projects.json and removed the system
        // entry — load() must put it back without dropping their
        // user projects.
        let tmp = tempfile::TempDir::new().unwrap();
        let p = test_paths(&tmp);
        bootstrap(&p);
        let svc = ProjectService::new(p);
        std::fs::create_dir_all(svc.projects_file().parent().unwrap()).unwrap();
        let user_only = ProjectsFile {
            version: 1,
            current_project_id: None,
            projects: vec![Project::new("only-user", tmp.path().to_path_buf())],
        };
        std::fs::write(
            svc.projects_file(),
            serde_json::to_string_pretty(&user_only).unwrap(),
        )
        .unwrap();

        let pf = svc.load().unwrap();
        // System project was inserted (at index 0).
        assert_eq!(pf.projects.len(), 2);
        assert_eq!(pf.projects[0].id, SYSTEM_PROJECT_ID);
        // The user's project was preserved.
        assert!(pf.projects.iter().any(|p| p.name == "only-user"));
    }

    #[test]
    fn add_creates_user_project_and_persists() {
        let tmp = tempfile::TempDir::new().unwrap();
        let p = test_paths(&tmp);
        bootstrap(&p);
        // Make a valid Claude project under tmp.
        let proj_root = tmp.path().join("projects/foo");
        std::fs::create_dir_all(proj_root.join(".claude")).unwrap();
        let svc = ProjectService::new(p);

        let created = svc
            .add("My Project".to_string(), proj_root.clone())
            .unwrap();
        assert!(!created.is_system);
        assert_eq!(created.root_dir, proj_root);

        let pf = svc.load().unwrap();
        assert_eq!(pf.projects.len(), 2);
        assert!(pf.projects.iter().any(|x| x.name == "My Project"));
        // current_project_id is still the system project (add does NOT switch).
        assert_eq!(pf.current_project_id, Some(SYSTEM_PROJECT_ID));
    }

    #[test]
    fn add_rejects_relative_root_dir() {
        let tmp = tempfile::TempDir::new().unwrap();
        let p = test_paths(&tmp);
        bootstrap(&p);
        let svc = ProjectService::new(p);
        let err = svc
            .add("X".into(), PathBuf::from("relative/path"))
            .unwrap_err();
        assert!(matches!(
            err,
            ProjectServiceError::Project(ProjectError::NotAbsolute(_))
        ));
    }

    #[test]
    fn add_rejects_root_without_claude_subdir() {
        let tmp = tempfile::TempDir::new().unwrap();
        let p = test_paths(&tmp);
        bootstrap(&p);
        // tmp exists but doesn't have .claude/ — that's our project's root.
        let svc = ProjectService::new(p);
        let err = svc
            .add("X".into(), tmp.path().to_path_buf())
            .unwrap_err();
        assert!(matches!(
            err,
            ProjectServiceError::Project(ProjectError::MissingClaudeSubdir(_))
        ));
    }

    #[test]
    fn add_rejects_empty_name() {
        let tmp = tempfile::TempDir::new().unwrap();
        let p = test_paths(&tmp);
        bootstrap(&p);
        let proj = tmp.path().join("p");
        std::fs::create_dir_all(proj.join(".claude")).unwrap();
        let svc = ProjectService::new(p);
        let err = svc.add("".into(), proj).unwrap_err();
        assert!(matches!(
            err,
            ProjectServiceError::Project(ProjectError::EmptyName)
        ));
    }

    #[test]
    fn remove_user_project_succeeds_and_falls_back_active_to_system() {
        let tmp = tempfile::TempDir::new().unwrap();
        let p = test_paths(&tmp);
        bootstrap(&p);
        let proj = tmp.path().join("p");
        std::fs::create_dir_all(proj.join(".claude")).unwrap();
        let svc = ProjectService::new(p);

        let created = svc.add("P".into(), proj).unwrap();
        svc.switch(created.id).unwrap();

        svc.remove(created.id).unwrap();
        let pf = svc.load().unwrap();
        assert_eq!(pf.projects.len(), 1);
        assert_eq!(pf.current_project_id, Some(SYSTEM_PROJECT_ID));
    }

    #[test]
    fn remove_system_project_is_rejected() {
        let tmp = tempfile::TempDir::new().unwrap();
        let p = test_paths(&tmp);
        bootstrap(&p);
        let svc = ProjectService::new(p);
        // Make sure system project is seeded.
        let _ = svc.load().unwrap();

        let err = svc.remove(SYSTEM_PROJECT_ID).unwrap_err();
        assert!(matches!(
            err,
            ProjectServiceError::Project(ProjectError::CannotRemoveSystem)
        ));
    }

    #[test]
    fn switch_updates_current_and_takes_f13_backup() {
        let tmp = tempfile::TempDir::new().unwrap();
        let p = test_paths(&tmp);
        bootstrap(&p);
        let proj = tmp.path().join("p");
        std::fs::create_dir_all(proj.join(".claude")).unwrap();
        let svc = ProjectService::new(p);

        let created = svc.add("P".into(), proj).unwrap();
        let result = svc.switch(created.id).unwrap();
        assert_eq!(result.id, created.id);

        let pf = svc.load().unwrap();
        assert_eq!(pf.current_project_id, Some(created.id));

        // F13 backup of settings.json + .claude.json was taken.
        let claude_dir = svc.paths().home.join(".claude");
        let backups: Vec<String> = std::fs::read_dir(&claude_dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        assert!(
            backups.iter().any(|n| n.starts_with("settings.json.bak.")),
            "expected settings.json backup, got: {:?}",
            backups
        );
        assert!(
            backups.iter().any(|n| n.starts_with(".claude.json.bak.")),
            "expected .claude.json backup, got: {:?}",
            backups
        );
    }

    #[test]
    fn switch_to_unknown_id_errors() {
        let tmp = tempfile::TempDir::new().unwrap();
        let p = test_paths(&tmp);
        bootstrap(&p);
        let svc = ProjectService::new(p);
        let _ = svc.load().unwrap();
        let err = svc.switch(Uuid::new_v4()).unwrap_err();
        assert!(matches!(
            err,
            ProjectServiceError::Project(ProjectError::NotFound(_))
        ));
    }

    #[test]
    fn save_roundtrip_preserves_all_fields() {
        let tmp = tempfile::TempDir::new().unwrap();
        let p = test_paths(&tmp);
        bootstrap(&p);
        let proj = tmp.path().join("p");
        std::fs::create_dir_all(proj.join(".claude")).unwrap();
        let svc = ProjectService::new(p);

        let created = svc.add("P".into(), proj).unwrap();
        let pf = svc.load().unwrap();
        // Re-save and re-load — fields survive.
        svc.save(&pf).unwrap();
        let pf2 = svc.load().unwrap();
        assert_eq!(pf2.projects.len(), 2);
        assert!(pf2.projects.iter().any(|x| x.id == created.id));
    }

    // -----------------------------------------------------------------------
    // DTO (not strictly needed since ProjectsFile is Serialize + the
    // command returns it directly, but keeping the helper for future
    // flat shapes if M3.11+ wants one).
    // -----------------------------------------------------------------------

    #[allow(dead_code)]
    #[derive(Debug, Serialize, Deserialize)]
    pub struct ProjectSummary {
        pub id: Uuid,
        pub name: String,
        pub root_dir: PathBuf,
        pub is_system: bool,
    }

    #[allow(dead_code)]
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
}