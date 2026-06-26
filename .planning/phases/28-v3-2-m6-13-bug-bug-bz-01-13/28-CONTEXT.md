# Phase 28: v3.2 M6 业务 13 bug 修复 - Context

**Gathered:** 2026-06-27
**Status:** Ready for planning
**Mode:** Auto-generated (discuss skipped via workflow.skip_discuss)

<domain>
## Phase Boundary

修 v3.0.1 M5 ship 后用户实测 ClaudeManager.app 发现的 13 个业务 bug。

**Pre-check 状态（基于 git log + 实际 source code 验证，2026-06-27）**:

| BZ | 描述 | 实际状态 | 证据 |
|---|---|---|---|
| BZ-01 | SQL parser 过滤 invalid rows + dry-run 预览显示 skip count | ⚠️ 部分 ship：M5 #7 #8 已 ship `importable` + `skipped` counts，但**未区分 invalid rows vs dedup hits** | M5 commits `530d734` `8c3853a`；当前 `provider_service.rs:704-755` `skipped` 把两种原因混在一起 |
| BZ-02 | JSON 编辑器全屏 mode toggle | ✅ **已 ship** | M5 commit `09804d2` `fix(json-editor): restore fullscreen toggle for editor`；当前 `json-editor/index.tsx:123-126` + `:598-604` + `:777-842` |
| BZ-03 | JSON 文件树渲染 user + active_root | ✅ **已 ship** | M3.13.5 commit `ce65ce8`；当前 `fs.rs:388` `list_editable_jsons` + `JsonFileTree.tsx` 递归 |
| BZ-04 | MCP 文案恢复 "粘贴 ccswitch:// 自动解析填表" 提示 | ❌ **未 ship**（M5 #13 反向修过头）| M5 commit `63d5a68` 删了 ccswitch:// 提示，但 `parseMcpDeeplink` 仍支持两种格式；当前 `mcp-management/index.tsx:496-497` 只提 JSON |
| BZ-05 | 用量趋势 7 天聚合窗口 | ✅ **已 ship**（Phase 27 二次细化）| M5 commit `ec83879` + Phase 27 commit `3842103`；当前 `usage-query/index.tsx:676-680` TrendChart + `:928` `fetchSevenDayTrend` |
| BZ-06 | 资源市场 browse URL 修正 | ✅ **已 ship** | M5 commit `c508371` `fix(marketplace): browse button opens git URL via @tauri-apps/plugin-opener`；当前 `marketplace/index.tsx:730` `await openUrl(repo.url)` |
| BZ-07 | CliNotFound 4 类错误本地化 | ❌ **未 ship**（M5 #23 #24 加了 CliNotFound variant，但只有 1 类）| M5 commit `d232e1b`；当前 `marketplace_service.rs:175` 只有 `CliNotFound { cmd }` 一个 variant |
| BZ-08~13 | 6 个 bug | ⏸️ 留空待 v3.2.1 用户实测后补 | per ROADMAP §"Plans" 第 2 段 |

**Phase 28 实际工作**:
1. **3 个真修 fix**：BZ-01（invalid rows 区分）、BZ-04（MCP 文案恢复）、BZ-07（CliNotFound 4 类错误）
2. **4 个 M5 fix 回归 test**：BZ-02/03/05/06 各加 1 vitest 防回归
3. **BZ-08~13 留空**：记 STATE.md / 28-SUMMARY.md，不进本 phase

**In scope**:
- BZ-01 fix: 在 `ImportResult` 加 `invalid_rows: usize` 字段，区分 invalid rows vs dedup hits
- BZ-04 fix: MCP empty-state hint 加 ccswitch:// mention（保留 JSON mention）
- BZ-07 fix: `MarketplaceError` enum 拆 4 个 variant（StartupCliMissing / GitFailed / InstallFailed / ScanFailed）+ zh-CN Display + 前端 parseMarketplaceErrorCategory helper + categorized ErrorBanner
- BZ-02/03/05/06 加回归 vitest（4 个 test，确保 M5 fix 不被未来 commit 改回去）
- 每个 fix 加 ≥1 vitest（RED→GREEN TDD 流程 per CLAUDE.md §2.2）

**Out of scope**:
- BZ-08~13 推到 v3.2.1 backlog
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

### Plan 结构（3 plans）

- **28-01-PLAN.md**: BZ-01 SQL invalid rows 区分 + Rust 单元测试 + UI 显示
- **28-02-PLAN.md**: BZ-04 MCP hint 恢复 + 4 个 M5 fix 回归 vitest (BZ-02/03/05/06)
- **28-03-PLAN.md**: BZ-07 CliNotFound 4 类错误本地化（Rust enum + zh-CN Display + UI categorized ErrorBanner）

每个 plan 独立 subagent 执行（互不冲突 file scope）。

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### 项目规则
- `CLAUDE.md` §1 项目核心价值 ("Provider 切换 1 秒搞定，绝不出错") — BZ-01 直接相关
- `CLAUDE.md` §2.2 TDD 强制 + §5.3 e2e ship gate — 每个 fix RED→GREEN
- `CLAUDE.md` §2.3 零新依赖 + §2.5 UI 一致性 — 所有 fix 遵守
- `CLAUDE.md` §7 内存/状态纪律 ("不允许静默吞错") — BZ-07 直接相关
- `CLAUDE.md` §10 主 session 不亲自跑命令 — subagent 派单

### 规划文档
- `.planning/ROADMAP.md` Phase 28 — 当前 phase 目标
- `.planning/PROJECT.md` — 项目背景 / 核心价值
- `.planning/STATE.md` 顶部 v3.2 milestone context — 全局规划

