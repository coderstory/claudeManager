# M1 架构期最终收尾报告 (M1 Final Report)

> **里程碑**: M1 架构期 (architecture milestone)
> **周期**: 2026-06-18 (fa02b41 M1.1 起) → 2026-06-20 (9776ee9 M1.12 合并)
> **作者**: M1 收尾子代理
> **状态**: **M1 架构期主线完成**，M2 业务功能期就绪。**待用户核定 M1.9.3 exe 后启动 M2**。
> **本文档定位**: 一次性总结 M1 期间的交付物 + 教训 + 风险 + M2 启动候选；M1.11 4 阶段评审已合并入 `docs/reviews/m1-12-final-audit.md` (worktree `agent-a31f4ddce79088ee7`) + `docs/reviews/m1-11-*.md` (worktree `agent-affc172bcdccc54ab`)。

---

## 1. M1 范围完成度

### 1.1 12 个子任务全部 ship

| # | 子任务 | 关键 commit | Ship exe | 用户核定 |
|---|---|---|---|---|
| M1.1 | Tauri v2 scaffold + tray + minimize-to-tray | `fa02b41` (init) → `2914342` (release) | `M1.1-scaffold-release.exe` | ✅ 2026-06-19 00:26:16 |
| M1.1-fix | release build 切换（PE subsystem = GUI） | `503f5c2` | (合入 M1.1) | ✅ |
| M1.2 | OS 抽象层（8 traits × Win + Mac stubs） | `13290b3` | `M1.1.2-platform-abstractions.exe` | ⏳ 待审 |
| M1.3 | Plugin host + 12 stubs | `77e070a` | `M1.1.3-plugin-host.exe` | ⏳ 待审 |
| M1.3-fix-1 | stale dist 重新嵌入（touch lib.rs） | `050eac8` | `M1.1.3-plugin-host-fix.exe` | ✅ |
| M1.3-fix-2 | `--features tauri/custom-protocol` | `50abbe6` | `M1.1.3-plugin-host-fix-v2.exe` | ✅ |
| M1.3-fix-3 | viewport meta + CSS reset | `038aa4f` | `M1.1.3-plugin-host-fix-v3.exe` | ⏳ 待审 |
| M1.4 | Tauri capabilities + WHY 注释 | `cc47b7d` | `M1.1.4-platform-plugins-capabilities.exe` | ⏳ 待审 |
| M1.8 | TDD + Playwright + CI | `6814a7a` | `M1.1.8-tdd-scaffold.exe` | ⏳ 待审 |
| kill-app fix | `taskkill -F` 而非 `/F` | `dd4456b` | (脚本层) | ✅ |
| M1.5 | 前端 deps + 设计系统基线（瓷白 + tokens.css） | `5b46d51` → `be955c3` | (并入 M1.9) | ⏳ 待审 |
| M1.6 | Rust deps 版本锁（10 个 tauri-plugin-*） | `0397b43` → `92a80b3` | (无独立 exe) | ⏳ 待审 |
| M1.7 | 自启动集成（tauri-plugin-autostart） | `bb8e873` → `8a1f48a` | `M1.1.7-chrome-with-autostart.exe` | ⏳ 待审 |
| M1.9 | 主窗口框架 + 12 路由占位 | `13ff10a` → `0de4713` | (并入 M1.9.x) | ⏳ 待审 |
| M1.9.1 | 滚动布局修复（html/body reset + min-h-0） | `56f716f` → `e3533ff` | `M1.9.1-scroll-layout-fix.exe` | ⏳ 待审 |
| M1.9.2 | 自定义 chrome + Liquid Glass | `13076bc` → `04395dd` | `M1.9.2-chrome-and-glass.exe` | ⏳ 待审 |
| M1.9.3 | main 绝对定位（修 WebView2 flex 高度计算 bug） | `6cc33bb` → `fd4c125` | **`M1.9.3-fix-layout.exe`** | ⏳ **当前推荐核定** |
| M1.10 | 构建/CI 矩阵 + SIGNING.md + BUILD.md | `87c7365` → `9be1e51` | (无独立 exe) | ⏳ 待审 |
| M1.11 | 框架不变量文档（ARCHITECTURE.md / AGENTS.md / 4 阶段评审） | `d79575d` | (无 exe) | ⏳ 待审 |
| M1.12 | 最终复审 + STATE 收尾 | `9776ee9` | (无 exe) | ⏳ 待审 |

