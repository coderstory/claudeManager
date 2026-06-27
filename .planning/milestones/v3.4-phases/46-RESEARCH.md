# Phase 46: stale-route 清理（VIEW_ID_MIGRATIONS + SidebarTile::migrateFrom）- Research

**Researched:** 2026-06-27
**Domain:** 前端 view routing 元数据化（centralized migration table vs distributed plugin metadata）
**Confidence:** HIGH（基于现场代码逐行核对 + Phase 44 类型设计已就位）

## Summary

Phase 46 的目标是把 `src/App.tsx:174-197` 的 stale-route 兜底 useEffect 替换为**声明式元数据驱动**的迁移机制，使"删 1 个 view"的迁移成本收敛到只改 1 处。当前 useEffect 只处理 `mcp-management` 一个 case，是 v3.2 phase 27 merge 时手工补的；下次再 merge/rename/delete view 时仍要回来补 try-catch 兜底。Phase 46 的核心调研结论：

1. **方案选分布式元数据（SidebarTile.migrateFrom），不选中心化表** — Phase 44 已在 `SidebarTile` 类型预留 `migrateFrom?: { fromViewId; appendQuery? }` 字段（[VERIFIED: 44-RESEARCH.md §6.1/§7.2]），且 resource-browser 是已知的 migrateFrom 持有者。中心化表会破坏 Phase 44 "加 view 只动 1 个文件" 的强验收（overview §3 Phase 44 强验收）。

2. **readInitialView 必须返回 `{ view, search? }` 而非裸 ViewId** — 当前 `?tab=mcp` 通过 `window.location.replace('/resource-browser?tab=mcp')` 传递。Phase 46 把这个 URL 重定向从 App.tsx useEffect 搬到 useViewState 内部 mount 一次性 dispatch，readInitialView 必须把"stale viewId → new viewId + appendQuery"解出来返回。ResourceBrowser 现有的 `readInitialKindFromUrl()` 读 `window.location.search`，Phase 46 不能替代它（ResourceBrowser 是"view 切换后保留 URL search"的消费者，Phase 46 是"mount 时把 stale viewId → URL search"的注入者），两者职责正交。

3. **链式迁移必须带深度保护** — 如果未来出现 `A → B → C` 的连续迁移（merge 到中间 view 后再被 merge），需要递归查找直到稳定。Phase 46 设定最大深度 5 层（M3 历史最长链 3 层）+ 循环检测（visited set），任一触发兜底 `'home'`。

4. **App.tsx 的 useEffect 替换路径明确** — `useViewState` mount 时一次性 dispatch：通过 `window.history.replaceState` 改 URL（不是 `window.location.replace`，后者会触发 full page reload），然后 useViewState 内部的 `setView(newView)` 写 localStorage。mount 后正常 setView 路径不受影响。

5. **灰区：mcp-management plugin stub 删 or 保留** — Phase 44 推荐"删 stub"（overview §3 Phase 44 强验收）；Phase 46 不删 plugin stub 本身（这是 Phase 44 工作），但要在 useViewState 留 `MIGRATION_LOG` 审计（开发模式 console.warn），让未来发现 "用户 localStorage 有 stale X 但 X 没在 migrateFrom 列表里" 时能定位。

**Primary recommendation:** **分布式 SidebarTile.migrateFrom 元数据驱动** + **readInitialView 返回 `{ view, search? }`** + **useViewState 内部一次性 mount dispatch**（history.replaceState + setView）+ **App.tsx 删 useEffect**。新增 / 删除 view 的迁移成本：删 view 的 plugin stub 删 1 文件 + 移除 `migrateFrom` 字段 1 行；加 view 时如果有"老 view 迁移过来"的需求，填 `migrateFrom` 1 行即可。

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|---|---|---|---|
| 迁移规则声明 | 前端（`SidebarTile.migrateFrom`，在 plugin stub 文件） | — | "加 view 改 1 文件" 强验收要求元数据与 view 同地 |
| mount 时迁移 dispatch | 前端（`useViewState.tsx::readInitialView`） | App.tsx 协调 `history.replaceState` | 单点决策,所有 view 共用 |
| URL search 解析 | 前端（ResourceBrowser 内部 `readInitialKindFromUrl`） | — | ResourceBrowser 自己的语义,Phase 46 不替代 |
| chain migration 递归 | 前端（`migrateViewId` 纯函数） | — | 无外部依赖,可单测 |
| 循环检测 / 深度上限 | 前端（`migrateViewId` 纯函数内部） | — | 保护机制,纯函数 |
| 审计日志（dev-only） | 前端（`useViewState.tsx::console.warn`） | — | 帮助定位"未知 stale viewId" |

**Tier 划分原则**：100% 前端 TypeScript，无 IPC / 无后端 / 无新依赖。

---

## User Constraints (来自 Phase 44 + overview)

**Phase 44 已锁定的决策**（[VERIFIED: 44-RESEARCH.md §6.1/§7.2]）：
- `SidebarTile` 已包含 `migrateFrom?: { fromViewId: string; appendQuery?: Record<string, string> }` 字段（Phase 46 不重新定义类型，只填字段 + 实现逻辑）
- `useViewState.tsx` 仍然是 view state 唯一源，Phase 46 改 readInitialView 返回类型 + 加 migrateViewId
- `resource-browser` 已确定是 `migrateFrom` 持有者：`{ fromViewId: 'mcp-management', appendQuery: { tab: 'mcp' } }`

**overview §3 Phase 46 锁定的决策**：
- 目标：`App.tsx:174-197` 兜底 useEffect 替换为 `VIEW_ID_MIGRATIONS` 表 + `SidebarTile::migrateFrom`
- 改 useViewState::readInitialView 返回 `{ view, search? }`（原 `ViewId`）
- 删 view 的迁移成本只动 1 处（强验收）

**Deferred（不在 Phase 46 范围）**：
- mcp-management plugin stub 删除（Phase 44 工作，Phase 46 不动）
- Plugin 系统后续扩展（Phase 42 IPlugin::commands 业务化、Phase 45 AppState 化）
- React Router 切回（M2+）

---

## 问题 1：现有代码梳理

**结论**：Phase 46 的代码改动集中在 2 个文件 + 2 个测试文件。

### 1.1 `src/App.tsx:174-197` 完整 useEffect

[VERIFIED: App.tsx:174-197 全文]

```tsx
useEffect(() => {
  if (typeof window === 'undefined') return;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'mcp-management') {
      window.localStorage.removeItem(STORAGE_KEY);
      setView('resource-browser');
      if (!window.location.search.includes('tab=mcp')) {
        window.location.replace('/resource-browser?tab=mcp');
      }
    }
  } catch {
    // localStorage 在沙盒/隐私模式下可能 throw;忽略,App 仍可用。
  }
}, []);
```

**问题点**：
1. **硬编码 `'mcp-management'`** — 每新增 / 删一个 view 都要改这里（merge rename delete 全要碰）。
2. **`window.location.replace` 触发整页 reload** — 这不是 React 的状态切换，而是浏览器 navigation。reload 后 React 重新 mount，导致首屏闪烁。
3. **依赖 `STORAGE_KEY` 直接读 localStorage** — `useViewState` 已经做了 `readInitialView` 抽象，这里又重复读一遍，破坏封装。
4. **删 stale value 后 setView 又写回 'resource-browser'** — 3 步操作（remove + setView + replace）耦合在 1 个 useEffect，下次新迁移场景要么改这里要么加 useEffect。

### 1.2 `src/hooks/useViewState.tsx:139-147` isValidView / readInitialView

[VERIFIED: useViewState.tsx:139-147 全文]

```typescript
function isValidView(v: string | null): v is ViewId {
  return v !== null && (ALL_VIEWS as readonly string[]).includes(v);
}

function readInitialView(): ViewId {
  if (typeof window === 'undefined') return HOME_VIEW;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return isValidView(stored) ? stored : HOME_VIEW;
}
```

**问题点**：
1. **fallback 到 'home' 丢失了"mcp-management → resource-browser?tab=mcp"的迁移语义** — 上面 App.tsx useEffect 就是为了补救这个语义缺失。
2. **`readInitialView` 没有"知道存在 stale viewId 但知道迁移到哪"的能力** — Phase 46 要扩展这个能力。

### 1.3 `src/plugins/types.ts` FrontendPlugin / SidebarTile（Phase 44 已扩展）

[VERIFIED: 44-RESEARCH.md §6.1/§7.2]

Phase 44 已加的字段：
```typescript
export interface SidebarTile {
  icon: LucideIcon;
  short: string;
  order: number;
  group?: 'main' | 'utility';
  /** Phase 46 启用: 本 view 接收 stale viewId 迁移的规则 */
  migrateFrom?: {
    fromViewId: string;
    appendQuery?: Record<string, string>;
  };
}
```

**Phase 46 直接复用此类型**，不修改。resource-browser 填的 migrateFrom：
```typescript
// src/plugins/stubs/resource-browser.tsx (Phase 44 后, Phase 46 复用)
sidebarTile: {
  icon: FileSearch,
  short: '资源浏览',
  order: 5,
  group: 'main',
  migrateFrom: {
    fromViewId: 'mcp-management',
    appendQuery: { tab: 'mcp' },
  },
},
```

### 1.4 `src/plugins/stubs/resource-browser.tsx` 当前 stub（Phase 44 前）

[VERIFIED: stubs/resource-browser.tsx 全文]

当前 stub 还是老的 `routes: [{ path, component, ... }]` 形态，**Phase 44 会重写为 `viewId / sidebarTile / pageMeta / componentEntry` 形态**，Phase 46 在 Phase 44 产物上填 `migrateFrom`。

---

## 问题 2：VIEW_ID_MIGRATIONS 表设计（中心化 vs 分布式）

**结论：选分布式元数据（SidebarTile.migrateFrom），不选中心化表**。

### 2.1 候选 A：中心化 `VIEW_ID_MIGRATIONS` 表

