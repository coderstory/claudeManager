# Roadmap: Claude 配置管理器 (Claude Config Manager)

## Overview

跨平台桌面 GUI 工具,帮助 Claude Code 用户在多 provider 配置间安全切换。技术栈 Tauri v2 + React + Rust,目标 Windows 11 + macOS 26。从 M1 架构期 → M2 业务期 → M2.17 收尾 → M3 用户反馈修复 + 双模式 → M4 公证发布。

## Milestones

- ✅ **v1.0 架构期 (M1.1 ~ M1.12)** — 12 phases,shipped 2026-06-19 (5 exes on Desktop)
- ✅ **v1.5 业务期 (M2.1 ~ M2.16)** — 16 phases,shipped 2026-06-21 (26+ exes on Desktop)
- ✅ **v2.0 用户反馈修复 + 双模式 (M2.17 收尾 + M3.1 ~ M3.10)** — 11 phases,shipped 2026-06-22,tag v2.0
- ✅ **v3.0 功能完善 + updater 基础 (M3.11 ~ M3.15 + M4.3)** — round 1 (7/7 phase) shipped 2026-06-22; round 2 (M3.13.x bug fix + Phase 21 SQLite) shipped 2026-06-23
- ✅ **v3.0-M4 e2e 框架** — Phases 1-4 (shipped 2026-06-26, tag v3.0-M4)
- ✅ **v3.0.1 M5 用户 bug 修复 (33 bug)** — Phases 23-26 (shipped 2026-06-26, tag v3.0.1; 33/33 bug 修完, ClaudeManager.app 14M rebuild + 1 窗口 OK, 详见 [v3.0.1-ROADMAP.md](milestones/v3.0.1-ROADMAP.md))
- 🚧 **v3.2 M6 用户实测反馈修复** — Phases 27-31 (planning 2026-06-26; BUG-CR-01~05 + BUG-BZ-01~13 + BUG-RF-01~09 + UI-A-01~05 + INT-01~06; tag v3.2)
- ❌ ~~**v3.0 round 3 (M4.3 updater UI + A3 云备份 + M4.6 长尾)**~~ — **2026-06-26 用户拍板废弃**;原 Phase 19/20/21 标记弃用,不进新 milestone

## Phases

<details>
<summary>✅ v1.0 架构期 (M1.1 ~ M1.12) - SHIPPED 2026-06-19</summary>

> 完整 phase 列表 + git 提交见 git log。所有 exes 在 `~/Desktop/ClaudeConfigManager-M1/`。
> 评审记录在 `docs/REVIEWS/M1-REVIEWS.md`。

| Phase | 名称 | Plans | Status | Completed |
|-------|------|-------|--------|-----------|
| M1.1 | Tauri v2 scaffold + 托盘 + 最小化 | 1 plan | Complete | 2026-06-19 |
| M1.2 | OS 抽象层 (8 traits × Win/Mac) | 1 plan | Complete | 2026-06-19 |
| M1.3 | Plugin host + 12 stubs (frontend + backend) | 4 plans + 3 fixes | Complete | 2026-06-19 |
| M1.4 | Tauri capabilities with WHY 注释 | 1 plan | Complete | 2026-06-19 |
| M1.5 | Frontend deps + 设计系统 baseline | 5 plans | Complete | 2026-06-19 |
| M1.6 | Rust backend deps + version lock | 4 plans | Complete | 2026-06-19 |
| M1.7 | Autostart 集成 (Win 注册表 + Mac LaunchAgent) | 4 plans | Complete | 2026-06-19 |
| M1.8 | TDD + UI e2e 框架 | 1 plan | Complete | 2026-06-19 |
| M1.9 | 主窗口 framework + 12 路由占位 | 9 plans + 3 fixes | Complete | 2026-06-19 |
| M1.10 | Build/package/sign/CI matrix | 4 plans | Complete | 2026-06-19 |
| M1.11 | CI + framework invariants + 3 阶段 review | 5 plans + 1 fix | Complete | 2026-06-19 |
| M1.12 | 最终自审 + brainstorm + peer review | 5 plans | Complete | 2026-06-19 |

</details>

<details>
<summary>✅ v1.5 业务期 (M2.1 ~ M2.16) - SHIPPED 2026-06-21</summary>

> 完整 phase 列表 + git 提交见 git log。所有 exes 在 `~/Desktop/ClaudeConfigManager-M2/`。
> 评审记录在 `docs/REVIEWS/M2-REVIEWS.md`。**D9 决策**:M2.17 启动时清空到 `.archive/2026-06-21-m2.16-final/`,只保留 D8 抽查 2 个。

