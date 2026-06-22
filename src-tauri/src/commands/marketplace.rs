//! Tauri commands for F17 — 在线安装 (M2.16 + M3.4).
//!
//! 围绕 [`MarketplaceService`] 的薄封装:
//!
//! - [`list_marketplace_repos`] —— 内置推荐仓库列表(M3.4 含 install_mode / target)。
//! - [`clone_and_scan`] —— clone + 扫描,返回资源清单(保留作预览)。
//! - [`install_from_marketplace`] —— 把资源 copy 到 `~/.claude/`。
//! - [`install_builtin_plugin`] —— M3.4 内置列表 install (清单 13: superpowers)。
//! - [`install_third_party_repo`] —— M3.4 第三方仓库单步装 (清单 11/12)。
//! - [`install_npx_package`] —— M3.4 npx 装 (清单 14: GSD)。
//!
//! ## Error 语义
//!
//! `Result<T, String>` —— Tauri IPC 惯例。`String` 是用户可读消息
//! (SPEC §6.5 "不允许静默吞错")。前端用内联红条 / 绿条展示,不阻塞 UI
//! (CLAUDE.md §7)。

use tauri::State;

use crate::app_state::AppState;
use crate::services::marketplace_service::{
    InstallOptions, InstallResult, MarketplaceRepo, ScanResult,
};

/// Tauri-friendly error type。
type CmdResult<T> = Result<T, String>;

/// F17 —— 内置推荐仓库列表。无 I/O,纯常量。
///
/// M3.4: 返回值新增 `install_mode` / `install_target` 字段(serde default 兼容老调用方)。
#[tauri::command]
pub async fn list_marketplace_repos(
    state: State<'_, AppState>,
) -> CmdResult<Vec<MarketplaceRepo>> {
    Ok(state.marketplace_service.list_builtin_repos())
}

/// F17 —— clone 第三方 / 推荐 git URL 并扫描 5 种 kind。
///
/// `url` 必须是合法 git URL(https / scp / file://)。clone 落地到
/// `<app_data>/marketplaces/<slug>/`,已存在则删除重建(缓存性质)。
/// 网络失败 / git 不存在 → `Err(...)` 带原始 stderr。
///
/// M3.4: 保留作"预览" —— 用户先看仓库里有什么,再勾选 install。
/// 生产路径用 [`install_third_party_repo`] 单步完成。
#[tauri::command]
pub async fn clone_and_scan(
    state: State<'_, AppState>,
    url: String,
) -> CmdResult<ScanResult> {
    state
        .marketplace_service
        .clone_and_scan(&url)
        .map_err(|e| e.to_string())
}

/// F17 —— 把 clone 下来的资源 install 到 `~/.claude/`。
///
/// `repoPath` 是 [`clone_and_scan`] 返回的 `repo_path`(前端原样回传)。
/// `resourceId` 格式 `<kind>/<name>`(如 `plugin/code-review`)。
/// 目标已存在 → 默认 `Err`(不覆盖用户数据);force=true 时备份现有
/// 目标到 `.bak.<ts>` 后覆盖。MCP → `installed: false` + 提示。
///
/// M3.12 (A1#12) — read live `active_root_dir` from the platform shim
/// and route the install target through `install_resource_with_active_root`.
/// `None` → user-level `claude_dir` (M2.16 default); `Some(root)` →
/// `<root>/.claude/` (project mode, with root-existence safety
/// boundary; no auto-mkdir).
#[tauri::command]
pub async fn install_from_marketplace(
    state: State<'_, AppState>,
    repo_path: String,
    resource_id: String,
    options: Option<InstallOptions>,
) -> CmdResult<InstallResult> {
    // M3.12 (A1#12) — read live active root via the platform shim.
    let active_root = crate::platform::runtime::paths().active_root_dir();
    state
        .marketplace_service
        .install_resource_with_active_root(
            &repo_path,
            &resource_id,
            options,
            active_root.as_deref(),
        )
        .map_err(|e| e.to_string())
}

/// M3.4 — 内置列表 install (清单 13: superpowers)。
///
/// `pluginId` 必须是 [`list_marketplace_repos`] 返回的 id,且对应条目
/// `install_mode = "builtin"`。后端调 `claude plugin install <target>`
/// CLI 一步到位,不 git clone。
///
/// M3.12 (A1#12) — routes the install target through `active_root_dir`.
#[tauri::command]
pub async fn install_builtin_plugin(
    state: State<'_, AppState>,
    plugin_id: String,
) -> CmdResult<InstallResult> {
    let active_root = crate::platform::runtime::paths().active_root_dir();
    state
        .marketplace_service
        .install_builtin_with_active_root(&plugin_id, active_root.as_deref())
        .map_err(|e| e.to_string())
}

/// M3.4 — 第三方仓库单步装 (清单 11/12)。
///
/// 单步完成 clone + scan + 循环 install(对 `selections` 里每个资源)。
/// `selections` 是 `resource_id` 列表(如 `["plugin/code-review", "command/deploy.md"]`)。
/// 不需要前端先 clone_and_scan 再 install_resource 两步。
///
/// M3.12 (A1#12) — routes the install target through `active_root_dir`.
#[tauri::command]
pub async fn install_third_party_repo(
    state: State<'_, AppState>,
    url: String,
    selections: Vec<String>,
    options: Option<InstallOptions>,
) -> CmdResult<Vec<InstallResult>> {
    let active_root = crate::platform::runtime::paths().active_root_dir();
    state
        .marketplace_service
        .install_third_party_with_active_root(
            &url,
            selections,
            options,
            active_root.as_deref(),
        )
        .map_err(|e| e.to_string())
}

/// M3.4 — npx 装 (清单 14: GSD)。
///
/// `package` 形如 `@opengsd/gsd-core@latest`。后端调
/// `npx <package> --global --silent`,落地到 `~/.claude/plugins/<basename>/`。
///
/// M3.12 (A1#12) — routes the install target through `active_root_dir`.
#[tauri::command]
pub async fn install_npx_package(
    state: State<'_, AppState>,
    package: String,
) -> CmdResult<InstallResult> {
    let active_root = crate::platform::runtime::paths().active_root_dir();
    state
        .marketplace_service
        .install_npx_with_active_root(&package, active_root.as_deref())
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    /// 命令层是薄封装,业务逻辑测试在 service 层。这里只钉符号存在:
    /// 六个命令的函数名必须跟 lib.rs `invoke_handler!` 注册名一致,
    /// 重命名时编译能过但运行时会 404,所以用引用强制符号解析。

    use super::*;

    /// 钉六个命令的符号存在 + 名字跟 lib.rs `invoke_handler!` 注册
    /// 一致。重命名时编译能过但运行时 404,这里取函数引用强制符号
    /// 解析(拼错会编译失败)。`#[allow(unused)]` 因为引用只用于
    /// 编译期检查,运行时不解引用。
    #[allow(unused)]
    #[test]
    fn command_symbols_exist() {
        let _ = &list_marketplace_repos;
        let _ = &clone_and_scan;
        let _ = &install_from_marketplace;
        let _ = &install_builtin_plugin;
        let _ = &install_third_party_repo;
        let _ = &install_npx_package;
    }
}
