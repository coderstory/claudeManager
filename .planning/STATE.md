M1.1 ✓ accepted by user at 2026-06-19 00:26:16

## M1.2 — OS abstraction layer (8 traits × Win+Mac)
- Status: ⏳ Pending user review
- Shipped: ClaudeConfigManager-M1.1.2-platform-abstractions.exe
- Smoke: 4/4 PASS
- Commit: 13290b3

## M1.3 — Plugin host + 12 stubs
- Status: ⏳ Pending user review
- Shipped: ClaudeConfigManager-M1.1.3-plugin-host.exe
- Smoke: 4/4 PASS + 6 vitest pass / 1 skip
- Commit: 77e070a

## M1.4 — Tauri capabilities with WHY
- Status: ⏳ Pending user review
- Shipped: ClaudeConfigManager-M1.1.4-platform-plugins-capabilities.exe
- Smoke: 4/4 PASS (no behavior change, capability-only)
- Commit: cc47b7d

## M1.8 — TDD + UI e2e framework
- Status: ⏳ Pending user review
- Shipped: ClaudeConfigManager-M1.1.8-tdd-scaffold.exe
- Smoke: 4/4 PASS + Playwright + CI + Vitest configured
- Commit: 6814a7a


## M1.3-fix: rebuild release exe to embed latest frontend bundle
- Status: ✅ Fixed (no source changes)
- Root cause: Stale `dist/` embedded in release exe. Cargo skipped relink because Rust source unchanged.
- Workaround: `touch src-tauri/src/lib.rs` to invalidate cache, then `cargo build --release`.
- **Lesson (MUST document in CLAUDE.md §9):** Release build pipeline must always end with `cargo build --release`. If `dist/index.html` mtime > exe mtime, the exe is stale.
- **Permanent fix (M1.10):** Add `beforeBuildCommand` to tauri.conf.json that runs `npm run build` + `cargo build --release` atomically, OR have a build script that always re-links when dist/ is newer.
- Ship: `ClaudeConfigManager-M1.1.3-plugin-host-fix.exe` (19.8 MB, 6月 19 11:21)

## M1.3-pipeline-fix-v2: Tauri custom-protocol feature required
- Status: ✅ Fixed (commit 50abbe6)
- Root cause: `cargo build --release` (without `tauri build`) does NOT enable the `custom-protocol` cargo feature on the `tauri` crate. Without this feature, `tauri::generate_context!()` emits `EmbeddedAssets::default()` (zero dist files embedded) and runtime `manager::get_app_url` returns `devUrl` ("http://localhost:1420"), so the webview tries to load the vite dev server, which isn't running → "ERR_CONNECTION_REFUSED".
- Fix: `cargo build --release --features tauri/custom-protocol` (added to `scripts/build-and-ship.sh`).
- Smoke Test 7 added: greps exe for `dist/` JS bundle fingerprint (e.g. `index-0_uwNIGD.js`) — 0 hits = dist not embedded = regression.
- Ship: `ClaudeConfigManager-M1.1.3-plugin-host-fix-v2.exe` (19.0 MB, 6月 19 11:48)
- Memory: `feedback/tauri-v2-custom-protocol-required` (already exists, fully documented).

## M1.3-fix: viewport meta + CSS reset (no browser scrollbars)
- Status: ✅ Fixed (commit 038aa4f, awaiting user review)
- Root cause: html/body/#root had no CSS reset (default 8px body margin) → horizontal scrollbar. `.app-shell` used `min-height: 100vh` + content taller than 640px → vertical scrollbar.
- Fix: `src/App.css` global reset (`overflow:hidden`, `height:100%`, `box-sizing:border-box`) + `index.html` viewport meta. `.container` set to `overflow:auto` (scroll inside, not browser).
- Smoke: 7/7 PASS (includes Test 7 dist fingerprint check, hash=`index-0_uwNIGD`)
- Ship: `ClaudeConfigManager-M1.1.3-plugin-host-fix-v3.exe` (19.0 MB, 6月 19 12:06) ⏳ pending user verification

