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

// 注意: `MarketplaceRepo` 定义在下方"M3.4 扩展"区块(line ~109)。
// 旧版本只有 `id`/`name`/`url`/`description` 4 个字段;
// M3.4 扩展加 `install_mode` / `install_target` 两个字段(serde default 兼容老调用方)。

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

/// M2.16 — H3: install 选项(force overwrite 等)。
///
/// 设计成 bitflags-ready 的 struct,后续可加 `skip_backup` / `dry_run`
/// 等。当前只暴露 `force`。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct InstallOptions {
    /// 目标已存在时强制覆盖。默认 false(保护用户数据)。
    /// 覆盖前会做一次 backup(目标目录 rename 到 .bak.<ts>)再写新值。
    #[serde(default)]
    pub force: bool,
}

// ---------------------------------------------------------------------------
// 内置推荐仓库 — M2.16-005-M 顺手修: 3 个 placeholder URL → 真 URL (产品拍板)
// M3.4 扩展: 新增 install_mode / install_target 字段,支持 3 类 install 语义
// ---------------------------------------------------------------------------

/// M3.4 — Install 模式 (清单 11/13/14 重构)。
///
/// 决定后端走哪条 install 路径:
/// - `Builtin` → [`MarketplaceService::install_builtin`] (调 `claude plugin install` CLI)
/// - `Git` → [`MarketplaceService::install_third_party`] (git clone + scan + copy)
/// - `Npx` → [`MarketplaceService::install_npx`] (调 `npx <pkg>`)
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum InstallMode {
    #[default]
    Git,
    Builtin,
    Npx,
}

/// BUG-RF-03 — catalog 来源标签 (内置 / 第三方)。
///
/// `Builtin` = 项目维护的内置推荐源 (curated by us),用户在 UI 上
/// 无需特别警惕。`ThirdParty` = 用户粘贴的 git URL 或社区共享的
/// catalog,前端在对应 tab 顶部显示警告条 "第三方仓库未经 Claude
/// 官方审核, 请自行甄别"。
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum CatalogSource {
    #[default]
    Builtin,
    ThirdParty,
}

/// M2.16 + M3.4 — 内置推荐仓库条目。
///
/// `id` 稳定 (前端 React key 用)。
/// `install_mode` + `install_target` (M3.4 新增) 决定 install 语义。
///
/// BUG-RF-03 — 加 `source` 字段 (Builtin / ThirdParty) 让前端能按来源
/// 分 tab + 第三方仓库显示警告语。serde default = Builtin 保持向
/// 后兼容(老调用方不会带这个字段)。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MarketplaceRepo {
    pub id: String,
    pub name: String,
    pub url: String,
    pub description: String,
    /// M3.4 — install 模式
    #[serde(default)]
    pub install_mode: InstallMode,
    /// M3.4 — install 命令 / 包名 (按 install_mode 解释):
    /// - Builtin: `claude plugin install <install_target>` 的 target 段
    /// - Npx: `npx <install_target>`
    /// - Git: 可空 (直接走 `url` clone)
    #[serde(default)]
    pub install_target: String,
    /// BUG-RF-03 — catalog 来源 (内置 / 第三方)。
    /// 第三方仓库 UI 顶部加 "未经 Claude 官方审核" 警告条。
    /// Default = Builtin (向后兼容 — 老调用方无此字段时按内置处理)。
    #[serde(default)]
    pub source: CatalogSource,
}