```typescript
// src/hooks/useViewState.tsx
const VIEW_ID_MIGRATIONS: Record<string, { to: ViewId; appendQuery?: Record<string, string> }> = {
  'mcp-management': { to: 'resource-browser', appendQuery: { tab: 'mcp' } },
};

function migrateViewId(stored: string | null): { view: ViewId; search?: Record<string, string> } {
  if (!stored || isValidView(stored)) {
    return { view: isValidView(stored) ? stored : HOME_VIEW };
  }
  const mig = VIEW_ID_MIGRATIONS[stored];
  if (!mig) return { view: HOME_VIEW };
  return { view: mig.to, search: mig.appendQuery };
}
```

**优点**：
- 删 view 时改 1 处（从表里删除条目）。
- 表全集中，`grep VIEW_ID_MIGRATIONS` 一眼看全所有迁移规则。
- 单测简单（直接测 `VIEW_ID_MIGRATIONS` + `migrateViewId`）。

**缺点**：
- **加 view 时新插件作者不知道要来这里加迁移条目**。Plugin stub 在 `src/plugins/stubs/<id>.tsx`，迁移表在 `src/hooks/useViewState.tsx`，跨文件心智负担。
- **破坏 Phase 44 "加 view 只动 1 个文件" 强验收**：新 view 作者加完 plugin stub + registry 后还要再去 useViewState 加迁移条目。
- **逆语义**：迁移是 "view 的属性"（X viewId 属于这个新 view），把它放全局表丢失归属信息。
- **多 viewId → 同 viewId 的合并难表达**：比如未来 3 个 view 合并到 1 个 view，中心化表 3 条目独立但分散在表里；分布式 3 个 plugin stub 都填同一个目标 viewId（去重靠 build 时校验）。

### 2.2 候选 B：分布式 `SidebarTile.migrateFrom` 元数据（推荐）

```typescript
// src/plugins/stubs/resource-browser.tsx (Phase 46)
sidebarTile: {
  icon: FileSearch,
  short: '资源浏览',
  order: 5,
  group: 'main',
  migrateFrom: {
    fromViewId: 'mcp-management',
    appendQuery: { tab: 'mcp' },
  },
},
```

```typescript
// src/hooks/useViewState.tsx
import { ALL_VIEW_META } from '../plugins/registry';

function migrateViewId(stored: string | null): { view: ViewId; search?: Record<string, string> } {
  if (!stored) return { view: HOME_VIEW };
  if (isValidView(stored)) return { view: stored };
  // 查 SidebarTile.migrateFrom (O(1) Map)
  const migration = VIEW_ID_MIGRATIONS.get(stored);
  if (migration) {
    return { view: migration.toViewId, search: migration.appendQuery };
  }
  return { view: HOME_VIEW };  // 未知 stale value 兜底
}
```

**优点**：
- **加 view 时 plugin stub 自带迁移语义**，与 stub 同一文件，作者写完 stub 自然填迁移字段。无需 grep 全局。
- **保留 Phase 44 "加 view 只动 1 文件" 强验收**。
- **迁移归属明确**：`migrateFrom.fromViewId` 显式说"这个 view 接收哪个 stale id"，review 时看 stub 文件即可。
- **删 view 时**：`mcp-management` 删 stub 时连带删除 `migrateFrom` 字段（MIGRATION_LOG 检测到本地表消失是预期）。改 1 文件。

**缺点**：
- 删除 stub 时**没有任何显式提醒**让你知道 "曾有 mcp-management 用户的 localStorage 是 stale 的"。需要 `MIGRATION_LOG` console.warn 在 dev 模式补这块（见问题 6）。
- 多个 view 迁移到同一个目标 view 时，需要在编译期校验 `fromViewId` 唯一（TS 类型层面可强制）。
- migrateViewId 查表是 O(1)（用 Map），未来 plugin 数量增长无压力。

### 2.3 决策：选 B（分布式元数据）

**理由**：
1. **Phase 44 "加 view 只动 1 文件" 强验收**：候选 A 把迁移规则拆到 useViewState.tsx，破坏这条。
2. **CLAUDE.md §2.1 架构先行 + §3.3 plugin 系统**：plugin 自治是项目根基，候选 A 把 plugin 的属性外置到全局表违反此原则。
3. **类型驱动**：候选 B 完全由 SidebarTile.migrateFrom 类型字段表达，编译期强制存在性（satisfies）。

### 2.4 "VIEW_ID_MIGRATIONS" 术语澄清

overview §3 Phase 46 文本提到 `VIEW_ID_MIGRATIONS` 表 + `SidebarTile::migrateFrom` 元数据，两者并列。这其实是描述**两件事**：`SidebarTile.migrateFrom` 是字段，`VIEW_ID_MIGRATIONS` 是 Phase 46 在 useViewState.tsx 内部**由 SidebarTile.migrateFrom 派生的运行时数据结构**（一个从 SidebarTile 展开的 flat Map）。最终实现是单点派生，源数据是 SidebarTile 字段。

```typescript
// src/hooks/useViewState.tsx (Phase 46 实施态)
import { ALL_VIEW_META, type SidebarTile } from '../plugins/types';
import type { ViewId } from '../plugins/registry';

/** MigrationEntry — 反向索引的 value 类型 (stale viewId → 新 viewId + 附加 query) */
export interface MigrationEntry {
  toViewId: ViewId;
  appendQuery?: Record<string, string>;
}

/**
 * Phase 46 — 从 ALL_VIEW_META 派生的 stale→new 反向索引 (Map 形式 O(1) 查表)。
 * 不是手填表,而是 build 时由 ALL_VIEW_META.reduce 算出来。
 * 这样 plugin stub 的 migrateFrom 是单点真相,运行时查表是 O(1)。
 */
function buildMigrationIndex(): ReadonlyMap<string, MigrationEntry> {
  const idx = new Map<string, MigrationEntry>();
  for (const [viewId, tile] of Object.entries(ALL_VIEW_META) as Array<[ViewId, SidebarTile]>) {
    if (tile.migrateFrom) {
      idx.set(tile.migrateFrom.fromViewId, {
        toViewId: viewId,
        appendQuery: tile.migrateFrom.appendQuery,
      });
    }
  }
  return idx;
}

const VIEW_ID_MIGRATIONS: ReadonlyMap<string, MigrationEntry> = buildMigrationIndex();
```

**为什么用 Map 不用 Record**：
- 未来 plugin 数量增长后查表 O(1)。
- Map 是 readonly 防止外部修改。
- Map 的 `get` 返回 `MigrationEntry | undefined` 比 Record 类型更安全（Record 总会返回 undefined，但 TS 不强制 narrowing）。

---

## 问题 3：SidebarTile::migrateFrom 设计

**结论：migrateFrom 类型与 Phase 44 一致，appendQuery 是 Record<string, string>，URL 注入走 `history.replaceState` 拼 query string**。

### 3.1 类型确认（Phase 44 已加）

[VERIFIED: 44-RESEARCH.md §6.1]

```typescript
export interface SidebarTile {
  icon: LucideIcon;
  short: string;
  order: number;
  group?: 'main' | 'utility';
  migrateFrom?: {
    fromViewId: string;
    appendQuery?: Record<string, string>;
  };
}
```

**Phase 46 不修改类型**。`fromViewId` 是 string 而非 ViewId（因为是"曾存在但已删除"的 id，不在当前 ViewId 联合里）。`appendQuery` 是可选 Record（不是必须，部分迁移场景不需要 query，如直接 redirect 到 home）。

### 3.2 `appendQuery` 注入到 URL 的机制

**3 个候选方案评估**：

**候选 1：`window.location.replace`（当前 App.tsx 方案，不推荐保留）**
- 触发整页 reload，React 重新 mount，首屏闪烁。
- 不利于 SPA 体验。

**候选 2：`window.history.replaceState` + useViewState 内部 setView（推荐）**

```typescript
// useViewState.tsx
useEffect(() => {
  const initial = readInitialView();
  if (initial.search && Object.keys(initial.search).length > 0) {
    const qs = new URLSearchParams(initial.search).toString();
    try {
      window.history.replaceState({}, '', `${window.location.pathname}?${qs}`);
    } catch {
      // 沙盒/隐私模式 history API 不可用,silently fallback
    }
  }
  setViewState(initial.view);
}, []);
```

**优点**：
- 不触发 reload（SPA 单页切换）。
- `history.replaceState` 不留 history entry（用户不能 back 回 stale viewId 的 URL，符合迁移语义"老路由已死"）。
- ResourceBrowser 现有的 `readInitialKindFromUrl()` 在 mount 时读 `window.location.search` 自动接住 `?tab=mcp`（Phase 27 Fix 6 D-11 已验证）。

**缺点**：
- `history.replaceState` 在 sandbox / 隐私模式可能 throw（QuickSearchModal.tsx:402-404 已有 try-catch 模式可复用）。

**候选 3：ResourceBrowser 通过 prop 接收 initial kind，绕过 URL**

**否决**。理由：
- URL `?tab=mcp` 是 Phase 27 Fix 6 的对外契约（QuickSearchModal 也会用 history.replaceState 切到这个 URL），绕过 URL 会破坏这一致性。
- 用户复制 / 分享 URL 时仍希望带 `?tab=mcp`。
- ResourceBrowser 内部已经有 `readInitialKindFromUrl()`，无需新 prop。

**决策：选候选 2**。

### 3.3 URL query 字符串构造细节

```typescript
function buildSearchString(appendQuery: Record<string, string>): string {
  // URLSearchParams 自动处理 encode
  return new URLSearchParams(appendQuery).toString();
}

// e.g. { tab: 'mcp' } → 'tab=mcp'
// e.g. { tab: 'mcp', foo: 'bar baz' } → 'tab=mcp&foo=bar+baz' (URLSearchParams 默认 + encode)
// e.g. { tab: 'mcp', foo: 'bar&baz' } → 'tab=mcp&foo=bar%26baz'
```

**为什么用 URLSearchParams 而不是手拼**：
- 自动 URL encode（`bar&baz` 不会破坏 query 结构）。
- 处理空值（`{ tab: '' }` → `tab=`）。
- TS 类型安全（`Record<string, string>` 保证值是 string）。

**最终 URL 形态**：
```
file:///path/to/index.html?tab=mcp
```
Tauri v2 WebView2 / WKWebView 加载时 `window.location.search === '?tab=mcp'`，ResourceBrowser `readInitialKindFromUrl()` 解出 `'mcp'`，默认 tab = mcp。✓ 与 Phase 27 Fix 6 行为完全一致。

