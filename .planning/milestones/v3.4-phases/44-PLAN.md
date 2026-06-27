# Phase 44 PLAN — 前端 route 派生化 (registry 派生 ALL_VIEWS + AppSidebar/App 三元链收敛)

**Phase:** 44
**Goal:** 把 9 个前端 plugin stub + 3 个 core view (home / history / about) 全部走 `src/plugins/registry.ts` 派生,实现"`SidebarTile.migrateFrom` 类型字段就位 + `FrontendPlugin` 扩展 viewId/pageMeta/componentEntry + `useViewState.tsx` 删 12 项硬编码 re-export 自 registry + `App.tsx` 三元链 12 分支 → 查表 + `AppSidebar.tsx` 删 12 项手写 Record 改 import VIEW_META + 12 page 加 data-testid + 9 stub 改造(含 mcp-management) + 60 张 5 主题 × 12 view 视觉矩阵 baseline 生成",使强验收"加 1 plugin 改 1 文件"(stub + 1 行 registry import,0 改其它文件)达成。

---

## 0. 来源与依据 (input provenance)

- **输入 1** `/Users/coderstory/CodeSource/winui3/.planning/milestones/v3.4-DECISIONS.md` (209 行,5 BLOCKING 已关闭;D-44-A mcp-management 删由 Phase 46 负责,Phase 44 保留 stub)
- **输入 2** `/Users/coderstory/CodeSource/winui3/.planning/milestones/v3.4-phases/44-DECISIONS.md` (5 OQ 关闭:Q44-1 ALL_VIEWS_ORDERED 字段驱动 / Q44-2 CORE_VIEWS 含 history / Q44-3 migrateFrom 字段 + 示例填 resource-browser / Q44-4 json-editor/usage-query routes 填 placeholder / Q44-5 9 stub 全改造)
- **输入 3** `/Users/coderstory/CodeSource/winui3/.planning/milestones/v3.4-phases/43-DECISIONS.md` (Q43-2 SwitchView emit `"frontend://switch-view"`,Phase 44 App.tsx 需 listen — 但本 PLAN 不新增 listen,沿用 useViewState setView 路径)
- **输入 4** `/Users/coderstory/CodeSource/winui3/.planning/milestones/v3.4-phases/46-PLAN.md` (Phase 46 依赖本 phase 的 `SidebarTile.migrateFrom` 字段 + `ALL_VIEW_META` 派生 + resource-browser migrateFrom 示例,本 PLAN 不动 App.tsx:174-197 stale useEffect 兜底 — Phase 46 删)
- **输入 5** `/Users/coderstory/CodeSource/winui3/.planning/milestones/v3.4-phases/42-PLAN.md` (Phase 42 命令迁移已就位,本 PLAN 不动 src-tauri/)
- **项目实测 (基线日 2026-06-27)**:
  - `src/plugins/registry.ts` 52 行,`ALL_PLUGINS = [9 项]`,仅 routes 字段
  - `src/plugins/types.ts` 28 行,`FrontendPlugin = { id, name, routes }`
  - `src/plugins/stubs/*.tsx` 9 stub (provider-list / import-sql / json-editor / mcp-management / usage-query / resource-browser / marketplace / optimizer / backup-restore) — 每个内联 placeholder page
  - `src/plugins/stubs/mod.ts` 9 行 re-export
  - `src/plugins/stubs/_Placeholder.tsx` 24 行
  - `src/hooks/useViewState.tsx` 236 行,`ALL_VIEWS` 12 项硬编码 `readonly ViewId[]`
  - `src/App.tsx` 720 行,12 项 `view === 'x' ? <X /> : ...` 三元链 (lines 608-633);`PAGE_META` 11 项 `Record<ViewId, ...>` (lines 92-141);`useEffect` lines 174-197 stale-route 兜底(Phase 46 删,本 PLAN 不动)
  - `src/components/AppSidebar.tsx` 181 行,`VIEW_META` 12 项 `Record<ViewId, { icon, short }>` 硬编码 (lines 49-101),`ALL_VIEWS` 来源 useViewState
  - `src/__tests__/plugin-registry.test.ts` 48 行,断言 `ALL_PLUGINS.length === 9`
  - 基线数字:view=11(实测,overview 12 估错)、commands=80、frontend stub=9、useViewState=121 引用点(Phase 44 不动引用点代码,仅 import 源)

## 1. Goal (强验收 = phase 完成标准)

> **核心强验收 (44-DECISIONS §强验收 + overview §3 Phase 44)**:
>
> 1. **`SidebarTile.migrateFrom` 字段类型就位** — `src/plugins/types.ts` 加 `migrateFrom?: { fromViewId: string; appendQuery?: Record<string,string> }`,`resource-browser.tsx` 填 `{ fromViewId: 'mcp-management', appendQuery: { tab: 'mcp' } }` (Q44-3)
> 2. **`FrontendPlugin` 扩展 4 字段** — `viewId` / `pageMeta` / `componentEntry.component` / `componentEntry.propsBuilder` (per 44-DECISIONS §PLAN 1)
> 3. **`registry.ts` 派生 5 导出** — `ALL_VIEW_IDS` / `ALL_VIEWS_ORDERED` / `PAGE_META` / `VIEW_META` / `VIEW_COMPONENTS: Map<ViewId, ViewComponentEntry>` (per 44-DECISIONS §PLAN 2)
> 4. **`useViewState.tsx` 删 12 项硬编码 ALL_VIEWS** — 改 `re-export` 自 registry (`export { ALL_VIEW_IDS as ALL_VIEWS } from '../plugins/registry'`);`ViewId` 类型 import 自 registry (`export type { ViewId }`)
> 5. **`App.tsx` 三元链 12 分支 → 查表** — `MainView` 用 `VIEW_COMPONENTS.get(view)` + `entry.component` + `entry.propsBuilder({ pendingSqlFile, onNavigate, pageTitleFn })`;`pageTitle` 函数读 `PAGE_META[view].title` 不变,`PAGE_META` 改 import 自 registry
> 6. **`AppSidebar.tsx` 删 12 项手写 VIEW_META** — import `VIEW_META` 自 registry;icon 渲染 `const Icon = meta.icon; return <Icon size={18} />`(ReactElement → LucideIcon 类型变化);sidebar 顺序走 `ALL_VIEWS_ORDERED`
> 7. **12 page 加 `data-testid`** — 每个 page 顶层根元素加 `<XPage data-testid="<viewId>-page" />`,Playwright e2e 用
> 8. **`plugin-registry.test.ts` 重写** — 9 stub(含 mcp-management,Phase 47 改 8)每个有 `viewId / pageMeta / componentEntry` 断言
> 9. **"加 1 plugin 改 1 文件"强验收** — 加 1 个 stub `stubs/_test_strong.tsx`(临时)+ `registry.ts` 1 行 import + 1 行 `ALL_PLUGINS.push`,`git diff` 应仅这 2 文件 + 不动 App.tsx / AppSidebar / useViewState / 任何 page;验证后删 `_test_strong`
> 10. **视觉矩阵 60 张 baseline** — 12 view × 5 主题 = 60 张,Playwright `--update-snapshots` 一次性生成;baseline 文件落盘 `tests/e2e/visual-baselines/<theme>-<view>.png`;Phase 47 整合期 60 张比 PASS
> 11. **M31 vibrancy 撤回后视觉等价** — 视觉矩阵 60 张反映**新 AppHeader layout**(无 `.topbar-center` 居中 app 名 + WindowControls 回到 topbar-right),不依赖已删的 `.wc-btn` / `.topbar-center` 类名
> 12. **`json-editor` / `usage-query` routes 字段填 placeholder path** — `routes: [{ path: '/json', ... }, { path: '/usage', ... }]` (Q44-4,非 `_Placeholder`)
> 13. **强验收 grep lint** — `useViewState.tsx` 0 行手写 ALL_VIEWS / `App.tsx` 0 行 `view === 'x' ?` 三元链 / `AppSidebar.tsx` 0 行手写 VIEW_META Record

---

## 2. 工作量与估时

| 项目 | 估值 | 来源 |
|---|---|---|
| 类型字段扩展 | 4 (`SidebarTile.migrateFrom` / `PageMeta` / `ViewComponentEntry<P>` / `FrontendPlugin` 加 viewId+pageMeta+componentEntry) | 44-DECISIONS §PLAN 1 |
| 新增文件 | ~3 (`src/plugins/__tests__/registry-derive.test.ts` 派生单测 + `tests/e2e/visual-matrix.spec.ts` 视觉矩阵 + `tests/e2e/visual-baselines/` 目录) | Task 1 + Task 6 |
| 修改文件 | ~14 (`types.ts` + `registry.ts` + 9 stub `.tsx` + `useViewState.tsx` + `App.tsx` + `AppSidebar.tsx` + 12 page 加 data-testid + `plugin-registry.test.ts`) | 强验收 1-8 |
| 新增测试 | ~8 (registry-derive.test.ts 5 derive 单测 + plugin-registry.test.ts 改 9 stub viewId/pageMeta/componentEntry 断言 + visual-matrix.spec.ts 60 张视觉断言) | 44-DECISIONS §PLAN 7 |
| 工作量估时 | **2.5-3 天** (0.4 天 types + registry 派生 + 9 stub 重写 / 0.3 天 useViewState re-export + AppSidebar / 0.4 天 App.tsx 三元链 → 查表 / 0.3 天 12 page data-testid / 0.3 天 plugin-registry.test.ts 重写 / 0.5 天 视觉矩阵 spec + 60 张 baseline 生成 / 0.2 天 "加 1 plugin 改 1 文件" 强验收 + 收尾) | sccache + Vite HMR |

