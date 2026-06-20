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
//! 注意 `open -R` 的语义：
//! - path 是文件 → Finder 打开所在目录并选中该文件
//! - path 是目录 → Finder 直接打开该目录（不报错，与 Windows explorer 行为一致）
//! - path 不存在 → Finder 不打开任何窗口，用户无感知；故我们在调用前先做存在性检查，
//!   把「路径不存在」转成 `PlatformError::Path`，跟 WindowsReveal 行为一致

use std::path::Path;
use std::process::Command;

use crate::platform::traits::{IPlatformReveal, PlatformError};

pub struct MacReveal;

impl IPlatformReveal for MacReveal {
    fn reveal(&self, path: &Path) -> Result<(), PlatformError> {
        // 存在性检查：`open -R` 对不存在的路径会静默失败（Finder 不弹窗），
        // 我们提前拦截，返回明确错误，与 WindowsReveal 行为对齐。
        if !path.exists() {
            return Err(PlatformError::Path(format!(
                "cannot reveal: path does not exist: {}",
                path.display()
            )));
        }

        // `open -R <path>`：`-R` 表示 reveal（在 Finder 中显示），path 作为独立参数传入。
        // 与 Windows 的 `explorer /select,<path>`（逗号拼接成单参数）不同，`open` 把
        // path 当作独立 argv 元素，直接 `.arg(path)` 即可，Command 会负责 OsStr 转换。
        let status = Command::new("open")
            .arg("-R")
            .arg(path)
            .status()
            .map_err(|e| PlatformError::Command {
                cmd: "open".into(),
                message: e.to_string(),
            })?;

        if !status.success() {
            return Err(PlatformError::Command {
                cmd: "open".into(),
                message: format!("exit status: {status}"),
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

    #[test]
    fn mac_reveal_returns_err_for_nonexistent_path() {
        // 不存在的路径必须在调用 `open` 之前就被存在性检查拦截。
        let r = MacReveal.reveal(Path::new("/Z/does/not/exist.xyz"));
        assert!(r.is_err(), "must return Err for nonexistent path");
        match r.unwrap_err() {
            PlatformError::Path(_) => {}
            other => panic!("expected PlatformError::Path, got {other:?}"),
        }
    }

    #[test]
    fn mac_reveal_does_not_panic_on_existing_path() {
        // 在 Windows 开发机上 `open` 命令不存在 → spawn 返回 io::Error →
        // 映射成 `PlatformError::Command`，但不会 panic。在 macOS 真机上则会真正
        // 唤起 Finder。两种情况下测试都只验证「不 panic」，忽略返回值。
        let tmp = TempDir::new().expect("create tempdir");
        let f = tmp.path().join("sample.txt");
        fs::write(&f, b"hello").expect("write file");
        let _ = MacReveal.reveal(&f);
        // 走到这里说明没有 panic。
    }
}
