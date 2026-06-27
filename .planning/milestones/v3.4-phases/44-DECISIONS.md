---
gsd_decisions_version: 1.0
phase: 44
decided: 2026-06-27
decided_by: discuss-phase subagent (待用户复核)
based_on: ../v3.4-DECISIONS.md (5 BLOCKING 关闭) + ./44-RESEARCH.md Open Questions
---

# Phase 44 DECISIONS

> 关闭 Phase 44 剩余 Open Questions。5 BLOCKING 见 ../v3.4-DECISIONS.md (继承 D-44-A: mcp-management 由 Phase 46 删).

## 已关闭决策 (继承)

- **D-44-A**: mcp-management stub 删, 由 Phase 46 负责 (Phase 46 启用 VIEW_ID_MIGRATIONS + 删 stub)

## Phase 44 剩余 OQ 关闭

### Q44-1: ALL_VIEWS_ORDERED 派生方式
- **决策**: `sidebarTile.order` 字段驱动
- **理由**: 当前 ALL_VIEWS 顺序与 ALL_PLUGINS 顺序已不同 (marketplace 在 usage-query 后), 硬编码数组失去派生意义; 字段驱动 = "加 view 改 1 文件" 强验收前提
- **影响**: registry.ts 派生 ALL_VIEWS_ORDERED 按 order 排序; 9 stub 填 1-9, home=0, history=100, about=101; 单测锁死

### Q44-2: CORE_VIEWS 包不包含 history
- **决策**: history 是 CORE_VIEW (与 home/about 同列)
- **理由**: history 不是 F1-F24, 是 SQLite 查询 UI (Phase 21-C ship); Phase 46 删 stale view 不影响 history
- **影响**: registry.ts 顶部 import HomeView/HistoryPage/AboutPage; 不创建 history-plugin stub

### Q44-3: Phase 46 migrateFrom 字段启用时机
- **决策**: Phase 44 加类型 + resource-browser 填示例, Phase 46 启用逻辑
- **理由**: 类型契约稳定前加字段; resource-browser 的 migrateFrom 已知 (mcp-management → resource-browser?tab=mcp), 一并填零额外工作
- **影响**: SidebarTile.migrateFrom Phase 44 加; resource-browser 填 `fromViewId: 'mcp-management', appendQuery: { tab: 'mcp' }`; Phase 46 useViewState 启用

### Q44-4: json-editor / usage-query routes 字段
- **决策**: 填 `/json` / `/usage` placeholder path, 引用真实 page (非 _Placeholder)
- **理由**: 当前 stub `routes: []` 是历史错位 (M1.9 设想为 modal, M2+ 实现为独立 page); Phase 44 强验收要求 stub 引用真实 page
- **影响**: json-editor.tsx / usage-query.tsx stub 改造: componentEntry.component 提顶层, routes 填 path

### Q44-5: 9 stub 改造
- **决策**: 9 业务 stub + 3 core view 全部改造, propsBuilder 按需
- **理由**: "加 view 改 1 文件" 强验收要求每个 stub 自包含
- **影响**: 9 stub 重写 + registry.ts 3 core view + App.tsx 12 import → 1 registry import + 三元链 12 分支 → 查表 + useViewState/AppSidebar import 派生 + 12 page 加 data-testid

## 推迟到 Phase 47

- **mcp-management stub 删除 (D-44-A)**: Phase 44 保留 stub 满足 Phase 44 时点, Phase 46 收尾删
- **react-router 切回**: Phase 47 评估 (影响 204 处 view state 使用点, 违反 Phase 44 "派生收敛" 最小边界)
- **home-plugin 化**: home 永远 CORE_VIEW, 主题自定义首页布局走 registry 扩展点

## PLAN 阶段必须实现的接口约束

### 1. FrontendPlugin 类型扩展 (Phase 44 增量)

```typescript
// src/plugins/types.ts
export interface SidebarTile {
  icon: LucideIcon;        // 改 LucideIcon (组件), 不是 ReactElement
  short: string;
  order: number;
  group?: 'main' | 'utility';
  migrateFrom?: { fromViewId: string; appendQuery?: Record<string, string> };  // Phase 46 启用
}
export interface PageMeta { title: string; description: string; }
export interface ViewComponentEntry<P = any> {
  component: ComponentType<P>;
  propsBuilder: (ctx: ViewContext) => P;
}
export interface ViewContext {
  pendingSqlFile: string | null;
  onNavigate: (v: ViewId, query?: Record<string, string>) => void;
  pageTitleFn: (v: ViewId) => string;
}
export interface FrontendPlugin {
  id: string;
  name: string;
  viewId: string;           // NEW
  sidebarTile?: SidebarTile;
  pageMeta: PageMeta;       // 必填
  componentEntry: ViewComponentEntry;
  routes: RouteDef[];       // 保留供未来 react-router
}
```