---

## 问题 4：readInitialView 返回类型变更

**结论：返回 `{ view: ViewId; search?: Record<string, string> }`，影响面只有 1 处直接调用方 + 测试**。

### 4.1 新签名

```typescript
// src/hooks/useViewState.tsx (Phase 46)

export interface ReadInitialViewResult {
  view: ViewId;
  /**
   * URL search params to apply via history.replaceState.
   * Empty/undefined = no URL mutation.
   */
  search?: Record<string, string>;
}

function readInitialView(): ReadInitialViewResult {
  if (typeof window === 'undefined') return { view: HOME_VIEW };
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (!stored) return { view: HOME_VIEW };
  if (isValidView(stored)) return { view: stored };

  // Phase 46 — stale viewId 迁移查询
  const migration = VIEW_ID_MIGRATIONS.get(stored);
  if (migration) {
    return { view: migration.toViewId, search: migration.appendQuery };
  }

  return { view: HOME_VIEW };
}
```

### 4.2 调用方影响分析

[VERIFIED: 全文 grep `readInitialView`]

| 调用方 | 文件 | 行 | 当前用法 | 改造 |
|---|---|---|---|---|
| 直接调用 | `useViewState.tsx:186` | 1 处 | `useState<ViewId>(readInitialView)` | 改为 `useState<ViewId>(() => readInitialView().view)` + 新增 mount-time useEffect 处理 search |
| 通过 setView 间接 | 多处 | 无 | 不直接调 readInitialView | 不变 |
| 通过 useViewState() 间接 | 12 处 | 无 | 读 context | 不变 |

**实际只需要改 useViewState.tsx 内部 1 处 + ViewStateProvider 内新增 search 处理 useEffect**。

### 4.3 search 是 Record 不是 string

**为什么 `search?: Record<string, string>` 而不是 `search?: string`（"已拼好的 query string"）**：
- 类型层强制值是 string（避免手动拼 string 时漏 encode）。
- mount 时 useViewState 内部统一用 `URLSearchParams` 拼。
- 测试容易（直接对比 object equality）。
- 多 plugin 后续可能需要合并多个来源的 query，Record 易于 extend。

**search 字段的语义边界**：
- `undefined` = 不改 URL
- `{}` (空对象) = 清空 URL search (`history.replaceState({}, '', window.location.pathname)`)
- `{ tab: 'mcp' }` = URL 变为 `?tab=mcp`

### 4.4 URL search 与 localStorage 的顺序

- localStorage 存最终 view id（如 `'resource-browser'`），mount 时先存的是 stale id `'mcp-management'`，readInitialView 解出 `{ view: 'resource-browser', search: { tab: 'mcp' } }`。
- 接着 `setView('resource-browser')` 写 localStorage 为 `'resource-browser'`，覆盖 stale 值。

**顺序选择**：
```typescript
// 推荐顺序：先 URL 再 setView
useEffect(() => {
  const initial = readInitialView();
  if (initial.search && Object.keys(initial.search).length > 0) {
    const qs = new URLSearchParams(initial.search).toString();
    try {
      window.history.replaceState({}, '', `${window.location.pathname}${qs ? '?' + qs : ''}`);
    } catch { /* sandbox fallback */ }
  }
  setViewState(initial.view);  // 写 localStorage 为新 view
}, []);
```

**理由**：URL 先变（让 ResourceBrowser mount 时能读到正确 search），紧接着 setView 写 localStorage。两者都在 mount 一次性完成，不影响后续正常 setView 路径。

### 4.5 测试更新

```typescript
// src/__tests__/hooks/useViewState.test.tsx (Phase 46 新增 describe)

describe('Phase 46 — VIEW_ID_MIGRATIONS + SidebarTile.migrateFrom', () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState({}, '', '/');  // 清 URL
  });

  it('returns home when localStorage is empty', () => {
    const { result } = renderHook(() => useViewState(), { wrapper: wrap });
    expect(result.current.view).toBe('home');
  });

  it('stale "mcp-management" → resource-browser via SidebarTile.migrateFrom', () => {
    localStorage.setItem(STORAGE_KEY, 'mcp-management');
    const { result } = renderHook(() => useViewState(), { wrapper: wrap });
    expect(result.current.view).toBe('resource-browser');
    expect(window.location.search).toContain('tab=mcp');
    // localStorage 应已被 setView 覆盖为新 view
    expect(localStorage.getItem(STORAGE_KEY)).toBe('resource-browser');
  });

  it('unknown stale viewId falls back to home (no migration rule)', () => {
    localStorage.setItem(STORAGE_KEY, 'totally-unknown-plugin');
    const { result } = renderHook(() => useViewState(), { wrapper: wrap });
    expect(result.current.view).toBe('home');
  });

  it('unknown stale viewId triggers MIGRATION_LOG console.warn in dev', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    localStorage.setItem(STORAGE_KEY, 'some-deleted-plugin');
    renderHook(() => useViewState(), { wrapper: wrap });
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('some-deleted-plugin'));
    spy.mockRestore();
  });
});
```

---

## 问题 5：URL query 注入机制

**结论**：URL query 通过 useViewState 内部 mount 一次性 `history.replaceState` 注入；ResourceBrowser 内部的 `readInitialKindFromUrl` 继续工作（Phase 46 不动它）。

### 5.1 当前机制梳理（Phase 27 Fix 6 D-11/13）

[VERIFIED: QuickSearchModal.tsx:399-405 / 430-438]

`?tab=mcp` URL 的产生者有 2 个：
1. **App.tsx:174-197 useEffect** — 老用户 stale localStorage → URL replace
2. **QuickSearchModal.tsx:401 / 433** — 用户在 quick search 选中 mcp 结果

`?tab=mcp` URL 的消费者：
1. **ResourceBrowser `readInitialKindFromUrl`** — mount 时读 `window.location.search` 决定 default tab

**Phase 46 的分工**：
- **产生者 1（App.tsx useEffect）删除**，迁移到 useViewState 内部。
- **产生者 2（QuickSearchModal）保留** — 这是用户主动行为，不是 stale state 迁移。
- **消费者（ResourceBrowser `readInitialKindFromUrl`）保留** — 这是 ResourceBrowser 自己的语义。

### 5.2 为什么不引入 useSearchParams

候选：让 ResourceBrowser 用 react-router 的 `useSearchParams`。
**否决**（与 Phase 44 一致）：
- 项目不用 react-router（App.tsx:1-45 注释明确），引入 useSearchParams 必须先引入 react-router。
- Phase 44 已决定"派生收敛"，切 react-router 是单独 Phase 的事。
- ResourceBrowser 现有 `window.location.search` 直读方案简单可靠，与 QuickSearchModal.tsx:401 / 433 已有模式一致（QuickSearchModal 也是 `window.history.replaceState` 直写）。

### 5.3 URL 注入时机的细节

mount 流程：
1. React 渲染 `<ViewStateProvider>`
2. `useState<ViewId>(readInitialView)` 拿 initial view（无副作用）
3. 渲染子组件，ResourceBrowser mount 时 `readInitialKindFromUrl()` 读 URL
4. **关键**：必须保证第 3 步时 URL 已经是 `?tab=mcp`

**问题**：第 2 步是同步的，第 3 步的 ResourceBrowser 渲染在 useEffect 之前还是之后？

答案：React 渲染是同步的，ResourceBrowser 在第 3 步 mount 时读取 `window.location.search`。如果 useViewState 在 `useState` 初始化阶段就改 URL（不行，`useState` initializer 不能有副作用），那 ResourceBrowser 会读到错误的 URL。

**解决方案**：URL 注入必须发生在 ViewStateProvider 内部的 mount-time useEffect **之前**（即 render 阶段或 useState initializer）。

**但是**：不能在 useState initializer 调 `history.replaceState`（违反 React 纯净渲染原则 + SSR 不可用）。

**实际方案**：ViewStateProvider 内部**重构成两段**：

```typescript
// src/hooks/useViewState.tsx (Phase 46)

export function ViewStateProvider({ children }: { children: ReactNode }): ReactElement {
  // 第一阶段：同步读 view id（不解 search，因为 search 必须在 mount 前改 URL）
  const [view, setViewState] = useState<ViewId>(() => readInitialView().view);

  // 第二阶段：mount 时改 URL + 写 localStorage
  useEffect(() => {
    const initial = readInitialView();
    if (initial.search && Object.keys(initial.search).length > 0) {
      const qs = new URLSearchParams(initial.search).toString();
      try {
        window.history.replaceState({}, '', `${window.location.pathname}${qs ? '?' + qs : ''}`);
      } catch { /* sandbox fallback */ }
    }
    // 如果是迁移场景，setView 把 localStorage 写为新 view id（覆盖 stale 值）
    // 同步在 useState init 阶段已 set initial.view，但 localStorage 没写
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, view);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setView = useCallback(/* 不变 */, []);

  const value = useMemo(() => ({ view, setView, allViews: ALL_VIEWS }), [view, setView]);

  return <ViewStateContext.Provider value={value}>{children}</ViewStateContext.Provider>;
}
```

**关键时序**：
1. `useState(readInitialView().view)` — 同步拿 initial view，**未改 URL 也未写 localStorage**
2. 渲染子组件树（包括 ResourceBrowser），它读 `window.location.search` — **此时 URL 还没改！**
3. ViewStateProvider 的 useEffect 跑（mount commit 之后），改 URL + 写 localStorage
4. ResourceBrowser 之后如果重 mount 或重 fetch 会读到新 URL

**问题**：第 3 步发生在 ResourceBrowser mount 之后，ResourceBrowser 第一次 `readInitialKindFromUrl()` 读到的是空 search（默认 'plugin' tab），不是 'mcp'！

**更细的时序**（React 18 concurrent 模式）：
- React 渲染 → commit → DOM 更新 → 子组件 useEffect 跑 → 父组件 useEffect 跑（子先父后）

所以 **ResourceBrowser 的 useEffect 早于 ViewStateProvider 的 useEffect**。这意味着 ResourceBrowser 首次 mount 读不到 `?tab=mcp`。

