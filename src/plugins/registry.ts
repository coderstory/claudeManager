/**
 * Frontend plugin registry — Phase 44 派生基线。
 *
 * The single source of truth for which plugins the React app
 * mounts AND the derived collections that consumers (AppSidebar,
 * App.tsx, useViewState) import. Mirrors `src-tauri/src/plugins/mod.rs
 * ::init_all` — when you add a plugin on the backend, add its
 * frontend stub import + entry here.
 *
 * ## Phase 44 派生导出 (44-DECISIONS §PLAN 2)
 *
 *   - ALL_VIEW_IDS    : readonly 11 项 (3 core + 8 plugin,Phase 46 D-44-A)
 *   - ALL_VIEWS_ORDERED : readonly 11 项,sidebarTile.order 字段驱动
 *   - PAGE_META       : 11 项 PageMeta (title + description)
 *   - VIEW_META       : 11 项 SidebarTile (icon + short + order + group)
 *   - VIEW_COMPONENTS : Map<11 项, ViewComponentEntry>
 *   - ALL_PLUGINS     : readonly 8 项 FrontendPlugin
 *   - ALL_ROUTES      : flatMap(p.routes) — 保留供未来 react-router
 *
 * Adding a new plugin:
 *   1. Write a new stub under `src/plugins/stubs/<id>.tsx` (or in
 *      `stubs/mod.ts`'s barrel) that exports a `FrontendPlugin`
 *      object with viewId + pageMeta + componentEntry + sidebarTile.
 *   2. Append the import + entry to `ALL_PLUGINS` below.
 *   3. ALL_VIEW_IDS / ALL_VIEWS_ORDERED / PAGE_META / VIEW_META /
 *      VIEW_COMPONENTS are auto-derived — no manual edits needed.
 *
 * "加 1 plugin 改 1 文件"强验收 (Task 7):
 *   - 加 1 stub + 1 行 ALL_PLUGINS.push, 不需要动 App.tsx /
 *     AppSidebar / useViewState / 任何 page 文件。
 */

import { Home, History, Info } from 'lucide-react';

import type {
  FrontendPlugin,
  SidebarTile,
  PageMeta,
  ViewComponentEntry,
  ViewContext,
} from './types';

import {
  providerListPlugin,
  importSqlPlugin,
  jsonEditorPlugin,
  usageQueryPlugin,
  resourceBrowserPlugin,
  marketplacePlugin,
  optimizerPlugin,
  backupRestorePlugin,
} from './stubs/mod';

// Page components imported eagerly for CORE_VIEWS (Q44-2).
import { HomeView } from '../pages/home';
import HistoryPage from '../pages/history';
import AboutPage from '../pages/about';

/**
 * ALL_PLUGINS — the 8 frontend plugin stubs in registry order.
 *
 * Phase 46 (D-44-A): mcp-management stub 删,mcp 入口迁到
 * resource-browser 的 mcp tab (Q44-3 migrateFrom 反向索引)。
 * 8 stub = F1/F3/F5/F7/F16/F17/F18/F19
 * (F2 合并到 F1, F4 删, F6=mcp 合并到 F16 resource-browser, F8 删)。
 */
export const ALL_PLUGINS: readonly FrontendPlugin[] = [
  providerListPlugin,
  importSqlPlugin,
  jsonEditorPlugin,
  usageQueryPlugin,
  resourceBrowserPlugin,
  marketplacePlugin,
  optimizerPlugin,
  backupRestorePlugin,
] as const;

/**
 * ALL_ROUTES — flatten all plugin routes for future React Router use.
 * App.tsx currently does NOT use this (view switching is via useState);
 * kept so the data is available when/if we switch back to react-router.
 */
export const ALL_ROUTES = ALL_PLUGINS.flatMap((p) => p.routes);

/**
 * CORE_VIEWS — the 3 non-plugin views: 'home' / 'history' / 'about'.
 *
 * Q44-2: 'history' 是 CORE_VIEW (M4.6 / Phase 21-C ship 的 SQLite 查询
 * UI,不是 F1-F24 任何一个),由 registry.ts 显式声明,不创建
 * history-plugin stub。
 */
const CORE_VIEWS = ['home', 'history', 'about'] as const;
export type CoreViewId = (typeof CORE_VIEWS)[number];

/**
 * PluginViewId — derived from ALL_PLUGINS, one literal per plugin.
 * Adding a new plugin automatically widens this union.
 */
export type PluginViewId = (typeof ALL_PLUGINS)[number]['viewId'];

/**
 * ViewId — canonical closed union of every reachable view.
 *
 * This is the SOURCE OF TRUTH for the ViewId type. Re-exported via
 * useViewState.tsx so consumers can `import { ViewId } from
 * '../hooks/useViewState'` (back-compat) or `import { ViewId } from
 * '../plugins/registry'` (canonical).
 */
export type ViewId = CoreViewId | PluginViewId;

/**
 * ALL_VIEW_IDS — readonly 11 项 (3 core + 8 plugin,Phase 46 D-44-A).
 *
 * Useful for tests (count assertion) and runtime iteration. Not the
 * sidebar order — that's `ALL_VIEWS_ORDERED` (field-driven).
 */
export const ALL_VIEW_IDS: readonly ViewId[] = [
  ...CORE_VIEWS,
  ...ALL_PLUGINS.map((p) => p.viewId),
] as const;

/**
 * CORE_SIDEBAR_TILE — 3 core views 的 sidebar tile。
 *
 * home.order=0 永远在第一位;history.order=100 / about.order=101
 * 永远在末尾(utility group)。Defined before ALL_VIEWS_ORDERED so
 * the field-driven sort can use it.
 */