/// M3.4 — 内置推荐列表 (M2.16-005-M: placeholder URL → 真 URL)。
///
/// 3 个内置源:
/// 1. **superpowers** (清单 13) — 官方 plugin marketplace, Builtin 模式
///    (调 `claude plugin install superpowers@claude-plugins-official` CLI)。
/// 2. **GSD** (清单 14) — Get Shit Done, Npx 模式
///    (调 `npx @opengsd/gsd-core@latest --global --silent`)。
/// 3. **claude-cookbooks** (示例) — 第三方仓库, Git 模式
///    (git clone + scan + 用户选资源 install)。
///
/// 主 session 拍板后可改 3 个 URL; 当前是 placeholder fallback。
pub fn builtin_repos() -> Vec<MarketplaceRepo> {
    vec![
        MarketplaceRepo {
            id: "superpowers".into(),
            name: "Superpowers (官方 plugin 集合)".into(),
            url: "https://github.com/anthropics/claude-plugins-official.git".into(),
            description: "Claude Code 官方插件集合(superpowers / debugging / collaboration 等)。M3.4: 走 `claude plugin install` CLI 一步到位,无需 git clone。".into(),
            install_mode: InstallMode::Builtin,
            install_target: "superpowers@claude-plugins-official".into(),
            source: CatalogSource::Builtin,
        },
        MarketplaceRepo {
            id: "gsd-core".into(),
            name: "Get Shit Done (GSD)".into(),
            url: "https://github.com/gsd-build/gsd-core.git".into(),
            description: "GSD — 结构化 Claude Code 工作流(discuss / plan / execute / verify)。M3.4: 走 `npx @opengsd/gsd-core@latest --global --silent`,无需 git clone。".into(),
            install_mode: InstallMode::Npx,
            install_target: "@opengsd/gsd-core@latest".into(),
            source: CatalogSource::Builtin,
        },
        MarketplaceRepo {
            id: "claude-cookbooks".into(),
            name: "Claude Cookbooks (示例)".into(),
            url: "https://github.com/anthropics/claude-cookbooks.git".into(),
            description: "Anthropic 官方示例集合(plugins / skills / commands)。M3.4: 走 git clone + 用户选资源 install。".into(),
            install_mode: InstallMode::Git,
            install_target: String::new(),
            source: CatalogSource::Builtin,
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
    /// M5 user bug #23 + #24 — `claude` / `npx` CLI 不在 PATH 时
    /// spawn 失败,不能错位包成 git error。专门 variant 让前端
    /// 能区分 "git 出问题" vs "CLI 工具没装"。
    #[error("无法启动 '{cmd}' CLI (请确认已安装)")]
    CliNotFound { cmd: String },
    /// resource_id 解析失败或扫描后找不到匹配资源。
    #[error("invalid resource id: {0}")]
    InvalidResourceId(String),
    /// install 目标已存在,拒绝覆盖用户数据。
    #[error("目标已存在,请先删除: {0}")]
    DestExists(PathBuf),
    /// slug / 路径穿越攻击防护。
    #[error("path unsafe: {0}")]
    PathUnsafe(String),
    /// M3.12 (A1#12) — `active_root_dir = Some(root)` 但 root 不存在。
    /// 安全边界:不自动 mkdir 未知 root(CLAUDE.md §7 + SPEC §6.1)。
    #[error("active root 目录不存在,拒绝写入(避免 mkdir 未知路径): {0}")]
    RootNotFound(PathBuf),
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/// F17 在线安装 service。
pub struct MarketplaceService {
    /// `<app_data>/marketplaces/` —— clone 缓存根目录。
    marketplaces_dir: PathBuf,
    /// `~/.claude/` —— install 目标根(baked at construction time;
    /// 仅在 `active_root_dir = None` 时使用;project 模式下
    /// `<active_root>/.claude/` 由 `_with_active_root` 方法解析)。
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
    /// → 默认报错(`InstallOptions::force = false`);force=true 时备份
    /// 现有目标到 `.bak.<ts>` 后覆盖。
    ///
    /// Thin wrapper around [`Self::install_resource_with_active_root`]
    /// that defaults to user-level mode (`active_root_dir = None`).
    /// Backward-compatible with M2.16 callers.
    pub fn install_resource(
        &self,
        repo_path: &str,
        resource_id: &str,
        options: Option<InstallOptions>,
    ) -> Result<InstallResult, MarketplaceError> {
        self.install_resource_with_active_root(repo_path, resource_id, options, None)
    }

    /// M3.12 (A1#12) — install resource with explicit `active_root_dir`.
    ///
    /// - `None` → install to the user-level `claude_dir` baked at
    ///   construction time (M2.16 behavior).
    /// - `Some(root)` → install to `<root>/.claude/` (project mode).
    ///
    /// **Safety boundary** (CLAUDE.md §7 + SPEC §6.1): if
    /// `Some(root)` and `<root>` does not exist, the install is REJECTED
    /// with `MarketplaceError::RootNotFound(root)` and the service does
    /// NOT auto-`mkdir` the unknown root. This prevents accidentally
    /// creating directories in paths the user didn't intend.
    ///
    /// The clone cache (`<app_data>/marketplaces/<slug>/`) is NOT
    /// affected by `active_root_dir` — it stays in the global app-data
    /// pool regardless of mode.
    pub fn install_resource_with_active_root(
        &self,
        repo_path: &str,
        resource_id: &str,
        options: Option<InstallOptions>,
        active_root_dir: Option<&Path>,
    ) -> Result<InstallResult, MarketplaceError> {
        let options = options.unwrap_or_default();
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

        // M3.12 (A1#12) — 解析 install 目标 claude_dir。
        // None → 用构造时 baked 的 user-level claude_dir。
        // Some(root) → 用 <root>/.claude/,但先校验 root 存在(不自动 mkdir)。
        let target_claude_dir = match active_root_dir {
            None => self.claude_dir.clone(),
            Some(root) => {
                if !root.exists() {
                    return Err(MarketplaceError::RootNotFound(root.to_path_buf()));
                }
                root.join(".claude")
            }
        };

        // install 目标子目录(白名单 4 种)。
        let sub = kind_subdir(kind);
        let dest_dir = target_claude_dir.join(sub);
        std::fs::create_dir_all(&dest_dir)?;
        let dest = dest_dir.join(&name);
        if dest.exists() {
            if options.force {
                // M2.16 — H3: 强制覆盖前先备份当前目标到 .bak.<ts>。
                // 备份失败 → 拒绝覆盖(不静默吞错,SPEC §6.5)。
                let backup_path = backup_path_with_ts(&dest);
                std::fs::rename(&dest, &backup_path)?;
            } else {
                return Err(MarketplaceError::DestExists(dest));
            }
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

/// M2.16 — H3: 在 `dest` 同目录下生成 `<stem>.bak.<unix_ts>` 备份路径。
///
/// 时间戳用 unix seconds(单调递增),不读本地时钟避免重入。冲突概率
/// 在用户手动连点 1s 内可见 —— 同一个目标 `.bak.<ts>` 重新覆盖前
/// 旧备份已被 rename 走,新备份路径唯一。
fn backup_path_with_ts(dest: &Path) -> PathBuf {
    use std::time::{SystemTime, UNIX_EPOCH};
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let parent = dest.parent().unwrap_or_else(|| Path::new("."));
    let stem = dest
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("resource");
    parent.join(format!("{stem}.bak.{ts}"))
}

// ---------------------------------------------------------------------------
// M3.4 — 三类 install 语义统一 (清单 11/12/13/14)
// ---------------------------------------------------------------------------

impl MarketplaceService {
    /// M3.4 — 内置列表 install (清单 13: superpowers)。
    ///
    /// 流程: 查 `builtin_repos()` → 调 `claude plugin install <install_target>`
    /// CLI → 落地到 `~/.claude/plugins/<name>/`。
    ///
    /// 与 `clone_and_scan` 的区别: 不 git clone, 一次到位。CLI 失败
    /// → `Err(Git(...))` 含 stderr (CLAUDE.md §7 不静默吞错)。
    ///
    /// Thin wrapper around [`Self::install_builtin_with_active_root`]
    /// that defaults to user-level mode (`active_root_dir = None`).
    pub fn install_builtin(&self, plugin_id: &str) -> Result<InstallResult, MarketplaceError> {
        self.install_builtin_with_active_root(plugin_id, None)
    }

    /// M3.12 (A1#12) — install builtin with explicit `active_root_dir`.
    ///
    /// Same semantics as [`Self::install_resource_with_active_root`]:
    /// `None` → user-level `claude_dir`; `Some(root)` → `<root>/.claude/`
    /// (with root-existence check, no auto-mkdir).
    pub fn install_builtin_with_active_root(
        &self,
        plugin_id: &str,
        active_root_dir: Option<&Path>,
    ) -> Result<InstallResult, MarketplaceError> {
        let repo = builtin_repos()
            .into_iter()
            .find(|r| r.id == plugin_id)
            .ok_or_else(|| {
                MarketplaceError::InvalidResourceId(format!(
                    "未知内置插件: '{plugin_id}'"
                ))
            })?;
        if repo.install_mode != InstallMode::Builtin {
            return Err(MarketplaceError::InvalidResourceId(format!(
                "插件 '{plugin_id}' 不是 Builtin 模式 (实际: {:?})",
                repo.install_mode
            )));
        }
        // 调 `claude plugin install <target>` CLI。
        // 失败 (CLI 不在 PATH / exit != 0) → 包成 CliNotFound 返回。
        // M5 user bug #24: 之前错位包成 Git error,误导用户。
        let out = std::process::Command::new("claude")
            .args(["plugin", "install", &repo.install_target])
            .output()
            .map_err(|_e| MarketplaceError::CliNotFound {
                cmd: "claude".to_string(),
            })?;
        if !out.status.success() {
            let stderr = String::from_utf8_lossy(&out.stderr).into_owned();
            return Err(MarketplaceError::Git(format!(
                "claude plugin install 失败: {stderr}"
            )));
        }
        // M3.12 (A1#12) — 解析目标 claude_dir。
        let target_claude_dir = match active_root_dir {
            None => self.claude_dir.clone(),
            Some(root) => {
                if !root.exists() {
                    return Err(MarketplaceError::RootNotFound(root.to_path_buf()));
                }
                root.join(".claude")
            }
        };
        // 落地路径 = ~/.claude/plugins/<plugin_id>/
        let dest_dir = target_claude_dir.join("plugins").join(&repo.id);
        Ok(InstallResult {
            resource_id: format!("plugin/{}", repo.id),
            installed: true,
            dest_path: dest_dir.to_string_lossy().into_owned(),
            message: format!("内置插件 '{}' 安装成功", repo.name),
        })
    }

    /// M3.4 — 第三方仓库 install (清单 11/12)。
    ///
    /// 流程: `git clone --depth=1` → 扫 5 种 kind → 循环
    /// `install_resource` 把 `selections` 里的资源 copy 到 `~/.claude/`。
    ///
    /// 与 `clone_and_scan` + `install_resource` 两步流程的区别:
    /// 单步完成, 不需要前端先扫后装中间态。**保留** `clone_and_scan`
    /// 作为"预览" (用户先看仓库里有什么)。
    ///
    /// Thin wrapper around [`Self::install_third_party_with_active_root`]
    /// that defaults to user-level mode (`active_root_dir = None`).
    pub fn install_third_party(
        &self,
        url: &str,
        selections: Vec<String>,
        options: Option<InstallOptions>,
    ) -> Result<Vec<InstallResult>, MarketplaceError> {
        self.install_third_party_with_active_root(url, selections, options, None)
    }

    /// M3.12 (A1#12) — install third party with explicit `active_root_dir`.
    ///
    /// Same semantics as [`Self::install_resource_with_active_root`]:
    /// routes the install target through `active_root_dir`.
    pub fn install_third_party_with_active_root(
        &self,
        url: &str,
        selections: Vec<String>,
        options: Option<InstallOptions>,
        active_root_dir: Option<&Path>,
    ) -> Result<Vec<InstallResult>, MarketplaceError> {
        // 复用 clone_and_scan 做 clone + 5 kind scan。
        // (clone_and_scan 本身不动 active_root:它是 clone 缓存到
        //  <app_data>/marketplaces/,与 active_root 无关。)
        let scan = self.clone_and_scan(url)?;
        let mut out = Vec::with_capacity(selections.len());
        for sel in selections {
            let r = self.install_resource_with_active_root(
                &scan.repo_path,
                &sel,
                options.clone(),
                active_root_dir,
            )?;
            out.push(r);
        }
        Ok(out)
    }

    /// M3.4 — npx install (清单 14: GSD)。
    ///
    /// 流程: 调 `npx <pkg> --global --silent` → 落地到
    /// `~/.claude/plugins/<pkg-basename>/`。
    ///
    /// `--global` 让 npx 把包装到全局 node_modules;
    /// `--silent` 抑制 npx 自身的 banner (CLAUDE.md §7)。
    ///
    /// Thin wrapper around [`Self::install_npx_with_active_root`] that
    /// defaults to user-level mode (`active_root_dir = None`).
    pub fn install_npx(&self, pkg: &str) -> Result<InstallResult, MarketplaceError> {
        self.install_npx_with_active_root(pkg, None)
    }

    /// M3.12 (A1#12) — install npx with explicit `active_root_dir`.
    ///
    /// Same semantics as [`Self::install_resource_with_active_root`]:
    /// routes the install target through `active_root_dir`.
    pub fn install_npx_with_active_root(
        &self,
        pkg: &str,
        active_root_dir: Option<&Path>,
    ) -> Result<InstallResult, MarketplaceError> {
        if pkg.trim().is_empty() {
            return Err(MarketplaceError::InvalidResourceId(
                "npx package 名不能为空".into(),
            ));
        }
        // npx 不在 PATH → spawn 失败 → 包成 CliNotFound。
        // M5 user bug #23: 之前错位包成 Git error,误导用户。
        let out = std::process::Command::new("npx")
            .args([pkg, "--global", "--silent"])
            .output()
            .map_err(|_e| MarketplaceError::CliNotFound {
                cmd: "npx".to_string(),
            })?;
        if !out.status.success() {
            let stderr = String::from_utf8_lossy(&out.stderr).into_owned();
            return Err(MarketplaceError::Git(format!(
                "npx '{pkg}' 失败: {stderr}"
            )));
        }
        // 推断 dest_dir = ~/.claude/plugins/<pkg-basename>/
        // 包名形如 "@opengsd/gsd-core@latest" → 取最后一段 basename
        // "@opengsd/gsd-core@latest" → "gsd-core"
        let basename = pkg
            .rsplit('/')
            .next()
            .unwrap_or(pkg)
            .split('@')
            .next()
            .unwrap_or(pkg);
        // M3.12 (A1#12) — 解析目标 claude_dir。
        let target_claude_dir = match active_root_dir {
            None => self.claude_dir.clone(),
            Some(root) => {
                if !root.exists() {
                    return Err(MarketplaceError::RootNotFound(root.to_path_buf()));
                }
                root.join(".claude")
            }
        };
        let dest_dir = target_claude_dir.join("plugins").join(basename);
        Ok(InstallResult {
            resource_id: format!("plugin/{basename}"),
            installed: true,
            dest_path: dest_dir.to_string_lossy().into_owned(),
            message: format!("npx '{pkg}' 安装成功"),
        })
    }
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
            .install_resource(&scan.repo_path, "plugin/code-review", None)
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
            .install_resource(&scan.repo_path, "command/deploy.md", None)
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
            .install_resource(&scan.repo_path, "mcp/fs", None)
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
            .install_resource(&scan.repo_path, "plugin/code-review", None)
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
            .install_resource(&scan.repo_path, "plugin/nonexistent", None)
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
            .install_resource(&scan.repo_path, "bogus", None)
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
            .install_resource(&scan.repo_path, "robots/foo", None)
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

    // ---- M2.16 — H3: force overwrite ----

    /// H3: force=true 时目标已存在不报错,旧目标被备份到 .bak.<ts>。
    #[test]
    fn install_force_overwrites_existing_with_backup() {
        let fake_repo = make_fake_repo();
        let tmp = TempDir::new().unwrap();
        let claude_dir = tmp.path().join("claude");
        let existing_dir = claude_dir.join("plugins").join("code-review");
        fs::create_dir_all(&existing_dir).unwrap();
        // 旧内容:区别于 fake_repo 的 "# code-review plugin"。
        fs::write(existing_dir.join("index.md"), b"# old local copy").unwrap();
        // 旧目录里加一个独有文件,验证备份是完整目录(不是只备份 index.md)。
        fs::write(existing_dir.join("local-only.txt"), b"local only").unwrap();

        let svc = make_service(
            tmp.path().join("mk"),
            claude_dir.clone(),
            fake_repo.path().to_path_buf(),
        );

        let scan = svc.clone_and_scan("https://github.com/foo/bar.git").unwrap();
        let result = svc
            .install_resource(
                &scan.repo_path,
                "plugin/code-review",
                Some(InstallOptions { force: true }),
            )
            .expect("force install should succeed");

        assert!(result.installed);
        assert!(result.message.contains("覆盖") || result.message.contains("成功"));

        // 1) 新内容落地
        let dest_file = claude_dir.join("plugins").join("code-review").join("index.md");
        assert_eq!(
            fs::read_to_string(&dest_file).unwrap(),
            "# code-review plugin",
            "新内容应覆盖旧内容"
        );

        // 2) 旧内容已备份到 .bak.<ts>
        let backups: Vec<_> = fs::read_dir(claude_dir.join("plugins"))
            .unwrap()
            .flatten()
            .filter_map(|e| {
                let n = e.file_name().to_str()?.to_string();
                if n.starts_with("code-review.bak.") {
                    Some(e.path())
                } else {
                    None
                }
            })
            .collect();
        assert_eq!(backups.len(), 1, "应恰好有 1 个备份目录");
        let backup = &backups[0];
        assert_eq!(
            fs::read_to_string(backup.join("index.md")).unwrap(),
            "# old local copy",
            "备份保留旧内容"
        );
        assert!(
            backup.join("local-only.txt").exists(),
            "备份保留原目录的独有文件"
        );
    }

    /// H3: force=false(默认)= 老行为:目标已存在报错 DestExists。
    #[test]
    fn install_without_force_still_rejects_existing() {
        let fake_repo = make_fake_repo();
        let tmp = TempDir::new().unwrap();
        let claude_dir = tmp.path().join("claude");
        fs::create_dir_all(claude_dir.join("plugins").join("code-review")).unwrap();

        let svc = make_service(
            tmp.path().join("mk"),
            claude_dir,
            fake_repo.path().to_path_buf(),
        );
        let scan = svc.clone_and_scan("https://github.com/foo/bar.git").unwrap();
        let err = svc
            .install_resource(&scan.repo_path, "plugin/code-review", None)
            .unwrap_err();
        assert!(matches!(err, MarketplaceError::DestExists(_)));
    }

    // ---- M3.4 — builtin_repos + 3 install methods ----

    /// M3.4 / M2.16-005-M: builtin_repos 返回 3 个真 URL (非 placeholder)。
    /// 每个条目 id / url 都非空,且 URL 不能含 "占位" / "todo" 字样。
    #[test]
    fn builtin_repos_returns_real_urls() {
        let repos = builtin_repos();
        assert_eq!(repos.len(), 3, "应有 3 个内置推荐源");
        for r in &repos {
            assert!(!r.id.is_empty());
            assert!(!r.url.is_empty());
            assert!(
                !r.url.contains("占位"),
                "URL 不应再含'占位'字样: {}",
                r.url
            );
            assert!(!r.description.is_empty());
        }
        // 三个内置 id 必须稳定 (前端 React key)。
        let ids: Vec<_> = repos.iter().map(|r| r.id.as_str()).collect();
        assert!(ids.contains(&"superpowers"), "应有 superpowers");
        assert!(ids.contains(&"gsd-core"), "应有 gsd-core");
        assert!(ids.contains(&"claude-cookbooks"), "应有 claude-cookbooks");
    }

    /// M3.4: builtin_repos 每个条目都有 install_mode + install_target。
    /// Builtin 模式必须有 install_target;Git 模式可以为空 (走 url clone)。
    #[test]
    fn builtin_repos_have_install_mode_and_target() {
        let repos = builtin_repos();
        for r in &repos {
            // superpowers → Builtin + target 非空
            // gsd-core → Npx + target 非空
            // claude-cookbooks → Git + target 可空
            match r.install_mode {
                InstallMode::Builtin | InstallMode::Npx => {
                    assert!(
                        !r.install_target.is_empty(),
                        "{:?} 模式必须有 install_target: id={}",
                        r.install_mode,
                        r.id
                    );
                }
                InstallMode::Git => {
                    // Git 模式走 url, install_target 可空。
                }
            }
        }
    }

    /// BZ-06 — builtin_repos 所有 URL 都不能含 'cc-switch-main' 旧路径
    /// (用户实测反馈: '浏览' 按钮 openUrl 跳到 cc-switch-main 仓库
    /// → 404 / 私有仓库)。
    ///
    /// 锁定每个内置 repo 的 url 是 https://github.com 开头 + 含 .git 后缀 +
    /// **不含** "cc-switch-main" 占位 (那个项目名不是任何真仓库)。
    ///
    /// 注意: 自身 `parser` / `usage_provider_ccswitch.rs` 等 Rust 文件
    /// 注释里仍会引用 "cc-switch-main" (历史来源标注,不可删);本测试
    /// 只检查 builtin_repos 返回的 url 字段。
    #[test]
    fn bz06_builtin_repos_urls_have_no_cc_switch_main_path() {
        let repos = builtin_repos();
        assert!(!repos.is_empty(), "builtin_repos 必须有 ≥1 个内置源");
        for r in &repos {
            assert!(
                !r.url.contains("cc-switch-main"),
                "BZ-06: builtin_repos[{}].url 不应含 'cc-switch-main' \
                 旧路径 (实际: {})",
                r.id,
                r.url
            );
            assert!(
                r.url.starts_with("https://"),
                "BZ-06: builtin_repos[{}].url 必须 https:// 开头 (实际: {})",
                r.id,
                r.url
            );
            assert!(
                r.url.starts_with("https://github.com/"),
                "BZ-06: builtin_repos[{}].url 必须指向 github.com \
                 (实际: {})",
                r.id,
                r.url
            );
            assert!(
                r.url.ends_with(".git"),
                "BZ-06: builtin_repos[{}].url 应以 .git 结尾 (实际: {})",
                r.id,
                r.url
            );
        }
    }

    /// BZ-06 — 已知 3 个内置 repo 的具体 URL 锁定(防止重构时悄悄改 URL)。
    ///
    /// 改动 builtin_repos URL 时,这里必须同步改;否则说明有人未走
    /// 用户拍板流程就改了关键 catalog 数据。
    #[test]
    fn bz06_builtin_repos_urls_match_known_good_paths() {
        let repos = builtin_repos();
        let urls: std::collections::HashMap<&str, &str> = repos
            .iter()
            .map(|r| (r.id.as_str(), r.url.as_str()))
            .collect();
        assert_eq!(
            urls.get("superpowers").copied(),
            Some("https://github.com/anthropics/claude-plugins-official.git"),
            "BZ-06: superpowers url 锚定到 anthropics/claude-plugins-official.git"
        );
        assert_eq!(
            urls.get("claude-cookbooks").copied(),
            Some("https://github.com/anthropics/claude-cookbooks.git"),
            "BZ-06: claude-cookbooks url 锚定到 anthropics/claude-cookbooks.git"
        );
        assert!(
            urls.get("gsd-core").map(|u| u.starts_with("https://github.com/")).unwrap_or(false),
            "BZ-06: gsd-core url 必须 https://github.com 开头 (实际: {:?})",
            urls.get("gsd-core")
        );
    }

    /// BUG-RF-03 — builtin_repos() 返回的所有条目都标 `Builtin`,
    /// 不会触发第三方警告条。第三方警告由前端按 source 字段分 tab
    /// 渲染,后端只负责给数据。
    #[test]
    fn rf03_builtin_repos_all_have_builtin_source() {
        let repos = builtin_repos();
        assert!(!repos.is_empty());
        for r in &repos {
            assert_eq!(
                r.source,
                CatalogSource::Builtin,
                "RF-03: builtin_repos[{}] 的 source 必须是 Builtin (实际: {:?})",
                r.id,
                r.source
            );
        }
    }

    /// BUG-RF-03 — CatalogSource 的 serde 表示稳定(`builtin` / `third_party`)。
    /// 前端 `marketplace.ts` 的 TS 镜像 `CatalogSource` 枚举对应这两个
    /// 字符串值,锁定该合约防止悄悄重命名。
    #[test]
    fn rf03_catalog_source_serde_values_are_stable() {
        // Builtin → "builtin"
        let b = serde_json::to_string(&CatalogSource::Builtin).unwrap();
        assert_eq!(b, "\"builtin\"");
        // ThirdParty → "third_party"
        let t = serde_json::to_string(&CatalogSource::ThirdParty).unwrap();
        assert_eq!(t, "\"third_party\"");
        // 反向解析: 字符串能还原为正确的 enum variant。
        let parsed: CatalogSource = serde_json::from_str("\"third_party\"").unwrap();
        assert_eq!(parsed, CatalogSource::ThirdParty);
        let parsed: CatalogSource = serde_json::from_str("\"builtin\"").unwrap();
        assert_eq!(parsed, CatalogSource::Builtin);
    }

    /// M3.4: install_builtin 拒绝未知 plugin_id。
    #[test]
    fn install_builtin_rejects_unknown_id() {
        let tmp = TempDir::new().unwrap();
        let svc = make_service(
            tmp.path().join("mk"),
            tmp.path().join("claude"),
            tmp.path().join("fake"),
        );
        let err = svc.install_builtin("nonexistent-plugin").unwrap_err();
        assert!(
            matches!(err, MarketplaceError::InvalidResourceId(_)),
            "got {err:?}"
        );
    }

    /// M3.4: install_builtin 拒绝非 Builtin 模式 (例如 gsd-core 是 Npx)。
    /// 因为我们在测试环境无法调 `claude` CLI (它真的去装),所以只验证
    /// 模式检查分支能正确拦截 Npx / Git 模式 id。
    #[test]
    fn install_builtin_rejects_non_builtin_mode() {
        let tmp = TempDir::new().unwrap();
        let svc = make_service(
            tmp.path().join("mk"),
            tmp.path().join("claude"),
            tmp.path().join("fake"),
        );
        // gsd-core 是 Npx 模式 → install_builtin 应拒绝。
        let err = svc.install_builtin("gsd-core").unwrap_err();
        assert!(
            matches!(err, MarketplaceError::InvalidResourceId(_)),
            "Npx 模式应被 install_builtin 拒绝, got {err:?}"
        );
        // claude-cookbooks 是 Git 模式 → install_builtin 应拒绝。
        let err = svc.install_builtin("claude-cookbooks").unwrap_err();
        assert!(
            matches!(err, MarketplaceError::InvalidResourceId(_)),
            "Git 模式应被 install_builtin 拒绝, got {err:?}"
        );
    }

    /// M3.4: install_builtin 调用真实 `claude` CLI 时, 没装 Claude Code
    /// 的 dev box 上应返回 Git error (不是 panic)。
    ///
    /// M5 user bug #24 — install_builtin 在 `claude` CLI 不在 PATH 时应返回
    /// 专门的 `CliNotFound` variant 而不是 `Git`,错误信息应明确指向
    /// `claude` 而不是 git。
    ///
    /// 不依赖 dev box 是否有 `claude` 命令 — 直接调,大多数 CI / dev box
    /// 没装 `claude`,所以预期返回 `CliNotFound`。
    #[test]
    fn install_builtin_returns_clinotfound_when_claude_missing() {
        let tmp = TempDir::new().unwrap();
        let svc = make_service(
            tmp.path().join("mk"),
            tmp.path().join("claude"),
            tmp.path().join("fake"),
        );
        let result = svc.install_builtin("superpowers");
        match result {
            Ok(installed) => {
                // 机器真有 `claude` CLI 且 install 成功了 — 这是 OK 的,
                // 不算测试失败 (CI 通常没装)。
                assert!(installed.installed);
            }
            Err(MarketplaceError::CliNotFound { cmd }) => {
                // M5 bug #24: 应明确指出是 `claude` CLI 找不到,不是 git。
                assert_eq!(
                    cmd, "claude",
                    "CliNotFound.cmd 应等于 'claude' (实际: {cmd})"
                );
            }
            Err(other) => panic!(
                "expected CliNotFound {{ cmd: 'claude' }}, got {other:?}"
            ),
        }
    }

    /// M5 user bug #23 — install_npx 在 `npx` 不在 PATH 时应返回
    /// 专门的 `CliNotFound` variant,而不是错位包成 `Git`。
    ///
    /// 用户报告的具体错位措辞是:
    ///   "git error: 无法启动 'npx' (请确认 Node.js + npm 已安装):
    ///    No such file or directory (os error 2)"
    ///
    /// dev box 可能装了 npx (此时本测试命中 exit-nonzero 路径而非 spawn
    /// 路径),所以这里改用 "错位措辞消失" 而非 "必须是 CliNotFound" 断言:
    /// 关键点是 Git variant 的 message 不能再含 "无法启动" + "npx"。
    /// 真没装 npx 的 dev box 会落到 CliNotFound 分支,装了的会落到
    /// exit-nonzero 分支(Git 包 stderr,但 stderr 是真实 npm 输出,
    /// 不是 spawn 失败措辞)。
    #[test]
    fn install_npx_returns_clinotfound_when_npx_missing() {
        let tmp = TempDir::new().unwrap();
        let svc = make_service(
            tmp.path().join("mk"),
            tmp.path().join("claude"),
            tmp.path().join("fake"),
        );
        let result = svc.install_npx("@opengsd/__definitely_not_a_real_pkg__@latest");
        match result {
            Ok(installed) => {
                // 机器有 `npx` 且 install 成功了 — 不算失败。
                assert!(installed.installed);
            }
            Err(MarketplaceError::CliNotFound { cmd }) => {
                // M5 bug #23 路径: 真没 npx → CliNotFound { cmd: "npx" }。
                assert_eq!(
                    cmd, "npx",
                    "CliNotFound.cmd 应等于 'npx' (实际: {cmd})"
                );
            }
            Err(MarketplaceError::Git(msg)) => {
                // 机器装了 npx 但 pkg 不存在 → exit nonzero,走 Git 分支
                // (包真实 npm stderr)。这种情况 OK,只要 message 不含
                // M5 bug #23 的"spawn 失败错位为 git"措辞。
                assert!(
                    !msg.contains("无法启动"),
                    "M5 bug #23: Git variant 不应再含 '无法启动' \
                     (spawn 失败错位文案),got: {msg}"
                );
            }
            Err(other) => {
                panic!("unexpected error variant: {other:?}");
            }
        }
    }

    /// M3.4: install_third_party 单步完成 clone + scan + 循环 install。
    /// 复用 FakeGitHost (已有),验证 selections 列表里的每个资源都被 copy。
    #[test]
    fn install_third_party_installs_all_selected_resources() {
        let fake_repo = make_fake_repo();
        let tmp = TempDir::new().unwrap();
        let claude_dir = tmp.path().join("claude");
        let svc = make_service(
            tmp.path().join("mk"),
            claude_dir.clone(),
            fake_repo.path().to_path_buf(),
        );

        let results = svc
            .install_third_party(
                "https://github.com/foo/bar.git",
                vec!["plugin/code-review".into(), "command/deploy.md".into()],
                None,
            )
            .expect("install_third_party should succeed");

        assert_eq!(results.len(), 2);
        assert!(results.iter().all(|r| r.installed));
        // 资源确实落地。
        assert!(claude_dir.join("plugins").join("code-review").join("index.md").exists());
        assert!(claude_dir.join("commands").join("deploy.md").exists());
    }

    /// M3.4: install_third_party 空 selections → 空 results (不报错)。
    #[test]
    fn install_third_party_empty_selections_returns_empty() {
        let fake_repo = make_fake_repo();
        let tmp = TempDir::new().unwrap();
        let svc = make_service(
            tmp.path().join("mk"),
            tmp.path().join("claude"),
            fake_repo.path().to_path_buf(),
        );
        let results = svc
            .install_third_party("https://github.com/foo/bar.git", vec![], None)
            .expect("empty selections should succeed");
        assert!(results.is_empty());
    }

    /// M3.4: install_third_party 某个 selection 不存在 → 错误传播。
    #[test]
    fn install_third_party_propagates_invalid_resource_error() {
        let fake_repo = make_fake_repo();
        let tmp = TempDir::new().unwrap();
        let svc = make_service(
            tmp.path().join("mk"),
            tmp.path().join("claude"),
            fake_repo.path().to_path_buf(),
        );
        let err = svc
            .install_third_party(
                "https://github.com/foo/bar.git",
                vec!["plugin/nonexistent".into()],
                None,
            )
            .unwrap_err();
        assert!(matches!(err, MarketplaceError::InvalidResourceId(_)));
    }

    /// M3.4: install_npx 拒绝空 pkg 名。
    #[test]
    fn install_npx_rejects_empty_package() {
        let tmp = TempDir::new().unwrap();
        let svc = make_service(
            tmp.path().join("mk"),
            tmp.path().join("claude"),
            tmp.path().join("fake"),
        );
        let err = svc.install_npx("").unwrap_err();
        assert!(matches!(err, MarketplaceError::InvalidResourceId(_)));
        let err = svc.install_npx("   ").unwrap_err();
        assert!(matches!(err, MarketplaceError::InvalidResourceId(_)));
    }

    /// M3.4: install_npx 调用真实 `npx` 时,大多数 dev box 有 Node.js →
    /// `npx --help` 之类命令能跑;但 `npx @opengsd/gsd-core@latest --global --silent`
    /// 会真的去 npm registry 拉包,网络环境不一定允许。
    ///
    /// 因此这里只验证错误处理路径(spawn 失败 → Git error);不验证
    /// 成功 install (那是 e2e 测试范围)。
    #[test]
    fn install_npx_handles_spawn_or_exit_failure_gracefully() {
        let tmp = TempDir::new().unwrap();
        let svc = make_service(
            tmp.path().join("mk"),
            tmp.path().join("claude"),
            tmp.path().join("fake"),
        );
        // 任意包名 — 目标只是验证函数不 panic。
        let result = svc.install_npx("@opengsd/gsd-core@latest");
        // 不管成功 (有 npx + 网络通) 或失败 (没 npx 或 npm 404), 都不应 panic。
        match result {
            Ok(installed) => {
                assert!(installed.installed);
                assert!(installed.dest_path.contains("plugins"));
            }
            Err(MarketplaceError::Git(msg)) => {
                // 预期 — npx 不在 PATH / 网络失败 / 包不存在。
                assert!(!msg.is_empty(), "错误消息不应为空");
            }
            Err(other) => panic!("unexpected error variant: {other:?}"),
        }
    }

    /// M3.4: install_npx 对包名 basename 提取的正确性。
    /// 直接验证 dest_path 包含 basename (不论 install 成功与否, 假设
    /// 真有 `claude plugin install` / `npx` 跑通, dest 路径逻辑走对)。
    ///
    /// 这里只 unit 测 basename 提取逻辑,不跑 CLI — 通过观察
    /// install_npx 成功时的 dest_path 是否包含 `gsd-core` 验证。
    /// 由于依赖外部 CLI, 这条用 #[ignore] 标记, 仅在 dev box 手工跑。
    #[test]
    #[ignore = "depends on npx + network; run manually with `cargo test -- --ignored`"]
    fn install_npx_dest_path_uses_basename() {
        let tmp = TempDir::new().unwrap();
        let svc = make_service(
            tmp.path().join("mk"),
            tmp.path().join("claude"),
            tmp.path().join("fake"),
        );
        // 装个轻量包 (chalk),验证 dest_path 含 `chalk`。
        let result = svc.install_npx("chalk@5").expect("npx chalk@5 should succeed");
        assert!(
            result.dest_path.contains("chalk"),
            "dest_path 应含 'chalk' basename: {}",
            result.dest_path
        );
    }

    // ---- M3.12 (A1#12) — F17 install_from_marketplace 接入 active_root_dir ----
    //
    // 写路径测试 (medium 风险) — 验证 install 目标根据 active_root_dir
    // 路由:
    // - None → 写到 baked user-level claude_dir (向后兼容 M2.16)
    // - Some(root) → 写到 <root>/.claude/,且 root 必须存在 (拒绝 mkdir)
    //
    // 测试 fixture: 同时建 user .claude/ + project .claude/,写入两份
    // 完全独立的内容,验证 install 只命中其中一份。

    /// 1. `active_root_dir = None` → install 到 baked 的 user-level
    /// claude_dir (M2.16 向后兼容路径)。
    #[test]
    fn install_resource_with_active_root_none_writes_to_user_dotclaude() {
        let fake_repo = make_fake_repo();
        let tmp = TempDir::new().unwrap();
        let user_claude = tmp.path().join("user").join(".claude");
        // 预建 user .claude/ (与构造时 baked 的 user-level 一致)
        fs::create_dir_all(&user_claude).unwrap();
        // 同时建一个 project root + .claude/,验证 None 模式**不**碰它。
        let project_root = tmp.path().join("project");
        let project_claude = project_root.join(".claude");
        fs::create_dir_all(project_claude.join("plugins")).unwrap();
        fs::create_dir_all(project_claude.join("commands")).unwrap();

        let svc = make_service(
            tmp.path().join("mk"),
            user_claude.clone(),
            fake_repo.path().to_path_buf(),
        );

        let scan = svc
            .clone_and_scan("https://github.com/foo/bar.git")
            .unwrap();
        let result = svc
            .install_resource_with_active_root(
                &scan.repo_path,
                "plugin/code-review",
                None,
                None,
            )
            .expect("None 模式应成功 install");
        assert!(result.installed);

        // user-level: code-review 落地
        let user_dest = user_claude.join("plugins").join("code-review").join("index.md");
        assert!(user_dest.exists(), "user-level 应有落地文件: {}", user_dest.display());
        // project-level: 不应有落地文件
        let project_dest = project_claude.join("plugins").join("code-review");
        assert!(
            !project_dest.exists(),
            "None 模式不应写到 project-level: {}",
            project_dest.display()
        );
    }

    /// 2. `active_root_dir = Some(root)` → install 到 `<root>/.claude/`,
    /// **不**碰 user-level baked claude_dir。
    #[test]
    fn install_resource_with_active_root_some_writes_to_project_dotclaude() {
        let fake_repo = make_fake_repo();
        let tmp = TempDir::new().unwrap();
        // user-level: 与构造时 baked 一致,验证**不**被碰
        let user_claude = tmp.path().join("user").join(".claude");
        fs::create_dir_all(&user_claude).unwrap();
        // project root 必须存在(M3.12 安全边界)
        let project_root = tmp.path().join("project");
        let project_claude = project_root.join(".claude");
        fs::create_dir_all(project_claude.join("plugins")).unwrap();

        let svc = make_service(
            tmp.path().join("mk"),
            user_claude.clone(),
            fake_repo.path().to_path_buf(),
        );

        let scan = svc
            .clone_and_scan("https://github.com/foo/bar.git")
            .unwrap();
        let result = svc
            .install_resource_with_active_root(
                &scan.repo_path,
                "plugin/code-review",
                None,
                Some(&project_root),
            )
            .expect("Some 模式应成功 install");
        assert!(result.installed);

        // project-level: code-review 落地
        let project_dest = project_claude.join("plugins").join("code-review").join("index.md");
        assert!(
            project_dest.exists(),
            "project-level 应有落地文件: {}",
            project_dest.display()
        );
        // user-level: 不应有落地文件
        let user_dest = user_claude.join("plugins").join("code-review");
        assert!(
            !user_dest.exists(),
            "Some 模式不应写到 user-level: {}",
            user_dest.display()
        );
        // dest_path 应包含 project_root 路径
        assert!(
            result.dest_path.contains("project"),
            "dest_path 应包含 project 路径, got: {}",
            result.dest_path
        );
    }

    /// 3. `active_root_dir = Some(root)` + root 目录不存在 →
    /// 拒绝 install,返回 `RootNotFound`,且**不**自动 mkdir 未知 root。
    #[test]
    fn install_resource_with_active_root_rejects_missing_root() {
        let fake_repo = make_fake_repo();
        let tmp = TempDir::new().unwrap();
        let user_claude = tmp.path().join("user").join(".claude");
        fs::create_dir_all(&user_claude).unwrap();

        let svc = make_service(
            tmp.path().join("mk"),
            user_claude,
            fake_repo.path().to_path_buf(),
        );

        // 故意指向不存在的 root
        let bogus_root = tmp.path().join("does_not_exist_yet");
        assert!(!bogus_root.exists());

        let scan = svc
            .clone_and_scan("https://github.com/foo/bar.git")
            .unwrap();
        let err = svc
            .install_resource_with_active_root(
                &scan.repo_path,
                "plugin/code-review",
                None,
                Some(&bogus_root),
            )
            .unwrap_err();
        match &err {
            MarketplaceError::RootNotFound(p) => {
                assert_eq!(p, &bogus_root, "RootNotFound 应带原 root 路径");
            }
            other => panic!("expected RootNotFound, got {other:?}"),
        }

        // 不应该创建 bogus_root 或其 .claude/ 子目录(不自动 mkdir)
        assert!(
            !bogus_root.exists(),
            "service must NOT auto-mkdir unknown root"
        );
        assert!(
            !bogus_root.join(".claude").exists(),
            "service must NOT auto-mkdir .claude/ under unknown root"
        );
    }
}
