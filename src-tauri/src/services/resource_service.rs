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
//! `list` returns `Ok(Vec<ResourceItem>)` even on missing dirs
//! (cold-start). `reveal` returns `Err` if the OS shell fails (e.g.
//! explorer.exe missing). The Tauri command boundary stringifies
//! these to the frontend.
//!
//! ### M3.5 — Reveal error category tag
//!
//! `reveal` now returns `ResourceServiceError::Reveal { kind, message, path }`
//! where `kind` is the stable IPC routing key (`"not_found"` /
//! `"permission_denied"` / `"network_path"` / `"launcher_failed"`).
//! Frontend `formatRevealError` switches on `kind` to render
//! localized text. We deliberately do NOT parse `Display` — Display
//! is for Rust-side logs.

use std::path::{Path, PathBuf};

use serde::Serialize;
use thiserror::Error;

use crate::domain::{ResourceDetail, ResourceKind};
use crate::infrastructure::resource_detail;
use crate::infrastructure::resource_scanner::{self, ResourceScannerError};
use crate::platform::{IPlatformReveal, RevealError};

#[derive(Debug, Error)]
pub enum ResourceServiceError {
    #[error("scanner error: {0}")]
    Scanner(#[from] ResourceScannerError),
    /// M3.5 — reveal 错误带结构化 category。前端按 `kind` 路由。
    #[error("reveal failed [{kind}]: {message}")]
    Reveal {
        kind: String,
        message: String,
        path: String,
    },
}

/// M3.5 — `ResourceServiceError::Reveal` 的 Tauri IPC 序列化形态。
///
/// `ResourceServiceError` 整体**不**派生 Serialize(避免
/// 泄漏内部类型 / 破坏 ABI);Tauri 命令 boundary 在
/// `commands::resource` 里手工把 `Reveal { .. }` 转成
/// `RevealFailure` 再返回给前端。
#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
pub struct RevealFailure {
    pub kind: String,
    pub message: String,
    pub path: String,
}

impl RevealFailure {
    pub fn from_reveal_error(e: &RevealError) -> Self {
        Self {
            kind: e.kind().to_string(),
            message: e.to_string(),
            path: e.path().to_string_lossy().into_owned(),
        }
    }
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
    ///
    /// Thin wrapper around [`Self::list_with_active_root`] that
    /// defaults to user-level mode (`active_root_dir = None`).
    /// Backward-compatible with M2.13 callers that hardcode the
    /// `~/.claude/` path baked at construction time.
    pub fn list(&self, kind: ResourceKind) -> Result<Vec<crate::domain::ResourceItem>, ResourceServiceError> {
        self.list_with_active_root(kind, None)
    }

    /// M3.12 (A1#11) — list with explicit `active_root_dir`.
    ///
    /// - `None` → scan the user-level `<claude_dir>/` (the one baked
    ///   into this service at construction time; M2.13 behavior).
    /// - `Some(root)` → scan `<root>/.claude/` (project mode).
    ///
    /// The `claude_dir` baked into the struct is only consulted when
    /// `active_root_dir = None`; in project mode the `root/.claude`
    /// path is resolved fresh on each call so a runtime project
    /// switch is picked up without restarting the service.
    pub fn list_with_active_root(
        &self,
        kind: ResourceKind,
        active_root_dir: Option<&Path>,
    ) -> Result<Vec<crate::domain::ResourceItem>, ResourceServiceError> {
        let scan_root = match active_root_dir {
            Some(root) => root.join(".claude"),
            None => self.claude_dir.clone(),
        };
        let items = resource_scanner::scan_resources(&scan_root, kind)?;
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
            return Err(ResourceServiceError::Reveal {
                kind: "permission_denied".to_string(),
                message: "路径含 '..',拒绝(安全策略)".into(),
                path: path.to_string_lossy().into_owned(),
            });
        }
        Ok(resource_detail::read_resource_detail(path, kind))
    }

