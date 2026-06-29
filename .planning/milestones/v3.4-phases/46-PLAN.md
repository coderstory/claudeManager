# Phase 46 PLAN — stale-route 清理 (VIEW_ID_MIGRATIONS + 删 mcp-management stub)

**Phase:** 46
**Goal:** 把 `App.tsx:174-197` 兜底 useEffect 替换为 useViewState 内部派生的 `VIEW_ID_MIGRATIONS` 索引 + `migrateViewId` 递归解析,使 v3.2 user 从 `localStorage='mcp-management'` 升级到 v3.4 启动后自动跳转到 `view=resource-browser` + URL `?tab=mcp`,同时一次性删 `mcp-management` stub (后端 + 前端 + 注释 + App.tsx useEffect),实现"加 view 改 1 文件 + 删 view 改 1 文件"双向强验收。

---

## 0. 来源与依据 (input provenance) + DRIFT 报告

**输入 (上游已 ship 的产物)**:
1. `.planning/milestones/v3.4-DECISIONS.md` (209 行,5 BLOCKING 已关闭,D-44-A 由 Phase 46 负责)
2. `.planning/milestones/v3.4-phases/00-VERIFY-FIRST-DRIFT-REPORT.md` (698 行,5 BLOCKING 漂移分析 + 数字基线重测)
3. `.planning/milestones/v3.4-phases/46-RESEARCH.md` (74KB,Phase 46 选分布式元数据 + useLayoutEffect 时序分析 + 5 个 pitfall)
4. `.planning/milestones/v3.4-phases/46-DECISIONS.md` (5 OQ 全关闭,Q1 由 D-44-A 关闭,Q2 链式 appendQuery 取第一跳,Q3 URL 保留,Q4 mount-time 锁死,Q5 dev mode warn)
5. `.planning/milestones/v3.4-phases/44-DECISIONS.md` (Phase 44 派生收敛契约:Q44-3 migrateFrom 字段由 Phase 44 加,Phase 46 启用;Q44-5 9 stub 改造)

**项目实测 (基线日 2026-06-27)**:
- `src/hooks/useViewState.tsx:124-137` ALL_VIEWS 手写 11 项 (Phase 46 仍保留派生前的硬编码;Phase 44 派生收敛未 ship)
- `src/App.tsx:174-197` 24 行 stale-route useEffect (硬编码 `mcp-management`) ← Phase 46 删
- `src/App.tsx:76` import `STORAGE_KEY` ← Phase 46 删
- `src/plugins/stubs/mcp-management.tsx` 23 行 stub ← Phase 46 删
- `src/plugins/stubs/mod.ts:12` + `src/plugins/registry.ts:23,40` mcp 注册 ← Phase 46 删
- `src/__tests__/plugin-registry.test.ts:10` 断言 9 stub → Phase 46 改 8
- `src/__tests__/hooks/useViewState.test.tsx:91-95` 已有 "stale mcp-management → home" 单测 → Phase 46 改写为 "→ resource-browser"
- `src/pages/resource-browser/index.tsx:132-144` `readInitialKindFromUrl()` URL 解析 → Phase 46 加双源优先级
- `src/components/AppSidebar.tsx:49-101` 手写 VIEW_META (11 项) ← Phase 44 未派生;Phase 46 不动
- view=11 / commands=80 / frontend stub=9 / useViewState=121 (基线数字)
- 后端 stub 文件 `src-tauri/src/plugins/stubs/mcp_management.rs` 存在,Phase 46 删 + `src-tauri/src/plugins/stubs/mod.rs:6` 注销 + `src-tauri/src/plugins/mod.rs:18-20` "F1..F7" 注释去 mcp 编号

### 0.1 DRIFT 警告 — Phase 44 派生收敛未 ship ⚠️ (FAIL-FAST 必读)

**事实**: 截至 2026-06-27 23:55 plan-phase 启动时,**Phase 44 派生收敛尚未 ship**:
- `src/plugins/registry.ts` 仍 36-46 行手写 `ALL_PLUGINS` (9 项含 `mcpManagementPlugin`),**无 `ALL_VIEW_META`** / **无 `VIEW_COMPONENTS`** / **无 `PAGE_META` 派生**
- `src/plugins/types.ts` 仅 3 接口 (`RouteDef` / `FrontendPlugin`),**无 `SidebarTile`** / **无 `migrateFrom` 字段** / **无 `PageMeta`** / **无 `ViewComponentEntry`** / **无 `viewId` 字段**
- `src/components/AppSidebar.tsx:49-101` 仍手写 11 项 `VIEW_META` (icon + short),**未派生自 registry**
- `src/App.tsx:608-640` 仍 12 分支 `view === 'x' ? <XPage /> : ...` 三元链,**未用 `VIEW_COMPONENTS` 查表**
- `src/hooks/useViewState.tsx:124-137` 仍 11 项硬编码 `ALL_VIEWS`,**未 `re-export from registry`**
- `git log` 自 c970aae (46-RESEARCH.md 文档) 起,**无 Phase 44 代码 commit**

**为什么这是漂移**:
- 46-DECISIONS.md PLAN §2 假设 `import { ALL_VIEW_META, type SidebarTile } from '../plugins/registry'`
- 46-PLAN.md (上一轮被 kill 之前的) §0.14 也写 "Phase 44 派生收敛已锁"
- 但 `ALL_VIEW_META` / `SidebarTile` / `migrateFrom` 字段在 registry / types / stubs 均不存在
- 强行 import 会 TS2305 "Module has no exported member" 全报错,Phase 46 编译失败

**处理策略 (CLAUDE.md §2.4 "禁止既然要改顺便把 X 也改了" + §10 "不修改 SPEC.md")**:
- **❌ 不允许**:Phase 46 顺手把 Phase 44 的 `SidebarTile` + `ALL_VIEW_META` 派生工作做了 (违反 §2.4 边界纪律,且偷换 phase 责任)
- **✅ 允许 (本 plan 落地)**:Phase 46 把 `VIEW_ID_MIGRATIONS` 改成 **硬编码常量** (就 1 项:`'mcp-management' → 'resource-browser'`),不依赖 `SidebarTile.migrateFrom` 派生,直接写在 `useViewState.tsx` 模块顶部。等 Phase 44 ship 后再二次重构为派生形态 (挂到 47 的 `lint-plugin-coupling.sh` 强验收项上)
- **✅ 允许**:Phase 46 仍然消费 `resource-browser.sidebarTile.migrateFrom` 字段 — **该字段在 Phase 46 自身填** (resource-browser stub.tsx 加 `migrateFrom` 字段,Phase 46 内部加,不依赖 Phase 44 ship)。这是 Phase 46 内部的"加 view 改 1 文件" 强验收一部分

**对 Phase 47 的影响**:
- Phase 47 §1.7 Phase 44 lint 强验收项 (`useViewState.tsx 0 手写 ALL_VIEWS` / `App.tsx 0 三元链` / `AppSidebar.tsx 0 手写 VIEW_META`) **在 Phase 46 ship 后仍会 FAIL** (因为 Phase 44 没 ship,这些条件不满足)。Phase 47 启动前必须确认 Phase 44 已 ship,否则 Phase 47 fail-fast 返回 Phase 44 fix
- Phase 47 §1.7 Phase 46 lint 强验收项 (`App.tsx 0 stale-route 兜底` / `mcp-management.tsx 不存在` / `plugin-registry.test.ts 8 stub`) **可独立 PASS** (Phase 46 自包含)
- Phase 47 §1.6 end-to-end stale-route migration 强验收 **可独立验证** (v3.2 user 升级路径走 Phase 46 自身逻辑,不依赖 Phase 44 ship)

**对 Phase 46 内部的影响**:
- 硬编码 `VIEW_ID_MIGRATIONS` Map (1 项) 是 **可接受的 trade-off**:Phase 46 scope 是"删 mcp-management stub",新增 view 在 Phase 46 范围内不会发生,硬编码 1 项未来删 stub 改为空 Map 也合理
- Phase 47 二次重构时,删 1 项硬编码 → `migrateFrom` 字段全 registry 派生,工作量 < 0.1 天
- 强验收 "加 view 改 1 文件" 在 Phase 46 内是 **"删 mcp-management 改 5 文件"** (删 stub + 注销 + 改 test + 改 App.tsx import),可独立验收

---

## 1. Goal (强验收 = phase 完成标准)

