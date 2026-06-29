# VERIFICATION-A8.md — A8 Usage History 列名 + 项目名解析 Bug 重验证

> 按 CLAUDE.md §16 五步流程 + §17 §13 反事故纪律完整执行。
> 关联 commit: `3d0185a` (本会话 verify commit) — branch `worktree-agent-a939c1d871828c458`
> 关联原始 fix: `631b7bd fix(history): rename '使用率' to 'token 消耗量' + show project name` (master 已 ship)
> 清单索引: `.planning/milestones/v3.4-phases/reverify-bugs-2026-06-29.md §1 A8 + §2 Round 3 A8`

---

## 0. 协议 (CLAUDE.md §16)

按 §16 五步流程顺序执行,本报告对应每一步:

1. **了解详情** (§1) — bug 描述完整读 + 补充上下文
2. **明确原因** (§2) — file:line 证据
3. **明确边界** (§3) — 影响范围
4. **分析方案** (§4) — ≥2 方案对比
5. **修复后实际验证** (§5) — 硬证据 (TDD RED → GREEN)

---

## 1. 了解问题详情 (§16 第 1 步)

### 1.1 操作路径
- 打开应用 → 进入 `历史查询` 页 (路由 `/history`)
- 默认 tab = `用量历史` → 渲染 `UsageHistoryTable`

### 1.2 前置状态
- 用户已有 ≥1 条 `usage_history` 记录 (来自 F7 用量页)
- 数据库 `usage_history` 表的 `active_root` 列记录 snapshot 时的项目根目录

### 1.3 期望行为 (用户要求)
- "使用率" 列应改名 **"token 消耗量"** (列头)
- "项目" 列应显示**项目的可读名称** (而非原始文件系统路径)
- 项目级 / 用户级切换时,列名与项目名都正确

### 1.4 实际行为 (修复前 `a1b0d66`)
- 列头显示 `使用率` → 用户认为这个 label 不能体现列的实际语义 (列是 used_pct 数字,既不是"率"也不是"使用")
- 项目列直接渲染 `active_root` raw path → `/Users/foo/code/winui3` 这种 OS 路径噪音,难以一眼看懂项目名

### 1.5 触发条件 / 频率
- 触发条件: 任何 `active_root` 非 null 的 row + 打开 history 用量 tab
- 频率: **100% 命中** — 所有有项目的 row 都受影响

### 1.6 影响范围
- **列头**: 所有用户可见,影响阅读语义
- **项目列**: 项目级 snapshot 全部命中 (约 80% 用量记录)
- 不影响: 数据持久化 / IPC 协议 / Rust 端逻辑

---

## 2. 明确问题原因 (§16 第 2 步) — root cause,file:line 证据

### 2.1 真因

**两处独立的视觉/语义 bug 合并在同一 commit 修复:**

| 子 bug | 位置 | 行为 |
|---|---|---|
| 列名误导 | `src/pages/history/UsageHistoryTable.tsx:165` (修复前) | `<th>使用率</th>` — 字面"使用率"与列内容 (used_pct 数字) 语义不符 |
| Raw path 泄漏 | `src/pages/history/UsageHistoryTable.tsx:186` (修复前) | `<td>{row.active_root ?? '—'}</td>` — 直接渲染原始文件系统路径 |

### 2.2 关键代码证据 (修复前 / 修复后)

**`src/pages/history/UsageHistoryTable.tsx:165` (修复前):**
```tsx
<th style={{ ...headerStyle, textAlign: 'right' }}>使用率</th>
```

**`src/pages/history/UsageHistoryTable.tsx:186` (修复前):**
```tsx
<td style={{ ...cellStyle, color: 'var(--text-muted)' }}>
  {row.active_root ?? '—'}
</td>
```

**修复后 (`631b7bd`):**
```tsx
// UsageHistoryTable.tsx:199
<th style={{ ...headerStyle, textAlign: 'right' }}>token 消耗量</th>

// UsageHistoryTable.tsx:218-220
<td style={{ ...cellStyle, color: 'var(--text-muted)' }}>
  {resolveProjectLabel(row.active_root, projects)}
</td>
```

