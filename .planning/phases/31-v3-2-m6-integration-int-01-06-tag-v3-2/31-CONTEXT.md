# Phase 31: v3.2 M6 整合验证 (INT-01~06) + tag v3.2 - Context

**Gathered:** 2026-06-27
**Status:** Ready for planning
**Mode:** Auto-generated (discuss skipped via workflow.skip_discuss)

<domain>
## Phase Boundary

v3.2 ship gate — 整合验证 subagent 跑全套测试 + rebuild + tag.

**Phase 31 真修清单（6 个 INT 任务）**：

| ID | 描述 | 工具 / 文件 |
|---|---|---|
| INT-01 | scripts/test-all.sh 6 阶段 PASS | scripts/test-all.sh |
| INT-02 | M4 e2e 15/15 场景回归 | tests/M4-e2e/ |
| INT-03 | vitest 全 PASS (含 v3.2 新增 ~50 测试) | npx vitest run |
| INT-04 | ClaudeManager.app rebuild + 装 + 启动 1 窗口 OK | scripts/build-and-ship.sh |
| INT-05 | STATE.md M6 完成段 + Recent Work + Decisions | .planning/STATE.md |
| INT-06 | git tag v3.2 + push | git tag / git push |

**注意 (macOS dev box 当前环境)**:
- 当前 OS: macOS 26 (Tahoe) — Apple Silicon
- macOS 跑 `cargo build --release` 用 apple-darwin clang
- smoke test 10 项中 Windows-only 项 (WebView2 child count) 在 macOS 上无等价,可用 `pmset` 或 AppleScript 检测 WKWebView 子进程
- M4 e2e 15/15: macOS 跑 m4-e2e 阶段需要 AppleScript + System Events (CLAUDE.md §15.9)

**In scope**:
- 跑 test-all 6 stages 全 PASS
- 跑 vitest 全 PASS
- 跑 M4 e2e 15/15
- ClaudeManager.app rebuild + 装 + 启动 1 窗口
- STATE.md 写 M6 完成段
- git tag v3.2 + push (如可)

**Out of scope**:
- 不做新的功能开发
- 不改 system identifier (CLAUDE.md §6.5)
- macOS smoke test 限制已记录 (CLAUDE.md §15.4 + §13.1)

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
所有实现选择由 Claude 自行决定 — discuss 阶段被用户选择跳过。遵循 ROADMAP phase 目标、成功准则、现有 codebase 约定。

**关键约束（从 CLAUDE.md + 现有 patterns 推导）**：
- test-all 6 stages 全 PASS (CLAUDE.md §13.1)
- 零新依赖 (CLAUDE.md §2.3)
- 不动版本号 (CLAUDE.md §2.3)
- macOS 真机验证 (D6) 已落地 — 当前 dev box 是 macOS
- smoke test 10 项中 Windows-only 项 在 macOS 跑时用等价 AppleScript/pmset 检测

</decisions>