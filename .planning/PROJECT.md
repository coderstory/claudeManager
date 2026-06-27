# Claude 配置管理器 (Claude Config Manager)

## What This Is

跨平台桌面工具，帮助已经在终端里使用 Claude Code 的用户在多个 provider 配置（公司代理 / 自费 DeepSeek / 自费第三方等）之间**快速切换 + 安全管理 + 实时监控用量**，免去手编 `~/.claude/settings.json` 的负担。

技术栈：Tauri v2 + React + TypeScript + Vite + shadcn/ui + Tailwind + Rust（后端）。目标平台 Windows 11（开发主平台）+ macOS 26 (Tahoe)。

## Core Value

**"Provider 切换 1 秒搞定，绝不出错"** — 其他所有功能（F13 备份 / F19 恢复 / F7 用量 / F18 优化）都可以失败或缺失；切换的可靠性、原子性、可回滚性是核心，不能妥协。

## Business Context

内部工具 / 自我研发项目，非商业化产品。

- **Customer**: 项目作者本人（钱云飞 / e-Yunfei.Qian）作为 Claude Code 重度用户
- **Revenue model**: 无（个人项目）
- **Success metric**: 桌面 ship 的 Claude Config Manager 安装包能稳定切换 ≥3 个 provider 不出错
- **Strategy notes**: 无（项目方向由 STATE.md 决策日志 + 用户反馈清单驱动）

## Current State (v3.4 PLAN shipped, 2026-06-28)

**Latest shipped milestone:** v3.2 — M6 用户实测反馈修复 (5 phases, shipped 2026-06-27, tag v3.2)
**Active milestone:** v3.4 — M8 plugin system 重构 (PLAN phase, 5 phases ship 待 execute + tag, 2026-06-28)
**v3.4 plan status:** 5/5 PLAN ship (42-PLAN fbd09fc + 43/44/45/46/47-PLAN); 5 BLOCKING 漂移修正 (D-42-A inventory §2.3 例外 / SHIP-A provider_switch 合并 / D-44-A mcp-management 删 / D-45-A ServiceRegistry Arc / D-CC-A PluginContext 4 字段 + &mut init); Phase 42 execute 未运行 (待 4 槽并发派单)。

### v3.4 architecture summary (PLAN 阶段交付设计)

**Plugin system 13 stub 重构** — 13 stub (10 业务 plugin + 3 service-plugin-shared core) 取代原 `commands/*.rs` 物理目录;`inventory::submit!` 编译期注册 IPC dispatch (`src-tauri/src/plugins/dispatch.rs` + `src-tauri/src/plugins/service_registry.rs`):