### 2. registry.ts 派生

```typescript
const CORE_VIEWS = ['home', 'history', 'about'] as const;
export type CoreViewId = typeof CORE_VIEWS[number];
export type PluginViewId = typeof ALL_PLUGINS[number]['viewId'];
export type ViewId = CoreViewId | PluginViewId;

export const ALL_VIEW_IDS = [...CORE_VIEWS, ...ALL_PLUGINS.map(p => p.viewId)] as const;

export const ALL_VIEWS_ORDERED = [
  ...ALL_PLUGINS.filter(p => p.sidebarTile)
    .sort((a, b) => a.sidebarTile!.order - b.sidebarTile!.order)
    .map(p => p.viewId),
  'history', 'about',
] as const;

export const PAGE_META = {
  home: { title: '...', description: '...' },
  history: { title: '...', description: '...' },
  about: { title: '...', description: '...' },
  ...Object.fromEntries(ALL_PLUGINS.map(p => [p.viewId, p.pageMeta])),
} as const satisfies Record<ViewId, PageMeta>;

export const VIEW_META = {
  home: { icon: Home, short: '欢迎页', order: 0, group: 'main' },
  history: { icon: History, short: '历史查询', order: 100, group: 'utility' },
  about: { icon: Info, short: '关于', order: 101, group: 'utility' },
  ...Object.fromEntries(ALL_PLUGINS.filter(p => p.sidebarTile).map(p => [p.viewId, p.sidebarTile!])),
} as const satisfies Record<ViewId, SidebarTile>;

export const VIEW_COMPONENTS = new Map<ViewId, ViewComponentEntry>([
  ['home', homeComponentEntry],
  ...ALL_PLUGINS.map(p => [p.viewId, componentEntryFromPlugin(p)] as const),
]);
```

### 3. useViewState.tsx 改造

- 删本地 ALL_VIEWS 12 项硬编码
- re-export 自 registry: `export { ALL_VIEW_IDS as ALL_VIEWS } from '../plugins/registry'`
- ViewId 联合类型 import 自 registry

### 4. App.tsx 三元链 → 派生组件

```typescript
// App.tsx (Phase 44 后)
import { VIEW_COMPONENTS, PAGE_META } from './plugins/registry';

function MainView({ view, pendingSqlFile, onNavigate, pageTitle }) {
  const entry = VIEW_COMPONENTS.get(view);
  if (!entry) return <PluginPlaceholder ... />;
  const Comp = entry.component;
  const props = entry.propsBuilder({ pendingSqlFile, onNavigate, pageTitleFn: pageTitle });
  return <Comp {...props} />;
}
```

### 5. AppSidebar.tsx VIEW_META 派生

- 删 12 项手写 Record; import VIEW_META 自 registry
- icon 渲染: `const Icon = meta.icon; return <Icon size={18} />` (ReactElement → LucideIcon)
- sidebar 顺序走 ALL_VIEWS_ORDERED

### 6. 12 page 加 data-testid

`<ProviderListPage data-testid="provider-list-page" />` (Playwright e2e 用)

### 7. plugin-registry.test.ts 重写

9 stub (Phase 44 仍 9 含 mcp-management, Phase 47 改 8) → 每个 stub 有 viewId/pageMeta/componentEntry 断言

### 8. 视觉等价 e2e (60 张 baseline)

12 view × 5 主题 = 60 张; Playwright `--update-snapshots` 一次性生成; Phase 47 review 60 张

## 强验收 (Phase 47 验证)

- useViewState.tsx 0 行手写 ALL_VIEWS: readonly
- App.tsx 0 行 view === 'x' 三元链
- AppSidebar.tsx 0 行手写 VIEW_META
- Playwright e2e 12 view 视觉等价
- 5 主题 × 12 view 视觉矩阵 60 张 PASS
- "加 view 改 1 文件" 强验收: 加 1 plugin stub + registry.ts 1 行 import, 0 改其它文件
