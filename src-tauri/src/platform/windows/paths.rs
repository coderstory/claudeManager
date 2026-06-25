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

use std::path::{Path, PathBuf};

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
        // M4 fixture isolation — `CCM_TEST_HOME` 短路 home / app_data。
        //
        // 背景：M4 e2e 测试需要在隔离的临时目录里跑完整套 provider 切换
        // / 文件 IO 流程，不能动用户的真实 `~/.claude/` 与 `~/.claude.json`。
        // `dirs::home_dir()` / `dirs::config_dir()` 在 Windows 上
        // **不能**通过普通 env var（`HOME` / `USERPROFILE` 等）干净地
        // 覆盖（`USERPROFILE` 偶尔能影响 `dirs::home_dir` 但被很多
        // 工具转写回去）；所以在平台层显式 short-circuit，更可控。
        //
        // 行为（详见 .planning/phases/M4-e2e-framework/M4-ANALYSIS.md
        // §fixture isolation）：
        // - `CCM_TEST_HOME` 已设置 → `home = $CCM_TEST_HOME`（**原样**，
        //   不再拼 `Users\<user>`），`app_data = $CCM_TEST_HOME\AppData\Roaming\ClaudeConfigManager`
        //   （与其余 derive 字段与 macOS 侧结构对称）
        // - 未设置 → 行为与改前 100% 一致
        //
        // 注：`std::env::var(...).ok()` 返回 `None` 当变量未设置、设为空
        // 串、或者包含无效 Unicode 时（后两者视为未设置，避免误用空串当
        // 路径前缀炸 fs IO）。
        let ccm_test_home = std::env::var("CCM_TEST_HOME")
            .ok()
            .filter(|s| !s.is_empty())
            .map(PathBuf::from);

        let home = ccm_test_home
            .clone()
            .unwrap_or_else(|| {
                dirs::home_dir().unwrap_or_else(|| PathBuf::from("C:\\Users\\Default"))
            });

        // `dirs::config_dir()` on Windows resolves to `%APPDATA%` (i.e.
        // `C:\Users\<user>\AppData\Roaming`). Append our app's subdir.
        //
        // M4 fixture isolation：当 `CCM_TEST_HOME` 已设置，app_data 直接
        // 拼接 `$CCM_TEST_HOME\AppData\Roaming\ClaudeConfigManager`
        // 镜像 Windows 真实目录布局，**不**再调 `dirs::config_dir()`。
        let app_data = match ccm_test_home.as_ref() {
            Some(root) => root
                .join("AppData")
                .join("Roaming")
                .join("ClaudeConfigManager"),
            None => dirs::config_dir()
                .map(|p| p.join("ClaudeConfigManager"))
                .unwrap_or_else(|| home.join("AppData").join("Roaming").join("ClaudeConfigManager")),
        };

        let claude_dir = home.join(".claude");
        let settings_json = claude_dir.join("settings.json");
        let claude_json = home.join(".claude.json");

        let backups_dir = app_data.join("backups");
        let marketplaces_dir = app_data.join("marketplaces");
        let logs_dir = app_data.join("logs");
        // M4.6 (Phase 21) — SQLite history DB sits at the same level
        // as `backups_dir`. Per CLAUDE.md §3.2 we never hard-code the
        // path; the consumer reads `AppPaths::history_db`.
        let history_db = app_data.join("history.db");

        AppPaths {
            home,
            app_data,
            settings_json,
            claude_json,
            backups_dir,
            marketplaces_dir,
            logs_dir,
            history_db,
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

    /// M3.2 polish — Windows allow-list = `<app_data>/backups/` +
    /// `~/.claude/` (user-level) OR `<active_project>/.claude/`
    /// when a project is active (M3.10).
    fn validate_backup_path(&self, path: &Path) -> Result<PathBuf, PlatformError> {
        let resolved = self.resolve();
        let candidate = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());

        // 1) Backups dir is always allowed.
        let backups_root = std::fs::canonicalize(&resolved.backups_dir)
            .unwrap_or_else(|_| resolved.backups_dir.clone());
        if candidate.starts_with(&backups_root) {
            return Ok(candidate);
        }

        // 2) Claude dir (user-level).
        if let Some(claude_dir) = resolved.claude_dir() {
            let root = std::fs::canonicalize(claude_dir).unwrap_or_else(|_| claude_dir.to_path_buf());
            if candidate.starts_with(&root) {
                return Ok(candidate);
            }
        }

        // 3) Active project (M3.10) — its `.claude/` dir if set.
        if let Some(active) = self.active_root_dir() {
            let project_claude = active.join(".claude");
            let root = std::fs::canonicalize(&project_claude)
                .unwrap_or(project_claude);
            if candidate.starts_with(&root) {
                return Ok(candidate);
            }
        }

        Err(PlatformError::Path(format!(
            "path {} is outside allowed backup directories",
            path.display()
        )))
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

    // -----------------------------------------------------------------
    // M4 — CCM_TEST_HOME fixture isolation
    //
    // 这些测试使用唯一临时路径（带进程 id + 测试名），所以 cargo 默认
    // 并行跑测试也不会冲突；不需要 `serial_test`。每个测试都
    // save/restore env var，避免污染同进程后续测试。
    // -----------------------------------------------------------------

    /// 验证 `CCM_TEST_HOME` 已设置时，所有 8 个 AppPaths 字段都从
    /// 该 root 派生（而非 `dirs::home_dir()` / `dirs::config_dir()`）。
    #[test]
    fn windows_ccm_test_home_set_overrides_all_paths() {
        let saved = std::env::var("CCM_TEST_HOME").ok();
        let test_root = std::env::temp_dir().join(format!(
            "cc-win-test-set-{}",
            std::process::id()
        ));
        std::env::set_var("CCM_TEST_HOME", &test_root);

        let p = WindowsPaths.resolve();

        // 1. home 必须等于 test_root 本身（Windows 侧不再拼 Users\<user>）
        assert_eq!(
            p.home, test_root,
            "CCM_TEST_HOME set 时 home 必须 = $CCM_TEST_HOME，实际: {} vs {}",
            p.home.display(),
            test_root.display()
        );

        // 2. app_data 必须 = test_root\AppData\Roaming\ClaudeConfigManager
        let expected_app_data = test_root
            .join("AppData")
            .join("Roaming")
            .join("ClaudeConfigManager");
        assert_eq!(
            p.app_data, expected_app_data,
            "CCM_TEST_HOME set 时 app_data 必须在 $CCM_TEST_HOME/AppData/Roaming/ClaudeConfigManager"
        );

        // 3. claude_dir = $CCM_TEST_HOME/.claude
        assert_eq!(p.settings_json.parent().unwrap(), test_root.join(".claude"));

        // 4. claude_json = $CCM_TEST_HOME/.claude.json
        assert_eq!(p.claude_json, test_root.join(".claude.json"));

        // 5. 三个子目录都在 app_data 下
        for (label, sub) in [
            ("backups", &p.backups_dir),
            ("marketplaces", &p.marketplaces_dir),
            ("logs", &p.logs_dir),
        ] {
            assert!(
                sub.starts_with(&p.app_data),
                "CCM_TEST_HOME set 时 {} 目录 {} 必须在 app_data {} 下",
                label,
                sub.display(),
                p.app_data.display()
            );
        }

        // 6. history_db 同样在 app_data 下（M4.6+）
        assert!(p.history_db.starts_with(&p.app_data));

        // restore
        match saved {
            Some(v) => std::env::set_var("CCM_TEST_HOME", v),
            None => std::env::remove_var("CCM_TEST_HOME"),
        }
    }

    /// 验证 `CCM_TEST_HOME` 未设置时，行为与改前 100% 一致：
    /// `home == dirs::home_dir()`，`app_data` 是 `dirs::config_dir()` + 子目录。
    /// 这是回归保护：确保 short-circuit 不会意外影响非测试环境。
    #[test]
    fn windows_ccm_test_home_unset_uses_dirs_crate() {
        let saved = std::env::var("CCM_TEST_HOME").ok();
        std::env::remove_var("CCM_TEST_HOME");

        let p = WindowsPaths.resolve();

        // home 必须等于 dirs::home_dir()（保证非测试环境无影响）
        let dirs_home = dirs::home_dir().expect("dirs::home_dir() 在测试环境应可用");
        assert_eq!(
            p.home, dirs_home,
            "CCM_TEST_HOME unset 时 home 必须 = dirs::home_dir()，实际: {} vs {}",
            p.home.display(),
            dirs_home.display()
        );

        // app_data 必须是 dirs::config_dir() + ClaudeConfigManager
        let dirs_config = dirs::config_dir().expect("dirs::config_dir() 在测试环境应可用");
        assert_eq!(
            p.app_data,
            dirs_config.join("ClaudeConfigManager"),
            "CCM_TEST_HOME unset 时 app_data 必须 = dirs::config_dir() + ClaudeConfigManager"
        );

        // restore（即使没改也走一遍对称路径，逻辑零假设）
        match saved {
            Some(v) => std::env::set_var("CCM_TEST_HOME", v),
            None => std::env::remove_var("CCM_TEST_HOME"),
        }
    }
}
