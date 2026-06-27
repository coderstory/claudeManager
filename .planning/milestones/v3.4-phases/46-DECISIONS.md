---
gsd_decisions_version: 1.0
phase: 46
decided: 2026-06-27
decided_by: discuss-phase subagent (待用户复核)
based_on: ../v3.4-DECISIONS.md (5 BLOCKING 关闭) + ./46-RESEARCH.md Open Questions
---

# Phase 46 DECISIONS

> 关闭 Phase 46 剩余 Open Questions。5 BLOCKING 见 ../v3.4-DECISIONS.md (继承 D-44-A: mcp-management 删, 由 Phase 46 负责).

## 已关闭决策 (继承)

- **D-44-A**: mcp-management stub 删除, 由 Phase 46 负责 (启用 VIEW_ID_MIGRATIONS + 删 stub + 改 test fixture)

## Phase 46 剩余 OQ 关闭

### Q46-1 (D-44-A 关闭): mcp-management stub 删
- 见 ../v3.4-DECISIONS.md D-44-A
- **影响**: 删 4 文件 (stubs/mcp-management.tsx + stubs/mod.ts export + registry.ts import + ALL_PLUGINS 项) + 改 plugin-registry.test.ts 断言 9→8; 验证 resource-browser.sidebarTile.migrateFrom.fromViewId='mcp-management' 仍工作 (VIEW_ID_MIGRATIONS 反向索引独立存在)

### Q46-2: appendQuery 链式多跳
- **决策**: 只取最终一跳 (Phase 46 简化)
- **理由**: 中间跳 appendQuery 是"局部上下文", 最终跳是"目标 view 初始 state"; 合并多跳引入隐式优先级违反 §2.1
- **影响**: migrateViewId 递归返回 `toViewId 的 view + 第一跳 appendQuery`; JSDoc 标注 "链式时取第一跳"

### Q46-3: `?tab=mcp` URL 契约
- **决策**: 保留 URL 作为一等公民
- **理由**: Phase 27 Fix 6 已建 URL 契约 (QuickSearchModal 写 URL); 用户复制/分享 URL 期望带 ?tab=mcp; ResourceBrowser readInitialKindFromUrl 已实现
- **影响**: ViewStateProvider useLayoutEffect history.replaceState 改 URL; ResourceBrowser 优先级: migrationSearch (mount) > URL (会话) > 默认 'plugin'

### Q46-4: `migrationSearch` 清除
- **决策**: mount 时一次性, 第二次渲染保持 mount 时值, 用户切 tab 后 URL 不清 (保留 ?tab=mcp 作为会话状态)
- **理由**: 简单 + 与 §5.4 URL 契约一致; ResourceBrowser 内部 onTabChange 不调 history.replaceState 清 search
- **影响**: useViewState.tsx `migrationSearch = useMemo(() => readInitialView().search, [])` 锁死 mount 时值

### Q46-5: `fromViewId` 唯一性强制
- **决策**: Phase 46 加 dev mode console.warn (重复时), Phase 47 lint 规则 9 强制 grep
- **理由**: 编译期 satisfies 只能 exhaustive 不能唯一; 运行期 Map.set 后写覆盖前不报错; Phase 47 lint 永久防
- **影响**: buildMigrationIndex 内部 dev mode `console.warn`; Phase 47 lint-plugin-coupling.sh 加规则 9 单独实现 (本 phase 不做)

## 推迟到 Phase 47

- **mcp-management stub 文件删除 (D-44-A, Phase 46 责任)**: Phase 46 一并删 stub + 清理 4 文件
- **appendQueryMerge 字段 (Q46-2)**: Phase 47 评估是否需要合并
- **lint 规则 9 唯一性 (Q46-5)**: Phase 47 lint-plugin-coupling.sh 加规则 9
- **react-router 切回**: Phase 47 评估统一 URL 路由

## PLAN 阶段必须实现的接口约束

### 1. SidebarTile.migrateFrom (Phase 44 已加, Phase 46 启用)

```typescript
migrateFrom?: { fromViewId: string; appendQuery?: Record<string, string> }
```

### 2. VIEW_ID_MIGRATIONS 派生 (useViewState.tsx)

