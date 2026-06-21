//! MarketplaceService — F17 (在线安装) 业务逻辑 (M2.16).
//!
//! 把内置推荐仓库列表 + 第三方 git URL 两路来源,统一走「clone → 扫描 →
//! 安装」三步流水线:
//!
//! - [`list_builtin_repos`] —— 返回硬编码常量(用户后期可改)。M2 阶段
//!   不联网拉真实列表,避免网络抖动阻塞 UI。
//! - [`clone_and_scan`] —— 调 [`IGitHost::clone`] shallow clone 到
//!   `<app_data>/marketplaces/<slug>/`,再复用 [`resource_scanner`] 扫描
//!   5 种 kind(plugin/skill/command/lsp/mcp),合并成一张资源清单。
//! - [`install_resource`] —— 把扫描到的资源从 clone 缓存目录 copy 到
//!   `~/.claude/<subdir>/`。MCP 因需 merge 进 mcp.json(复杂且易错),
//!   诚实返回 `installed: false` + 提示,不静默吞错(CLAUDE.md §7)。
//!
//! ## 路径安全
//!
//! clone 目标目录必须落在 `marketplaces_dir` 的直接子目录,slug 含 `..`
//! 或绝对路径会被 [`slug_from_url`] / `repo_dest` 双重校验拦截。install
//! 目标固定在 `claude_dir` 的 5 个白名单子目录之一,源路径来自重新扫描
//! 的 ResourceItem(不是前端直接传 path),杜绝路径穿越。
//!
//! ## 并发
//!
//! 无内部 Mutex。Tauri 命令串行派发;两次并发 clone 同一 URL 第二次会
//! 先删 dest 再 clone,幂等。
//!
//! ## 为什么不缓存扫描结果
//!
//! clone 缓存目录是临时的(用户可删),且扫描是本地 `read_dir`(毫秒级)。
//! 每次 `install_resource` 重新扫描 repo 找目标资源,避免缓存漂移。

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::domain::{ResourceItem, ResourceKind};
use crate::infrastructure::resource_scanner;
use crate::platform::IGitHost;

// ---------------------------------------------------------------------------
// DTO —— wire 类型(snake_case,跟 ResourceItem 一致,TS 镜像同形)
// ---------------------------------------------------------------------------

/// 内置推荐仓库条目。`id` 稳定,前端 React key 用。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MarketplaceRepo {
    pub id: String,
    pub name: String,
    pub url: String,
    pub description: String,
}

/// clone + 扫描的返回。`repo_path` 是 clone 落地的绝对路径,前端
/// install 时原样回传(避免前端自己拼路径)。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanResult {
    pub repo_path: String,
    pub resources: Vec<ResourceItem>,
}

/// install 结果。`installed: false` 表示该 kind 暂不支持自动安装(如
/// mcp),`message` 给用户看具体原因(SPEC §6.5 不允许静默吞错)。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstallResult {
    pub resource_id: String,
    pub installed: bool,
    pub dest_path: String,
    pub message: String,
}

// ---------------------------------------------------------------------------
// 内置推荐仓库(硬编码占位,用户后期可改)
// ---------------------------------------------------------------------------

/// M2 阶段内置推荐列表。不联网 —— 真实市场索引留 M3。
///
/// 3 个占位:
/// 1. Claude Code 官方 plugins(社区精选)
/// 2. cc-switch 推荐仓库(本项目姊妹项目)
/// 3. 用户自定义占位(提示用户可加自己的仓库)
pub fn builtin_repos() -> Vec<MarketplaceRepo> {
    vec![
        MarketplaceRepo {
            id: "claude-code-plugins".into(),
            name: "Claude Code Plugins".into(),
            url: "https://github.com/anthropics/claude-code-plugins.git".into(),
            description: "Claude Code 官方插件仓库(占位,实际 URL 以官方公告为准)".into(),
        },
        MarketplaceRepo {
            id: "cc-switch-registry".into(),
            name: "CC Switch Registry".into(),
            url: "https://github.com/cc-switch/registry.git".into(),
            description: "cc-switch 推荐仓库:plugin / skill / command 合集(占位)".into(),
        },
        MarketplaceRepo {
            id: "community-awesome".into(),
            name: "Community Awesome".into(),
            url: "https://github.com/community/awesome-claude.git".into(),
            description: "社区精选资源(占位,用户可替换为自己的仓库 URL)".into(),
        },
    ]
}