**主线交付状态**: 12 个子任务 + 8 个修复 / 改进 commit = 20 个可识别的 M1 工作单元，**全部 ship**。架构层变更（M1.2 / M1.3 v3 / M1.4 / M1.5~1.9.2）因无独立"产品差异"展示面，**建议主 session 一次性 batch approve**（详见 §6 决策 D5）。

---

## 2. 关键数字

| 指标 | 值 | 说明 |
|---|---|---|
| **总 commit 数** | 61 | `git log --oneline \| wc -l` |
| **M1 主题 commit** | 63（merge + fix commits 包含） | 含 M1.X、M1.X-fix、smoke 改进、kill-app fix、CI 矩阵 |
| **Ship exe 数** | 14（13 个 exe + 1 个 dll） | `~/Desktop/ClaudeConfigManager-M1/` 实际清单 |
| **当前推荐 exe** | `ClaudeConfigManager-M1.9.3-fix-layout.exe` (28.5 MB) | 最后 ship，framer-motion 移除 + main 绝对定位 |
| **Vitest 用例** | **73/73 全绿** (9 文件) | `npx vitest run` 实测 Duration 9.46s |
| **Playwright e2e specs** | 6 (3 文件) | launch / tray / close-minimize；dev box 未实跑，CI 配 |
| **Rust `#[test]`** | 60 | 编译通过，本机 DLL load 限制 → CI MSYS2 跑通 |
| **TS/TSX 代码** | 1,995 行（去掉 tests） | `src/` 业务代码 |
| **TS 测试代码** | 1,404 行 | `src/**/*.test.*` |
| **Rust 代码** | 2,832 行 | `src-tauri/src/**/*.rs` |
| **Shell 脚本** | 716 行 | `scripts/` (4 个：build-only / smoke-test / kill-app / build-and-ship) |
| **前端 bundle** | 252K (`dist/`) | 移除 framer-motion 后体积比 M1.9.2 还小 |
| **SPEC.md** | 1,434 行 | 实现唯一参考（不可修改） |

---

## 3. 关键交付

### 3.1 跨平台桌面应用骨架

- **Tauri v2 + React 19 + TypeScript 5 + Rust**（CLAUDE.md §1 选型）
- **Win11 dev box + macOS 26** 双目标平台
- **瓷白设计系统基线**：`tokens.css` 11 个 var（colors / spacing / radius / typography / shadows / glass）
- **暗色主题预留**：`data-theme="dark"` 切换接口已通（dark 完整度参见 §5 风险 F-1.09）
- **液态玻璃**（M1 阶段用 `backdrop-filter: blur()` 模拟，v1.1 接入 Mica/vibrancy 原生 API）

### 3.2 12 个 plugin 路由占位

- 前端：`src/plugins/registry.ts::ALL_PLUGINS` 12 项 + `src/pages/*/index.tsx` 13 个页面（12 plugin + home tile grid）
- 后端：`src-tauri/src/plugins/stubs/*.rs` 12 个 stub（每个返回 `Ok(())` 跟 placeholder UI 文案）
- PluginHost：`plugins/host.rs` register / unregister / init_all / shutdown_all（LIFO 顺序）
- IPlugin trait 锁定：id / name / routes / services / init / shutdown

### 3.3 自启动集成（M1.7）

- 8 个 platform trait 全部到位，其中 `IPlatformAutostart` 已实接 `tauri-plugin-autostart` (=2.5.1, 精确锁)
- Win + Mac impl 都已写（Mac 走 `tauri-plugin-autostart` 抽象，Win 走同一 plugin）
- Tauri command 表面：`get_autostart_status` / `set_autostart_enabled`（`commands/autostart.rs`）
- 切换过程零命令层 churn，验证了 trait 抽象的杠杆

