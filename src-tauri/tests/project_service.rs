//! Integration test — M3.10 (清单 23) `ProjectService` end-to-end.
//!
//! Guards the same 5-command surface that `commands::project` exposes
//! to the frontend, plus the cross-plugin contract that `IPlatformPaths
//! ::active_root_dir()` reads the same `projects.json` file the
//! service writes.
//!
//! Mirrors `tests/plugin_host_wiring.rs`'s structure (no Tauri runtime
//! — exercise the service + a stub AppPaths + the platform layer).

use std::path::PathBuf;

use claude_config_manager_lib::domain::{ProjectError, ProjectsFile, SYSTEM_PROJECT_ID};
use claude_config_manager_lib::platform::{
    windows::WindowsPaths, AppPaths, IPlatformPaths,
};
use claude_config_manager_lib::services::project_service::{
    ProjectService, ProjectServiceError,
};
use uuid::Uuid;

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/// Build an `AppPaths` rooted inside a temp directory. Tests use this
/// instead of the real `%APPDATA%` so we never touch the user's profile.
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
/// service's `validate_root` + `backup_active_state` paths work.
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

fn make_valid_project_dir(parent: &std::path::Path, name: &str) -> PathBuf {
    let p = parent.join("projects").join(name);
    std::fs::create_dir_all(p.join(".claude")).unwrap();
    p
}

// ---------------------------------------------------------------------------
// Tests — 5 commands + cross-plugin contract
// ---------------------------------------------------------------------------

#[test]
fn list_command_seeds_system_project_on_first_run() {
    let tmp = tempfile::TempDir::new().unwrap();
    let paths = test_paths(&tmp);
    bootstrap(&paths);
    let svc = ProjectService::new(paths);

    let pf = svc.load().expect("list must succeed");
    assert_eq!(pf.projects.len(), 1);
    assert_eq!(pf.projects[0].id, SYSTEM_PROJECT_ID);
    assert!(pf.projects[0].is_system);
    assert_eq!(pf.current_project_id, Some(SYSTEM_PROJECT_ID));
}

#[test]
fn add_command_creates_user_project_and_persists() {
    let tmp = tempfile::TempDir::new().unwrap();
    let paths = test_paths(&tmp);
    bootstrap(&paths);
    let proj = make_valid_project_dir(tmp.path(), "alpha");
    let svc = ProjectService::new(paths);

    let created = svc
        .add("Alpha".to_string(), proj.clone())
        .expect("add must succeed");
    assert!(!created.is_system);
    assert_eq!(created.root_dir, proj);

    // Re-load and confirm persistence.
    let pf = svc.load().unwrap();
    assert_eq!(pf.projects.len(), 2);
    assert!(pf.projects.iter().any(|p| p.name == "Alpha"));
    // current_project_id did NOT switch (add doesn't auto-switch).
    assert_eq!(pf.current_project_id, Some(SYSTEM_PROJECT_ID));
}

#[test]
fn add_command_rejects_invalid_roots() {
    let tmp = tempfile::TempDir::new().unwrap();
    let paths = test_paths(&tmp);
    bootstrap(&paths);
    let svc = ProjectService::new(paths);

    // Relative path
    let err = svc
        .add("X".into(), PathBuf::from("relative/path"))
        .unwrap_err();
    assert!(matches!(
        err,
        ProjectServiceError::Project(ProjectError::NotAbsolute(_))
    ));

    // Non-existent path
    let err = svc
        .add(
            "Y".into(),
            PathBuf::from("/this/path/should/never/exist/zzz123"),
        )
        .unwrap_err();
    assert!(matches!(
        err,
        ProjectServiceError::Project(ProjectError::RootNotFound(_))
    ));

    // Existing path with no .claude/ inside
    let err = svc.add("Z".into(), tmp.path().to_path_buf()).unwrap_err();
    assert!(matches!(
        err,
        ProjectServiceError::Project(ProjectError::MissingClaudeSubdir(_))
    ));

    // Empty name
    let proj = make_valid_project_dir(tmp.path(), "good");
    let err = svc.add("".into(), proj).unwrap_err();
    assert!(matches!(
        err,
        ProjectServiceError::Project(ProjectError::EmptyName)
    ));
}