// ---------------------------------------------------------------------------
// 错误
// ---------------------------------------------------------------------------

#[derive(Debug, Error)]
pub enum MarketplaceError {
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    /// git CLI 失败(网络 / 认证 / 无效 URL)。
    #[error("git error: {0}")]
    Git(String),
    /// resource_id 解析失败或扫描后找不到匹配资源。
    #[error("invalid resource id: {0}")]
    InvalidResourceId(String),
    /// install 目标已存在,拒绝覆盖用户数据。
    #[error("目标已存在,请先删除: {0}")]
    DestExists(PathBuf),
    /// slug / 路径穿越攻击防护。
    #[error("path unsafe: {0}")]
    PathUnsafe(String),
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/// F17 在线安装 service。
pub struct MarketplaceService {
    /// `<app_data>/marketplaces/` —— clone 缓存根目录。
    marketplaces_dir: PathBuf,
    /// `~/.claude/` —— install 目标根。
    claude_dir: PathBuf,
    /// git CLI shim(Windows: GitHostCli / macOS: MacGitHost)。
    git: Box<dyn IGitHost>,
}

impl MarketplaceService {
    pub fn new(
        marketplaces_dir: PathBuf,
        claude_dir: PathBuf,
        git: Box<dyn IGitHost>,
    ) -> Self {
        Self {
            marketplaces_dir,
            claude_dir,
            git,
        }
    }

    /// 内置推荐仓库列表(常量,无 I/O)。
    pub fn list_builtin_repos(&self) -> Vec<MarketplaceRepo> {
        builtin_repos()
    }

    /// clone `url` 到 `<marketplaces_dir>/<slug>/` 并扫描 5 种 kind。
    ///
    /// dest 已存在时先删除(缓存性质,幂等)。
    pub fn clone_and_scan(&self, url: &str) -> Result<ScanResult, MarketplaceError> {
        let dest = self.repo_dest(url)?;
        // 缓存目录已存在 → 删除重建(shallow clone 不支持增量,且这是
        // 临时缓存不是用户数据)。
        if dest.exists() {
            std::fs::remove_dir_all(&dest)?;
        }
        // shallow clone(depth=1)—— 只取最新提交,省带宽。
        self.git
            .clone(url, &dest, 1)
            .map_err(|e| MarketplaceError::Git(e.to_string()))?;

        // 扫描 5 种 kind 合并。clone 下来的 repo 目录结构跟 ~/.claude/
        // 一致(plugins/ skills/ commands/ lsp/ mcp.json),所以直接把
        // repo 路径当 claude_dir 扫。复用 F16 的 scanner,不修改它。
        let mut resources = Vec::new();
        for kind in [
            ResourceKind::Plugin,
            ResourceKind::Skill,
            ResourceKind::Command,
            ResourceKind::Lsp,
            ResourceKind::Mcp,
        ] {
            // scanner 对缺失子目录返回 Ok(vec![]),不报错。
            let items = resource_scanner::scan_resources(&dest, kind)
                .map_err(|e| MarketplaceError::Io(std::io::Error::other(e.to_string())))?;
            resources.extend(items);
        }
        // 按 kind + name 稳定排序,方便 UI 展示。
        resources.sort_by(|a, b| {
            a.kind
                .as_str()
                .cmp(b.kind.as_str())
                .then_with(|| a.name.cmp(&b.name))
        });

        Ok(ScanResult {
            repo_path: dest.to_string_lossy().into_owned(),
            resources,
        })
    }

