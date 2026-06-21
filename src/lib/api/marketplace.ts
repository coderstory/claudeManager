/**
 * F17 — 在线安装 前端 API 封装 (M2.16 + M3.4)。
 *
 * 镜像 M2.13 / M2.9 的 wrapper 模式 —— 页面必须从这里 import,不直接
 * 调 `invoke('clone_and_scan', ...)`。
 *
 * M2.16 命令: `list_marketplace_repos` / `clone_and_scan` / `install_from_marketplace`
 * M3.4 命令:   `install_builtin_plugin` / `install_third_party_repo` / `install_npx_package`
 */
import { invoke } from '@tauri-apps/api/core';
import type { ResourceItem } from '../../types/resource';

/** M3.4 — Install 模式 (镜像 Rust `InstallMode`)。 */
export type InstallMode = 'builtin' | 'git' | 'npx';

/** 内置推荐仓库条目(后端 `MarketplaceRepo` 镜像,M3.4 扩展)。 */
export interface MarketplaceRepo {
  id: string;
  name: string;
  url: string;
  description: string;
  /** M3.4 — install 模式 */
  install_mode?: InstallMode;
  /** M3.4 — install 命令 / 包名 (按 install_mode 解释) */
  install_target?: string;
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
 *  网络失败 → reject,页面用内联红条展示。
 *
 *  M3.4: 保留作"预览"。生产路径用 [`installThirdPartyRepo`] 单步完成。 */
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

/** M3.4 — 内置列表 install (清单 13: superpowers)。
 *
 *  `pluginId` 必须是 `listMarketplaceRepos()` 返回的 id,且对应条目
 *  `install_mode = "builtin"`。后端调 `claude plugin install <target>`
 *  CLI 一步到位,不 git clone。 */
export function installBuiltinPlugin(pluginId: string): Promise<InstallResult> {
  return invoke<InstallResult>('install_builtin_plugin', { pluginId });
}

/** M3.4 — 第三方仓库单步装 (清单 11/12)。
 *
 *  单步完成 clone + scan + 循环 install。`selections` 是 `resource_id`
 *  列表(如 `["plugin/code-review", "command/deploy.md"]`)。
 *  不需要前端先 `cloneAndScan` 再 `installFromMarketplace` 两步。 */
export function installThirdPartyRepo(
  url: string,
  selections: string[],
  options?: InstallOptions,
): Promise<InstallResult[]> {
  return invoke<InstallResult[]>('install_third_party_repo', {
    url,
    selections,
    options: options ?? null,
  });
}

/** M3.4 — npx 装 (清单 14: GSD)。
 *
 *  `package` 形如 `@opengsd/gsd-core@latest`。后端调
 *  `npx <package> --global --silent`,落地到 `~/.claude/plugins/<basename>/`。 */
export function installNpxPackage(packageName: string): Promise<InstallResult> {
  return invoke<InstallResult>('install_npx_package', { package: packageName });
}
