/**
 * Frontend plugin system — shared types.
 *
 * Mirrors `src-tauri/src/plugins/traits.rs` on the backend. Keep both
 * in sync when adding or changing fields.
 */

import type { ComponentType } from 'react';
import type { LucideIcon } from 'lucide-react';

export interface RouteDef {
  /** URL path, e.g. `"/mcp"`. Used as the React Router `path` prop. */
  path: string;
  /** React component to render when the route matches. */
  component: ComponentType;
  /** Owning plugin id (kebab-case). */
  pluginId: string;
  /** Human-readable name, e.g. `"MCP 管理"`. */
  displayName: string;
}

/**
 * ViewId — closed union derived from registry at runtime.
 *
 * The canonical `ViewId = CoreViewId | PluginViewId` union lives
 * in `src/plugins/registry.ts` because it must include ALL_PLUGINS
 * derived literals. Here we use a `string` placeholder type so
 * registry.ts can narrow it without circular import issues; consumers
 * should import the canonical union from `registry` directly.
 *
 * Why a string placeholder (not a literal union): types.ts is the
 * dependency-free leaf; putting the literal union here would require
 * importing from registry.ts → registry.ts → types.ts (cycle). The
 * runtime types registry.ts exports are the source of truth.
 */
export type ViewId = string;

/**
 * SidebarTile — Phase 44 新增 (Q44-1 + Q44-3).
 *
 * 描述 sidebar 上一个 tile 的视觉 + 排序元数据。Sidebar 顺序由
 * `order` 字段驱动(不写死数组);`icon` 是 LucideIcon 组件(非
 * ReactElement)以允许 AppSidebar 自由 `<Icon size={18} />` 渲染;
 * `migrateFrom` 字段由 Phase 46 启用,把 stale viewId 路由到新 view。
 */
export interface SidebarTile {
  /** Lucide icon component (function). */
  icon: LucideIcon;
  /** Short Chinese label shown next to the icon in the sidebar. */
  short: string;
  /**
   * Sort key for ALL_VIEWS_ORDERED. Lower numbers render first.
   * Slots currently used:
   *   0 = home, 1..9 = plugin tiles in declaration order,
   *   100 = history, 101 = about.
   */
  order: number;
  /** Group bucket; rendered as a top/bottom split in the sidebar. */
  group?: 'main' | 'utility';
  /**
   * Phase 46 启用 (Q44-3): 当 localStorage 存的 viewId 是 fromViewId
   * (Phase 46 之前的 stale value),useViewState 应 fallback 到当前
   * plugin 的 viewId 并 append appendQuery 到 URL search。
   * Phase 44 仅在类型上声明,逻辑由 Phase 46-01 启用。
   */
  migrateFrom?: {
    fromViewId: string;
    appendQuery?: Record<string, string>;
  };
}

/**
 * PageMeta — Phase 44 新增 (44-DECISIONS §PLAN 1).
 *
 * 单 view 的页面标题 + 描述。App.tsx `pageTitle` / `pageDescription`
 * 函数读 PAGE_META[viewId] 不再 hardcode;HomeView 等也消费 PAGE_META
 * 显示中文标题。改了 plugin id 重命名 → 改这里 1 行。
 */
export interface PageMeta {
  /** Page-level title (header / AppHeader breadcrumb). */
  title: string;
  /** Page-level subtitle shown under the title. */
  description: string;
}

/**
 * ViewContext — Phase 44 新增 (44-DECISIONS §PLAN 1).
 *
 * App.tsx `MainView` 查表时构造,传给 propsBuilder,让每个 plugin
 * 拿到自己的 props。pendingSqlFile 是 F20 拖放/单实例分享的 .sql
 * 路径;onNavigate 是统一的页面跳转入口;pageTitleFn 是 read-only
 * title getter(配合 query param:Phase 46 启用)。
 *
 * 注:onNavigate 的 ViewId 参数使用此文件的 string placeholder。
 * 运行时窄 union (CoreViewId | PluginViewId) 由 registry.ts 导出,
 * 直接使用窄 union 时 TS 自动 assignable (string 兼容)。
 */
export interface ViewContext {
  pendingSqlFile: string | null;
  onNavigate: (v: ViewId, query?: Record<string, string>) => void;
  pageTitleFn: (v: ViewId) => string;
}

/**
 * ViewComponentEntry<P> — Phase 44 新增 (44-DECISIONS §PLAN 1).
 *
 * 把 plugin 的"页面组件 + props 构造器"打包成一个 entry,MainView 查
 * VIEW_COMPONENTS[viewId] 时拿到 component + propsBuilder。
 *
 * 泛型 P 是该 view 的 props shape。Phase 44 默认 P = any (R1 缓解
 * 措施);Phase 47 评估 per-view generic。
 */
export interface ViewComponentEntry<P = any> {
  /** React component to render for this view. */
  component: ComponentType<P>;
  /** Builds the props object from the runtime ViewContext. */
  propsBuilder: (ctx: ViewContext) => P;
}

/**
 * FrontendPlugin — Phase 44 扩展 (Q44-5 + 44-DECISIONS §PLAN 1).
 *
 * 加 3 个必填字段:
 *   - `viewId`     (NEW) — plugin 对应的 ViewId
 *   - `pageMeta`   (NEW) — 必填,首页 + HomeView 用
 *   - `componentEntry` (NEW) — 必填,App.tsx MainView 查表
 * `sidebarTile` 升级成 Phase 44 SidebarTile 形态(icon: LucideIcon +
 * order + group + migrateFrom)。`routes` 保留供未来 react-router。
 */
export interface FrontendPlugin {
  /** Stable, kebab-case identifier. Must match the backend `IPlugin::id`. */
  id: string;
  /** Human-readable name. Must match the backend `IPlugin::name`. */
  name: string;
  /** ViewId for this plugin. Currently must equal `id`. */
  viewId: string;
  /** Sidebar tile config; required to appear in the sidebar. */
  sidebarTile?: SidebarTile;
  /** Per-view page meta (title + description). Required. */
  pageMeta: PageMeta;
  /** Component + props builder. Required. */
  componentEntry: ViewComponentEntry;
  /** Routes the plugin contributes. Empty for action-only plugins. */
  routes: RouteDef[];
}