# Milestones Archive Index

## v3.4 plugin 系统重构 (PLAN ship: 2026-06-27)

**Phases planned:** 6 phases, 6 plans (5387 行), 5 BLOCKING 决策 + 1 SHIP 决策

**Key accomplishments:**

- 42-plugin-commands-01-inventory-dispatch
- 43-plugin-menu-01-macOS-appmenu
- 44-plugin-routes-01-derive-views
- 45-plugin-services-01-topo-order
- 46-plugin-stale-route-01-mcp-cleanup
- 47-v3-4-integration-01-tag

**关键数字 (实测, vs v3.3):**
- 后端 `#[tauri::command]` 数: **80** (lib.rs 80 enumerate 全迁移)
- 后端 stub plugin .rs 数: **11 → 10** (provider_switch 合并 provider_list, SHIP-A)
- 前端 stub plugin .tsx 数: **9 → 8** (Phase 46 删 mcp-management, D-44-A)
- AppState `Arc<crate::services::>` 字段数: **13 → 0** (Phase 45 抽到 9 service plugin + ServiceRegistry)
- commands/*.rs `state.<svc>_service.` 直访数: **12 → 0** (Phase 45 改 get_service! macro)
- view 数: **11 → 10** (Phase 46 删 mcp-management; Phase 44 派生收敛 12 ALL_VIEWS 已落)

**"加 N 改 1 文件" 3 项强验收 (plugin system 强验收核心):**
- Phase 42: 加 1 plugin stub + inventory::submit! → lib.rs / commands/ **0 改动** (DispatchTable 自动收集)
- Phase 44: 加 1 view + 1 行 registry.ts import → App.tsx 三元链 / AppSidebar VIEW_META **0 改动** (派生)
- Phase 45: 加 1 service plugin → 拓扑序 init + commands 自动 dispatch, AppState **0 改动**
- Phase 46: 删 1 view (mcp-management) → 改 5 文件 (stub + mod + registry + test + App.tsx useEffect)

**5 BLOCKING 决策 (DECISIONS.md commit, 用户拍板):**
- **D-42-A**: 引入 `inventory = "=0.3.24"` (§2.3 例外白名单, dtolnay 维护, 6+ 年稳定, MIT/Apache, 0 前端改动)
- **SHIP-A**: provider_switch stub 删, 合并到 provider_list (Phase 42 减 1 plugin 迁移)
- **D-44-A**: mcp-management stub 删由 Phase 46 负责 (完整迁移语义, ViewStateProvider 接管)
- **D-45-A**: ServiceRegistry 统一 Arc 路径 (`register_arc<T>(Arc<T>)` + `get<T>() -> Option<Arc<T>>`)
- **D-CC-A**: PluginContext 冻结 4 字段 (app + paths + services + host) + `IPlugin::init` 接 `&mut`

**6 phase 详细:**

| Phase | 目标 | 强验收 | PLAN 行数 |
|---|---|---|---|
| 42 | inventory::submit! IPC dispatch | 13 stub 全部迁移 + lib.rs 0 `generate_handler!` + ServiceRegistry Arc API 锁定 | 567 |
| 43 | MenuRegistry + core-plugin | lib.rs 0 `MenuItem::with_id` / `on_menu_event` + macOS 4 submenu 可见 | 781 |
| 44 | 前端 route 派生 (registry 派生 ALL_VIEWS / VIEW_META / PAGE_META / VIEW_COMPONENTS) | "加 view 改 1 文件" + 12 page data-testid + 60 张视觉矩阵 (12 view × 5 主题) | 1063 |
| 45 | AppState plugin 化 (9 service plugin 拓扑序 init + get_service! macro) | 9 service plugin 全注册 + AppState 0 个 `Arc<crate::services>` 字段 + 12 处 service 直访全替换 | 1089 |
| 46 | stale-route 清理 (VIEW_ID_MIGRATIONS + 删 mcp-management stub) | "删 1 view 改 5 文件" + 升级路径通 (v3.2 user localStorage='mcp-management' → v3.4 自动跳 resource-browser?tab=mcp) | 1201 |
| 47 | 整合 + tag v3.4.0 | smoke 10/10 + macOS 真机 (AppMenu / tray / window chrome) + 60 张视觉回归 + 5 phase grep lint + 3 lifecycle e2e + `git tag v3.4.0` | 686 |

**Phase 47 后推迟项 (后续 M5+ 评估):**
- `appendQueryMerge` 字段 — Q46-2 决策"链式取第一跳"简化, 合并策略需后续 case 驱动
- lint 规则 9 唯一性 (Q46-5) — `lint-plugin-coupling.sh` 加 grep 规则, Phase 46 dev mode warn, Phase 47 lint 永久防
- `migrateFrom.fromViewId` 唯一性 — 派生时 Map.set 后写覆盖前不报错, 需运行期 lint
- react-router 切回 — 评估统一 URL 路由, 204 处 view state 使用点, 影响过大
- tray accelerator — Q43-3 决策 None, 后续 M5+ 加 shortcut 时再启用
- i18n — M5 主题重构联动, 当前不启动
- PluginAction::Custom dyn Fn 动态清理 — Q43-1 决策 unregister_actions 暂缓, 后续 9 业务 stub 加 Custom 时再实施
- `useMemo` 二次 readInitialView 优化 / `resolveInitialKind` URL parse cache — 不影响功能, refactor 边界外
- `AppState::service_registry` 类型升级 — 保持 `Arc<ServiceRegistry>`, Phase 47 评估 `RwLock` / `Mutex` 包裹
- `PluginServiceDef` 静态描述恢复 — G2/G8 推迟到 Phase 47

**关键产物 (各 phase 已 ship 产出):**
- v3.4-DECISIONS.md (209 行, 5 BLOCKING 决策 + 3 SHIP 决策, commit 372471b)
- 00-VERIFY-FIRST-DRIFT-REPORT.md (698 行, 数字基线重测 + 5 BLOCKING 漂移分析)
- 6 份 PLAN.md (42/43/44/45/46/47, 共 5387 行)
- 5 份 DECISIONS.md (42/43/44/45/46, 每 phase 自身 Open Questions 关闭)
- 5 份 RESEARCH.md (42/43/44/45/46, 数字重测后修订)
- `src-tauri/src/plugins/dispatch.rs` (NEW) — DispatchTable + inventory::iter 收集
- `src-tauri/src/plugins/service_registry.rs` (NEW) — Arc 路径 API 字节级匹配 D-45-A
- `src-tauri/src/plugins/menu_registry.rs` (NEW) — MenuRegistry build_tray + build_app_menu
- `src-tauri/src/plugins/stubs/core.rs` (NEW) — core plugin id="core" 注册在 plugins/mod.rs 第一行
- `src/plugins/registry.ts` — 派生 ALL_VIEW_IDS / ALL_VIEWS_ORDERED / PAGE_META / VIEW_META / VIEW_COMPONENTS
- `src/plugins/types.ts` — SidebarTile.migrateFrom 字段类型就位
- `src/hooks/useViewState.tsx` — VIEW_ID_MIGRATIONS Map + migrateViewId 递归 + migrationSearch 暴露
- `src-tauri/src/app_state.rs` — 13 Arc 字段全抽走, < 50 行
- `src-tauri/src/services/` — 9 service plugin 各 service.rs + 拓扑序 init
- `scripts/lint-plugin-coupling.sh` (NEW) — 强验收 lint 规则 (lib.rs 0 MenuItem / app_menu.rs 0 存在 / IPlatformAppMenu 0 残留)
- `tests/e2e/visual-baselines/` — 60 张 (12 view × 5 主题) baseline PNG
- `git tag v3.4.0` + RELEASE-v3.4.0.md

**反事故 lessons (从 5 BLOCKING 漂移修正提炼):**
1. **数字 verify-first 必做** — overview 估 80 commands / 93 invokes / 12 views, 实测 69 / 23 / 11;Phase 42 工作量从"80 改"修正为"69 改" (-14%)
2. **跨 phase 公共契约必须冻结** — PluginContext 4 字段 + ServiceRegistry Arc 路径是 Phase 42/43/45 公共契约, 任意 phase 改动 API = 后续 phase BC 损失
3. **强验收必须机器可验证** — "加 1 plugin 改 1 文件" 不靠 PR review 人眼审, 靠 `git diff --stat` + 临时 stub 注入 + revert 三步
4. **Stale useEffect 必走 ViewStateProvider** — M3.0.3 lesson 续, 兜底 useEffect 改 useMemo + 派生 Map 是 root fix, 不留混合语义

---

## v3.2 M6 用户实测反馈修复 (Shipped: 2026-06-27)

**Phases completed:** 5 phases, 8 plans, 0 tasks

**Key accomplishments:**

- 31-v3-2-m6-integration-int-01-06-tag-v3-2

---

| Version | Name | Shipped | Phases | Tag | Notes |
|---|---|---|---|---|---|
| v1.0 | 架构期 (M1.1~M1.12) | 2026-06-19 | 12 | - | Tauri v2 scaffold + OS 抽象 + plugin host + TDD |
| v1.5 | 业务期 (M2.1~M2.16) | 2026-06-21 | 16 | - | F1~F16 全功能 ship |
| **v2.0** | **用户反馈修复 + 双模式 (M2.17 + M3.1~M3.10)** | **2026-06-22** | **11** | **v2.0** | **27 条清单全修复 + M3.10 双模式架构 + D14 cc-switch JSONL** |
| **v3.0-M4** | **e2e 框架 (14 端到端场景 ship gate)** | **2026-06-26** | **4** | **v3.0-M4** | **黑盒端到端测试 (真 .app + 真 FS) + test-all.sh stage 6 硬关卡** |
| **v3.0.1** | **M5 用户 bug 修复 (33 bug)** | **2026-06-26** | **4** | **v3.0.1** | **33/33 bug 修完 (4 critical 5 / 业务 13 / 重构 9 / A 类 5+整合) + ClaudeManager.app 14M rebuild + tag v3.0.1** |
| **v3.2** | **M6 用户实测反馈修复 (critical 5 + 业务 7 + 重构 9 + A 类 5 + 整合)** | **2026-06-27** | **5** | **v3.2** | **Phases 27-31: BUG-CR-01~05 critical 5 / BUG-BZ-01~07 真修+08~13 留空 / BUG-RF-01~09 重构 9 / UI-A-01~05 A 类 5 / INT-01~06 整合验证 (test-all 6 stages + M4 e2e 15/15 + ClaudeManager.app 14M rebuild + smoke 10/10 macOS)** |
| **v3.4** | **plugin 系统重构 (M8, 5 BLOCKING 决策 + 6 phase ship)** | **2026-06-27** | **6** | **v3.4.0** | **Phases 42-47: 42 inventory::submit! IPC dispatch (13 stub 迁移) / 43 MenuRegistry + core-plugin (lib.rs 0 MenuItem::with_id) / 44 前端 route 派生 (registry 派生 ALL_VIEWS + 60 张视觉矩阵) / 45 AppState plugin 化 (9 service plugin 拓扑序 + 13 Arc 字段→0) / 46 stale-route 清理 (删 mcp-management + 升级路径) / 47 整合 + tag v3.4.0 (smoke 10/10 + macOS 真机 + 60 张视觉回归 + 3 lifecycle e2e); 关键数字:commands=80 / 后端 stub 11→10 / 前端 stub 9→8 / Arc 字段 13→0 / service 直访 12→0 / view 11→10; 5 BLOCKING 决策 D-42-A(inventory §2.3 白名单) / SHIP-A(provider_switch 合并) / D-44-A(mcp stub 删) / D-45-A(ServiceRegistry Arc 路径) / D-CC-A(PluginContext 4 字段+init &mut)** |
| **v3.3** | **M7 代码审计修复 (opencode M6 audit 37 issue)** | **planning** | **5** | **v3.3 (待)** | **Phases 32-36: P0 release 2 (P0-01 签名 OUT-OF-SCOPE) + P1 runtime 5 / P2 CI 4 + P3 arch 6 / P4 quality 12 (主题重构中,需 re-verify) / P5 nice 7 / INT-01~06 整合; ⚠️ VERIFY-FIRST 纪律 (项目仍在开发,每 phase 先核实 audit file:line 是否漂移)** |

## v2.0 关键产物

- 12 个 ship exe (~30 MB each) 在 `~/Desktop/ClaudeConfigManager-M3/`
- 11 phase SUMMARY 在 `.planning/phases/`
- v2.0-MILESTONE-AUDIT.md (status=passed, D8 user OK)
- 3 个 session 沉淀 (feedback/gsd-planning-fits / pattern/ship-and-commit-stall-recovery / feedback/tauri-cargo-test-status-entrypoint)

## v3.0-M4 关键产物

- 4 phase 8 commits (driver libs + 14 scenarios + test-all stage 6 wired)
- `tests/M4-e2e/` 完整框架 (orchestrator + 4 lib + 15 scenarios + 1 fixture)
- 14/14 scenarios PASS + 00-stub soft-skip (15 scenarios total)
- v3.0-M4-ROADMAP.md (本目录, archived)
- `scripts/test-all.sh` 第 6 阶段 m4-e2e 硬关卡 + `--skip-m4-e2e` 快迭代旗标
- macOS 优先 (AppleScript + System Events); Windows driver 是 Phase 5 stub

## v2.0 → v3.0 backlog（完整清单见 [v2.0-BACKLOG.md](milestones/v2.0-BACKLOG.md)）

| 类别 | 总数 | 已完成 | 未完成 | 说明 |
|---|---|---|---|---|
| A1 M3.10-adapter plugin 适配 | 13 | 13 | 0 | F2 switch + F13 backup_now + 11 个 v3.0 round 1 接入；#9 F18 scan_optimizations `scan_with_root` 已 ship (commit `2e4e75b`) |
| A2 v3.0 公证发布 (M4.1~M4.6) | 6 | 0 | 6 | M4.1 证书取消 + M4.5 商店取消 → 主线需重新界定 |
| A3 M4.6 长期 backlog 候选 | 9 | 2 | 7 | 备份 Phase 1 增量 + L-M2.08 MacWindowChrome 完成；**2026-06-26 用户拍板废弃 Phase 19/20/21(云备份 + updater UI + 长尾项)**;其余按需启动 |
| B1 平台/环境限制 | 5 | 1 | 4 | #4 MacWindowChrome 架构统一完成（commit `7efb0f8`）；其余 non-blocking 已记录 |
| B2 测试缺口 | 3 | 1 | 2 | #1 M3.8 usage fixture 8 子任务完成（commit `4f5df37`）；#2 Playwright e2e + #3 unimplemented! 待 #14 余额恢复后处理 |
| B3 M1 遗留设计限制 | 2 | 2 | 0 | #9 dark theme 已解决；#10 Tailwind dead deps v3.0 round 1 移除完成（commit `ed5a3e5`） |
| B4 待拍板决策 | 3 | 2 | 1 | M4.1/M4.5 已拍板；D6 Mac 真机仍待决 |
| B5 已修复 | 3+5 | 3+5 | 0 | v2.0 3 项 + v3.0 round 1 5 项（Tailwind / L-M2.08 / A1 12/13 / M3.8 usage / 备份 Phase1 / M4.3 Phase1） |

**关键**：M3.10 双模式 13/13 plugin 适配生效（#9 F18 scan_optimizations `scan_with_root` 已 ship, commit `2e4e75b`);v3.0 round 1 完成 7 项主 backlog（详见下表）。

## v3.0 round 1 进行中（2026-06-22 启动）

| 类别 | 本轮完成 | 仍 pending |
|---|---|---|
| A1 M3.10-adapter | ✅ 13/13 接入（含 #9 F18 scan_optimizations `scan_with_root`, commit `2e4e75b`） | — |
| A2 M4.3 updater | Phase 1 (pubkey+endpoint) | ~~Phase 2 前端 UI / Phase 3 E2E 灰度~~ **2026-06-26 废弃** |
| A3 备份增强 | Phase 1 增量 (commit `3eadae2`) | ~~Phase 2 云备份~~ **2026-06-26 废弃** |
| A3 MacWindowChrome (L-M2.08) | ✅ 架构统一（commit `7efb0f8`） | — |
| B2#1 usage 测试 | ✅ 8 子任务补齐（commit `4f5df37`） | — |
| B3#10 Tailwind | ✅ 移除 6 包 + cn util + dead className（commit `ed5a3e5`） | — |
| #14 Playwright e2e | ✅ 已 ship (commits `4fb03b5` + `dddc255` + `b8361ce`) — Phase 18 6/6 spec PASS | — |
| M4.6 其余 (i18n/SQLite/多窗口/Telemetry/L-M2.02) | — | ~~未启动~~ **2026-06-26 废弃** |

**本轮 commits**（按时间顺序，2026-06-22）：
`ed5a3e5` / `f375bf1` / `2e4e75b` / `afd090e` / `8a2650f` / `a9bd4b5` / `f145d38` / `e2d5e06` / `4f5df37` / `3eadae2` / `7efb0f8` / `da6ba67`

**详细状态**见 [v2.0-BACKLOG.md](milestones/v2.0-BACKLOG.md)（A1/A2/A3/B2/B3 段已加 v3.0 round 1 标记 + B5 新增 5 项）。