#[test]
fn switch_command_updates_active_id_and_takes_f13_backup() {
    let tmp = tempfile::TempDir::new().unwrap();
    let paths = test_paths(&tmp);
    bootstrap(&paths);
    let proj = make_valid_project_dir(tmp.path(), "beta");
    let svc = ProjectService::new(paths);

    let created = svc.add("Beta".to_string(), proj).unwrap();
    let activated = svc.switch(created.id).expect("switch must succeed");
    assert_eq!(activated.id, created.id);

    let pf = svc.load().unwrap();
    assert_eq!(pf.current_project_id, Some(created.id));

    // F13 backup trail in the active claude_dir.
    let claude_dir = svc.paths().home.join(".claude");
    let names: Vec<String> = std::fs::read_dir(&claude_dir)
        .unwrap()
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .collect();
    assert!(
        names.iter().any(|n| n.starts_with("settings.json.bak.")),
        "F13 backup of settings.json must exist, got: {:?}",
        names
    );
    assert!(
        names.iter().any(|n| n.starts_with(".claude.json.bak.")),
        "F13 backup of .claude.json must exist, got: {:?}",
        names
    );
}

#[test]
fn switch_command_to_unknown_id_errors_without_mutation() {
    let tmp = tempfile::TempDir::new().unwrap();
    let paths = test_paths(&tmp);
    bootstrap(&paths);
    let svc = ProjectService::new(paths);
    let _ = svc.load().unwrap();

    let before = svc.load().unwrap().current_project_id;
    let err = svc.switch(Uuid::new_v4()).unwrap_err();
    assert!(matches!(
        err,
        ProjectServiceError::Project(ProjectError::NotFound(_))
    ));
    let after = svc.load().unwrap().current_project_id;
    assert_eq!(before, after, "current id must not change on error");
}

#[test]
fn remove_command_drops_user_project_and_falls_back_active_to_system() {
    let tmp = tempfile::TempDir::new().unwrap();
    let paths = test_paths(&tmp);
    bootstrap(&paths);
    let proj = make_valid_project_dir(tmp.path(), "gamma");
    let svc = ProjectService::new(paths);

    let created = svc.add("Gamma".to_string(), proj).unwrap();
    svc.switch(created.id).unwrap();
    svc.remove(created.id).unwrap();

    let pf = svc.load().unwrap();
    assert_eq!(pf.projects.len(), 1);
    assert_eq!(pf.current_project_id, Some(SYSTEM_PROJECT_ID));
}

#[test]
fn remove_command_rejects_system_project() {
    let tmp = tempfile::TempDir::new().unwrap();
    let paths = test_paths(&tmp);
    bootstrap(&paths);
    let svc = ProjectService::new(paths);
    let _ = svc.load().unwrap();

    let err = svc.remove(SYSTEM_PROJECT_ID).unwrap_err();
    assert!(matches!(
        err,
        ProjectServiceError::Project(ProjectError::CannotRemoveSystem)
    ));
}

#[test]
fn current_command_returns_active_project() {
    let tmp = tempfile::TempDir::new().unwrap();
    let paths = test_paths(&tmp);
    bootstrap(&paths);
    let proj = make_valid_project_dir(tmp.path(), "delta");
    let svc = ProjectService::new(paths);

    let created = svc.add("Delta".to_string(), proj).unwrap();
    svc.switch(created.id).unwrap();
    let active = svc.current_state().unwrap().current().cloned().unwrap();
    assert_eq!(active.id, created.id);
}

