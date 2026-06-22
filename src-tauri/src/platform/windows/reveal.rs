//! Windows implementation of [`IPlatformReveal`] — opens `explorer.exe
//! /select,<path>` to highlight a file in the file manager.
//!
//! We use `explorer /select,...` rather than `explorer <path>` because the
//! former opens the *parent* directory with the target file pre-selected,
//! which is what users expect when they click "Reveal in Explorer" on a
//! log file, backup, etc.
//!
//! ## M3.5 (清单 15)
//!
//! `explorer.exe` 的 exit code **不可信**(Microsoft 从未文档化,
//! 总是返回 0 或 1,且 1 在「path 不存在 / 无权限 / 网络路径」
//! 等多种失败下都会出现)。错误诊断必须靠**前置检测**:
//!
//! 1. 网络路径 (`\\server\share` / `//host`) → `NetworkPath`
//!    (explorer 在 UNC 上的行为不稳定,前端明确告知「不支持」)
//! 2. 路径不存在 (`fs::exists`) → `NotFound`
//! 3. spawn 失败 → `LauncherFailed { code: None, .. }`
//! 4. spawn 成功但 `!status.success()` → `LauncherFailed { code, .. }`
//!
//! 详见 `docs/investigations/m3.5-reveal-bug.md` §3。

use std::path::{Path, PathBuf};
use std::process::Command;

use crate::platform::traits::{IPlatformReveal, RevealError};

pub struct WindowsReveal;

impl IPlatformReveal for WindowsReveal {
    fn reveal_file(&self, path: &Path) -> Result<(), RevealError> {
        // 1) 网络路径预检:Windows UNC (`\\server\share\...`) 或
        //    POSIX 形式 (`//host/...`)。explorer.exe 在 UNC 上
        //    行为不可预测(open 父目录但不一定选中),前端按
        //    "不支持"路由更安全。
        let path_str = path.to_string_lossy();
        let is_network = path_str.starts_with(r"\\")
            || path_str.starts_with("//")
            || path_str.starts_with(r"\\?\UNC\");
        if is_network {
            return Err(RevealError::NetworkPath(path.to_path_buf()));
        }

        // 2) 存在性预检。`explorer /select,<missing>` 不会报错,
        //    只是静默打开「Documents」兜底目录 — 用户体验差,
        //    必须前置拦截。
        if !path.exists() {
            return Err(RevealError::NotFound(path.to_path_buf()));
        }

        // 3) spawn + 状态码。
        //
        // NOTE: explorer.exe takes the comma as a separator and the args
        // as a single string. The leading `/select,` is the trigger; we
        // pass the *whole* string as one arg so Windows parses it
        // correctly (Cargo's `Command` will quote it for us).
        let path_buf: PathBuf = path.to_path_buf();
        let status = Command::new("explorer.exe")
            .arg(format!("/select,{}", path.display()))
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

    /// M3.5 — 不存在的本地路径必须前置拦截为 `NotFound`,
    /// 而不是去 spawn explorer 让它静默 fallback 到「Documents」。
    #[test]
    fn windows_reveal_returns_not_found_for_nonexistent_local_path() {
        let r = WindowsReveal.reveal_file(Path::new(r"Z:\does\not\exist.xyz"));
        match r.unwrap_err() {
            RevealError::NotFound(p) => {
                assert_eq!(p, PathBuf::from(r"Z:\does\not\exist.xyz"));
            }
            other => panic!("expected NotFound, got {other:?}"),
        }
    }

    /// M3.5 — UNC 网络路径 (`\\server\share\...`) 必须
    /// 返回 `NetworkPath`,而不是 NotFound(因为
    /// `\\server\share` 在没联网上也「不存在」,会误判)。
    #[test]
    fn windows_reveal_returns_network_path_for_unc() {
        let r = WindowsReveal.reveal_file(Path::new(r"\\server\share\file.txt"));
        assert!(
            matches!(r.unwrap_err(), RevealError::NetworkPath(_)),
            "expected NetworkPath for UNC path"
        );
    }

    /// M3.5 — POSIX 形式 `//host/share/...` 也视为网络路径
    /// (Windows 上偶尔会出现 Rust std 规范化产物)。
    #[test]
    fn windows_reveal_returns_network_path_for_posix_double_slash() {
        let r = WindowsReveal.reveal_file(Path::new("//host/share/file.txt"));
        assert!(matches!(r.unwrap_err(), RevealError::NetworkPath(_)));
    }

    /// M3.5 — 合法的本地文件不应 panic,允许 spawn 失败
    /// (headless CI 没有 GUI),只验证「不 panic / 返回 Err」。
    #[test]
    fn windows_reveal_does_not_panic_on_existing_path() {
        let tmp = TempDir::new().expect("create tempdir");
        let f = tmp.path().join("sample.txt");
        fs::write(&f, b"hello").expect("write file");
        let _ = WindowsReveal.reveal_file(&f);
        // If we got here, we did not panic.
    }

    /// M3.5 — 合法的本地路径在 spawn 失败时返回 `LauncherFailed`,
    /// 不是 `PlatformError::Command`(后者已经被替换)。
    /// 这条测试在 GUI explorer 可用的开发机上不会触发
    /// (exit 0),在 headless CI 上会 spawn 失败 → `code: None`。
    #[test]
    fn windows_reveal_existing_path_returns_launcher_failed_or_ok() {
        let tmp = TempDir::new().expect("create tempdir");
        let f = tmp.path().join("exists.txt");
        fs::write(&f, b"x").expect("write file");
        let r = WindowsReveal.reveal_file(&f);
        match r {
            Ok(()) => { /* GUI available, explorer succeeded */ }
            Err(RevealError::LauncherFailed { code, path }) => {
                // headless CI 场景;code 可能是 None 或 Some(1)
                let _ = code;
                assert!(path.ends_with("exists.txt"));
            }
            Err(other) => panic!("expected Ok or LauncherFailed, got {other:?}"),
        }
    }
}