const CORE_SIDEBAR_TILE: Record<CoreViewId, SidebarTile> = {
  home: { icon: Home, short: '欢迎页', order: 0, group: 'main' },
  history: { icon: History, short: '历史查询', order: 100, group: 'utility' },
  about: { icon: Info, short: '关于', order: 101, group: 'utility' },
};

/**
 * ALL_VIEWS_ORDERED — sidebar order driven by `sidebarTile.order` (Q44-1).
 *
 * Sort key is `sidebarTile.order` (ASC). Combined list of plugins
 * (orders 1-8) + core views (home=0, history=100, about=101) all
 * sorted by their `order` field. The order field makes "swap two
 * tiles" a 2-line edit instead of touching 4 files.
 */
const VIEW_ORDER_MAP: Record<string, number> = (() => {
  const map: Record<string, number> = {};
  for (const p of ALL_PLUGINS) {
    if (p.sidebarTile) map[p.viewId] = p.sidebarTile.order;
  }
  for (const id of CORE_VIEWS) {
    map[id] = CORE_SIDEBAR_TILE[id].order;
  }
  return map;
})();

export const ALL_VIEWS_ORDERED: readonly ViewId[] = [
  ...ALL_PLUGINS.filter((p): p is FrontendPlugin & { sidebarTile: SidebarTile } =>
    Boolean(p.sidebarTile),
  )
    .slice()
    .sort((a, b) => a.sidebarTile.order - b.sidebarTile.order)
    .map((p) => p.viewId),
  ...CORE_VIEWS,
]
  .slice()
  .sort((a, b) => (VIEW_ORDER_MAP[a] ?? 0) - (VIEW_ORDER_MAP[b] ?? 0)) as readonly ViewId[];

/**
 * CORE_PAGE_META — 3 core views 的中文 title + description。
 *
 * 不在 stub 文件里(避免 history / about 这种"非 plugin" view 也造一个
 * stub)。AppHeader / HomeView / PluginPlaceholder 全部消费 PAGE_META。
 */
const CORE_PAGE_META: Record<CoreViewId, PageMeta> = {
  home: {
    title: 'Claude 配置管理器',
    description: '选择一个功能开始',
  },
  history: {
    title: '历史查询',
    description: '按时间 / 项目 / 类型筛选 F7 用量 + F13 备份的历史记录。',
  },
  about: {
    title: '关于',
    description: '查看应用版本、build hash、许可证、致谢与技术栈。',
  },
};

/**
 * CORE_COMPONENT_ENTRY — 3 core views 的 component + propsBuilder。
 *
 * home 需要 onNavigate + pageTitle 用于 dashboard 跳转;
 * history / about 无 props (内部自管理 state)。
 */
const CORE_COMPONENT_ENTRY: Record<CoreViewId, ViewComponentEntry> = {
  home: {
    component: HomeView as unknown as ViewComponentEntry['component'],
    propsBuilder: (ctx) => ({
      onNavigate: ctx.onNavigate as unknown as never,
      pageTitle: ctx.pageTitleFn as unknown as never,
    }),
  },
  history: {
    component: HistoryPage as unknown as ViewComponentEntry['component'],
    propsBuilder: () => ({}),
  },
  about: {
    component: AboutPage as unknown as ViewComponentEntry['component'],
    propsBuilder: () => ({}),
  },
};

/**
 * PAGE_META — readonly 11 项 PageMeta record (Phase 46 D-44-A: 3 core + 8 plugin).
 *
 * Used by App.tsx `pageTitle(view)` and AppHeader breadcrumb.
 * Computed once at module load; frozen by `as const` on the literal.
 */
export const PAGE_META: Record<ViewId, PageMeta> = {
  ...CORE_PAGE_META,
  ...Object.fromEntries(ALL_PLUGINS.map((p) => [p.viewId, p.pageMeta])),
} as const;

/**
 * VIEW_META — readonly 11 项 SidebarTile record (Phase 46 D-44-A: 3 core + 8 plugin).
 *
 * SidebarTile.icon 是 LucideIcon (function),AppSidebar 渲染时
 *   const Icon = meta.icon;
 *   return <Icon size={18} />;
 * 不再 hardcode 11 个 ReactElement。
 */
export const VIEW_META: Record<ViewId, SidebarTile> = {
  ...CORE_SIDEBAR_TILE,
  ...Object.fromEntries(
    ALL_PLUGINS.filter((p): p is FrontendPlugin & { sidebarTile: SidebarTile } =>
      Boolean(p.sidebarTile),
    ).map((p) => [p.viewId, p.sidebarTile]),
  ),
} as const;

/**
 * VIEW_COMPONENTS — Map<ViewId, ViewComponentEntry>。
 *
 * MainView 查表:`VIEW_COMPONENTS.get(view)` → component + propsBuilder。
 * 注册 3 core views + 8 plugins = 11 项 (Phase 46 D-44-A)。
 */
export const VIEW_COMPONENTS = new Map<ViewId, ViewComponentEntry>([
  ...(Object.entries(CORE_COMPONENT_ENTRY) as [CoreViewId, ViewComponentEntry][]),
  ...ALL_PLUGINS.map(
    (p) => [p.viewId, p.componentEntry] as [PluginViewId, ViewComponentEntry],
  ),
]);

/**
 * Helper — build a ViewContext from the App-level state. Most consumers
 * (useViewState / MainView) construct it inline; this helper is for
 * tests and any future programmatic entry points.
 */
export function buildViewContext(args: {
  pendingSqlFile: string | null;
  onNavigate: (v: ViewId, query?: Record<string, string>) => void;
  pageTitleFn: (v: ViewId) => string;
}): ViewContext {
  return {
    pendingSqlFile: args.pendingSqlFile,
    onNavigate: args.onNavigate,
    pageTitleFn: args.pageTitleFn,
  };
}