**解决方案 A：URL 注入提到 useState initializer 阶段**（不推荐，违反 React 纯净原则）

**解决方案 B：在 ViewStateProvider 顶部加 useLayoutEffect 同步改 URL**

```typescript
import { useLayoutEffect, useEffect } from 'react';

// useLayoutEffect 在 DOM 更新前同步执行,但 React 仍允许副作用
useLayoutEffect(() => {
  const initial = readInitialView();
  if (initial.search && Object.keys(initial.search).length > 0) {
    const qs = new URLSearchParams(initial.search).toString();
    try {
      window.history.replaceState({}, '', `${window.location.pathname}${qs ? '?' + qs : ''}`);
    } catch { /* sandbox fallback */ }
  }
}, []);
```

**useLayoutEffect vs useEffect 时序**：
- useLayoutEffect：React commit phase 同步执行（DOM 更新前），所有子组件的 useEffect 都跑在它之后
- useEffect：React commit phase 异步执行，子组件的 useEffect 可能先跑

**useLayoutEffect 让 URL 注入先于所有子组件 useEffect**，包括 ResourceBrowser 的 `readInitialKindFromUrl()`（ResourceBrowser mount 时立即同步读 URL，是渲染阶段而非 effect 阶段）。

**等等，重新审视**：ResourceBrowser 的 `readInitialKindFromUrl()` 是 `makeInitialState()` 内调用，而 `makeInitialState()` 是 `useState` initializer — 同步在 React 渲染阶段执行，**早于 useLayoutEffect 和 useEffect**。

也就是说：
- ResourceBrowser mount 时同步执行 `readInitialKindFromUrl()` 读 `window.location.search`
- 此时 ViewStateProvider 的 useLayoutEffect/useEffect 都还没跑
- ResourceBrowser 拿到的 URL 是用户**原始**的 URL，不是迁移后的 URL

**问题棘手**！需要 ResourceBrowser mount 时**已经**看到 `?tab=mcp`。

**真正解决方案**：URL 注入必须在 ResourceBrowser mount **之前**完成，即：
- 在 ViewStateProvider 的 `useState` initializer 阶段（同步，纯函数，不能副作用）

**矛盾**：纯函数原则 vs URL 注入副作用。

**最终方案**：把 URL 注入的责任**放回 App.tsx**（在 ViewStateProvider 渲染之前），或者**让 ResourceBrowser 通过 props 接收 initial kind**（绕过 URL）。

**重新评估候选 3**（ResourceBrowser 通过 prop 接收 initial kind）：

- 优点：URL 不变（仍是 `file:///path/to/index.html`），ResourceBrowser 通过 props 拿 `initialKind`，mount 时立即用。
- 缺点：URL 不带 `?tab=mcp`，用户复制 / 分享 URL 失效。QuickSearchModal.tsx:401 / 433 写 URL 但 ResourceBrowser 不读 URL，行为不一致。

**混合方案**：URL 由 ViewStateProvider 在 useLayoutEffect 改 + ResourceBrowser **读 context** 拿 initial kind（不走 URL）。

```typescript
// ResourceBrowser 接收 initialKind prop
<ResourceBrowserPage initialKind={migrateSearch?.tab ?? 'plugin'} />

// ViewStateProvider 暴露 migrationSearch context
const ViewStateContext = createContext<{
  view: ViewId;
  setView: (v: ViewId) => void;
  migrationSearch: Record<string, string> | undefined;
  allViews: typeof ALL_VIEWS;
}>(/*...*/);
```

**否决理由**：增加 context 复杂度；ResourceBrowser 自己已经是 propsBuilder 模式（Phase 44 决策），加 initialKind prop 是干净的。

### 5.4 推荐方案：URL 注入 + ResourceBrowser 改造

**两个改动同时进行**：

1. **ViewStateProvider useLayoutEffect 改 URL**（保证后续任何重 mount / hot reload 看到正确 URL）

```typescript
useLayoutEffect(() => {
  const initial = readInitialView();
  if (initial.search && Object.keys(initial.search).length > 0) {
    const qs = new URLSearchParams(initial.search).toString();
    try {
      window.history.replaceState({}, '', `${window.location.pathname}${qs ? '?' + qs : ''}`);
    } catch { /* sandbox fallback */ }
  }
}, []);
```

2. **ResourceBrowser mount 时拿 initialKind from context**（绕过 URL 读不到的问题）

```typescript
// ViewStateContext 增加 migrationSearch
const ViewStateContext = createContext<{
  view: ViewId;
  setView: (v: ViewId) => void;
  migrationSearch: Record<string, string> | undefined;
  allViews: typeof ALL_VIEWS;
} | null>(null);

// ResourceBrowser 内部
import { useViewState } from '../../hooks/useViewState';

function ResourceBrowserPage(): ReactElement {
  const { migrationSearch } = useViewState();
  const initialKind: ResourceKind = (() => {
    // 优先级 1: migration search (Phase 46 注入的 stale redirect)
    const tab = migrationSearch?.tab;
    if (tab && (ALL_RESOURCE_KINDS as readonly string[]).includes(tab)) {
      return tab as ResourceKind;
    }
    // 优先级 2: URL search (QuickSearchModal 主动导航)
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const urlTab = params.get('tab');
      if (urlTab && (ALL_RESOURCE_KINDS as readonly string[]).includes(urlTab)) {
        return urlTab as ResourceKind;
      }
    }
    return 'plugin';
  })();
  // ... 用 initialKind 替代 readInitialKindFromUrl()
}
```

**优劣**：
- 优点：URL + context 双源，Phase 46 的 mount-time 迁移走 context，QuickSearchModal 主动导航走 URL，两者不冲突。
- 缺点：ResourceBrowser 内部增加 useViewState 依赖（之前是纯 localStorage / URL 读取）。

**决策：选此方案**。ResourceBrowser 已经 useScope + useProjects（多个 hook），加 useViewState 不增加复杂度。

### 5.5 简化方案：ResourceBrowser 不动，纯靠 URL 同步注入

如果 ResourceBrowser 不接受改造，**唯一方案是把 URL 注入移到 ResourceBrowser 渲染之前**：

```typescript
// src/hooks/useViewState.tsx
function readInitialView(): ReadInitialViewResult {
  // ... 同前
}

// src/App.tsx (Phase 46)
export default function App(): ReactElement {
  // 在 ViewStateProvider 渲染之前同步注入 URL
  // 但这要求 App 在 useViewState() 之前就执行
  // ...
}
```

**不可行**：App 的渲染层级是 `<ThemeProvider><ViewStateProvider><App>...</App></ViewStateProvider></ThemeProvider>`，App 渲染时已经在 ViewStateProvider 之后。

**强行方案**：把 URL 注入逻辑提到 main.tsx（在 React mount 之前）：

```typescript
// src/main.tsx
import { readInitialView } from './hooks/useViewState';

// 在 ReactDOM.createRoot 之前同步执行
const initial = readInitialView();
if (initial.search && typeof window !== 'undefined') {
  const qs = new URLSearchParams(initial.search).toString();
  try {
    window.history.replaceState({}, '', `${window.location.pathname}${qs ? '?' + qs : ''}`);
  } catch { /* sandbox */ }
}

ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
```

**优劣**：
- 优点：URL 同步注入，ResourceBrowser mount 时立即看到正确 search。
- 缺点：main.tsx 引入 useViewState 内部函数（破坏封装）；test setup 不通过这条路径要走 fake timer；URL 注入和应用启动顺序耦合。

**决策：否决此方案**。推荐 §5.4 的 context 双源方案。

### 5.6 URL 注入机制总结

| 阶段 | 谁执行 | 做什么 |
|---|---|---|
| App 启动 | main.tsx | 无 |
| React 渲染 | ViewStateProvider | `useState(readInitialView().view)` 拿 initial view |
| ResourceBrowser mount | ResourceBrowser | 读 context migrationSearch → 决定 initialKind |
| ViewStateProvider commit | useLayoutEffect | history.replaceState 把 URL 改成 `?tab=mcp`（保证后续 reload / hot-reload / 复制粘贴 URL 一致） |
| 后续 navigate | QuickSearchModal 等 | 继续 history.replaceState 直写 URL |

---

## 问题 6：App.tsx useEffect 删了之后,mount 时如何触发

**结论**：迁移到 ViewStateProvider 内部一次性 mount dispatch（useLayoutEffect + useEffect）。

### 6.1 当前 App.tsx useEffect 行为拆分

[VERIFIED: App.tsx:174-197]

当前 useEffect 做 3 件事：
1. **判断**：读 localStorage，看是否 stale `'mcp-management'`
2. **清除 stale**：removeItem STORAGE_KEY
3. **跳转 + URL 注入**：setView('resource-browser') + window.location.replace URL

Phase 46 拆分到 2 个地方：

| 原 useEffect 行为 | Phase 46 落点 |
|---|---|
| 判断 stale + 决定迁移目标 | `readInitialView()` 内部（查询 VIEW_ID_MIGRATIONS） |
| 清除 stale + 跳转 + URL 注入 | `ViewStateProvider` mount-time 一次性 dispatch（useLayoutEffect 改 URL + useState init 设 view + useEffect 写 localStorage） |

### 6.2 mount 时一次性 dispatch 的具体代码

```typescript
// src/hooks/useViewState.tsx (Phase 46 完整 ViewStateProvider)

export function ViewStateProvider({ children }: { children: ReactNode }): ReactElement {
  // useState initializer 同步读 view (无副作用,纯函数)
  const [view, setViewState] = useState<ViewId>(() => readInitialView().view);

  // useLayoutEffect: DOM 更新前同步改 URL (子组件 useEffect 之前)
  useLayoutEffect(() => {
    const initial = readInitialView();
    if (initial.search && Object.keys(initial.search).length > 0) {
      const qs = new URLSearchParams(initial.search).toString();
      try {
        window.history.replaceState({}, '', `${window.location.pathname}${qs ? '?' + qs : ''}`);
      } catch { /* sandbox */ }
    }
  }, []);

  // useEffect: 写 localStorage 为新 view (覆盖 stale 值)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, view);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setView = useCallback(/* 不变 */, []);

  const migrationSearch = useMemo(() => readInitialView().search, []);  // mount only

  const value = useMemo(
    () => ({ view, setView, allViews: ALL_VIEWS, migrationSearch }),
    [view, setView, migrationSearch],
  );

  return <ViewStateContext.Provider value={value}>{children}</ViewStateContext.Provider>;
}
```

