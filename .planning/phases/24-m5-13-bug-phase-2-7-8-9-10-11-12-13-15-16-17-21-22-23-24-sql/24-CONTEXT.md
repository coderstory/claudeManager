---
phase: 24
name: M5 业务修复 13 bug (Phase 2)
status: ready-for-planning
mode: autonomous (Claude's Discretion on 5 开放问题)
gathered: 2026-06-26
source: .planning/phases/M5-bug-fixes/M5-ANALYSIS.md + Phase 23 verification
---

# Phase 24: M5 业务修复 13 bug — Context

**Gathered:** 2026-06-26
**Status:** Ready for planning
**Mode:** Autonomous (用户授权 Claude's Discretion on 5 开放问题)

<domain>
## Phase Boundary

**M5-PLAN §4 Phase 2 业务修复 13 bug**

**Pre-check (M5 实际 git log 状态 — 30/33 bug 已 ship)**:

| # | bug | Git status | 来源 |
|---|---|---|---|
| 7 | SQL 导入缺过滤/重复/复选框 | ✅ ship | `530d734` fix(sql-import): validate + dedup |
| 8 | SQL 跳过显示名字 | ✅ ship | `8c3853a` fix(sql-import): SkippedLine carries name |
| 9 | JSON 编辑器全屏 | ✅ ship | `09804d2` fix(json-editor): fullscreen toggle |
| 10 | JSON 目录树文件夹名 | ✅ ship | `34be409` fix(json-tree): render folder headers |
| 11 | MCP 切项目级文案 | ✅ ship | `b858427` fix(mcp): path label scope |
| 12 | MCP 剪贴板 JSON vs URL | ✅ ship | `ca433d7` fix(mcp): smart-detect JSON vs ccswitch |
| 13 | MCP ccswitch 文案 | ✅ ship | `63d5a68` fix(mcp): remove ccswitch hint |
| 15 | 删用量余额/费用 | ✅ ship | `420edee` fix(usage): drop balance/cost |
| 16 | 用量趋势 7 天 | ✅ ship | `ec83879` fix(usage): 7-day trend |
| 17 | CACHE CREATE 列 | ✅ ship | `4810fba` fix(usage): drop Cache Create column |
| 21 | plugins 解析外层目录 | ✅ ship | `5b4c1d5` test(resource): pin plugin scan |
| 22 | 资源市场浏览 URL | ❌ **NOT ship** | (没找到对应 fix commit) |
| 23 | npx git error 错位 | ❌ **NOT ship** | `MarketplaceError::Git` 仍被使用 |
| 24 | claude CLI git error 错位 | ❌ **NOT ship** | 同 #23 (同根因) |

**Phase 24 实际工作**:
- T1 verify-12-shipping: 验证 12 个已 ship fix commit (类比 phase 23 T1)
- T2 fix #22: 资源市场"浏览资源"按钮 onClick 调 `opener.openUrl(repo.url)` 打开 git URL
- T3 fix #23+#24: 加 `MarketplaceError::CliNotFound { cmd: String }` variant, npx/claude spawn failure 改走 CliNotFound
- T4 test: 3 个新 vitest (12 已 ship 回归 test + 1 CliNotFound + 1 browse URL)
- T5 manual: macOS 真机 (M4 e2e 替代)

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion (用户授权)

5 开放问题已 phase 23 拍板 (见 23-CONTEXT.md):
- Q5 修法: critical 优先
- #12: 改代码 import JSON (smart-detect — 同时 #12 + #13 修)
- #23-24: 加 CliNotFound variant
- #25: 保留 + 改文案
- Q-RENAME: v3.0.1

### 关键约束 (CLAUDE.md)

- §2.3 不加新依赖 — 现有 dep 解决
- §2.5 视觉一致性 — #9 JSON 全屏复制 backup-restore 实现,保持一致
- §6.4 文案同步 — Phase 24 不涉及文案修改 (无新增文案)
- §5 TDD — 每个 fix 1 个新 vitest

### 修法分层

```
#22 改 frontend button onClick → fix(frontend)
#23 #24 加 enum variant + 改 spawn 错误路径 → fix(rust)
```

</decisions>

<code_context>
## Existing Code Insights

### 关键文件位置

**#22 浏览资源 URL**:
- `src/pages/marketplace/index.tsx` — 资源市场 UI
- `src-tauri/src/commands/marketplace.rs` — IPC commands
- 候选库: `@tauri-apps/plugin-opener` (已 ship, v3.0) 或 tauri shell

**#23 #24 CliNotFound variant**:
- `src-tauri/src/services/marketplace_service.rs:165-184` — `MarketplaceError` enum
- `src-tauri/src/services/marketplace_service.rs:534-540` — `claude` CLI spawn (line 534)
- `src-tauri/src/services/marketplace_service.rs:645-652` — `npx` spawn (估)

### 测试基础设施

- vitest 现有 555 tests
- 单元测试 in `src/__tests__/`
- e2e 14 场景 (M4-e2e) — 可能需要新增 #22 #23 #24 场景

</code_context>

<specifics>
## Specific Ideas

### Phase 24 ship gate

- [ ] 12 已 ship bug 验证 commit
- [ ] #22 浏览 URL fix + 1 新 vitest
- [ ] #23 #24 CliNotFound variant + 2 新 vitest + 改 2 处 spawn
- [ ] test-all 5 阶段全 PASS (M4 e2e 仍 15/15)
- [ ] macOS 真机 (D6 deferred → via M4 e2e)

### 子任务拆分 (T1-T5)

- **T1 verify-12-shipping**: git show 12 commit (类 phase 23 T1)
- **T2 fix #22**: `src/pages/marketplace/index.tsx` "浏览资源" button onClick → `opener.openUrl(repo.url)` (or `shell.open`)
- **T3 fix #23+#24**: 加 `MarketplaceError::CliNotFound { cmd: String }`,改 2 处 spawn (claude:534, npx:645) + 2 个新 vitest
- **T4 test-verify**: 跑 vitest + cargo test 全过 (3 新 vitest + 555 现有)
- **T5 macOS-smoke**: M4 e2e 替代 (deferred per D6)

</specifics>

<deferred>
## Deferred Ideas

- **C 类 9 bug** (#3 #18 #25 #26 #28 #29 #30 #31 #33) → Phase 25 — 8 ship, 剩 #18
- **A 类 5 bug** (#1 #5 #14 #20 #32) → Phase 26 — 全 ship
- **Phase 26 整合验证** — test-all + ClaudeManager.app rebuild + STATE.md + tag v3.0.1
- **M4 fixture 隔离 (CCM_TEST_HOME)** — 已 ship (`52b57d9`)

</deferred>

---

*Refs: M5-PLAN.md §4 + M5-ANALYSIS.md + 23-VERIFICATION.md (phase 23 ship 状态).*
