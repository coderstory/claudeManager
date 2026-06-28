# Phase 46 STATE — WAITING_PHASE_44_45

> **状态**: WAITING_PHASE_44_45 (阻塞)
> **记录时间**: 2026-06-28
> **记录人**: Phase 46 execute subagent
> **下一步**: 等 Phase 44 subagent + Phase 45 subagent ship 后重新调度启动

---

## 7. 🟡 PARTIAL UNBLOCK 信号 (orchestrator 追加 2026-06-28 15:17)

Phase 44 已 ship:
- `.planning/milestones/v3.4-phases/44-EXECUTE-REPORT.md` 存在 ✅
- 5 commits: 0d9e31b / fb1a0e1 / 8110afd / 26a37f5 / ea474d9
- 强验收 4/4 grep PASS (useViewState/App/AppSidebar 0 行硬编码)
- `src/plugins/registry.ts` 5 派生导出就位 (ALL_VIEW_IDS / ALL_VIEWS_ORDERED / PAGE_META / VIEW_META / VIEW_COMPONENTS)
- `SidebarTile.migrateFrom` 字段已就位 (resource-browser 已填示例)
- ⚠️ 视觉矩阵 25/60 baseline (macOS dev-server 缺 IPC,6 view 30s timeout,Phase 47 Windows tauri-driver 重生成)

Phase 43 已 ship (见 45-STATE.md §7) — 间接 unblock Phase 46 (PluginContext 4 字段就位)

**Phase 46 仍 WAITING_PHASE_45** — D-44-A mcp-management stub 删 + VIEW_ID_MIGRATIONS 派生这两个动作需要 Phase 45 完成后 (AppState plugin 化后) 才能确认无 impact

**重启条件**: Phase 45-EXECUTE-REPORT.md 出现 + git log 出现 phase 45 commits

---

## 0. 上下文

- 任务: Phase 46 — stale-route 清理 (VIEW_ID_MIGRATIONS + 删 mcp-management stub)
- 任务启动时间: 2026-06-28 (per 主 session 简化版 prompt)
- 当前 Phase 进度: 42 ✅ DONE | 43 🟡 EXEC (a10697b984d6c07fa 跑 12:32 上次 commit, 1.5h+ 等候中) | 44 ⏸️ | 45 ⏸️ | **46 ⏸️ WAITING** | 47 ⏸️
- 本子任务决策: **WAITING** (Phase 44 + 45 都没 ship, 不硬撑)

---

## 1. 阻塞原因 (Phase 44 + 45 依赖)

Phase 46-PLAN.md §0.1 DRIFT 警告明确指出:
> 截至 2026-06-27 23:55 plan-phase 启动时,**Phase 44 派生收敛尚未 ship**

Phase 46 强验收 #1 (46-PLAN §1):
> `useViewState.tsx` 有 `VIEW_ID_MIGRATIONS` Map (Phase 46 硬编码 1 项,Phase 47 二次重构为派生) + `migrateViewId` 递归 + `ReadInitialViewResult` exported interface

**关键路径**:
- Phase 44 派生收敛 (`ALL_VIEW_META` / `SidebarTile.migrateFrom`) ship 后, Phase 46 可直接派生 `VIEW_ID_MIGRATIONS`
- Phase 44 未 ship 时, Phase 46 必须硬编码 Map (PLAN §0.1 显式接受 trade-off)
- Phase 45 ship 后, Phase 46 PluginContext 4 字段 (app + paths + host + services) 就位, 全 plugin 注册路径稳定
- 缺 Phase 44: Phase 46 强验收只能走硬编码路径
- 缺 Phase 45: Phase 46 PluginContext 不可用 (虽然 Phase 46 自己代码不直接用 PluginContext, 但 Phase 47 整合测试需要)

**结论**: Phase 46 scope 自包含 (硬编码 Map), 理论上不等 Phase 45 也能开工。
但简化版 prompt 明确要求 "如果 Phase 44 或 45 还没 ship, Write STATE.md 等候然后退出" → **遵循 orchestrator 节奏**, 等 Phase 44 + 45 都 ship 再启动。

---

## 2. Phase 42 ship 状态 (✅ DONE, Phase 46 强验收 #8 准备就绪)

```bash
# plugin-registry.test.ts 9 stub 仍在 (Phase 46 改为 8)
$ grep -n "ALL_PLUGINS.length" src/__tests__/plugin-registry.test.ts
expect(ALL_PLUGINS.length).toBe(9)
# Phase 46 Task 7 改为 8
```

**Phase 46 强验收 #8 已就绪**: 9 stub 计数可独立 verify, Phase 46 Task 7 改 1 行 (9→8) 即 ship。

---

