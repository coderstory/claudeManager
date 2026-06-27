# Phase 47 PLAN — v3.4 整合 + macOS 真机验证 + 视觉回归 + tag v3.4.0

**Phase:** 47
**Goal:** 把 Phase 42 (IPC dispatch) / 43 (MenuRegistry + core-plugin) / 44 (前端 route 派生 + 65 张视觉矩阵) / 45 (9 service plugin + 拓扑序) / 46 (stale-route 迁移 + 删 mcp stub) 5 个 phase 全部 ship 后的产物**端到端跑通**,跑**强验收** (10/10 smoke test + 5 phase grep lint + 3 端到端 lifecycle),做**视觉回归** (60 张 12 view × 5 主题 Playwright e2e),跑** macOS 真机验证** (AppMenu 4 submenu / tray / window chrome),最后** git tag v3.4.0 + 更新 PROJECT/ROADMAP/MILESTONES**。

> **整合阶段 = single-thread 串行执行**(D11: 4 槽并发,Phase 47 本身必须独占,严禁 5 phase 并行 revisit)。任何 phase 42-46 子任务未 ship / 强验收失败 → Phase 47 fail-fast 返回上一 phase 修复,不能"绕过"。

---

## 0. 来源与依据 (input provenance)

- **输入 1** `.planning/milestones/v3.4-DECISIONS.md` (209 行,5 BLOCKING 已关闭,commit 372471b)
- **输入 2** `.planning/milestones/v3.4-phases/00-VERIFY-FIRST-DRIFT-REPORT.md` (698 行,5 BLOCKING 漂移分析 + 数字基线重测)
- **输入 3** `.planning/milestones/v3.4-phases/42-PLAN.md` (567 行,IPC dispatch 改造)
- **输入 4** `.planning/milestones/v3.4-phases/43-PLAN.md` (998 行,MenuRegistry + core-plugin)
- **输入 5** `.planning/milestones/v3.4-phases/44-PLAN.md` (576 行,前端 route 派生 + 65 张视觉矩阵)
- **输入 6** `.planning/milestones/v3.4-phases/45-PLAN.md` (887 行,9 service plugin + 拓扑序)
- **输入 7** `.planning/milestones/v3.4-phases/46-PLAN.md` (25549 字节,stale-route + 删 mcp stub)
- **输入 8** `.planning/milestones/v3.4-phases/{42,43,44,45,46}-DECISIONS.md` (5 份,每 phase 自身 Open Questions 关闭)
- **CLAUDE.md** §2.2 (TDD 强制) + §2.3 (版本锁) + §2.4 (证据优先) + §10 (不修改 SPEC.md) + §11 (主 session 只决策) + §13 (smoke test 10 项 + custom-protocol) + §15 (macOS 真机验证)
- **基线数字 (v3.4 verify-first 2026-06-27 23:55)**:
  - view = 11 (基线;Phase 46 删 mcp-management stub 后剩 8 stub view)
  - commands = 69 (Phase 42 实际迁移数,非 80)
  - invoke = 23 (全 src) / 14 (api/)
  - useViewState 引用 = 121 (排 test/setup)
  - 后端 stub = 13 (10 业务 + 4 新 + 1 core - 1 删 provider_switch = 13,含 core)
  - 前端 stub = 9 (Phase 44) → 8 (Phase 46 删 mcp-management)
  - 60 张视觉矩阵 (12 view × 5 主题)
- **前提**: Phase 42-46 各自已 ship + 各自单测 PASS + 各自强验收内部已通过 (Phase 47 不重做 phase 内单测,只跑跨 phase 整合验证)

---

## 1. Goal (强验收 = phase 完成标准)

> **核心强验收 (CLAUDE.md §13 + §15 + 5 phase DECISIONS §强验收)**:
> 1. **整合 smoke test** `cargo build --release --features tauri/custom-protocol` + 10/10 项 smoke test PASS (CLAUDE.md §13,含 dist 指纹 + WebView2 child + title)
> 2. **macOS 真机验证** (CLAUDE.md §15,D6 真机验证):AppMenu 4 submenu 可见 / tray icon / window chrome 正常 / dist 嵌入 `.app/Contents/Resources/`
> 3. **60 张视觉回归** (Phase 44 产出 + Phase 47 review):12 view × 5 主题 Playwright e2e 0 diff
> 4. **end-to-end plugin lifecycle 强验收** (Phase 42 强验收):加 1 plugin stub + registry.ts 1 行 → smoke + visual PASS (不改 lib.rs / commands/)
> 5. **end-to-end service lifecycle 强验收** (Phase 45 强验收):加 1 service plugin stub → topological init + commands dispatch PASS (不改 lib.rs setup)
> 6. **end-to-end stale-route migration** (Phase 46 强验收):v3.2 user `localStorage='mcp-management'` → v3.4 启动 → URL `?tab=mcp` + view=`resource-browser`
> 7. **5 phase grep lint 全 PASS** (强验收):
>    - Phase 42: `src-tauri/src/lib.rs` 0 `generate_handler!` + 0 `tauri::command` 嵌套 `inventory::iter()`
>    - Phase 43: `src-tauri/src/lib.rs` 0 `MenuItem::with_id` + 0 `on_menu_event` + `src-tauri/src/platform/{macos,windows}/app_menu.rs` 不存在
>    - Phase 44: `src/hooks/useViewState.tsx` 0 手写 ALL_VIEWS / `src/App.tsx` 0 `view ===` 三元链 / `src/components/AppSidebar.tsx` 0 手写 VIEW_META
>    - Phase 45: `src-tauri/src/commands/*.rs` 0 `state.<svc>_service.` / `src-tauri/src/app_state.rs` 0 `Arc<crate::services>` / 9 service 拓扑序单测 PASS
>    - Phase 46: `src/App.tsx` 0 stale-route 兜底 / `src/plugins/stubs/mcp-management.tsx` 不存在 / `src/__tests__/plugin-registry.test.ts` 8 stub
> 8. **git tag v3.4.0** 含 release notes:列出 5 phase 主要改动 + 5 BLOCKING 决策 + 验证证据 (smoke 10/10 + lint 5/5 + visual 60/60 + lifecycle 3/3)
> 9. **PROJECT.md / ROADMAP.md / MILESTONES.md 更新** (后续 task)
> 10. **STATE.md / Lessons learned**:M3.0.3 lesson 续 (M31 vibrancy 撤回记录) + v3.4 lessons (5 BLOCKING 漂移修正经验)

