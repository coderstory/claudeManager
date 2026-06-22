//! macOS implementation of [`IPlatformPaths`].
//!
//! 路径基（参考 CLAUDE.md §3.2 IPlatformPaths 说明：macOS 用
//! `~/Library/Application Support`）：
//! - `home`           — `dirs::home_dir()`（即 `~`）
//! - `app_data`       — `~/Library/Application Support/ClaudeConfigManager/`
//!                      （`dirs::config_dir()` 在 macOS 解析到此目录）
//! - `settings_json`  — `~/.claude/settings.json`（Claude Code 自身配置）
//! - `claude_json`    — `~/.claude.json`（Claude Code 自身 MCP 配置）
//! - `backups_dir`    — `<app_data>/backups/`
//! - `marketplaces_dir` — `<app_data>/marketplaces/`
//! - `logs_dir`       — `<app_data>/logs/`
//!
//! 字段语义与 [`crate::platform::windows::WindowsPaths`] 完全对齐——
//! 业务代码只依赖 [`AppPaths`] 的字段名，不关心底层是 Windows 还是
//! macOS。`~/.claude/` 与 `~/.claude.json` 的位置在两个平台上一致，
//! 这样用户在 Win/Mac 间迁移 Claude Code 配置时无需改路径。
//!
//! 实现只用跨平台 `dirs` + `std::fs`，不引入 NSFileManager 等 macOS
//! 专属 API——路径只是字符串拼接 + `create_dir_all`，无需系统框架。

use std::path::{Path, PathBuf};

use crate::platform::traits::{AppPaths, IPlatformPaths, PlatformError};

/// macOS 路径解析器。无状态——`resolve` 是纯函数。
pub struct MacPaths;

impl IPlatformPaths for MacPaths {
    fn resolve(&self) -> AppPaths {
        // home_dir 在 macOS 几乎不会失败；极端情况（沙盒异常 / 环境变量
        // 缺失）下回退到 `/Users/Shared`（macOS 系统级共享用户目录，始终
        // 存在），与 WindowsPaths 回退到 `C:\Users\Default` 的意图一致。
        let home = dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("/Users/Shared"));

        // `dirs::config_dir()` 在 macOS 解析为 `~/Library/Application
        // Support`（符合 CLAUDE.md §3.2 与 Apple File System 标准布局）。
        // 拼上本应用子目录。回退路径手动重建同一结构，保证 fallback 与
        // 主路径语义一致。
        let app_data = dirs::config_dir()
            .map(|p| p.join("ClaudeConfigManager"))
            .unwrap_or_else(|| {
                home.join("Library")
                    .join("Application Support")
                    .join("ClaudeConfigManager")
            });

        // Claude Code 自身配置目录与文件——与 Windows 侧保持一致，
        // 均位于 `~/.claude/` 与 `~/.claude.json`。
        let claude_dir = home.join(".claude");
        let settings_json = claude_dir.join("settings.json");
        let claude_json = home.join(".claude.json");

        // 应用自有的子目录全部位于 app_data 下，与 WindowsPaths 对齐。
        let backups_dir = app_data.join("backups");
        let marketplaces_dir = app_data.join("marketplaces");
        let logs_dir = app_data.join("logs");
        // M4.6 (Phase 21) — SQLite history DB lives next to backups_dir
        // (mirrors WindowsPaths). See `infrastructure::sqlite::history_db`.
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
        // 与 WindowsPaths::ensure_dirs 结构一致：创建 app_data 及其下属
        // 三个子目录。create_dir_all 幂等，目录已存在时直接返回 Ok。
        // 不创建 `~/.claude/`——那是 Claude Code 自己的目录，由 Claude
        // Code 负责创建；本应用只读写其中的文件，不接管目录生命周期。
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

    /// M3.10 — macOS compile-only stub.
    ///
    /// Per D6 (M3 启动门决策),mac 真机验证暂缓。本方法始终返回
    /// `None` —— macOS 用户永远在"用户级"模式下,直到 M4 backlog
    /// 重新评估 Mac 真机验证时机。
    ///
    /// 后续 Mac 真机实现需要:
    ///   1. 读 `<app_data>/projects.json`(同 Windows 路径解析)
    ///   2. 查 `current_project_id` 对应 project 的 `root_dir`
    ///   3. 返回 `Some(root_dir)` 或 `None`(用户级)
    ///
    /// 当前直接依赖 trait 的默认实现(None)即可 —— 这里显式 override
    /// 是为了在 macOS 编译时锁住"必须返回 None"的契约,防止未来
    /// 不小心改成读默认实现(虽然默认实现也是 None,语义一致)。
    #[allow(dead_code)]
    fn active_root_dir(&self) -> Option<std::path::PathBuf> {
        None
    }