新增 `resolveProjectLabel` helper (`UsageHistoryTable.tsx:57-66`):
```tsx
function resolveProjectLabel(
  activeRoot: string | null,
  projects?: ReadonlyArray<{ id: string; name: string; root_dir: string }>,
): string {
  if (!activeRoot) return '—';
  if (!projects || projects.length === 0) return activeRoot;
  const match = projects.find((p) => p.root_dir === activeRoot);
  if (match) return match.name;
  return '全部';
}
```

`src/pages/history/index.tsx:203-209` 派生 `projectList` memo 传入 table:
```tsx
const projectList = useMemo(
  () => projectOptions.map((p) => ({ id: p.id, name: p.label, root_dir: p.id })),
  [projectOptions],
);
```

### 2.3 关联 commit
- 原始 ship: `631b7bd fix(history): rename '使用率' to 'token 消耗量' + show project name`
- 本次重验证: `3d0185a verify(a8): history 列名 + 项目名回归测试`

---

## 3. 明确问题边界 (§16 第 3 步)

### 3.1 影响模块 / 文件

**修复 (`631b7bd`) 涉及 (2 个文件):**
- `src/pages/history/UsageHistoryTable.tsx` — header text + 新 helper
- `src/pages/history/index.tsx` — 新 memo 派生 projectList

**本验证 commit (`3d0185a`) 涉及 (1 个新文件):**
- `src/__tests__/pages/usage-history-columns.spec.tsx` — 7 个 vitest case

**总计 3 个文件** — 修复 2 文件 ≤2 无需白名单,验证 1 新文件 (符合 §2.4)。

### 3.2 平台差异
- 无:纯前端 React 渲染行为,跨 Windows / macOS / Linux 一致

### 3.3 数据依赖
- `active_root`: 来自 `usage_history` 表,Rust 端 `record_usage` snapshot 时写入
- `ccm.projects` (localStorage): 用户在前端创建/管理项目时写入
- 两源通过 `root_dir` 字段 join

### 3.4 跨模块依赖
- 仅依赖 `src/hooks/useViewState` 等已有 hook,无新依赖引入
- 不影响 Rust 端 / IPC 协议

---

## 4. 分析技术方案 (§16 第 4 步)

### 4.1 方案对比

| 方案 | 描述 | 优点 | 缺点 | 推荐 |
|---|---|---|---|---|
| **A: 新增 resolveProjectLabel helper + projectList memo (现状 `631b7bd`)** | 把 active_root → name 解析放在组件 helper,page 派生 projectList 传入 | 最小变更;helper 纯函数易测试;legacy fallback 保留 | projects 数据来自 localStorage 'ccm.projects' — 与 store 同步性需关注 | ✅ 推荐 |
| **B: Rust 端 JOIN project 表** | `get_usage_history` 返回 SQL JOIN 后的 `project_name` 字段 | 数据源头解决,前端无需做映射 | 需改 Rust DTO + 多处 schema;现有过滤/排序逻辑要重审;动 Rust 风险 > 前端 | ❌ |
| **C: 改 back end 列名为 'token 消耗量'** | 列名/项目解析都用后端输出 | "数据契约唯一来源" | 列名是 UI 关注点,放后端让 DTO 多语言/多 label 变复杂 | ❌ |

### 4.2 推荐
**方案 A** — 已 ship (`631b7bd`);本验证仅做回归测试,不动源码。

### 4.3 风险评估
- **低**:helper 纯函数 + memo 派生,无副作用
- **回滚成本**: < 30 秒 (回滚 2 文件)

---

## 5. 修复后实际验证 (§16 第 5 步) — 硬证据

### 5.1 TDD RED 证据 (改前 FAIL — 5/7 fail)

**运行命令:**
```bash
./node_modules/.bin/vitest --run src/__tests__/pages/usage-history-columns.spec.tsx
```