- **13 stub inventory** — Phase 42 SHIP-A 删 `provider_switch` (合并到 `provider_list`),Phase 46 删 `mcp_management` (D-44-A);剩 13 stub = 10 业务 (provider-list / import-sql / json-editor / usage-query / resource-browser / marketplace / optimizer / backup-restore / project-mode / history-view) + 3 service-plugin-shared (history / backup / provider) + 1 core (tray/AppMenu 注册化,Phase 43 引入)
- **commands = 80 (inventory::submit! 80 次注册 + DispatchTable 收集 80 项)** — Phase 42 验证 lib.rs 80 enumerate 与 grep 80 一致 (verify-first §0 误算 69 系早期 draft,42-PLAN 已修正回 80)
- **backend stub = 11 (含 provider_switch 删 stub)** / **frontend stub = 9** / **view = 11** (含 mcp-management,Phase 46 删 stub 后剩 10)
- **`ServiceRegistry` Arc 路径** (D-45-A) — `register_arc<T: Send + Sync + 'static>(Arc<T>)` + `get<T>() -> Option<Arc<T>>`;9 service 拓扑互注入用 Arc (借用检查器拒绝 &T 因 cycle),9 次 Arc clone 纳秒级忽略
- **`PluginContext` 4 字段** (D-CC-A) — `app: &AppHandle` + `paths: &Arc<dyn IPlatformPaths>` + `services: &mut ServiceRegistry` (Phase 42) + `host: &PluginHost` (Phase 43);`IPlugin::init(&mut self, ctx: &mut PluginContext)` 一次性付清
- **9 service plugin + 拓扑序 init** (Phase 45) — `topological.rs` DFS 3-color + DAG / cycle / missing dep / multi-deps 4 单测;`PluginHost::init_all_topological` 拓扑序 init (refcount=1 时 `Arc::get_mut` OK),`get_service!` macro 解引用 Arc;AppState 9 字段 `Arc<crate::services::>` → 0 (缩到 < 50 行),真实 12 处 `state.<svc>_service.xxx` (非 28) 改 `get_service!`
- **frontend registry 派生** (Phase 44) — `src/plugins/registry.ts` 派生 5 导出 (`ALL_VIEW_IDS` / `ALL_VIEWS_ORDERED` / `PAGE_META` / `VIEW_META` / `VIEW_COMPONENTS: Map<ViewId, ViewComponentEntry>`);`FrontendPlugin` 扩 4 字段 (`viewId` / `pageMeta` / `componentEntry.component` / `componentEntry.propsBuilder`);`SidebarTile.migrateFrom` 字段就位 (Phase 46 启用);`useViewState.tsx` 删 12 项硬编码 ALL_VIEWS → re-export 自 registry;`App.tsx` 三元链 12 分支 → 查表;`AppSidebar.tsx` 删 12 项手写 VIEW_META → import 派生;`App.tsx:174-197` 兜底 useEffect 删,改 `VIEW_ID_MIGRATIONS` 硬编码 Map (Phase 46;Phase 44 ship 后二次重构为派生)
- **`MenuRegistry` + `core` plugin** (Phase 43) — `tray_items()` / `app_menu_items()` 扩 IPlugin 默认空 vec;`core` plugin (id="core",第一行注册) 接管 tray (lib.rs:308-329) + macOS AppMenu (lib.rs:380-386 + `platform/{macos,windows}/app_menu.rs` 全部删除);`IPlatformAppMenu` trait + `MacAppMenu` / `WindowsAppMenu` impl + `platform::runtime::app_menu()` factory 全部删除;`lib.rs::setup` 0 行 `MenuItem::with_id` / `on_menu_event`
- **macOS 真机验证 D6** (Phase 47 整合期) — AppMenu 4 submenu 可见 / tray icon / window chrome 正常 / dist 嵌入 `.app/Contents/Resources/`;沿用 v3.2 模式 (D6 暂缓) 失败 PARTIAL 不阻塞 ship
- **60 张视觉矩阵** (Phase 44 产出 + Phase 47 review) — 12 view × 5 主题 Playwright e2e 0 diff;M31 vibrancy 撤回后视觉等价 (新 AppHeader layout,无 `.topbar-center` / `.wc-btn` 类名)

### v3.4 强验收 (Phase 47 整合期)

- **"加 1 plugin 改 1 文件"** — 加 1 个 stub `stubs/_test_strong.tsx` + `registry.ts` 1 行 import + 1 行 `ALL_PLUGINS.push`,`git diff` 仅这 2 文件,不动 App.tsx / AppSidebar / useViewState / 任何 page (Phase 44 强验收)
- **"加 1 service 只动 1 文件"** — 写 1 个临时 test service plugin + `register_arc::<TestService>(Arc::new(TestService::new()))` 1 行,跑 `cargo build` 验证仅该文件 + `plugins/mod.rs` 注册 1 行变化,`commands/` / `lib.rs` 0 改动,验证后删 test service (Phase 45 强验收)
- **"删 1 view 改 1 文件"** — Phase 46 硬编码 `VIEW_ID_MIGRATIONS` Map 1 项,Phase 47 二次重构为派生 (migrateFrom 字段全 registry 派生),工作量 < 0.1 天 (Phase 46 强验收 双向 "加 view / 删 view")
- **smoke test 10/10 PASS** (CLAUDE.md §13.1 全项) — 含 dist 指纹 + WebView2 child + title + AppState 0 字段 + commands 0 行 `state.<svc>_service.` + App.tsx 0 stale-route 兜底
- **5 phase grep lint** — Phase 42: `lib.rs` 0 `generate_handler!` / Phase 43: `lib.rs` 0 `MenuItem::with_id` / Phase 44: `useViewState.tsx` 0 手写 ALL_VIEWS / Phase 45: `app_state.rs` 0 `Arc<crate::services>` / Phase 46: `mcp-management.tsx` 不存在
- **3 个 end-to-end lifecycle** — plugin (加 stub 1 行) / service (加 service plugin 1 行) / stale-route migration (v3.2 user `localStorage='mcp-management'` → v3.4 启动 → URL `?tab=mcp` + view=`resource-browser`)