## 3. 任务拆分 (Tasks)

按 TDD 红绿重构流 (CLAUDE.md §2.2) + 依赖顺序,共 7 个 task,3 个 wave:

```
Wave 0 (类型 + 派生基线): Task 1 (types + registry + 9 stub 重写) → Task 2 (registry-derive.test.ts 5 单测)
Wave 1 (消费 + 收敛):   Task 3 (useViewState re-export + AppSidebar import 派生) → Task 4 (App.tsx 三元链 → 查表)
Wave 2 (测试 + 视觉):   Task 5 (12 page data-testid + plugin-registry.test.ts 重写) → Task 6 (视觉矩阵 60 张 baseline) → Task 7 ("加 1 plugin 改 1 文件" 强验收)
```

---

### Task 1: `types.ts` 扩展 + `registry.ts` 派生 + 9 stub 重写 (Wave 0)

**文件**:
- 修改: `/Users/coderstory/CodeSource/winui3/src/plugins/types.ts` (加 4 字段 / 1 migrateFrom)
- 修改: `/Users/coderstory/CodeSource/winui3/src/plugins/registry.ts` (重写,加 5 派生导出)
- 修改: 9 个 stub `/Users/coderstory/CodeSource/winui3/src/plugins/stubs/{provider-list,import-sql,json-editor,mcp-management,usage-query,resource-browser,marketplace,optimizer,backup-restore}.tsx` (每个加 viewId/pageMeta/componentEntry + SidebarTile)
- 修改: `/Users/coderstory/CodeSource/winui3/src/plugins/stubs/mod.ts` (re-export 不变)

**TDD 红绿重构流**:
1. **Red**: 跑现有 `vitest` — `App.tsx` / `AppSidebar` / `useViewState` 等依赖类型扩展,期望相关测试 FAIL (types 未扩展前)
2. **Green**: types.ts 扩展 (SidebarTile.migrateFrom + PageMeta + ViewComponentEntry<P> + FrontendPlugin.viewId/pageMeta/componentEntry + ViewContext),registry.ts 加派生 5 导出,9 stub 改 FrontendPlugin 形态
3. **Refactor**: 检查 SidebarTile.order 1-9 字段值(per Q44-1),resource-browser migrateFrom 填示例(per Q44-3)

**实现要点** (per 44-DECISIONS §PLAN 1 + §PLAN 2):

```typescript
// src/plugins/types.ts (Phase 44 扩展)
import type { ComponentType, ReactElement } from 'react';
import type { LucideIcon } from 'lucide-react';

export interface RouteDef {
  path: string;
  component: ComponentType;
  pluginId: string;
  displayName: string;
}

// NEW Phase 44
export interface SidebarTile {
  icon: LucideIcon;            // 组件,不是 ReactElement
  short: string;
  order: number;               // Q44-1 字段驱动 ALL_VIEWS_ORDERED
  group?: 'main' | 'utility';
  migrateFrom?: {              // Q44-3 Phase 46 启用
    fromViewId: string;
    appendQuery?: Record<string, string>;
  };
}

export interface PageMeta {
  title: string;
  description: string;
}

export interface ViewContext {
  pendingSqlFile: string | null;
  onNavigate: (v: ViewId, query?: Record<string, string>) => void;
  pageTitleFn: (v: ViewId) => string;
}

export interface ViewComponentEntry<P = any> {
  component: ComponentType<P>;
  propsBuilder: (ctx: ViewContext) => P;
}

export interface FrontendPlugin {
  id: string;
  name: string;
  viewId: string;                       // NEW
  sidebarTile?: SidebarTile;            // 3 core view (home/history/about) 也填
  pageMeta: PageMeta;                   // NEW 必填
  componentEntry: ViewComponentEntry;   // NEW
  routes: RouteDef[];                   // 保留供未来 react-router
}

// 联合类型在 registry.ts 派生,types.ts 不引 ViewId 字面量,避免循环
export type ViewId = string & { readonly __brand: 'ViewId' };
```

```typescript
// src/plugins/registry.ts (Phase 44 重写)
import type {
  FrontendPlugin, SidebarTile, PageMeta, ViewComponentEntry, ViewContext,
} from './types';
import {
  providerListPlugin, importSqlPlugin, jsonEditorPlugin,
  mcpManagementPlugin, usageQueryPlugin, resourceBrowserPlugin,
  marketplacePlugin, optimizerPlugin, backupRestorePlugin,
} from './stubs/mod';

export const ALL_PLUGINS: readonly FrontendPlugin[] = [
  providerListPlugin, importSqlPlugin, jsonEditorPlugin,
  mcpManagementPlugin, usageQueryPlugin, resourceBrowserPlugin,
  marketplacePlugin, optimizerPlugin, backupRestorePlugin,
] as const;

// Q44-2: home / history / about = CORE_VIEW, 显式 import
import { HomeView } from '../pages/home';
import HistoryPage from '../pages/history';
import AboutPage from '../pages/about';
import { Home, History, Info } from 'lucide-react';

const CORE_VIEWS = ['home', 'history', 'about'] as const;
export type CoreViewId = typeof CORE_VIEWS[number];
export type PluginViewId = (typeof ALL_PLUGINS)[number]['viewId'];
export type ViewId = CoreViewId | PluginViewId;

export const ALL_VIEW_IDS = [
  ...CORE_VIEWS,
  ...ALL_PLUGINS.map((p) => p.viewId),
] as const satisfies readonly ViewId[];

// Q44-1: sidebarTile.order 字段驱动
export const ALL_VIEWS_ORDERED = [
  ...ALL_PLUGINS.filter((p) => p.sidebarTile)
    .sort((a, b) => (a.sidebarTile!.order - b.sidebarTile!.order))
    .map((p) => p.viewId),
  ...CORE_VIEWS,  // history (order=100) + about (order=101) 在末尾
] as const satisfies readonly ViewId[];

// 3 core view 的 pageMeta + sidebarTile 派生点(显式声明,不放 stub)
const CORE_PAGE_META: Record<CoreViewId, PageMeta> = {
  home: { title: 'Claude 配置管理器', description: '选择一个功能开始' },
  history: { title: '历史查询', description: '按时间 / 项目 / 类型筛选 F7 用量 + F13 备份的历史记录。' },
  about: { title: '关于', description: '查看应用版本、build hash、许可证、致谢与技术栈。' },
};
const CORE_SIDEBAR_TILE: Record<CoreViewId, SidebarTile> = {
  home: { icon: Home, short: '欢迎页', order: 0, group: 'main' },
  history: { icon: History, short: '历史查询', order: 100, group: 'utility' },
  about: { icon: Info, short: '关于', order: 101, group: 'utility' },
};
const CORE_COMPONENT_ENTRY: Record<CoreViewId, ViewComponentEntry> = {
  home: { component: HomeView, propsBuilder: (ctx) => ({ onNavigate: ctx.onNavigate, pageTitle: ctx.pageTitleFn }) },
  history: { component: HistoryPage, propsBuilder: () => ({}) },
  about: { component: AboutPage, propsBuilder: () => ({}) },
};

export const PAGE_META: Record<ViewId, PageMeta> = {
  ...CORE_PAGE_META,
  ...Object.fromEntries(ALL_PLUGINS.map((p) => [p.viewId, p.pageMeta])),
} as const;

export const VIEW_META: Record<ViewId, SidebarTile> = {
  ...CORE_SIDEBAR_TILE,
  ...Object.fromEntries(
    ALL_PLUGINS.filter((p) => p.sidebarTile).map((p) => [p.viewId, p.sidebarTile!]),
  ),
} as const;

// Q44-4: routes 字段填 placeholder path,引用真实 page
export const ALL_ROUTES = ALL_PLUGINS.flatMap((p) => p.routes);

export const VIEW_COMPONENTS = new Map<ViewId, ViewComponentEntry>([
  ...(Object.entries(CORE_COMPONENT_ENTRY) as [CoreViewId, ViewComponentEntry][]),
  ...ALL_PLUGINS.map((p) => [p.viewId, p.componentEntry] as const),
]);
```