**Done 判定**:**10/10 强验收项全部 PASS + git tag v3.4.0 + 4 份 manifest 已更新**。

---

## 2. 工作量与估时

| 项目 | 估值 | 来源 |
|---|---|---|
| 强验收 smoke test (10 项) | 0.5 天 (1 跑 10/10 + 1 修微调) | CLAUDE.md §13 |
| macOS 真机验证 (D6,4 子项) | 0.5 天 (搭环境 + 验证 + 截图证据) | CLAUDE.md §15 |
| 60 张视觉回归 (Playwright) | 0.8 天 (60 张 review + 0 diff 确认) | Phase 44 强验收 |
| 3 个 end-to-end lifecycle 强验收 | 0.5 天 (plugin + service + stale-route 各 1 验证脚本) | Phase 42/45/46 强验收 |
| 5 phase grep lint 总扫 | 0.3 天 (5 phase 各 1 遍 grep + 0 mismatch 确认) | DECISIONS §强验收 |
| git tag v3.4.0 + release notes | 0.2 天 (1 文件 RELEASE-v3.4.0.md + 1 git tag + 1 push) | CLAUDE.md §9 |
| 4 份 manifest 更新 | 0.3 天 (PROJECT + ROADMAP + MILESTONES + STATE 各 1 遍 edit) | 流程纪律 |
| STATE.md lessons + RETROSPECTIVE | 0.2 天 (v3.4 lessons + M31 vibrancy 撤回续) | M3.0.3 lesson |
| **合计** | **~3.3 天 (单线程串行,1 槽独占)** | 单 Phase 47,不并发 |

**Phase 47 自身不写新功能代码**(整合阶段);代码改动只限于:
- 修强验收发现的 bug (e.g. 视觉 diff / smoke 失败)
- 强验收 verification script 新增 (`lint-plugin-coupling.sh` 规则 9 + `verify-e2e-lifecycle.sh`)
- 文档更新 (RELEASE / PROJECT / ROADMAP / MILESTONES / STATE)
- git tag

**严禁 Phase 47 触碰 Phase 42-46 的实现代码** (违反 CLAUDE.md §2.4 "禁止既然要改顺便把 X 也改了")。任何 phase 42-46 子任务漏 ship / 验收失败 → fail-fast 派回对应 phase 的 fix-task。

---

## 3. 任务拆分 (Tasks)

按 强验收 → 视觉回归 → lifecycle → lint → release notes → manifest → tag → lessons 顺序,**单线程串行**,9 个 task,5 个 wave:

```
Wave 0 (build 验证):   Task 1 (整合 build + smoke test)
Wave 1 (macOS):        Task 2 (macOS 真机验证 D6)
Wave 2 (视觉 + lifecycle): Task 3 (60 张视觉回归) → Task 4 (3 个 end-to-end lifecycle) → Task 5 (5 phase grep lint 总扫)
Wave 3 (release):      Task 6 (RELEASE-v3.4.0.md) → Task 7 (4 份 manifest 更新) → Task 8 (git tag v3.4.0)
Wave 4 (lessons):      Task 9 (STATE.md lessons + RETROSPECTIVE)
```

---

## 4. 风险与缓解 (Phase 47 整合阶段专属)

### 高风险 #1 — Phase 42-46 任一未 ship (HARD BLOCKER)

**风险**: 任何 1 个 phase 在 Phase 47 启动时未 ship (内部单测失败 / 强验收未跑 / 子任务未 commit),Phase 47 fail-fast。

**缓解**:
- Phase 47 启动前置门:`git log --oneline` 检查 5 phase commit 全部存在
- pre-build 检查 (Task 1 step 2-4):13 stub + 8 stub + VIEW_ID_MIGRATIONS 派生就位
- 任何 1 项 pre-build FAIL → 派对应 phase 修复 → Phase 47 暂停
- **无绕路**:禁止 Phase 47 直接修 phase 42-46 代码 (违反 §2.4 谨慎修改文件)

### 高风险 #2 — macOS 真机验证 D6 暂缓 (CLAUDE.md memory)

**风险**: macOS dev box 不在当前 session / D6 用户已宣布暂缓 → Task 2 fail 或推迟。

