//! macOS implementation of [`IPlatformReveal`] — 调用系统 `open -R <path>`
//! 让 Finder 选中目标文件/目录。
//!
//! 与 Windows 侧的 `explorer /select,<path>` 对应：
//! - Windows: `explorer.exe /select,C:\path\to\file` → 资源管理器打开父目录并选中文件
//! - macOS:   `open -R /path/to/file`                → Finder 打开父目录并选中文件
//!
//! 选 `open -R` 而不是 NSWorkspace / 第三方 crate：
//! - `open` 是 macOS 自带命令行，无额外依赖，符合 CLAUDE.md §3.2「业务代码只调接口、
//!   不直接调 OS API」的纪律（这里属于 platform 层的 OS 抽象实现，调系统 CLI 是允许的）
//! - 行为与 Windows 侧 `explorer /select` 完全对称：父目录 + 选中目标
//!
//! ## M3.5 (清单 15)
//!
//! 与 Windows 侧同构：拆 `RevealError` 4 variant,把
//! 网络路径 / 不存在 / spawn 失败 / exit 非 0 区分清楚。
//! 前置检测顺序：网络路径 → 存在性 → spawn → status.success()。

use std::path::{Path, PathBuf};
use std::process::Command;

use crate::platform::traits::{IPlatformReveal, RevealError};

pub struct MacReveal;

impl IPlatformReveal for MacReveal {
    fn reveal_file(&self, path: &Path) -> Result<(), RevealError> {
        // 1) 网络路径预检。`open -R` 在 SMB / NFS / AFP 挂载点上
        //    行为不可预测,前端按 "不支持" 路由,与 Windows 侧
        //    `NetworkPath` 行为对齐。
        let path_str = path.to_string_lossy();
        let is_network = path_str.starts_with("//")
            || path_str.starts_with("smb:")
            || path_str.starts_with("afp:")
            || path_str.starts_with("nfs:");
        if is_network {
            return Err(RevealError::NetworkPath(path.to_path_buf()));
        }

        // 2) 存在性预检：`open -R` 对不存在的路径会静默失败
        //    （Finder 不弹窗），提前拦截，与 WindowsReveal 行为一致。
        if !path.exists() {
            return Err(RevealError::NotFound(path.to_path_buf()));
        }

        // 3) spawn + 状态码。
        //
        // `open -R <path>`：`-R` 表示 reveal（在 Finder 中显示），
        // path 作为独立参数传入。
        let path_buf: PathBuf = path.to_path_buf();
        let status = Command::new("open")
            .arg("-R")
            .arg(path)
            .status()
            .map_err(|_| RevealError::LauncherFailed {
                code: None,
                path: path_buf.clone(),
            })?;

        if !status.success() {
            return Err(RevealError::LauncherFailed {
                code: status.code(),
                path: path_buf,
            });
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    /// M3.5 — 不存在的路径必须在调用 `open` 之前就被存在性检查
        /// 拦截,返回 `NotFound`(与 Windows 侧一致)。
    #[test]
    fn mac_reveal_returns_not_found_for_nonexistent_path() {
        let r = MacReveal.reveal_file(Path::new("/Z/does/not/exist.xyz"));
        match r.unwrap_err() {
            RevealError::NotFound(p) => {
                assert_eq!(p, PathBuf::from("/Z/does/not/exist.xyz"));
            }
            other => panic!("expected NotFound, got {other:?}"),
        }
    }

    /// M3.5 — SMB / AFP / NFS / `//host` 视为网络路径。
    #[test]
    fn mac_reveal_returns_network_path_for_smb() {
        let r = MacReveal.reveal_file(Path::new("smb://server/share/file.txt"));
        assert!(matches!(r.unwrap_err(), RevealError::NetworkPath(_)));
    }

    /// M3.5 — 在 Windows 开发机上 `open` 命令不存在 → spawn
    /// 返回 io::Error → 映射成 `LauncherFailed { code: None }`。
    /// 在 macOS 真机上则会真正唤起 Finder。两种情况下都不应 panic。
    #[test]
    fn mac_reveal_does_not_panic_on_existing_path() {
        let tmp = TempDir::new().expect("create tempdir");
        let f = tmp.path().join("sample.txt");
        fs::write(&f, b"hello").expect("write file");
        let _ = MacReveal.reveal_file(&f);
        // 走到这里说明没有 panic。
    }

    /// M3.5 — 已存在的合法路径返回 Ok 或 LauncherFailed,
    /// 绝不返回 NotFound / NetworkPath。
    #[test]
    fn mac_reveal_existing_path_returns_ok_or_launcher_failed() {
        let tmp = TempDir::new().expect("create tempdir");
        let f = tmp.path().join("exists.txt");
        fs::write(&f, b"x").expect("write file");
        let r = MacReveal.reveal_file(&f);
        match r {
            Ok(()) => {}
            Err(RevealError::LauncherFailed { .. }) => {}
            Err(other) => panic!("expected Ok or LauncherFailed, got {other:?}"),
        }
    }
}