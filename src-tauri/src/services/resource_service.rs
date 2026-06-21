//! ResourceService — F16 (资源浏览) business logic for M2.13.
//!
//! Thin façade in front of `infrastructure::resource_scanner` (read)
//! and `IPlatformReveal` (action). Holds a `claude_dir: PathBuf` and
//! the platform reveal trait object.
//!
//! ## Concurrency
//!
//! Stateless apart from the resolved paths + reveal trait. Tauri
//! commands hit `list` and `reveal` serially per IPC call; no
//! internal `Mutex` is needed.
//!
//! ## Error model
//!
//! `list` returns `Ok(Vec::ResourceItem>)` even on missing dirs
//! (cold-start). `reveal` returns `Err` if the OS shell fails (e.g.
//! explorer.exe missing). The Tauri command boundary stringifies
//! these to the frontend.

use std::path::{Path, PathBuf};

use thiserror::Error;

use crate::domain::{ResourceDetail, ResourceKind};
use crate::infrastructure::resource_detail;
use crate::infrastructure::resource_scanner::{self, ResourceScannerError};
use crate::platform::IPlatformReveal;

#[derive(Debug, Error)]
pub enum ResourceServiceError {
    #[error("scanner error: {0}")]
    Scanner(#[from] ResourceScannerError),
    #[error("reveal failed: {0}")]
    Reveal(String),
}

/// Business logic for F16 资源浏览.
pub struct ResourceService {
    claude_dir: PathBuf,
    reveal: Box<dyn IPlatformReveal>,
}

impl ResourceService {
    pub fn new(claude_dir: PathBuf, reveal: Box<dyn IPlatformReveal>) -> Self {
        Self { claude_dir, reveal }
    }

    /// Read-only access to the resolved claude dir (tests / debug).
    #[allow(dead_code)]
    pub fn claude_dir(&self) -> &Path {
        &self.claude_dir
    }

    /// List resources of the given kind. Missing subdirectories
    /// produce an empty Vec (cold-start case for first-time users).
    pub fn list(&self, kind: ResourceKind) -> Result<Vec<crate::domain::ResourceItem>, ResourceServiceError> {
        let items = resource_scanner::scan_resources(&self.claude_dir, kind)?;
        Ok(items)
    }

    /// F22 — 读取单个资源的详情(manifest 描述 + 文件列表)。
    ///
    /// 委托给 [`resource_detail::read_resource_detail`],后者是
    /// best-effort(不报错)。这里只做 path 合法性校验(空 / `..`
    /// 穿越),失败返回 `Err`。
    ///
    /// `path` 必须是 `list` 返回的 `ResourceItem.path`。前端不能
    /// 传任意路径(安全:与 F20 read_sql_file 同策略,拒绝 `..`)。
    pub fn detail(&self, path: &Path, kind: ResourceKind) -> Result<ResourceDetail, ResourceServiceError> {
        // 安全:拒绝 `..` 目录穿越(与 fs::resolve_claude_path 同策略)。
        if path
            .components()
            .any(|c| matches!(c, std::path::Component::ParentDir))
        {
            return Err(ResourceServiceError::Reveal(
                "路径含 '..',拒绝(安全策略)".into(),
            ));
        }
        Ok(resource_detail::read_resource_detail(path, kind))
    }