## 3. Phase 46 PLAN 已读完 (1201 行, 7 task, 3 wave)

**PLAN 文件**: `/Users/coderstory/CodeSource/winui3/.planning/milestones/v3.4-phases/46-PLAN.md`
**DECISIONS 文件**: `/Users/coderstory/CodeSource/winui3/.planning/milestones/v3.4-phases/46-DECISIONS.md` (Q46-1 ~ Q46-5 全关闭)
**RESEARCH 文件**: `/Users/coderstory/CodeSource/winui3/.planning/milestones/v3.4-phases/46-RESEARCH.md`

### 3.1 已记下的 7 个 Task (按 Wave 0/1/2 顺序)

| Wave | Task | 估时 | 状态 |
|---|---|---|---|
| 0 | Task 1 — TDD scaffold (6 单测先写, useViewState.test.tsx Phase 46 describe) | 0.3 天 | ⏸️ 待 Phase 44 |
| 1 | Task 2 — VIEW_ID_MIGRATIONS Map 硬编码 + migrateViewId 递归 (cycle/深度/unknown/dev warn) | 0.2 天 | ⏸️ 待 Phase 44 |
| 1 | Task 3 — readInitialView 返回 `{ view, search? }` + `ReadInitialViewResult` interface | 0.1 天 | ⏸️ 待 Phase 44 |
| 1 | Task 4 — ViewStateProvider mount-time dispatch + migrationSearch context (Q46-4 mount 锁死) | 0.2 天 | ⏸️ 待 Phase 44 |
| 2 | Task 5 — ResourceBrowser 双源优先级 (migrationSearch?.tab > URL > 默认 'plugin') + test 改写 | 0.2 天 | ⏸️ 待 Phase 44 |
| 2 | Task 6 — App.tsx 删 useEffect (174-197) + import STORAGE_KEY 清理 | 0.1 天 | ⏸️ 待 Phase 44 |
| 2 | Task 7 — 删 mcp-management stub (前后端 + 注释 + plugin-registry 9→8) | 0.3 天 | ⏸️ 待 Phase 44 |

### 3.2 Phase 46 强验收清单 (PLAN §1, 14 项, Phase 47 验证)

- [ ] **强验收 #1**: `useViewState.tsx` 有 `VIEW_ID_MIGRATIONS` Map + `migrateViewId` + `ReadInitialViewResult`
- [ ] **强验收 #2**: `migrateViewId` 递归 (cycle 检测 visited Set + 深度上限 5 + unknown → home + dev mode console.warn)
- [ ] **强验收 #3**: `appendQuery` 链式时取第一跳 (Q46-2)
- [ ] **强验收 #4**: `ViewStateProvider` 暴露 `migrationSearch` (mount-time useMemo 锁死)
- [ ] **强验收 #5**: `ResourceBrowser` 双源优先级 (`migrationSearch?.tab` > URL `?tab=` > 默认 `'plugin'`)
- [ ] **强验收 #6**: `App.tsx` 删 useEffect 整段 (174-197) + 移除 STORAGE_KEY import (grep lint 验证)
- [ ] **强验收 #7**: 删 mcp-management stub 4 文件 (`stubs/mcp-management.tsx` + `stubs/mod.ts:12` + `registry.ts:23,40` + 注释清理)
- [ ] **强验收 #8**: `plugin-registry.test.ts` 断言 9 → 8
- [ ] **强验收 #9**: `useViewState.test.tsx` 新增 6 单测 (Phase 46 describe)
- [ ] **强验收 #10**: `resource-browser.test.tsx` 改写 (注入 migrationSearch → default kind = 'mcp')
- [ ] **强验收 #11**: 升级路径打通 (v3.2 user localStorage='mcp-management' → v3.4 启动 → URL ?tab=mcp + view=resource-browser)
- [ ] **强验收 #12**: 后端 stub 同步删 (`src-tauri/src/plugins/stubs/mcp_management.rs` + `stubs/mod.rs:6` + `mod.rs:18-20` 注释清理)
- [ ] **强验收 #13**: "删 1 view 改 5 文件" (Phase 46 scope 锁定)
- [ ] **强验收 #14**: `ALL_VIEWS` 仍 11 项 (Phase 46 不动, Phase 44 派生后再减)

### 3.3 Phase 46 已知风险 (PLAN §0.1 DRIFT 警告 + §3 实施要点)