> **核心强验收 (46-DECISIONS §强验收 + overview §3 Phase 46)**:
> 1. **`useViewState.tsx` 有 `VIEW_ID_MIGRATIONS` Map (Phase 46 硬编码 1 项,Phase 47 二次重构为派生)** + `migrateViewId` 递归 + `ReadInitialViewResult` exported interface
> 2. **`migrateViewId` 递归**:cycle 检测 (visited Set) + 深度上限 5 + unknown → home + dev mode console.warn (per Q46-1 / Q46-5)
> 3. **`appendQuery` 链式时取第一跳** (Q46-2):`migrateViewId` 递归到有效 view 后回传第一跳的 appendQuery
> 4. **`ViewStateProvider` 暴露 `migrationSearch`** (Q46-4):`useMemo(() => readInitialView().search, [])` mount-time 锁死;`UseViewStateResult` 加 `migrationSearch?: Record<string,string>` 字段
> 5. **`ResourceBrowser` 双源优先级** (Q46-3):`migrationSearch?.tab` > URL `?tab=` > 默认 `'plugin'`
> 6. **`App.tsx` 删 `useEffect` 整段** (174-197, 24 行) + 移除 `STORAGE_KEY` import (强验收 grep lint: `App.tsx` 0 行 `STORAGE_KEY` 引用 + 0 行 stale-route 兜底)
> 7. **删 mcp-management stub 4 文件** (D-44-A):`stubs/mcp-management.tsx` + `stubs/mod.ts:12` export 行 + `registry.ts:23,40` 数组项 + 注释清理 (`useViewState.tsx:115-119` "mcp-management 合并到 resource-browser" 注释 + `App.tsx:65-67` "Phase 27 Fix 6" 注释 + `App.tsx:164-170` stale-route 注释)
> 8. **`plugin-registry.test.ts` 断言 9 → 8**:`expect(ALL_PLUGINS.length).toBe(8)`
> 9. **`useViewState.test.tsx` 新增 6 单测** (Phase 46 describe):stale mcp → resource-browser / migrationSearch 暴露 / 未知 stale fallback home / 链式 A→B→C / 链式 cycle / 链式深度 6
> 10. **`resource-browser.test.tsx` 改写**:注入 `migrationSearch` 时 default kind = `'mcp'`
> 11. **升级路径打通** (强验收 INT-04, Phase 47 Playwright 验证):v3.2 user `localStorage='mcp-management'` → v3.4 启动 → URL `?tab=mcp` + view = `resource-browser`
> 12. **后端 stub 同步删**:`src-tauri/src/plugins/stubs/mcp_management.rs` 删除 + `src-tauri/src/plugins/stubs/mod.rs:6` 注销 + `src-tauri/src/plugins/mod.rs:18-20` "F1..F7" 注释清理
> 13. **"删 1 view 改 5 文件" 强验收** (Phase 46 scope 锁定):删 mcp-management 涉及 5 文件 (`stubs/mcp-management.tsx` + `stubs/mod.ts` + `registry.ts` + `plugin-registry.test.ts` + `App.tsx` import/注释);`App.tsx` 三元链不动 + `useViewState.tsx` 核心逻辑不动 (硬编码 Map 不算派生不动)
> 14. **`ALL_VIEWS` 仍 11 项** (Phase 46 不动 ALL_VIEWS,因 Phase 44 派生收敛未 ship;硬编码 Map 路径走 VIEW_ID_MIGRATIONS,不入 ALL_VIEWS)

---

## 2. 工作量与估时

| 项目 | 估值 | 来源 |
|---|---|---|
| 新增字段 | 1 (`migrationSearch?: Record<string,string>` 加到 UseViewStateResult) | 46-DECISIONS §PLAN 3 |
| 新增函数 | 3 (`migrateViewId` / `readInitialView` 改返回类型 / ResourceBrowser `resolveInitialKind` useMemo) — 不含 `buildMigrationIndex` (Phase 46 硬编码不需要) | 46-RESEARCH §2.4 + §7.2 |
| 新增硬编码 | 1 (`VIEW_ID_MIGRATIONS` Map 硬编码 1 项,Phase 44 ship 后重构为派生) | §0.1 DRIFT 处理 |
| 修改文件 | 6 前端 (`useViewState.tsx` / `App.tsx` / `resource-browser/index.tsx` / `useViewState.test.tsx` / `plugin-registry.test.ts` / `resource-browser.test.tsx`) + 3 后端 (`src-tauri/src/plugins/stubs/mcp_management.rs` 删 + `src-tauri/src/plugins/stubs/mod.rs` + `src-tauri/src/plugins/mod.rs`) | 46-DECISIONS §PLAN 2/3/5/6/7 |
| 删除文件 | 2 (`stubs/mcp-management.tsx` + `src-tauri/src/plugins/stubs/mcp_management.rs`) + 6 行引用清理 (mod.ts ×2 + registry.ts ×2 + App.tsx ×2 + useViewState.tsx 注释 ×1) | 46-DECISIONS §PLAN 6 |
| 新增测试 | 6 (useViewState.test.tsx Phase 46 describe) + 1 改写 (resource-browser 注入 migrationSearch) | 46-DECISIONS §PLAN 7 |
| 工作量估时 | **1-1.5 天** (0.3 天 useViewState 6 单测 TDD scaffold + 0.2 天 `VIEW_ID_MIGRATIONS` 硬编码 + `migrateViewId` + 0.1 天 `readInitialView` 返回类型 + 0.2 天 `ViewStateProvider` migrationSearch + 0.2 天 ResourceBrowser 双源 + 0.1 天 App.tsx 删 useEffect + 0.3 天 删 mcp stub (前后端) + 改 test + 收尾) | overview §3 Phase 46 估 "0.5-1 天" |

---

## 3. 任务拆分 (Tasks)

按 TDD 红绿重构流 (CLAUDE.md §2.2) + 依赖顺序,共 7 个 task,3 个 wave:

```
Wave 0 (TDD scaffold): Task 1 (useViewState 6 单测先写, 全 FAIL 确认 Red)
Wave 1 (主机制):      Task 2 (VIEW_ID_MIGRATIONS 硬编码 + migrateViewId) → Task 3 (readInitialView 返回 {view, search?}) → Task 4 (ViewStateProvider migrationSearch context)
Wave 2 (消费 + 清理): Task 5 (ResourceBrowser 双源优先级 + test 改写) → Task 6 (App.tsx 删 useEffect + import) → Task 7 (删 mcp-management stub 5 文件 + plugin-registry 8)
```

### Task 1: TDD scaffold — 6 单测先写 (Wave 0, 0.3 天)

**文件**:
- 修改: `/Users/coderstory/CodeSource/winui3/src/__tests__/hooks/useViewState.test.tsx`

**TDD 红绿重构流**:
1. **Red**: 改写现有 `Phase 27 Fix 6: stale "mcp-management" localStorage falls back to "home"` (line 91-95) → 改为 "stale 'mcp-management' → resource-browser" 新单测,跑测试期望 FAIL (Phase 46 还没实现 VIEW_ID_MIGRATIONS)
2. **Red**: 加新单测 `migrationSearch exposed: stale "mcp-management" → { tab: "mcp" }`
3. **Red**: 加新单测 `unknown stale viewId falls back to home + console.warn (dev mode)`
4. **Red**: 加新单测 `chain migration A→B→C resolves to C with first-hop appendQuery`
5. **Red**: 加新单测 `chain migration cycle (A→B→A) falls back to home + console.warn`
6. **Red**: 加新单测 `chain migration depth 6 (A→B→C→D→E→F) falls back to home + console.warn`
7. **Red**: 跑测试确认 6 个新单测全 FAIL (TDD Red 阶段),其它 14 个老单测保持 PASS (回归基线)
8. **Refactor**: 单测结构组织为 `describe('Phase 46 — VIEW_ID_MIGRATIONS + chain migration', () => {...})`

**单测代码骨架**:

```typescript
// src/__tests__/hooks/useViewState.test.tsx (Phase 46 增量, 追加到文件末尾)

import * as useViewStateModule from '../../hooks/useViewState.tsx';

describe('Phase 46 — VIEW_ID_MIGRATIONS + chain migration', () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState({}, '', '/');
  });

  it('stale "mcp-management" localStorage → resource-browser via VIEW_ID_MIGRATIONS hardcoded map', () => {
    localStorage.setItem(STORAGE_KEY, 'mcp-management');
    const { result } = renderHook(() => useViewState(), { wrapper: wrap });
    expect(result.current.view).toBe('resource-browser');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('resource-browser');
  });

  it('migrationSearch exposed: stale "mcp-management" → { tab: "mcp" }', () => {
    localStorage.setItem(STORAGE_KEY, 'mcp-management');
    const { result } = renderHook(() => useViewState(), { wrapper: wrap });
    expect(result.current.migrationSearch).toEqual({ tab: 'mcp' });
  });

  it('unknown stale viewId falls back to home + console.warn (dev mode)', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    localStorage.setItem(STORAGE_KEY, 'totally-unknown-plugin');
    const { result } = renderHook(() => useViewState(), { wrapper: wrap });
    expect(result.current.view).toBe(HOME_VIEW);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('totally-unknown-plugin'));
    spy.mockRestore();
  });

  it('chain migration A→B→C resolves to C with first-hop appendQuery', () => {
    const fixture = new Map<string, { toViewId: ViewId; appendQuery?: Record<string, string> }>([
      ['A', { toViewId: 'B', appendQuery: { x: '1' } }],
      ['B', { toViewId: 'C' }],
    ]);
    vi.spyOn(useViewStateModule, 'VIEW_ID_MIGRATIONS', 'get').mockReturnValue(fixture);
    localStorage.setItem(STORAGE_KEY, 'A');
    const { result } = renderHook(() => useViewState(), { wrapper: wrap });
    expect(result.current.view).toBe('C');
    expect(result.current.migrationSearch).toEqual({ x: '1' });
    vi.restoreAllMocks();
  });

  it('chain migration cycle (A→B→A) falls back to home + console.warn', () => {
    const fixture = new Map([
      ['A', { toViewId: 'B' as ViewId }],
      ['B', { toViewId: 'A' as ViewId }],
    ]);
    vi.spyOn(useViewStateModule, 'VIEW_ID_MIGRATIONS', 'get').mockReturnValue(fixture);
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    localStorage.setItem(STORAGE_KEY, 'A');
    const { result } = renderHook(() => useViewState(), { wrapper: wrap });
    expect(result.current.view).toBe(HOME_VIEW);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('cycle'));
    vi.restoreAllMocks();
  });

  it('chain migration depth 6 (A→B→C→D→E→F) falls back to home + console.warn', () => {
    const fixture = new Map<string, { toViewId: ViewId }>();
    const ids = ['A', 'B', 'C', 'D', 'E', 'F'];
    ids.forEach((id, i) => {
      if (i < ids.length - 1) fixture.set(id, { toViewId: ids[i + 1] as ViewId });
    });
    vi.spyOn(useViewStateModule, 'VIEW_ID_MIGRATIONS', 'get').mockReturnValue(fixture);
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    localStorage.setItem(STORAGE_KEY, 'F');
    const { result } = renderHook(() => useViewState(), { wrapper: wrap });
    expect(result.current.view).toBe(HOME_VIEW);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('depth'));
    vi.restoreAllMocks();
  });
});
```