### 6.3 关键不变量

1. **mount 时 readInitialView 调一次，结果存 view 状态** — 后续不重读（除非显式 reload）。
2. **URL 注入用 useLayoutEffect 而非 useState initializer** — 副作用不能在纯函数渲染阶段。
3. **localStorage 写入用 useEffect（异步）** — localStorage IO 不阻塞渲染。
4. **migrationSearch 是 context 值** — ResourceBrowser 通过 useViewState() 读，无需自己 parse URL。

### 6.4 App.tsx 删 useEffect 后的清理

**删除**：App.tsx:174-197 整段 useEffect（约 24 行）。

**依赖清理**：移除 `STORAGE_KEY` 的 import（App.tsx:76 改为不导）。

```typescript
// src/App.tsx (Phase 46 前后对比)
// 删除前:
import { useViewState, ALL_VIEWS, STORAGE_KEY, type ViewId } from './hooks/useViewState';
// useEffect 174-197 整段

// 删除后:
import { useViewState, ALL_VIEWS, type ViewId } from './hooks/useViewState';
// useEffect 整段删除
```

**注意**：Phase 46 删 App.tsx useEffect 与 Phase 44 改 App.tsx 三元链不冲突 — Phase 44 改的是 `view === 'X' ? <X /> : ...` 三元链（行 608-640），Phase 46 改的是 174-197 的 stale-route useEffect。两者独立。

---

## 问题 7：链式迁移

**结论**：migrateViewId 用递归查找直到稳定，最大深度 5 层 + 循环检测（visited set），任一触发兜底 `'home'`。

### 7.1 链式场景分析

```
历史事件（示例）：
v1.0 — view A 存在
v1.5 — view A 合并到 view B (migrateFrom: { fromViewId: 'A' } on B)
v2.0 — view B 合并到 view C (migrateFrom: { fromViewId: 'B' } on C)

用户情况：v1.0 安装的用户从未升级，localStorage 存 'A'
Phase 46 行为：A → B → C 链式解析，最终落到 C
```

**Phase 46 之前的 v3.2 已实现链式吗？**

[VERIFIED: App.tsx:174-197 useEffect 全文]

**否**。v3.2 phase 27 只处理一层 `mcp-management` → `resource-browser`，没有链式解析。

**M3 历史最长链**：mcp-management 单层（M4.6 时 history view 之前存在过，Phase 21-C 也只是单层 redirect）。

**Phase 46 是否需要支持链式？**

**是**。理由：
- Phase 44 决定 `SidebarTile.migrateFrom` 字段是元数据，未来多个 plugin 各自填迁移规则。
- 合并链 `A → B → C` 是合理的未来场景（先 merge 到中间 view，再 merge 到最终 view）。
- 链式解析实现成本低（递归 + visited set）。

### 7.2 链式迁移实现

```typescript
// src/hooks/useViewState.tsx (Phase 46)

/** Phase 46 — 链式迁移递归查找。 */
function migrateViewId(
  stored: string | null,
  visited: Set<string> = new Set(),
  depth: number = 0,
): ReadInitialViewResult {
  const MAX_DEPTH = 5;

  // 终止条件 1: null
  if (!stored) return { view: HOME_VIEW };
  // 终止条件 2: 已是有效 view
  if (isValidView(stored)) return { view: stored };
  // 终止条件 3: 循环 (visited)
  if (visited.has(stored)) {
    console.warn(`[useViewState] migration cycle detected at ${stored}, fallback to home`);
    return { view: HOME_VIEW };
  }
  // 终止条件 4: 深度上限
  if (depth >= MAX_DEPTH) {
    console.warn(`[useViewState] migration depth ${MAX_DEPTH} exceeded at ${stored}, fallback to home`);
    return { view: HOME_VIEW };
  }

  // 递归
  visited.add(stored);
  const migration = VIEW_ID_MIGRATIONS.get(stored);
  if (!migration) {
    // 未知 stale + 不在迁移表 → console.warn (dev-only)
    if (import.meta.env?.DEV !== false) {
      console.warn(`[useViewState] unknown stale viewId: ${stored}, fallback to home`);
    }
    return { view: HOME_VIEW };
  }

  // 继续查 migration.toViewId 是否还要再迁移
  // 注意: appendQuery 只取最终一跳 (链上多跳合并策略待定,Phase 46 只取最后)
  return migrateViewId(migration.toViewId, visited, depth + 1);
}
```

### 7.3 链式上的 appendQuery 合并策略

**问题**：如果 `A → B (appendQuery: { foo: 1 }) → C (appendQuery: { bar: 2 })`，最终 appendQuery 是 `{ foo: 1, bar: 2 }` 还是 `{ bar: 2 }`？

**Phase 46 决策**：取**最终一跳**的 appendQuery（`{ bar: 2 }`）。理由：
- 中间跳的 appendQuery 是"局部上下文"，最终跳的 appendQuery 是"目标 view 的初始 state"。
- 合并多跳的 appendQuery 会引入隐式语义（如优先级、override 规则），Phase 46 不引入。

**未来扩展**：如果需要合并，可以加 `SidebarTile.migrateFrom.appendQueryMerge: 'last-wins' | 'merge'` 字段，Phase 46 不做。

### 7.4 最大深度 5 的合理性

- M3 历史最长链 1 层
- Phase 46 设计预期未来最长链 2-3 层（plugin 系统稳定后，少有连续 merge）
- 5 层是 generous 上限，覆盖所有现实场景 + 1 层余量
- 单测覆盖 depth=5 边界 + depth=6 fallback

### 7.5 链式迁移测试

```typescript
describe('Phase 46 — chain migration', () => {
  // mock VIEW_ID_MIGRATIONS with chain A → B → C
  // 1. stored='A' → C
  // 2. stored='B' → C (skip A)
  // 3. stored='A' with cyclic (A → B → A) → console.warn + fallback home
  // 4. stored='A' with depth=6 (A → B → C → D → E → F → G) → console.warn + fallback home
});
```

注：链式测试需要 mock VIEW_ID_MIGRATIONS（因为它是模块级 const）。建议把 `buildMigrationIndex` 暴露为可注入函数，或在测试用 `vi.mock('../../hooks/useViewState')`。

---

## 问题 8：与 Phase 44 接口

**结论**：Phase 46 完全复用 Phase 44 的 `SidebarTile.migrateFrom` 类型字段，不修改 Phase 44 任何产物。

### 8.1 Phase 44 出口（Phase 46 入口）

[VERIFIED: 44-RESEARCH.md §6.1 / §7.2]

| Phase 44 产出 | Phase 46 使用方式 |
|---|---|
| `SidebarTile.migrateFrom?: { fromViewId: string; appendQuery?: Record<string, string> }` | 直接读取，`buildMigrationIndex` 从 ALL_VIEW_META 派生 |
| `ALL_VIEW_META: Record<ViewId, SidebarTile>` | Phase 44 派生出的 sidebar 元信息，Phase 46 反向遍历 |
| `resource-browser` stub 的 `sidebarTile.migrateFrom` 已填 | 直接生效，Phase 46 不再改 |
| `useViewState.allViews: ViewId[]` | 不变（Phase 46 不改返回值，只改内部） |
| `ViewId` 联合类型 | 不变（Phase 46 不引入新 view） |

### 8.2 Phase 44 必须先做的前置

Phase 46 依赖 Phase 44 产出 `ALL_VIEW_META` 派生对象。**Phase 44 不做 Phase 46 不能做**（overview §1 Phase 46 依赖 Phase 44 也写明了）。

### 8.3 TypeScript 兼容性

Phase 46 不引入新 npm 包 / 新 TS 语法。`URLSearchParams` / `useLayoutEffect` 是标准浏览器 API（DOM lib）+ React 18 标准 hook。

**类型契约**：
- `SidebarTile.migrateFrom` 是 optional，Phase 46 内部 nullable 处理。
- `ReadInitialViewResult` 是新 export 类型，App.tsx 不直接 import（仅 useViewState 内部用）。
- `migrationSearch` 加到 ViewStateContext value，类型扩展 `UseViewStateResult`。

```typescript
// src/hooks/useViewState.tsx (Phase 46)

export interface UseViewStateResult {
  view: ViewId;
  setView: (v: ViewId) => void;
  allViews: typeof ALL_VIEWS;
  /** Phase 46 — stale viewId 迁移时携带的初始 URL search (给 ResourceBrowser 等消费者) */
  migrationSearch: Record<string, string> | undefined;
}
```

**TS breaking change**：之前 `UseViewStateResult` 只有 3 字段，Phase 46 加 `migrationSearch`。**所有使用 `useViewState()` 的地方需要重新编译**（虽然不强制使用新字段，TS 严格模式下需要 type assertion）。Phase 46 不删旧字段，纯粹加字段，兼容老代码。

### 8.4 与 Phase 47（lint + 整合）接口

Phase 47 会加 lint 规则。Phase 46 建议加 1 条 lint 规则：

```bash
# scripts/lint-plugin-coupling.sh 新增
# 规则 9: 所有 plugin stub 的 sidebarTile.migrateFrom.fromViewId 必须在 ALL_VIEW_META 中唯一
```

实现：脚本遍历 `src/plugins/stubs/*.tsx`，grep `fromViewId: '...'` 提取，断言去重后集合大小等于条目数。

Phase 47 整合验证（overview §3 Phase 47）：
- 跑 `scripts/lint-plugin-coupling.sh` 9 条规则
- INT-04 用例（mcp-management redirect）：Playwright 模拟 localStorage 注入 `'mcp-management'`，启动 app，断言 URL 含 `?tab=mcp` 且视图是 resource-browser

---

## Architecture Patterns

### System Architecture Diagram