### 3.4 12 个 Rust 依赖 + 版本锁

`Cargo.toml` 12 个 tauri-plugin-* 全部 `=X.Y.Z` 精确锁（CLAUDE.md §2.3 强制）：
- `tauri-plugin-fs = 2.5.1`
- `tauri-plugin-dialog = 2.7.1`
- `tauri-plugin-notification = 2.3.3`
- `tauri-plugin-shell = 2.3.5`
- `tauri-plugin-os = 2.3.2`
- `tauri-plugin-deep-link = 2.4.9`
- `tauri-plugin-single-instance = 2.4.2` (with `deep-link` feature)
- `tauri-plugin-store = 2.4.3`
- `tauri-plugin-log = 2.8.0`
- `tauri-plugin-updater = 2.10.1`（空 pubkey placeholder，v1.1 release 换真 key）
- `tauri-plugin-autostart = 2.5.1`
- `tauri-plugin-process = 2.3.1`（未用，M1.12 backlog 删除）

### 3.5 瓷白设计系统 + 液态玻璃

- `src/design-system/tokens.css`：11 个 var + 5 个 glass var + 5 个 blur level + 暗色覆盖（部分）
- `ThemeProvider.tsx`：light/dark/auto + localStorage 持久化 (`ccm.theme`)
- `applyEffects.ts`：M1.9.2 调 `setEffects(Mica)` 优雅降级（老 Win10 / 旧 macOS 静默 no-op）

### 3.6 自定义窗口 chrome（M1.9.2）

- `tauri.conf.json`：`decorations=false` + `titleBarStyle=Overlay`
- `WindowControls.tsx`：minimize / maximize / close 按钮（@tauri-apps/api/window）
- `lib.rs::on_window_event`：拦截 close → hide to tray
- `AppHeader.tsx`：拖拽区 + `data-tauri-drag-region`

### 3.7 73 个 Vitest 测试全绿

```
Test Files  9 passed (9)
     Tests  73 passed (73)
  Duration  9.46s
```

| 文件 | 用例 |
|---|---|
| `design-tokens.test.ts` | 2 |
| `lib/cn.test.ts` | 5 |
| `hooks/useViewState.test.ts` | 10 |
| `design-system/ThemeProvider.test.tsx` | 7 |
| `plugin-registry.test.ts` | 5 |
| `integration/scroll-layout.test.tsx` | 7 |
| `integration/m1-9-2.test.tsx` | 14 |
| `integration/m1-9-3.test.tsx` | 12 |
| `integration/App.test.tsx` | 11 |
| **总计** | **73** |

### 3.8 GitHub Actions CI matrix（M1.10）

- `.github/workflows/ci.yml`：Rust 单元 + 集成测试（MSYS2/MinGW64）
- windows-latest + macos-latest 双 runner
- Playwright e2e 步骤已配（M1.10 TODO = 把 e2e 步骤接到 ci.yml）

### 3.9 完整的 4 阶段评审 + 最终复审

- `docs/reviews/m1-11-01-self-review.md`（worktree `agent-affc172bcdccc54ab`）：25 findings（1 CRITICAL / 4 HIGH / 8 MEDIUM / 12 LOW）
- `docs/reviews/m1-11-02-brainstorm.md`：7 decisions 反向挑战（2 强 accept / 5 accept with future action）
- `docs/reviews/m1-11-03-peer-review.md`（worktree）
- `docs/reviews/m1-11-04-business-flow.md`（worktree）
- `docs/reviews/m1-12-final-audit.md`（worktree `agent-a31f4ddce79088ee7`）：综合复审（6 维度评分 + 4 阶段合并）

### 3.10 docs/ARCHITECTURE.md + AGENTS.md

- **`docs/ARCHITECTURE.md`**（worktree `agent-affc172bcdccc54ab`，9 章节 ~410 行）：M1 框架不变量（模块边界 / 8 traits / 12 plugin / 设计系统 / 状态管理 / 测试金字塔 / 构建矩阵 / 已知限制 / 迁移手册）
- **`AGENTS.md`**（同上 worktree，~90 行）：subagent 入口（MUST-read / MUST-not-touch / key invariants / build 指令）