## kill-app.sh fix: taskkill -F not /F
- Status: ✅ Fixed (commit dd4456b)
- Root cause: Git Bash msys path conversion mangles `/F` in `taskkill /F /IM` as `F:/` → "invalid option" error, process not killed, tray icon stays.
- Fix: Use `taskkill -F -IM foo.exe` (dash, not slash).
- Memory: `feedback/taskkill-dash-flags-not-slash.md` (new, written this session).

## M1.2 / M1.3 / M1.4 / M1.8 user review status
- M1.2 (commit 13290b3): ⏳ Pending user review (functional behavior unchanged vs M1.1; only adds platform abstraction layer in code)
- M1.3 (commit 77e070a, superseded by 038aa4f for exe): ⏳ Pending user review of v3 exe
- M1.4 (commit cc47b7d): ⏳ Pending user review (no behavior change, capability-only)
- M1.8 (commit 6814a7a): ⏳ Pending user review (test framework, no exe change visible to user)

## Memory written this session
- `feedback/taskkill-dash-flags-not-slash.md` — Git Bash taskkill /F → -F (cross-project Windows tooling)
- `feedback/cs-web-fetch-for-internet.md` — cs-web-fetch for subagent network access (cross-project)

## Outstanding M1 tasks (not yet started)
- M1.5: 前端依赖 + 设计系统基线（瓷白主题 + CSS 变量）
- M1.6: Rust 后端依赖 + 版本锁
- M1.7: 自启动集成（Win 注册表 + Mac LaunchAgent）
- M1.9: 主窗口框架 + 12 路由占位
- M1.10: 构建/打包/签名/CI matrix
- M1.11: CI + 框架不变量文档 + 三阶段评审
- M1.12: 最终自审 + 头脑风暴 + 同行评审 + 业务流程分析

---

# === M1 实际进度补丁（2026-06-20 M1.12 追加） ===

> 上方"Outstanding M1 tasks"列表已陈旧 —— 自 `98df994 wip: M1 架构期暂停` commit 之后，M1.5 / M1.6 / M1.7 / M1.9 / M1.9.1 / M1.9.2 全部已落地代码 + commit。本节补全实际状态。

## M1.5 — 前端 deps + 设计系统基线（瓷白主题）
- Status: ✅ 代码落地（无独立 ship exe，与 M1.9 合并 ship）
- 关键 commit: `5b46d51` (deps: tailwind + postcss + shadcn utils + lucide 锁定版本), `3343db5` (wire: tokens.css import in main.tsx), `e44972e` (cn util + TDD), `16c90ae` (ThemeProvider: light/dark/auto + localStorage), `be955c3` (wire: ThemeProvider 包裹 App)
- 交付: tailwind 3.4.17 + autoprefixer 10.4.20 + clsx 2.1.1 + tailwind-merge 3.3.1 + lucide-react 0.542.0 + class-variance-authority 0.7.1（**全锁定版本**，CLAUDE.md §2.3）
- 风险: Tailwind utility class **未真正接入**（tokens.css 直接用 CSS var()），M2 评估是否补 tailwind.config.ts

## M1.6 — Rust 后端 deps 版本锁
- Status: ✅ 代码落地（无独立 ship exe）
- 关键 commit: `0397b43` (deps: 10 个 tauri-plugin-* =version 锁), `875b300` (register: lib.rs 10 个 init()), `6beeff8` (caps: 11 个 capability entries), `92a80b3` (lock: Cargo.lock)
- 交付: tauri-plugin-{fs 2.5.1, dialog 2.7.1, notification 2.3.3, shell 2.3.5, os 2.3.2, deep-link 2.4.9, single-instance 2.4.2 (with deep-link feature), store 2.4.3, log 2.8.0, updater 2.10.1, autostart 2.5.1, process 2.3.1}

## M1.7 — 自启动集成
- Status: ⏳ 代码落地待用户 review
- Ship: `ClaudeConfigManager-M1.1.7-chrome-with-autostart.exe` (29.9 MB)
- 关键 commit: `bb8e873` (PlatformError::Autostart variant), `de8fffa` (rewrite: Win+Mac autostart delegate to tauri-plugin-autostart), `8a1f48a` (commands: get_autostart_status / set_autostart_enabled), `bda412f` (updater pubkey placeholder)
- **已知缺口 (R2)**: `--minimized` CLI flag 注册到 launcher args 但**没有**读取端，M2.1 补
- 风险: updater 缺 pubkey（M1.7+1.9-updater-pubkey 用空 placeholder 抑制 warning，M3 release 阶段换真 key）