    /// Open the system file manager with `path` selected. Wraps
    /// `IPlatformReveal::reveal` and converts its `PlatformError` to
    /// our `ResourceServiceError`.
    pub fn reveal(&self, path: &Path) -> Result<(), ResourceServiceError> {
        self.reveal
            .reveal(path)
            .map_err(|e| ResourceServiceError::Reveal(e.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::ResourceItem;
    use crate::platform::traits::PlatformError;
    use std::fs;
    use tempfile::TempDir;

    fn make_claude_dir() -> TempDir {
        let tmp = TempDir::new().unwrap();
        fs::create_dir(tmp.path().join("commands")).unwrap();
        tmp
    }

    /// `list` delegates to the scanner. We seed the temp dir with
    /// a single .md file and assert it shows up.
    #[test]
    fn list_delegates_to_scanner() {
        let tmp = make_claude_dir();
        fs::write(tmp.path().join("commands").join("hi.md"), b"# hi").unwrap();

        // Use a no-op reveal — list() doesn't call reveal().
        let reveal = Box::new(NoopReveal);
        let svc = ResourceService::new(tmp.path().to_path_buf(), reveal);

        let items = svc.list(ResourceKind::Command).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].name, "hi.md");
        assert_eq!(items[0].kind, ResourceKind::Command);
    }

    /// `reveal` delegates to the platform reveal trait. The noop
    /// impl returns Ok(()) — assert the service propagates Ok.
    #[test]
    fn reveal_delegates_to_platform_reveal() {
        let tmp = make_claude_dir();
        let reveal = Box::new(RecordingReveal { calls: std::sync::Mutex::new(Vec::new()) });
        let svc = ResourceService::new(tmp.path().to_path_buf(), reveal);

        let target = tmp.path().join("commands").join("hi.md");
        fs::write(&target, b"# hi").unwrap();
        svc.reveal(&target).unwrap();
    }

    /// `reveal` propagates errors from the platform trait. A
    /// `PlatformError::Path("nope")` from the trait must surface
    /// as `ResourceServiceError::Reveal` with the message intact.
    #[test]
    fn reveal_error_propagates() {
        let tmp = make_claude_dir();
        let reveal = Box::new(FailingReveal);
        let svc = ResourceService::new(tmp.path().to_path_buf(), reveal);

        let target = tmp.path().join("anything.md");
        let err = svc.reveal(&target).unwrap_err();
        match err {
            ResourceServiceError::Reveal(msg) => {
                assert!(msg.contains("nope"), "got msg = {msg}");
            }
            other => panic!("expected Reveal error, got {other:?}"),
        }
    }

    /// Bonus: list() with no scanner subdir returns empty, not
    /// error. Catches regression where the service mistakenly
    /// bubbled ScannerError::Io for missing dirs.
    #[test]
    fn list_with_missing_subdir_returns_empty() {
        let tmp = TempDir::new().unwrap();
        // No commands/, plugins/, etc.
        let svc = ResourceService::new(tmp.path().to_path_buf(), Box::new(NoopReveal));
        let items = svc.list(ResourceKind::Plugin).unwrap();
        assert!(items.is_empty());
    }

    /// Bonus: the scanner round-trip produces an item that
    /// round-trips through serde without modification (proves
    /// domain/infrastructure boundary is clean).
    #[test]
    fn list_items_round_trip_through_serde() {
        let tmp = make_claude_dir();
        fs::write(tmp.path().join("commands").join("x.md"), b"x").unwrap();
        let svc = ResourceService::new(tmp.path().to_path_buf(), Box::new(NoopReveal));
        let items = svc.list(ResourceKind::Command).unwrap();
        let json = serde_json::to_string(&items[0]).unwrap();
        let back: ResourceItem = serde_json::from_str(&json).unwrap();
        assert_eq!(back, items[0]);
    }

    // ---- test fakes ----

    struct NoopReveal;
    impl IPlatformReveal for NoopReveal {
        fn reveal(&self, _path: &Path) -> Result<(), PlatformError> {
            Ok(())
        }
    }

    struct RecordingReveal {
        calls: std::sync::Mutex<Vec<PathBuf>>,
    }
    impl IPlatformReveal for RecordingReveal {
        fn reveal(&self, path: &Path) -> Result<(), PlatformError> {
            self.calls.lock().unwrap().push(path.to_path_buf());
            Ok(())
        }
    }

    struct FailingReveal;
    impl IPlatformReveal for FailingReveal {
        fn reveal(&self, _path: &Path) -> Result<(), PlatformError> {
            Err(PlatformError::Path("nope".into()))
        }
    }
}