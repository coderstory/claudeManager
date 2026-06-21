//! macOS 实现 [`IGitHost`] —— 通过 [`std::process::Command`] 调系统 `git` CLI。
//!
//! 为什么跟 Windows 侧（`platform::windows::git::GitHostCli`）逻辑完全一致？
//! 因为 `git` 命令行在 Windows / macOS 上是同一个工具、同一套参数：
//! `git clone` / `git ls-remote` / `git rev-parse HEAD` 跨平台行为相同，
//! 没有任何 OS 专属差异。因此 `MacGitHost` 直接复用 Windows 侧的 CLI shim
//! 逻辑（按 M2.16 反事故要求：不抽共享实现、不改 Windows 侧、不改 traits）。
//!
//! 如果将来需要 macOS 专属行为（例如集成 keychain 凭证助手、处理
//! `osxkeychain` credential helper 的交互式提示），在本文件里扩展即可，
//! 不影响 Windows 侧。
//!
//! ## M3.4 — D6 暂缓说明
//!
//! M3.4 marketplace 重构新增 3 类 install (Builtin CLI / Npx / Git)。
//! macOS 侧的 `MacGitHost` **不需要改** —— `git clone` 跨平台行为一致,
//! `install_third_party_repo` 直接复用本 trait。
//!
//! Mac 真机验证按 D6 决策暂缓 (M3 启动门跟 D14 一起问),本文件**不**
//! 在 D-槽 2 范围动实现,只在本注释固化此说明,等 D6 启动时验证。

use std::path::Path;
use std::process::Command;

use crate::platform::traits::{IGitHost, PlatformError};

pub struct MacGitHost;

impl MacGitHost {
    /// 调 `git` 子命令并返回其 stdout/stderr/exit status。
    /// 失败（无法 spawn）统一映射成 `PlatformError::Command`。
    fn run(&self, args: &[&str]) -> Result<std::process::Output, PlatformError> {
        Command::new("git")
            .args(args)
            .output()
            .map_err(|e| PlatformError::Command {
                cmd: "git".into(),
                message: format!("failed to spawn git (is git installed?): {e}"),
            })
    }
}

impl IGitHost for MacGitHost {
    fn clone(&self, url: &str, dest: &Path, depth: u32) -> Result<(), PlatformError> {
        // 目标目录已存在时直接拒绝 —— 由调用方负责选一个空目录或先清理。
        if dest.exists() {
            return Err(PlatformError::Path(format!(
                "clone destination already exists: {}",
                dest.display()
            )));
        }

        let mut args: Vec<String> = vec!["clone".into()];
        if depth > 0 {
            args.push(format!("--depth={depth}"));
        }
        args.push(url.to_string());
        args.push(dest.display().to_string());

        let argv: Vec<&str> = args.iter().map(String::as_str).collect();
        let out = self.run(&argv)?;
        if !out.status.success() {
            return Err(PlatformError::Command {
                cmd: "git clone".into(),
                message: String::from_utf8_lossy(&out.stderr).into_owned(),
            });
        }
        Ok(())
    }

    fn ls_remote(&self, url: &str) -> Result<Vec<String>, PlatformError> {
        let out = self.run(&["ls-remote", "--heads", "--tags", url])?;
        if !out.status.success() {
            return Err(PlatformError::Command {
                cmd: "git ls-remote".into(),
                message: String::from_utf8_lossy(&out.stderr).into_owned(),
            });
        }
        // 每行格式 "<sha>\t<refname>"，这里只取 refname。
        let text = String::from_utf8_lossy(&out.stdout);
        let refs = text
            .lines()
            .filter_map(|line| line.split('\t').nth(1))
            .map(|s| s.to_string())
            .collect();
        Ok(refs)
    }

    fn current_head(&self, repo: &Path) -> Result<String, PlatformError> {
        if !repo.is_dir() {
            return Err(PlatformError::Path(format!(
                "not a git repo: {}",
                repo.display()
            )));
        }
        let out = self.run(&["-C", &repo.display().to_string(), "rev-parse", "HEAD"])?;
        if !out.status.success() {
            return Err(PlatformError::Command {
                cmd: "git rev-parse HEAD".into(),
                message: String::from_utf8_lossy(&out.stderr).into_owned(),
            });
        }
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    }
}