```typescript
// src/plugins/stubs/resource-browser.tsx (Phase 44 改写)
import React from 'react';
import type { FrontendPlugin } from '../types';
import { PluginPlaceholder } from './_Placeholder';
import { FileSearch } from 'lucide-react';
import ResourceBrowserPage from '../../pages/resource-browser';  // 真实 page

const ResourceBrowserSidebarTileIcon = FileSearch;

export const resourceBrowserPlugin: FrontendPlugin = {
  id: 'resource-browser',
  name: '资源浏览',
  viewId: 'resource-browser',
  sidebarTile: {
    icon: ResourceBrowserSidebarTileIcon,
    short: '资源浏览',
    order: 6,
    group: 'main',
    // Q44-3: 填示例(Phase 46 启用)
    migrateFrom: {
      fromViewId: 'mcp-management',
      appendQuery: { tab: 'mcp' },
    },
  },
  pageMeta: {
    title: '资源浏览',
    description: '按 Plugins / Skills / Commands / LSP / MCP 分类查看当前启用的资源。',
  },
  componentEntry: {
    component: ResourceBrowserPage as React.ComponentType<any>,
    propsBuilder: () => ({}),
  },
  routes: [
    {
      path: '/resources',
      component: ResourceBrowserPage as React.ComponentType,
      pluginId: 'resource-browser',
      displayName: '资源浏览',
    },
  ],
};
```

**验证命令**:
```bash
cd /Users/coderstory/CodeSource/winui3 && npx tsc --noEmit  # 类型检查
cd /Users/coderstory/CodeSource/winui3 && npx vitest run src/__tests__/plugin-registry.test.ts  # 旧测试可能因类型扩展 FAIL(预期 Red)
grep -c "viewId:" /Users/coderstory/CodeSource/winui3/src/plugins/stubs/*.tsx  # 期望 9(每 stub 1 行)
grep -c "sidebarTile:" /Users/coderstory/CodeSource/winui3/src/plugins/stubs/*.tsx  # 期望 9(都填)
grep -c "componentEntry:" /Users/coderstory/CodeSource/winui3/src/plugins/stubs/*.tsx  # 期望 9
grep -c "migrateFrom:" /Users/coderstory/CodeSource/winui3/src/plugins/stubs/*.tsx  # 期望 1(仅 resource-browser)
```

**Done 标准**:
- types.ts 编译通过 (4 新字段 / 1 migrateFrom)
- registry.ts 5 派生导出 (`ALL_VIEW_IDS` / `ALL_VIEWS_ORDERED` / `PAGE_META` / `VIEW_META` / `VIEW_COMPONENTS`)
- 9 stub 全部含 `viewId` / `pageMeta` / `componentEntry` / `sidebarTile`
- resource-browser stub 含 `migrateFrom: { fromViewId: 'mcp-management', appendQuery: { tab: 'mcp' } }`
- json-editor / usage-query `routes` 字段填 placeholder path(`/json` / `/usage`),非 `_Placeholder`

**估时**: 0.4 天

---

### Task 2: registry-derive 单测 (Wave 0, TDD scaffold)

**文件**:
- 新增: `/Users/coderstory/CodeSource/winui3/src/plugins/__tests__/registry-derive.test.ts`

**TDD 红绿重构流**:
1. **Red**: 写 5 个派生单测(本阶段全 FAIL,因为派生导出未就位)
   - `ALL_VIEW_IDS.length === 12` (3 core + 9 plugin)
   - `ALL_VIEWS_ORDERED` 包含全部 12 项 + 顺序由 `sidebarTile.order` 驱动(断言 `ALL_VIEWS_ORDERED[0] === 'home'`,`ALL_VIEWS_ORDERED[10] === 'history'`,`ALL_VIEWS_ORDERED[11] === 'about'`)
   - `PAGE_META` 全部 12 项有 title + description 字段
   - `VIEW_META` 全部 12 项有 icon (LucideIcon) + short + order + group
   - `VIEW_COMPONENTS.get('home')` 返回 `ViewComponentEntry` 含 component + propsBuilder
2. **Green**: Task 1 派生实现完毕 → 测试 PASS
3. **Refactor**: 加 `expect(VIEW_COMPONENTS.size).toBe(12)` 防御性断言

**单测骨架**:
```typescript
// src/plugins/__tests__/registry-derive.test.ts (Phase 44 新增)
import { describe, it, expect } from 'vitest';
import {
  ALL_PLUGINS, ALL_VIEW_IDS, ALL_VIEWS_ORDERED,
  PAGE_META, VIEW_META, VIEW_COMPONENTS,
} from '../registry';
import type { SidebarTile, ViewComponentEntry, PageMeta } from '../types';

describe('registry.ts derived exports — Phase 44 派生收敛', () => {
  it('ALL_VIEW_IDS = 3 core + 9 plugin = 12', () => {
    expect(ALL_VIEW_IDS.length).toBe(12);
    expect(ALL_VIEW_IDS).toContain('home');
    expect(ALL_VIEW_IDS).toContain('history');
    expect(ALL_VIEW_IDS).toContain('about');
    expect(ALL_PLUGINS.length).toBe(9);  // 含 mcp-management(Phase 47 改 8)
  });

  it('ALL_VIEWS_ORDERED 由 sidebarTile.order 字段驱动', () => {
    expect(ALL_VIEWS_ORDERED.length).toBe(12);
    expect(ALL_VIEWS_ORDERED[0]).toBe('home');     // order=0
    expect(ALL_VIEWS_ORDERED[10]).toBe('history'); // order=100
    expect(ALL_VIEWS_ORDERED[11]).toBe('about');   // order=101
  });

  it('PAGE_META 全部 12 view 都有 title + description', () => {
    for (const id of ALL_VIEW_IDS) {
      const meta = PAGE_META[id as keyof typeof PAGE_META];
      expect(meta.title.length, `${id}.title 空`).toBeGreaterThan(0);
      expect(meta.description.length, `${id}.description 空`).toBeGreaterThan(0);
    }
  });

  it('VIEW_META 全部 12 view 都有 icon (LucideIcon) + short + order + group', () => {
    for (const id of ALL_VIEW_IDS) {
      const tile = VIEW_META[id as keyof typeof VIEW_META];
      expect(typeof tile.icon, `${id}.icon 应为 LucideIcon (function), 不是 ReactElement`).toBe('function');
      expect(tile.short.length, `${id}.short 空`).toBeGreaterThan(0);
      expect(typeof tile.order, `${id}.order 应为 number`).toBe('number');
      expect(tile.group, `${id}.group 应为 main|utility`).toMatch(/^(main|utility)$/);
    }
  });

  it('VIEW_COMPONENTS Map 12 项 + component + propsBuilder', () => {
    expect(VIEW_COMPONENTS.size).toBe(12);
    for (const id of ALL_VIEW_IDS) {
      const entry = VIEW_COMPONENTS.get(id as keyof typeof VIEW_COMPONENTS);
      expect(entry, `${id} 应有 componentEntry`).toBeDefined();
      expect(typeof entry!.component, `${id}.component 应为 ComponentType`).toBe('function');
      expect(typeof entry!.propsBuilder, `${id}.propsBuilder 应为 function`).toBe('function');
    }
  });
});
```

**验证命令**:
```bash
cd /Users/coderstory/CodeSource/winui3 && npx vitest run src/plugins/__tests__/registry-derive.test.ts
```

**Done 标准**:
- 5 个派生单测全 PASS
- 单测覆盖 12 view × 5 派生导出(60 断言)

**估时**: 0.2 天(测试与 Task 1 并行写,等 Task 1 完毕 PASS)

---

### Task 3: `useViewState.tsx` re-export + `AppSidebar.tsx` import 派生 (Wave 1)

**文件**:
- 修改: `/Users/coderstory/CodeSource/winui3/src/hooks/useViewState.tsx` (删 12 项硬编码 ALL_VIEWS + ViewId 字面量联合 + Phase 27 Fix 6 注释)
- 修改: `/Users/coderstory/CodeSource/winui3/src/components/AppSidebar.tsx` (删 12 项手写 VIEW_META Record + lucide-react 9 个 icon import)

**TDD 红绿重构流**:
1. **Red**: 跑 `npx vitest run src/__tests__/hooks/useViewState.test.tsx` — 应 FAIL(useViewState.tsx 重新 export 后,旧 `ALL_VIEWS` 引用路径不变但内容来自 registry)
2. **Green**: useViewState.tsx 改成 `export { ALL_VIEW_IDS as ALL_VIEWS, type ViewId } from '../plugins/registry'`,保留 `HOME_VIEW` / `STORAGE_KEY` / `ViewStateProvider` / `useViewState` 实现
3. **Green**: AppSidebar.tsx 删 `VIEW_META` 12 项手写 Record,import `VIEW_META` 自 registry;icon 渲染从 `<meta.icon />` 改为 `const Icon = meta.icon; return <Icon size={18} />`
4. **Refactor**: useViewState.tsx 头部 Phase 27 Fix 6 注释改成"由 Phase 46 通过 SidebarTile.migrateFrom 取代"(本阶段不动 stale useEffect)

