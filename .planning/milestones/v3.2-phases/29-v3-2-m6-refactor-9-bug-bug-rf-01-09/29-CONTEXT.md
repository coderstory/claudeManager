# Phase 29: v3.2 M6 重构 9 bug 修复 - Context

**Gathered:** 2026-06-27
**Status:** Ready for planning
**Mode:** Auto-generated (discuss skipped via workflow.skip_discuss)

<domain>
## Phase Boundary

修 v3.0.1 M5 ship 后用户实测 ClaudeManager.app 发现的 9 个重构类 bug。每个 fix 加 ≥1 vitest。沿用 M5-PLAN §6 模式。

**Phase 29 真修清单（9 个 fix）**：

| Fix | slotID | 简述 | 模块 | 关键文件 (估计) |
|---|---|---|---|---|
| 1 | BUG-RF-01 | 欢迎页弹窗时序修正（等 sqlite ready 之后再弹） | App 启动流程 | src/App.tsx, src/components/WelcomeModal.tsx |
| 2 | BUG-RF-02 | M5 #18 单文件部署删除保持（regression check） | F8 单文件部署 | src/__tests__/ (verify M5 #18 not re-added) |
| 3 | BUG-RF-03 | F17 第三方仓库 tab 文案 + 警告语 | F17 marketplace | src/pages/marketplace/index.tsx, src-tauri/src/services/marketplace_service.rs |
| 4 | BUG-RF-04 | 手动处理 checkbox 三态（none/partial/all） | F13 备份 | src/pages/backup/index.tsx (or similar) |
| 5 | BUG-RF-05 | 手动出 JSON 编辑入口（跳 /json-editor 并预填） | F13 + F5 | src/pages/backup/index.tsx + 路由 |
| 6 | BUG-RF-06 | F13 备份分页 (20/page) + 翻页 + 多选 | F13 备份 | src/pages/backup/index.tsx, src-tauri/src/services/backup_service.rs |
| 7 | BUG-RF-07 | 备份删除走 trash + 二次确认 modal | F13 备份 + 文件管理 | src-tauri/src/services/backup_service.rs (delete to trash), src/components/ConfirmDialog.tsx |
| 8 | BUG-RF-08 | history page cursor-based 分页 | F19 备份与恢复 / history | src/pages/history/index.tsx, src-tauri/src/services/history_service.rs |
| 9 | BUG-RF-09 | JSON 搜 settings 路径（定位 settings.json 不是 ~/.claude/） | F5 JSON 编辑器 | src/pages/json-editor/index.tsx (search logic) |

**In scope**:
- 9 个 fix 各加 ≥1 vitest
- 9 个 fix 加 atomic commit (test+fix pair)
- 1 docs commit at end
- 至少 1 Playwright e2e (per CLAUDE.md §2.2)

**Out of scope**:
- F2 switch atomic / F13 backup 可恢复性（v3.2.1 backlog）
- 不改 schema / 不改 IPC command 签名
- BUG-CR-01~05 / BUG-BZ-01~07 已在 phase 27/28 处理

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
所有实现选择由 Claude 自行决定 — discuss 阶段被用户选择跳过。遵循 ROADMAP phase 目标、成功准则、现有 codebase 约定。

**关键约束（从 CLAUDE.md + 现有 patterns 推导）**：
- 测试先行 TDD（CLAUDE.md §2.2）：每个 fix 先写 failing test，再写最小实现
- 零新依赖（CLAUDE.md §2.3）：必须用 React 19 内置 + Tauri 已有 API
- 不动版本号（CLAUDE.md §2.3）
- 不静默吞错（CLAUDE.md §7）
- 备份删除走 trash（macOS: `trash` shell command / Windows: `Recycle Bin` via `winapi` — 但零新依赖约束 → macOS 用 shell `mv` 到 ~/.Trash;Windows 用 PowerShell `Move-Item` to Recycle Bin,或保存删除元数据到 SQLite 让用户手动恢复）— Claude Discretion 选最简方案
- 欢迎页弹窗时序：监听 sqlite ready event / useEffect with dep on `dbReady` flag

</decisions>

