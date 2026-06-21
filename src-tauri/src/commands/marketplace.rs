//! Tauri commands for F17 — 在线安装 (M2.16).
//!
//! 三个薄封装,围绕 [`MarketplaceService`]:
//!
//! - [`list_marketplace_repos`] —— 内置推荐仓库列表(硬编码常量)。
//! - [`clone_and_scan`] —— clone + 扫描,返回资源清单。
//! - [`install_from_marketplace`] —— 把资源 copy 到 `~/.claude/`。
//!
//! ## Error 语义
//!
//! `Result<T, String>` —— Tauri IPC 惯例。`String` 是用户可读消息
//! (SPEC §6.5 "不允许静默吞错")。前端用内联红条 / 绿条展示,不阻塞 UI
//! (CLAUDE.md §7)。

use tauri::State;

use crate::app_state::AppState;
use crate::services::marketplace_service::{
    InstallResult, MarketplaceRepo, ScanResult,
};

/// Tauri-friendly error type。
type CmdResult<T> = Result<T, String>;

/// F17 —— 内置推荐仓库列表。无 I/O,纯常量。
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
/// 目标已存在 → `Err`(不覆盖用户数据);MCP → `installed: false` +
/// 提示。
#[tauri::command]
pub async fn install_from_marketplace(
    state: State<'_, AppState>,
    repo_path: String,
    resource_id: String,
) -> CmdResult<InstallResult> {
    state
        .marketplace_service
        .install_resource(&repo_path, &resource_id)
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    /// 命令层是薄封装,业务逻辑测试在 service 层。这里只钉符号存在:
    /// 三个命令的函数名必须跟 lib.rs `invoke_handler!` 注册名一致,
    /// 重命名时编译能过但运行时会 404,所以用引用强制符号解析。

    use super::*;

    /// 钉三个命令的符号存在 + 名字跟 lib.rs `invoke_handler!` 注册
    /// 一致。重命名时编译能过但运行时 404,这里取函数引用强制符号
    /// 解析(拼错会编译失败)。`#[allow(unused)]` 因为引用只用于
    /// 编译期检查,运行时不解引用。
    #[allow(unused)]
    #[test]
    fn command_symbols_exist() {
        let _ = &list_marketplace_repos;
        let _ = &clone_and_scan;
        let _ = &install_from_marketplace;
    }
}