**实现要点** (useViewState.tsx 收尾):
```typescript
// src/hooks/useViewState.tsx (Phase 44 后)
// 保留这些本地常量(非视图派生)
export const HOME_VIEW = 'home' as const;
export const STORAGE_KEY = 'ccm.lastView' as const;

// 视图派生全部 re-export 自 registry(0 行手写 ALL_VIEWS)
export { ALL_VIEW_IDS as ALL_VIEWS, type ViewId } from '../plugins/registry';

import { ALL_VIEW_IDS as ALL_VIEWS } from '../plugins/registry';

function isValidView(v: string | null): v is ViewId {
  return v !== null && (ALL_VIEWS as readonly string[]).includes(v);
}

// ViewStateProvider / useViewState 实现保留
// ALL_VIEWS 通过 useMemo 暴露给 consumer:
const value = useMemo<UseViewStateResult>(
  () => ({ view, setView, allViews: ALL_VIEWS }),
  [view, setView],
);
```

**实现要点** (AppSidebar.tsx icon 渲染):
```tsx
// 删 lines 49-101 VIEW_META 12 项手写 Record
// 删 lucide-react 9 个 icon import (Archive/Database/FileSearch/Gauge/History/Home/Info/Layers/Package/PencilLine/Store/Wand2)
// 改 import:
import { VIEW_META } from '../plugins/registry';

// icon 渲染(原 lines 152-153):
const Icon = meta.icon;
return (
  <span className="nav-item-icon">
    <Icon size={18} aria-hidden="true" />
  </span>
);

// 顺序走 ALL_VIEWS_ORDERED(原 ALL_VIEWS):
import { ALL_VIEWS_ORDERED } from '../plugins/registry';
// ...
{ALL_VIEWS_ORDERED.map((view) => {
  const meta = VIEW_META[view];
  // ...
})}
```

**验证命令**:
```bash
cd /Users/coderstory/CodeSource/winui3 && npx tsc --noEmit
cd /Users/coderstory/CodeSource/winui3 && npx vitest run src/__tests__/hooks/useViewState.test.tsx
grep -c "icon:" /Users/coderstory/CodeSource/winui3/src/components/AppSidebar.tsx  # 期望 0(无手写 VIEW_META)
grep -c "ALL_VIEWS_ORDERED" /Users/coderstory/CodeSource/winui3/src/components/AppSidebar.tsx  # 期望 1(import)
```

**Done 标准**:
- useViewState.tsx 0 行 `const ALL_VIEWS: readonly ViewId[] = [ ... ]` 硬编码(grep `^export const ALL_VIEWS: readonly ViewId\[\] = \[` = 0)
- AppSidebar.tsx 0 行 `^const VIEW_META: Record<` 手写(grep 0)
- 12 个 sidebar tile 仍渲染(原 `ALL_VIEWS.map` 改 `ALL_VIEWS_ORDERED.map`)
- 单测 + tsc 全 PASS

**估时**: 0.3 天

---

### Task 4: `App.tsx` 三元链 → 查表 + PAGE_META 派生 (Wave 1, 主工作量)

**文件**:
- 修改: `/Users/coderstory/CodeSource/winui3/src/App.tsx` (删 12 项 `view === 'x' ?` 三元链 + 11 项手写 PAGE_META + 12 page import + 9 page 实际使用页)
- 修改: 12 个 page 的顶层根元素加 `data-testid`(本 Task 不动,Task 5 处理)

**TDD 红绿重构流**:
1. **Red**: 跑 `npx tsc --noEmit` — 期望 `App.tsx` 因为 imports + page 类型未消费而 FAIL(如果 Task 3 未完成)
2. **Green**: 重写 App.tsx `MainView` 子组件为查表形式
3. **Green**: `pageTitle` / `pageDescription` 改读 `PAGE_META[view]`
4. **Refactor**: 删 11 项手写 `PAGE_META` + 12 个 page import + 9 个 page 实际 `<X />` 使用

**实现要点** (`App.tsx` `MainView` 查表,per 44-DECISIONS §PLAN 4):

```tsx
// src/App.tsx (Phase 44 后)
import {
  VIEW_COMPONENTS, PAGE_META, type ViewId,
} from './plugins/registry';
import { PluginPlaceholder } from './components/PluginPlaceholder';

// pageTitle / pageDescription 改派生
function pageTitle(view: ViewId): string {
  return PAGE_META[view].title;
}
function pageDescription(view: ViewId): string {
  return PAGE_META[view].description;
}

// MainView 查表(取代 12 项三元链)
function MainView({
  view, pendingSqlFile, onNavigate, pageTitleFn,
}: {
  view: ViewId;
  pendingSqlFile: string | null;
  onNavigate: (v: ViewId, query?: Record<string, string>) => void;
  pageTitleFn: (v: ViewId) => string;
}): ReactElement {
  const entry = VIEW_COMPONENTS.get(view);
  if (!entry) {
    return (
      <PluginPlaceholder
        pluginId={view}
        title={pageTitle(view)}
        description={pageDescription(view)}
      />
    );
  }
  const Comp = entry.component;
  const props = entry.propsBuilder({
    pendingSqlFile,
    onNavigate,
    pageTitleFn,
  });
  return <Comp {...props} />;
}

// 渲染位置(原 lines 608-633):
<div key={view} data-testid="app-view" className="view-transition">
  <MainView
    view={view}
    pendingSqlFile={pendingSqlFile}
    onNavigate={handleNavigate}
    pageTitleFn={pageTitleFn}
  />
</div>
```

**`handleNavigate` 签名变化** (per ViewContext.onNavigate):
```tsx
// 原 (v: ViewId) => setView(v) 一参
// 新 (v: ViewId, query?: Record<string, string>) => setView(v) — query 透传但本阶段不消费,留 Phase 46 启用
const handleNavigate = useCallback((v: ViewId, _query?: Record<string, string>): void => {
  setView(v);
}, [setView]);
```

**待删除 import** (原 lines 60-75):
```tsx
// 删 12 page import:
import { HomeView } from './pages/home';                                    // → MainView 走 VIEW_COMPONENTS,删
import { ProviderListPage } from './pages/provider-list';                  // → 删
import { ImportSqlPage } from './pages/import-sql';                        // → 删
import JsonEditorPage from './pages/json-editor';                          // → 删
// Phase 27 Fix 6 注释 + mcp-management page 引用                          // → 删
import OptimizerPage from './pages/optimizer';                              // → 删
import UsageQueryPage from './pages/usage-query';                          // → 删
import ResourceBrowserPage from './pages/resource-browser';                // → 删
import MarketplacePage from './pages/marketplace';                          // → 删
import BackupRestorePage from './pages/backup-restore';                    // → 删
import HistoryPage from './pages/history';                                  // → 删
import AboutPage from './pages/about';                                      // → 删

// 留 ALL_VIEWS (供 useKeyboardShortcuts Ctrl+1..9):保留 import 但走 registry re-export
```

**`App.tsx:174-197` stale useEffect**: Phase 46 删,本 PLAN **不动**;注释改成"由 Phase 46 通过 SidebarTile.migrateFrom + VIEW_ID_MIGRATIONS 取代"

**验证命令**:
```bash
cd /Users/coderstory/CodeSource/winui3 && npx tsc --noEmit
grep -cE "view === '[a-z-]+'" /Users/coderstory/CodeSource/winui3/src/App.tsx  # 期望 0(无三元链)
grep -cE "^const PAGE_META: Record<" /Users/coderstory/CodeSource/winui3/src/App.tsx  # 期望 0
grep -c "VIEW_COMPONENTS" /Users/coderstory/CodeSource/winui3/src/App.tsx  # 期望 ≥1
```

**Done 标准**:
- App.tsx 0 行 `view === 'x' ?` 三元链
- App.tsx 0 行手写 `PAGE_META` Record
- MainView 查表 + propsBuilder 编译通过
- 12 page 视觉渲染等价(由 Task 5 视觉矩阵 60 张验证)
- tsc 全 PASS

**估时**: 0.4 天

---

### Task 5: 12 page 加 `data-testid` + `plugin-registry.test.ts` 重写 (Wave 2)