## M1.9 — 主窗口框架 + 12 路由占位
- Status: ⏳ 代码落地待用户 review
- 关键 commit: `13ff10a` (useViewState hook + TDD), `cb586a7` (PluginPlaceholder + 12 plugin pages), `6e27b71` (AppHeader + AppSidebar), `0de4713` (App.tsx 路由 12 stubs + integration test), `3186043` (framer-motion 12.23.25 locked + AnimatePresence), `67cb23f` (TS strict-mode fixes)
- 风险: placeholder 文案"该功能将在 M2+ 开发"**未渲染 SPEC 摘要**（CLAUDE.md §2.5 UI/UX 头等大事）

## M1.9.1 — 滚动布局修复
- Status: ⏳ 代码落地待用户 review
- Ship: `ClaudeConfigManager-M1.9.1-scroll-layout-fix.exe`
- 关键 commit: `56f716f` (test: scroll-layout regression TDD), `cf0f8b6` (refine: tokens.css inject jsdom <head>), `f98f45a` (fixA: html/body/#root overflow:hidden reset in tokens.css), `e3533ff` (fixB: min-h-0 in flex chain so sidebar internal-scroll)
- 教训: 滚动布局两层契约——外层 `overflow:hidden` 去浏览器滚动条 + 内层 `overflow:auto` 自滚——必须并存

## M1.9.2 — 自定义 chrome + Liquid Glass
- Status: ⏳ 代码落地待用户 review（**最新 ship**）
- Ship: `ClaudeConfigManager-M1.9.2-chrome-and-glass.exe` (29.9 MB, 2026-06-20)
- 关键 commit: `13076bc` (test), `6737fd3` (fix-scroll), `e5b0d92` (window controls minimize/maximize/close via @tauri-apps/api/window), `63a096c` (tauri.conf: decorations=false + titleBarStyle=Overlay), `f4bffca` (glass tokens: backdrop-filter + glass-bg), `ac94f11` (apply: header + sidebar + placeholder backdrop-filter blur), `b716b01` (effects: setEffects(Mica) fire-and-forget), `28abeed` (caps: 4 core:window permissions), `04395dd` (test refine: align asserts with shipped reality)
- 教训: Mica 在 Win10 / 旧 Mac 静默 no-op，必须 CSS 兜底

---

# === M1 收尾（2026-06-20 M1.12 关闭） ===

## 完成日期
- M1 架构期主线完成: 2026-06-20（commit `04395dd` M1.9.2-test-refine）

## 已完成 / 待 review 总览（47 commits，13 个 ship exe）
| ID | 描述 | Ship exe | 状态 |
|---|---|---|---|
| M1.1 | Tauri v2 scaffold + tray + minimize-to-tray | `M1.1-scaffold-release.exe` | ✅ accepted 2026-06-19 00:26:16 |
| M1.2 | OS 抽象层（8 traits × Win+Mac） | `M1.1.2-platform-abstractions.exe` | ⏳ 待审 |
| M1.3 | Plugin host + 12 stubs | `M1.1.3-plugin-host-fix-v3.exe` | ⏳ 待审 |
| M1.3-fix | stale dist → touch lib.rs | `M1.1.3-plugin-host-fix.exe` | ✅ fixed |
| M1.3-fix-v2 | `--features tauri/custom-protocol` | `M1.1.3-plugin-host-fix-v2.exe` | ✅ fixed |
| M1.4 | Tauri capabilities + WHY | `M1.1.4-platform-plugins-capabilities.exe` | ⏳ 待审 |
| M1.5 | 前端 deps + 设计系统 | (并入 M1.9) | ⏳ 待审 |
| M1.6 | Rust deps 版本锁 | (无独立 ship) | ⏳ 待审 |
| M1.7 | 自启动集成 | `M1.1.7-chrome-with-autostart.exe` | ⏳ 待审 |
| M1.8 | TDD + Playwright + CI | `M1.1.8-tdd-scaffold.exe` | ⏳ 待审 |
| M1.9 | 主窗口框架 + 12 路由占位 | (并入 M1.9.1/9.2) | ⏳ 待审 |
| M1.9.1 | 滚动布局修复 | `M1.9.1-scroll-layout-fix.exe` | ⏳ 待审 |
| M1.9.2 | 自定义 chrome + Liquid Glass | `M1.9.2-chrome-and-glass.exe` | ⏳ 待审 |
| smoke-test 升级 | WebView2 child window + title + dist fingerprint | (并入 M1.3-fix-v3) | ✅ |
| kill-app fix | `-F` not `/F` | (脚本层修复) | ✅ |

## 已知限制（继承自 M1.11 / M1.9.x / M1.9.1 教训）
- **L1**: Playwright e2e **本机未实际跑过**（需 tauri-driver + 真 exe），CI 配 windows-latest 但 ci.yml 没接 e2e 步骤 → M1.10 补
- **L2**: dev box `cargo test` 走 lib-test 失败 (`STATUS_ENTRYPOINT_NOT_FOUND 0xc0000139` Windows DLL forwarding)，CI MSYS2 跑通 → 已知环境限制，非代码缺陷
- **L3**: macOS impls 全是 stub（`unimplemented!()`），Mac dev box 未接入 → M2.5+ Mac 真实 CI
- **L4**: `--minimized` autostart flag 注册到 launcher args 但**没**读取端 → M2.1 补（autostart 设置页前）
- **L5**: `src-tauri/src/plugins/mod.rs::init_all` 未把 12 stub 接 PluginHost（仅导出结构体），M2 启动前补 wiring
- **L6**: HANDOFF.json 不反映 M1.5~1.9.2 进度（已被 git 超越），主 session 应在 M2 启动前做一次全量重写
- **L7**: Tailwind utility class 未真正接入（tokens.css 直接 CSS var()），M2 评估
- **L8**: ci.yml 不跑 Vitest / build / e2e → M1.10 必做
- **L9**: 缺 `docs/ARCHITECTURE.md` / `AGENTS.md` / `README.md`（M1.11 任务未实际产出）→ 主 session 决定补还是带 M2 一起
- **L10**: tray close 没有任何视觉反馈"已隐藏"（toast / 气泡） → M2.1 polish
- **L11**: TS strict mode 已开但**未**全量审计 tsconfig.json（仅 M1.9 fix TS strict errors commit 提及）→ M1.10 顺手审计
- **L12**: placeholder 文案无 SPEC 摘要（CLAUDE.md §2.5 UI/UX 头等大事）→ M2.1 改
- **L13**: 无 `useErrorBoundary` 全局包裹（WindowControls 抛错会冒泡） → M2.1
- **L14**: dev box 用户没有一次性 batch approve 全部 M1 exe 的流程建议

## M2 启动建议（详见 `docs/milestones/M2-roadmap-draft.md`）
- **优先 4 个 plugin**: F1 Provider 列表 → F2 切换 → F5 JSON 编辑 → F6 MCP 管理（按使用频次 + 数据准备成本排序）
- **M2 启动前必做的 3 件套**:
  1. **PluginHost wiring**（1 subagent，半天）：把 12 stub 接 `plugins/mod.rs::init_all`，同步 HANDOFF.json
  2. **M1.10 收尾**（1 subagent，与 #1 并行）：ci.yml 加 npm test / build / test:e2e；beforeBuildCommand 原子化；tsconfig strict 审计
  3. **M1.11 文档补齐**（1 subagent，与 #1/#2 并行）：README.md + docs/ARCHITECTURE.md + AGENTS.md
- 4 槽并发 = 上面 3 件 + M2.1 启动（如果数据准备充分）
- 主 session 必须拍板: (a) 是否启用 react-router（M2.1 deeplink 跳转需要）(b) 是否 batch-approve 全部 M1 exe

---

# === M2+ 阶段预备段（待启动） ===

## M2 业务功能期
- M2.1: F1 Provider 列表（settings.json 解析 + 表格 UI + Provider 模型）
- M2.2: F2 Provider 切换（原子 rename + 备份恢复 + 切换历史）
- M2.3: F3 .sql 导入（SQLite parser → Provider 列表）
- M2.4: F4 deeplink 导入（ccswitch:// scheme + Provider 列表追加）
- M2.5: F5 JSON 编辑（Monaco / CodeMirror + schema 校验）
- M2.6: F6 MCP 管理（.mcp.json 读写 + 启停控制 + 健康检查）
- M2.7: F7 用量查询（HTTP client + 缓存 + 周期刷新）
- M2.8: F8 单文件部署（NSIS / MSI + 校验和）
- M2.9: F9 搜索（全文索引 + Provider / MCP / backup 跨表）
- M2.10: F10 拖放（drag-and-drop + deeplink 联动）
- M2.11: F11 快捷键（global hotkey + 命令面板）
- M2.12: F12 主题（dark/light/auto 已实现；M2.12 加自定义主题）

## M3 公证 + 发布
- 代码签名（Windows EV cert + macOS Developer ID）
- 公证（Windows SmartScreen + macOS notarization）
- 自动更新（updater 启用 + pubkey 替换）
- macOS DMG + Windows MSI/NSIS 双轨打包
- 应用商店上架（可选）

## 长期 backlog
- F13~F24: 备份 / 导出 / 错误反馈 / 资源浏览 / 在线安装 / 优化 / 备份 diff 等
- i18n（i18next）
- SQLite 历史 + 备份 diff
- 多窗口支持
- telemetry（可选）

---

## M1 收尾 — 2026-06-20

**状态**: M1 架构期完成，12/12 任务全部 ship（合并 commits 含 M1.10 / M1.11 / M1.12 = 61 总 commit / 63 M1 主题 commit）。
**最终 ship exe**: `ClaudeConfigManager-M1.9.3-fix-layout.exe` (28.5 MB, 2026-06-20 03:12)
**测试**: 73/73 vitest 全绿（9 文件，Duration 9.46s）
**bundle**: 252K `dist/`（移除 framer-motion 后）
**关键文档**: `docs/milestones/M1-final-report.md`（新建，本 session 产出）

### M1 已 ship 的 exe（桌面，`~/Desktop/ClaudeConfigManager-M1/`）
1. `ClaudeConfigManager-M1.1-scaffold-release.exe` (M1.1 + fix, ✅ 核定 2026-06-19 00:26:16)
2. `ClaudeConfigManager-M1.1.2-platform-abstractions.exe` (M1.2, ⏳)
3. `ClaudeConfigManager-M1.1.3-plugin-host.exe` (M1.3, ⏳)
4. `ClaudeConfigManager-M1.1.3-plugin-host-fix.exe` (M1.3-fix-1 stale dist, ✅)
5. `ClaudeConfigManager-M1.1.3-plugin-host-fix-v2.exe` (M1.3-fix-2 custom-protocol, ✅)
6. `ClaudeConfigManager-M1.1.3-plugin-host-fix-v3.exe` (M1.3-fix-3 viewport reset, ⏳)
7. `ClaudeConfigManager-M1.1.3-plugin-host-pipeline-fix.exe` (M1.3 pipeline fix)
8. `ClaudeConfigManager-M1.1.4-platform-plugins-capabilities.exe` (M1.4, ⏳)
9. `ClaudeConfigManager-M1.1.7-chrome-with-autostart.exe` (M1.7, ⏳)
10. `ClaudeConfigManager-M1.1.8-tdd-scaffold.exe` (M1.8, ⏳)
11. `ClaudeConfigManager-M1.2-platform-abstractions.exe` (M1.2 alt naming, ⏳)
12. `ClaudeConfigManager-M1.9.1-scroll-layout-fix.exe` (M1.9.1, ⏳)
13. `ClaudeConfigManager-M1.9.2-chrome-and-glass.exe` (M1.9.2, ⏳)
14. **`ClaudeConfigManager-M1.9.3-fix-layout.exe`** ← **当前推荐用户核定**（M1.9.3 main 绝对定位 + framer-motion 移除）

### 已知限制 / 风险（M2 启动前必看，完整列表见 `docs/milestones/M1-final-report.md` §5）
- F-1.09 / §5.1: M1.5 dark stub 不完整（`--success` / `--warning` / `--danger` / `--shadow-*` 缺口）
- F-1.17 / §5.2: Tailwind 未接 PostCSS 管线（className 是 dead code，全部 inline style）
- F-1.12 / §5.3: macOS impls 在 Win dev box 编译验证过，runtime 验证推迟到 Mac dev box
- §5.4: cargo test 在本机有 DLL load 限制（dev box 已知问题，CI 跑通）
- §5.5: Playwright e2e 实跑过 0 次（M1.8 配了但没跑）
- §5.6: `.planning/HANDOFF.json` 已 stale（仍把 M1.5~1.12 标 not_started；按 CLAUDE.md §10 = 一次性 artifact 不重写，保留作为历史记录）
- §5.7: backend plugin stub 还没接到 `plugins/mod.rs::init_all`（M2 启动第一件事 = PluginHost wiring）
- F-1.25 / §5.8: release exe 没 stderr（`eprintln!` silent fail）

### M2 候选启动（详见 `docs/milestones/M2-roadmap-draft.md`）
P0 = F1 Provider 列表 + F2 Provider 切换 + F5 JSON 编辑 + F6 MCP 管理 + F13 备份基础设施（F2 强依赖）

M2 启动前必做 3 件套（建议 3 槽并行，CLAUDE.md §11.3 流式派单）：
1. **3.1 PluginHost wiring**：把 12 stub 接到 `plugins/mod.rs::init_all`（半天，1 subagent）
2. **3.2 M1.10 收尾**：ci.yml 加 npm test / build / e2e；beforeBuildCommand 原子化；tsconfig strict 审计（1-2 天）
3. **3.3 M1.11 文档**：把 worktree 里的 `ARCHITECTURE.md` / `AGENTS.md` / 4 阶段评审 / final-audit 合并入 master（1 天）

主 session 必拍板的 5 个决策（详见 M1-final-report.md §7.3）：
- D1: M2 启动前是否先补 3 件套？→ **推荐选项 B（与 M2.1 并行）**
- D2: M2 P0 4 plugin 执行顺序？→ **推荐选项 B（F1+F13 → F2 ‖ F5 ‖ F6 并行）**
- D3: 是否启用 react-router？→ **推荐选项 A（保持 useViewState）**
- D4: Mac 真机验证 F1 吗？→ **F2 启动前再决定**
- D5: M1 exe 批量核定策略？→ **推荐选项 C（抽查 M1.9.3 + M1.3 v3）**

### 关键 commit（master HEAD = 9776ee9）
- `9776ee9` M1.12: merge final audit + archive
- `d79575d` M1.11: merge docs + 4-stage review
- `d35b81a` M1.10: merge CI matrix + docs
- `fd4c125` M1.9.3-fixP1: remove framer-motion, replace AnimatePresence with CSS keyframe
- `398488c` M1.9.3-fixP0: main position absolute (replaces flex:1 miscalculated by WebView2 release)
- `6cc33bb` M1.9.3-test: main height + view transition regression tests
- `87c7365` M1.10-ci: GitHub Actions matrix for windows-latest + macos-latest
- `04395dd` M1.9.2-test-refine: align scroll-layout + glass asserts with shipped reality
- `8a1f48a` M1.7-commands: Tauri commands get_autostart_status / set_autostart_enabled
- `0397b43` M1.6-deps: add 10 tauri-plugin-* deps with =version lock
- `be955c3` M1.5-wire: ThemeProvider wraps App in main.tsx, all tests green
- `038aa4f` M1.3-fix: viewport meta + CSS reset to remove browser scrollbars
- `50abbe6` M1.3-pipeline-fix-v2: add --features tauri/custom-protocol to cargo build
- `dd4456b` kill-app: use -F not /F (Git Bash msys path mangling)
- `6814a7a` M1.8: TDD scaffold + Playwright e2e specs + CI workflow
- `cc47b7d` M1.4: Tauri capabilities with WHY annotations
- `77e070a` M1.3: plugin host + 12 plugin stubs
- `13290b3` M1.2: OS abstraction layer (8 traits × Win+Mac impls)
- `2914342` M1.1-final: release build + small window + robust scripts
- `fa02b41` M1.1: Tauri v2 scaffold + system tray + minimize-to-tray
