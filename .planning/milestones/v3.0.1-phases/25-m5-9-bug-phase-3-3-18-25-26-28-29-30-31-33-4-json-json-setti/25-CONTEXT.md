---
phase: 25
name: M5 重构 9 bug (Phase 3)
status: ready-for-planning
mode: autonomous (Claude's Discretion on 5 开放问题)
gathered: 2026-06-26
source: M5-ANALYSIS + Phase 24 verification
---

# Phase 25: M5 重构 9 bug — Context

**Gathered:** 2026-06-26
**Status:** Ready for planning
**Mode:** Autonomous (用户授权 Claude's Discretion on 5 开放问题)

<domain>
## Phase Boundary

**M5-PLAN §4 Phase 3 重构 9 bug**

**Pre-check (git log)**:

| # | bug | Git status |
|---|---|---|
| 3  | 欢迎页新增项目改弹窗 | ✅ ship `5b9d512` fix(home): render 新增项目 as modal |
| 18 | 删单文件部署 | ❌ **NOT ship** — `src/pages/single-file-deploy/index.tsx` 仍在 + sidebar 仍引用 |
| 25 | 第三方仓库功能 | ✅ ship `f1a5cf8` fix(marketplace): explain third-party repo |
| 26 | 手动处理可勾选 | ✅ ship `cbc8ff5` fix(optimizer): disable checkbox for manual |
| 28 | 手动处理出 JSON 编辑 | ✅ ship `b3a7122` fix(optimizer): manual findings jump to JSON |
| 29 | 备份分页多选 | ✅ ship `2dbebdc` fix(backup-restore): paginate + multi-select |
| 30 | 备份不删 | ✅ ship `b30c67f` fix(backup-restore): restore must keep entry |
| 31 | 历史分页 | ✅ ship `dc1fa27` fix(history): paginate all 3 tables |
| 33 | JSON 编辑器搜 settings.json | ✅ ship `a17c22b` fix(json-editor): broaden file-tree search |

**Phase 25 实际工作**:
- T1 verify-8-shipping: 验证 8 个已 ship fix commit
- T2 fix #18: 删单文件部署 4 处同步 (前端 page + sidebar menu + IPC + capability, §6.4 强调)
- T3 test: 1 个新 vitest 验证 single-file-deploy 完全无引用
- T4 manual: macOS 真机 (M4 e2e 替代)

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion (用户授权)

延续 phase 23-24 决策:
- Q5: critical 优先 (phase 25 全 8 已 ship, 剩 #18)
- #12 / #23-24 / #25: 已拍 (见 phase 23)
- Q-RENAME: v3.0.1

### 关键约束 (CLAUDE.md §6.4)

**#18 删单文件部署 4 处同步**:
1. `src/pages/single-file-deploy/index.tsx` — 删整页
2. `src/components/AppSidebar.tsx` — 删 menu entry (line 80 'single-file-deploy')
3. `src-tauri/src/commands/single-file-deploy.rs` (估) — 删 IPC command
4. `src-tauri/capabilities/*.json` — 删 capability grant
+ 1 个新 vitest 验证"grep 全局无 'single-file-deploy' 引用"
+ 1 个 grep 全局确认无引用 (Phase 25 ship gate)

### 修法分层

```
#18 删 4 处 → commit "refactor(ui): delete single-file-deploy feature (#18)"
```

</decisions>

<code_context>
## Existing Code Insights

### 关键文件位置

**#18 删单文件部署**:
- `src/pages/single-file-deploy/index.tsx` (估 50 行, 待删)
- `src/components/AppSidebar.tsx:80` — 'single-file-deploy': { ... } menu entry
- `src-tauri/src/commands/single-file-deploy.rs` (估)
- `src-tauri/capabilities/default.json` (估) — capability grant
- `src/App.tsx` (估) — 路由配置

### 4 处同步 + 全局 grep 验证

CLAUDE.md §6.4 强调 "4 处同步" — 漏 1 处就死代码/死路由。

</code_context>

<specifics>
## Specific Ideas

### Phase 25 ship gate

- [ ] 8 已 ship bug 验证 commit
- [ ] #18 删 4 处同步 (page + sidebar + IPC + capability)
- [ ] grep 全局 'single-file-deploy' 无引用
- [ ] 1 个新 vitest 验证无引用
- [ ] test-all 5 阶段仍全 PASS
- [ ] macOS 真机 (M4 e2e 替代)

### 子任务拆分 (T1-T4)

- **T1 verify-8-shipping**: git show 8 commit
- **T2 fix #18**: 4 处同步删 + 1 grep verify
- **T3 test-verify**: 跑 vitest 全过 (1 新 + 现有 556)
- **T4 macOS-smoke**: M4 e2e 替代

</specifics>

<deferred>
## Deferred Ideas

- **A 类 5 bug** (#1 #5 #14 #20 #32) → Phase 26 — 全 ship
- **Phase 26 整合验证** — test-all + ClaudeManager.app rebuild + STATE.md + tag v3.0.1

</deferred>

---

*Refs: M5-PLAN.md §4 + M5-ANALYSIS.md + 24-VERIFICATION.md (phase 24 ship 状态).*