```
[ Cold start ]
    │
    ▼
[ main.tsx mount ]
    │
    ▼
[ React render: ThemeProvider → ViewStateProvider → App ]
    │
    ▼
[ ViewStateProvider.useState initializer ]
    │   reads localStorage ccm.lastView
    │   calls readInitialView()
    │       │
    │       ├─ stored null → { view: 'home' }
    │       ├─ stored ∈ ALL_VIEW_IDS → { view: stored }
    │       └─ stored ∉ ALL_VIEW_IDS → query VIEW_ID_MIGRATIONS Map (递归,visited set)
    │           │
    │           ├─ hit → { view: toViewId, search: appendQuery }
    │           └─ miss → { view: 'home' }
    ▼
[ Children render: AppSidebar / AppHeader / <main>... ]
    │
    ├─ AppSidebar reads useViewState().view → highlights active tile
    │
    └─ <main>{ ResourceBrowser if view === 'resource-browser' }</main>
        │
        └─ ResourceBrowserPage mount:
            │
            ├─ useViewState().migrationSearch
            │   ├─ undefined → readInitialKindFromUrl() → 'plugin' fallback
            │   └─ { tab: 'mcp' } → 'mcp' (no URL read needed)
            │
            ▼
            [ First render with initialKind = 'mcp' ]
    │
    ▼
[ ViewStateProvider.useLayoutEffect (after commit) ]
    │   if migrationSearch present:
    │       window.history.replaceState({}, '', '/path?tab=mcp')
    │
    ▼
[ ViewStateProvider.useEffect ]
    │   localStorage.setItem(STORAGE_KEY, view)
    │   (覆盖 stale 值,如 'mcp-management' → 'resource-browser')
    │
    ▼
[ Stable: view = 'resource-browser', URL = '?tab=mcp', localStorage = 'resource-browser' ]
```

### Recommended Project Structure

Phase 46 改动集中在 2 个文件 + 1 个测试：

```
src/
├── hooks/
│   └── useViewState.tsx        # 改 readInitialView 返回类型 + 加 VIEW_ID_MIGRATIONS 派生 + 加 migrationSearch context
├── plugins/
│   └── stubs/
│       └── resource-browser.tsx  # Phase 44 已填 migrateFrom, Phase 46 不动
├── App.tsx                     # 删 174-197 useEffect
├── pages/
│   └── resource-browser/
│       └── index.tsx           # Phase 46: 读 useViewState().migrationSearch,优先于 URL
└── __tests__/
    └── hooks/
        └── useViewState.test.tsx  # 加 Phase 46 describe
```

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---|---|---|---|
| URL query string 拼装 | 手拼 `'?tab=' + value` | `URLSearchParams` | 自动 encode `&` `=` 等特殊字符，避免注入漏洞 |
| localStorage IO | 自己实现 quota 检测 / try-catch | 直接 `window.localStorage.setItem` + try-catch | localStorage 在沙盒/隐私模式 throw，try-catch 已够（CLAUDE.md §7 已有模式） |
| URL history 注入 | 自己实现 `pushState`/`replaceState` 选择 | `history.replaceState` | 老路由不留在 history 里（用户不能 back 回 stale 路由），符合"老路由已死"语义 |
| migrateFrom 规则存储 | 文件系统 / IndexedDB | localStorage + URL | view state 是前端独享 state，不涉及后端持久化 |
| 链式迁移解析 | while loop + 手动 visited | 递归 + visited Set | 递归语义清晰，TypeScript 尾递归优化不必要（深度 ≤ 5） |

**Key insight**：Phase 46 是纯前端重构，最大的"不手摇"是 **TypeScript 类型系统**。`SidebarTile.migrateFrom` 是 optional 字段，`Partial<SidebarTile>` 让 TS 强制每个 plugin stub 显式声明是否提供 migrateFrom（即使是 `migrateFrom: undefined` 也比漏掉好）。

---

## Runtime State Inventory

> Phase 46 不属于 rename/refactor/migration phase（不需要重命名项目或重排代码库结构），但确实涉及"stale viewId 清理"。这里关注 stale viewId 在 runtime 的存留。

| Category | Items Found | Action Required |
|---|---|---|
| Stored data (localStorage) | 老用户的 `ccm.lastView = 'mcp-management'` | Phase 46 mount 时自动迁移到 `'resource-browser'` + URL `?tab=mcp` |
| Live service config | 无（Tauri 端不存 view state） | 无 |
| OS-registered state | 无（view state 是纯前端） | 无 |
| Secrets/env vars | 无（view state 不涉及 secret） | 无 |
| Build artifacts | 无（前端代码无 built binary artifact 影响） | 无 |

**Nothing found in category**：view state 是纯前端 localStorage + React Context，无后端 / 无 OS-registered 关联。

**关键发现**：localStorage 是迁移的唯一源。Tauri WebView2 / WKWebView 的 localStorage 是 origin-scoped，迁移到 release build 后所有用户**第一次启动**都会经历这一迁移。

---

## Common Pitfalls

### Pitfall 1：useLayoutEffect 误用导致 SSR 报警

**What goes wrong**：在 Tauri release 构建中，useLayoutEffect 在 SSR 模式下会触发 console.warn（React 18 静态分析认为有 hydration mismatch 风险）。即使项目是纯 CSR，Tauri 加载顺序也可能让 React 误判。

**Why it happens**：useLayoutEffect 设计用于 DOM 测量（pre-paint），React 18 推荐 `useEffect` 除非有 pre-paint 需求。

**How to avoid**：用 `useIsomorphicLayoutEffect` 模式：
```typescript
import { useEffect, useLayoutEffect } from 'react';
const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;
```
项目是纯 CSR（Vite + Tauri），实际上没有 SSR，但显式 `typeof window !== 'undefined'` 防御更稳。

**Warning signs**：浏览器 console 出现 "useLayoutEffect does nothing on the server" 警告。

### Pitfall 2：URL 注入时机错过 ResourceBrowser mount

**What goes wrong**：useEffect 改 URL 太晚，ResourceBrowser 首次 mount 时 URL 还是空，默认 tab = 'plugin' 而非 'mcp'。

**Why it happens**：React 18 子组件 useEffect 早于父组件 useEffect。

**How to avoid**：
- 选项 A（推荐）：用 useLayoutEffect（commit phase 同步，父先子后）
- 选项 B：让 ResourceBrowser 通过 context 读 migrationSearch（§5.4）

**Warning signs**：用户从 v3.2 升级后首次启动，mcp tab 没被默认选中；手动点 sidebar 的 resource-browser tile 时 tab 又正确。

### Pitfall 3：chain migration 死循环

**What goes wrong**：如果两个 view 互相迁移（A → B, B → A），递归无限循环直到栈溢出。

**Why it happens**：未来 plugin 作者手填 `migrateFrom` 字段时拼错（如 `B` 的 migrateFrom 指向自己）。

**How to avoid**：`migrateViewId` 内部 visited Set 检测循环，触发 console.warn + fallback home。

**Warning signs**：浏览器卡死 / Stack Overflow 报错 / console 出现 "migration cycle detected" 警告。

### Pitfall 4：MIGRATION_LOG console.warn 在生产泄漏

**What goes wrong**：用户本地 localStorage 有 stale id，每次启动都 console.warn 污染用户的 devtools 控制台。

**Why it happens**：console.warn 没区分 dev / production。

**How to avoid**：用 `import.meta.env?.DEV !== false` 守卫：
```typescript
if (import.meta.env?.DEV !== false) {
  console.warn(...);
}
```
或者 `process.env.NODE_ENV === 'development'`（Vite 项目用 `import.meta.env.DEV`）。

**Warning signs**：生产构建 console 不干净 / 用户报"控制台有警告"。

### Pitfall 5：history.replaceState 在 sandbox 抛错未捕获

**What goes wrong**：用户用 Electron / 某些 webview 沙盒模式时，history API 被禁用，`replaceState` throw "SecurityError"。

**Why it happens**：Tauri 默认允许 history API，但用户装特殊 webview 扩展可能禁用。

**How to avoid**：包裹 try-catch：
```typescript
try {
  window.history.replaceState({}, '', newUrl);
} catch {
  // silently fallback to no URL change;view state still correct via useState
}
```

**Warning signs**：某些用户报"启动后页面错乱但 localStorage 正确"。

### Pitfall 6：URLSearchParams 在 SSR / 极旧浏览器报错

**What goes wrong**：URLSearchParams 是 ES2015 标准，旧 WebView2（Win 7 时代）可能不支持。

**Why it happens**：项目最低 Win 10，但仍有 Win 7 / Win 8.1 残留用户。

**How to avoid**：Tauri v2 仅支持 Win 10+，URLSearchParams 可放心使用（所有现代浏览器都支持）。无 fallback 需要。

**Warning signs**：极少见，仅在用户用极旧 webview 时出现。

### Pitfall 7：链式迁移时 appendQuery 取错跳

**What goes wrong**：A → B (appendQuery: {foo: 1}) → C (appendQuery: {bar: 2})，用户期望合并 {foo: 1, bar: 2}，但 Phase 46 只取最后一跳 {bar: 2}。

**Why it happens**：Phase 46 设计决策（§7.3）只取最终一跳。

**How to avoid**：在 SidebarTile.migrateFrom JSDoc 明确说明 "appendQuery 只在直接迁移生效，链式迁移时取最终一跳"。

**Warning signs**：链式迁移场景下，用户报"初始 tab 不对"。

---

## Code Examples

### ViewStateProvider 完整 Phase 46 实现

