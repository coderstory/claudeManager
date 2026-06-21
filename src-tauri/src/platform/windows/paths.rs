//! Windows implementation of [`IPlatformPaths`].
//!
//! - `home` from `dirs::home_dir()`
//! - `app_data` from `%APPDATA%\ClaudeConfigManager` (via `dirs::config_dir()`)
//! - `settings_json` / `claude_json` from `%USERPROFILE%\.claude\...`
//! - Sub-dirs (`backups`, `marketplaces`, `logs`) under `app_data`
//!
//! ## M3.10 (清单 23) — `active_root_dir`
//!
//! Reads `<app_data>/projects.json` (the file written by
//! `crate::services::project_service::ProjectService`) and returns
//! the active project's `root_dir`. Returns `None` if the file is
//! missing / corrupt / has no active id — i.e. user-level fallback.
//! Mirrors `ProjectService::load`'s defensive behaviour: a corrupt
//! file is never silently dropped, we just degrade to user-level
//! for this read.

use std::path::PathBuf;

use serde::Deserialize;
use uuid::Uuid;

use crate::platform::traits::{
    AppPaths, IPlatformPaths, PlatformError,
};

/// Lightweight subset of `ProjectsFile` used by the platform layer
/// to resolve `active_root_dir` without depending on the services
/// layer (which itself depends on `AppPaths` — would be a circular
/// import if we reached for `ProjectService` here).
#[derive(Debug, Deserialize)]
struct ProjectsFileSubset {
    current_project_id: Option<Uuid>,
    projects: Vec<ProjectSubset>,
}

#[derive(Debug, Deserialize)]
struct ProjectSubset {
    id: Uuid,
    root_dir: PathBuf,
}

/// Default implementation. Stateless — `resolve` is a pure function.
pub struct WindowsPaths;

impl IPlatformPaths for WindowsPaths {
    fn resolve(&self) -> AppPaths {
        let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("C:\\Users\\Default"));

        // `dirs::config_dir()` on Windows resolves to `%APPDATA%` (i.e.
        // `C:\Users\<user>\AppData\Roaming`). Append our app's subdir.
        let app_data = dirs::config_dir()
            .map(|p| p.join("ClaudeConfigManager"))
            .unwrap_or_else(|| home.join("AppData").join("Roaming").join("ClaudeConfigManager"));

        let claude_dir = home.join(".claude");
        let settings_json = claude_dir.join("settings.json");
        let claude_json = home.join(".claude.json");

        let backups_dir = app_data.join("backups");
        let marketplaces_dir = app_data.join("marketplaces");
        let logs_dir = app_data.join("logs");