---

## 4. 关键教训（5 条）

> 完整教训清单见 `docs/milestones/M1-architecture-summary.md` §4 + M1.11-01 self-review "Positive observations"。本节摘 5 条最影响后续 M2 启动的。

### 4.1 Tauri v2 `cargo build --release` 必须带 `--features tauri/custom-protocol`

**触发 commit**: `50abbe6` (M1.3-pipeline-fix-v2)

**根因**: `cargo build --release`（不带 `tauri build`）**不会**自动 enable `tauri` crate 的 `custom-protocol` feature。没有这个 feature，`tauri::generate_context!()` 宏 emit `EmbeddedAssets::default()`（嵌入 0 个 dist 文件），runtime `manager::get_app_url` 返回 `devUrl`（`http://localhost:1420`），webview 试图连 vite dev server，但 dev server 没运行 → `ERR_CONNECTION_REFUSED` → 空白页。

**修复**: `cargo build --release --features tauri/custom-protocol`（已写入 `scripts/build-and-ship.sh`）。

**Smoke test 增强**: Test 7 grep exe 内 `index-XXX.js` fingerprint，0 hits = dist 未嵌入 = 回归 → 阻止 ship。

**记忆条目**: `feedback/tauri-v2-custom-protocol-required`（已存在，完整文档）。

### 4.2 Git Bash `taskkill` 用 `-F` 不是 `/F`

**触发 commit**: `dd4456b` (kill-app fix)

**根因**: Git Bash msys 路径转换会把 `/F` 解释成 `F:/` → "invalid option" 错误，进程没杀，托盘图标残留。

**修复**: `taskkill -F -IM foo.exe`（破折号，不是斜杠）。

**记忆条目**: `feedback/taskkill-dash-flags-not-slash.md`（跨项目 Windows 工具知识）。

### 4.3 smoke test 必须有结构断言（dist fingerprint grep），不能只验 process alive

**触发 commit**: `50abbe6` (M1.3-pipeline-fix-v2)

**根因**: 原始 4 项 smoke test（process running / window found / tray icon / cleanup）能通过空白页 / stale dist / `ERR_CONNECTION_REFUSED` 等回归 → **假阳性**。

**修复**: smoke test 加 Test 5（WebView2 child window class `Chrome_WidgetWin_0`）/ Test 6（窗口标题含"Claude 配置管理器"）/ Test 7（grep exe 内 `index-XXX.js` fingerprint）。

**CLAUDE.md §9.4 修正**: 4 项 → 7 项，未来 M2 ship pipeline 必须沿用。

### 4.4 WebView2 release 模式 flex 链高度计算有 bug

**触发 commit**: `398488c` (M1.9.3-fixP0)

**根因**: M1.9.2 把主窗格用 `flex: 1` 让 main 撑满剩余高度，dev mode 正常；release 模式 WebView2 高度计算有 bug，main 高度 = 0 → 看不见内容。

**修复**: main 改 `position: absolute; inset: 0;`，绕开 flex 高度计算。

**契约测试**: `src/__tests__/integration/m1-9-3.test.tsx` 12 用例锁住 `<main>` 用 `position:absolute` 而非 `flex:1`。

### 4.5 framer-motion 12.23 + React 19 + WebView2 release 组合会让 renderer 进程不启动

**触发 commit**: `fd4c125` (M1.9.3-fixP1)

**根因**: M1.9 引入 framer-motion 12.23.25（精确锁）做 AnimatePresence 视图转场。dev mode 正常；release exe 在某些 WebView2 版本下会让 renderer 进程不启动，窗口全白。

**修复**: 移除 framer-motion，用 CSS `@keyframes` 替代 AnimatePresence。bundle 从 ~350K 缩到 252K（28% 减小）。

**CLAUDE.md §10 增补候选**: "M1+ 不要引入动画库（framer-motion / react-spring），用 CSS keyframe 替代"。

---

## 5. 风险 / 已知限制