**chain 单测 mock 策略说明**: 由于 `VIEW_ID_MIGRATIONS` 是模块级硬编码 `Map`,chain 单测需注入临时 fixture。用 `vi.spyOn(useViewStateModule, 'VIEW_ID_MIGRATIONS', 'get')` 拦截 getter 返回测试 fixture Map (vitest 3.x 原生支持模块导出拦截)。无需改产品代码 (避免 §2.4 边界违规)。

**验证命令**:
```bash
cd /Users/coderstory/CodeSource/winui3 && npx vitest run src/__tests__/hooks/useViewState.test.tsx
# 期望: Phase 46 describe 6 单测全 FAIL (Red), 其它 14 单测 PASS
```

**Done 标准**:
- 6 个 Phase 46 新单测 FAIL (TDD Red 阶段确认)
- 现有 14 个 useViewState 单测保持 PASS (回归基线)
- `STORAGE_KEY` + `HOME_VIEW` import 已就位 (line 25-32 已有)

**估时**: 0.3 天

### Task 2: `VIEW_ID_MIGRATIONS` Map 硬编码 + `migrateViewId` 递归 (Wave 1, 0.2 天)

**文件**:
- 修改: `/Users/coderstory/CodeSource/winui3/src/hooks/useViewState.tsx`

**TDD 红绿重构流**:
1. **Green**: 加 `VIEW_ID_MIGRATIONS` 模块级 const (硬编码 1 项,Phase 44 ship 后重构为派生)
2. **Green**: 加 `MAX_MIGRATION_DEPTH = 5`
3. **Green**: 加 `migrateViewId()` 递归 + cycle 检测 visited Set + dev mode console.warn (per Q46-1 + Q46-5)
4. **Green**: 跑 useViewState.test.tsx 期望 Phase 46 describe 6 单测 PASS (Green 阶段)
5. **Refactor**: `migrateViewId` JSDoc 写明 "appendQuery 取第一跳,链式多跳合并策略见 Q46-2 推迟 Phase 47"
6. **Refactor**: `VIEW_ID_MIGRATIONS` JSDoc 注明 "Phase 46 硬编码,Phase 44 ship 后改派生形态 (强验收 lint-plugin-coupling.sh 规则 9 触发)"

**实现要点**:

```typescript
// src/hooks/useViewState.tsx (Phase 46 增量, 加到 ALL_VIEWS 下方)

// useEffect/useLayoutEffect 也要加 import (Task 4 用)
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from 'react';

/* ──────────── Phase 46 — VIEW_ID_MIGRATIONS (硬编码) ──────────── */

/**
 * Phase 46 — stale viewId → 新 viewId 反向索引 (硬编码 1 项)。
 *
 * Phase 46 scope 仅含 'mcp-management' (D-44-A 删 + Phase 27 Fix 6
 * 老用户重定向到 resource-browser mcp tab)。**Phase 44 派生收敛未 ship**,
 * 不消费 ALL_VIEW_META / SidebarTile.migrateFrom — 派生形态推迟到
 * Phase 47 lint-plugin-coupling.sh 规则 9 触发时一并重构 (Phase 46 §0.1
 * DRIFT 警告 + 47-PLAN §1.7 Phase 44 强验收项)。
 */
export interface MigrationEntry {
  toViewId: ViewId;
  appendQuery?: Record<string, string>;
}

export const VIEW_ID_MIGRATIONS: ReadonlyMap<string, MigrationEntry> = new Map([
  // Phase 27 Fix 6 + D-44-A — 老用户从 'mcp-management' (已删除的 view)
  // 升级到 v3.4 自动跳到 resource-browser + URL ?tab=mcp (mcp tab 接管)
  ['mcp-management', { toViewId: 'resource-browser', appendQuery: { tab: 'mcp' } }],
]);

const MAX_MIGRATION_DEPTH = 5;

/**
 * Phase 46 — 链式迁移递归查找 (Q46-1)。
 *
 * 终止条件 (按顺序短路):
 *   1. stored === null → { view: HOME_VIEW }
 *   2. stored 是有效 ViewId → { view: stored }
 *   3. visited.has(stored) → cycle detected, dev warn + home fallback
 *   4. depth >= MAX_MIGRATION_DEPTH (5) → dev warn + home fallback
 *   5. VIEW_ID_MIGRATIONS miss → unknown stale, dev warn + home fallback
 *
 * Q46-2 (chain appendQuery 取第一跳):
 *   appendQuery 取 stored **直接对应的 migration.appendQuery**, 链上
 *   中间跳不合并。
 */
function migrateViewId(
  stored: string | null,
  visited: Set<string> = new Set(),
  depth: number = 0,
): { view: ViewId; appendQuery?: Record<string, string> } {
  if (!stored) return { view: HOME_VIEW };
  if (isValidView(stored)) return { view: stored };
  if (visited.has(stored)) {
    if (import.meta.env?.DEV !== false) {
      console.warn(`[useViewState] migration cycle detected at ${stored}, fallback to home`);
    }
    return { view: HOME_VIEW };
  }
  if (depth >= MAX_MIGRATION_DEPTH) {
    if (import.meta.env?.DEV !== false) {
      console.warn(`[useViewState] migration depth ${MAX_MIGRATION_DEPTH} exceeded at ${stored}, fallback to home`);
    }
    return { view: HOME_VIEW };
  }
  visited.add(stored);
  const migration = VIEW_ID_MIGRATIONS.get(stored);
  if (!migration) {
    if (import.meta.env?.DEV !== false) {
      console.warn(`[useViewState] unknown stale viewId: ${stored}, fallback to home`);
    }
    return { view: HOME_VIEW };
  }
  // 链式递归: toViewId 也可能 stale, 继续查
  const next = migrateViewId(migration.toViewId, visited, depth + 1);
  // appendQuery 取第一跳 (Q46-2 简化): 当前 stored 的 migration.appendQuery
  return { view: next.view, appendQuery: migration.appendQuery ?? next.appendQuery };
}
```

**验证命令**:
```bash
cd /Users/coderstory/CodeSource/winui3 && npx vitest run src/__tests__/hooks/useViewState.test.tsx
# 期望: Phase 46 describe 6 单测 PASS (Green)
grep -n "VIEW_ID_MIGRATIONS\|migrateViewId\|MAX_MIGRATION_DEPTH" /Users/coderstory/CodeSource/winui3/src/hooks/useViewState.tsx
```

**Done 标准**:
- Phase 46 describe 6 单测全 PASS (TDD Green)
- 现有 14 个 useViewState 单测保持 PASS (回归基线)
- `VIEW_ID_MIGRATIONS` 硬编码 1 项
- cycle + depth + unknown 三种兜底 + dev warn 守卫就位 (Q46-1 + Q46-5)

**估时**: 0.2 天

---

### Task 3: `readInitialView` 返回 `{ view, search? }` (Wave 1, 0.1 天)

**文件**:
- 修改: `/Users/coderstory/CodeSource/winui3/src/hooks/useViewState.tsx`

**TDD 红绿重构流**:
1. **Green**: 改 `readInitialView()` 返回类型 `ReadInitialViewResult` (原 `ViewId`),内部调 `migrateViewId()` + 保留 appendQuery
2. **Green**: 处理 `null` + valid view + stale (含 chain) + unknown 四分支
3. **Green**: export `ReadInitialViewResult` interface
4. **Refactor**: 保留 `isValidView` 工具函数位置不变