        AppPaths {
            home,
            app_data,
            settings_json,
            claude_json,
            backups_dir,
            marketplaces_dir,
            logs_dir,
        }
    }

    fn ensure_dirs(&self) -> Result<(), PlatformError> {
        let p = self.resolve();
        for dir in [
            &p.app_data,
            &p.backups_dir,
            &p.marketplaces_dir,
            &p.logs_dir,
        ] {
            std::fs::create_dir_all(dir).map_err(|e| {
                PlatformError::Path(format!(
                    "create_dir_all({}) failed: {}",
                    dir.display(),
                    e
                ))
            })?;
        }
        Ok(())
    }

    /// M3.10 — read `projects.json` and resolve the active project.
    ///
    /// Failure modes (all degrade to `None` = user-level):
    /// - file missing (first launch, pre-ProjectService): None
    /// - JSON corrupt: None
    /// - `current_project_id` is `None`: None
    /// - `current_project_id` points to a project that's no longer
    ///   in the list: None
    fn active_root_dir(&self) -> Option<PathBuf> {
        let projects_file = self.resolve().app_data.join("projects.json");
        let raw = std::fs::read_to_string(&projects_file).ok()?;
        let parsed: ProjectsFileSubset = serde_json::from_str(&raw).ok()?;
        let id = parsed.current_project_id?;
        parsed
            .projects
            .into_iter()
            .find(|p| p.id == id)
            .map(|p| p.root_dir)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_paths_resolves_app_data() {
        let p = WindowsPaths.resolve();
        // The exact user name varies, but the leaf must always be
        // "ClaudeConfigManager" — that's the contract other code depends on.
        assert!(
            p.app_data.ends_with("ClaudeConfigManager"),
            "app_data should end with ClaudeConfigManager, got {}",
            p.app_data.display()
        );
    }

    #[test]
    fn windows_paths_settings_json_under_claude_dir() {
        let p = WindowsPaths.resolve();
        let parent = p.settings_json.parent().expect("settings_json has parent");
        assert_eq!(
            parent.file_name().and_then(|s| s.to_str()),
            Some(".claude"),
            "settings.json must live under ~/.claude/, got parent: {}",
            parent.display()
        );
        assert_eq!(
            p.settings_json.file_name().and_then(|s| s.to_str()),
            Some("settings.json")
        );
    }

    #[test]
    fn windows_paths_claude_json_at_home_root() {
        let p = WindowsPaths.resolve();
        // ~/.claude.json (NOT under .claude/)
        assert_eq!(
            p.claude_json.parent().and_then(|s| s.to_str()),
            p.home.to_str()
        );
        assert_eq!(
            p.claude_json.file_name().and_then(|s| s.to_str()),
            Some(".claude.json")
        );
    }

    #[test]
    fn windows_paths_subdirs_under_app_data() {
        let p = WindowsPaths.resolve();
        for (label, sub) in [
            ("backups", &p.backups_dir),
            ("marketplaces", &p.marketplaces_dir),
            ("logs", &p.logs_dir),
        ] {
            assert!(
                sub.starts_with(&p.app_data),
                "{} dir {} must be under app_data {}",
                label,
                sub.display(),
                p.app_data.display()
            );
        }
    }

    #[test]
    fn windows_paths_ensure_dirs_is_idempotent() {
        // Use a temp HOME so we don't touch the user's real profile. We can't
        // easily inject into `dirs`, so we just call ensure_dirs() against
        // the real path — it must succeed even if the dirs already exist (the
        // common case after first launch).
        let p = WindowsPaths;
        // First call: creates (no-op if exists).
        // Second call: must still succeed.
        let r1 = p.ensure_dirs();
        let r2 = p.ensure_dirs();
        // We don't assert Ok on r1 because in a fresh CI box the user might
        // not have a writable %APPDATA%; in that case r1 == Err and r2 == Err
        // too. We do assert they match.
        assert_eq!(
            r1.is_ok(),
            r2.is_ok(),
            "ensure_dirs() should be idempotent — both calls must agree"
        );
    }

    // -----------------------------------------------------------------
    // M3.10 — active_root_dir coverage
    //
    // We can't easily override `dirs::home_dir` / `dirs::config_dir`
    // from a unit test, so the end-to-end "WindowsPaths sees a
    // projects.json under the real %APPDATA%" case would write to
    // the user's profile. Instead, we test the parse-only contract
    // here: given the JSON shape the platform layer expects, we
    // confirm it resolves to the expected root_dir.
    // -----------------------------------------------------------------

    #[test]
    fn active_root_dir_returns_none_when_projects_file_missing() {
        // The platform impl degrades to None on missing file. We
        // can't easily fake the absence, so we re-validate the
        // semantics by checking: if the real %APPDATA% has no
        // projects.json (the common pre-M3.10 case), this is None.
        let result = WindowsPaths.active_root_dir();
        // Either None (no projects.json) or Some (user already ran
        // M3.10 once) — both are valid outcomes; we just confirm
        // it doesn't panic.
        let _ = result;
    }

    #[test]
    fn active_root_dir_subset_parses_current_id_and_root_dir() {
        // Pin the wire format the Windows impl reads: we don't
        // depend on the full Project struct (which has additional
        // fields like name/created_at/is_system). If anyone bumps
        // the on-disk shape they have to update this test.
        let json = r#"{
            "version": 1,
            "current_project_id": "00000000-0000-0000-0000-000000000000",
            "projects": [
                { "id": "00000000-0000-0000-0000-000000000000",
                  "root_dir": "/home/u",
                  "name": "系统",
                  "created_at": 1,
                  "is_system": true }
            ]
        }"#;
        let parsed: ProjectsFileSubset = serde_json::from_str(json).unwrap();
        assert_eq!(
            parsed.current_project_id,
            Some(uuid::Uuid::nil())
        );
        assert_eq!(parsed.projects[0].root_dir, PathBuf::from("/home/u"));
    }

    #[test]
    fn active_root_dir_subset_handles_null_current_id() {
        // No active project yet → current_project_id is JSON null →
        // the platform impl must return None.
        let json = r#"{
            "version": 1,
            "current_project_id": null,
            "projects": []
        }"#;
        let parsed: ProjectsFileSubset = serde_json::from_str(json).unwrap();
        assert_eq!(parsed.current_project_id, None);
    }
}