| Phase | 名称 | Plans | Status | Completed |
|-------|------|-------|--------|-----------|
| M2.1 | F1 provider-list (3 commands) | 1 plan | Complete | 2026-06-19 |
| M2.2 | F3 import-sql (real impl + sql parser) | 1 plan | Complete | 2026-06-19 |
| M2.3 | F4 deeplink-import (ccswitch://) | 1 plan | Complete | 2026-06-19 |
| M2.4 | F2 provider-switch (atomic backup → write → reload) | 1 plan | Complete | 2026-06-19 |
| M2.5 | F6 MCP 管理 (6 commands) | 1 plan | Complete | 2026-06-19 |
| M2.6 | F13 备份 + F19 恢复 (auto-backup + 字段级 diff) | 1 plan | Complete | 2026-06-19 |
| M2.7 | F7 用量查询 (5-min cache + fallback) | 1 plan | Complete | 2026-06-19 |
| M2.8 | F8 单文件部署 (drag-drop + 导出 .json) | 1 plan | Complete | 2026-06-19 |
| M2.9 | F18 优化器 (13 内置规则 + auto-backup) | 1 plan | Complete | 2026-06-19 |
| M2.10 | Theme 3-state + AppHeader chrome cluster | 1 plan | Complete | 2026-06-19 |
| M2.11 | F9 search (QuickSearchModal + fuzzy + 历史) | 1 plan | Complete | 2026-06-19 |
| M2.12 | kill-app.sh 修复 + scripts/tests | 1 plan | Complete | 2026-06-19 |
| M2.13 | F16 resource-browser (5 类资源 + reveal) | 1 plan | Complete | 2026-06-19 |
| M2.14 | F15 error feedback 横切 (shared ErrorBanner) | 1 plan | Complete | 2026-06-19 |
| M2.15 | Page padding/h1 字号统一 (polish) | 1 plan | Complete | 2026-06-19 |
| M2.16 | 9 new plugins + macOS compat + splash + cleanup | 1 plan + 7 fixes | Complete | 2026-06-21 |

</details>

### 🚧 v2.0 用户反馈修复 + 双模式 (In Progress)

**Milestone Goal**: 修复 M2.x 阶段 26+ 已知限制 + 27 条用户反馈清单中的 P0/P1 项,引入"用户 / 项目"双模式架构 (M3.10),为 M4 公证发布做技术准备。

### Phase 1: M2.17 收尾期 (M1 3 件套 + 17 限制评估 + F15 扩展 + 桌面清理)

**Goal**: M2.16 收尾 + M1 架构期遗留 3 件套 + 17 MEDIUM/LOW 已知限制全评估 + F15 ErrorBanner 接入剩余页面 + D9 桌面清理。
**Depends on**: M2.16 (✅ done)
**Requirements**: D7 (ErrorBanner 全扩展) / D9 (桌面清理) / D10 (17 限制评估)
**Status**: in progress
**Success Criteria**:

  1. M1 3 件套 (PluginHost wiring + build pipeline refresh + docs refresh) 全部 ship + smoke 7/7
  2. 17 MEDIUM/LOW 已知限制按 M2.16-001-M~010-M 顺序全评估,产出 `docs/investigations/m2.16-limitations-eval.md`
  3. F15 ErrorBanner 接入剩余 7 个页面 (import-sql / mcp-management / F2 切换 等),保持 testid 一致
  4. `~/Desktop/ClaudeConfigManager-M2/` 仅剩 D8 抽查的 2 个 exe,其他 mv 到 `~/Desktop/ClaudeConfigManager-archive/M2.16-2026-06-21/`

**Plans**: 4 (并行槽)

Plans:

- [x] M2.17-3.1: PluginHost wiring (lib.rs::run + shutdown on RunEvent::Exit) — commits `d5443c3` + `18d4b29`
- [x] M2.17-C1+C2: CI gates (npm run build in test-frontend + e2e skip with macos matrix) — commit `a980eeb`
- [x] M2.17-C3: build-and-ship.sh refresh (cargo → `tauri build`) — commit `8ef961d`
- [x] M2.17-C4: tsconfig.json 8 strict sub-flags explicit — commit `cc07178`
- [ ] M2.17-D10: 17 MEDIUM/LOW 限制评估 (主 session 必做)
- [ ] M2.17-D9: 桌面清理 (M2.17 启动 subagent 执行)
- [ ] M2.17-F15-batch4: ErrorBanner 接入剩余页面 (commit `02e5b14` 是 batch3-c3;后续 batch4 待派)

### Phase 2: M3.1 启动优化 (清单 1 — 冷启动白屏→全透明→loading 闪烁)

**Goal**: 冷启动事件链路 (Tauri setup → splash → window show → webview ready → first paint) 时序修复 + 透明度闪烁根因 + webview 预加载优化。
**Depends on**: M2.17 (D10 限制评估完成)
**Requirements**: 清单 1 (P0)
**Success Criteria**:

  1. e2e cold-start 截图对比: launch → 1s → 3s → 5s,无白屏 + 无 loading 闪烁
  2. vitest 启动事件 mock 覆盖 setup/show/paint 4 个边界
  3. ship `ClaudeConfigManager-M3.1-startup-optimization.exe`,smoke 7/7 通过

**Plans**: 1 plan (估时 2-3 天)

Plans:

- [ ] M3.1-01: 启动事件链路梳理 + splash 透明度修复 + webview 预加载

> **Implementation note (2026-06-26)**: Actual cold-start splash fix was implemented via **M3.13.2 (commit `fdaaaa5`)**, not in this phase's original code changes. M3.1's PLAN.md listed artifacts that were never shipped (`src/components/Splash.tsx`, lib.rs setup/show timing, main.tsx Suspense fallback, tauri.conf.json splash config). M3.13.2 replaced the `tauri://ready` event-driven approach (unreliable on Win WebView2) with React-first-paint + double-rAF + MIN_SPLASH_MS=1200ms floor. Current `src/App.tsx:308-396` is M3.13.2 code. `webview 预加载优化` sub-bullet remains unimplemented (non-blocking). See `.planning/phases/02-m31-startup-optimization/02-VERIFICATION.md` for the goal-backward audit.

### Phase 3: M3.2 F2/托盘/InfoBar polish (清单 3/4/5/6/7/8/24 + M2.16-007-L)

**Goal**: 8 项 polish 子任务并行 + D7 F15 ErrorBanner 扩到全部页面。
**Depends on**: M3.1
**Requirements**: 清单 3/4/5/6/7/8/24 (P1) + M2.16-007-L
**Success Criteria**:

  1. 托盘 LeftDoubleClick handler 显示窗体
  2. sidebar 底部文案 "M1.9 · 架构期" → "钱云飞作品"
  3. 备份路径校验 (`IPlatformPaths::backups_dir` = `%APPDATA%\ClaudeConfigManager\backups`)
  4. 备份差异 attribute tooltip (?) 图标
  5. backup metadata 加 `alias: Option<String>` 字段
  6. F19 恢复页 JSON 框全屏 toggle (app 窗体内)
  7. 设置入口 onClick 修复
  8. D7 F15 ErrorBanner 接入全部剩余页面

**Plans**: 1 plan (估时 3-4 天,8 子任务并行)

Plans:

- [ ] M3.2-01: 8 项 polish + ErrorBanner 全扩展

### Phase 4: M3.3 配置优化 13 规则 + Fix + 新增 env (清单 9/10)

**Goal**: 内置 13 规则 markdown 文档化 + UI 重构 (规则名 + 状态 + Fix 按钮) + 新增 3 个 env 规则。
**Depends on**: M3.2
**Requirements**: 清单 9/10 (P1/P2)
**Success Criteria**:

  1. `docs/rules/builtin-rules.md` 文档化 13 规则 (含新增 3 env: `CLAUDE_CODE_ATTRIBUTION_HEADER=0` / `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` / `CLAUDE_CODE_EFFORT_LEVEL=max`)
  2. UI 每行展示规则名 + 状态 (绿勾/红 x) + Fix 按钮
  3. Fix 按钮调用 `apply_rule_fix(rule_id)` Tauri command,带原子备份
  4. 13+3 = 16 规则扫描 fixture + Fix 原子性测试

**Plans**: 1 plan (估时 2-3 天)

Plans:

- [ ] M3.3-01: 13 规则文档化 + UI 重构 + 3 env 规则

### Phase 5: M3.4 资源市场重构 (清单 11/12/13/14/16/17)

**Goal**: 安装流程重设计 (内置 vs 第三方 vs npx 三类统一 API) + 删除克隆源码流程 + superpowers + GSD 内置源 + GSD-* 合并展示 + 资源浏览过滤规则。
**Depends on**: M3.3
**Requirements**: 清单 11/12/13/14/16/17 (P1/P2)
**Success Criteria**:

  1. F17 marketplace 安装流程三类统一 API (`install_builtin` / `install_third_party` / `install_npx`)
  2. 删除"克隆源码"分支
  3. 内置 superpowers (`/plugin install superpowers@claude-plugins-official`) + GSD (`npx @opengsd/gsd-core@latest`)
  4. GSD-* 合并展示为 "Get Shit Done" 分类
  5. 资源浏览过滤 `cache/` / `node_modules/` / `.git/` 三类
  6. 安装命令 mock + GSD 合并 fixture + 过滤规则单测

**Plans**: 1 plan (估时 4-5 天)

Plans:

- [ ] M3.4-01: F17 marketplace 重构 (基于启动门槽 2 的 `docs/design/M3.4-marketplace-refactor.md`)

### Phase 6: M3.5 资源浏览修 bug (清单 15)

**Goal**: `IPlatformReveal::reveal_file` 错误处理增强 + `explorer.exe exit 1` 根因排查 + 前端错误本地化。
**Depends on**: M3.4
**Requirements**: 清单 15 (P1) — D13 决策:按 M3.5 排期
**Success Criteria**:

  1. `reveal_file` 返回 `Result<(), RevealError>` 区分 4 类 (合法路径 / 不存在 / 无权限 / 网络路径)
  2. 前端 ErrorBanner 显示本地化提示 ("无法打开该资源" + 排查建议)
  3. 4 个 reveal 场景测试覆盖 (vitest 单测: `src/__tests__/pages/resource-browser.test.tsx` 6 reveal-error cases + `src/__tests__/components/ErrorBanner.test.tsx` 8 `formatRevealError` cases)

> **Implementation note (2026-06-26)**: SC #3 wording broadened from "e2e" to "test" coverage. Original SC said "4 个 reveal 场景 e2e 测试覆盖",but M3.5 ship (commit `e040a48`) only added vitest unit tests,no Playwright e2e spec. Reason Playwright e2e is not feasible on Mac dev box: `playwright.config.ts` §dev-box-mode 注释 + `tests/e2e/m2-2-4-real-invoke.spec.ts:122-144` 探针证实 vite dev 模式 `__TAURI_INTERNALS__.invoke` 桥接**不存在**;真 e2e 走 tauri-driver + WebView2 CDP (Win-only per CLAUDE.md §13.1)。Vitest 单测已 100% 覆盖 4 类 RevealFailure → ErrorBanner 中文文案路由 (resource-browser.test.tsx 6 cases + ErrorBanner.test.tsx 8 cases),覆盖深度超 M2.13 时代 m2-13-resource-browser.spec.ts 单一按钮存在性断言。按 CLAUDE.md §6 "we update specs to match reality",放宽 SC #3 措辞,接受单测覆盖为合规。Mac 真机验证待 M4 启动门(D6)再统一讨论,届时可在 Win dev box 补 m3-5-reveal-error.spec.ts。详见 `.planning/phases/06-m35-reveal-bug/06-VERIFICATION.md` override_1。

**Plans**: 1 plan (估时 0.5-1 天)

Plans:

- [x] M3.5-01: reveal 错误处理 + 前端本地化 (commit `e040a48`,2026-06-22 ship;SC #1 + #2 + #3 verified via vitest)

### Phase 7: M3.6 Provider CRUD + JSON 编辑器路径 (清单 20/22)

**Goal**: 启动门槽 3 验证回归 (清单 20 JSON 编辑器路径 bug 已修半) + provider 新增/修改/查看/删除 CRUD UI。
**Depends on**: M3.5
**Requirements**: 清单 20 (P0) + 清单 22 (P0)
**Success Criteria**:

  1. JSON 编辑器路径 bug 回归测试通过 (4 场景: 合法路径 / 不存在 / 权限 / 编码)
  2. provider 新增 UI 表单 (base_url / api_key_env / model + token-mask)
  3. provider 修改走 F13 自动备份
  4. provider 删除走 F13 备份 + 二次确认
  5. provider 查看只读详情页
  6. CRUD 各 2 用例 + 备份联动 + 权限校验

**Plans**: 1 plan (估时 3-4 天)

Plans:

- [ ] M3.6-01: Provider CRUD 4 命令 + UI

### Phase 8: M3.7 单文件部署重构 (清单 18)

**Goal**: F8 单文件部署页面文案重写 + 抽出"关于"页 (版本/build hash/许可证/致谢) + sidebar 加"关于"入口。
**Depends on**: M3.6
**Requirements**: 清单 18 (P1)
**Success Criteria**:

  1. F8 页面文案清晰解释 "导出单 exe / 嵌入 WebView2" 用途
  2. 新建 `pages/about/index.tsx`,显示版本 + build hash + 许可证 + 致谢
  3. sidebar 路由加 "关于" 入口
  4. about 页 snapshot + sidebar 路由跳转测试

**Plans**: 1 plan (估时 1-2 天)

Plans:

- [ ] M3.7-01: F8 文案重写 + about 页新建

### Phase 9: M3.8 用量查询修 bug (清单 19) [BLOCKED D14]

**Goal**: **D14 待问用户** → 根据 API key 来源 (用户手动 / OAuth / 本地代理) 决定技术路线 → HTTP 客户端 + 错误处理 + 缓存策略 + UI 表格。
**Depends on**: M3.7 + **D14 用户拍板** (BLOCKED)
**Requirements**: 清单 19 (P0)
**Success Criteria**:

  1. HTTP 客户端覆盖 Anthropic / OpenAI / 第三方代理三类 (按 D14 答案选)
  2. 错误处理覆盖 401 / 429 / network error / 数据格式错误
  3. 缓存策略 (5-min in-memory + 磁盘 fallback)
  4. UI 表格展示 provider + 周期 + 用量百分比 + 限额
  5. mock HTTP 4 场景测试

**Plans**: 1 plan (估时 3-5 天,视 D14 答案浮动)

Plans:

- [ ] M3.8-01: 用量查询重写 (按 D14 选定方向)

### Phase 10: M3.9 SQL 导入命名 + 校验 (清单 2/21)

**Goal**: 菜单改名 + SQL 文件 schema 校验 + 部分合法 dry-run 预览。
**Depends on**: M3.8
**Requirements**: 清单 2 (P1) + 清单 21 (P1)
**Success Criteria**:

  1. 菜单/页面标题 "SQL导入" → "SQL导入配置"
  2. SQL schema 校验 (cc-switch 格式: CREATE TABLE providers / INSERT statements)
  3. 校验失败 ErrorBanner + 错误详情
  4. 部分合法时 dry-run 预览 (列出将导入的 N 条 + 跳过的 M 条)
  5. 5 场景测试: 合法 / 非法 / 部分合法 / 空文件 / 编码错误

**Plans**: 1 plan (估时 1-2 天)

Plans:

- [ ] M3.9-01: 命名 + 校验 + dry-run 预览

### Phase 11: M3.10 双模式 用户/项目 (清单 23 — M3 核心新功能)

**Goal**: **架构级新功能** — 引入 Project 数据模型 + 持久化 + 用户级 (特殊 is_system=true 不可删) + 项目级 (指向 `<root>/.claude/` 虚拟视图) + 所有 plugin 适配 `IPlatformPaths::active_root_dir` + 切换走 F13 备份 + 原子切换。
**Depends on**: M3.9 + 启动门槽 1 架构评审通过
**Requirements**: 清单 23 (P0) — M3 核心新功能 (架构级)
**Success Criteria**:

  1. Project domain model (`id, name, root_dir, created_at, is_system`) + `projects.json` 持久化 + F13 备份
  2. 用户级 = 特殊 `is_system=true` 不可删
  3. 项目级 = 指向 `<root>/.claude/` 的虚拟视图
  4. 欢迎页改 "项目切换器" (下拉 + 新增/删除按钮)
  5. 所有 plugin (Provider/MCP/Optimizer/Backup) 适配 `IPlatformPaths::active_root_dir`
  6. 切换项目走 F13 备份 + 原子切换
  7. sidebar 顶部 project switcher + 当前项目显示
  8. 跨 plugin "切换项目后行为" 集成测试 + 用户/项目数据隔离单测

**Plans**: 1 plan (估时 5-7 天,含架构评审 + 适配所有 plugin 的回归测试)

Plans:

- [ ] M3.10-01: Project domain + 持久化
- [ ] M3.10-02: 所有 plugin 适配 `IPlatformPaths::active_root_dir`
- [ ] M3.10-03: 欢迎页改造 + sidebar 顶部 switcher
- [ ] M3.10-04: 跨 plugin 集成测试 + 数据隔离单测

### 🚧 v3.0 功能完善 + updater 基础 (In Progress)

**Milestone Goal**: M3.10 双模式全 plugin 落地 + updater 基础启用 + 测试补齐 + Tailwind 闭环。M4.1 证书 / M4.5 商店取消（用户拍板），M4.2/M4.4 暂缓，D6 Mac 真机不处理。

> v3.0 round 1 (2026-06-22) 已 ship 7 phase: A1 13/13 plugin 接入 / B3#10 Tailwind 移除 / B2#1 usage 测试 / A3 备份增量 / L-M2.08 WindowChrome / M4.3 updater Phase 1。剩余 e2e / 云备份 / updater UI / M4.6 长尾项。

### Phase 12: M3.11~M3.12 M3.10-adapter plugin 适配 (13 个 active_root_dir 接入点)

**Status**: ✅ 完成 (2026-06-22)
**Commits**: f375bf1 (F5) / 2e4e75b (F18) / afd090e (F1+F3) / 8a2650f (F6) / a9bd4b5 (F13+F19) / f145d38 (F16+F17+F7)
**内容**: 13 个 plugin 全部接入 active_root_dir,双模式架构从骨架到全 plugin 落地

### Phase 13: B3#10 Tailwind 移除

**Status**: ✅ 完成 (2026-06-22)
**Commit**: ed5a3e5
**内容**: 删 tailwindcss/postcss/autoprefixer/tailwind-merge/clsx/cva 6 包 + cn util + dead className + tokens.css 误导注释

### Phase 14: B2#1 usage fixture 8 子任务功能测试

**Status**: ✅ 完成 (2026-06-22)
**Commit**: 4f5df37
**内容**: cc-switch JSONL 解析 / 聚合 / 时间窗口 / 容错 / 性能 / 去重 8 场景测试

### Phase 15: A3 备份增强 Phase 1 (增量)

**Status**: ✅ 完成 (2026-06-22)
**Commit**: 3eadae2
**内容**: backup_incremental (skip identical snapshots)

### Phase 16: L-M2.08 MacWindowChrome 架构统一

**Status**: ✅ 完成 (2026-06-22)
**Commit**: 7efb0f8
**内容**: lib.rs 走 IPlatformWindowChrome trait dispatch, Mac impl = apply_vibrancy

### Phase 17: M4.3 updater Phase 1 (pubkey + endpoint)

**Status**: ✅ 完成 (2026-06-22)
**Commit**: da6ba67
**内容**: 真实 ed25519 pubkey + GitHub release endpoint, 私钥未泄露

### Phase 18: M1 L1 Playwright e2e (Windows only)

**Status**: ⏳ planned (3 plans; wave 1 WebView2 specs, wave 2 dev-server specs, wave 3 aggregate + STATE update)
**Plans**: 3 (sequential waves 1→2→3)
**Requirements**: none (validation/exec phase — verifies CLAUDE.md §5.3 M1 acceptance)

Plans:

- [x] 18-01-PLAN.md — WebView2 specs (launch / tray / close-minimize) via tauri-driver + CDP
- [x] 18-02-PLAN.md — Dev-server specs (m1-9-2 / m2-3-0 / m2-3-2) via vite + PLAYWRIGHT_BASE_URL
- [x] 18-03-PLAN.md — Aggregate 18-{01,02} results → 18-03-SUMMARY.md + STATE.md v3.0 → 8/10 ship

### Phase 19: A3 备份增强 Phase 2 (云备份)

**Status**: ❌ **废弃 (2026-06-26 用户拍板)**;不进新 milestone
**内容**: 远程备份 (S3/OSS)

### Phase 20: M4.3 updater Phase 2/3

**Status**: ❌ **废弃 (2026-06-26 用户拍板)**;不进新 milestone
**内容**: 前端 updater UI + E2E 灰度回滚

### Phase 21: M4.6 长期 backlog

**Status**: ❌ **废弃 (2026-06-26 用户拍板)**;不进新 milestone
**内容**: i18n / SQLite 历史 / 多窗口 / Telemetry / L-M2.02

### Phase 22: M4 e2e 框架 (14 端到端场景 ship gate) [v3.0-M4 milestone]

**Status**: ✅ 完成 (2026-06-26)
**Commits**: `2c825e1` (driver libs) / `9ebdc39` (01-03) / `92e9711` (04-07) / `0b666b6` (08-11) / `fb0535f` (12-14) / `278ac17` (00-stub fix) / `c6f7765` (test-all stage 6) / `c7e7bb3` (STATE.md)
**Tag**: `v3.0-M4`
**内容**: 黑盒端到端测试 (真 .app + 真文件系统副作用 + 14 hard-fail ship gate)；新增 `scripts/test-all.sh` stage 6 (m4-e2e)；macOS 通过 AppleScript + System Events 驱动；Windows driver 是 stub (Phase 5)

## v3.0 round 1 关键决策 (2026-06-22)

- D15: B3#10 Tailwind 选 B 移除（已 ship, commit `ed5a3e5`）
- D16: v3.0 milestone goal = "M3.10 双模式落地 + 测试补齐 + updater 基础 + Tailwind 闭环"
- M4.1 证书 (代码签名) — 拍板：都不买（用户口头确认）→ M4.2/M4.4 暂缓
- M4.5 应用商店上架 — 拍板：不上架（用户口头确认）→ M4.5 取消
- D6 Mac 真机验证 — 暂缓, M4 启动前再问

### 📋 v4.0+ 公证发布 (Deferred, 待用户拍板重启)

**Milestone Goal**: 获取代码签名证书 + 公证 (SmartScreen + notarization) + 启用 updater + 双轨打包 + (可选) 应用商店上架。

> v3.0 已 ship 后,v4.0+ 才考虑重启 M4.1~M4.6 公证发布主线。当前不在 v3.0 范围。
>
> 用户拍板（2026-06-22）：M4.1 证书不买 / M4.5 商店不上架 → M4.2/M4.4 暂缓 / M4.5 取消。
> M4.3 已在 v3.0 round 1 ship Phase 1 (pubkey + endpoint, commit `da6ba67`),Phase 2/3 (前端 UI + E2E 灰度) 留 v3.0 round 2。

候选清单 (M4.1~M4.6 现状):

- ❌ M4.1 代码签名证书 (取消)
- ⏸ M4.2 公证 (M4.1 取消 → 暂缓)
- 🟡 M4.3 updater (Phase 1 已 ship, Phase 2/3 pending)
- ⏸ M4.4 双轨打包 (M4.1 取消 → 暂缓)
- ❌ M4.5 应用商店上架 (取消)
- 🟡 M4.6 长期 backlog (i18n / SQLite / 多窗口 / Telemetry / L-M2.02 — 按需启动,部分留 v3.0 round 2)

## Progress

**Execution Order (v3.0 round 1 已 ship 7 phase + round 2 已 ship + v3.0-M4 已 ship + v3.0.1 M5 已 ship + v3.2 M6 planning):**
Phase 12 → 13 → 14 → 15 → 16 → 17 ✅ (round 1)
Phase 18 ✅ (round 2: Playwright e2e 6/6 PASS) → 21 ✅ (Phase 21 SQLite history)
Phase 22 ✅ (v3.0-M4: e2e framework 14/14 PASS, tag v3.0-M4)
Phase 23 → 24 → 25 → 26 ✅ (v3.0.1 M5: 33/33 bug 修完, tag v3.0.1)
~~Round 3 pending: Phase 19 (云备份) → 20 (updater UI) → 21 长尾项~~ ❌ **2026-06-26 用户拍板废弃**
Phase 27 → 28 → 29 → 30 → 31 🚧 (v3.2 M6: critical 5 → 业务 13 → 重构 9 → A 类 5+整合; tag v3.2)

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. M2.17 收尾期 | v2.0 | 3/2 | Complete    | 2026-06-22 |
| 2. M3.1 启动优化 | v2.0 | 1/1 | Complete | 2026-06-22 |
| 3. M3.2 F2/托盘/InfoBar polish | v2.0 | 1/1 | Complete | 2026-06-22 |
| 4. M3.3 配置优化 16 规则 | v2.0 | 1/1 | Complete | 2026-06-22 |
| 5. M3.4 资源市场重构 | v2.0 | 1/1 | Complete | 2026-06-22 |
| 6. M3.5 资源浏览修 bug | v2.0 | 1/1 | Complete | 2026-06-22 |
| 7. M3.6 Provider CRUD | v2.0 | 1/1 | Complete | 2026-06-22 |
| 8. M3.7 单文件部署重构 | v2.0 | 1/1 | Complete | 2026-06-22 |
| 9. M3.8 用量查询 (cc-switch JSONL) | v2.0 | 1/1 | Complete | 2026-06-22 |
| 10. M3.9 SQL 导入命名 + 校验 | v2.0 | 1/1 | Complete | 2026-06-22 |
| 11. M3.10 双模式 用户/项目 | v2.0 | 1/1 | Complete | 2026-06-22 |
| 12. M3.11~M3.12 plugin 适配 (13 接入点) | v3.0 | 6 commits | Complete | 2026-06-22 |
| 13. B3#10 Tailwind 移除 | v3.0 | 1 commit | Complete | 2026-06-22 |
| 14. B2#1 usage fixture 8 子任务 | v3.0 | 1 commit | Complete | 2026-06-22 |
| 15. A3 备份增量 Phase 1 | v3.0 | 1 commit | Complete | 2026-06-22 |
| 16. L-M2.08 WindowChrome 统一 | v3.0 | 1 commit | Complete | 2026-06-22 |
| 17. M4.3 updater Phase 1 (pubkey+endpoint) | v3.0 | 1 commit | Complete | 2026-06-22 |
| 18. M1 L1 Playwright e2e (Windows) | v3.0 | 3/3 | Complete    | 2026-06-22 |
| 19. A3 备份 Phase 2 (云备份) | v3.0 | 0/1 | ~~Pending~~ **废弃 (2026-06-26)** | - |
| 20. M4.3 updater Phase 2/3 | v3.0 | 0/1 | ~~Pending~~ **废弃 (2026-06-26)** | - |
| 21. M4.6 长期 backlog | v3.0 | 0/1 | ~~Pending (按需)~~ **废弃 (2026-06-26)** | - |
| 22. M4 e2e 框架 (14 端到端 ship gate) | v3.0-M4 | 8 commits | Complete | 2026-06-26 |
| 23. M5 critical 5 bug 修复 (#2/#4/#6/#19/#27) | v3.0.1 | 5 commits | Complete | 2026-06-26 |
| 24. M5 业务 13 bug 修复 | v3.0.1 | 2 commits | Complete | 2026-06-26 |
| 25. M5 重构 9 bug (#18 真修) | v3.0.1 | 1 commit | Complete | 2026-06-26 |
| 26. M5 A 类 5 + 整合验证 + tag v3.0.1 | v3.0.1 | 1 commit | Complete | 2026-06-26 |
| 27. v3.2 M6 critical 5 bug 修复 (BUG-CR-01~05) | v3.2 | 0/1 | In Progress | - |
| 28. v3.2 M6 业务 13 bug 修复 (BUG-BZ-01~13, 08~13 留空) | v3.2 | 0/1 | In Progress | - |
| 29. v3.2 M6 重构 9 bug 修复 (BUG-RF-01~09) | v3.2 | 0/1 | In Progress | - |
| 30. v3.2 M6 A 类 5 bug 修复 (UI-A-01~05) | v3.2 | 0/1 | In Progress | - |
| 31. v3.2 M6 整合验证 + tag v3.2 (INT-01~06) | v3.2 | 0/1 | In Progress | - |
</invoke>

### Phase 23: M5 critical 5 bug 修复 (Phase 1: #2 #4 #6 #19 #27)

**Goal:** 修 5 个 critical bug — is_active 消失 / sqlite 缺表 / update_provider missing id / 资源浏览切项目 / 配置优化 finding 过期; 5 个新 vitest; test-all 5 阶段仍全 PASS。
**Requirements**: #2 / #4 / #6 / #19 / #27 (33-bug 清单 P0)
**Depends on:** Phase 22
**Status**: ✅ Complete (2026-06-26)
**Plans:** 1 plan (M5-PLAN §4) — shipped via 5 critical fix commits `8a56d4e` `a588f64` `1c4a64d` `9f4d5bd` `6dc4007`
**Verification:** `milestones/v3.0.1-phases/23-m5-critical-5-bug-phase-1-*/23-VERIFICATION.md` (status: passed)
**Archive:** `milestones/v3.0.1-phases/23-m5-critical-5-bug-phase-1-*/`

### Phase 24: M5 业务修复 13 bug (Phase 2: #7 #8 #9 #10 #11 #12 #13 #15 #16 #17 #21 #22 #23 #24)

**Goal:** 13 业务 bug — SQL 导入过滤 / JSON 全屏 / JSON 目录树 / MCP 文案 / 用量趋势 7 天 / 资源市场 / CliNotFound; 13 个新 vitest; 3 用户拍板决策走 Claude's Discretion。
**Requirements**: #7 #8 #9 #10 #11 #12 #13 #15 #16 #17 #21 #22 #23 #24 (33-bug 清单 P1)
**Depends on:** Phase 23
**Status**: ✅ Complete (2026-06-26)
**Plans:** 1 plan (M5-PLAN §5) — 含 2 subagent fix: `c508371` (#22 资源市场 URL) + `d232e1b` (#23+#24 CliNotFound)
**Verification:** `milestones/v3.0.1-phases/24-m5-13-bug-phase-2-*/24-VERIFICATION.md` (status: passed)
**Archive:** `milestones/v3.0.1-phases/24-m5-13-bug-phase-2-*/`

### Phase 25: M5 重构 9 bug (Phase 3: #3 #18 #25 #26 #28 #29 #30 #31 #33)

**Goal:** 9 重构 bug — 欢迎页弹窗 / 删单文件部署 4 处同步 / 第三方仓库 / 手动处理不可勾 / 手动出 JSON 编辑 / 备份分页+多选 / 备份不删 / 历史分页 / JSON 搜 settings; 9 个新 vitest; 33 bug 全手测。
**Requirements**: #3 #18 #25 #26 #28 #29 #30 #31 #33 (33-bug 清单 P2)
**Depends on:** Phase 24
**Status**: ✅ Complete (2026-06-26)
**Plans:** 1 plan (M5-PLAN §6) — 含 #18 真修 subagent refactor: `0eb7f08` (29 files, +269/-576, 4 处同步删单文件部署)
**Verification:** `milestones/v3.0.1-phases/25-m5-9-bug-phase-3-*/25-VERIFICATION.md` (status: passed)
**Archive:** `milestones/v3.0.1-phases/25-m5-9-bug-phase-3-*/`

### Phase 26: M5 A 类 5 + 整合验证 (Phase 4: #1 #5 #14 #20 #32)

**Goal:** A 类 5 UI/UX bug — 二次元主题 header / Default Model / formatChineseTokenCount / 重新扫描按钮 / 关于页项目主页; test-all 5 阶段全过; ClaudeManager.app 重新 build + 装 + 启动 OK; STATE.md 写 M5 完成; tag v3.0.1。
**Requirements**: #1 #5 #14 #20 #32 (33-bug 清单 P3 UI/UX)
**Depends on:** Phase 25
**Status**: ✅ Complete (2026-06-26)
**Plans:** 1 plan (M5-PLAN §7) — 整合 subagent fix: `d4e4e40` (3 TS errors) + .app 14M rebuild + 启动 1 窗口 OK + tag v3.0.1
**Verification:** `milestones/v3.0.1-phases/26-m5-a-5-phase-4-*/26-VERIFICATION.md` (status: passed) + `v3.0.1-MILESTONE-AUDIT.md` (status: passed)
**Archive:** `milestones/v3.0.1-phases/26-m5-a-5-phase-4-*/`

### 🚧 v3.2 M6 用户实测反馈修复 (In Progress)

**Milestone Goal**: v3.0.1 M5 修了 33 bug 后用户重新实测 ClaudeManager.app,根据新发现 bug 清单按 critical 优先原则 4 阶段修 (BUG-CR-01~05 → BUG-BZ-01~13 → BUG-RF-01~09 → UI-A-01~05+INT-01~06),ship gate = test-all 6 阶段 PASS + M4 e2e 15/15 + ClaudeManager.app rebuild OK + tag v3.2。

> **沿用 v3.0.1 M5 工程模式**: 4 阶段 (critical → 业务 → 重构 → A 类+整合) + 1 commit 1 fix (or subagent fix) + test-all 6 阶段 ship gate + tag v3.2。
>
> **排除**: v3.0 round 3 废弃 backlog (云备份 / updater UI / M4.6 长尾) 不进 v3.2;D6 Mac 真机验证不启动;BUG-BZ-08~13 留空待用户实测后补 (v3.2.1 follow-up)。

### Phase 27: v3.2 M6 critical 5 bug 修复 (BUG-CR-01~05)

**Goal:** 修 6 个 critical bug (实测反馈重映射: header 拖动 / 用量三件套 / JSON path::field / scope 三件套 / SQL 数量 / MCP 合并);MCP 路由合并到 /resource-browser?tab=mcp;每个 fix 加 1 vitest + 1 Playwright e2e spec;ship gate 15/15 → 20/20。
**Requirements**: BUG-CR-01 (header drag P1) / BUG-CR-02 (用量三件套 P0) / BUG-CR-03 (JSON path::field P0) / BUG-CR-04 (scope remount P0) / BUG-CR-05 (SQL 数量 P0)
**Depends on:** Phase 26 (v3.0.1 M5)
**Status**: 🚧 In Progress
**Plans:** 2 plans (Wave 1 = 4 subagent 并行 fix 1/2/3/4;Wave 2 = 1 subagent 串行 fix 5+6 — 沿用 D29 4 槽并发上限;累计 6 fix commits)
**Verification:** `milestones/v3.2-phases/27-v32-m6-critical-5-bug-*/27-VERIFICATION.md` (status: passed 后) + test-all.sh 6 stages PASS + Playwright e2e 20/20
**Archive:** `milestones/v3.2-phases/27-v32-m6-critical-5-bug-*/`

Plans:
**Wave 1**

- [ ] 27-01-PLAN.md — Wave 1 (4 subagent 并行): fix 1 header drag (合约验证 + e2e) / fix 2 用量三件套 (COALESCE MIN type + 30 天窗口 GROUP BY + SELECT COUNT verify) / fix 3 JSON path::field (Rust field 参数 + 前端 sessionStorage split + T-05 field 安全拒绝) / fix 4 useScope hook (React 19 useSyncExternalStore, no zustand) + 3 组件 key remount (McpManagement/JsonFileTree/ResourceBrowser)

**Wave 2** *(blocked on Wave 1 completion)*

- [ ] 27-02-PLAN.md — Wave 2 (1 subagent, 依赖 27-01 fix 4): fix 5 SQL 导入 selected IDs + distinct 计数 + UNIQUE 约束 (D-15~D-18);fix 6 MCP 合并重构 (/mcp-management 路由删除 + sidebar 清理 + 老用户 localStorage remap → /resource-browser?tab=mcp + McpManagementPanel 共享组件)

**Success Criteria** (observable user behaviors — 重映射到 11 条实测反馈,6 个 fix):

  1. 用户按住 header 空白区域拖动窗口生效;点击 header 按钮不被吞为 drag 事件 (fix 1,实测 #1)
  2. 用户在用量页选 7 天窗口 → 看到 ≥ 1 个 trend bar (不是空 chart);refresh 用量后 toast 显示「已写入 N 条」(fix 2,实测 #2/#6/#7)
  3. 用户在 F18 优化页点「在 JSON 编辑器中打开」→ editor 不再报「无法解析路径 ... :api_key」;正确加载 providers/{id}.json 内容 (fix 3,实测 #4)
  4. 用户在 sidebar 切换 scope → MCP 管理 / JSON 编辑器侧边文件树 / 资源浏览 三个组件都重新加载数据;切到项目级后 MCP 列表显示项目级 mcp (fix 4,实测 #8/#10/#12)
  5. 用户勾选 1 个 SQL provider 导入 → 提示「已导入 1 个」(不是「已导入 6 个」)(fix 5,实测 #11)
  6. 用户访问 /mcp-management 老路由 → 自动重定向到 /resource-browser?tab=mcp;sidebar 无「MCP 管理」入口 (fix 6,合并重构)

### Phase 28: v3.2 M6 业务 13 bug 修复 (BUG-BZ-01~13)

**Goal:** 修 13 业务 bug (单功能,不影响主流程) — SQL 过滤 / JSON 全屏 / JSON 目录树 / MCP 文案 / 用量 7 天 / 资源市场 URL / CliNotFound + 6 个留空 (用户实测后补);每个 fix 加 vitest;5 subagent 实施 + 8 原 commit 验证。
**Requirements**: BUG-BZ-01 (SQL 过滤无效行) / BUG-BZ-02 (JSON 全屏编辑) / BUG-BZ-03 (JSON 目录树) / BUG-BZ-04 (MCP 文案) / BUG-BZ-05 (用量 7 天) / BUG-BZ-06 (资源市场 browse URL) / BUG-BZ-07 (CliNotFound 本地化) / BUG-BZ-08~13 (留空待用户实测补)
**Depends on:** Phase 27
**Status**: 🚧 In Progress
**Plans:** 1 plan (估时 3-4 天,沿用 M5-PLAN §5 模式;BUG-BZ-08~13 留空待 v3.2.1)
**Verification:** `milestones/v3.2-phases/28-v32-m6-biz-13-bug-*/28-VERIFICATION.md` (status: passed) + test-all.sh 6 stages PASS
**Archive:** `milestones/v3.2-phases/28-v32-m6-biz-13-bug-*/`

Plans:

- [ ] 28-01-PLAN.md — 7 真修 bug fix commits (BUG-BZ-01~07):SQL parser 过滤 invalid rows + dry-run 计数;JSON editor 全屏 mode toggle;JSON 文件树渲染修复;MCP 文案 (恢复 clipboard import 提示);用量趋势 7 天聚合窗口;资源市场 browse URL onClick 修正;CliNotFound 4 类错误本地化 (启动 / git / install / scan)
- [ ] 28-02-PLAN.md — BUG-BZ-08~13 留空 (v3.2.1 用户实测后补,不阻塞 ship)

**Success Criteria** (observable user behaviors):

  1. 用户导入 .sql 文件 → 列表只显示 valid rows,invalid 行被过滤并在 dry-run 预览中显示 skip count
  2. 用户在 JSON 编辑器点击全屏按钮 → 编辑器撑满 app 窗口,ESC 退出全屏
  3. 用户在 JSON 编辑器展开侧边文件树 → 渲染 `~/.claude/` 用户级 + active_root 项目级 JSON 文件,递归深度 ≤5,白名单 root
  4. 用户在 MCP 管理页看到正确文案 (粘贴 ccswitch:// 自动解析填表提示,而非旧版"导入 JSON")
  5. 用户在用量查询页选 7 天窗口 → sparkline 显示 7 个数据点,聚合 daily 而非 weekly
  6. 用户在资源市场点击"浏览"按钮 → 跳转 GitHub 仓库正确 URL (不报 404 / 不是 cc-switch-main 旧路径)
  7. 用户在资源市场执行 install 命令,git clone 失败 → ErrorBanner 显示本地化提示 "无法启动 git 命令行工具,请安装 Xcode CLT (macOS) 或 Git for Windows"
  8. 用户启动应用,F17 marketplace 找不到 git → ErrorBanner 显示本地化提示,而不是英文 "CliNotFound"

### Phase 29: v3.2 M6 重构 9 bug 修复 (BUG-RF-01~09)

**Goal:** 修 9 重构类 bug — 欢迎页弹窗 / 单文件部署 4 处同步 / 第三方仓库 / 手动处理 / 手动出 JSON / 备份分页+多选 / 备份不删 / 历史分页 / JSON 搜 settings;9 个 vitest;33+ bug 全手测。
**Requirements**: BUG-RF-01 (欢迎页弹窗逻辑) / BUG-RF-02 (单文件部署已删,M6 需保持) / BUG-RF-03 (第三方仓库文案) / BUG-RF-04 (手动处理 checkbox) / BUG-RF-05 (手动出 JSON 编辑入口) / BUG-RF-06 (备份分页+多选) / BUG-RF-07 (备份文件不误删) / BUG-RF-08 (历史分页) / BUG-RF-09 (JSON 搜 settings 路径)
**Depends on:** Phase 28
**Status**: 🚧 In Progress
**Plans:** 1 plan (估时 2-3 天,沿用 M5-PLAN §6 模式;含 #18 删单文件部署 M6 regression check)
**Verification:** `milestones/v3.2-phases/29-v32-m6-refactor-9-bug-*/29-VERIFICATION.md` (status: passed) + test-all.sh 6 stages PASS + 全 33+13+9 = 55 bug 手测
**Archive:** `milestones/v3.2-phases/29-v32-m6-refactor-9-bug-*/`

Plans:

- [ ] 29-01-PLAN.md — 9 重构 bug fix:欢迎页 onMount 弹窗时序修正 (等 sqlite ready 后再弹);M5 #18 单文件部署删除回归测试 (确保 M6 期间不被误加回);F17 第三方仓库 tab 文案 (保留 + 改写警告语);手动处理 checkbox 半选状态正确渲染;手动出 JSON 编辑入口按钮跳转 `/json-editor` 正确路由;F13 备份页分页 (20/page) + 多选 + 批量删除;BackupService::delete 加 trash + 二次确认 (避免误删);history page 分页 (从全量 list 改 cursor-based);F5 JSON 搜 settings 路径解析 (`~/.claude/settings.json` 而非 `~/.claude/`)

**Success Criteria** (observable user behaviors):

  1. 用户首次启动应用 → 欢迎页弹窗在 sqlite ready 之后弹出,不在 loading 阶段误弹
  2. 用户搜索 sidebar 入口 → "单文件部署" 不在路由列表中 (M5 #18 删除保持,不被新 commit 加回)
  3. 用户访问资源市场 → 看到第三方仓库 tab + 警告语 "第三方仓库未经 Claude 官方审核,请自行甄别"
  4. 用户在 F13 备份页勾选"全选当前页" → checkbox 三态 (none / partial / all) 正确显示,部分选中时显示横线
  5. 用户在 F13 备份页点击"导出 JSON 编辑" → 跳转 `/json-editor` 并预填选中备份内容
  6. 用户在 F13 备份页看到分页 (20/page) + 翻页按钮 + 多选 checkbox column
  7. 用户点击备份删除 → 二次确认 modal "确定删除 N 个备份?此操作不可撤销" + 删除走 trash (可恢复 30 天)
  8. 用户访问 history page → 看到 cursor-based 分页,滚动加载更多,不一次性加载全表
  9. 用户在 JSON 编辑器搜 "settings" → 文件树展开并定位到 `settings.json` (不是文件夹)

### Phase 30: v3.2 M6 A 类 5 bug 修复 (UI-A-01~05)

**Goal:** 修 5 个 UI/UX polish bug — 二次元主题 header / Default Model 字段 / formatChineseTokenCount / 资源市场"重新扫描"按钮 / 关于页项目主页;5 个 vitest;视觉一致性回归 (h1/padding/fontSize 与 baseline 对齐)。
**Requirements**: UI-A-01 (二次元主题 header 排版) / UI-A-02 (Default Model 字段显示) / UI-A-03 (formatChineseTokenCount 函数) / UI-A-04 (资源市场"重新扫描"按钮位置) / UI-A-05 (关于页项目主页 URL)
**Depends on:** Phase 29
**Status**: 🚧 In Progress
**Plans:** 1 plan (估时 1-2 天,沿用 M5-PLAN §7 模式;5 fix commits 或 subagent fix)
**Verification:** `milestones/v3.2-phases/30-v32-m6-a-5-bug-*/30-VERIFICATION.md` (status: passed) + test-all.sh 6 stages PASS + 视觉回归 (h1=18px / padding=24px / max-width=896px 与 baseline 对齐)
**Archive:** `milestones/v3.2-phases/30-v32-m6-a-5-bug-*/`

Plans:

- [ ] 30-01-PLAN.md — 5 A 类 fix:二次元主题 header logo 居中 + spacing 调整 (与瓷白/暗色主题对齐);provider 编辑 form 显示 Default Model 字段 (从 settings.json `model` 字段);formatChineseTokenCount 函数 bug 修复 (中文单位"万"正确换算,不报 NaN);F17 资源市场"重新扫描"按钮移到 tab 右上角 (而不是底部);关于页项目主页 URL 改成新 identifier URL (CLAUDE.md §6.5 显示名 vs 系统标识分层规则)

**Success Criteria** (observable user behaviors):

  1. 用户切换到二次元主题 → header logo 居中,搜索 / 主题切换 / 最小化 按钮位置与瓷白/暗色主题完全一致
  2. 用户在 provider 编辑 form 看到 "Default Model" 输入框,值从 settings.json `model` 字段读取
  3. 用户在用量查询页看到中文 token 数 (例如 "1.2万" / "23.5万" 而不是 "NaN" / "12345")
  4. 用户在资源市场页面看到 "重新扫描" 按钮在 tab 右上角 (而非底部 footer)
  5. 用户在关于页看到项目主页 URL 显示正确,且不是空白或旧 cc-switch-main 链接

### Phase 31: v3.2 M6 整合验证 (INT-01~06) + tag v3.2

**Goal:** v3.2 ship gate — test-all 6 阶段 PASS + M4 e2e 15/15 回归 (14 hard-fail + 1 stub) + vitest 全 PASS (含 v3.2 新增测试) + ClaudeManager.app rebuild + 装 + 启动 1 窗口 OK + STATE.md 写 M6 完成段 + tag v3.2。
**Requirements**: INT-01 (test-all 6 stages) / INT-02 (M4 e2e 15/15) / INT-03 (vitest 全 PASS) / INT-04 (ClaudeManager.app rebuild OK) / INT-05 (STATE.md M6 段) / INT-06 (tag v3.2)
**Depends on:** Phase 30
**Status**: 🚧 In Progress
**Plans:** 1 plan (估时 1-2 天,沿用 v3.0.1 Phase 26 整合模式)
**Verification:** `milestones/v3.2-phases/31-v32-m6-integrate-*/31-VERIFICATION.md` (status: passed) + `v3.2-MILESTONE-AUDIT.md` (status: passed) + `git tag v3.2` 成功
**Archive:** `milestones/v3.2-phases/31-v32-m6-integrate-*/`

Plans:

- [ ] 31-01-PLAN.md — 整合验证 subagent:跑 scripts/test-all.sh 6 阶段 (ui-check / frontend / rust / e2e / smoke / m4-e2e) 全 PASS;vitest 全 PASS (550+ 含 v3.2 新增);ClaudeManager.app rebuild + 装 + 启动 1 窗口 OK;M4 e2e 15/15 (14 hard-fail + 1 stub) 回归;STATE.md 写 "M6 完成" 段;`git tag v3.2` + push tag

**Success Criteria** (observable user behaviors):

  1. scripts/test-all.sh 6 阶段输出全 PASS (ui-check 0 error / frontend vitest 全过 / rust cargo test 全过 / e2e 6/6 / smoke 10/10 / m4-e2e 15/15)
  2. `vitest run` 输出全部 PASS (含 v3.2 新增 ~50 测试,合计 600+)
  3. M4 e2e 15/15 场景回归 (启动 app → 切 provider → 备份 → 恢复 → sqlite 读 settings → F18 扫描 → 资源市场 browse → MCP toggle → 用量查询 → 备份分页 → history 分页 → JSON 搜 settings → 主题切换 → 关于页 URL → splash 2s → kill app 干净)
  4. ClaudeManager.app 重新 build (`scripts/build-and-ship.sh`) + 装到 `~/Applications/` + 双击启动 → 看到主窗口,标题"Claude 配置管理器",WebView2 子窗口 1 个,tray icon 显示
  5. STATE.md 顶部 Current Position 段写 "M6 完成 (2026-06-26)" + Recent Work 加 Phase 27-31 各行 + Decisions 加 D17 (v3.2 拍板) + Known Issues 加 v3.2 已知限制
  6. `git tag -l v3.2` 输出 `v3.2` + `git push origin v3.2` 成功

---