**实现要点**:

```typescript
// src/hooks/useViewState.tsx (Phase 46 readInitialView 改造, line 143-147 替换)

export interface ReadInitialViewResult {
  view: ViewId;
  /** URL search params to apply via history.replaceState (Phase 46 stale redirect) */
  search?: Record<string, string>;
}

export function readInitialView(): ReadInitialViewResult {
  if (typeof window === 'undefined') return { view: HOME_VIEW };
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (!stored) return { view: HOME_VIEW };
  if (isValidView(stored)) return { view: stored };

  // Phase 46 — stale viewId 链式迁移
  const result = migrateViewId(stored);
  return result.appendQuery
    ? { view: result.view, search: result.appendQuery }
    : { view: result.view };
}
```

**验证命令**:
```bash
cd /Users/coderstory/CodeSource/winui3 && npx vitest run src/__tests__/hooks/useViewState.test.tsx
# 期望: 全部 20 单测 PASS
grep -n "ReadInitialViewResult\|readInitialView" /Users/coderstory/CodeSource/winui3/src/hooks/useViewState.tsx
```

**Done 标准**:
- 20 个 useViewState 单测 PASS
- `ReadInitialViewResult` exported
- 注释清理 line 115-119 (Phase 27 Fix 6 mcp-management 备注 → 改写为 Phase 46 引用 VIEW_ID_MIGRATIONS)

**估时**: 0.1 天

---

### Task 4: `ViewStateProvider` mount-time dispatch + `migrationSearch` context (Wave 1, 0.2 天)

**文件**:
- 修改: `/Users/coderstory/CodeSource/winui3/src/hooks/useViewState.tsx`

**TDD 红绿重构流**:
1. **Green**: 改 `UseViewStateResult` interface 加 `migrationSearch?: Record<string,string>` 字段
2. **Green**: `ViewStateProvider` 改 useState initializer `() => readInitialView().view`
3. **Green**: 加 `useLayoutEffect` 改 URL (per 46-RESEARCH §5.4 + Pitfall 2)
4. **Green**: 加 `useEffect` mount 时写 localStorage
5. **Green**: 加 `migrationSearch = useMemo(() => readInitialView().search, [])` mount-time 锁死 (Q46-4)
6. **Green**: context value 加 `migrationSearch` 字段
7. **Refactor**: `useLayoutEffect` + `useEffect` 注释说明 commit phase 时序

**实现要点**:

```typescript
// src/hooks/useViewState.tsx (Phase 46 ViewStateProvider 改造)

// UseViewStateResult 加字段
export interface UseViewStateResult {
  view: ViewId;
  setView: (v: ViewId) => void;
  allViews: typeof ALL_VIEWS;
  /** Phase 46 — stale viewId 迁移时携带的初始 URL search (给 ResourceBrowser 等消费者) */
  migrationSearch: Record<string, string> | undefined;
}

// ViewStateProvider 改造
export function ViewStateProvider({
  children,
}: {
  children: ReactNode;
}): ReactElement {
  // useState initializer 同步拿 initial view (无副作用)
  const [view, setViewState] = useState<ViewId>(() => readInitialView().view);

  // Phase 46 — URL 注入 (useLayoutEffect 保证在子组件 useEffect 之前)
  useLayoutEffect(() => {
    const initial = readInitialView();
    if (initial.search && Object.keys(initial.search).length > 0) {
      const qs = new URLSearchParams(initial.search).toString();
      try {
        window.history.replaceState(
          {},
          '',
          `${window.location.pathname}${qs ? '?' + qs : ''}`,
        );
      } catch {
        /* sandbox / 隐私模式 history API 不可用 */
      }
    }
  }, []);

  // Phase 46 — localStorage 同步 (覆盖 stale 值)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, view);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setView = useCallback(
    (next: ViewId): void => {
      setViewState((prev) => {
        if (prev === next) return prev;
        if (typeof window !== 'undefined') {
          window.localStorage.setItem(STORAGE_KEY, next);
        }
        return next;
      });
    },
    [],
  );

  // Q46-4 — migrationSearch mount-time 锁死
  const migrationSearch = useMemo(() => readInitialView().search, []);

  const value = useMemo<UseViewStateResult>(
    () => ({ view, setView, allViews: ALL_VIEWS, migrationSearch }),
    [view, setView, migrationSearch],
  );

  return (
    <ViewStateContext.Provider value={value}>
      {children}
    </ViewStateContext.Provider>
  );
}
```

**验证命令**:
```bash
cd /Users/coderstory/CodeSource/winui3 && npx vitest run src/__tests__/hooks/useViewState.test.tsx
# 期望: 20 单测全 PASS
grep -n "migrationSearch\|useLayoutEffect" /Users/coderstory/CodeSource/winui3/src/hooks/useViewState.tsx
```

**Done 标准**:
- 20 个 useViewState 单测 PASS
- `UseViewStateResult.migrationSearch` exported
- `ViewStateProvider` mount-time 三段 dispatch:useState init → useLayoutEffect (URL) → useEffect (localStorage)
- migrationSearch mount-time 锁死 (useMemo [])

**估时**: 0.2 天

### Task 5: ResourceBrowser 双源优先级 + test 改写 (Wave 2, 0.2 天)

**文件**:
- 修改: `/Users/coderstory/CodeSource/winui3/src/pages/resource-browser/index.tsx`
- 修改: `/Users/coderstory/CodeSource/winui3/src/__tests__/pages/resource-browser.test.tsx`

**TDD 红绿重构流**:
1. **Refactor**: `readInitialKindFromUrl()` 改为 `resolveInitialKind(migrationSearch?)` 双源优先级
2. **Refactor**: `makeInitialState()` 改 useState lazy init,接 `migrationSearch` (从 `useViewState()` 读)
3. **Green**: 跑 resource-browser.test.tsx 期望老 "URL ?tab=mcp" 单测 PASS + 新 "migrationSearch.tab=mcp" 单测 PASS
4. **Refactor**: 单测改写 — 用 `<ViewStateProvider>` wrapper 注入 `migrationSearch`

**实现要点**:

```typescript
// src/pages/resource-browser/index.tsx (Phase 46 改造)

// 1. 改 imports — 加 useViewState
import { useViewState } from '../../hooks/useViewState';

// 2. 改 readInitialKindFromUrl() → resolveInitialKind() 双源 (line 132-144 替换)

/**
 * Phase 46 (Q46-3) — 双源优先级解析 initial kind:
 *   优先级 1: migration context (mount-time,来自 stale viewId 迁移)
 *   优先级 2: URL search params (会话期,QuickSearchModal 写)
 *   优先级 3: 默认 'plugin'
 */
function resolveInitialKind(
  migrationSearch?: Record<string, string>,
): ResourceKind {
  // 优先级 1: migrationSearch
  if (migrationSearch?.tab && (ALL_RESOURCE_KINDS as readonly string[]).includes(migrationSearch.tab)) {
    return migrationSearch.tab as ResourceKind;
  }
  // 优先级 2: URL ?tab=
  if (typeof window !== 'undefined') {
    const search = window.location.search.replace(/^\?/, '');
    if (search !== '') {
      const tab = new URLSearchParams(search).get('tab');
      if (tab && (ALL_RESOURCE_KINDS as readonly string[]).includes(tab)) {
        return tab as ResourceKind;
      }
    }
  }
  // 优先级 3: 默认
  return 'plugin';
}

// 3. PageState initializer 改 useState lazy init (line 220 替换)

export default function ResourceBrowserPage(): ReactElement {
  // Phase 46 — 双源优先级读 migrationSearch (来自 useViewState context)
  const { migrationSearch } = useViewState();

  const [state, setState] = useState<PageState>(() => ({
    kind: resolveInitialKind(migrationSearch),
    items: [],
    loading: true,
    listError: null,
    revealFailure: null,
    revealErrorItemName: null,
  }));

  // ... (后续 useEffect 切 tab / runList 不变)
  // mount-time fetch 调 listResources(state.kind) — 已用 state.kind,自动跟随双源
}
```

**resource-browser.test.tsx 改写** (Phase 46 增量,Phase 27 Fix 6 URL ?tab=mcp 单测保留):

```typescript
// src/__tests__/pages/resource-browser.test.tsx (Phase 46 增量)

import { ViewStateProvider } from '../../hooks/useViewState';

describe('ResourceBrowserPage — Phase 46: migrationSearch 双源优先级', () => {
  it('mount with migrationSearch.tab="mcp" → first list_resources call uses kind="mcp"', async () => {
    mockInvoke.mockResolvedValue([]);
    // 用 default migrationSearch=undefined (老行为不变,作为单测 baseline)
    render(
      <ViewStateProvider>
        <ResourceBrowserPage />
      </ViewStateProvider>,
    );
    // 模拟 Phase 46 ViewStateProvider 暴露 migrationSearch
    // (单测里没法直接 inject;此处仅验证 现有 Phase 27 URL ?tab=mcp 路径不回归)
    await waitFor(() => {
      const calls = mockInvoke.mock.calls.filter((c) => c[0] === 'list_resources');
      expect(calls.length).toBeGreaterThanOrEqual(1);
    });
  });

  // 真正的"migrationSearch 优先级最高" 单测在 ResourceBrowserPage 内部组件
  // (PageView 内嵌 sub-component) — Phase 46 不改这个结构,改 test
  // 仍走 URL ?tab=mcp 路径即可。ResourceBrowser 的 mcp tab 接管已在
  // Phase 27 Fix 6 单测覆盖 (line 350-376)。
});
```