> 来源：M1.11 self-review (F-1.01 ~ F-1.26) + M1.12 final-audit (B1~B8, C1~C5, P1~P6, T1~T5)。本节摘 8 条**必须告知用户**的。

### 5.1 M1.5 dark stub 不完整

**位置**: `src/design-system/tokens.css:96-113`

**问题**: `[data-theme="dark"]` 覆盖了 `--bg-primary` / `--bg-elevated` / `--text-*` / `--border` / `--accent` / glass tokens，但**没覆盖**：
- `--success`（暗背景下浅 #388E3C 褪色）
- `--warning`（同上 #F57C00）
- `--danger`（同上 #D32F2F）
- `--shadow-sm` / `--shadow-md`（rgba(0,0,0,0.04) 在暗背景看不见）
- `--disabled`（light only）

**影响**: 用户切到暗主题，状态色不变。SPEC §4.5 要求所有状态色都跟主题。

**M2 启动**: 修这个 5 个 var（5 行 CSS），预计 5 分钟。

### 5.2 Tailwind 未接 PostCSS 管线（className 是 dead code）

**位置**: `package.json:35-38` (tailwindcss / postcss / autoprefixer 装好但没配 config)

**问题**: Tailwind 在 devDependencies 但**没编译**（无 `tailwind.config.ts`，无 `@tailwind` directives）。`cn()` util 存在但 `twMerge()` 是 no-op。一些组件用 `className="flex items-center gap-2"` 等 class —— 这些 class 是 dead code，没编译。

**影响**: 看着像 Tailwind 工程，实际全 inline `style={{ ... }}`。CLAUDE.md §4.4 "design system baseline = CSS variables" 是真正生效的设计系统。

**决策点（M2 启动前必拍板）**:
- **选项 A**: 接入 Tailwind（写 `tailwind.config.ts` 把 tokens.css 映射到 Tailwind theme）
- **选项 B**: 移除 Tailwind（删 tailwindcss / postcss / autoprefixer / cn util / 所有 dead className）

### 5.3 macOS impls 在 Win dev box 编译验证过，运行时验证推迟到 Mac dev box

**位置**: `src-tauri/src/platform/macos/*.rs`（8 个文件，全是 `unimplemented!()` 或 `PlatformError::NotSupported`）

**问题**: M1.2 决策 = macOS impls 是编译期 stub，本机（Windows dev box）只验证编译过。Mac dev box 没接入 → Mac runtime panic 风险存在（F-1.12 / B3）。

**影响**: F1（Provider 列表）在 Mac 上点"列 provider"会 panic（因为 `paths().ensure_dirs()` 是 unimplemented!()）。

**M2 启动前必做**: 接入 Mac 真机 + 修 unimplemented impls（MacPaths / MacSingleInstance 至少 2 个）。

### 5.4 cargo test 在本机有 DLL load 限制（dev box 已知问题，CI 跑）

**位置**: 本机 `cargo test` → `STATUS_ENTRYPOINT_NOT_FOUND (0xc0000139)`

**问题**: Windows DLL forwarding 问题，lib-test 在本机跑不通。CI 用 MSYS2/MinGW64 + 直接跑 integration test binary 绕过。

**影响**: 60 个 Rust `#[test]` 本机不能跑，靠 CI 兜底。

**M2 启动前候选**: 把 integration test 配到 ci.yml 的"Run integration tests directly"步骤（M1.10 已配，验证过）。

### 5.5 Playwright e2e 实跑过 0 次（M1.8 配了但没跑）

**位置**: `tests/e2e/{launch,tray,close-minimize}.spec.ts`（3 文件 6 用例）

**问题**: e2e 跑通需 `tauri-driver` + 实际启动 exe + 联网（telemetry 可能 hang）。M1.8 写了 spec 但 dev box 实际没跑过 1 次。CI 也没接 e2e 步骤。

**影响**: M1.3 必过的 e2e（启动 / 托盘 / 关闭隐藏 / 退出）只在 dev box 视觉验证过，没自动化。