    /// 把 `repo_path` 下 `resource_id` 对应的资源 copy 到 `~/.claude/`。
    ///
    /// 重新扫描 repo 找源路径(不信任前端传 path,防穿越)。dest 已存在
    /// → 报错,不覆盖用户数据。
    pub fn install_resource(
        &self,
        repo_path: &str,
        resource_id: &str,
    ) -> Result<InstallResult, MarketplaceError> {
        // 解析 resource_id → "<kind_tag>/<name>"。
        let (kind_tag, name) = resource_id
            .split_once('/')
            .ok_or_else(|| {
                MarketplaceError::InvalidResourceId(resource_id.to_string())
            })?;
        let kind = ResourceKind::from_str_opt(kind_tag).ok_or_else(|| {
            MarketplaceError::InvalidResourceId(resource_id.to_string())
        })?;

        // 重新扫描 repo 找源路径。repo_path 来自 clone_and_scan 的返回,
        // 但这里仍校验它必须存在(防前端传过期路径)。
        let repo = Path::new(repo_path);
        if !repo.is_dir() {
            return Err(MarketplaceError::InvalidResourceId(format!(
                "仓库目录不存在: {repo_path}"
            )));
        }
        let items = resource_scanner::scan_resources(repo, kind)
            .map_err(|e| MarketplaceError::Io(std::io::Error::other(e.to_string())))?;
        let src = items
            .iter()
            .find(|i| i.id == resource_id)
            .map(|i| PathBuf::from(&i.path))
            .ok_or_else(|| {
                MarketplaceError::InvalidResourceId(resource_id.to_string())
            })?;

        // mcp 需 merge 进 mcp.json,复杂且易错,诚实标注不支持自动安装。
        if matches!(kind, ResourceKind::Mcp) {
            return Ok(InstallResult {
                resource_id: resource_id.to_string(),
                installed: false,
                dest_path: String::new(),
                message: "MCP 服务器需手动编辑 ~/.claude/mcp.json,暂不支持自动安装".into(),
            });
        }

        // install 目标子目录(白名单 4 种)。
        let sub = kind_subdir(kind);
        let dest_dir = self.claude_dir.join(sub);
        std::fs::create_dir_all(&dest_dir)?;
        let dest = dest_dir.join(&name);
        if dest.exists() {
            return Err(MarketplaceError::DestExists(dest));
        }

        // 源可能是目录(plugin / skill-dir)或文件(skill / command / lsp)。
        if src.is_dir() {
            copy_dir_recursive(&src, &dest)?;
        } else {
            std::fs::copy(&src, &dest)?;
        }

        Ok(InstallResult {
            resource_id: resource_id.to_string(),
            installed: true,
            dest_path: dest.to_string_lossy().into_owned(),
            message: "安装成功".into(),
        })
    }

    /// clone 目标路径 = `marketplaces_dir/<slug>/`,校验 slug 不穿越。
    fn repo_dest(&self, url: &str) -> Result<PathBuf, MarketplaceError> {
        let slug = slug_from_url(url)?;
        let dest = self.marketplaces_dir.join(&slug);
        // path safety:dest 必须是 marketplaces_dir 的直接子目录。
        let parent = dest.parent().ok_or_else(|| {
            MarketplaceError::PathUnsafe(format!("无法解析 dest 父目录: {}", dest.display()))
        })?;
        if parent != self.marketplaces_dir {
            return Err(MarketplaceError::PathUnsafe(format!(
                "slug 跳出 marketplaces_dir: {slug}"
            )));
        }
        Ok(dest)
    }
}

// ---------------------------------------------------------------------------
// 纯函数 helpers
// ---------------------------------------------------------------------------

/// 从 git URL 提取 slug(仓库目录名)。
///
/// - `https://github.com/foo/bar.git` → `bar`
/// - `https://github.com/foo/bar` → `bar`
/// - `git@github.com:foo/bar.git` → `bar`
/// - `file:///tmp/my-repo` → `my-repo`
///
/// slug 必须非空、不含路径分隔符 / `..`,否则 `PathUnsafe`。
pub fn slug_from_url(url: &str) -> Result<String, MarketplaceError> {
    // 去末尾空白 + 末尾 `/`。
    let trimmed = url.trim().trim_end_matches('/');
    // 去末尾 `.git`。
    let no_git = trimmed.trim_end_matches(".git");
    // 取最后一个 `/` 或 `:` 之后的部分(SCP 风格用 `:`)。
    let last = no_git
        .rsplit(|c| c == '/' || c == ':')
        .next()
        .unwrap_or("");
    if last.is_empty() {
        return Err(MarketplaceError::PathUnsafe(format!(
            "无法从 URL 提取 slug: {url}"
        )));
    }
    // 防 `..` / 路径分隔符 / 空字符(虽然 rsplit 后不应有,但双重校验)。
    if last.contains('/') || last.contains('\\') || last == ".." || last == "." {
        return Err(MarketplaceError::PathUnsafe(format!(
            "slug 非法: {last}"
        )));
    }
    Ok(last.to_string())
}

/// kind → ~/.claude/ 子目录名(plugin/skill/command/lsp)。mcp 不走
/// install(已在调用方拦截)。
fn kind_subdir(kind: ResourceKind) -> &'static str {
    match kind {
        ResourceKind::Plugin => "plugins",
        ResourceKind::Skill => "skills",
        ResourceKind::Command => "commands",
        ResourceKind::Lsp => "lsp",
        ResourceKind::Mcp => "mcp.json",
    }
}

