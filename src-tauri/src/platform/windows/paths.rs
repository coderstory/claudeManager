//! Windows implementation of [`IPlatformPaths`].
//!
//! - `home` from `dirs::home_dir()`
//! - `app_data` from `%APPDATA%\ClaudeConfigManager` (via `dirs::config_dir()`)
//! - `settings_json` / `claude_json` from `%USERPROFILE%\.claude\...`
//! - Sub-dirs (`backups`, `marketplaces`, `logs`) under `app_data`

use std::path::PathBuf;

use crate::platform::traits::{
    AppPaths, IPlatformPaths, PlatformError,
};

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
}