**缓解**:
- Task 2 标 "PARTIAL PASS 标注":截图缺失时,RELEASE notes 明文 "macOS 真机验证待 M4 启动前再问" (沿用 v3.2 release 模式)
- 强验收 2 状态:`PASS-partial` / `PASS-full` 二态,不阻塞 ship
- macOS 真机验证已 ship 的部分 (lib.rs 0 MenuItem::with_id / platform/*/app_menu.rs 不存在) 仍是强验收项 7 必过

### 高风险 #3 — visual regression 任何 1 张 diff (HARD BLOCKER)

**风险**: 60 张视觉矩阵任何 1 张 diff → 阻塞 ship。

**缓解**:
- 0 张 diff → 强验收 PASS
- < 5 张 diff → 逐张确认是否预期,接受则更新 baseline + 复跑 1 次
- ≥ 5 张 diff → 派 phase 44 fix-task (派生收敛代码 bug) 或 design-system fix-task (主题 bug)
- 60 张逐张 review 是 Phase 47 整合阶段最耗时 task (0.8 天预算)
- baseline 更新必须记录在 visual-review.md (Phase 47 审计痕迹)

### 高风险 #4 — git tag v3.4.0 不可逆 (HARD BLOCKER)

**风险**: git tag 一旦 push,后续回滚需要 force push + 通知所有协作者 → 强验证后才允许 tag。

**缓解**:
- git tag 前必须 10/10 强验收 PASS (Task 1-5 全绿)
- tag 命令用 `git tag -s v3.4.0 -m "..."` (GPG 签名,不可伪造)
- push tag 前用户复核 (CLAUDE.md §11 主 session 决策)
- 失败回滚预案:tag 后 24h 内发现 critical bug → `git tag -d v3.4.0` 本地删 + 不 push;已 push → 通知 + `git push origin :refs/tags/v3.4.0` (需用户白名单)

### 高风险 #5 — 4 槽并发 + Phase 47 single-thread 串行 (D11)

**风险**: D11 = 4 槽并发上限,Phase 47 本身必须独占 1 槽;其它 3 槽可派 plan-fix subagent 处理 phase 42-46 漏 ship。

**缓解**:
- Phase 47 启动前确认主 session 任务列表只 Phase 47 + 1 个 plan-fix subagent
- 任何 1 个 phase 42-46 漏 ship → 派 1 个 plan-fix subagent (占 1 槽);Phase 47 自身 + plan-fix subagent 共 2 槽;剩 2 槽闲置
- Phase 47 自身在 Task 1-5 不并发 (整合阶段特性),Task 6-9 文档类可短并发 (但当前 PLAN 仍串行,简化协调)

### 中风险 #6 — Phase 47 触碰 phase 42-46 实现代码 (CLAUDE.md §2.4)

**风险**: Phase 47 整合阶段看到 smoke 失败 / lint 不通过时,可能 "顺手修" → 违反 "禁止既然要改顺便把 X 也改了"。

**缓解**:
- Task 1 step 9 明确:任何 phase 42-46 失败 → 派对应 phase 的 fix-task,Phase 47 不直接改
- 强验收 5 phase grep lint 由独立 script 执行 (Task 5),Phase 47 subagent 不能改 source
- 例外:Phase 47 强验收 script 自身 (`scripts/lint-plugin-coupling.sh` + `scripts/verify-e2e-lifecycle.sh`) 可以写,因为它们是 verification tools

### 中风险 #7 — Phase 47 强验收 script 误报

**风险**: 5 phase grep lint 用正则误判 e.g. `view === 'x'` 匹配到注释里的 `view === 'x' (deprecated)` → 误报。

**缓解**:
- grep script 用 `-v '^[[:space:]]*//'` / `-v '^[[:space:]]*\*'` 过滤注释行
- 每条 lint 规则跑前先 print "found N candidate matches (excluding comments) → manual review required"
- 0 candidate → 自动 PASS;≥ 1 candidate → 手动 review 每行 (不 auto-fail)

## 5. 推迟项 (已知,Phase 47 内不解决)

> 来自 5 phase DECISIONS §推迟到 Phase 47 段 + verify-first 报告 §6.2:
>
> - **Phase 45 G2/G8**: PluginServiceDef 静态描述恢复 (9 业务 plugin 可填 services() facade) — Phase 47 仅 review,不强制填
> - **Phase 45 G7**: app.manage 时机再优化 — Phase 47 验证 current 行为 OK 即可,不主动调优
> - **Phase 45 G10**: 9 service plugin 的 depends_on 微调 — 拓扑序由单测锁死,Phase 47 不重排
> - **Phase 46**: appendQueryMerge 字段 (Q46-2) / react-router 切回
> - **视觉矩阵某些 view 在特定主题下的可访问性修复** — Task 3 review 时记录为 known issue,延后 v3.5
> - **Phase 43**: tray accelerator 跨平台 / AboutMetadata i18n / PluginAction::Custom hot-reload
>
> 这些推迟项已计入 Phase 47 强验收 PASS 的 "known issue 列表",RELEASE-v3.4.0.md 内明文列出。
>
> **lint 规则 9 (Phase 46 Q46-5 fromViewId 唯一性)** 由 Phase 47 Task 5 `lint-plugin-coupling.sh` 实现,不属推迟项。

---

## 6. 详细任务 (Tasks)

### Task 1: 整合 build + smoke test 10/10 PASS (Wave 0, 0.5 天)

**目的**: 验证 5 phase 全部 ship 后,end-to-end build + launch + dist 嵌入 + WebView2 child + DB schema 可用,跑 CLAUDE.md §13 全部 10 项。

**文件** (验证命令执行,无新文件):
- `/Users/coderstory/CodeSource/winui3/scripts/build-and-ship.sh` (触发 release build)
- `/Users/coderstory/CodeSource/winui3/scripts/smoke-test.sh` (10/10 验证)
- `/Users/coderstory/CodeSource/winui3/scripts/kill-app.sh` (pre-cleanup)

**步骤**:
1. **build 前 sanity**: `git status` 确认 master 干净,5 phase PLAN + DECISIONS 文件全部 commit
2. **pre-build 检查**: `ls src-tauri/src/plugins/stubs/*.rs | grep -v mod | wc -l` 确认 13 stub
3. **pre-build 检查**: `ls src/plugins/stubs/*.tsx | grep -v mod | grep -v _Placeholder | wc -l` 确认 8 stub
4. **pre-build 检查**: `grep -c "VIEW_ID_MIGRATIONS" src/hooks/useViewState.tsx` ≥ 1
5. **build 命令**: `cd src-tauri && cargo build --release --features tauri/custom-protocol --no-default-features 2>&1 | tee /tmp/build-v34.log`
   - **强制** `--features tauri/custom-protocol` (CLAUDE.md §13.2 反事故)
   - **强制** `--no-default-features`
6. **vite build**: `npm run build`
7. **smoke test**: `./scripts/smoke-test.sh target/release/ClaudeConfigManager.exe` (10/10 全 PASS)
8. **失败处理**: FAIL → 派 fix-task 到对应 phase;3 轮仍 fail → 暂停派回用户决策

**验证命令**:
```bash
cd /Users/coderstory/CodeSource/winui3
git status  # clean
ls src-tauri/src/plugins/stubs/*.rs | grep -v mod | wc -l  # 13
ls src/plugins/stubs/*.tsx | grep -v mod | grep -v _Placeholder | wc -l  # 8
grep -c "VIEW_ID_MIGRATIONS" src/hooks/useViewState.tsx  # ≥ 1
cd src-tauri && cargo build --release --features tauri/custom-protocol --no-default-features 2>&1 | tee /tmp/build-v34.log
cd .. && npm run build 2>&1 | tee /tmp/vite-v34.log
./scripts/smoke-test.sh src-tauri/target/release/ClaudeConfigManager.exe
# expect: 10/10 PASS, exit 0
```

**Done 标准**: cargo build 成功 + vite build 成功 + smoke 10/10 + 产物 10-14 MB

**估时**: 0.5 天

---

### Task 2: macOS 真机验证 D6 (Wave 1, 0.5 天)

**目的**: 验证 Phase 43 MenuRegistry + core-plugin 在 macOS 真机上 (CLAUDE.md §15)。

**前置**: macOS dev box (Darwin 25.x / macOS 26 Tahoe) + Xcode CLT 已装

**文件** (无新代码文件,新增 4 份证据):
- `/Users/coderstory/CodeSource/winui3/.planning/milestones/v3.4-phases/macos-verify-{appmenu,tray,window-chrome}.png` (3 张)
- `/Users/coderstory/CodeSource/winui3/.planning/milestones/v3.4-phases/macos-verify-dist-embedded.txt`

**步骤**:
1. **macOS 环境检查**: `uname -s` (Darwin) + `sw_vers` (macOS 26.x) + `xcode-select -p`
2. **build 命令**: `cd src-tauri && cargo build --release --features tauri/custom-protocol --no-default-features` (首次 ~5-8 分钟)
3. **dist 嵌入校验**: `ls "$APP/Contents/Resources/" | grep -E "index\.html|assets"`
4. **AppMenu 4 submenu 验证**: `open "$APP"` + 截图 OS 顶栏 (ClaudeManager / Edit / View / Window)
5. **tray icon 验证**: 菜单栏图标 + 点击弹出 (显示主窗口 / 退出)
6. **window chrome 验证**: 主窗口 + traffic light 响应 + 截图
7. **关闭行为验证**: close → 隐藏不退出 (M31 lesson)
8. **cleanup**: `./scripts/kill-app.sh`
9. **失败处理**: FAIL → 截图保留 + 派 Phase 43 fix-task

**验证命令**:
```bash
cd /Users/coderstory/CodeSource/winui3
uname -s  # Darwin
sw_vers  # macOS 26.x
xcode-select -p  # /Library/Developer/CommandLineTools
cd src-tauri && cargo build --release --features tauri/custom-protocol --no-default-features
cd ..
APP="src-tauri/target/release/bundle/macos/ClaudeManager.app"
test -d "$APP" && ls "$APP/Contents/Resources/" | head -10
open "$APP"
sleep 3
osascript -e 'tell application "System Events" to get name of every process whose visible is true' | grep ClaudeManager
./scripts/kill-app.sh
```

**Done 标准**: 4 份证据就位 + 4 项验证 PASS

**估时**: 0.5 天

**风险**: D6 暂缓 → 标 PARTIAL PASS + RELEASE notes 明文

---

### Task 3: 60 张视觉回归 (Wave 2, 0.8 天)

**目的**: Phase 44 baseline + Phase 47 回归,12 view × 5 主题 = 60 张 Playwright e2e 0 diff。

**前置**: Phase 44 已 ship + visual-regression.test.ts + 60 张 baseline

**文件**:
- `/Users/coderstory/CodeSource/winui3/src/__tests__/visual-regression.test.ts` (Phase 44 产出)
- `/Users/coderstory/CodeSource/winui3/src/__tests__/visual-snapshots/` (60 PNG)
- 新增:`/Users/coderstory/CodeSource/winui3/.planning/milestones/v3.4-phases/visual-review.md`

**步骤**:
1. **baseline 校验**: `ls src/__tests__/visual-snapshots/*.png | wc -l` expect: 60
2. **测试运行**: `npx playwright test src/__tests__/visual-regression.test.ts 2>&1 | tee /tmp/visual-v34.log`
3. **diff 统计**: `grep -c "Failed\|diff" /tmp/visual-v34.log` expect: 0
4. **逐张 review**: 60 张按 view × 主题分组 review,检查视觉一致性
5. **diff 处理**: 0 diff PASS / <5 确认预期后更新 baseline / ≥5 派 fix-task
6. **evidence 记录**: visual-review.md (60 行 review 备注)

**验证命令**:
```bash
ls src/__tests__/visual-snapshots/*.png | wc -l  # 60
npx playwright test src/__tests__/visual-regression.test.ts 2>&1 | tee /tmp/visual-v34.log
grep -E "Failed|diff" /tmp/visual-v34.log | wc -l  # 0
```

**Done 标准**: 60 baseline + 60/60 PASS + visual-review.md 60 行

**估时**: 0.8 天

### Task 4: 3 个 end-to-end lifecycle 强验收 (Wave 2, 0.5 天)

**目的**: 跑 3 个 lifecycle 强验收,验证 5 phase 派生收敛 + service 拓扑 + stale-route 迁移都跨 phase 端到端工作。

**文件** (新增 1 个 verification script + 临时 stub 跑完删):
- 新增:`/Users/coderstory/CodeSource/winui3/scripts/verify-e2e-lifecycle.sh`
- 临时 (跑完删):
  - `/Users/coderstory/CodeSource/winui3/src/plugins/stubs/_e2e_probe_view.tsx`
  - `/Users/coderstory/CodeSource/winui3/src-tauri/src/plugins/_e2e_probe_service/`
  - `/Users/coderstory/CodeSource/winui3/scripts/_e2e_probe_stale_storage.sh`

**步骤**:

#### 4a. Phase 42 + 44 派生收敛 lifecycle
1. **临时加 stub**: `_e2e_probe_view.tsx` (1 title + 1 button + data-testid)
2. **registry.ts 加 1 行**: import + ALL_PLUGINS 项
3. **build + smoke**: cargo build --release + smoke 10/10
4. **验证**: Playwright filter=e2e-probe PASS
5. **视觉 diff**: 60 张新增 1 张;或 sidebar 顺序微变 → 现有 1 张 sidebar diff
6. **清理**: 删 stub + registry.ts 行 (git restore)
7. **强验收 PASS**: stub 加 + 删不改 lib.rs / commands/ / App.tsx (grep verify)

#### 4b. Phase 45 service 拓扑 lifecycle
1. **临时加 service plugin**: `_e2e_probe_service.rs` (1 service struct + register_arc)
2. **plugins/mod.rs 注册**: `host.register(Box::new(stubs::E2eProbeServicePlugin))`
3. **build + 单测**: `cargo test topological::tests::topo_sort_dag` + init_all_topological (10 而非 9)
4. **commands dispatch**: 调 1 个 e2e-probe IPC 命令,期望 invoke 返回成功
5. **清理**: 删 service plugin + 注册 (git restore)
6. **强验收 PASS**: service 加 + 删不改 lib.rs setup / app_state.rs

#### 4c. Phase 46 stale-route 迁移 lifecycle
1. **写 localStorage**: Playwright 或 Node 脚本 `localStorage.setItem('claude-config-manager:active-view', 'mcp-management')`
2. **重启应用**: smoke test 启动 + 5s
3. **验证**: `window.location.search` = `?tab=mcp` + localStorage = `resource-browser` + UI 显示 resource-browser tab=mcp
4. **回归校验**: 其它 10 个 valid view 启动不受影响 (Playwright fixture)
5. **清理**: Playwright beforeEach `localStorage.clear()`
6. **强验收 PASS**: 升级路径打通,未引入回归

**验证命令**:
```bash
cd /Users/coderstory/CodeSource/winui3
./scripts/verify-e2e-lifecycle.sh
# expect: 3/3 PASS
```

**Done 标准**: 3/3 PASS + 临时 stub 全清理 + script 保留为回归 fixture

**估时**: 0.5 天

---

### Task 5: 5 phase grep lint 总扫 (Wave 2, 0.3 天)

**目的**: 跑 5 phase DECISIONS §强验收 中所有 grep lint 规则,0 mismatch 才 PASS。新增 `lint-plugin-coupling.sh` 永久固化。

**文件** (新增 1 个永久 script):
- `/Users/coderstory/CodeSource/winui3/scripts/lint-plugin-coupling.sh`

**步骤**:
1. **写 lint script**: bash + grep + -v 注释过滤
2. **规则清单 (14 条)**:
   - **规则 1** (Phase 42): `grep -E 'generate_handler!' src-tauri/src/lib.rs` → 0 行
   - **规则 2** (Phase 42): `grep -E 'tauri::command' src-tauri/src/lib.rs | grep 'inventory::iter'` → 0 行
   - **规则 3** (Phase 43): `grep -E 'MenuItem::with_id|on_menu_event' src-tauri/src/lib.rs` → 0 行
   - **规则 4** (Phase 43): `test -f src-tauri/src/platform/macos/app_menu.rs` → fail
   - **规则 5** (Phase 43): `test -f src-tauri/src/platform/windows/app_menu.rs` → fail
   - **规则 6** (Phase 44): `grep -E 'ALL_VIEWS.*=.*\[' src/hooks/useViewState.tsx` → 0 行
   - **规则 7** (Phase 44): `grep -E 'view === ' src/App.tsx` → 0 行
   - **规则 8** (Phase 44): `grep -E 'VIEW_META.*=.*\{' src/components/AppSidebar.tsx` → 0 行
   - **规则 9** (Phase 45): `grep -rE 'state\.[a-z]+_service\.' src-tauri/src/commands/` → 0 行
   - **规则 10** (Phase 45): `grep -E 'Arc<crate::services>' src-tauri/src/app_state.rs` → 0 行
   - **规则 11** (Phase 46): `grep -E 'STORAGE_KEY.*===.*mcp-management' src/App.tsx` → 0 行
   - **规则 12** (Phase 46): `test -f src/plugins/stubs/mcp-management.tsx` → fail
   - **规则 13** (Phase 46): `grep -c 'length).toBe(8)' src/__tests__/plugin-registry.test.ts` → ≥ 1
   - **规则 14** (Phase 46 Q46-5 fromViewId 唯一性): `grep -rE "migrateFrom.*fromViewId" src/plugins/stubs/ | awk -F'fromViewId.:.' '{print $2}' | awk -F"'|,\"" '{print $1}' | sort | uniq -d` → empty
3. **跑 lint script**: `bash scripts/lint-plugin-coupling.sh 2>&1 | tee /tmp/lint-v34.log`
4. **结果**: 14 条全 PASS / FAIL → 派对应 phase fix-task
5. **额外校验** (Phase 45 topological):
   ```bash
   cd src-tauri && cargo test topological::tests 2>&1 | tee /tmp/topo-v34.log
   grep -E "test result: ok" /tmp/topo-v34.log  # expect: 4/4 PASS
   ```
6. **commit lint script**: `git add scripts/lint-plugin-coupling.sh && git commit -m "feat(scripts): add lint-plugin-coupling.sh (Phase 47 5-phase grep lint fixture)"`

**验证命令**:
```bash
cd /Users/coderstory/CodeSource/winui3
bash scripts/lint-plugin-coupling.sh 2>&1 | tee /tmp/lint-v34.log
# expect: 14/14 PASS, exit 0
cd src-tauri && cargo test topological::tests 2>&1 | tee /tmp/topo-v34.log
grep -E "test result: ok" /tmp/topo-v34.log  # 4/4
```

**Done 标准**: lint-plugin-coupling.sh 14/14 PASS + topological 4/4 PASS + script commit

**估时**: 0.3 天

### Task 6: RELEASE-v3.4.0.md (Wave 3, 0.2 天)

**目的**: 写 release notes,列出 5 phase 主要改动 + 5 BLOCKING 决策 + 验证证据 + 已知推迟项。

**文件** (新增):
- `/Users/coderstory/CodeSource/winui3/.planning/milestones/v3.4-RELEASE-NOTES.md`

**步骤**:
1. **read 5 phase DECISIONS**: 提取每 phase 关键 ship items
2. **read verify-first report**: 提取 5 BLOCKING 漂移修正证据
3. **read 强验收 evidence**: smoke / lint / visual / lifecycle 4 项汇总
4. **写 RELEASE notes** (字节级模板):
   ```markdown
   # Claude 配置管理器 v3.4.0 (M8) — Release Notes

   **Ship date:** 2026-06-XX
   **Tag:** v3.4.0
   **Git commit:** <commit-hash>
   **Tag commit verified:** <signature>

   ## Highlights (5 BLOCKING decisions closed)

   1. **D-42-A**: `inventory = "=0.3.24"` 引入 (§2.3 例外白名单)
   2. **D-44-A**: mcp-management stub 删 (Phase 46 完成)
   3. **D-45-A**: ServiceRegistry Arc 路径统一
   4. **D-CC-A**: PluginContext 冻结 4 字段 + `&mut` init 签名
   5. **SHIP-A**: provider_switch stub 删,合并到 provider_list

   ## What Shipped (5 phases)

   - **Phase 42** (IPC dispatch): 13 stub 迁移 69 commands + inventory link-time 注册 + DispatchTable O(1) 派发
   - **Phase 43** (MenuRegistry + core-plugin): AppMenu 4 submenu 派生 + tray 2 项 + 删 platform/{macos,windows}/app_menu.rs
   - **Phase 44** (前端 route 派生): 12 view × 5 主题 = 60 张视觉矩阵 + ALL_VIEW_META 派生 + "加 view 改 1 文件" 强验收
   - **Phase 45** (9 service plugin + 拓扑序): DFS 3 色标记 + get_service! macro + AppState 缩到 < 50 行
   - **Phase 46** (stale-route): VIEW_ID_MIGRATIONS Map 派生 + 链式迁移递归 + 删 mcp-management stub + ?tab=mcp URL

   ## Verification Evidence

   - **smoke test**: 10/10 PASS (CLAUDE.md §13)
   - **5 phase grep lint**: 14/14 PASS (Phase 47 lint-plugin-coupling.sh)
   - **visual regression**: 60/60 PASS (12 view × 5 主题,0 diff)
   - **lifecycle e2e**: 3/3 PASS (plugin + service + stale-route)
   - **macOS 真机验证**: PASS-full / PASS-partial (Task 2 D6 状态)

   ## Known Issues / Deferred (v3.5 backlog)

   - Phase 45 G2/G8: PluginServiceDef 静态描述恢复
   - Phase 45 G7: app.manage 时机再优化
   - Phase 46: appendQueryMerge 字段 (Q46-2)
   - Phase 43: tray accelerator 跨平台策略
   - Phase 43: AboutMetadata i18n
   - Phase 43: PluginAction::Custom hot-reload
   - visual matrix accessibility issues (specific view × theme)
   - react-router 切回 (Phase 46 推迟)

   ## Migration Guide (v3.2 → v3.4)

   - **localStorage 'mcp-management'** → 自动迁移到 `view=resource-browser?tab=mcp` (Phase 46 VIEW_ID_MIGRATIONS)
   - **AppState 9 个 Arc<Service> 字段** → 1 个 ServiceRegistry (Phase 45,内部向后兼容)
   - **Tauri 命令名** → 不变 (Phase 42 不引 plugin_id 前缀)
   - **前端 invoke() 调用** → 不变 (Phase 42 不改前端代码)

   ## File Manifest

   - .planning/milestones/v3.4-DECISIONS.md (5 BLOCKING 关闭)
   - .planning/milestones/v3.4-phases/{42,43,44,45,46}-PLAN.md (5 phase 实施)
   - .planning/milestones/v3.4-phases/47-PLAN.md (Phase 47 整合)
   - .planning/milestones/v3.4-phases/47-* (强验收 evidence)
   - scripts/lint-plugin-coupling.sh (永久 lint fixture)
   - scripts/verify-e2e-lifecycle.sh (3 个 lifecycle e2e fixture)
   ```

5. **commit release notes**: `git add .planning/milestones/v3.4-RELEASE-NOTES.md && git commit -m "docs(release): add v3.4.0 release notes"`

**Done 标准**: v3.4-RELEASE-NOTES.md 就位 + commit + 字段全填

**估时**: 0.2 天

---

### Task 7: 4 份 manifest 更新 (Wave 3, 0.3 天)

**目的**: 同步 PROJECT.md / ROADMAP.md / MILESTONES.md / STATE.md,把 v3.4 ship 状态写进主索引。

**文件** (4 个 Edit,不使用 Write):
- `/Users/coderstory/CodeSource/winui3/.planning/PROJECT.md` (Current State + Current Milestone 段)
- `/Users/coderstory/CodeSource/winui3/.planning/ROADMAP.md` (v3.4 段)
- `/Users/coderstory/CodeSource/winui3/.planning/MILESTONES.md` (v3.4 行)
- `/Users/coderstory/CodeSource/winui3/.planning/STATE.md` (current_phase + progress + milestones 段)

**步骤**:

#### 7a. PROJECT.md (Edit scoped)
- **Current State** 段:加 "✅ v3.4 (M8) shipped" 行 + 5 phase summary
- **Current Milestone** 段:加 v3.4 entry + tag v3.4.0 + ship date
- **Requirements Validated** 段:加 v3.4 5 BLOCKING 关闭 + 10 强验收 PASS

#### 7b. ROADMAP.md (Edit scoped)
- 找 v3.4 (M8) 段,更新 Plans 列表 6 phases (42-47)
- Plans list 加 phase 47 整合 entry

#### 7c. MILESTONES.md (Edit scoped)
- 在表格前插入 v3.4 行:version=v3.4 / name=M8 插件架构改造 / Shipped=2026-06-XX / Phases=6 / Tag=v3.4.0 / Notes=5 phase 整合 + 5 BLOCKING 关闭 + smoke 10/10 + visual 60/60 + lifecycle 3/3
- 保持原表格按版本号排序

#### 7d. STATE.md (Edit scoped)
- gsd_state_version 保持 1.0 (不变)
- milestone 字段改 v3.4 / v3.4 (M8)
- current_phase 字段改 47 (shipped)
- status 字段改 Awaiting next milestone
- stopped_at 字段改 Phase 47 strong verification
- last_activity 字段改 "Phase 47 integration completed"
- last_activity_desc 字段改 "v3.4 (M8) shipped"
- progress 段填 6/6 phases, ~20 plans
- milestones 段加 v3.4 entry + summary

**验证命令**:
```bash
cd /Users/coderstory/CodeSource/winui3
git diff --stat .planning/PROJECT.md .planning/ROADMAP.md .planning/MILESTONES.md .planning/STATE.md
# expect: 4 files changed
grep -c "v3.4" .planning/PROJECT.md .planning/ROADMAP.md .planning/MILESTONES.md .planning/STATE.md
# expect: 各 ≥ 2 处提到 v3.4
```

**Done 标准**: 4 文件 Edit (scoped,non-destructive) + commit + `grep v3.4` 各 ≥ 2 处

**估时**: 0.3 天

### Task 8: git tag v3.4.0 (Wave 3, 0.2 天)

**目的**: 在 master 上签 GPG tag,推送到 origin。

**前置**: Task 1-5 强验收 14/14 PASS + Task 6-7 manifest 更新 commit + 用户复核 (CLAUDE.md §11)

**步骤**:
1. **pre-tag 检查**: `git log --oneline | head -20` 确认所有 5 phase + Phase 47 commit 都在 master
2. **pre-tag 检查**: `git status` clean
3. **pre-tag 检查**: Task 6 release notes commit 就位
4. **GPG 签名 tag** (本地): `git tag -s v3.4.0 -m "$(cat .planning/milestones/v3.4-RELEASE-NOTES.md | head -20)"`
5. **tag 验证**: `git tag -v v3.4.0` 期望 GPG 签名 OK
6. **tag 列出**: `git tag -l v3.4* --format='%(refname:short) %(objecttype) %(taggerdate) %(subject)'` 期望 1 行
7. **用户复核**: 主 session 暂停,等用户确认后 push (CLAUDE.md §11 主 session 决策)
8. **push tag**: `git push origin v3.4.0` (用户白名单后)
9. **失败回滚预案**: tag 后 24h 内发现 critical bug → `git tag -d v3.4.0` 本地删 + 不 push;已 push → 通知 + `git push origin :refs/tags/v3.4.0` (需用户白名单)

**验证命令**:
```bash
cd /Users/coderstory/CodeSource/winui3
git log --oneline | head -20
git status  # clean
git tag -s v3.4.0 -m "v3.4 (M8) - 5 phases 整合 + 5 BLOCKING 关闭 + 强验收全 PASS"
git tag -v v3.4.0  # GPG OK
git tag -l v3.4* --format='%(refname:short) %(subject)'  # 1 行
# (用户白名单后) git push origin v3.4.0
```

**Done 标准**:
- `git tag -l v3.4*` 1 行
- `git tag -v v3.4.0` GPG OK
- `git push origin v3.4.0` 成功 (用户白名单后)

**估时**: 0.2 天

**风险**: 不可逆 → 强验证后才允许 push (Task 1-5 全 PASS 是前置)

---

### Task 9: STATE.md lessons + RETROSPECTIVE (Wave 4, 0.2 天)

**目的**: 沉淀 v3.4 lessons learned,延续 M3.0.3 lesson 体系。

**文件** (Edit,scoped):
- `/Users/coderstory/CodeSource/winui3/.planning/STATE.md` (顶部 v3.4 closure summary 段)
- `/Users/coderstory/CodeSource/winui3/.planning/milestones/v3.4-RETROSPECTIVE.md` (新增)

**步骤**:
1. **read STATE.md v2.0/v3.0/v3.2 closure summary 段** (作为模板)
2. **写 v3.4 closure summary** (字节级):
   ```markdown
   **v3.4 ship (2026-06-XX)**:

   - Phase 42 (IPC dispatch): 13 stub + 69 commands + inventory link-time + D-42-A 白名单
   - Phase 43 (MenuRegistry + core-plugin): AppMenu 4 submenu + tray + D-CC-A PluginContext 冻结
   - Phase 44 (前端 route 派生): 12 view × 5 主题 = 60 张视觉矩阵 + "加 view 改 1 文件"
   - Phase 45 (9 service plugin + 拓扑序): DFS 3 色 + get_service! + AppState < 50 行 + D-45-A Arc 路径
   - Phase 46 (stale-route): VIEW_ID_MIGRATIONS + 链式递归 + 删 mcp stub + ?tab=mcp URL + D-44-A
   - Phase 47 (整合): smoke 10/10 + lint 14/14 + visual 60/60 + lifecycle 3/3 + tag v3.4.0
   - Final: 5/5 BLOCKING 关闭; 强验收全 PASS; git tag v3.4.0
   ```
3. **写 v3.4-RETROSPECTIVE.md** (新增,byte-level):
   ```markdown
   # v3.4 (M8) RETROSPECTIVE

   ## What Worked

   1. **verify-first 漂移修正** (00-VERIFY-FIRST-DRIFT-REPORT.md):5 BLOCKING 在 plan 阶段前暴露,避免 5 phase 重复返工
   2. **D-CC-A PluginContext 冻结**:3 phase 联合契约,提前在 v3.4-DECISIONS.md 锁定,Phase 42/43/45 0 协商成本
   3. **D-45-A ServiceRegistry Arc 路径**:Phase 42 + Phase 45 接口字节级一致,跨 phase 无 BC 损失
   4. **派生收敛** (Phase 44/45/46):ALL_VIEW_META / ServiceRegistry / VIEW_ID_MIGRATIONS 都是 build 时派生,"加 X 改 1 文件" 强验收真实可达

   ## What Was Inefficient

   1. **overview §0 数字漂移** (verify-first report §0.1):12→11 view / 80→69 commands / 93→23 invoke / 214→121 useViewState — research 估值与实测偏差 56-75%,plan 阶段才发现
   2. **mcp-management stub 推迟到 Phase 46** (D-44-A):原计划 Phase 44 删,后推到 Phase 46 启用 migrateFrom 字段后删。2 phase 跨度的协调成本高于 1 phase 删除
   3. **inventory 依赖白名单** (D-42-A):§2.3 例外必须用户拍板,增加 1 个决策点。如果 inventory 是 phase 42 才发现的,会阻塞 ship

   ## Lessons Learned (v3.4 → v3.5)

   1. **research 数字必须实测**,不能从 overview 估值继承 (漂移教训)
   2. **跨 phase 接口契约必须在 milestone DECISIONS 提前冻结** (D-CC-A / D-45-A 教训)
   3. **推迟项集中在 DECISIONS "## 推迟到 Phase XX" 段**,跨 phase 协调不丢
   4. **强验收脚本永久化**:Phase 47 lint-plugin-coupling.sh + verify-e2e-lifecycle.sh 作 ship gate 后续引用

   ## Known Issues Carried to v3.5

   (同 RELEASE-v3.4.0.md §Known Issues)

   ## M31 Vibrancy 撤回 (M3.0.3 lesson 续)

   - v3.4 不启用 macOS vibrancy / Win11 Mica (M31 撤回后未恢复)
   - 项目当前 = 默认 chrome (Phase 47 Task 2 验证)
   - v3.5 评估 native vibrancy (需 user 白名单 + 实测性能影响)
   ```
4. **commit lessons**: `git add .planning/STATE.md .planning/milestones/v3.4-RETROSPECTIVE.md && git commit -m "docs(retrospective): v3.4 (M8) lessons learned"`

**验证命令**:
```bash
cd /Users/coderstory/CodeSource/winui3
grep -c "v3.4 ship" .planning/STATE.md  # ≥ 1
test -f .planning/milestones/v3.4-RETROSPECTIVE.md  # exists
git log --oneline -1 .planning/milestones/v3.4-RETROSPECTIVE.md  # commit
```

**Done 标准**: STATE.md closure summary + RETROSPECTIVE.md 就位 + commit

**估时**: 0.2 天

---

## 7. Phase 47 强验收汇总 (10 项最终判定)

| # | 强验收项 | 来源 | 验证命令 | 期望结果 |
|---|---|---|---|---|
| 1 | smoke test | CLAUDE.md §13 | `./scripts/smoke-test.sh <exe>` | 10/10 PASS |
| 2 | macOS 真机验证 | CLAUDE.md §15 | Task 2 截图 + osascript | PASS-full 或 PASS-partial |
| 3 | 60 张视觉回归 | Phase 44 强验收 | `npx playwright test visual-regression.test.ts` | 60/60 PASS (0 diff) |
| 4 | plugin lifecycle e2e | Phase 42 强验收 | `verify-e2e-lifecycle.sh` 4a | stub 加 + 删不改 lib.rs |
| 5 | service lifecycle e2e | Phase 45 强验收 | `verify-e2e-lifecycle.sh` 4b | service 加 + 删不改 lib.rs setup |
| 6 | stale-route migration | Phase 46 强验收 | `verify-e2e-lifecycle.sh` 4c | localStorage='mcp-management' → resource-browser?tab=mcp |
| 7a | Phase 42 lint | Phase 42 DECISIONS | `lint-plugin-coupling.sh` 规则 1+2 | 0 行 |
| 7b | Phase 43 lint | Phase 43 DECISIONS | `lint-plugin-coupling.sh` 规则 3+4+5 | 0 行 |
| 7c | Phase 44 lint | Phase 44 DECISIONS | `lint-plugin-coupling.sh` 规则 6+7+8 | 0 行 |
| 7d | Phase 45 lint | Phase 45 DECISIONS | `lint-plugin-coupling.sh` 规则 9+10 + topological 4 单测 | 0 行 / 4/4 PASS |
| 7e | Phase 46 lint | Phase 46 DECISIONS | `lint-plugin-coupling.sh` 规则 11+12+13+14 | 0 行 / 8 stub / 唯一 |
| 8 | git tag v3.4.0 | CLAUDE.md §9 | `git tag -s v3.4.0 && git tag -v v3.4.0` | GPG OK |
| 9 | 4 份 manifest 更新 | 流程纪律 | `git diff --stat .planning/{PROJECT,ROADMAP,MILESTONES,STATE}.md` | 4 files changed |
| 10 | STATE.md lessons | M3.0.3 lesson | `grep "v3.4 ship" STATE.md` | ≥ 1 |

**最终判定**:**全部 PASS + git tag push → v3.4.0 ship 成功**。

---

## 8. 不要做 (Phase 47 禁区,继承 CLAUDE.md §10)

- ❌ 不要修改 `./SPEC.md` (实现唯一参考)
- ❌ 不要触碰 Phase 42-46 的实现代码 (违反 CLAUDE.md §2.4 谨慎修改文件;Phase 47 fail-fast 派回 fix-task)
- ❌ 不要在 Task 6 release notes 编造验证证据 (所有数字必须真实来自 Task 1-5 输出)
- ❌ 不要 git tag 前 push (必须 Task 1-5 全 PASS + 用户白名单)
- ❌ 不要在 Task 3 视觉 diff 时偷懒 (任何 1 张 diff 阻塞 ship)
- ❌ 不要跳过 lint-plugin-coupling.sh 规则 14 (fromViewId 唯一性是 Phase 47 新增,非推迟)
- ❌ 不要主 session 亲自执行 Phase 47 subagent 工作 (CLAUDE.md §11,主 session 只决策)
- ❌ 不要在 macOS 真机验证失败时绕过 (必须截图保留 + 派 Phase 43 fix-task)

---

## 9. 输出路径 (Phase 47 ship gate)

Phase 47 完成后,以下文件必须 commit + push:

- `/Users/coderstory/CodeSource/winui3/.planning/milestones/v3.4-phases/47-PLAN.md` (本文件,plan 阶段产物)
- `/Users/coderstory/CodeSource/winui3/.planning/milestones/v3.4-phases/47-SUMMARY.md` (execute 阶段产物,Phase 47 完成后写)
- `/Users/coderstory/CodeSource/winui3/.planning/milestones/v3.4-phases/macos-verify-*.{png,txt}` (Task 2 evidence)
- `/Users/coderstory/CodeSource/winui3/.planning/milestones/v3.4-phases/visual-review.md` (Task 3 evidence)
- `/Users/coderstory/CodeSource/winui3/scripts/lint-plugin-coupling.sh` (Task 5 永久 fixture)
- `/Users/coderstory/CodeSource/winui3/scripts/verify-e2e-lifecycle.sh` (Task 4 永久 fixture)
- `/Users/coderstory/CodeSource/winui3/.planning/milestones/v3.4-RELEASE-NOTES.md` (Task 6)
- `/Users/coderstory/CodeSource/winui3/.planning/milestones/v3.4-RETROSPECTIVE.md` (Task 9)
- `/Users/coderstory/CodeSource/winui3/.planning/{PROJECT,ROADMAP,MILESTONES,STATE}.md` (Task 7)
- git tag `v3.4.0` (Task 8)

---

*Phase 47 PLAN 完成。10 强验收项 + 9 task + 7 高/中风险 + 8 推迟项 + 14 grep lint 规则 + 3 个 e2e lifecycle,单线程串行,~3.3 天 (1 槽独占)。*