### prior CONTEXT 参考
- `.planning/phases/27-v3-2-m6-critical-5-bug-bug-cr-01-05/27-CONTEXT.md` — Phase 27 CONTEXT 格式参考
- `.planning/milestones/v3.0.1-phases/24-m5-13-bug-phase-2-.../24-CONTEXT.md` — M5 业务 13 phase CONTEXT 格式参考（同模板）

### M5 关联 commits（已 ship 的 BZ-02/03/05/06 直接证据）
- `09804d2` fix(json-editor): restore fullscreen toggle (BZ-02)
- `ce65ce8` M3.13.5 JSON file tree (BZ-03)
- `ec83879` fix(usage): 7-day trend (BZ-05)
- `3842103` fix(27-2): usage three-bugs (BZ-05 refine)
- `c508371` fix(marketplace): browse button (BZ-06)
- `530d734` fix(sql-import): validate + dedup (BZ-01 部分)
- `8c3853a` fix(sql-import): SkippedLine carries name (BZ-01 部分)
- `63d5a68` fix(mcp): remove ccswitch:// from empty-state hint (BZ-04 反向修过头)
- `d232e1b` fix(marketplace): use CliNotFound for npx/claude spawn (BZ-07 部分)

### 技术栈参考
- `src-tauri/src/services/provider_service.rs:704-755` — BZ-01 fix 位置
- `src-tauri/src/services/marketplace_service.rs:165-189` — BZ-07 fix 位置
- `src/pages/mcp-management/index.tsx:496-497` — BZ-04 fix 位置
- `src/pages/json-editor/index.tsx:123-126` — BZ-02 已 ship 验证
- `src/pages/usage-query/index.tsx:676-680` — BZ-05 已 ship 验证
- `src/pages/marketplace/index.tsx:42` `730` — BZ-06 已 ship 验证

### SPEC
- `./SPEC.md` §5 设计规范 — UI 颜色 / 间距 / 字号基线（不直接相关，保持遵守）
- `./SPEC.md` §6 错误处理 — BZ-07 直接相关（错误本地化格式）

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **M5 atomic commit 模式**：`fix(24-N): <description> (#bug)` + 1 vitest commit pair
- **M5 phase 23-26 33 bug 修法模式**：1 commit 1 fix + test-all 6 阶段 PASS + M4 e2e 15/15 保持
- **CLAUDE.md §3.2 OS 抽象层**：marketplace_service 已有 platform 分离，BZ-07 不破坏
- **sccache 跨平台项目级 config** (`src-tauri/.cargo/config.toml`): subagent 编译自动用

### Integration Points
- **F3 SQL 导入** ↔ **`provider_service.rs::import_providers_from_sql`**: BZ-01 需在结果 struct 加新字段
- **F17 marketplace** ↔ **`marketplace_service.rs::MarketplaceError` enum**: BZ-07 拆 enum variant
- **F6/F16 MCP 管理** ↔ **`mcp-management/index.tsx` empty-state hint**: BZ-04 文案恢复
- **M5 fix commit** ↔ **Phase 28 回归 test**: BZ-02/03/05/06 加 regression vitest 锁定行为

</code_context>

<specifics>
## Specific Ideas

### 用户实测反馈原文（11 条 2026-06-26 phase 27 已记）
完整 11 条反馈见 `.planning/phases/27-.../27-CONTEXT.md` §specifics。

### Phase 28 实际工作（基于实测反馈重映射）
本 phase 不再重写映射；实测 vs 预排错位已在 phase 27 处理。本 phase 沿用 M5 原 BZ 预排，但其中 4 个 BZ 已被 M5 ship 修过：

- BZ-02/03/05/06 M5 已 ship → 加回归 vitest 锁定
- BZ-01/04/07 M5 部分 ship 或反向 → 真修
- BZ-08~13 用户实测未发现 → v3.2.1 backlog

### 测试策略
- BZ-01: Rust `cargo test` (provider_service) + TS `vitest` (import-sql page)
- BZ-04: TS `vitest` (mcp-management page)
- BZ-07: Rust `cargo test` (marketplace_service) + TS `vitest` (marketplace + api/marketplace)
- BZ-02/03/05/06: TS `vitest` 回归 test（直接 GREEN，不需 RED→GREEN）

### 修法时序
- Plan 01 (BZ-01) — 独立 SQL parser/data 类
- Plan 02 (BZ-04 + 4 回归 test) — 独立文案 + UI 类
- Plan 03 (BZ-07) — 独立 marketplace enum 类

3 plans 完全独立，subagent 可并行。

</specifics>

<deferred>
## Deferred Ideas

### v3.2.1 backlog
- 原 BZ-CR-01~05: F2 switch atomic / F13 backup 可恢复 / sqlite read / F2 round-trip / F18 finding 过期
- 原 BZ-BZ-08~13: 6 个原规划业务 bug（实测未发现 → 用户实测后补）
- 原 BZ-RF-01~09: 9 个原规划重构 bug
- 原 UI-A-01~05: 5 个原规划 UI-A bug

### v3.2 Phase 28 真实 backlog（基于实测）
无额外发现（11 条实测反馈中 phase 27 已消化 6 条进 fix 1-6，剩下的由本 phase 7 个 BZ 处理；BZ-08~13 是预排中暂未实测的）。

### 跨 phase 决策（不属 phase 28 范畴）
- v3.0 round 3 废弃项（云备份 / updater UI / M4.6 长尾）保持废弃
- FTS5 全文搜索 / SQLCipher 加密 / 跨 process SQLite 共享 — 独立 backlog

</deferred>

---

*Phase: 28-v3.2 M6 业务 13 bug 修复*
*Context gathered: 2026-06-27*
*Mode: Auto-generated (discuss skipped); manual refinement after pre-check verification*