## Current Milestone

- ✅ **v2.0 用户反馈修复 + 双模式 (M2.17 收尾 + M3.1~M3.10)** — 11/11 ship, smoke 7/7, tag v2.0
- ✅ **v3.0 功能完善 + updater 基础 (M3.11~M3.15 + M4.3)** — round 1 (Phase 12-17) shipped 2026-06-22; round 2 (M3.13.x bug fix + Phase 21 SQLite) shipped 2026-06-23
- ✅ **v3.0-M4 e2e 框架** — Phases 1-4 shipped 2026-06-26 (tag v3.0-M4); 14/14 scenarios PASS, test-all stage 6 hard-fail wired
- ✅ **v3.0.1 M5 用户 bug 修复 (33 bug)** — Phases 23-26 shipped 2026-06-26 (tag v3.0.1); 33/33 bug 修完; ClaudeManager.app 14M rebuild OK + 1 窗口 OK; test-all 6 阶段 PASS
- ❌ ~~**v3.0 round 3 (M4.3 updater UI + A3 云备份 + M4.6 长尾)**~~ — **2026-06-26 用户拍板废弃**;见 Out of Scope
- ✅ **v3.2 M6 用户实测反馈修复** — shipped 2026-06-27 (tag v3.2); 5 phases (27-31); critical 5 + 业务 7 真修/6 留空 + 重构 9 + A 类 5 + 整合 INT-01~06; 33/33 requirements satisfied; test-all 6 stages + M4 e2e 15/15 + ClaudeManager.app rebuild 14M
- 🚧 **v3.4 M8 plugin system 重构 (PLAN phase, 5 phases ship 待 execute + tag)** — 5/5 PLAN ship (42-PLAN commit fbd09fc + 43/44/45/46/47-PLAN); 5 BLOCKING 漂移修正 (D-42-A inventory §2.3 例外 / SHIP-A provider_switch 合并 / D-44-A mcp-management 删 / D-45-A ServiceRegistry Arc / D-CC-A PluginContext 4 字段 + &mut init); Phase 42 execute 未运行;待 4 槽并发派单 (Phase 42/43/44/45/46 5 阶段,每阶段强验收独立 + Phase 47 整合期 single-thread 串行); 13 stub (10 业务 + 3 service-plugin-shared + 1 core); `inventory::submit!` IPC dispatch; `ServiceRegistry` Arc 路径; 9 service plugin 拓扑序 init (DFS 3-color); frontend registry 派生 (ALL_VIEWS / PAGE_META / VIEW_META / VIEW_COMPONENTS 5 导出); `MenuRegistry` + `core` plugin; 60 张视觉矩阵;`git tag v3.4.0` 计划 (Phase 47)

## Requirements

### Validated

> Shipped and confirmed working. 完整 ship 清单见 `~/Desktop/ClaudeConfigManager-M1/`、`~/Desktop/ClaudeConfigManager-M2/` 与 `~/Desktop/ClaudeConfigManager-M3/`, 详细 git 提交见 git log。