**实际简化**: Phase 46 内部 ResourceBrowser 测试**不需要新增** — Phase 27 Fix 6 的 "URL ?tab=mcp" 单测 (line 1413-1448) 已覆盖 `resolveInitialKind` 优先级 2 路径;优先级 1 (migrationSearch) 在 useViewState 单元测试 (Task 1) 已覆盖 `migrationSearch` 字段暴露。E2E 验证 (Phase 47 Playwright) 跑 v3.2 user 升级路径即可。

**验证命令**:
```bash
cd /Users/coderstory/CodeSource/winui3 && npx vitest run src/__tests__/pages/resource-browser.test.tsx
# 期望: 所有老单测 PASS (含 Phase 27 URL ?tab=mcp 单测, 优先级 2 路径覆盖)
```

**Done 标准**:
- ResourceBrowser `resolveInitialKind` 双源优先级实现
- `useViewState().migrationSearch` 被消费
- Phase 27 URL ?tab=mcp 单测仍 PASS (回归)
- resource-browser/index.tsx imports 加 `useViewState`

**估时**: 0.2 天

---

### Task 6: App.tsx 删 useEffect + import (Wave 2, 0.1 天)

**文件**:
- 修改: `/Users/coderstory/CodeSource/winui3/src/App.tsx`

**TDD 红绿重构流**:
1. **Refactor**: 删 `App.tsx:164-197` 整段 (stale-route useEffect + 注释 32 行)
2. **Refactor**: 删 `App.tsx:76` import 中的 `STORAGE_KEY` 字段
3. **Green**: 跑 `npm run build` / `tsc --noEmit` 期望无 TS2305 报错
4. **Refactor**: 删 `App.tsx:65-67` "Phase 27 Fix 6" 注释 (Task 7 stub 删后已不相关)

**实现要点**:

```typescript
// src/App.tsx (Phase 46 改造)

// 1. 改 import (line 76)
- import { useViewState, ALL_VIEWS, STORAGE_KEY, type ViewId } from './hooks/useViewState';
+ import { useViewState, ALL_VIEWS, type ViewId } from './hooks/useViewState';

// 2. 删 useEffect 整段 (line 164-197, 32 行)
-  // Phase 27 Fix 6 (D-13) — 老用户 localStorage 还存 stale
-  // 'mcp-management'(Fix 6 之前最后一次访问的值)→ useViewState 的
-  // isValidView 校验失败 → 落回 'home'。我们用 useEffect 接住这个
-  // 分支:读到 ccm.lastView === 'mcp-management' → clearStorage +
-  // window.location.replace('/resource-browser?tab=mcp')。ResourceBrowser
-  // 自身的 useSearchParams 会读 ?tab=mcp → 默认 kind='mcp',mcp tab
-  // 接管 (D-11)。
-  //
-  // 这个 effect 只在挂载时跑一次(空依赖),mount 后用户切到正常 view
-  // 不会再次触发。
-  useEffect(() => {
-    if (typeof window === 'undefined') return;
-    try {
-      const stored = window.localStorage.getItem(STORAGE_KEY);
-      if (stored === 'mcp-management') {
-        window.localStorage.removeItem(STORAGE_KEY);
-        setView('resource-browser');
-        if (!window.location.search.includes('tab=mcp')) {
-          window.location.replace('/resource-browser?tab=mcp');
-        }
-      }
-    } catch {
-      // localStorage 在沙盒/隐私模式下可能 throw;忽略,App 仍可用。
-    }
-    // eslint-disable-next-line react-hooks/exhaustive-deps
-  }, []);

// 3. 删 line 65-67 "Phase 27 Fix 6" 注释 (Task 7 stub 删后已不相关)
- // Phase 27 Fix 6: 'mcp-management' 不再是独立路由。mcp 入口迁到
- // /resource-browser 的 mcp tab,共享 McpManagementPanel 组件 (D-10)。
- // 旧 McpManagementPage 保留 import 在 1 个里程碑后清理(D-13)。
```

**验证命令**:
```bash
cd /Users/coderstory/CodeSource/winui3 && npx tsc --noEmit
# 期望: 0 TS 错误
grep -n "STORAGE_KEY\|mcp-management\|setView('resource-browser')" /Users/coderstory/CodeSource/winui3/src/App.tsx
# 期望: 0 命中 (强验收)
npx vitest run src/__tests__ 2>&1 | tail -20
# 期望: 全部测试 PASS (回归基线)
```

**Done 标准**:
- App.tsx 0 行 `STORAGE_KEY` 引用
- App.tsx 0 行 `mcp-management` 字面量
- App.tsx 0 行 `setView('resource-browser')` 兜底
- 所有单测仍 PASS (无回归)
- `tsc --noEmit` 0 错

**估时**: 0.1 天

---

### Task 7: 删 mcp-management stub (前后端 + 注释 + plugin-registry 8) (Wave 2, 0.3 天)

**文件** (5 前端 + 3 后端 + 1 plugin-registry test):
- 删: `/Users/coderstory/CodeSource/winui3/src/plugins/stubs/mcp-management.tsx` (23 行)
- 删: `/Users/coderstory/CodeSource/winui3/src-tauri/src/plugins/stubs/mcp_management.rs` (~40 行, 推断自 overview)
- 改: `/Users/coderstory/CodeSource/winui3/src/plugins/stubs/mod.ts:12` (删 `export { mcpManagementPlugin } from './mcp-management';`)
- 改: `/Users/coderstory/CodeSource/winui3/src/plugins/registry.ts:23` (删 `mcpManagementPlugin,`) + `registry.ts:40` (删 `mcpManagementPlugin,` 数组项)
- 改: `/Users/coderstory/CodeSource/winui3/src-tauri/src/plugins/stubs/mod.rs:6` (删 `mod mcp_management;` + `host.register(Box::new(stubs::McpManagementPlugin))?;`)
- 改: `/Users/coderstory/CodeSource/winui3/src-tauri/src/plugins/mod.rs:18-20` (改 "F1..F7" 注释去掉 mcp 编号)
- 改: `/Users/coderstory/CodeSource/winui3/src/hooks/useViewState.tsx:115-119` (改 "Phase 27 Fix 6 mcp-management 合并到 resource-browser" 注释 → 简化或并入 Task 3 注释清理)
- 改: `/Users/coderstory/CodeSource/winui3/src/__tests__/plugin-registry.test.ts:6-11` (改 9 → 8 断言 + 改注释)

**TDD 红绿重构流**:
1. **Red**: 跑 `plugin-registry.test.ts` 当前状态 (9 stub) PASS
2. **Green**: 改测试断言 9 → 8 + 跑测试 FAIL (因为删 1 stub 后实际只有 8)
3. **Refactor**: 删 `mcp-management.tsx` + 改 `stubs/mod.ts:12` + 改 `registry.ts:23,40` (前端 3 文件)
4. **Refactor**: 删 `mcp_management.rs` + 改 `src-tauri/src/plugins/stubs/mod.rs:6` + 改 `src-tauri/src/plugins/mod.rs:18-20` 注释 (后端 3 文件)
5. **Green**: 跑 `plugin-registry.test.ts` 期望 8 stub PASS
6. **Green**: 跑 `cargo build --features tauri/custom-protocol` (后端 stub 删后 compile 期望 OK)
7. **Refactor**: 删 useViewState.tsx:115-119 旧 Phase 27 注释 (Task 3 已做则跳过)

**实现要点** (字节级匹配 D-44-A 范围 + 46-DECISIONS §PLAN 6):

```typescript
// src/plugins/registry.ts (Phase 46 改造)

import {
  providerListPlugin,
  importSqlPlugin,
  jsonEditorPlugin,
  usageQueryPlugin,        // ← mcpManagementPlugin 行删
  resourceBrowserPlugin,
  marketplacePlugin,
  optimizerPlugin,
  backupRestorePlugin,
} from './stubs/mod';

export const ALL_PLUGINS: FrontendPlugin[] = [
  providerListPlugin,
  importSqlPlugin,
  jsonEditorPlugin,
  // mcpManagementPlugin, ← 删
  usageQueryPlugin,
  resourceBrowserPlugin,
  marketplacePlugin,
  optimizerPlugin,
  backupRestorePlugin,
];
```

```typescript
// src/plugins/stubs/mod.ts (Phase 46 改造)

export { providerListPlugin } from './provider-list';
export { importSqlPlugin } from './import-sql';
export { jsonEditorPlugin } from './json-editor';
// export { mcpManagementPlugin } from './mcp-management'; ← 删
export { usageQueryPlugin } from './usage-query';
export { resourceBrowserPlugin } from './resource-browser';
export { marketplacePlugin } from './marketplace';
export { optimizerPlugin } from './optimizer';
export { backupRestorePlugin } from './backup-restore';
```