**文件**:
- 修改: 12 个 page 顶层根元素,加 `data-testid`:
  - `/Users/coderstory/CodeSource/winui3/src/pages/home/index.tsx` (已有 `home-page`?检查并加)
  - `/Users/coderstory/CodeSource/winui3/src/pages/provider-list/index.tsx` (加 `provider-list-page`)
  - `/Users/coderstory/CodeSource/winui3/src/pages/import-sql/index.tsx` (加 `import-sql-page`)
  - `/Users/coderstory/CodeSource/winui3/src/pages/json-editor/index.tsx` (加 `json-editor-page`)
  - `/Users/coderstory/CodeSource/winui3/src/pages/usage-query/index.tsx` (加 `usage-query-page`)
  - `/Users/coderstory/CodeSource/winui3/src/pages/resource-browser/index.tsx` (已有 `resource-browser-page` ✓)
  - `/Users/coderstory/CodeSource/winui3/src/pages/marketplace/index.tsx` (加 `marketplace-page`)
  - `/Users/coderstory/CodeSource/winui3/src/pages/optimizer/index.tsx` (加 `optimizer-page`)
  - `/Users/coderstory/CodeSource/winui3/src/pages/backup-restore/index.tsx` (加 `backup-restore-page`)
  - `/Users/coderstory/CodeSource/winui3/src/pages/history/index.tsx` (加 `history-page`)
  - `/Users/coderstory/CodeSource/winui3/src/pages/about/index.tsx` (加 `about-page`)
  - `/Users/coderstory/CodeSource/winui3/src/pages/mcp-management/index.tsx` (Phase 46 删 stub 时一并删 page;本 Task 不加 data-testid,Phase 47 评估)
- 修改: `/Users/coderstory/CodeSource/winui3/src/__tests__/plugin-registry.test.ts` (重写,加 viewId/pageMeta/componentEntry 断言)

**TDD 红绿重构流**:
1. **Red**: 跑 `npx vitest run src/__tests__/plugin-registry.test.ts` — 旧断言只查 id/name/routes,新断言 `expect(p.viewId).toBe(p.id)` / `expect(p.pageMeta).toBeTruthy()` / `expect(p.componentEntry.component).toBeDefined()` 应 FAIL
2. **Green**: 12 page 顶层根元素加 `data-testid` + plugin-registry.test.ts 重写
3. **Refactor**: 视觉矩阵 spec(Task 6)用 `[data-testid="${viewId}-page"]` 选择器,确认 60 个页面都能 query 到

**实现要点** (page 顶层 data-testid):
```tsx
// 通用模式:在每个 page 顶层根元素加 data-testid
// 例: src/pages/provider-list/index.tsx
return (
  <div data-testid="provider-list-page" className="provider-list-page">
    {/* ... */}
  </div>
);
```

**实现要点** (plugin-registry.test.ts 重写):
```typescript
// src/__tests__/plugin-registry.test.ts (Phase 44 重写)
import { describe, it, expect } from 'vitest';
import { ALL_PLUGINS, PAGE_META, VIEW_META, VIEW_COMPONENTS } from '../plugins/registry';
import type { FrontendPlugin } from '../plugins/types';

describe('Frontend plugin registry — Phase 44 派生收敛', () => {
  it('contains 9 plugin stubs (Phase 47 改 8 after mcp-management removal)', () => {
    expect(ALL_PLUGINS.length).toBe(9);
  });

  it('every plugin has unique kebab-case id + matching viewId', () => {
    const ids = ALL_PLUGINS.map((p) => p.id);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(dupes).toEqual([]);
    for (const id of ids) {
      expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
    for (const p of ALL_PLUGINS) {
      expect(p.viewId, `${p.id}.viewId 必填且 === id`).toBe(p.id);
    }
  });

  it('every plugin has pageMeta { title, description }', () => {
    for (const p of ALL_PLUGINS) {
      expect(p.pageMeta.title.length, `${p.id}.pageMeta.title 空`).toBeGreaterThan(0);
      expect(p.pageMeta.description.length, `${p.id}.pageMeta.description 空`).toBeGreaterThan(0);
    }
  });

  it('every plugin has sidebarTile { icon (LucideIcon), short, order, group }', () => {
    for (const p of ALL_PLUGINS) {
      const tile = p.sidebarTile;
      expect(tile, `${p.id}.sidebarTile 必填`).toBeDefined();
      expect(typeof tile!.icon, `${p.id}.sidebarTile.icon 应为 LucideIcon`).toBe('function');
      expect(tile!.short.length).toBeGreaterThan(0);
      expect(typeof tile!.order).toBe('number');
      expect(tile!.group).toMatch(/^(main|utility)$/);
    }
  });

  it('every plugin has componentEntry { component, propsBuilder }', () => {
    for (const p of ALL_PLUGINS) {
      const entry = p.componentEntry;
      expect(typeof entry.component, `${p.id}.componentEntry.component 应为 ComponentType`).toBe('function');
      expect(typeof entry.propsBuilder).toBe('function');
    }
  });

  it('resource-browser.sidebarTile.migrateFrom = { fromViewId: "mcp-management", appendQuery: { tab: "mcp" } }', () => {
    const rb = ALL_PLUGINS.find((p) => p.id === 'resource-browser');
    expect(rb).toBeDefined();
    expect(rb!.sidebarTile!.migrateFrom).toEqual({
      fromViewId: 'mcp-management',
      appendQuery: { tab: 'mcp' },
    });
  });

  it('every route has unique absolute path + pluginId matches', () => {
    const paths = ALL_PLUGINS.flatMap((p) => p.routes.map((r) => r.path));
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      expect(path.startsWith('/')).toBe(true);
    }
    const dupes = paths.filter((p, i) => paths.indexOf(p) !== i);
    expect(dupes).toEqual([]);
    const ids = new Set(ALL_PLUGINS.map((p: FrontendPlugin) => p.id));
    for (const p of ALL_PLUGINS) {
      for (const r of p.routes) {
        expect(ids.has(r.pluginId), `${p.id} 路由 ${r.path} pluginId 未知`).toBe(true);
      }
    }
  });
});
```

**验证命令**:
```bash
cd /Users/coderstory/CodeSource/winui3 && npx vitest run src/__tests__/plugin-registry.test.ts
# 12 page data-testid 完整性
grep -rE 'data-testid="(home|provider-list|import-sql|json-editor|usage-query|resource-browser|marketplace|optimizer|backup-restore|history|about|mcp-management)-page"' /Users/coderstory/CodeSource/winui3/src/pages/ 2>/dev/null | wc -l  # 期望 12
# 注: mcp-management-page Phase 46 删 stub 一并删;本 Task 不加
```

**Done 标准**:
- 11 个 page 加 data-testid(mcp-management 跳过,Phase 46 删)
- plugin-registry.test.ts 7 个断言全 PASS
- 老断言(无 viewId/pageMeta/componentEntry)被新断言取代,无破坏性

**估时**: 0.3 天

---

### Task 6: 视觉矩阵 60 张 baseline (Wave 2, 主验收)

**文件**:
- 新增: `/Users/coderstory/CodeSource/winui3/tests/e2e/visual-matrix.spec.ts`
- 新增目录: `/Users/coderstory/CodeSource/winui3/tests/e2e/visual-baselines/` (60 张 PNG 自动生成)

**TDD 红绿重构流**:
1. **Red**: 写 60 张视觉矩阵 spec(每个 view × 主题组合 1 个 it),首次跑 `--update-snapshots` 生成 baseline
2. **Green**: 60 张 baseline 落盘 `visual-baselines/<theme>-<view>.png`
3. **Refactor**: 写 CI 模式(不传 `--update-snapshots`)跑测试,期望 60/60 PASS(任何像素变化立即暴露视觉回归)

**实现要点** (Playwright 视觉矩阵 spec):