    /// M3.2 polish — macOS allow-list mirrors Windows: backups_dir
    /// + claude_dir (D6: Mac 真机验证暂缓,active_root_dir 永远
    /// None,所以不会有 project-mode 分支)。
    fn validate_backup_path(&self, path: &Path) -> Result<PathBuf, PlatformError> {
        let resolved = self.resolve();
        let candidate = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());

        let backups_root = std::fs::canonicalize(&resolved.backups_dir)
            .unwrap_or_else(|_| resolved.backups_dir.clone());
        if candidate.starts_with(&backups_root) {
            return Ok(candidate);
        }

        if let Some(claude_dir) = resolved.claude_dir() {
            let claude_dir_buf = claude_dir.to_path_buf();
            let root = std::fs::canonicalize(claude_dir)
                .unwrap_or_else(|_| claude_dir_buf.clone());
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

    /// 确认 `MacPaths` 可作为 `dyn IPlatformPaths` trait object 使用
    /// （trait object 安全性契约）。该测试在 Windows dev box 上也会跑，
    /// 因为 `MacPaths` 的实现只用跨平台 `dirs` + `std::fs`，不依赖
    /// macOS 专属 API。
    #[test]
    fn mac_paths_is_object_safe() {
        let p: Box<dyn IPlatformPaths> = Box::new(MacPaths);
        let _ = p;
    }

    /// 确认 `resolve()` 返回真实现而非 `unimplemented!()`。在 Windows
    /// dev box 上 `dirs::config_dir()` 返回 `%APPDATA%`，叶子目录名
    /// 仍是 `ClaudeConfigManager`——与 WindowsPaths 的契约一致。
    #[test]
    fn mac_paths_resolve_does_not_panic() {
        let p = MacPaths.resolve();
        assert!(
            p.app_data.ends_with("ClaudeConfigManager"),
            "app_data 应以 ClaudeConfigManager 结尾，实际：{}",
            p.app_data.display()
        );
    }

    /// `settings.json` 必须位于 `~/.claude/` 下，与 Windows 侧一致。
    #[test]
    fn mac_paths_settings_json_under_claude_dir() {
        let p = MacPaths.resolve();
        let parent = p.settings_json.parent().expect("settings_json 有父目录");
        assert_eq!(
            parent.file_name().and_then(|s| s.to_str()),
            Some(".claude"),
            "settings.json 必须位于 ~/.claude/ 下，实际父目录：{}",
            parent.display()
        );
        assert_eq!(
            p.settings_json.file_name().and_then(|s| s.to_str()),
            Some("settings.json")
        );
    }

    /// `~/.claude.json` 必须直接位于 home 下（不在 .claude/ 内）。
    #[test]
    fn mac_paths_claude_json_at_home_root() {
        let p = MacPaths.resolve();
        assert_eq!(
            p.claude_json.parent().and_then(|s| s.to_str()),
            p.home.to_str()
        );
        assert_eq!(
            p.claude_json.file_name().and_then(|s| s.to_str()),
            Some(".claude.json")
        );
    }

    /// 三个子目录必须位于 app_data 下。
    #[test]
    fn mac_paths_subdirs_under_app_data() {
        let p = MacPaths.resolve();
        for (label, sub) in [
            ("backups", &p.backups_dir),
            ("marketplaces", &p.marketplaces_dir),
            ("logs", &p.logs_dir),
        ] {
            assert!(
                sub.starts_with(&p.app_data),
                "{} 目录 {} 必须位于 app_data {} 下",
                label,
                sub.display(),
                p.app_data.display()
            );
        }
    }

    /// `ensure_dirs()` 必须幂等——两次调用结果一致。
    #[test]
    fn mac_paths_ensure_dirs_is_idempotent() {
        let p = MacPaths;
        let r1 = p.ensure_dirs();
        let r2 = p.ensure_dirs();
        // 不强制 assert Ok：在某些受限环境（只读 home / 沙盒）下两次都会
        // 报错；只要求两次结果一致（幂等性契约）。
        assert_eq!(
            r1.is_ok(),
            r2.is_ok(),
            "ensure_dirs() 必须幂等——两次调用结果应一致"
        );
    }

    /// M3.10 — D6 决策:macOS 暂不实装 active_root_dir 真机读取，
    /// 永远返回 None（用户级）。
    #[test]
    fn mac_paths_active_root_dir_is_always_none() {
        assert_eq!(MacPaths.active_root_dir(), None);
    }
}