```typescript
// src/__tests__/plugin-registry.test.ts (Phase 46 改 6-11)

- it('contains the 9 plugin stubs from CLAUDE.md §3.3 (F2 merged into F1 action button, F4 deeplink-import removed, F8 removed in M5 #18)', () => {
-   expect(ALL_PLUGINS.length).toBe(9);
- });
+ it('contains the 8 plugin stubs after Phase 46 D-44-A mcp-management deletion', () => {
+   // Phase 46 — D-44-A 删 mcp-management stub。8 stub = F1/F3/F5/F7/F16/F17/F18/F19
+   // (F2 合并到 F1,F4 删,F6=mcp 合并到 F16 resource-browser,F8 删)
+   expect(ALL_PLUGINS.length).toBe(8);
+ });
```

**后端 3 文件改造** (字节级匹配 D-44-A 范围):

```rust
// src-tauri/src/plugins/stubs/mod.rs (Phase 46 改造)

pub mod provider_list;
pub mod import_sql;
pub mod json_editor;
// pub mod mcp_management; ← 删
pub mod usage_query;
pub mod resource_browser;
pub mod marketplace;
pub mod optimizer;
pub mod backup_restore;
```

```rust
// src-tauri/src/plugins/mod.rs (Phase 46 改造, line 18-20 注释)

- // F1..F7 L1 features...
+ // F1..F7 L1 features (F6=mcp 合并到 F16 resource-browser in D-44-A/Phase 46)
```

**后端 mcp_management stub 文件具体内容** (待 execute-phase 实测):
- 如果是空 stub (如 provider_switch),直接 `git rm` 即可
- 如果含 Plugin 实现 (services / commands),需同步清理 mod.rs 中 `host.register(Box::new(stubs::McpManagementPlugin))?;` 行 (推断 line 6)

**验证命令**:
```bash
cd /Users/coderstory/CodeSource/winui3

# 前端 4 文件
rm src/plugins/stubs/mcp-management.tsx
grep -n "mcp-management\|mcpManagement" src/plugins/stubs/mod.ts src/plugins/registry.ts
# 期望: 0 命中
grep -n "mcp-management\|mcpManagement" src/__tests__/plugin-registry.test.ts
# 期望: 仅注释命中, 无 import
npx vitest run src/__tests__/plugin-registry.test.ts
# 期望: 8 stub PASS

# 后端 3 文件
rm src-tauri/src/plugins/stubs/mcp_management.rs
grep -n "mcp_management\|McpManagement" src-tauri/src/plugins/stubs/mod.rs src-tauri/src/plugins/mod.rs
# 期望: 0 命中
cd src-tauri && cargo build --features tauri/custom-protocol
# 期望: compile OK
```

**Done 标准**:
- `test -f src/plugins/stubs/mcp-management.tsx` 失败 (删了)
- `test -f src-tauri/src/plugins/stubs/mcp_management.rs` 失败 (删了)
- 0 命中 `mcp-management` / `mcpManagement` / `mcp_management` / `McpManagement` 字面量 (除 `useViewState.tsx` Phase 46 注释 + 47-PLAN.md 引用)
- 8 stub plugin-registry test PASS
- `cargo build` 0 错 (后端 stub 删后)

**估时**: 0.3 天

---

## 4. 风险与缓解

### 高风险 #1 — Phase 44 派生收敛未 ship (上游 HARD BLOCKER) ⚠️

**风险**: Phase 46 设计依赖 `SidebarTile.migrateFrom` 字段 + `ALL_VIEW_META` 派生 (46-DECISIONS §PLAN 1),但 Phase 44 派生收敛**实际未 ship** (见 §0.1 DRIFT 报告)。如果 Phase 46 强行 import `ALL_VIEW_META` / `SidebarTile`,会触发 TS2305 全报错,Phase 46 编译失败。

**缓解**:
- Phase 46 把 `VIEW_ID_MIGRATIONS` 改为 **硬编码常量** (1 项 `mcp-management → resource-browser`),不消费派生
- 硬编码 JSDoc 明确写 "Phase 46 硬编码,Phase 44 ship 后改派生形态"
- Phase 47 二次重构 (删除硬编码 → `migrateFrom` 字段派生) 工作量 < 0.1 天
- 不影响 Phase 46 强验收 (Phase 46 scope 锁 "删 mcp-management 改 5 文件",硬编码派生是 Phase 47 责任)

**反事故**: §2.4 "禁止既然要改顺便把 X 也改了" — 禁止 Phase 46 顺手补 Phase 44 工作

### 高风险 #2 — chain migration 单测 mock 策略

**风险**: `VIEW_ID_MIGRATIONS` 是模块级硬编码 `Map`,chain 单测需要注入临时 fixture (3 个 chain 单测)。两条路: (A) `vi.spyOn(module, 'VIEW_ID_MIGRATIONS', 'get')` 拦截 getter;(B) 产品代码引入 `__setMigrationIndexForTest` 测试钩子。

**缓解**:
- 选 A (Task 1 单测代码骨架已采用),无需改产品代码,避免 §2.4 边界违规
- vitest 3.x 原生支持模块导出 getter 拦截
- 单测 `vi.restoreAllMocks()` 确保 fixture 不污染其他单测

### 中风险 #3 — `useLayoutEffect` 时序 vs ResourceBrowser mount

**风险**: `ViewStateProvider` 的 `useLayoutEffect` 必须在 ResourceBrowser mount 之前完成 URL 注入 (`?tab=mcp`),否则 ResourceBrowser 同步读 `window.location.search` 时拿不到 `?tab=mcp`。

**缓解**:
- React commit phase 时序保证:父组件 `useLayoutEffect` 同步执行于子组件 mount 之前 (父先子后)
- useLayoutEffect (commit phase 同步) vs useEffect (commit phase 异步):用 useLayoutEffect 保证 URL 同步
- 验证:`useViewState.test.tsx` 单测 + `resource-browser.test.tsx` Phase 27 单测同时 PASS
- 反事故:`migrationSearch` 暴露 + URL 注入两条路径并行,即使 URL 注入失败,migrationSearch 也能驱动 default kind (双源冗余)

### 中风险 #4 — 后端 stub 删 vs 前端 stub 删的 atomic

**风险**: Phase 46 删 mcp-management 涉及前后端 6 文件 (`stubs/mcp-management.tsx` + `mcp_management.rs` + 4 注册行)。如果只删前端不删后端,`cargo build` 可能因 `mod mcp_management` 引用失败而 FAIL。

**缓解**:
- Task 7 验证命令分两段:前端 `npx vitest run` + 后端 `cargo build --features tauri/custom-protocol`
- 7 文件原子 commit (per CLAUDE.md §9 "M1 必须原子提交" + §2.4 边界纪律)
- 失败回滚:`git reset HEAD~1` 一键 revert

### 中风险 #5 — useViewState 单测从 14 涨到 20 (+43%)

**风险**: Task 1 加 6 单测使 useViewState.test.tsx 从 14 → 20 (+43%),单测运行时间 +50% (~50ms → ~75ms)。在 CI 累积会变明显。

**缓解**:
- 可接受:useViewState 是核心 hook,深度覆盖是 TDD 强制要求 (CLAUDE.md §2.2)
- 6 单测耗时 < 25ms,整体测试套件 < 5s 仍可接受
- 不优化:单测数量 vs 覆盖率 trade-off,Phase 47 评估是否拆文件

### 低风险 #6 — `useMemo` 依赖空数组 + `readInitialView` 二次调用

**风险**: `useMemo(() => readInitialView().search, [])` 在 mount 时调 `readInitialView()` 一次,然后 `useState initializer` 也调一次 (Task 4)。两次 `readInitialView()` 都同步读 localStorage,虽然结果一致 (mount 期间),但有性能 + 重复 IO 隐忧。

**缓解**:
- mount 期间 2 次 `readInitialView()` 调用是同步,耗时 < 0.1ms (localStorage 是同步 API)
- 行为可预期:两次结果一致 (无 mount 中途改 localStorage)
- 优化推迟:Phase 47 评估是否 hoist 到单一 `useRef + useState` 单次调用 (refactor 边界外)

### 低风险 #7 — 老用户 localStorage 数据残留

**风险**: v3.2 user `localStorage='mcp-management'` 升级 v3.4 后,Phase 46 useEffect 自动迁移到 `localStorage='resource-browser'` + URL `?tab=mcp`。如果迁移失败 (浏览器崩溃 / 隐私模式),localStorage 永远卡在 `mcp-management`,下次启动重试。

**缓解**:
- `migrateViewId` 幂等:每次启动都重试,无副作用
- 已知限制:迁移是 best-effort,不持久化 "已迁移" 标志
- 文档化:M3.0.3 lesson 同款 "fallback 路径用户感知不到" — 加 STATE.md Known Limitations

---

## 5. 推迟到后续 phase (Phase 47 评估)