    /// Open the system file manager with `path` selected.
    ///
    /// M3.5 — wraps [`IPlatformReveal::reveal_file`], converts its
    /// [`RevealError`] into a structured `ResourceServiceError::Reveal`
    /// carrying the category tag (`kind`), the OS message, and the
    /// path. Frontend `formatRevealError` switches on `kind` to
    /// render the localized banner.
    pub fn reveal(&self, path: &Path) -> Result<(), ResourceServiceError> {
        self.reveal.reveal_file(path).map_err(|e| {
            let failure = RevealFailure::from_reveal_error(&e);
            ResourceServiceError::Reveal {
                kind: failure.kind,
                message: failure.message,
                path: failure.path,
            }
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::ResourceItem;
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
    /// `RevealError::NotFound(p)` from the trait must surface as
    /// `ResourceServiceError::Reveal { kind: "not_found", .. }`
    /// with the path intact (M3.5 — frontend `formatRevealError`
    /// switches on `kind`).
    #[test]
    fn reveal_error_propagates_with_category_tag() {
        let tmp = make_claude_dir();
        let reveal = Box::new(FailingReveal {
            kind: RevealErrorKindForTest::NotFound,
        });
        let svc = ResourceService::new(tmp.path().to_path_buf(), reveal);

        let target = tmp.path().join("anything.md");
        let err = svc.reveal(&target).unwrap_err();
        match err {
            ResourceServiceError::Reveal { kind, message, path } => {
                assert_eq!(kind, "not_found");
                assert!(message.contains("nope"), "got msg = {message}");
                assert!(path.ends_with("anything.md"), "got path = {path}");
            }
            other => panic!("expected Reveal error, got {other:?}"),
        }
    }

    /// M3.5 — `RevealError::NetworkPath` 透传到 service 层
    /// 时 `kind` 必须是 `"network_path"`。
    #[test]
    fn reveal_network_path_kind_tag() {
        let tmp = make_claude_dir();
        let reveal = Box::new(FailingReveal {
            kind: RevealErrorKindForTest::NetworkPath,
        });
        let svc = ResourceService::new(tmp.path().to_path_buf(), reveal);
        let target = tmp.path().join("file.txt");
        let err = svc.reveal(&target).unwrap_err();
        match err {
            ResourceServiceError::Reveal { kind, .. } => {
                assert_eq!(kind, "network_path");
            }
            other => panic!("expected Reveal error, got {other:?}"),
        }
    }

    /// M3.5 — `RevealError::LauncherFailed` 透传时 `kind`
    /// 必须是 `"launcher_failed"`。
    #[test]
    fn reveal_launcher_failed_kind_tag() {
        let tmp = make_claude_dir();
        let reveal = Box::new(FailingReveal {
            kind: RevealErrorKindForTest::LauncherFailed,
        });
        let svc = ResourceService::new(tmp.path().to_path_buf(), reveal);
        let target = tmp.path().join("file.txt");
        let err = svc.reveal(&target).unwrap_err();
        match err {
            ResourceServiceError::Reveal { kind, .. } => {
                assert_eq!(kind, "launcher_failed");
            }
            other => panic!("expected Reveal error, got {other:?}"),
        }
    }

    /// M3.5 — `RevealFailure::from_reveal_error` 把 4 个 variant
    /// 都正确序列化成 `{ kind, message, path }` 三元组。
    #[test]
    fn reveal_failure_serializes_all_variants() {
        let p = PathBuf::from("/x/y.txt");
        let nf = RevealFailure::from_reveal_error(&RevealError::NotFound(p.clone()));
        assert_eq!(nf.kind, "not_found");
        assert_eq!(nf.path, "/x/y.txt");

        let lf = RevealFailure::from_reveal_error(&RevealError::LauncherFailed {
            code: Some(1),
            path: p.clone(),
        });
        assert_eq!(lf.kind, "launcher_failed");
        assert!(lf.message.contains("exit 1"));

        // JSON shape stability (frontend TypeScript 类型依赖)。
        let json = serde_json::to_value(&nf).unwrap();
        assert_eq!(json["kind"], "not_found");
        assert_eq!(json["path"], "/x/y.txt");
        assert!(json["message"].is_string());
    }

    /// M3.5 — `detail()` 拒绝 `..` 路径时也返回结构化
    /// `Reveal { kind: "permission_denied", .. }`(前端可路由)。
    #[test]
    fn detail_rejects_parent_traversal_with_category() {
        let tmp = make_claude_dir();
        let svc = ResourceService::new(tmp.path().to_path_buf(), Box::new(NoopReveal));
        let bad = Path::new("../escaped.txt");
        let err = svc.detail(bad, ResourceKind::Command).unwrap_err();
        match err {
            ResourceServiceError::Reveal { kind, .. } => {
                assert_eq!(kind, "permission_denied");
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

    // ---- M3.12 (A1#11) — F16 list_resources 接入 active_root_dir ----
    //
    // Read-only, 2 个场景:
    // - None  → 读 user-level ~/.claude/(即构造时 baked 的 claude_dir)
    // - Some(root) → 读 <root>/.claude/,**不**碰 user-level
    //
    // 用 2 个独立的 TempDir 各自建一份 commands/<file>.md,验证
    // active_root 路由正确,且 user 端不被 project 端污染。

    /// 1. `active_root_dir = None` → 读构造时 baked 的 user-level
    /// `claude_dir` (M2.13 向后兼容路径)。
    #[test]
    fn list_with_active_root_none_reads_user_dotclaude() {
        let user_dir = TempDir::new().unwrap();
        let user_claude = user_dir.path().join("user").join(".claude");
        fs::create_dir_all(user_claude.join("commands")).unwrap();
        fs::write(
            user_claude.join("commands").join("user-cmd.md"),
            b"# user command",
        )
        .unwrap();

        // 同时建一个 project .claude/ ,验证 None 路径**不**碰它。
        let project_root = user_dir.path().join("project");
        let project_claude = project_root.join(".claude");
        fs::create_dir_all(project_claude.join("commands")).unwrap();
        fs::write(
            project_claude.join("commands").join("project-cmd.md"),
            b"# project command",
        )
        .unwrap();

        let svc = ResourceService::new(user_claude, Box::new(NoopReveal));
        let items = svc
            .list_with_active_root(ResourceKind::Command, None)
            .unwrap();
        assert_eq!(items.len(), 1, "None 模式应只读 user-level, got: {:?}", items);
        assert_eq!(items[0].name, "user-cmd.md");
    }

    /// 2. `active_root_dir = Some(root)` → 读 `<root>/.claude/`,
    /// **不**碰构造时 baked 的 user-level claude_dir。
    #[test]
    fn list_with_active_root_some_reads_project_dotclaude() {
        let tmp = TempDir::new().unwrap();
        // user-level: 构造时 baked (含 user-cmd.md,应该**不**被读到)
        let user_claude = tmp.path().join("user").join(".claude");
        fs::create_dir_all(user_claude.join("commands")).unwrap();
        fs::write(
            user_claude.join("commands").join("user-cmd.md"),
            b"# user",
        )
        .unwrap();
        // project-level: 独立 root, 含 project-cmd.md (应该被读到)
        let project_root = tmp.path().join("project");
        let project_claude = project_root.join(".claude");
        fs::create_dir_all(project_claude.join("commands")).unwrap();
        fs::write(
            project_claude.join("commands").join("project-cmd.md"),
            b"# project",
        )
        .unwrap();

        let svc = ResourceService::new(user_claude, Box::new(NoopReveal));
        let items = svc
            .list_with_active_root(ResourceKind::Command, Some(&project_root))
            .unwrap();
        assert_eq!(items.len(), 1, "Some 模式应只读 project, got: {:?}", items);
        assert_eq!(items[0].name, "project-cmd.md");
    }

    // ---- test fakes ----

    struct NoopReveal;
    impl IPlatformReveal for NoopReveal {
        fn reveal_file(&self, _path: &Path) -> Result<(), RevealError> {
            Ok(())
        }
    }

    struct RecordingReveal {
        calls: std::sync::Mutex<Vec<PathBuf>>,
    }
    impl IPlatformReveal for RecordingReveal {
        fn reveal_file(&self, path: &Path) -> Result<(), RevealError> {
            self.calls.lock().unwrap().push(path.to_path_buf());
            Ok(())
        }
    }

    /// M3.5 — `FailingReveal` 现在可配置返回的 variant,这样能
    /// 覆盖 4 个 IPC category tag 的回归。
    #[derive(Clone, Copy)]
    enum RevealErrorKindForTest {
        NotFound,
        NetworkPath,
        LauncherFailed,
    }

    struct FailingReveal {
        kind: RevealErrorKindForTest,
    }
    impl IPlatformReveal for FailingReveal {
        fn reveal_file(&self, path: &Path) -> Result<(), RevealError> {
            let p = path.to_path_buf();
            match self.kind {
                RevealErrorKindForTest::NotFound => Err(RevealError::NotFound(p)),
                RevealErrorKindForTest::NetworkPath => Err(RevealError::NetworkPath(p)),
                RevealErrorKindForTest::LauncherFailed => Err(RevealError::LauncherFailed {
                    code: Some(1),
                    path: p,
                }),
            }
        }
    }
}