| # | 风险 | 缓解 |
|---|---|---|
| R1 | Phase 44 派生收敛未 ship → 强行 import 会 TS2305 编译失败 | PLAN §0.1 接受硬编码 1 项 trade-off, Phase 47 二次重构 |
| R2 | 硬编码 Map 后续 Phase 44 ship 后重构成本 | Phase 47 删 1 项硬编码 → migrateFrom 派生, 工作量 < 0.1 天 |
| R3 | migrateViewId 递归 cycle 检测 | visited Set + MAX_MIGRATION_DEPTH=5 + 兜底 home |
| R4 | migrationSearch mount-time 锁死 vs 用户切换 tab 状态 | Q46-4 决策: mount 一次性, 用户切 tab 后 URL 不清 (保留 ?tab=mcp 作会话状态) |
| R5 | unknown stale view fallback home | Q46-1 处理, dev mode warn |
| R6 | 删 1 view 涉及 5 文件 (违反 §2.4 边界纪律) | PLAN §1 强验收 #13 显式接受 (D-44-A 责任) |
| R7 | 6 单测 TDD scaffold 红 → 绿顺序 | Task 1 先红 (不实现), Task 2-4 绿, Task 5 ResourceBrowser 注入测试绿 |

---

## 4. 重新启动条件

Phase 44 + 45 ship 信号 (任一即可):

1. `.planning/milestones/v3.4-phases/44-EXECUTE-REPORT.md` 存在 (Phase 44 ship)
2. `.planning/milestones/v3.4-phases/45-EXECUTE-REPORT.md` 存在 (Phase 45 ship)
3. `git log --grep="phase 44"` 或 `git log --grep="Phase 44"` 出现新 commit
4. `git log --grep="phase 45"` 或 `git log --grep="Phase 45"` 出现新 commit
5. 主 session 显式调起 Phase 46 subagent (带 "Phase 44+45 已 ship" 提示)

**主 session 应做的事**:
- 监控 Phase 43 subagent 完成 (12:32 后无 commit, 持续监控)
- Phase 43 ship → 启动 Phase 44 (frontend MenuRegistry) + Phase 45 (backend AppState plugin 化) 并行
- Phase 44 + 45 都 ship → 重新调起 Phase 46 subagent, 带 "Phase 44+45 已 ship" 提示
- 调度 Phase 47 整合 + tag v3.4.0

---

## 5. 临时未 commit 文件

```bash
$ git status
On branch master
Your branch is ahead of 'origin/master' by 18 commits.

Changes not staged for commit:
	modified:   src-tauri/src/plugins/mod.rs

Untracked files:
	.planning/milestones/v3.4-phases/45-STATE.md
	.planning/milestones/v3.4-phases/ORCHESTRATOR-STATUS.md
	.planning/milestones/v3.4-phases/46-STATE.md       # 本文件
	src-tauri/src/plugins/menu_registry.rs
```

- 本 subagent 未做任何代码改动 (0 commit, 0 文件修改, 只 Write 46-STATE.md)
- 46-STATE.md 是 orchestrator 维护状态文件, 主 session 可选择性 commit (跟 45-STATE.md 同模式)
- 现有 modified `src-tauri/src/plugins/mod.rs` + untracked `menu_registry.rs` 是 Phase 43 subagent 在跑的工作
- 工作树干净 (相对于 Phase 42 12e4e68) + Phase 43 WIP

---

## 6. 给主 session 的报告 (concise)

**Phase 46 启动: WAITING**

- Phase 42 ship 已 verify (9 stub 计数可独立 verify, Phase 46 Task 7 改 1 行即 ship)
- **Phase 44 NOT ship** — 派生收敛 (ALL_VIEW_META / SidebarTile.migrateFrom) 尚未实现, Phase 46 强验收 #1 必须走硬编码 1 项路径
- **Phase 45 NOT ship** — PluginContext 4 字段未就位, Phase 47 整合测试有依赖
- Phase 46 PLAN 已读完 (1201 行, 7 task / 3 wave 清晰, 14 项强验收)
- Phase 46 决策: 不硬撑, 不混改 Phase 44 派生收敛 (违反 §2.4 边界纪律)
- 简化版 prompt 显式要求 "如果 Phase 44 或 45 还没 ship, Write STATE.md 等候然后退出" → 已遵循
- 建议: 主 session 持续监控 Phase 43, ship 后并行调起 Phase 44 + 45, 双双 ship 后调起本 subagent

**重新启动时主 session 应发**:
```
Phase 44 + 45 已 ship (.planning/milestones/v3.4-phases/44-EXECUTE-REPORT.md + 45-EXECUTE-REPORT.md 存在),
启动 Phase 46 subagent。读 STATE.md WAITING_PHASE_44_45 段,接着执行 46-PLAN.md 7 task。
```

---

*STATE.md 结束。Phase 44 + 45 ship 后本 subagent 重新启动, 接着 STATE.md §3.1 7 task 清单按 Wave 0/1/2 顺序执行。*