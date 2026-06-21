/**
 * F17 — 在线安装 前端 API 封装 (M2.16)。
 *
 * 镜像 M2.13 / M2.9 的 wrapper 模式 —— 页面必须从这里 import,不直接
 * 调 `invoke('clone_and_scan', ...)`。三个命令对应后端
 * `commands::marketplace::{list_marketplace_repos, clone_and_scan,
 * install_from_marketplace}`。
 */
import { invoke } from '@tauri-apps/api/core';
import type { ResourceItem } from '../../types/resource';

/** 内置推荐仓库条目(后端 `MarketplaceRepo` 镜像)。 */
export interface MarketplaceRepo {
  id: string;
  name: string;
  url: string;
  description: string;
}

/** clone + 扫描结果(后端 `ScanResult` 镜像)。`repo_path` 原样回传给
 *  install 命令,前端不拼路径。 */
export interface ScanResult {
  repo_path: string;
  resources: ResourceItem[];
}

/** install 结果(后端 `InstallResult` 镜像)。`installed: false` 表示
 *  该 kind 暂不支持自动安装(如 mcp),`message` 给用户看。 */
export interface InstallResult {
  resource_id: string;
  installed: boolean;
  dest_path: string;
  message: string;
}

/** M2.16 — H3: install 选项。force = true 时目标已存在会备份并覆盖。 */
export interface InstallOptions {
  force?: boolean;
}

/** F17 — 内置推荐仓库列表(无 I/O,纯常量)。 */
export function listMarketplaceRepos(): Promise<MarketplaceRepo[]> {
  return invoke<MarketplaceRepo[]>('list_marketplace_repos');
}

/** F17 — clone 第三方 / 推荐 git URL 并扫描 5 种 kind。
 *
 *  `url` 必须是合法 git URL(https / scp / file://)。clone 落地到
 *  `<app_data>/marketplaces/<slug>/`,已存在则删除重建。
 *  网络失败 → reject,页面用内联红条展示。 */
export function cloneAndScan(url: string): Promise<ScanResult> {
  return invoke<ScanResult>('clone_and_scan', { url });
}

/** F17 — 把 clone 下来的资源 install 到 `~/.claude/`。
 *
 *  `repoPath` 来自 `cloneAndScan` 返回的 `repo_path`(原样回传)。
 *  `resourceId` 格式 `<kind>/<name>`。目标已存在 → 默认 reject;
 *  `options.force = true` 时备份现有目标到 `.bak.<ts>` 后覆盖。
 *  MCP → `installed: false` + message。 */
export function installFromMarketplace(
  repoPath: string,
  resourceId: string,
  options?: InstallOptions,
): Promise<InstallResult> {
  return invoke<InstallResult>('install_from_marketplace', {
    repoPath,
    resourceId,
    options: options ?? null,
  });
}