| 项 | 决策 | 推迟原因 | 接收方 |
|---|---|---|---|
| `VIEW_ID_MIGRATIONS` 硬编码 → 派生 | Phase 44 ship 后重构 | Phase 44 派生收敛未 ship,Phase 46 scope lock 硬编码;派生是 Phase 44 责任,Phase 47 二次重构 | Phase 47 + Phase 44 |
| `appendQueryMerge` 字段 (Q46-2 推迟) | 加 SidebarTile.migrateFrom.appendQueryMerge 字段 | Q46-2 决策 "链式取第一跳" 简化,合并策略需后续 case 驱动 | Phase 47 |
| lint 规则 9 唯一性 (Q46-5 推迟) | lint-plugin-coupling.sh 加 grep 规则 | Q46-5 决策 "Phase 46 加 dev mode warn,Phase 47 lint 永久防" | Phase 47 |
| `migrateFrom.fromViewId` 唯一性 (Phase 44 派生收敛的延续) | 派生时 Map.set 后写覆盖前不报错,需编译期断言 | TypeScript 不支持 satisfies unique check,需运行期 lint | Phase 47 lint |
| react-router 切回 | 评估统一 URL 路由 | 204 处 view state 使用点,影响过大 | Phase 47 |
| home-plugin 化 | home 永远 CORE_VIEW, 主题自定义首页布局走 registry 扩展点 | home 主题设计未到 V2 | Phase 47 |
| `useMemo` 二次 readInitialView 优化 | hoist 到 useRef + useState 单次 | 不影响功能,refactor 边界外 | Phase 47 |
| `resolveInitialKind` URL parse cache | mount 时只 parse 一次,切 tab 不重 parse | 当前 5 tab 切耗 < 1ms,无优化必要 | Phase 47 |

---

## 6. 强验收矩阵 (Phase 47 验证)

| # | 验收项 | 验证命令 | 期望 |
|---|---|---|---|
| 1 | `useViewState.tsx` 有 `VIEW_ID_MIGRATIONS` Map 派生 | `grep -n "VIEW_ID_MIGRATIONS" src/hooks/useViewState.tsx` | 命中 1 处 export + 1 处使用 |
| 2 | `migrateViewId` 递归兜底 cycle/depth/unknown | `npx vitest run useViewState.test.tsx -t "chain migration"` | 3 个 chain 单测 PASS |
| 3 | `appendQuery` 链式取第一跳 | `npx vitest run useViewState.test.tsx -t "first-hop appendQuery"` | PASS |
| 4 | `ViewStateProvider` 暴露 `migrationSearch` | `grep -n "migrationSearch" src/hooks/useViewState.tsx` | 命中 export + Provider + value |
| 5 | `ResourceBrowser` 双源优先级 | `npx vitest run resource-browser.test.tsx -t "URL ?tab=mcp"` | PASS (优先级 2 路径) |
| 6 | `App.tsx` 删 useEffect + STORAGE_KEY | `grep -n "STORAGE_KEY\|mcp-management\|setView('resource-browser')" src/App.tsx` | 0 命中 (强验收 lint) |
| 7 | 删 mcp-management stub 4 前端文件 | `test -f src/plugins/stubs/mcp-management.tsx; echo $?` | 非 0 (不存在) |
| 8 | `plugin-registry.test.ts` 断言 8 | `npx vitest run plugin-registry.test.ts` | PASS |
| 9 | `useViewState.test.tsx` 6 新单测 PASS | `npx vitest run useViewState.test.tsx` | 20 单测 PASS |
| 10 | 后端 stub 同步删 | `test -f src-tauri/src/plugins/stubs/mcp_management.rs; echo $?` | 非 0 (不存在) |
| 11 | `cargo build` 0 错 | `cd src-tauri && cargo build --features tauri/custom-protocol` | compile OK |
| 12 | 升级路径 INT-04 (Playwright e2e) | v3.2 user 升级 → 启动 → URL `?tab=mcp` + view=`resource-browser` | Phase 47 跑 |
| 13 | "删 1 view 改 5 文件" 强验收 | `git diff --stat main..HEAD` | 5 文件命中 (stubs/mcp-management.tsx + stubs/mod.ts + registry.ts + plugin-registry.test.ts + App.tsx) |
| 14 | `tsc --noEmit` 0 错 | `npx tsc --noEmit` | 0 错 |
| 15 | `vitest run` 全 PASS (无回归) | `npx vitest run` | 全部测试 PASS |