```typescript
export interface MigrationEntry { toViewId: ViewId; appendQuery?: Record<string, string>; }

function buildMigrationIndex(): ReadonlyMap<string, MigrationEntry> {
  const idx = new Map<string, MigrationEntry>();
  for (const [viewId, tile] of Object.entries(ALL_VIEW_META) as Array<[ViewId, SidebarTile]>) {
    if (tile.migrateFrom) {
      // Q5: dev mode warn on duplicate
      if (idx.has(tile.migrateFrom.fromViewId) && import.meta.env?.DEV !== false) {
        console.warn(`[useViewState] duplicate migrateFrom.fromViewId: ${tile.migrateFrom.fromViewId}`);
      }
      idx.set(tile.migrateFrom.fromViewId, { toViewId: viewId, appendQuery: tile.migrateFrom.appendQuery });
    }
  }
  return idx;
}

const VIEW_ID_MIGRATIONS = buildMigrationIndex();
const MAX_MIGRATION_DEPTH = 5;

// migrateViewId 递归: cycle/深度/unknown 兜底 home + dev warn
// appendQuery 取第一跳 (Q2 决策)
```

### 3. ViewStateProvider 完整 Phase 46 形态

```typescript
export interface UseViewStateResult {
  view: ViewId; setView: (v: ViewId) => void; allViews: typeof ALL_VIEWS;
  migrationSearch: Record<string, string> | undefined;  // Q4 mount-time 锁死
}

export function ViewStateProvider({ children }) {
  const [view, setViewState] = useState<ViewId>(() => readInitialView().view);
  // useLayoutEffect: URL 注入 (早于子组件 useEffect)
  // useEffect: localStorage 同步 (覆盖 stale 值)
  const migrationSearch = useMemo(() => readInitialView().search, []);  // Q4 锁死
  // ... 暴露 { view, setView, allViews, migrationSearch }
}
```

### 4. ResourceBrowser 改造 (双源优先级)

```typescript
// 优先级 1: migration context (mount-time) > 优先级 2: URL (QuickSearchModal) > 默认 'plugin'
const initialKind = useMemo(() => {
  const fromContext = migrationSearch?.tab;
  if (fromContext && ALL_RESOURCE_KINDS.includes(fromContext)) return fromContext;
  if (typeof window !== 'undefined') {
    const fromUrl = new URLSearchParams(window.location.search).get('tab');
    if (fromUrl && ALL_RESOURCE_KINDS.includes(fromUrl)) return fromUrl;
  }
  return 'plugin';
}, [migrationSearch]);
```

### 5. App.tsx 删 useEffect

- 删 `App.tsx:174-197` 整段 (~24 行); 改 import: 移除 STORAGE_KEY
- 不影响 Phase 44 三元链改造 (Phase 44 改 608-640, Phase 46 改 174-197, 独立)

### 6. 删 mcp-management stub (D-44-A)

- 删 stubs/mcp-management.tsx + stubs/mod.ts export + registry.ts import + ALL_PLUGINS 项
- 改 plugin-registry.test.ts 断言 9 → 8
- 验证 resource-browser.sidebarTile.migrateFrom.fromViewId='mcp-management' 仍工作

### 7. 测试覆盖 (5 单测)

`useViewState.test.tsx` 新增 describe "Phase 46": 1) stale 'mcp-management' → resource-browser; 2) 未知 stale fallback home + dev warn; 3) 链式 A→B→C 解析; 4) 链式循环 fallback home; 5) 链式深度 6 fallback home.
`resource-browser.test.tsx` 改写: 注入 migrationSearch 时 default kind = 'mcp'.

## 强验收 (Phase 47 验证)

- App.tsx 0 行 stale-route 兜底 (grep lint)
- useViewState.tsx 有 VIEW_ID_MIGRATIONS Map 派生
- 升级路径: v3.2 user 'mcp-management' → v3.4 → 启动 → URL ?tab=mcp + view=resource-browser
- mcp-management stub 已删 (test -f 失败)
- 8 stub (不含 mcp-management) (plugin-registry test 改写)
- "删 1 view 改 1 文件" 强验收
- Phase 47 lint 规则 9: fromViewId 唯一性 grep