**Pre-fix state (`a1b0d66`, `UsageHistoryTable.tsx` checkout 到 pre-631b7bd):**
```
✓ A8-4: 项目列显示 "—" 当 active_root 为 null        (this case also passes pre-fix because raw path is null → '—' too)
✓ A8-5: 项目列回退到 raw active_root 当 projects 列表为空 (legacy fallback — pre-fix also shows raw path)
× A8-1: 表头列名是 "token 消耗量"(不再是 "使用率")
    → Expected 'token 消耗量', got '使用率'
× A8-2: 项目列显示项目 name(active_root 命中 project.root_dir)
    → Expected 'My WinUI3 Project', got '/Users/foo/code/winui3'
× A8-3: 项目列显示 "全部"(active_root 不命中任何 project)
    → Expected '全部', got '/Users/orphaned/project'
× A8-6: 混合场景 — user 级 + project 级行并存
    → Expected '全部', got '/Users/orphan/path'
× A8-7: 表头包含 "项目" 列 + 6 列顺序
    → Expected 6th header 'token 消耗量', got '使用率'

Tests  5 failed | 2 passed (7)
```

**核心证据:** 5 个 case 精确指向 `631b7bd` 修复的两处变更 — 列名 + 项目名解析。

### 5.2 改后 GREEN (post-fix PASS — 7/7)

**Post-fix state (master `e69529b` 含 `631b7bd`):**
```bash
./node_modules/.bin/vitest --run src/__tests__/pages/usage-history-columns.spec.tsx
```
```
✓ A8-1: 表头列名是 "token 消耗量"(不再是 "使用率")
✓ A8-2: 项目列显示项目 name(active_root 命中 project.root_dir)
✓ A8-3: 项目列显示 "全部"(active_root 不命中任何 project)
✓ A8-4: 项目列显示 "—" 当 active_root 为 null
✓ A8-5: 项目列回退到 raw active_root 当 projects 列表为空 (legacy)
✓ A8-6: 混合场景 — user 级 + project 级行并存,各走各的 resolution 分支
✓ A8-7: 表头包含 "项目" 列 + 6 列顺序

Test Files  1 passed (1)
Tests  7 passed (7)
```

### 5.3 无回归证据

**完整 history suite:**
```bash
./node_modules/.bin/vitest --run src/__tests__/pages/history/
```
```
✓ src/__tests__/pages/history/index.test.tsx (21 tests) 183ms
Test Files  1 passed (1)
Tests       21 passed (21)
```

A8 fix 之前已 ship (`631b7bd`);本验证 commit 仅添加测试,不动 src/,所以现有 21 个 history 测试不受影响。

### 5.4 验证 checklist (per reverify §4 模板)

- [x] vitest 改前 FAIL (5 fail with clear messages pointing to root cause)
- [x] 修后 PASS (7/7 pass)
- [x] 完整 history suite 无回归 (21/21 pass)
- [x] 回归测试保留 (`src/__tests__/pages/usage-history-columns.spec.tsx`)
- [x] 关联 bug 同步验证 (无关联 — 此 fix 是 isolated)

---

## 6. 设计权衡 (测试架构)

### 6.1 测试覆盖矩阵

| 测试 | 类型 | 验证内容 | 防护 |
|---|---|---|---|
| A8-1 | 表头契约 | 表头含 'token 消耗量' + 不含 '使用率' | 防止 reintroduce 旧 label |
| A8-2 | 行为契约 | 命中 project → 显示 name (无 raw path) | `resolveProjectLabel` step 2 |
| A8-3 | 行为契约 | 不命中 → '全部' | `resolveProjectLabel` step 3 |
| A8-4 | 行为契约 | null active_root → '—' | `resolveProjectLabel` step 1 |
| A8-5 | 行为契约 | 空 projects → raw path (legacy) | `resolveProjectLabel` step 4 |
| A8-6 | 集成行为 | 混合行 (3 种状态) 并存 | per-row 而非全局解析 |
| A8-7 | 结构契约 | 完整 6 列顺序锁定 | 防止无意删除/重命名列 |