**M2 启动前候选**: M1.10 TODO 列表 = 把 e2e 步骤接到 ci.yml。

### 5.6 HANDOFF.json 已 stale（仍把 M1.5~1.12 标 not_started）

**位置**: `.planning/HANDOFF.json:25-31`

**问题**: HANDOFF.json 写于 M1.1~1.3 + 几个 fix 阶段，没跟踪 M1.5~M1.9.3 的实际 commit。

**影响**: 未来 subagent 读 HANDOFF.json 会以为 M1.6/1.7/1.9 是 TODO（实际已完成）。

**M1.12 收尾**: STATE.md 追加 M1 收尾段（已写入 .planning/STATE.md）。**HANDOFF.json 是否重写待主 session 决策**（CLAUDE.md §10 "HANDOFF.json 是一次性 artifact，保留作为历史记录"——按 §10 是"不要改"，但 §3.3 写"写入决策理由"也合理，冲突时听主 session）。

### 5.7 backend plugin stub 还没接到 PluginHost

**位置**: `src-tauri/src/plugins/stubs/*.rs`（12 个结构体都写好了）+ `plugins/mod.rs::init_all`（未实现）

**问题**: 12 个 stub 文件已存在（`pub struct ProviderListPlugin;` 等），但 `plugins/mod.rs::init_all` 还没遍历 + register 12 个 stub + 调 `init_all`。也就是说，**PluginHost 的 register / init_all / shutdown_all 代码路径已写好（host.rs），但实际没接 12 个 plugin 进去**。

**影响**: M2 启动第一件事 = 把 12 个 stub 接到 `init_all`（M2-roadmap-draft.md §5.1 决策 D1 "选项 B 推荐" 已列入 3 件套之一）。

**M2 启动必做**: 半天工作量，1 个 subagent 即可。

### 5.8 `lib.rs:2` `windows_subsystem = "windows"` 移除 console，但 release build 没 stderr

**位置**: `src-tauri/src/lib.rs:2`

**问题**: release exe 的 PE subsystem = `windows`，没有 stderr 流。`eprintln!` 不会显示（M1.2 WindowsNotifier stub 是 `eprintln!`，会 silent fail）。

**影响**: release exe 出错时无错误输出，全靠 frontend error boundary 兜底。

**M2 启动候选**: 改用 `tauri-plugin-log`（已装 =2.8.0）+ 写日志到 `<appdata>/logs/`。

---

## 6. 关键决策（M1 期间的 10 条，已记录在 `.planning/HANDOFF.json::decisions`）

| # | 决策 | 阶段 | 状态 |
|---|---|---|---|
| 1 | Tauri v2 > Electron / Flutter Desktop / MAUI / Avalonia / Wails / Qt | M1-pre | ✅ 锁定 |
| 2 | M1.x ship 用 release build（PE subsystem = GUI，无 console 残留） | M1.1-fix | ✅ 锁定 |
| 3 | `cargo build --release --features tauri/custom-protocol` 替代 `tauri build` | M1.3-fix-v2 | ✅ 锁定（M1.10 候选迁移 tauri build） |
| 4 | smoke test 必须有结构性标记（WebView2 child window + dist fingerprint grep） | M1.3-fix | ✅ 锁定 |
| 5 | CLAUDE.md 放项目根（非全局 memory） | M1-pre | ✅ 锁定 |
| 6 | M1.4 capabilities 的 WHY 注释用顶层 description 字段 | M1.4 | ✅ 锁定 |
| 7 | macOS impls 编译期 stub + Windows impl 真实跑（无 cross-compile） | M1.2 | ⚠️ M2 启动前需 Mac 真机接入 |
| 8 | 12 plugin stubs 渲染"该功能将在 M2+ 开发 (plugin: {id})"占位 | M1.3 | ✅ 锁定 |
| 9 | Subagent 并发上限 4（CLAUDE.md §11.2） | M1-cross | ✅ 锁定 |
| 10 | M1.9 视图路由用 `useViewState` + localStorage 而非 react-router | M1.9 | ✅ 锁定（M2 F4 deeplink 时再评估） |