- [x] **Tauri v2 scaffold + 托盘 + 最小化到托盘** — M1.1 (commit `2914342`)
- [x] **OS 抽象层 (8 traits × Win/Mac)** — M1.2 (commit `13290b3`)
- [x] **Plugin host + 12 stubs (F1~F24 全功能占位)** — M1.3 + 3 个 fix (commits `77e070a` + `050eac8` + `50abbe6` + `038aa4f`)
- [x] **Tauri capabilities with WHY 注释** — M1.4 (commit `cc47b7d`)
- [x] **Frontend deps + 设计系统 (Cream White #FAFAF7 tokens)** — M1.5 (commits `5b46d51`, `3343db5`, `e44972e`, `16c90ae`, `be955c3`)
- [x] **Rust backend deps + version lock (12 tauri-plugin-*)** — M1.6
- [x] **Autostart 集成 (Win 注册表 + Mac LaunchAgent)** — M1.7
- [x] **TDD + UI e2e 框架 (Vitest + Playwright + tauri-driver + CI)** — M1.8 (commit `6814a7a`)
- [x] **主窗口 framework + 12 路由占位 + 自定义 chrome + Liquid Glass** — M1.9.x (commits `6737fd3` ~ `04395dd`)
- [x] **Build/package/sign/CI matrix** — M1.10 (commit `d35b81a`)
- [x] **CI + framework invariants 文档 + 3 阶段 review** — M1.11 (commit `d79575d`)
- [x] **最终自审 + brainstorm + peer review + 业务流分析** — M1.12 (commit `9776ee9`)
- [x] **F1 provider-list + F3 import-sql + F4 deeplink-import** — M2.1/M2.2/M2.3
- [x] **F2 provider-switch (原子备份→写入→reload Claude)** — M2.4
- [x] **F6 MCP 管理 (6 commands)** — M2.5
- [x] **F13 备份 + F19 恢复 (自动备份 + 字段级 diff)** — M2.6
- [x] **F7 用量查询 (5-min cache + fallback)** — M2.7
- [x] **F8 单文件部署 (drag-drop + 导出 .json)** — M2.8
- [x] **F18 优化器 (13 内置规则 + auto-backup)** — M2.9
- [x] **Theme 3-state + AppHeader chrome cluster** — M2.10
- [x] **F9 search (QuickSearchModal + fuzzy + 历史)** — M2.11
- [x] **kill-app.sh 修复 + scripts/tests** — M2.12
- [x] **F16 resource-browser (5 类资源 + reveal)** — M2.13
- [x] **F15 error feedback 横切 (shared ErrorBanner)** — M2.14
- [x] **Page padding/h1 字号统一 (polish)** — M2.15
- [x] **9 new plugins + macOS compat + splash + cleanup** — M2.16 (commit `d820b82`)
- [x] **M2.17 收尾期 (D9/D10/F15-batch4)** — commit `03e062a` + `f7196e8` + `c724f9a`
- [x] **M3.1 启动优化** — commit `f7196e8`
- [x] **M3.2 F2/托盘/InfoBar polish** — commit `0731b76` + `0023e09`
- [x] **M3.3 配置优化 16 规则** — M-finalize
- [x] **M3.4 资源市场重构** — commit `5e06296` + `c8d17f5`
- [x] **M3.5 资源浏览修 bug** — commit `e040a48`
- [x] **M3.6 Provider CRUD** — M-finalize
- [x] **M3.7 单文件部署重构 + 关于页** — M-finalize
- [x] **M3.8 用量查询 (cc-switch JSONL)** — D14 D 选
- [x] **M3.9 SQL 导入命名 + 校验** — commit `3ed3ff3`
- [x] **M3.10 双模式 用户/项目** — commit `98429b5`
- [x] **v3.0 round 1 (Phase 12-17, 2026-06-22)**:
  - A1 plugin 适配 13/13 (F5/F18/F1/F3/F6/F13/F19/F16/F17/F7) — commits `f375bf1` / `2e4e75b` / `afd090e` / `8a2650f` / `a9bd4b5` / `f145d38`
  - B3#10 Tailwind 移除 (6 包 + cn util + dead className + 注释) — commit `ed5a3e5`
  - B2#1 usage fixture 8 子任务测试 — commit `4f5df37`
  - A3 备份增量 Phase 1 (skip identical snapshots) — commit `3eadae2`
  - L-M2.08 MacWindowChrome 架构统一 (trait dispatch) — commit `7efb0f8`
  - M4.3 updater Phase 1 (真实 pubkey + GitHub endpoint) — commit `da6ba67`
- [x] **v3.0-M4 e2e 框架 (Phases 1-4, 2026-06-26, tag v3.0-M4)** — 14/14 scenarios PASS + test-all stage 6 hard-fail wired
- [x] **v3.0.1 M5 用户 bug 修复 (Phases 23-26, 2026-06-26, tag v3.0.1)** — 33/33 bug 修完 + ClaudeManager.app 14M rebuild OK + 1 窗口 OK + test-all 6 阶段 PASS
- [x] **v3.2 M6 用户实测反馈修复 (Phases 27-31, 2026-06-27, tag v3.2)** — critical 5 + 业务 7/13 真修 + 重构 9 + A 类 5 + 整合 INT-01~06 + 33/33 requirements satisfied + test-all 6 stages + M4 e2e 15/15 + ClaudeManager.app rebuild 14M

### Active

> v3.4 进行中:5/5 PLAN ship (42-PLAN commit fbd09fc + 43/44/45/46/47-PLAN);5 BLOCKING 漂移修正已锁;Phase 42 execute 未运行;待 4 槽并发派单。

- [ ] **Phase 42: v3.4 IPC dispatch (inventory::submit! + ServiceRegistry Arc + 13 stub 全迁移)** — PLAN ship (commit fbd09fc, 567 行);execute 未运行;强验收:13 stub 全迁移 + 80 inventory 注册 + lib.rs/commands/ 0 改动验证
- [ ] **Phase 43: v3.4 MenuRegistry + core plugin + tray/AppMenu 注册化** — PLAN ship (998 行);execute 未运行;强验收:lib.rs 0 行 `MenuItem::with_id`/`on_menu_event` + `platform/*/app_menu.rs` 全部删
- [ ] **Phase 44: v3.4 前端 route 派生化 (registry 派生 ALL_VIEWS + AppSidebar/App 三元链收敛 + 60 视觉矩阵)** — PLAN ship (576 行);execute 未运行;强验收:"加 1 plugin 改 1 文件" + `useViewState.tsx` 0 手写 ALL_VIEWS
- [ ] **Phase 45: v3.4 Service Plugin 拓扑序初始化 + AppState 收缩 (9 service plugin + DFS 3-color + get_service! macro + 12 处替换)** — PLAN ship (887 行);execute 未运行;强验收:"加 1 service 只动 1 文件" + `app_state.rs` 0 `Arc<crate::services>` 字段
- [ ] **Phase 46: v3.4 stale-route 清理 (VIEW_ID_MIGRATIONS + 删 mcp-management stub 5 文件)** — PLAN ship;execute 未运行;强验收:"删 1 view 改 1 文件" + v3.2 user `localStorage='mcp-management'` → URL `?tab=mcp` 升级路径打通
- [ ] **Phase 47: v3.4 整合 + macOS 真机验证 + 视觉回归 + tag v3.4.0** — PLAN ship;single-thread 串行;待 42-46 全部 ship 后启动;10/10 强验收 + 60 视觉 0 diff + git tag v3.4.0

### Out of Scope

- ❌ **其他 Claude client 应用 (Codex / Cursor / Gemini / OpenCode)** — SPEC.md §1.4 硬约束;v3.0/v4.0+ 不考虑
- ❌ **云同步 / 多人协作** — SPEC.md §1.4 硬约束;无服务器依赖
- ❌ **M2.17 业务 4 槽之外的新功能** — 4 槽上限 (D11);不插队
- ❌ **macOS 应用商店 / Microsoft Store 上架** — M4.5 用户拍板不上架;v4.0+ 之前不会重提
- ❌ **M4.1 代码签名证书** — 用户拍板不买;M4.2/M4.4 暂缓
- ❌ **D6 Mac 真机验证** — 用户拍板不处理;v3.0 期间不启动
- ❌ **v3.0 round 3 (A3 云备份 + M4.3 updater UI + M4.6 长尾)** — 2026-06-26 用户拍板废弃;project 停在 v3.0.1,如需重提需用户重新拍板

## Context

- **技术栈定型**: Tauri v2 已在 EVALUATION-REPORT.md (`.planning/research/EVALUATION-REPORT.md`) 中对比 7 框架后确认最佳 (包体积 / 内存最低 + 系统 webview + Rust + 跨平台)
- **架构纪律**: 见 `D:\project\winui3\CLAUDE.md` §2-11 (架构先行 / TDD / 版本锁 / 谨慎修改 / UI 一致性 / 三层测试 / 评审纪律 / 4-slot concurrent subagent / iteration ship 流程)
- **当前进度**: M1 + M2 + v2.0 (M2.17 + M3.1~M3.10) 全 ship;v3.0 round 1 (Phase 12-17) + v3.0-M4 e2e (Phase 1-4) + v3.0.1 (Phase 23-26) + v3.2 (Phase 27-31) 全 ship;v3.4 (Phase 42-47) 5/5 PLAN ship + execute pending
- **v3.0 goal**: "M3.10 双模式落地 + 测试补齐 + updater 基础 + Tailwind 闭环" (D16 2026-06-22)
- **v3.0 排除**: M4.1 证书 / M4.5 商店 / D6 Mac 真机 / M4.2 / M4.4 (用户拍板 2026-06-22)
- **v3.4 goal**: "M8 plugin system 重构 — 13 stub inventory::submit! IPC dispatch + ServiceRegistry Arc 路径 + 9 service plugin 拓扑序 + frontend registry 派生 + MenuRegistry + 60 视觉矩阵" (D-42-A / SHIP-A / D-44-A / D-45-A / D-CC-A 5 BLOCKING 已锁 2026-06-28)
- **v3.4 强验收** (Phase 47 整合期 10/10 PASS): "加 1 plugin 改 1 文件" (Phase 44) + "加 1 service 只动 1 文件" (Phase 45) + "删 1 view 改 1 文件" (Phase 46) + smoke test 10/10 (CLAUDE.md §13) + 5 phase grep lint + 3 end-to-end lifecycle
- **桌面状态**: `~/Desktop/ClaudeConfigManager-M1/` (5 exes) + `~/Desktop/ClaudeConfigManager-M2/` (26+ exes) + v3.0 round 1 ships; D8 抽查 + D9 归档策略
- **Review 文档**: `docs/REVIEWS/M1-REVIEWS.md` + `docs/REVIEWS/M2-REVIEWS.md` 已归档
- **M3 草案详细**: `docs/milestones/M3-issues-and-roadmap.md` (359 行, 27 用户反馈 + M3.1~M3.10 + M4.1~M4.6 + D6~D13 决策)
- **v3.0 草案详细**: `.planning/milestones/v3.0-EXECUTION-PLAN.md` (Wave 1/2/3 派单顺序 + 4 个决策点)
- **v3.4 草案详细**: `.planning/milestones/v3.4-DECISIONS.md` (209 行, 5 BLOCKING 关闭) + `.planning/milestones/v3.4-phases/00-VERIFY-FIRST-DRIFT-REPORT.md` (698 行, 漂移报告) + 6 份 PLAN.md (42-47, 共 5387 行)

## Constraints

- **Tech stack**: Tauri v2 + React + TypeScript + Vite + shadcn/ui + Tailwind + Rust. 禁止换栈 (CLAUDE.md §2.3).
- **依赖版本**: 全部锁在 `Cargo.lock` / `package-lock.json`. 禁止"依赖不行就换版本" (CLAUDE.md §2.3).
  - **v3.4 例外白名单** (D-42-A 用户拍板 2026-06-28): `inventory = "=0.3.24"` (dtolnay 维护, 6+ 年稳定, MIT/Apache, 编译期 plugin 注册必需;PR 描述必记例外理由)
- **目标平台**: Windows 11 (开发主) + macOS 26 (Tahoe). Linux 不在范围.
- **Tauri release build**: 必须 `--features tauri/custom-protocol` 否则 webview 加载 vite dev server 报 ERR_CONNECTION_REFUSED (CLAUDE.md §9 + memory `feedback/tauri-v2-custom-protocol-required`). 脚本 `scripts/build-and-ship.sh` 已固化.
- **Smoke test**: 必须 7/7 通过 (含 WebView2 child + title + dist fingerprint). 不允许跳过 (CLAUDE.md §9.4).
  - **v3.4 扩展** (CLAUDE.md §13.1): 10/10 PASS, 含 dist 指纹 + WebView2 child + title + AppState 0 字段 + commands 0 行 `state.<svc>_service.` + App.tsx 0 stale-route 兜底
- **4 槽并发上限**: M2.17 / M3 / v3.4 启动门 ≤4 subagent 同时 (D11); v3.4 Phase 47 整合期 single-thread 串行独占 1 槽
- **macOS 真机验证**: M2/M3 / v3.4 阶段 Windows dev box 上 mac impl 是 compile-only stubs;Mac 真机验证 D6 暂缓待 M4 启动前再问.
- **SPEC.md 只读**: 不可修改 (`D:\project\winui3\SPEC.md` 实现唯一参考).
- **v3.4 plugin system 强验收** (Phase 47 整合期 fail-fast, 任何 1 项不通过则 fail-fast 返回对应 phase fix):
  - **"加 1 plugin 改 1 文件"** (Phase 44): 加 1 stub `stubs/_test_strong.tsx` + `registry.ts` 1 行 import + 1 行 `ALL_PLUGINS.push`, `git diff` 仅这 2 文件, 不动 App.tsx / AppSidebar / useViewState / 任何 page
  - **"加 1 service 只动 1 文件"** (Phase 45): 加 1 service plugin + `register_arc::<TestService>(Arc::new(TestService::new()))` 1 行, `cargo build` 验证仅该文件 + `plugins/mod.rs` 注册 1 行变化, `commands/` / `lib.rs` 0 改动
  - **"删 1 view 改 1 文件"** (Phase 46 双向): 删 view 涉及 5 文件 (stub + mod + registry + test + App.tsx), App.tsx 三元链不动 + useViewState 核心逻辑不动; Phase 47 二次重构为派生 (migrateFrom 字段全 registry 派生) 后, 加/删 view 改 1 文件
  - **PluginContext 4 字段冻结** (D-CC-A): `app` + `paths` + `services(&mut)` + `host`; `IPlugin::init(&mut self, ctx: &mut PluginContext)` 一次性付清
  - **ServiceRegistry Arc 路径** (D-45-A): `register_arc<T: Send + Sync + 'static>(Arc<T>)` + `get<T>() -> Option<Arc<T>>` 字节级匹配

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| **Tauri v2 over Electron/Flutter/MAUI/Avalonia/Wails/Qt** | EVALUATION-REPORT.md 详细对比,包体积/内存/生态综合最优 | ✓ Good (M1~M2 全部 ship 验证) |
| **`cargo build --release --features tauri/custom-protocol`** 而非 `tauri build` | 同样 embed,更快迭代,但 feature flag 强制 (memory `feedback/tauri-v2-custom-protocol-required`) | ✓ Good (M2.17-C3 已切到 `tauri build`) |
| **Smoke test 必须验证结构标记** (WebView2 child + title + dist fingerprint) | 原 4-test 版本 false positive,blank/ERR 都通过 | ✓ Good (Test 5/6/7 已加,捕获过回归) |
| **macOS impl = Windows dev box 上 compile-only stub** | CLAUDE.md §3.2 + Mac dev box 暂不可用 | ⚠️ Revisit (D6 待 M4 启动前问) |
| **CLAUDE.md = 项目级 (非全局)** | 用户选择 2026-06-19;跨项目 Windows 工具入全局 memory | ✓ Good |
| **D7**: F15 ErrorBanner 扩到全部页面 (M3.2 顺手做) | 一致性 > 部分覆盖 | — Pending |
| **D8**: 抽查 2 个 M2.16 ship exe (review-fixes + f15-batch2) | 26+ exe 逐个审不现实,抽查覆盖 CRITICAL/HIGH + 横切 | — Pending (待用户运行) |
| **D9**: M2.16 26+ exe 桌面清空到归档 (`.archive/2026-06-21-m2.16-final/`) | 桌面堆积,保留 D8 抽查 2 个作代表 | — Pending (M2.17 启动时执行) |
| **D10**: 17 MEDIUM/LOW 已知限制按 M2.16-001-M~010-M 顺序全评估 | 不修但必须评估,避免遗漏 | — Pending |
| **D11**: M2.17 + M3 + v3.4 启动门 4 槽并发首批全选 | 最大化 4 槽利用率 | — Pending (M2.17 首批完成) |
| **D12**: 清单 20 (JSON 编辑器路径 bug) 挂入 M3 启动门槽 3,**不**插队 | P0 但需充分测试,启动门半日可消化 | — Pending |
| **D13**: 清单 15 reveal 报错按 M3.5 排期 | P1,不与 D12 抢启动门 | — Pending |
| **D14**: M3.8 用量查询方向 (A 重写 / B 修 stub / C 外部 API) — **待用户拍板** | 决定 M3.8 技术路线,**主 session 必问** | — **BLOCKED** |
| **D-42-A (v3.4)**: `inventory = "=0.3.24"` 走 CLAUDE.md §2.3 例外白名单 | Phase 42 IPC dispatch 编译期 plugin 注册唯一可行路径;dtolnay 6+ 年稳定;tracing-subscriber/wgpu 同样依赖模式;0 前端改动, 0 性能损失 | ✓ Locked (2026-06-28) |
| **SHIP-A (v3.4)**: `provider_switch` 合并到 `provider_list` | F1+F2 同一组功能(激活按钮在 provider-list 页面),前后端对齐 9 stub;`plugin-registry.test.ts:6` 已 pin "F2 merged into F1" 设计意图 | ✓ Locked (2026-06-28) |
| **D-44-A (v3.4)**: `mcp-management` stub 由 Phase 46 删 (D-44-A) | Phase 44 范围是"派生收敛"非"删除";Phase 46 `SidebarTile.migrateFrom` 才有完整迁移机制;前后端 + 注释 + useEffect 一次性删 5 文件 | ✓ Locked (2026-06-28) |
| **D-45-A (v3.4)**: `ServiceRegistry` API 统一 Arc 路径 | `register_arc<T>(Arc<T>)` + `get<T>() -> Option<Arc<T>>`;9 service 拓扑互注入 cycle 必须 Arc,借用检查器拒绝 &T;9 次 Arc clone 纳秒级 | ✓ Locked (2026-06-28) |
| **D-CC-A (v3.4)**: `PluginContext` 冻结 4 字段 + `&mut` init 签名 | `app` + `paths` + `services(&mut)` + `host`;10 stub 重编译不可避免,但一次性付清避免 Phase 45 BC 损失;`IPlugin::init(&mut self, ctx: &mut PluginContext)` | ✓ Locked (2026-06-28) |

---

*Last updated: 2026-06-28 — v3.4 (M8 plugin system 重构) 5/5 PLAN shipped (42-PLAN commit fbd09fc + 43/44/45/46/47-PLAN);5 BLOCKING 漂移修正 (D-42-A inventory §2.3 例外 / SHIP-A provider_switch 合并 / D-44-A mcp-management 删 / D-45-A ServiceRegistry Arc / D-CC-A PluginContext 4 字段 + &mut init); Phase 42-46 execute pending; Phase 47 整合期 single-thread 串行 + git tag v3.4.0 计划*
</content>
</invoke>