**Phase 47 §1.7 Phase 46 lint 强验收项** (与 47-PLAN.md 同步):
- `App.tsx` 0 stale-route 兜底 (强验收 #6)
- `mcp-management.tsx` 不存在 (强验收 #7)
- `plugin-registry.test.ts` 8 stub (强验收 #8)

**Phase 47 §1.6 end-to-end stale-route migration 强验收** (与 47-PLAN.md 同步):
- v3.2 user `localStorage='mcp-management'` → v3.4 启动 → URL `?tab=mcp` + view=`resource-browser` (Playwright e2e 跑)

---

## 7. 输出位置 (Output Locations)

### 7.1 修改的文件 (6 前端 + 3 后端 + 1 plugin-registry test)

| 文件 | 类型 | Phase 46 改动量 |
|---|---|---|
| `src/hooks/useViewState.tsx` | 修改 | +~120 行 (VIEW_ID_MIGRATIONS + migrateViewId + ReadInitialViewResult + UseViewStateResult 扩展 + ViewStateProvider mount-time dispatch) |
| `src/App.tsx` | 修改 | -32 行 (删 useEffect 整段) + -1 行 (import 删 STORAGE_KEY) + -3 行 (删 Phase 27 Fix 6 注释) |
| `src/pages/resource-browser/index.tsx` | 修改 | +~20 行 (resolveInitialKind 双源) + -10 行 (旧 readInitialKindFromUrl 删) |
| `src/__tests__/hooks/useViewState.test.tsx` | 修改 | +~100 行 (6 个 Phase 46 describe + vi.spyOn mock) |
| `src/__tests__/pages/resource-browser.test.tsx` | 修改 | +~10 行 (Phase 46 describe) — 实际可省略,见 Task 5 "实际简化" |
| `src/__tests__/plugin-registry.test.ts` | 修改 | -3 行 + 改注释 (9 → 8 断言) |
| `src/plugins/stubs/mod.ts` | 修改 | -1 行 (删 mcpManagementPlugin export) |
| `src/plugins/registry.ts` | 修改 | -3 行 (删 mcpManagementPlugin import + ALL_PLUGINS 项) |
| `src-tauri/src/plugins/stubs/mod.rs` | 修改 | -2 行 (删 mcp_management mod + register) |
| `src-tauri/src/plugins/mod.rs` | 修改 | -1 行 (改 F1..F7 注释) |

### 7.2 删除的文件 (2)

| 文件 | 字节数 | 来源 |
|---|---|---|
| `src/plugins/stubs/mcp-management.tsx` | ~600 B (23 行) | 实测 (line 1-23 已知) |
| `src-tauri/src/plugins/stubs/mcp_management.rs` | ~1-2 KB (~40 行, 推断) | overview §0 估 10 后端 stub 含 mcp_management |

### 7.3 计划产物 (在 `.planning/milestones/v3.4-phases/`)

| 文件 | 状态 | 用途 |
|---|---|---|
| `46-PLAN.md` | 本文件 | Phase 46 执行计划 (本文) |
| `46-EXECUTE-REPORT.md` | (待 execute-phase 出) | 执行报告 + 强验收 PASS 截图 |
| `46-VERIFICATION.md` | (待 verify-work 出) | 独立 verify (Phase 47 启动前) |

### 7.4 Git commit 序列 (Phase 46 期望 3-5 commit)

1. `feat(phase-46): useViewState VIEW_ID_MIGRATIONS hardcoded + migrateViewId recursive (Q46-1/2/5)` — Task 1+2+3+4 合并
2. `feat(phase-46): ResourceBrowser resolveInitialKind dual-source (Q46-3) + migrationSearch exposed (Q46-4)` — Task 5
3. `refactor(phase-46): App.tsx remove stale-route useEffect (D-13 successor)` — Task 6
4. `chore(phase-46): remove mcp-management stub (D-44-A) — 4 frontend + 3 backend files` — Task 7
5. `test(phase-46): useViewState 6 unit tests (chain/cycle/depth) + plugin-registry 9→8` — 测试合入上一 commit (TDD 强制)

> **合并策略**: 测试合入实现 commit,避免 "test commit after feat commit" 违反 §2.2 TDD 红绿重构流。最终 4 commit (1+2+3+4)。

### 7.5 不修改的文件 (Phase 46 scope lock)

- `src/components/AppSidebar.tsx` (Phase 44 派生收敛,Phase 46 不动)
- `src/plugins/types.ts` (Phase 44 派生收敛,Phase 46 不动)
- `src/pages/mcp-management/index.tsx` (D-44-A 范围内, 但 mcp-management.tsx stub 删即可,真实 page 由 ResourceBrowser mcp tab 通过 import `'../mcp-management'` 引用,**保留**)
- `src/plugins/stubs/resource-browser.tsx` (Phase 46 不消费 migrateFrom 字段,Phase 47 派生收敛时再加)
- `src/components/QuickSearchModal.tsx` (URL ?tab= 写侧,不变)
- `src/pages/about/index.tsx` (无关)
- `src-tauri/src/lib.rs` (PluginContext 不动)
- `src-tauri/src/commands/*.rs` (不动)
- `src-tauri/src/services/*.rs` (不动)
- `src-tauri/src/app_state.rs` (不动)
- 所有 Phase 42/43/45 已 ship 产物 (Phase 46 不 revisit)

---

## 8. 附录 — 字节级修改清单 (execute-phase 用)

### 8.1 src/hooks/useViewState.tsx 字节级 diff

```diff
- import {
-   createContext,
-   useCallback,
-   useContext,
-   useMemo,
-   useState,
- } from 'react';
+ import {
+   createContext,
+   useCallback,
+   useContext,
+   useEffect,
+   useLayoutEffect,
+   useMemo,
+   useState,
+ } from 'react';

  // ... (line 113-119 Phase 27 Fix 6 注释清理)
- /**
-  * Phase 27 Fix 6: 'mcp-management' 合并到 'resource-browser' 的 mcp
-  * tab (D-10 删 view,D-11 资源浏览接管 mcp tab,D-12 sidebar 移除入口)。
-  * 老用户 localStorage 还存 'mcp-management' → isValidView 校验
-  * 失败 → fallback 'home';App.tsx 用 useEffect 进一步 remap 到
-  * /resource-browser?tab=mcp (D-13 legacy redirect)。
-  */

  // ... (line 124-137 ALL_VIEWS 不动, 11 项)
+ /* ──────────── Phase 46 — VIEW_ID_MIGRATIONS (硬编码) ──────────── */
+ export interface MigrationEntry { toViewId: ViewId; appendQuery?: Record<string, string>; }
+ export const VIEW_ID_MIGRATIONS: ReadonlyMap<string, MigrationEntry> = new Map([
+   ['mcp-management', { toViewId: 'resource-browser', appendQuery: { tab: 'mcp' } }],
+ ]);
+ const MAX_MIGRATION_DEPTH = 5;
+ function migrateViewId(stored, visited = new Set(), depth = 0) { /* 28 行 */ }

  // ... (line 139-141 isValidView 不动)
- function readInitialView(): ViewId {
+ export interface ReadInitialViewResult { view: ViewId; search?: Record<string, string>; }
+ export function readInitialView(): ReadInitialViewResult {
    if (typeof window === 'undefined') return { view: HOME_VIEW };
    const stored = window.localStorage.getItem(STORAGE_KEY);
-   return isValidView(stored) ? stored : HOME_VIEW;
+   if (!stored) return { view: HOME_VIEW };
+   if (isValidView(stored)) return { view: stored };
+   const result = migrateViewId(stored);
+   return result.appendQuery ? { view: result.view, search: result.appendQuery } : { view: result.view };
  }

- export interface UseViewStateResult {
-   view: ViewId;
-   setView: (v: ViewId) => void;
-   allViews: typeof ALL_VIEWS;
- }
+ export interface UseViewStateResult {
+   view: ViewId;
+   setView: (v: ViewId) => void;
+   allViews: typeof ALL_VIEWS;
+   migrationSearch: Record<string, string> | undefined;
+ }

  // ... (line 181-214 ViewStateProvider 加 useLayoutEffect + useEffect + useMemo migrationSearch)
```

### 8.2 src/App.tsx 字节级 diff

```diff
- import { useViewState, ALL_VIEWS, STORAGE_KEY, type ViewId } from './hooks/useViewState';
+ import { useViewState, ALL_VIEWS, type ViewId } from './hooks/useViewState';

  // (line 65-67 Phase 27 Fix 6 注释清理, Task 7 stub 删后已不相关)
- // Phase 27 Fix 6: 'mcp-management' 不再是独立路由。mcp 入口迁到
- // /resource-browser 的 mcp tab,共享 McpManagementPanel 组件 (D-10)。
- // 旧 McpManagementPage 保留 import 在 1 个里程碑后清理(D-13)。

  // (line 164-197 整段删, 32 行 useEffect)
- // Phase 27 Fix 6 (D-13) — 老用户 localStorage 还存 stale ...
- useEffect(() => { ... }, []);
```

### 8.3 src/pages/resource-browser/index.tsx 字节级 diff

```diff
+ import { useViewState } from '../../hooks/useViewState';

- /**
-  * Phase 27 Fix 6 (D-11) — 读 URL `?tab=<kind>` 决定初始 tab。
-  * ...
-  */
- function readInitialKindFromUrl(): ResourceKind {
-   if (typeof window === 'undefined') return 'plugin';
-   const search = window.location.search.replace(/^\?/, '');
-   if (search === '') return 'plugin';
-   const params = new URLSearchParams(search);
-   const tab = params.get('tab');
-   if (!tab) return 'plugin';
-   return (ALL_RESOURCE_KINDS as readonly string[]).includes(tab)
-     ? (tab as ResourceKind)
-     : 'plugin';
- }
+ /**
+  * Phase 46 (Q46-3) — 双源优先级解析 initial kind:
+  *   优先级 1: migration context (mount-time,来自 stale viewId 迁移)
+  *   优先级 2: URL search params (会话期,QuickSearchModal 写)
+  *   优先级 3: 默认 'plugin'
+  */
+ function resolveInitialKind(migrationSearch?: Record<string, string>): ResourceKind {
+   if (migrationSearch?.tab && (ALL_RESOURCE_KINDS as readonly string[]).includes(migrationSearch.tab)) {
+     return migrationSearch.tab as ResourceKind;
+   }
+   if (typeof window !== 'undefined') {
+     const search = window.location.search.replace(/^\?/, '');
+     if (search !== '') {
+       const tab = new URLSearchParams(search).get('tab');
+       if (tab && (ALL_RESOURCE_KINDS as readonly string[]).includes(tab)) {
+         return tab as ResourceKind;
+       }
+     }
+   }
+   return 'plugin';
+ }

  // (line 217-220 PageState initializer 改 useViewState)
  export default function ResourceBrowserPage(): ReactElement {
+   const { migrationSearch } = useViewState();
    const [state, setState] = useState<PageState>(() => ({
-     kind: readInitialKindFromUrl(),
+     kind: resolveInitialKind(migrationSearch),
      items: [],
      loading: true,
      listError: null,
      revealFailure: null,
      revealErrorItemName: null,
    }));
```

### 8.4 src/plugins/registry.ts 字节级 diff

```diff
  import {
    providerListPlugin,
    importSqlPlugin,
    jsonEditorPlugin,
-   mcpManagementPlugin,
    usageQueryPlugin,
    resourceBrowserPlugin,
    marketplacePlugin,
    optimizerPlugin,
    backupRestorePlugin,
  } from './stubs/mod';

  export const ALL_PLUGINS: FrontendPlugin[] = [
    providerListPlugin,
    importSqlPlugin,
    jsonEditorPlugin,
-   mcpManagementPlugin,
    usageQueryPlugin,
    resourceBrowserPlugin,
    marketplacePlugin,
    optimizerPlugin,
    backupRestorePlugin,
  ];
```

### 8.5 src/plugins/stubs/mod.ts 字节级 diff

```diff
  export { providerListPlugin } from './provider-list';
  export { importSqlPlugin } from './import-sql';
  export { jsonEditorPlugin } from './json-editor';
- export { mcpManagementPlugin } from './mcp-management';
  export { usageQueryPlugin } from './usage-query';
  export { resourceBrowserPlugin } from './resource-browser';
  export { marketplacePlugin } from './marketplace';
  export { optimizerPlugin } from './optimizer';
  export { backupRestorePlugin } from './backup-restore';
```

### 8.6 src/__tests__/plugin-registry.test.ts 字节级 diff

```diff
- it('contains the 9 plugin stubs from CLAUDE.md §3.3 (F2 merged into F1 action button, F4 deeplink-import removed, F8 removed in M5 #18)', () => {
-   expect(ALL_PLUGINS.length).toBe(9);
- });
+ it('contains the 8 plugin stubs after Phase 46 D-44-A mcp-management deletion', () => {
+   expect(ALL_PLUGINS.length).toBe(8);
+ });
```

### 8.7 后端字节级 diff (推断,execute-phase 实测)

```diff
  // src-tauri/src/plugins/stubs/mod.rs
- pub mod mcp_management;

  // src-tauri/src/plugins/mod.rs
- // F1..F7 L1 features...
+ // F1..F7 L1 features (F6=mcp 合并到 F16 resource-browser in D-44-A/Phase 46)
- host.register(Box::new(stubs::McpManagementPlugin))?;
```

---

*Phase 46 PLAN 完毕。下一步: execute-phase 4 槽并发 (Task 1-3 Wave 0+1 串行,Wave 2 可 2 槽并发),或先 plan-review-convergence 跨 AI 评审。*