```typescript
// src/hooks/useViewState.tsx (Phase 46 完整态)
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from 'react';
import type { ReactElement, ReactNode } from 'react';

import { ALL_VIEW_META, type SidebarTile } from '../plugins/types';
import type { ViewId } from '../plugins/registry';

export const HOME_VIEW = 'home' as const;
export const STORAGE_KEY = 'ccm.lastView';

export const ALL_VIEWS: readonly ViewId[] = [
  /* ... (Phase 44 派生, 略) */
] as const;

function isValidView(v: string | null): v is ViewId {
  return v !== null && (ALL_VIEWS as readonly string[]).includes(v);
}

/* ──────────── Phase 46 — VIEW_ID_MIGRATIONS ──────────── */

export interface MigrationEntry {
  toViewId: ViewId;
  appendQuery?: Record<string, string>;
}

function buildMigrationIndex(): ReadonlyMap<string, MigrationEntry> {
  const idx = new Map<string, MigrationEntry>();
  for (const [viewId, tile] of Object.entries(ALL_VIEW_META) as Array<[ViewId, SidebarTile]>) {
    if (tile.migrateFrom) {
      idx.set(tile.migrateFrom.fromViewId, {
        toViewId: viewId,
        appendQuery: tile.migrateFrom.appendQuery,
      });
    }
  }
  return idx;
}

const VIEW_ID_MIGRATIONS: ReadonlyMap<string, MigrationEntry> = buildMigrationIndex();

const MAX_MIGRATION_DEPTH = 5;

function migrateViewId(
  stored: string | null,
  visited: Set<string> = new Set(),
  depth: number = 0,
): ReadInitialViewResult {
  if (!stored) return { view: HOME_VIEW };
  if (isValidView(stored)) return { view: stored };
  if (visited.has(stored)) {
    if (import.meta.env?.DEV !== false) {
      console.warn(`[useViewState] migration cycle detected at ${stored}`);
    }
    return { view: HOME_VIEW };
  }
  if (depth >= MAX_MIGRATION_DEPTH) {
    if (import.meta.env?.DEV !== false) {
      console.warn(`[useViewState] migration depth ${MAX_MIGRATION_DEPTH} exceeded at ${stored}`);
    }
    return { view: HOME_VIEW };
  }

  visited.add(stored);
  const migration = VIEW_ID_MIGRATIONS.get(stored);
  if (!migration) {
    if (import.meta.env?.DEV !== false) {
      console.warn(`[useViewState] unknown stale viewId: ${stored}`);
    }
    return { view: HOME_VIEW };
  }

  // 递归 (appendQuery 由 readInitialView 单独处理 appendQuery 链)
  return migrateViewId(migration.toViewId, visited, depth + 1);
}

/* ──────────── readInitialView (Phase 46 扩展) ──────────── */

export interface ReadInitialViewResult {
  view: ViewId;
  search?: Record<string, string>;
}

export function readInitialView(): ReadInitialViewResult {
  if (typeof window === 'undefined') return { view: HOME_VIEW };
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (!stored) return { view: HOME_VIEW };
  if (isValidView(stored)) return { view: stored };

  // 链式迁移: 第一跳 + 解析 search
  const visited = new Set<string>();
  visited.add(stored);
  const migration = VIEW_ID_MIGRATIONS.get(stored);
  if (!migration) {
    if (import.meta.env?.DEV !== false) {
      console.warn(`[useViewState] unknown stale viewId: ${stored}`);
    }
    return { view: HOME_VIEW };
  }

  // 验证最终一跳是 valid view
  const finalView = isValidView(migration.toViewId)
    ? migration.toViewId
    : HOME_VIEW;
  // appendQuery 只取第一跳 (链式多跳合并留 future)
  return { view: finalView, search: migration.appendQuery };
}

/* ──────────── ViewStateProvider (Phase 46 mount dispatch) ──────────── */

export interface UseViewStateResult {
  view: ViewId;
  setView: (v: ViewId) => void;
  allViews: typeof ALL_VIEWS;
  /** Phase 46 — stale viewId 迁移时携带的初始 URL search */
  migrationSearch: Record<string, string> | undefined;
}

const ViewStateContext = createContext<UseViewStateResult | null>(null);

export function ViewStateProvider({
  children,
}: {
  children: ReactNode;
}): ReactElement {
  const [view, setViewState] = useState<ViewId>(() => readInitialView().view);

  // URL 注入 (useLayoutEffect 保证在子组件 useEffect 之前)
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
        /* sandbox fallback */
      }
    }
  }, []);

  // localStorage 同步
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

### ResourceBrowser 改造（Phase 46）

```typescript
// src/pages/resource-browser/index.tsx (Phase 46 改造片段)

import { useViewState } from '../../hooks/useViewState';
import type { ResourceKind } from '../../types/resource';

function ResourceBrowserPage(): ReactElement {
  // Phase 46 — 优先用 context 的 migrationSearch (Phase 46 mount-time 注入)
  // 其次用 URL search (QuickSearchModal 主动导航)
  // 都没有则默认 'plugin'
  const { migrationSearch } = useViewState();
  const initialKind: ResourceKind = useMemo(() => {
    const fromContext = migrationSearch?.tab;
    if (fromContext && (ALL_RESOURCE_KINDS as readonly string[]).includes(fromContext)) {
      return fromContext as ResourceKind;
    }
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const fromUrl = params.get('tab');
      if (fromUrl && (ALL_RESOURCE_KINDS as readonly string[]).includes(fromUrl)) {
        return fromUrl as ResourceKind;
      }
    }
    return 'plugin';
  }, [migrationSearch]);

  // ... 其余用 initialKind 替代 readInitialKindFromUrl()
}
```

### App.tsx 删除 useEffect

```typescript
// src/App.tsx (Phase 46 前后对比)

// 删除前 (174-197):
useEffect(() => {
  if (typeof window === 'undefined') return;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'mcp-management') {
      window.localStorage.removeItem(STORAGE_KEY);
      setView('resource-browser');
      if (!window.location.search.includes('tab=mcp')) {
        window.location.replace('/resource-browser?tab=mcp');
      }
    }
  } catch {}
}, []);

// 删除后: 整段删除

// 删除 import:
- import { useViewState, ALL_VIEWS, STORAGE_KEY, type ViewId } from './hooks/useViewState';
+ import { useViewState, ALL_VIEWS, type ViewId } from './hooks/useViewState';
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|---|---|---|---|
| App.tsx 兜底 useEffect 硬编码 viewId | `SidebarTile.migrateFrom` 元数据 + `useViewState.readInitialView` 解析 | Phase 46 | 加 view 改 1 文件，不改 App.tsx |
| `window.location.replace` 触发 reload | `window.history.replaceState` 不触发 reload | Phase 46 | SPA 单页切换，无首屏闪烁 |
| `readInitialView` 返回裸 ViewId | 返回 `{ view, search? }` | Phase 46 | 支持 mount-time URL 注入 |
| 1 层迁移（无链式） | 链式 + 深度保护（5 层）+ 循环检测 | Phase 46 | 未来 A→B→C 链式合并可解析 |

**Deprecated/outdated**：
- App.tsx:174-197 useEffect（v3.2 phase 27 兜底代码）：Phase 46 整段删除
- `window.location.replace`（full reload）：Phase 46 改用 `history.replaceState`
- `STORAGE_KEY` 从 App.tsx 引用：Phase 46 改为只 useViewState 内部引用

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|---|---|---|
| A1 | `SidebarTile.migrateFrom` 字段 Phase 44 已加（[VERIFIED: 44-RESEARCH.md §6.1]） | §1.3 | 高 — Phase 46 依赖此字段存在；若 Phase 44 没加，Phase 46 不能开工 |
| A2 | `ALL_VIEW_META` Phase 44 派生（[ASSUMED — Phase 44 PLAN 产出]） | §2.4 / §8.1 | 高 — Phase 46 `buildMigrationIndex` 依赖 ALL_VIEW_META |
| A3 | `useLayoutEffect` 在 React 18 commit phase 早于子组件 useEffect | §5.4 | 中 — React 18 文档明确，但需实测 |
| A4 | URLSearchParams.toString() 在所有目标 WebView2 / WKWebView 正常 | §3.3 | 低 — ES2015 标准，Tauri v2 最低 Win 10 |
| A5 | localStorage origin-scoped（迁移到 release build 后所有用户首次启动都经历迁移） | Runtime State | 低 — Tauri origin scheme 不变 |
| A6 | `history.replaceState` 不触发 popstate event（不会让 React 误以为是 navigation） | §5.4 | 低 — MDN 明确：replaceState 不发 popstate |
| A7 | `mcp-management` plugin stub Phase 44 推荐删（[VERIFIED: overview §3 Phase 44]） | §1.4 | 中 — Phase 46 不删 stub，但 Phase 44 删完后 Phase 46 仍然通过 SidebarTile.migrateFrom 工作 |
| A8 | 链式迁移深度 5 层够用（M3 历史最长链 1 层） | §7.4 | 低 — generous 上限 |
| A9 | ResourceBrowser 改造为读 useViewState().migrationSearch 优先于 URL | §5.4 / Code Examples | 中 — ResourceBrowser 现有 readInitialKindFromUrl 已测，需加新测 |
| A10 | `appendQuery` 链式只取最终一跳是合理默认 | §7.3 | 低 — Phase 46 决策，future 可改 |

**如果此表为空**：不适用，Phase 46 有 10 项 ASSUMED 需在 discuss-phase 验证。其中 A1/A2 是 Phase 44 强验收前提，A7/A9 是 Phase 46 范围内的灰区决策点。

---

## Open Questions

1. **mcp-management plugin stub 是否在 Phase 46 删除？**
   - Phase 44 决策是"删"（overview §3 Phase 44 强验收），但 Phase 46 不在 Phase 44 范围。
   - 当前 Phase 46 + Phase 44 串行（overview §1 关键路径），Phase 44 先 Phase 46。
   - Phase 46 假设 Phase 44 已删 mcp-management stub；如果 Phase 44 没删，Phase 46 仍正常工作（readInitialView 走 VIEW_ID_MIGRATIONS 路径，不依赖 stub 是否存在）。

2. **appendQuery 链式多跳合并策略**（§7.3）
   - 当前决策：只取最终一跳。
   - 未来如需合并，可加 `migrateFrom.appendQueryMerge: 'last-wins' | 'merge'`。
   - 决策影响：是否在 Phase 46 文档化合并策略。

3. **resource-browser 的 `?tab=mcp` 是否保留作为对外 URL 契约**（§5.3）
   - 当前决策：保留（QuickSearchModal 仍写 URL）。
   - Phase 46 useLayoutEffect 也写 URL。
   - 决策影响：URL 是一等公民还是仅 mount-time 辅助。