### 6.2 为什么走 `localStorage` + `HistoryPage` 而非直接调 helper

**问题:** `resolveProjectLabel` 是 module-private 函数,不导出。

**方案对比:**
- 方案 1 (选用): 通过 `HistoryPage` 渲染,把 helper 行为作为集成测试覆盖
  - 优点: 覆盖了 helper + `projectList` memo + `<td>` 渲染整条链
  - 缺点: 不能单独测 helper 边界
- 方案 2: 把 `resolveProjectLabel` 导出,在单测里直接调
  - 优点: 单测聚焦
  - 缺点: 改 export API 会扩大公开 surface;`631b7bd` fix 没改 export,本验证也不应擅自改

**决策:** 方案 1 — 保留 fix 现有 API,通过 `localStorage` 注入 project 数据走真实 React 渲染路径。

### 6.3 数据注入方式

`src/pages/history/index.tsx:96-126` 的 `useProjectOptions` hook 读 `window.localStorage.getItem('ccm.projects')`,所以测试在 `beforeEach` 清空 `localStorage`,在每个 case 内 `setItem(...)` 注入。这是 hook 的既定 contract,不是测试 hack。

---

## 7. Commits

### 7.1 本会话 commit
```
3d0185a verify(a8): history 列名 + 项目名回归测试
```

### 7.2 关联原始 fix (master)
```
631b7bd fix(history): rename '使用率' to 'token 消耗量' + show project name
```

### 7.3 Branch
- 分支: `worktree-agent-a939c1d871828c458`
- base: `a1b0d66` (sync: v3.4.4 WIP — pre-631b7bd)
- rebase: `git rebase master` 拉到 `e69529b` (master HEAD,含 `631b7bd` 与近期 VERIFICATION commits)
- 注: 工作树初始 base 不含 `631b7bd`,通过 rebase master 拉到 post-fix state → 测试直接 PASS,符合"verify 不 re-fix"原则

---

## 8. 结论

### 8.1 修复结论
- ✅ Bug 已修复 (`631b7bd` 在 master)
- ✅ 回归测试已建立 (7 tests,header contract + per-row resolution 全覆盖)
- ✅ 完整 history suite 无回归 (21/21 pass)
- ✅ 按 §16 五步流程完整执行,每步有硬证据 (TDD RED + GREEN)

### 8.2 后续建议
- 推荐合并 `worktree-agent-a939c1d871828c458` 上的 `3d0185a` 到 master
- 主 session cherry-pick 时,如 `src/pages/history/UsageHistoryTable.tsx` / `index.tsx` 有冲突,只 cherry-pick 测试 commit (`3d0185a`),源文件不动 — 跟 B8 模式一致
- §3.1 env var 系统性不一致 (清单 §3.1) 仍未解决,留作 A13 / 其他独立 bug 处理

---

## 9. 反事故 checklist (per CLAUDE.md §13.2 + §16.2)

- [x] **不算验证** 列表全避开:
  - ❌ 没只用 "build 通过" / "smoke PASS" / "启动没崩" 当完成证据
  - ❌ 没推断臆想修复结果
  - ❌ 没加 null guard 兜底
- [x] **才算验证** 硬证据齐:
  - ✅ vitest 改前 FAIL (5 fail with clear error messages)
  - ✅ vitest 改后 PASS (7/7)
  - ✅ 完整 history suite 无回归 (21/21)
  - ✅ 回归测试保留 codebase
- [x] **TDD 流程**: 写测试 → pre-fix 验证 FAIL → post-fix 验证 PASS (RED-GREEN)
- [x] **文件改动 ≤2**: 修复 2 文件 + 验证 1 新文件,符合 §2.4
- [x] **§17 隔离**: worktree 操作 + mid-task 只用 `vitest --run`,无 mid-task `cargo build` / `npm run build` / smoke test

---

**作者**: Claude Code (subagent verify-a8)
**日期**: 2026-06-30
**会话**: A8 重验证 (清单 §2 Round 3)