```typescript
// tests/e2e/visual-matrix.spec.ts (Phase 44 新增)
import { test, expect } from '@playwright/test';

/**
 * Phase 44 视觉矩阵 — 12 view × 5 主题 = 60 张 baseline.
 *
 * 启动流程:
 *   1. `tauri-driver --port 4444` (WebDriver 服务)
 *   2. `tauri build --no-bundle && ./scripts/run-e2e.sh` (跑应用 + 自动连 driver)
 *   3. playwright 跑此 spec, 每个组合切换主题 + 切 view + 截图
 *
 * 基线生成:
 *   npm run test:e2e -- tests/e2e/visual-matrix.spec.ts --update-snapshots
 *
 * CI 校验(无 --update-snapshots):
 *   npm run test:e2e -- tests/e2e/visual-matrix.spec.ts
 *   → 期望 60/60 PASS(任意像素 diff 立即暴露)
 *
 * 5 主题清单(per M3.0 主题重构基线):
 *   - cream-white (瓷白默认)
 *   - light
 *   - dark
 *   - auto (系统跟随,截图前锁 prefers-color-scheme=light)
 *   - (5 主题名按 tests/e2e/m2-3-0-shortcuts-theme.spec.ts 的 ThemeProvider 枚举对齐)
 */

const VIEW_IDS = [
  'home', 'provider-list', 'import-sql', 'json-editor',
  'usage-query', 'resource-browser', 'marketplace', 'optimizer',
  'backup-restore', 'history', 'about',
] as const;
const THEMES = ['cream-white', 'light', 'dark', 'auto-light', 'auto-dark'] as const;

for (const theme of THEMES) {
  test.describe(`theme=${theme}`, () => {
    test.beforeEach(async ({ page }) => {
      // 锁死 prefers-color-scheme(影响 auto 主题)
      await page.emulateMedia({ colorScheme: theme.startsWith('auto-dark') ? 'dark' : 'light' });
      // 注入 theme 到 localStorage(ThemeProvider 读 ccm.theme)
      await page.addInitScript((t) => {
        window.localStorage.setItem('ccm.theme', t);
      }, theme);
      // 启动应用 → 等 ViewStateProvider mount
      await page.goto('tauri://localhost');
      await page.waitForSelector('[data-testid="app-root"]');
    });

    for (const viewId of VIEW_IDS) {
      test(`${viewId} page renders identically`, async ({ page }) => {
        // 切 view:点 sidebar 或 setView(等 useViewState 暴露 API)
        // 简化: 直接用 sidebar-item-<view> 按钮
        await page.click(`[data-testid="sidebar-item-${viewId}"]`);
        await page.waitForSelector(`[data-testid="${viewId}-page"]`);
        // 等待 view-transition 动画结束(300ms)
        await page.waitForTimeout(400);
        await expect(page).toHaveScreenshot(`${theme}-${viewId}.png`, {
          fullPage: true,
          maxDiffPixels: 100,  // 容许小像素差(系统字体渲染差异)
        });
      });
    }
  });
}
```

**生成基线命令**:
```bash
# 1. 启动 tauri-driver + 应用
cd /Users/coderstory/CodeSource/winui3 && npm run test:e2e -- tests/e2e/visual-matrix.spec.ts --update-snapshots
# 2. 验证 60 张 PNG 落盘
ls /Users/coderstory/CodeSource/winui3/tests/e2e/visual-baselines/ | wc -l  # 期望 60
# 3. CI 模式(无 --update-snapshots)期望 60/60 PASS
cd /Users/coderstory/CodeSource/winui3 && npm run test:e2e -- tests/e2e/visual-matrix.spec.ts
```

**Done 标准**:
- 60 张 PNG baseline 落盘(`visual-baselines/<theme>-<view>.png`)
- CI 模式 60/60 PASS(无视觉回归)
- M31 vibrancy 撤回后视觉等价:不依赖已删的 `.wc-btn` / `.topbar-center` 选择器
- Playwright `--update-snapshots` 1 次跑完生成 60 张,后续维护成本 < 5 分钟

**估时**: 0.5 天(spec 写 + tauri-driver 启动调通 + 60 张生成 + CI 校验)

---

### Task 7: "加 1 plugin 改 1 文件"强验收 + 收尾 (Wave 2)

**文件**:
- 临时新增: `/Users/coderstory/CodeSource/winui3/src/plugins/stubs/_test_strong.tsx` (强验收验证用,跑完删)
- 修改 (临时): `/Users/coderstory/CodeSource/winui3/src/plugins/registry.ts` (加 1 行 import + 1 行 ALL_PLUGINS.push,跑完 revert)
- 修改 (收尾): `/Users/coderstory/CodeSource/winui3/.planning/milestones/v3.4-phases/44-SUMMARY.md` (引用本 PLAN §0 来源,执行 subagent 写)

**TDD 强验收流**:
1. **写 1 个临时 stub**:`stubs/_test_strong.tsx` 含 `viewId='_test-strong'` + pageMeta + componentEntry + sidebarTile
2. **registry.ts 加 2 行**:1 行 import + 1 行 `..._testStrongPlugin` 推到 `ALL_PLUGINS` 末尾
3. **跑 `npx vitest run src/plugins/__tests__/registry-derive.test.ts`** — 应 FAIL (新 viewId 不在 ALL_VIEW_IDS / PAGE_META / VIEW_META / VIEW_COMPONENTS 内)
4. **调整 registry.ts**:加 `_test-strong` 到 CORE_VIEWS 等价位置?不 — 派生已自动收,只需调整派生来源(CORE_VIEWS 是 3 项硬编码,新 plugin 走 ALL_PLUGINS 路径)
5. **跑 `npx vitest` 全套** — 应 PASS(派生自动包含新 plugin)
6. **跑 `git diff --stat`** — 应仅 2 文件:`stubs/_test_strong.tsx` (新增) + `registry.ts` (2 行变化)
7. **跑 `git diff src/App.tsx src/components/AppSidebar.tsx src/hooks/useViewState.tsx src/pages/`** — 应为空
8. **强验收 PASS** → 删 `_test_strong.tsx` + revert registry.ts 2 行

**强验收脚本**:
```bash
cd /Users/coderstory/CodeSource/winui3

# Step 1: 写临时 stub
cat > /tmp/_test_strong.tsx << 'EOF'
import type { FrontendPlugin } from '../types';
import { PluginPlaceholder } from './_Placeholder';
import { Star } from 'lucide-react';

const _TestStrongPage = () => <div data-testid="_test-strong-page"><PluginPlaceholder pluginId="_test-strong" displayName="强验收测试" /></div>;

export const _testStrongPlugin: FrontendPlugin = {
  id: '_test-strong',
  name: '强验收测试',
  viewId: '_test-strong',
  sidebarTile: { icon: Star, short: '强验收', order: 999, group: 'utility' },
  pageMeta: { title: '强验收', description: '加 1 plugin 改 1 文件 强验收' },
  componentEntry: { component: _TestStrongPage, propsBuilder: () => ({}) },
  routes: [],
};
EOF
cp /tmp/_test_strong.tsx /Users/coderstory/CodeSource/winui3/src/plugins/stubs/_test_strong.tsx

# Step 2: registry.ts 加 2 行(临时)
# (人工 Edit 加 import + ALL_PLUGINS.push)

# Step 3: 派生单测
npx vitest run src/plugins/__tests__/registry-derive.test.ts

# Step 4: git diff 检查
git diff --stat
# 期望:
#   src/plugins/registry.ts            |  2 ++
#   src/plugins/stubs/_test_strong.tsx | 30 ++++++++++++++++++
#   2 files changed, 32 insertions(+)

git diff src/App.tsx src/components/AppSidebar.tsx src/hooks/useViewState.tsx src/pages/
# 期望:空

# Step 5: 强验收 PASS,清理
rm /Users/coderstory/CodeSource/winui3/src/plugins/stubs/_test_strong.tsx
# revert registry.ts 临时 2 行(git checkout)
git checkout -- src/plugins/registry.ts
```

**收尾**:
```bash
# 1. 跑全套 vitest + tsc + e2e
cd /Users/coderstory/CodeSource/winui3 && npx tsc --noEmit
cd /Users/coderstory/CodeSource/winui3 && npx vitest run  # 全 PASS(强验收临时 stub 已删)
cd /Users/coderstory/CodeSource/winui3 && npm run test:e2e -- tests/e2e/visual-matrix.spec.ts  # 60/60 PASS

# 2. grep 强验收 lint
grep -cE "view === '[a-z-]+'" /Users/coderstory/CodeSource/winui3/src/App.tsx  # 期望 0
grep -cE "^const ALL_VIEWS: readonly ViewId\[\] = \[" /Users/coderstory/CodeSource/winui3/src/hooks/useViewState.tsx  # 期望 0
grep -cE "^const VIEW_META: Record<" /Users/coderstory/CodeSource/winui3/src/components/AppSidebar.tsx  # 期望 0
grep -cE "^const PAGE_META: Record<" /Users/coderstory/CodeSource/winui3/src/App.tsx  # 期望 0

# 3. git commit
cd /Users/coderstory/CodeSource/winui3 && git add .planning/milestones/v3.4-phases/44-*.md src/plugins/ src/hooks/useViewState.tsx src/App.tsx src/components/AppSidebar.tsx src/pages/ tests/e2e/visual-matrix.spec.ts tests/e2e/visual-baselines/ src/__tests__/plugin-registry.test.ts src/plugins/__tests__/registry-derive.test.ts
git commit -m "feat(v3.4 phase-44): frontend route derivation via registry.ts

- Extend FrontendPlugin with viewId/pageMeta/componentEntry/sidebarTile
- Add SidebarTile.migrateFrom field (Phase 46 enables)
- registry.ts derives ALL_VIEW_IDS / ALL_VIEWS_ORDERED / PAGE_META / VIEW_META / VIEW_COMPONENTS
- useViewState re-exports ALL_VIEWS / ViewId from registry (0 hardcoded)
- App.tsx ternary 12-branch -> lookup table (MainView)
- AppSidebar.tsx drops 12-entry VIEW_META Record, imports from registry
- 9 stub rewritten (incl. mcp-management, Phase 47 will drop it)
- 11 page data-testid added (mcp-management skipped, Phase 46 deletes)
- plugin-registry.test.ts rewritten for viewId/pageMeta/componentEntry
- registry-derive.test.ts new (5 derived exports, 60 assertions)
- visual-matrix.spec.ts 60 screenshots (12 view x 5 theme) generated

Strong verification: add 1 plugin -> 2 files touched (stub + 1-line registry import), 0 files in App.tsx/AppSidebar/useViewState/pages/.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"

# 4. smoke test(CLAUDE.md §13.1,10 项)
cd /Users/coderstory/CodeSource/winui3 && ./scripts/build-and-ship.sh --smoke-only
```

