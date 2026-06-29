# VERIFICATION-B8 — MCP 加载死循环

**日期**: 2026-06-30
**分支**: `verify/b8-mcp-loop`
**Worktree**: `/Users/coderstory/CodeSource/winui3/.claude/worktrees/agent-a6f516f9600502c0b`
**协议**: CLAUDE.md §16 五步流程

---

## 1. 了解 (Problem Details)

| 维度 | 内容 |
|---|---|
| **操作路径** | 应用启动 → 侧边栏点 MCP 管理 → MCP 管理页打开 |
| **前置状态** | `useProjects()` 加载 `projects.json`,`currentProject` 派生自 `projects.find(id)` |
| **期望行为** | 页面渲染表格(空 / 有 servers),`loading=false` |
| **实际行为** | "加载中"占位符永不消失,React 持续重渲染,CPU 100% |
| **触发条件** | 任何导致 MCP 页重渲染的事件 (初始 IPC resolve / toggle / 切换项目) |
| **出现频率** | 100% — 每次开页必现 |
| **影响范围** | `src/pages/mcp-management/index.tsx` 单文件,但阻塞整页 UI |

---

## 2. 明确原因 (Root Cause — file:line 证据)

### 修复前代码 (`src/pages/mcp-management/index.tsx:113`)

```tsx
useEffect(() => {
  syncScopeFromProject(currentProject);
}, [currentProject]);
```

### 触发链

```
render N
  └─ useProjects() → currentProject = projects.find(id)  // 新对象引用
       └─ useEffect deps 改变 (Object.is 失败)
            └─ syncScopeFromProject(currentProject) 调用
                 └─ scope store 更新 (用户级 → 项目级)
                      └─ useSyncExternalStore 通知
                           └─ render N+1
                                └─ ...循环
```

### 根因证据

`currentProject` 在 `src/hooks/useProjects.ts:116-117` 派生:

```ts
const currentProject =
  projects.find((p) => p.id === currentProjectId) ?? null;
```

每次 `useProjects` 重渲染 (e.g. `setProjects(result.projects)` 后),`projects` 数组引用已变,`.find()` 返回新对象 → `Object.is(prevCP, nextCP) === false` → React 判定 effect 需要重跑。

### 文件:行 引用

| 文件 | 行 | 说明 |
|---|---|---|
| `src/pages/mcp-management/index.tsx` | 113 (修复前) | `useEffect(..., [currentProject])` — 不稳定依赖 |
| `src/hooks/useProjects.ts` | 116-117 | `currentProject = projects.find(...)` — 每次新引用 |
| `src/hooks/useScope.ts` | 154-164 | `syncScopeFromProject` — 写 store + emit |
| `src/hooks/useScope.ts` | 76-82 | `emitChange()` — 通知所有订阅者 |

---

## 3. 边界 (Scope)

| 维度 | 评估 |
|---|---|
| **业务模块** | F6 MCP 管理 |
| **影响文件** | `src/pages/mcp-management/index.tsx` (单文件,15 行改动) |
| **新增文件** | `src/__tests__/pages/mcp-management-loop.spec.tsx` (286 行) |
| **平台差异** | 无 (React 层,跨平台一致) |
| **数据依赖** | 无 (mock 测试不依赖 IPC) |
| **§2.4 白名单** | 不需要 — 单文件改动 |
| **关联组件** | `useScope` 消费者 (json-editor / resource-browser / mcp-management),但它们的 useEffect 已正确 (查 master) |

---

## 4. 分析技术方案 (Technical Options)

| 方案 | 描述 | 优点 | 缺点 | 选? |
|---|---|---|---|---|
| **A** | dep 改 `[currentProject?.id]` | 最小变更,直接消解不稳定 ref,primitive equality 自动稳定 | 需 `eslint-disable-next-line react-hooks/exhaustive-deps`(因为 hook 内用了 `currentProject` 但 deps 没列) | ✅ |
| **B** | `useScope` 内部 useMemo 返回稳定 ref | 治本,所有 hook 消费者都受益 | 改动 hook 签名 + 多个调用方 (json-editor / resource-browser),影响面 3-4 个文件 | ❌ |
| **C** | `useEffect` → `useMemo` 计算 scopeKey | 消除 effect,无 deps 问题 | 改架构模式,可能引入新副作用 (memo 重计算触发) | ❌ |
| **D** | `useProjects` 内部 useMemo 返回稳定 currentProject ref | 治本 | 改 hook 签名,所有消费方都得改 | ❌ |

**选 A**: 最小风险 + 直接解 unstable ref 问题;master 分支 commit `7cee365` 已采纳同样方案,本 worktree 缺该 fix,本次补回。

---

## 5. 验证 (Evidence — §16.2 强证据)

### 5.1 自动化测试 (Red → Green)

