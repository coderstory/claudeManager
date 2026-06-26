# Phase 28: v3.2 M6 业务 13 bug 修复 - Context

**Gathered:** 2026-06-27
**Status:** Ready for planning
**Mode:** Auto-generated (discuss skipped via workflow.skip_discuss)

<domain>
## Phase Boundary

修 v3.0.1 M5 ship 后用户实测 ClaudeManager.app 发现的 13 个业务 bug（其中 7 个真修、6 个留空待 v3.2.1 用户实测后补）。所有 fix 加 vitest。沿用 M5-PLAN §5 模式，5 subagent 实施 + 8 原 commit 验证。

**Phase 28 真修清单（7 个）**：

| Fix | slotID | 简述 | 严重度 | 模块 |
|---|---|---|---|---|
| 1 | BUG-BZ-01 | SQL parser 过滤 invalid rows + dry-run 预览显示 skip count | 业务 | F3 SQL 导入 |
| 2 | BUG-BZ-02 | JSON 编辑器全屏 mode toggle（撑满 app 窗口 + ESC 退出） | 业务 | F5 JSON 编辑器 |
| 3 | BUG-BZ-03 | JSON 文件树渲染 `~/.claude/` 用户级 + active_root 项目级（递归 ≤5、白名单 root） | 业务 | F5 + ResourceBrowser |
| 4 | BUG-BZ-04 | MCP 文案恢复"粘贴 ccswitch:// 自动解析填表"提示（不是旧版"导入 JSON"） | 业务 | F6/F16 MCP 管理页 |
| 5 | BUG-BZ-05 | 用量趋势 7 天聚合窗口（sparkline 7 个点，daily 聚合） | 业务 | F7 用量 |
| 6 | BUG-BZ-06 | 资源市场 browse URL 修正（GitHub 仓库正确 URL，不是 cc-switch-main 旧路径） | 业务 | F17 marketplace |
| 7 | BUG-BZ-07 | CliNotFound 4 类错误本地化（启动 / git / install / scan） | 业务 | F17 + F18 marketplace + optimizer |

**留空（6 个）**：BUG-BZ-08~13 推到 v3.2.1 用户实测后补（per ROADMAP §"Plans" 第 2 段）。

**In scope**:
- 7 个真修 fix 各加 ≥1 vitest
- dry-run 预览 skip count 显示
- 全屏 mode UI（按钮 + ESC handler）
- 文件树递归 + 白名单
- 文案恢复
- 用量 7 天窗口 daily 聚合
- marketplace browse URL 修正
- CliNotFound 4 类错误本地化（zh-CN）

**Out of scope**:
- BUG-BZ-08~13（v3.2.1 backlog）
- 不动 F2 switch atomic / F13 backup / sqlite read / F18 finding 过期（CLAUDE.md v3.2.1 backlog）
- 不改 schema / 不改 IPC command 签名（如需改 = v3.2.1 评估）

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
所有实现选择由 Claude 自行决定 — discuss 阶段被用户选择跳过。遵循 ROADMAP phase 目标、成功准则、现有 codebase 约定。

**关键约束（从 CLAUDE.md + 现有 patterns 推导）**：
- 测试先行 TDD（CLAUDE.md §2.2）：每个 fix 先写 failing test，再写最小实现
- 零新依赖（CLAUDE.md §2.3）：必须用 React 19 内置 + Tauri 已有 API
- 不动版本号（CLAUDE.md §2.3）
- 不静默吞错（CLAUDE.md §7）：fix 1 invalid rows 必须显式 skip count
- 全屏/退出全屏走 React state + useEffect 监听 keydown ESC（CLAUDE.md §3.1 OS 抽象层不进业务代码）
- marketplace URL 改自 hash 常量（CLAUDE.md §2.4 — 不动 SPEC.md，URL 是代码常量）
- CliNotFound 本地化字符串在 `src/lib/errors.ts` 集中管理（沿用项目 error 集中化 pattern）

</decisions>