/// 递归 copy 目录。std::fs 没有 copy_dir,这里自己实现(只用于 install
/// 缓存目录 → 用户目录,源是 clone 下来的受信文件)。
fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), std::io::Error> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        if src_path.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            std::fs::copy(&src_path, &dst_path)?;
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::platform::traits::{IGitHost, PlatformError};
    use std::fs;
    use std::sync::Mutex;
    use tempfile::TempDir;

    // ---- 测试 fakes ----

    /// 记录 clone 调用 + 把预置的 repo 目录 copy 到 dest(模拟 git clone
    /// 把文件落到 dest)。
    struct FakeGitHost {
        /// clone 时 copy 这个目录的内容到 dest(模拟 clone 落地)。
        fake_repo_src: PathBuf,
        /// 记录 clone 调用参数(url, dest)。
        clone_calls: Mutex<Vec<(String, PathBuf)>>,
    }

    impl FakeGitHost {
        fn new(fake_repo_src: PathBuf) -> Self {
            Self {
                fake_repo_src,
                clone_calls: Mutex::new(Vec::new()),
            }
        }
    }

    impl IGitHost for FakeGitHost {
        fn clone(
            &self,
            url: &str,
            dest: &Path,
            _depth: u32,
        ) -> Result<(), PlatformError> {
            self.clone_calls
                .lock()
                .unwrap()
                .push((url.to_string(), dest.to_path_buf()));
            // 模拟 git clone:把 fake_repo_src 的内容复制到 dest。
            copy_dir_recursive(&self.fake_repo_src, dest).map_err(|e| {
                PlatformError::Command {
                    cmd: "fake-git-clone".into(),
                    message: e.to_string(),
                }
            })
        }
        fn ls_remote(&self, _url: &str) -> Result<Vec<String>, PlatformError> {
            Ok(vec!["refs/heads/main".into()])
        }
        fn current_head(&self, _repo: &Path) -> Result<String, PlatformError> {
            Ok("a".repeat(40))
        }
    }

    /// 构造一个 fake repo 目录结构(跟 ~/.claude/ 一致)。
    fn make_fake_repo() -> TempDir {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        // plugin 目录
        let p = root.join("plugins").join("code-review");
        fs::create_dir_all(&p).unwrap();
        fs::write(p.join("index.md"), b"# code-review plugin").unwrap();
        // command 文件
        fs::create_dir_all(root.join("commands")).unwrap();
        fs::write(root.join("commands").join("deploy.md"), b"# deploy").unwrap();
        // lsp 文件
        fs::create_dir_all(root.join("lsp")).unwrap();
        fs::write(root.join("lsp").join("rust.json"), b"{}").unwrap();
        tmp
    }

    fn make_service(
        marketplaces_dir: PathBuf,
        claude_dir: PathBuf,
        fake_repo_src: PathBuf,
    ) -> MarketplaceService {
        MarketplaceService::new(
            marketplaces_dir,
            claude_dir,
            Box::new(FakeGitHost::new(fake_repo_src)),
        )
    }

    // ---- list_builtin_repos ----

    #[test]
    fn list_builtin_repos_returns_nonempty() {
        let tmp = TempDir::new().unwrap();
        let svc = make_service(
            tmp.path().join("mk"),
            tmp.path().join("claude"),
            tmp.path().join("fake"),
        );
        let repos = svc.list_builtin_repos();
        assert!(!repos.is_empty(), "内置推荐列表不应为空");
        // 每个条目都有 id/name/url/description。
        for r in &repos {
            assert!(!r.id.is_empty());
            assert!(!r.name.is_empty());
            assert!(!r.url.is_empty());
            assert!(!r.description.is_empty());
        }
    }

    #[test]
    fn builtin_repos_has_at_least_two() {
        // 任务要求 2-3 个占位。
        let repos = builtin_repos();
        assert!(repos.len() >= 2, "至少 2 个占位仓库");
        assert!(repos.len() <= 4, "占位不宜超过 4 个");
    }

    // ---- slug_from_url ----

    #[test]
    fn slug_from_url_https_with_git() {
        assert_eq!(
            slug_from_url("https://github.com/foo/bar.git").unwrap(),
            "bar"
        );
    }

    #[test]
    fn slug_from_url_https_without_git() {
        assert_eq!(
            slug_from_url("https://github.com/foo/bar").unwrap(),
            "bar"
        );
    }

    #[test]
    fn slug_from_url_scp_style() {
        assert_eq!(
            slug_from_url("git@github.com:foo/bar.git").unwrap(),
            "bar"
        );
    }

    #[test]
    fn slug_from_url_rejects_empty() {
        assert!(slug_from_url("").is_err());
        assert!(slug_from_url("https://github.com/").is_err());
    }

    #[test]
    fn slug_from_url_rejects_traversal() {
        // rsplit 后 ".." 会被拦截。
        assert!(slug_from_url("https://github.com/foo/..").is_err());
    }

    // ---- clone_and_scan ----

    #[test]
    fn clone_and_scan_returns_resources() {
        let fake_repo = make_fake_repo();
        let tmp = TempDir::new().unwrap();
        let svc = make_service(
            tmp.path().join("mk"),
            tmp.path().join("claude"),
            fake_repo.path().to_path_buf(),
        );

        let result = svc
            .clone_and_scan("https://github.com/foo/bar.git")
            .expect("clone_and_scan");
        // repo_path 落在 marketplaces_dir/bar。
        assert!(result.repo_path.ends_with("bar"));
        // 至少扫到 plugin + command + lsp。
        assert!(result.resources.len() >= 3, "扫到的资源: {:?}", result.resources);
        assert!(result.resources.iter().any(|r| r.name == "code-review"));
        assert!(result.resources.iter().any(|r| r.name == "deploy.md"));
    }

    #[test]
    fn clone_and_scan_dest_exists_is_recreated() {
        let fake_repo = make_fake_repo();
        let tmp = TempDir::new().unwrap();
        let mk_dir = tmp.path().join("mk");
        fs::create_dir_all(&mk_dir).unwrap();
        // 预先放一个 stale 缓存目录。
        let stale = mk_dir.join("bar");
        fs::create_dir_all(&stale).unwrap();
        fs::write(stale.join("stale.txt"), b"old").unwrap();

        let svc = make_service(
            mk_dir,
            tmp.path().join("claude"),
            fake_repo.path().to_path_buf(),
        );

        let result = svc.clone_and_scan("https://github.com/foo/bar.git").unwrap();
        // stale.txt 应被删除(目录被重建)。
        assert!(!result.repo_path.ends_with("stale.txt"));
        assert!(!PathBuf::from(&result.repo_path).join("stale.txt").exists());
        // 新内容落地。
        assert!(PathBuf::from(&result.repo_path).join("commands").exists());
    }

    #[test]
    fn clone_and_scan_git_failure_propagates() {
        // FakeGitHost 的 fake_repo_src 不存在 → copy_dir_recursive 失败
        // → clone 返回 Err → service 包装成 Git error。
        let tmp = TempDir::new().unwrap();
        let svc = make_service(
            tmp.path().join("mk"),
            tmp.path().join("claude"),
            tmp.path().join("nonexistent-fake-repo"),
        );

        let err = svc
            .clone_and_scan("https://github.com/foo/bar.git")
            .unwrap_err();
        assert!(matches!(err, MarketplaceError::Git(_)), "got {err:?}");
    }

    // ---- install_resource ----

    #[test]
    fn install_plugin_copies_to_claude_dir() {
        let fake_repo = make_fake_repo();
        let tmp = TempDir::new().unwrap();
        let claude_dir = tmp.path().join("claude");
        let svc = make_service(
            tmp.path().join("mk"),
            claude_dir.clone(),
            fake_repo.path().to_path_buf(),
        );

        // 先 clone 拿 repo_path。
        let scan = svc
            .clone_and_scan("https://github.com/foo/bar.git")
            .unwrap();
        let result = svc
            .install_resource(&scan.repo_path, "plugin/code-review")
            .expect("install");

        assert!(result.installed);
        assert!(result.dest_path.contains("plugins"));
        assert!(result.dest_path.contains("code-review"));
        // 文件确实落地。
        let dest_file = claude_dir.join("plugins").join("code-review").join("index.md");
        assert!(dest_file.exists(), "dest file should exist: {}", dest_file.display());
        assert_eq!(fs::read_to_string(&dest_file).unwrap(), "# code-review plugin");
    }

    #[test]
    fn install_command_copies_file() {
        let fake_repo = make_fake_repo();
        let tmp = TempDir::new().unwrap();
        let claude_dir = tmp.path().join("claude");
        let svc = make_service(
            tmp.path().join("mk"),
            claude_dir.clone(),
            fake_repo.path().to_path_buf(),
        );

        let scan = svc.clone_and_scan("https://github.com/foo/bar.git").unwrap();
        let result = svc
            .install_resource(&scan.repo_path, "command/deploy.md")
            .unwrap();

        assert!(result.installed);
        let dest_file = claude_dir.join("commands").join("deploy.md");
        assert!(dest_file.exists());
    }

    #[test]
    fn install_mcp_returns_not_installed_with_message() {
        let fake_repo = make_fake_repo();
        let tmp = TempDir::new().unwrap();
        let svc = make_service(
            tmp.path().join("mk"),
            tmp.path().join("claude"),
            fake_repo.path().to_path_buf(),
        );

        // 加一个 mcp.json 条目。
        fs::write(
            fake_repo.path().join("mcp.json"),
            r#"{"mcpServers":{"fs":{"command":"npx"}}}"#,
        )
        .unwrap();

        let scan = svc.clone_and_scan("https://github.com/foo/bar.git").unwrap();
        let result = svc
            .install_resource(&scan.repo_path, "mcp/fs")
            .unwrap();

        assert!(!result.installed);
        assert!(result.message.contains("mcp.json"), "message: {}", result.message);
    }

    #[test]
    fn install_dest_exists_rejects() {
        let fake_repo = make_fake_repo();
        let tmp = TempDir::new().unwrap();
        let claude_dir = tmp.path().join("claude");
        // 预置目标已存在。
        fs::create_dir_all(claude_dir.join("plugins").join("code-review")).unwrap();
        let svc = make_service(
            tmp.path().join("mk"),
            claude_dir,
            fake_repo.path().to_path_buf(),
        );

        let scan = svc.clone_and_scan("https://github.com/foo/bar.git").unwrap();
        let err = svc
            .install_resource(&scan.repo_path, "plugin/code-review")
            .unwrap_err();
        assert!(matches!(err, MarketplaceError::DestExists(_)), "got {err:?}");
    }

    #[test]
    fn install_unknown_resource_id_errors() {
        let fake_repo = make_fake_repo();
        let tmp = TempDir::new().unwrap();
        let svc = make_service(
            tmp.path().join("mk"),
            tmp.path().join("claude"),
            fake_repo.path().to_path_buf(),
        );

        let scan = svc.clone_and_scan("https://github.com/foo/bar.git").unwrap();
        let err = svc
            .install_resource(&scan.repo_path, "plugin/nonexistent")
            .unwrap_err();
        assert!(matches!(err, MarketplaceError::InvalidResourceId(_)), "got {err:?}");
    }

    #[test]
    fn install_malformed_resource_id_errors() {
        let fake_repo = make_fake_repo();
        let tmp = TempDir::new().unwrap();
        let svc = make_service(
            tmp.path().join("mk"),
            tmp.path().join("claude"),
            fake_repo.path().to_path_buf(),
        );

        let scan = svc.clone_and_scan("https://github.com/foo/bar.git").unwrap();
        // 没有 `/` 分隔。
        let err = svc
            .install_resource(&scan.repo_path, "bogus")
            .unwrap_err();
        assert!(matches!(err, MarketplaceError::InvalidResourceId(_)));
    }

    #[test]
    fn install_unknown_kind_tag_errors() {
        let fake_repo = make_fake_repo();
        let tmp = TempDir::new().unwrap();
        let svc = make_service(
            tmp.path().join("mk"),
            tmp.path().join("claude"),
            fake_repo.path().to_path_buf(),
        );

        let scan = svc.clone_and_scan("https://github.com/foo/bar.git").unwrap();
        let err = svc
            .install_resource(&scan.repo_path, "robots/foo")
            .unwrap_err();
        assert!(matches!(err, MarketplaceError::InvalidResourceId(_)));
    }

    // ---- path safety ----

    #[test]
    fn repo_dest_rejects_traversal_slug() {
        // slug_from_url 已拦 "..",但 repo_dest 二次校验 parent。
        let tmp = TempDir::new().unwrap();
        let svc = make_service(
            tmp.path().join("mk"),
            tmp.path().join("claude"),
            tmp.path().join("fake"),
        );
        // "https://github.com/foo/.." → slug ".." → slug_from_url 拦截。
        let err = svc.clone_and_scan("https://github.com/foo/..").unwrap_err();
        assert!(matches!(err, MarketplaceError::PathUnsafe(_)), "got {err:?}");
    }
}