4. **`useViewState().migrationSearch` 是否要扩展为支持清除？**（§5.4）
   - 当前：mount 时返回，第二次渲染仍是 mount 时的值。
   - 用户后续手动切 tab 时，是否清空 migrationSearch 让 URL 不带 `?tab=mcp`？
   - 决策影响：清空逻辑在哪做（ResourceBrowser 还是 ViewStateProvider）。

5. **`SidebarTile.migrateFrom.fromViewId` 唯一性如何强制？**
   - 编译期：`satisfies` 不能保证唯一性（只能保证 exhaustive）。
   - 运行期：buildMigrationIndex 用 Map，重复 key 后写覆盖前，**不会报错**。
   - 建议：Phase 47 lint 规则 9（§8.4）grep 检查唯一性。

---

## Validation Architecture

### Test Framework
| Property | Value |
|---|---|
| Framework | Vitest (前端单元) + Playwright (e2e) |
| Config file | `vitest.config.ts` / `playwright.config.ts`（项目已有） |
| Quick run command | `npx vitest run src/__tests__/hooks/useViewState.test.tsx` |
| Full suite command | `npm run test` |

### Phase Requirements → Test Map

| Phase 需求 | 行为 | 测试类型 | 命令 | 文件存在? |
|---|---|---|---|---|
| VIEW_ID_MIGRATIONS 派生 1 项 | SidebarTile.migrateFrom → Map 反向索引 | unit | `npx vitest run src/__tests__/hooks/useViewState.test.tsx` | ❌ Phase 46 新建 |
| stale "mcp-management" → resource-browser | readInitialView 解析 + context migrationSearch | unit | 同上 | ❌ Phase 46 新建 |
| URL 注入 `?tab=mcp` | useLayoutEffect 后 `window.location.search` 含 `tab=mcp` | unit | 同上 | ❌ Phase 46 新建 |
| localStorage 覆盖 stale | mount 后 localStorage = 'resource-browser' | unit | 同上 | ❌ Phase 46 新建 |
| 未知 stale → home + console.warn | readInitialView fallback + dev warn | unit | 同上 | ❌ Phase 46 新建 |
| 链式 A→B→C | migrateViewId 递归 3 层 | unit | 同上 | ❌ Phase 46 新建 |
| 链式循环 A→B→A | console.warn + fallback home | unit | 同上 | ❌ Phase 46 新建 |
| 链式深度 6 | console.warn + fallback home | unit | 同上 | ❌ Phase 46 新建 |
| ResourceBrowser 读 migrationSearch | initialKind = 'mcp' | unit | `npx vitest run src/__tests__/pages/resource-browser.test.tsx` | ✅ 改写 |
| App.tsx 删 useEffect 后无回归 | 已有 e2e 套件 PASS | e2e | `npx playwright test` | ✅ 不动 |
| mcp-management redirect Playwright INT-04 | localStorage 注入 → 启动 → URL `?tab=mcp` + view=resource-browser | e2e | Phase 47 整合 | ❌ Phase 47 新建 |

### Sampling Rate
- **Per task commit**: `npx vitest run src/__tests__/hooks/useViewState.test.tsx`
- **Per wave merge**: `npm run test`（vitest + Playwright smoke）
- **Phase gate**: 全套 green + 手动验证升级路径（v3.2 user 的 localStorage 'mcp-management' → v3.4 → 启动 → 跳到 mcp tab）

### Wave 0 Gaps
- [ ] `src/__tests__/hooks/useViewState.test.tsx` 新增 describe "Phase 46 — VIEW_ID_MIGRATIONS + SidebarTile.migrateFrom"
- [ ] `src/__tests__/hooks/useViewState.test.tsx` 新增 describe "Phase 46 — chain migration"
- [ ] `src/__tests__/hooks/useViewState.test.tsx` 新增 describe "Phase 46 — mount-time migration dispatch"
- [ ] `src/__tests__/pages/resource-browser.test.tsx` 改写：注入 migrationSearch 时 default kind = 'mcp'

---

## Security Domain

**本 Phase 无新增安全 attack surface**。Phase 46 是纯前端架构重构，不引入新 IPC 命令、不引入新依赖、不修改后端。

| ASVS Category | Applies | Standard Control |
|---|---|---|
| V2 Authentication | no | 无认证逻辑改动 |
| V3 Session Management | no | localStorage key 不变（ccm.lastView） |
| V4 Access Control | no | 无权限变化 |
| V5 Input Validation | yes | URLSearchParams 处理 `appendQuery` 自动 encode |
| V6 Cryptography | no | 无加密改动 |

**V5 Input Validation 详情**：
- `appendQuery: Record<string, string>` 是 TypeScript 强类型，TS 编译期保证值是 string。
- `URLSearchParams.toString()` 自动 encode 特殊字符（`&` `=` `%` 等），避免注入。
- `window.history.replaceState` URL 不能跨域（same-origin 限制），browser 内置安全。
- 未知 stale viewId 通过 `migrateViewId` fallback 到 home，不传给 ResourceBrowser 之外的页面。

**唯一可关注点**：localStorage 字段名 `ccm.lastView` 是否泄露用户视图历史（low risk，与 Phase 44 一致）。Phase 46 不改。

---

## Environment Availability

> Phase 46 是纯前端代码改动，无外部依赖（无 npm / 无 CLI / 无 DB）。

| Dependency | Required By | Available | Version | Fallback |
|---|---|---|---|---|
| React 18 `useLayoutEffect` | ViewStateProvider URL 注入 | ✓ | 18.x（项目锁版本） | — |
| `URLSearchParams` | appendQuery 编码 | ✓ | ES2015 标准 | — |
| `window.history.replaceState` | URL 注入 | ✓ | HTML5 标准 | sandbox 模式 try-catch fallback |
| `window.localStorage` | view state 持久化 | ✓ | HTML5 标准 | try-catch fallback |

**缺失依赖 with fallback**：
- `URLSearchParams`：所有 Tauri v2 目标 WebView2 / WKWebView 都支持，无 fallback 需要。
- `window.history.replaceState`：可能被 sandbox / 隐私模式禁用，已 try-catch 兜底（不抛错）。
- `window.localStorage`：可能被 sandbox 禁用，已 try-catch 兜底（[VERIFIED: App.tsx:174-197 现有 try-catch 模式]）。

---

## Sources

### Primary (HIGH confidence — 现场代码核对)

- `src/App.tsx:1-720` 全文 — view 路由 + stale-route useEffect + Page import + 三元链
- `src/App.tsx:174-197` 全文 — Phase 27 Fix 6 D-13 stale-route 兜底 useEffect
- `src/hooks/useViewState.tsx:1-237` 全文 — view state hook + ALL_VIEWS + Context 实现
- `src/hooks/useViewState.tsx:139-147` 全文 — isValidView / readInitialView
- `src/plugins/types.ts:1-28` 全文 — FrontendPlugin / RouteDef 类型
- `src/plugins/registry.ts:1-53` 全文 — ALL_PLUGINS + ALL_ROUTES 派生机制
- `src/plugins/stubs/resource-browser.tsx:1-23` 全文 — 当前 stub（Phase 44 前）
- `src/plugins/stubs/mcp-management.tsx:1-23` 全文 — 当前 stub
- `src/plugins/stubs/mod.ts:1-18` 全文 — 9 个 stub barrel
- `src/components/AppSidebar.tsx:1-182` 全文 — VIEW_META + sidebar 渲染
- `src/components/QuickSearchModal.tsx:380-440` — `?tab=mcp` 主动导航历史
- `src/pages/resource-browser/index.tsx:120-145` — `readInitialKindFromUrl` URL 解析
- `src/types/resource.ts:1-103` 全文 — ResourceKind + ALL_RESOURCE_KINDS
- `src/__tests__/hooks/useViewState.test.tsx:1-235` 全文 — useViewState TDD 覆盖
- `.planning/milestones/v3.4-phases/00-PHASE-OVERVIEW.md:1-285` 全文 — 6 phases 总览
- `.planning/milestones/v3.4-phases/44-RESEARCH.md:1-1070` 全文 — Phase 44 类型设计 (SidebarTile.migrateFrom 字段定义)

### Secondary (MEDIUM confidence — TS / React 语言机制推断)

- TS 4.9+ `as const satisfies` 模式保留字面量类型 + 强制 exhaustive
- React 18 `useLayoutEffect` vs `useEffect` 时序（子组件 useEffect 早于父组件 useEffect，useLayoutEffect 同步 commit phase 早于所有 useEffect）
- `URLSearchParams.toString()` 自动 encode 行为（MDN 文档）
- `window.history.replaceState` 不触发 popstate event（MDN 文档）
- Vite `import.meta.env.DEV` 区分 dev/production 构建

### Tertiary (LOW confidence — 假设需验证)

- "用户升级到 v3.4 时 mcp-management localStorage 占比" — overview 没给具体数字。Phase 47 INT-04 验证时取真实用户样本。
- "Tauri WebView2 / WKWebView sandbox 模式触发率" — 项目历史无统计。try-catch 兜底已经覆盖。
- "链式迁移未来实际深度" — Phase 46 假设最长 3 层（基于 M3 历史）。如未来真出现 5 层链需考虑 5 层上限。

---

## Metadata

**Confidence breakdown:**

| Area | Level | Reason |
|---|---|---|
| 标准栈（无新依赖） | HIGH | Phase 46 用 React 18 + TS 5 + URLSearchParams + useLayoutEffect，全部已存在 |
| 架构（分布式元数据 + context 双源） | HIGH | Phase 44 SidebarTile.migrateFrom 已定义；Phase 46 是消费方 |
| URL 注入机制（useLayoutEffect + migrationSearch context） | MEDIUM | 时序依赖 React 18 commit phase 行为，需实测 |
| 链式迁移（深度 5 + 循环检测） | HIGH | 纯函数 + visited set，标准算法 |
| Pitfalls | MEDIUM | useLayoutEffect SSR 警告 / URL 注入时序 / chain 死循环 是常见踩点 |
| Phase 44 接口 | HIGH | 44-RESEARCH.md §6.1/§7.2 已明确 migrateFrom 字段 |
| Validation | HIGH | Vitest + Playwright 已有，只需补 describe + 测试 |

**Research date:** 2026-06-27
**Valid until:** 2026-07-27 (30 天，本 Phase 是内部重构，无外部 API 变化)