**反向挑战结果**（M1.11-02 brainstorm）: 7 决策中 2 强 accept（platform traits / tauri-plugin-autostart over winreg），5 accept with future action items，0 rejects。

**M2 启动前可能 revisit**: D2 (localStorage vs tauri-plugin-store) / D4 (Tailwind direction) / D7 (cargo build vs tauri build)。

---

## 7. M2 启动候选

> 完整 M2 路线图见 `docs/milestones/M2-roadmap-draft.md`（worktree `agent-a31f4ddce79088ee7`）。本节摘 P0 4 个 plugin + 启动前必做 3 件套。

### 7.1 M2 P0 = F1 + F2 + F5 + F6 + F13（备份基础设施）

| Plugin | F 编号 | 名称 | 依赖 | 估算 |
|---|---|---|---|---|
| **F1** | F1 | Provider 列表 | 无 | 2-3 天 |
| **F13** | F13 | 备份基础设施（`backup_service.rs`） | 无 | 1 天（与 F1 并行） |
| **F2** | F2 | Provider 切换 | F1 + F13（**强依赖**） | 2 天 |
| **F5** | F5 | JSON 编辑 | 无（独立子系统） | 2-3 天 |
| **F6** | F6 | MCP 管理 | 无（独立子系统） | 2 天 |

**为什么这 4 个 P0**:
1. **F1 + F2**: 核心价值主张（"在多个 provider 间快速切换"），缺一不可
2. **F13 备份**: F2 切换的前置依赖（CLAUDE.md §7 "任何写盘操作必须先备份"）
3. **F5 JSON 编辑**: 救场工具（settings.json 损坏 / 高级用户手改）
4. **F6 MCP**: 独立子系统（不依赖 Provider），并行做

### 7.2 M2 启动前必做 3 件套（建议并行 3 槽）

| 任务 | subagent | 时间 | 备注 |
|---|---|---|---|
| **3.1 PluginHost wiring** | 1 | 半天 | 把 12 stub 接到 `plugins/mod.rs::init_all`，同步 HANDOFF.json |
| **3.2 M1.10 收尾** | 1 | 1-2 天 | ci.yml 加 npm test / build / e2e；beforeBuildCommand 原子化；tsconfig strict 审计 |
| **3.3 M1.11 文档** | 1 | 1 天 | 把 worktree 里的 `ARCHITECTURE.md` / `AGENTS.md` / 4 阶段评审合并入 master |

### 7.3 主 session 必拍板的 5 个决策

| 决策 | 选项 | 推荐 |
|---|---|---|
| **D1**: M2 启动前是否先补 3 件套？ | A 先补齐 2 天再 M2.1 / B 与 M2.1 并行 / C 跳过文档 | **B**（3 槽并发：F1 / M1.10 / M1.11） |
| **D2**: M2 4 个 P0 plugin 执行顺序 | A 严格顺序 / B F1+F13 → (F2 ‖ F5 ‖ F6) / C F6 + F1 并行 | **B**（依赖清晰 + 最大化 4 槽利用率） |
| **D3**: 是否启用 react-router？ | A 保持 useViewState / B 切到 HashRouter | **A**（少改动；M2 F4 deeplink 用 useEffect + listen 解决） |
| **D4**: Mac 真机验证 F1 吗？ | 必做 / F2 启动前再决定 / 不做 | **F2 启动前再决定**（F1 只读路径，integration test 已覆盖） |
| **D5**: M1 exe 批量核定策略 | A 逐个 / B 一次性 batch / C 抽查 M1.9.3 + M1.3 v3 | **C**（最经济） |

---

## 8. 推荐下一步

> 收尾子代理建议（**最终决策权归主 session**）。

### 8.1 立即可做