**Done 标准**:
- "加 1 plugin 改 1 文件"强验收 PASS(临时 stub + revert 后无残留)
- 全套 vitest + tsc + e2e 60/60 + smoke 10/10 全 PASS
- 4 个 grep 强验收 lint 全 0
- git commit 1 个,信息含 feat(v3.4 phase-44)
- `44-SUMMARY.md` 写完(execute-phase subagent 工作)

**估时**: 0.2 天(强验收脚本跑一遍 + grep lint + smoke + commit)

## 4. 风险与缓解 (≥3 高风险点)

| # | 风险 | 影响 | 缓解 |
|---|---|---|---|
| **R1** | **`componentEntry.propsBuilder` 类型推导失败**:`ViewComponentEntry<P = any>` 是泛型,但 `ALL_PLUGINS.map((p) => [p.viewId, p.componentEntry])` 推导为 `ViewComponentEntry<any>[]` → MainView 渲染时 props 类型丢失,`pendingSqlFile` 等强类型上下文传不下去 | **高**: 12 page props 类型变 any,IDE 补全失效,Phase 47 改 page props 时炸 | 1. **interface 不泛型**: `interface ViewComponentEntry { component: ComponentType<any>; propsBuilder: (ctx: ViewContext) => any }` —— Phase 44 不追求 per-view 强类型,Phase 47 评估 per-view generic；2. ViewContext 字段类型锁死 (pendingSqlFile + onNavigate + pageTitleFn),具体 page 接收 any 后内部断言;3. 写 propsBuilder 时显式标注 return type (e.g. `propsBuilder: (ctx): { initialFilePath: string \| null } => ({ initialFilePath: ctx.pendingSqlFile }))`) |
| **R2** | **`data-testid` 命名冲突**: 已有 page 用了 `data-testid="resource-browser-page"` (resource-browser/index.tsx:432) + `data-testid="home-page"` (home/index.tsx?) ,Task 5 加 11 个新 testid 时可能重复(覆盖现有同名)→ Playwright 选择器歧义 | **中**: 60 张视觉矩阵部分 view 截图失败,选择器命中多元素 | 1. **前置 grep** `grep -rE 'data-testid="[a-z-]+-page"' src/pages/` 列出已有 testid;2. 命名规范锁死 `<viewId>-page` 单数形式;3. 重复时**保留**已有(不动现有 e2e 用的),仅补缺失的;4. 视觉矩阵 spec 用 `[data-testid="${viewId}-page"]:first-of-type` 或 `[data-testid="${viewId}-page"][role="main"]` 缩窄 |
| **R3** | **60 张视觉矩阵生成时机**: Playwright `--update-snapshots` 需 tauri-driver + 真应用,启动慢(冷启动 ~3min)+ 60 截图 × 400ms 等待 × 5 主题 ≈ 5-10min,且每次 code change 都可能产生像素差(主题 token 微调 / 字体加载时机) | **高**: baseline 维护成本高,Phase 47 整合期每次跑 60 张 diff 噪声大 | 1. **`maxDiffPixels: 100`** 容许小像素差(字体渲染时机);2. baseline 落盘后 commit,不在 CI 每 PR 重生成;3. Phase 47 review 60 张时人工抽查,不全 diff;4. 视觉回归检测应聚焦**结构性变化**(view 整体错位 / 主题不切换),而非像素级 diff;5. `page.waitForLoadState('networkidle')` + `page.waitForTimeout(400)` 锁死渲染时机 |
| **R4** | **`mcp-management` stub 仍存在但 Phase 46 删**: Phase 44 强验收要求 9 stub 全改造,但 Phase 46 删 mcp-management 时 registry.ts:23 数组项 + mod.ts:12 export 行 + stubs/mcp-management.tsx 整文件删 → Phase 46-PLAN §2 强验收 7(4 处改动) | **中**: Phase 44 强验收 9 stub,Phase 47 验收 8 stub,接口契约必须在 Phase 44-46 之间稳定 | 1. Phase 44 9 stub 改造完毕 + plugin-registry.test.ts 断言 9;2. Phase 46-01 PLAN 必读本文件 §5 决策锁定点(per 44-DECISIONS §PLAN 7:9 stub 含 mcp-management,Phase 47 改 8);3. Phase 46 删 stub 时不改 componentEntry / pageMeta / sidebarTile 类型(仅删 plugin 实例);4. Phase 46 启用 migrateFrom 走 SidebarTile.migrateFrom(本 PLAN 已填 resource-browser 字段) |
| **R5** | **M31 vibrancy 撤回后 AppHeader layout 变化 + WindowControls 改 Windows 风格**: 视觉矩阵 60 张 baseline 反映**新 AppHeader**(无 `.topbar-center` 居中 app 名 + WindowControls 回到 topbar-right + lucide-react 矩形按钮),任何 Phase 44 渲染路径不能依赖已删的 `.wc-btn` / `.topbar-center` 类名 | **中**: 60 张视觉矩阵 baseline 误反映旧 layout,Phase 47 误报视觉回归 | 1. 视觉矩阵 spec 选择器只用 `data-testid`(`[data-testid="app-root"]` + `[data-testid="${viewId}-page"]`),不用 CSS 类名;2. baseline 生成前确认 master HEAD 是 M31 vibrancy 撤回后的 layout (commit log `577466b fix(ui): 删 topbar 重复 h1`);3. Phase 47 review 60 张 baseline 时,baseline 必须**无 .topbar-center 居中 app 名 + WindowControls 在 topbar-right**;4. 视觉差异容忍度 `maxDiffPixels: 100` 包含字体加载差异 |
| **R6** | **`useViewState.tsx` 删本地 ALL_VIEWS 改 re-export 破坏 121 处引用点**: 旧 `import { ALL_VIEWS } from '../hooks/useViewState'` 路径不变(本 PLAN re-export),但内容从 12 项字面量数组变成从 registry 派生,旧测试若断言 `ALL_VIEWS[0] === 'home'` 顺序假设可能 break (Q44-1 改字段驱动后顺序固定为 home → provider-list → import-sql → json-editor → usage-query → resource-browser → marketplace → optimizer → backup-restore → history → about) | **中**: 单测 fail | 1. 顺序由 `sidebarTile.order` 字段驱动后,**显式断言** `ALL_VIEWS_ORDERED[0..11]` 锁死顺序(per Task 2 registry-derive 单测);2. 旧 useViewState.test.tsx 若有顺序断言,更新为 registry 派生顺序;3. grep `ALL_VIEWS` 121 处引用点,确认所有路径仍能 resolve (`import { ALL_VIEWS } from '...'` 不变,只是导出源改了) |

---

## 5. 决策锁定点 (Phase 45/46/47 必读必验证)

**Phase 46-01 PLAN 第一步必读本节 + 字节 diff 验证,不一致走 CLAUDE.md §2.5 协商**。

### 5.1 `SidebarTile.migrateFrom` 字段 (Phase 46 启用)

```typescript
// /Users/coderstory/CodeSource/winui3/src/plugins/types.ts
export interface SidebarTile {
  icon: LucideIcon;
  short: string;
  order: number;
  group?: 'main' | 'utility';
  migrateFrom?: {                    // Phase 44 加字段, Phase 46 启用逻辑
    fromViewId: string;
    appendQuery?: Record<string, string>;
  };
}
```

**resource-browser 填的示例** (Phase 44 已就位):
```typescript
// /Users/coderstory/CodeSource/winui3/src/plugins/stubs/resource-browser.tsx
sidebarTile: {
  icon: ResourceBrowserSidebarTileIcon,
  short: '资源浏览',
  order: 6,
  group: 'main',
  migrateFrom: {
    fromViewId: 'mcp-management',
    appendQuery: { tab: 'mcp' },
  },
}
```

### 5.2 `FrontendPlugin` 4 字段扩展 (Phase 44 冻结)

```typescript
// /Users/coderstory/CodeSource/winui3/src/plugins/types.ts
export interface FrontendPlugin {
  id: string;
  name: string;
  viewId: string;                       // NEW
  sidebarTile?: SidebarTile;
  pageMeta: PageMeta;                   // NEW
  componentEntry: ViewComponentEntry;   // NEW
  routes: RouteDef[];
}
```

### 5.3 `registry.ts` 5 派生导出 (Phase 44 冻结)

