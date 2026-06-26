---
phase: 23
name: M5 critical 5 bug 修复
status: ready-for-planning
mode: autonomous (Claude's Discretion on 5 开放问题)
gathered: 2026-06-26
source: .planning/phases/M5-bug-fixes/M5-ANALYSIS.md §2/§4 + M5-PLAN.md §1.3/§4
---

# Phase 23: M5 critical 5 bug 修复 — Context

**Gathered:** 2026-06-26
**Status:** Ready for planning
**Mode:** Autonomous (用户授权 Claude's Discretion on 5 开放问题)

<domain>
## Phase Boundary

**修 5 critical bug** (按 M5-ANALYSIS §2 重审后 critical 5,非 M5-PLAN §1.3 原 critical 5):

| # | bug | 影响 flow |
|---|---|---|
| 4 | Provider 列表激活态消失 | F1/F2 列表 + 切换核心 |
| 2 | sqlite no such table: usage_history | F7 + F13 history flow |
| 6 | 编辑 Provider 报 missing field `id` | F1 编辑流程 |
| 27 | 配置优化 finding 报"已过期" | F18 100% 挂 |
| 19 | 资源浏览切项目级还是用户级 | M3.10 半死 + F16/F17 |

**前置复现 (Phase 1 必先做, 顺序)**:
- #2: 拿用户 .app, 跑 `sqlite3 history.db ".tables"` 验证 V2 migration 是否跑了 (可能是旧 build)
- #6: grep 前端 `updateProvider` invoke 调用, 确认 bug 来自前端还是后端
- #19: 读 `platform::windows/paths.rs:107-117` `active_root_dir` 实现, 复用到 macOS

**修法顺序 (按 M5-ANALYSIS §4 Phase 1 排序)**:
1. #6 (最易, 1-2 行前端改) → fix(frontend)
2. #2 (看复现结果, 可能只需重装 / 加 IF NOT EXISTS) → fix(rust) + fix(migration)
3. #4 + #19 一起改 (都跟 active_root_dir 相关, 改 paths.rs:113) → fix(multi)
4. #27 (独立, 改 scan_id 协议) → fix(rust) + fix(frontend)

**测试**:
- 5 个新 vitest 单测
- 手测每个 bug 报告步骤
- bug #4 #19 必跑 macOS 真机 (M3.10 决策遗留)

**scope 排除**: M4 框架实现 / 新功能 / M4.3 updater Phase 2-3 / i18n / 多窗口 / Telemetry / 重构 src-tauri 任何架构层 / 删 tests/e2e/ Playwright / 加新依赖 / 改 design-system 主题 (CLAUDE.md §2.5 视觉一致性)

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion (用户授权)

**5 开放问题全部走 Claude's Discretion**:

1. **Q5 修法优先级** → **选 (1) critical 5 优先** (M5-PLAN §4 + M5-ANALYSIS §4 一致)
2. **#12 MCP 剪贴板** → **选 (A) 改代码 import JSON** (M5-ANALYSIS §3 关键发现 #11: ccswitch:// 协议 v3.0 已删, 但 import 逻辑仍走 deeplink parser; 用户原报告"不是 import json 吗?怎么是 url" 强烈暗示意图是 JSON; 改代码同时删 ccswitch 提示)
3. **#23-24 git error 错位** → **选 (A) 加 `MarketplaceError::CliNotFound { cmd: String }` variant** (M5-ANALYSIS 关键发现 #4: 错误信息 kind() 路由; 影响小, 仅 marketplace caller; 一并修 #23 + #24)
4. **#25 第三方仓库** → **选 (A) 保留 + 改文案说清作用** ("输入 git 仓库 URL, 装其内 plugin/skill/command"; 用户原话"功能干啥的" 表明是文档缺口, 不是功能不该存在)
5. **Q-RENAME 版本号** → **选 (B) v3.0.1** (33 bug 是 minor fix, 30/33 是 user-facing 改进; v3.1 留给 v3.0 round 4+ 的功能 milestone; 用户可选后续 bump)

### 关键约束 (CLAUDE.md)

- §2.1 架构先行: 修复前必先在本文件写"为什么这样修" ✓
- §2.2 TDD 强制: 每个 bug 至少 1 个新 vitest 单测
- §2.3 版本锁: 不加新依赖
- §2.5 视觉一致性: bug #1 #20 #32 涉及 design-system 改的必同时改 light/dark/system/二次元 4 主题保持一致
- §6.4 文案同步: 3 处同步 (前端字符串 + Rust IPC 常量 + 测试 fixture), #18 删单文件部署扩展到 4 处 (前端 + sidebar + IPC + capability)
- §6.5 显示名 vs 系统标识分层: #5 Default Model 是显示文案, 改 src-tauri/commands/app.rs 跟 src/pages/welcome 的前端字符串
- §5.3 M1 阶段必过 e2e → Phase 1 完成必须 test-all.sh 5 阶段仍全 PASS

### 修法分层 (commit 规范)

```
单文件 .tsx / .ts 改 → commit "fix(frontend): ..."
单文件 .rs 改 → commit "fix(rust): ..."
跨文件改 (commands + IPC + UI) → commit "fix(multi): ..." + 写 STATE.md exception
```

### 数据库 schema 修复 (#2)

V2 migration (commit 8985626) 已 ship 加 `usage_daily_stats`. 但用户报告 `usage_history` 缺表可能因:
- 用户 .app 是 V2 之前 build (重装就行)
- migration 没 IF NOT EXISTS (已加, 那可能是 DB lock 失败)

修法: `infrastructure/db.rs` startup hook 加 idempotent `CREATE TABLE IF NOT EXISTS` (V1 + V2 都有), 同时 manual migration 加 retry on lock.

</decisions>

<code_context>
## Existing Code Insights

### Critical Bug 根因 (从 M5-ANALYSIS 关键发现)

1. **bug #6 根因** — `commands/providers.rs:330` 已有 `id: String` 参数; bug 在前端 `src/lib/api/providers.ts` invoke 包装可能没传 id, 或 `ProviderInput` struct 字段不一致. **Phase 1 必先 grep** 前端确认.

2. **bug #2 根因** — `infrastructure/sqlite/history_db.rs:120` V2 migration 已 ship 加 `usage_daily_stats`, **但 `init()` (history_service.rs:185) 仍查 `usage_history`**, 用户的 .app 可能是 V2 之前 build. **Phase 1 必跑**: 拿用户 .app, `sqlite3 history.db ".tables"` 验证.

3. **bug #4 真因** — `provider-list/index.tsx:864` 读 `provider.is_active`; **真因** 是 `list_providers_with_active_root` 在 macOS 上 `active_root_dir()` 永远 None (paths.rs:113), settings.json 写在 user 路径, 但 `is_active` 计算可能在 project 路径找. **修法**: list 时显式 user 路径 fallback.

4. **bug #19 根因** — `services/resource_service.rs:113-124` `list_with_active_root` 调 `active_root_dir`; **真因** 是 macOS `paths.rs:113` 永远 None (M3.10 决策遗留). **修法**: 读 `platform::windows/paths.rs:107-117` 真读 `projects.json` 的实现, 复用到 macOS.

5. **bug #27 真因** — `optimizer_service.rs:193` apply 时 re-scan, finding id 不在 → 报"已过期". **根因是 scan 结果不稳定** (可能 finding id 包含 file mtime / hash 算法对相同内容生成不同 id). **修法**: 给 `OptimizationFinding` 加 `scan_id: String` 字段, apply 时前端传 `scan_id + finding_id` 索引, 后端用 `scan_id` 缓存的 findings 查, 不 re-scan.

### 关键文件位置 (M5-ANALYSIS 引用)

- `src-tauri/src/infrastructure/sqlite/history_db.rs:48-135` — V1/V2 migration
- `src-tauri/src/services/history_service.rs:180-196` — `init()` 查 `usage_history` 表
- `src-tauri/src/commands/providers.rs:328-336` — `update_provider(state, id, input)` 已有 id
- `src-tauri/src/commands/mcp.rs:137-146` — `parse_mcp_deeplink` 走 ccswitch://
- `src/pages/mcp-management/index.tsx:203-237` — clipboard 调 `parseMcpDeeplink`, 非 JSON 解析
- `src/pages/usage-query/index.tsx:120-123` — `.toLocaleString()` 直接调, 没用 `formatChineseTokenCount`
- `src/lib/format.ts:36-50` — `formatChineseTokenCount` 函数已 ship
- `src-tauri/src/infrastructure/sql_parser.rs:88-95` — `SkippedLine { line, reason }` 无 name 字段
- `src-tauri/src/services/marketplace_service.rs:534-540, 645-652` — `npx` / `claude` spawn 失败包成 `MarketplaceError::Git`
- `src-tauri/src/services/optimizer_service.rs:193-205` — apply 时 re-scan
- `src-tauri/src/platform/macos/paths.rs:113-115` — `active_root_dir()` 永远 None

### 测试基础设施

- `vitest` 现有: `src/__tests__/` 单元测试
- `cargo test` Rust 单测
- `scripts/test-all.sh` 5 阶段 (test-frontend / test-rust / test-frontend-build / test-vite-build / test-smoke + M4 e2e stage 6)
- 现有失败场景: 无 (v3.0 ship 时 test-all 5 阶段全 PASS)

</code_context>

<specifics>
## Specific Ideas

### Phase 1 ship gate

- [ ] 5 critical bug 修完 (#4 #2 #6 #19 #27)
- [ ] 3 复现 (#2 #6 #19) 有结果
- [ ] 5 个新 vitest 单测
- [ ] test-all.sh 5 阶段仍全 PASS
- [ ] macOS 真机验证 (#4 #19 paths.rs:113 改后)

### 子任务拆分 (建议)

- **T1 fix(frontend) #6**: grep `src/lib/api/providers.ts` + `provider-list/index.tsx` 调 `updateProvider` 的地方, 修前端传 id (1-2 行)
- **T2 fix(rust) + fix(migration) #2**: `infrastructure/db.rs` startup hook 加 idempotent CREATE TABLE IF NOT EXISTS, 跑用户 .app 验证
- **T3 fix(multi) #4 + #19**: 改 `platform::macos/paths.rs:113` 真读 `<app_data>/projects.json`, list 时显式 user 路径 fallback for is_active 计算
- **T4 fix(rust) + fix(frontend) #27**: `optimizer_service.rs` `OptimizationFinding` 加 `scan_id` 字段, 前端 optimizer 页传 `scan_id + finding_id`, 后端用 `scan_id` 索引
- **T5 测试**: 5 个新 vitest 单测 (每个 bug 1 个) + 手测 + macOS 真机 (#4 #19)

### 反事故 (CLAUDE.md §6.4 教训)

- #5 改 "Default Model" 文本 → 同时改 `commands/app.rs` + 前端 + 测试 fixture 3 处
- #18 删单文件部署 → 4 处同步 (前端 + sidebar + IPC + capability), grep 全局无引用

</specifics>

<deferred>
## Deferred Ideas

- **A 类 5 个** (#1 #5 #14 #20 #32) → Phase 4 (M5 phase 26)
- **业务 13 个** (#7 #8 #9 #10 #11 #12 #13 #15 #16 #17 #21 #22 #23 #24) → Phase 2 (M5 phase 24)
- **重构 9 个** (#3 #18 #25 #26 #28 #29 #30 #31 #33) → Phase 3 (M5 phase 25)
- **M4 fixture 隔离 (CCM_TEST_HOME)** — 跟 M5 修 bug 并行工作, 改 `MacPaths::resolve()` / `WindowsPaths::resolve()` 头部加 env var
- **M6 候选** — 性能基准 / tauri-driver macOS 支持 / pixel diff / F8/F18/F23/F20 e2e 覆盖

### 已知限制

- D6 Mac 真机验证 — 暂缓, 改后必跑真机 (Windows dev box 上 Mac impl 是 compile-only stubs)
- macOS `active_root_dir()` 改后, 需用户 Mac dev box 验证 (D6 决策)

</deferred>

---

*Refs: CLAUDE.md §1 核心 value + §2 架构/TDD/版本锁/谨慎修改/视觉一致性 + §5 三层测试 + §6 评审/文案同步/分层 + §13 build pipeline.  bug 来源 bug-report.md (2026-06-25 23:31 用户实测 33 bug).  决策依据 M5-PLAN.md §4 + M5-ANALYSIS.md §2/§3/§4.*