**Red 阶段**: `npx vitest --run src/__tests__/pages/mcp-management-loop.spec.tsx`
修复前实际输出:
```
× fires syncScopeFromProject at most twice when currentProject reference is unstable but id is stable (project scope)
  → expected 3 to be less than or equal to 2

FAIL src/__tests__/pages/mcp-management-loop.spec.tsx
Tests  1 failed | 1 passed (2)
```

**Green 阶段**: 同一测试在 fix 后:
```
✓ src/__tests__/pages/mcp-management-loop.spec.tsx (2 tests) 86ms

Test Files  1 passed (1)
Tests  2 passed (2)
```

### 5.2 关联测试 (无回归)

```
✓ src/__tests__/hooks/useScope-remount.test.tsx (6 tests)
✓ src/__tests__/pages/mcp-management.test.tsx (20 tests)
✓ src/__tests__/hooks/useScope.test.ts (8 tests)
   Tests  34 passed (34)
```

### 5.3 测试断言机理

测试 (`src/__tests__/pages/mcp-management-loop.spec.tsx`) 的关键设计:

1. **Mock `useProjects`** 返回新对象 `{...project}` 每次调用 → 模拟生产环境的 `find()` 不稳定 ref
2. **Mock `useScope`** 保留 `useSyncExternalStore` 真实语义 → 任何 store mutation 触发真实重渲染 (loop 必要条件)
3. **Spy `syncScopeFromProject`** 路由通过 `vi.fn()` → 计数每次 page 调用
4. **Trigger**: 让 `listMcpServers` IPC resolve (Promise.resolve([])) → page setState → re-render → effect 重新评估
5. **断言**: `expect(syncScopeCallCount).toBeLessThanOrEqual(2)`
   - Buggy `[currentProject]`: 3 次 (mount + IPC resolve re-render + commit re-render)
   - Fixed `[currentProject?.id]`: 1 次 (mount only)

### 5.4 不算验证 vs 算验证

| 方式 | 算? | 备注 |
|---|---|---|
| vitest Red → Green | ✅ | 客观、可复现、测试留 codebase |
| 关联测试 34/34 PASS | ✅ | 无回归证据 |
| 启动 app 截图 | ❌ 跳过 | §16 + §17 强规则:mid-task verify 只能用 vitest/cargo test,禁止 build/smoke |
| smoke test 10/10 | ❌ 跳过 | 同上 |

### 5.5 提交链

```
a1b0d66 sync: v3.4.4 WIP + upstream Phase 48 refactor (2026-06-29)
e8c3c3f wip(b8): failing vitest regression test for MCP currentProject effect loop
cb3ea09 verify(b8): MCP currentProject effect fix + regression test
```

---

## 6. 与上游 commit 7cee365 的关系

| 维度 | upstream `7cee365` (master) | 本 worktree |
|---|---|---|
| **commit 存在?** | 是 | 否 (worktree HEAD `a1b0d66` 是 7cee365 的平行起点) |
| **diff 内容** | `[currentProject]` → `[currentProject?.id]` | 同 (本次补回) |
| **测试?** | 仅 smoke test 8/10 + 启动没崩 | vitest Red→Green + 34 关联测试 |
| **证据强度** | 弱 (§16.2 反例) | 强 (§16.2 正例) |

`merge-base a1b0d66 master` = `a1b0d66` → worktree 不是 7cee365 的祖先。本次重做不重复工作,而是补齐 verification evidence (test + 5 步流程文档)。

---

## 7. 已知限制 / 后续

1. **`useScope` 内部仍可能因 `getSnapshot` 返回相同 ref 但 store 已变而不通知** — 但 `currentState = {...currentState, x}` 模式保证 immutable ref 替换,React 可检测。无需修改。
2. **eslint-disable-next-line** 是必要权衡 — hook 内部读 `currentProject` 但 deps 只列 id。如果未来 useProjects 改 hook 签名 (返回 useMemo'd currentProject),可移除该 disable。
3. **StrictMode 未启用** — 本测试在非 StrictMode 环境下固定为 1 次调用;启用 StrictMode 后会涨到 2 次 (Double-Invoke),仍 ≤ 上限 2。

---

## 8. 协议执行检查

| §16 步骤 | 完成? | 证据 |
|---|---|---|
| 1. 了解详情 | ✅ | §1 |
| 2. 明确原因 (file:line) | ✅ | §2 |
| 3. 边界 (§2.4 白名单) | ✅ | §3 (单文件改动,免白名单) |
| 4. 方案 ≥2 | ✅ | §4 (列 4 方案,选 A) |
| 5. 验证 (Red → Green + 测试留 codebase) | ✅ | §5 + commit e8c3c3f/cb3ea09 |

**结论**: B8 修复经过严格验证,evidence 充足,可标记 verified。

---

**作者**: Claude Code (autonomous verification subagent)
**Worktree**: `verify/b8-mcp-loop`
**commits**: `e8c3c3f` (Red) → `cb3ea09` (Green)