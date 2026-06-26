---
phase: 26
name: M5 A 类 5 bug + 整合验证 (Phase 4)
status: ready-for-planning
mode: autonomous
gathered: 2026-06-26
source: M5-ANALYSIS + Phase 25 verification
---

# Phase 26: M5 A 类 5 + 整合验证 — Context

**Gathered:** 2026-06-26
**Status:** Ready for planning
**Mode:** Autonomous (用户授权)

<domain>
## Phase Boundary

**M5-PLAN §4 Phase 4 A 类 5 + 整合验证**

**Pre-check (git log — 全 ship)**:

| # | bug | Git status |
|---|---|---|
| 1  | 二次元主题 header 菜单 | ✅ ship `aae1ad8` fix(design-system): anime header chip |
| 5  | Default Model 改 | ✅ ship `50d364a` fix(ui): Default Model label |
| 14 | formatChineseTokenCount 1亿 | ✅ ship `9f116eb` fix(usage-query): tokens_used 亿 |
| 20 | 重新扫描按钮宽度 | ✅ ship `959bd80` fix(ui): 重新扫描按钮 min-width |
| 32 | 关于页项目主页独立 | ✅ ship `4f0bc0c` fix(about): 项目主页单独一行 |

**Phase 26 实际工作**:
- T1 verify-5-shipping: 验证 5 A 类 fix commit
- T2 整合验证: 跑 scripts/test-all.sh 6 阶段全过
- T3 重新 build ClaudeManager.app (macOS)
- T4 STATE.md 写 M5 完成
- T5 tag v3.0.1

</domain>

<decisions>
## Implementation Decisions

### Q-RENAME (用户授权 Claude's Discretion 拍 v3.0.1)

**Tag = v3.0.1** (Phase 23 CONTEXT.md 已拍,Q-RENAME=B):
- 33 bug 是 minor fix (30/33 user-facing 改进)
- v3.1 留给 v3.0 round 4+ 的功能 milestone
- 用户可后续 bump

### 整合验证清单

- test-all 6 阶段全 PASS
- ClaudeManager.app 重新 build + 装
- 启动 1 窗口 OK
- 33 bug 报告步骤全手测
- 写进 STATE.md "M5 完成" 段
- tag v3.0.1

</decisions>

<code_context>
## Existing Code Insights

### 5 A 类 fix commit (全 ship)
- `aae1ad8` fix(design-system): anime 主题 header 菜单名字加独立背景色 chip (#1)
- `50d364a` fix(ui): Default Model label 去掉 "(ANTHROPIC_MODEL)" 后缀 (#5)
- `9f116eb` fix(usage-query): tokens_used >= 1亿 显示 "X 亿 Y 万" (#14)
- `959bd80` fix(ui): 重新扫描按钮 min-width + nowrap 防止文字换行 (#20)
- `4f0bc0c` fix(about): 项目主页单独一行展示 (#32)

### 整合验证工具
- `scripts/test-all.sh` (6 阶段)
- `scripts/build-mac.sh --no-bundle` (重新 build .app)
- `scripts/install-to-applications-mac.sh` (装到 /Applications)
- `git tag -a v3.0.1 -m "..."`
</code_context>

<specifics>
## Specific Ideas

### Phase 26 ship gate (= M5 ship)

- [ ] 5 A 类 fix commit 验证
- [ ] test-all 6 阶段全 PASS
- [ ] ClaudeManager.app 重新 build OK
- [ ] /Applications/ClaudeManager.app 启动 1 窗口 OK
- [ ] 33 bug 报告步骤全手测 (or via M4 e2e 替代)
- [ ] STATE.md 写 "M5 完成" 段
- [ ] tag v3.0.1

### 子任务拆分 (T1-T5)

- T1 verify-5-shipping: git show 5 commit
- T2 跑 test-all 6 阶段
- T3 rebuild .app (macOS)
- T4 启动 .app 验证 1 窗口 OK
- T5 STATE.md + tag v3.0.1
</specifics>

<deferred>
## Deferred Ideas

- **M6 候选** — 性能基准 / tauri-driver macOS 支持 / pixel diff / F8/F18/F23/F20 e2e 覆盖
- **M4 fixture 隔离 (`CCM_TEST_HOME`)** — 已 ship (`52b57d9`)
- **v3.1+** — 留给后续 milestone

</deferred>

---

*Refs: M5-PLAN.md §4 + M5-ANALYSIS.md + 23/24/25 VERIFICATION.md (前 3 phase ship 状态).*