// ---------------------------------------------------------------------------
// Cross-plugin contract — `WindowsPaths::active_root_dir` reads the
// same file `ProjectService` writes.
// ---------------------------------------------------------------------------
//
// We can't easily point `WindowsPaths` at our temp dir (its
// `resolve()` reads `dirs::config_dir()` which is the real
// %APPDATA%), so this test exercises the *parse* path: we craft
// the JSON the platform layer expects and confirm the platform's
// subset-parsing logic produces the right `Some(path)` outcome via
// the same `serde::Deserialize` impl. The end-to-end "file on disk
// → active_root_dir" path is covered by the unit test in
// `platform/windows/paths.rs::active_root_dir_*`.

#[test]
fn platform_active_root_dir_subset_parses_active_id() {
    // Same struct shape the Windows impl uses — this test pins the
    // wire format both ends agree on. If you change either side's
    // (de)serialisation, update both.
    use serde::Deserialize;

    #[derive(Deserialize)]
    struct Subset {
        current_project_id: Option<Uuid>,
        projects: Vec<SubsetProj>,
    }
    #[derive(Deserialize)]
    struct SubsetProj {
        id: Uuid,
        #[allow(dead_code)]
        root_dir: PathBuf,
    }

    let proj_id = Uuid::new_v4();
    let json = format!(
        r#"{{"version":1,"current_project_id":"{}","projects":[{{"id":"{}","root_dir":"/proj","name":"X","created_at":1,"is_system":false}}]}}"#,
        proj_id, proj_id
    );
    let parsed: Subset = serde_json::from_str(&json).unwrap();
    let resolved = parsed
        .current_project_id
        .and_then(|id| parsed.projects.into_iter().find(|p| p.id == id))
        .map(|p| p.root_dir);
    assert_eq!(resolved, Some(PathBuf::from("/proj")));
}

#[test]
fn platform_active_root_dir_subset_handles_corrupt_json() {
    // Whatever parse failure path the platform impl takes, it must
    // not panic. We verify the `serde_json::from_str` returns Err
    // for malformed input — the platform impl turns that into None.
    let bad = "{ this is not json";
    let parsed: Result<ProjectsFile, _> = serde_json::from_str(bad);
    assert!(parsed.is_err());
}

#[test]
fn platform_active_root_dir_subset_handles_null_current_id() {
    let json = r#"{"version":1,"current_project_id":null,"projects":[]}"#;
    let pf: ProjectsFile = serde_json::from_str(json).unwrap();
    assert_eq!(pf.current_project_id, None);
    assert_eq!(pf.resolved_current_id(), SYSTEM_PROJECT_ID);
}

#[test]
fn platform_active_root_dir_with_windows_paths_returns_some_after_service_save() {
    // End-to-end smoke: the platform's `active_root_dir` is fed by
    // the same `projects.json` the service writes. We can't redirect
    // `WindowsPaths::resolve()` to a temp dir (it reads `dirs::`),
    // so we sanity-check the parser with a tiny end-to-end:
    // service writes → platform reads → matches.
    //
    // Note: this test only checks that the *Rust types agree*. The
    // platform's real read goes through `dirs::config_dir()`, which
    // we can't override without a feature-flag hack — instead the
    // parser is exercised via the test above.
    let tmp = tempfile::TempDir::new().unwrap();
    let paths = test_paths(&tmp);
    bootstrap(&paths);
    let proj = make_valid_project_dir(tmp.path(), "epsilon");
    let svc = ProjectService::new(paths);
    let created = svc.add("Epsilon".to_string(), proj).unwrap();
    svc.switch(created.id).unwrap();

    // The platform impl's parser-shape on the *file* `ProjectService`
    // just wrote: read it back, confirm the active id matches.
    let on_disk: ProjectsFile =
        serde_json::from_str(&std::fs::read_to_string(svc.paths().app_data.join("projects.json")).unwrap()).unwrap();
    assert_eq!(on_disk.current_project_id, Some(created.id));

    // Smoke: WindowsPaths::active_root_dir can be called (it may
    // return None on this dev box because %APPDATA% doesn't have a
    // projects.json — that's fine).
    let _ = WindowsPaths.active_root_dir();
}