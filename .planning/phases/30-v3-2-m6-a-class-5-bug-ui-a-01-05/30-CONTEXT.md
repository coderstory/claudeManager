# Phase 30: v3.2 M6 A 类 5 bug 修复 - Context

**Gathered:** 2026-06-27
**Status:** Ready for planning
**Mode:** Auto-generated (discuss skipped via workflow.skip_discuss)

<domain>
## Phase Boundary

修 v3.0.1 M5 ship 后用户实测发现的 5 个 UI/UX polish 类 bug。视觉一致性回归（h1/padding/fontSize 与 baseline 对齐）。

**Phase 30 真修清单（5 个 fix）**：

| Fix | slotID | 简述 | 模块 | 关键文件 (估计) |
|---|---|---|---|---|
| 1 | UI-A-01 | 二次元主题 header logo 居中 + spacing 调整（与瓷白/暗色主题对齐） | Theme 主题 | src/components/AppHeader.tsx, src/design-system/themes/ |
| 2 | UI-A-02 | provider 编辑 form 显示 "Default Model" 输入框（值从 settings.json `model` 字段读取） | Provider 编辑 form | src/pages/provider-edit/ or src/components/ProviderForm.tsx |
| 3 | UI-A-03 | formatChineseTokenCount 函数 bug 修复（中文单位"万"正确换算，不报 NaN） | F7 用量查询 | src/lib/format.ts (or wherever the function lives), src/pages/usage-query/index.tsx |
| 4 | UI-A-04 | 资源市场"重新扫描"按钮移到 tab 右上角（而不是底部） | F17 marketplace | src/pages/marketplace/index.tsx |
| 5 | UI-A-05 | 关于页项目主页 URL 改成新 identifier URL（CLAUDE.md §6.5 显示名 vs 系统标识分层规则） | 关于页 | src/pages/about/index.tsx, src-tauri/src/commands/app.rs |

**In scope**:
- 5 个 fix 各加 ≥1 vitest
- 5 个 fix 加 atomic commit (test+fix pair)
- 1 docs commit at end

**Out of scope**:
- 完整 UI redesign（已废弃）
- 不改 system identifier (bundle id, Cargo.toml name, package.json name) per CLAUDE.md §6.5
- 不改 schema / 不改 IPC command 签名

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
- CLAUDE.md §6.5：UI-A-05 关于页 URL 改 DISPLAY_IDENTIFIER（不碰 IDENTIFIER 系统层）；3-place sync (§6.4) — 前端字符串 + Rust IPC 常量 + 测试 fixture 都改
- 二次元主题 spacing：与瓷白/暗色主题共享 header layout，UI-A-01 修复方法 = 抽 Header layout 公共组件或 CSS 变量

</decisions>