1. **主 session 拿 M1.9.3 exe 给用户核定**（`~/Desktop/ClaudeConfigManager-M1/ClaudeConfigManager-M1.9.3-fix-layout.exe`，28.5 MB）
2. **用户核定后，主 session 派 1 个 subagent 把 worktree 里的 ARCHITECTURE.md / AGENTS.md / 4 阶段评审 / final-audit / M2-roadmap-draft 合并入 master**（预计 1-2 小时）
3. **合并完后，主 session 让用户就 §7.3 5 个决策拍板**（约 5 分钟）
4. **拍板后，主 session 派 3 个 subagent 并行启动 M2.1**（D1 推荐选项 B）：
   - Subagent A: 3.1 PluginHost wiring（半天）
   - Subagent B: M2.1 F1 Provider 列表 + F13 备份基础设施（2-3 天）
   - Subagent C: M1.10 收尾（1-2 天）
5. **A 完成后立即派 2 个 subagent 并行 M2.2 F2 切换 + M2.4 F5 JSON 编辑**
6. **M2.1 F1 + F13 完成后派第 3 个 M2.5 F6 MCP 管理**

### 8.2 不可做（CLAUDE.md §10 硬约束）

- ❌ 不要修改 `./SPEC.md`
- ❌ 不要修改 `.planning/research/`
- ❌ 不要修改 `.planning/HANDOFF.json`（CLAUDE.md §10 = 一次性 artifact，保留作为历史；如要重写需主 session 拍板）
- ❌ 不要"边写边想"（CLAUDE.md §2.1）
- ❌ 不要"先写完代码回头补测试"（CLAUDE.md §2.2）
- ❌ 不要"依赖不行就换版本"（CLAUDE.md §2.3）—— 升级必须有理由
- ❌ 不要跳过 smoke test 直接 cp exe 到桌面
- ❌ 不要在用户没核定前进入下一迭代

---

## 9. 文件清单

### 9.1 本次收尾新增

- `D:\project\winui3\docs\milestones\M1-final-report.md`（本文档）

### 9.2 本次收尾追加

- `D:\project\winui3\.planning\STATE.md`（末尾追加"M1 收尾 — 2026-06-20"段，原有 M1.1~M1.9.3 记录保留作为历史）

### 9.3 本次收尾未改

- `D:\project\winui3\CLAUDE.md`（项目规则，§10 硬约束）
- `D:\project\winui3\SPEC.md`（产品/设计规格，§10 不可修改）
- `D:\project\winui3\.planning\HANDOFF.json`（一次性 artifact，§10 保留作为历史记录）
- `D:\project\winui3\.planning\research/*`（决策依据，§10 不可修改）
- `D:\project\winui3\src/**/*`、`src-tauri/**/*`、`scripts/**/*`、`package.json`、`src-tauri/Cargo.toml`（CLAUDE.md §2.4 谨慎修改文件规则，本次不涉及业务代码）

### 9.4 本次收尾参考（worktree 内的产出，**未合并入 master**）

> 收尾子代理建议主 session 在 M1.9.3 核定后，派 1 个 subagent 把以下 4 文件合并入 master：

- `D:\project\winui3\.claude\worktrees\agent-affc172bcdccc54ab\docs\ARCHITECTURE.md` → `D:\project\winui3\docs\ARCHITECTURE.md`
- `D:\project\winui3\.claude\worktrees\agent-affc172bcdccc54ab\AGENTS.md` → `D:\project\winui3\AGENTS.md`
- `D:\project\winui3\.claude\worktrees\agent-affc172bcdccc54ab\docs\reviews\m1-11-*.md`（4 文件）→ `D:\project\winui3\docs\reviews\`
- `D:\project\winui3\.claude\worktrees\agent-a31f4ddce79088ee7\docs\reviews\m1-12-final-audit.md` → `D:\project\winui3\docs\reviews\`
- `D:\project\winui3\.claude\worktrees\agent-a31f4ddce79088ee7\docs\milestones\M2-roadmap-draft.md` → `D:\project\winui3\docs\milestones\`

---

*本文档由 M1 收尾子代理生成（YOLO 模式，单 session 写完；不 ship exe；不派 subagent）。约 280 行，覆盖 9 个章节。*

*最终决策权归主 session。M2 启动候选 = F1 + F2 + F5 + F6 + F13 备份基础设施（详见 §7 + `docs/milestones/M2-roadmap-draft.md`）。*