```typescript
// /Users/coderstory/CodeSource/winui3/src/plugins/registry.ts
export const ALL_VIEW_IDS: readonly ViewId[];
export const ALL_VIEWS_ORDERED: readonly ViewId[];   // 字段驱动顺序
export const PAGE_META: Record<ViewId, PageMeta>;
export const VIEW_META: Record<ViewId, SidebarTile>;
export const VIEW_COMPONENTS: Map<ViewId, ViewComponentEntry>;
export const ALL_PLUGINS: readonly FrontendPlugin[];  // 9 项, Phase 47 改 8
```

### 5.4 Phase 46 验证命令 (1 行 diff 验证)

```bash
# Phase 46-01 PLAN 第一步:
diff <(grep -E "^export (const|type) " /Users/coderstory/CodeSource/winui3/src/plugins/registry.ts | sort) \
     <(echo -e "export const ALL_PLUGINS\nexport const ALL_ROUTES\nexport const ALL_VIEW_IDS\nexport const ALL_VIEWS_ORDERED\nexport const CORE_VIEWS\nexport const PAGE_META\nexport const VIEW_COMPONENTS\nexport const VIEW_META\nexport type CoreViewId\nexport type PluginViewId\nexport type ViewId")
# 期望: 空(字节级一致,新加 export 时同步更新本节)
```

### 5.5 视觉矩阵 60 张 baseline 路径 (Phase 47 review)

```
/Users/coderstory/CodeSource/winui3/tests/e2e/visual-baselines/
├── cream-white-home.png         ... cream-white-about.png        (12 张)
├── light-home.png               ... light-about.png              (12 张)
├── dark-home.png                ... dark-about.png               (12 张)
├── auto-light-home.png          ... auto-light-about.png         (12 张)
└── auto-dark-home.png           ... auto-dark-about.png          (12 张)
```

**强验收约束**: baseline 反映 M31 vibrancy 撤回后 layout(无 `.topbar-center` 居中 app 名 + WindowControls 在 topbar-right)。任何 baseline 含 `.topbar-center` 居中文本或 WindowControls 在 topbar-left → 拒收。

---

## 6. 不在 Phase 44 范围 (严禁混入)

> 即使"觉得顺路"也不做,留后续 phase:

- ❌ **`App.tsx:174-197` stale useEffect 删** — Phase 46 工作 (D-44-A, 强验收 7) (per 46-PLAN §强验收 6)
- ❌ **`mcp-management` stub 删** — Phase 46 工作 (D-44-A, 强验收 7) (per 46-PLAN §强验收 7)
- ❌ **mcp-management page 加 data-testid** — Phase 46 删 stub 一并删 page,本 Task 不加
- ❌ **`VIEW_ID_MIGRATIONS` + `migrateViewId` 启用** — Phase 46 工作,Phase 44 仅加 `SidebarTile.migrateFrom` 字段类型
- ❌ **react-router 切回** — Phase 47 评估,本阶段保留 `useViewState` 路径
- ❌ **home-plugin 化** — home 永远 CORE_VIEW,Phase 47 评估 registry 扩展点
- ❌ **Phase 42 任何工作** (Rust stub 改造 / inventory) — Phase 42 已 ship,本 PLAN 不动 src-tauri/
- ❌ **Phase 43 任何工作** (tray / app_menu / SwitchView emit listen) — 本阶段不新增 listen,Phase 43-PLAN 范围
- ❌ **Phase 45 任何工作** (services / topology) — Phase 45-PLAN 范围
- ❌ **任何 IPC / Tauri command 改动** — 前端 only
- ❌ **依赖版本 bump** — CLAUDE.md §2.3 严禁
- ❌ **SPEC.md 改动** — CLAUDE.md §10 严禁
- ❌ **依赖新库** (e.g. react-router 切回) — CLAUDE.md §2.3 严禁

---

## 7. 验证矩阵 (overall phase checks)

| 验证 | 命令 | 期望 |
|---|---|---|
| types 扩展编译 | `npx tsc --noEmit` | exit 0 |
| 9 stub 字段完整 | `grep -c "viewId:" src/plugins/stubs/*.tsx` | 9 |
| 9 stub sidebarTile | `grep -c "sidebarTile:" src/plugins/stubs/*.tsx` | 9 |
| 9 stub componentEntry | `grep -c "componentEntry:" src/plugins/stubs/*.tsx` | 9 |
| resource-browser migrateFrom | `grep -c "migrateFrom:" src/plugins/stubs/*.tsx` | 1(仅 resource-browser) |
| registry-derive 单测 | `npx vitest run src/plugins/__tests__/registry-derive.test.ts` | 5 passed |
| plugin-registry 单测 | `npx vitest run src/__tests__/plugin-registry.test.ts` | 7 passed |
| useViewState 删 ALL_VIEWS 硬编码 | `grep -cE "^export const ALL_VIEWS: readonly ViewId\[\] = \[" src/hooks/useViewState.tsx` | 0 |
| App.tsx 删三元链 | `grep -cE "view === '[a-z-]+'" src/App.tsx` | 0 |
| App.tsx 删手写 PAGE_META | `grep -cE "^const PAGE_META: Record<" src/App.tsx` | 0 |
| AppSidebar 删手写 VIEW_META | `grep -cE "^const VIEW_META: Record<" src/components/AppSidebar.tsx` | 0 |
| 11 page data-testid | `grep -rE 'data-testid="[a-z-]+-page"' src/pages/ \| wc -l` | 11 (mcp-management 跳过) |
| 视觉矩阵 baseline | `ls tests/e2e/visual-baselines/ \| wc -l` | 60 |
| 视觉矩阵 CI 校验 | `npm run test:e2e -- tests/e2e/visual-matrix.spec.ts` | 60 passed |
| "加 1 plugin 改 1 文件"强验收 | `git diff --stat` (临时 stub 验证后) | 仅 2 文件 |
| smoke test | `./scripts/build-and-ship.sh --smoke-only` | 10/10 PASS |
| 派生导出 byte diff | `diff <(grep "^export " src/plugins/registry.ts) <(D-44-A 期望列表)` | 空(字节级一致) |

---

## 8. success_criteria (phase 完成定义)

- [ ] Wave 0 (Task 1-2) 派生基线就位:types 扩展 + registry 5 派生导出 + 9 stub 全改造 + registry-derive 单测 5/5 PASS
- [ ] Wave 1 (Task 3-4) 消费 + 收敛完成:useViewState re-export + AppSidebar import 派生 + App.tsx MainView 查表 + 12 page import 删
- [ ] Wave 2 (Task 5-7) 测试 + 视觉 + 强验收完成:11 page data-testid + plugin-registry.test.ts 7/7 PASS + 60 张 baseline 落盘 + 60/60 CI 校验 PASS + "加 1 plugin 改 1 文件"临时验证 + smoke test 10/10
- [ ] D-44-A mcp-management stub 仍存在(Phase 46 删);Q44-1 ~ Q44-5 5 OQ 全部兑现(字段驱动 ALL_VIEWS_ORDERED / CORE_VIEWS 含 history / SidebarTile.migrateFrom 字段 + resource-browser 示例 / json-editor + usage-query routes 填 placeholder / 9 stub 全改造)
- [ ] Phase 46 接口契约锁定:`SidebarTile.migrateFrom` 字段 + `resource-browser.sidebarTile.migrateFrom = { fromViewId: 'mcp-management', appendQuery: { tab: 'mcp' } }` 已填,Phase 46 启用
- [ ] Phase 47 接口契约锁定:registry.ts 5 派生导出 + FrontendPlugin 4 字段扩展 + 9 stub 全含 viewId/pageMeta/componentEntry/sidebarTile(Phase 47 删 mcp-management 时改 8)
- [ ] 4 个 grep 强验收 lint 全 0:`useViewState.tsx` 0 行手写 ALL_VIEWS / `App.tsx` 0 行三元链 / `App.tsx` 0 行手写 PAGE_META / `AppSidebar.tsx` 0 行手写 VIEW_META
- [ ] git commit: `feat(v3.4 phase-44): frontend route derivation via registry.ts` (含 60 张 baseline)
- [ ] 单 PR ship,vitest 全 PASS + tsc 0 错 + e2e 60/60 + smoke 10/10 + 强验收 PASS

---

## 9. 输出

完成后产出 `/Users/coderstory/CodeSource/winui3/.planning/milestones/v3.4-phases/44-PLAN.md` (本文件)。

执行阶段产出 `/Users/coderstory/CodeSource/winui3/.planning/milestones/v3.4-phases/44-SUMMARY.md` (由 execute-phase subagent 写,引用本 PLAN §0 来源 + 强验收 byte diff + 60 张 baseline 路径)。

---

*PLAN 结束。Phase 46-01 PLAN 第一步必读 §5 决策锁定点 + 字节 diff 验证 D-44-A + SidebarTile.migrateFrom 字段契约。*

