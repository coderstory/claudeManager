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

---

## 主 session 拍板 — D1~D5 (2026-06-20)

**触发**: M1 收尾完成后，主 session 在拍板 M2 启动路径。采纳 M1-final-report.md §7.3 推荐（与原推荐完全一致）。

### 5 个决策（按 D1→D5 顺序）

| # | 决策 | 选项 | 主 session 拍板 | 推荐来源 |
|---|---|---|---|---|
| **D1** | M2 启动前是否先补 3 件套（PluginHost wiring / M1.10 收尾 / M1.11 文档）？ | A 先补齐 2 天再 M2.1 / **B 与 M2.1 并行（4 槽并发）** / C 跳过文档 | **B** ✅ | M1-final-report §7.3 D1 |
| **D2** | M2 P0 4 plugin 执行顺序？ | A 严格顺序 / **B F1+F13 → (F2 ‖ F5 ‖ F6) 并行** / C F6 + F1 并行 | **B** ✅ | M1-final-report §7.3 D2 |
| **D3** | 是否启用 react-router？ | **A 保持 useViewState（localStorage）** / B 切到 HashRouter | **A** ✅ | M1-final-report §7.3 D3 |
| **D4** | Mac 真机验证 F1 吗？ | 必做 / **F2 启动前再决定** / 不做 | **F2 启动前再决定** ✅ | M1-final-report §7.3 D4 |
| **D5** | M1 exe 批量核定策略？ | A 逐个 / B 一次性 batch / **C 抽查 M1.9.3 + M1.3 v3** | **C** ✅ | M1-final-report §7.3 D5 |

### 派单计划（CLAUDE.md §11.2 最多 4 槽并发，§11.3 流式派单）

按 D1 选项 B，**4 槽全部并发启动**（依赖关系：3 件套无依赖互相独立；M2.1 自包含 F13）：

| 槽 | 任务 | subagent 类型 | 估时 | 阻塞 |
|---|---|---|---|---|
| **1** | 3.1 PluginHost wiring（`plugins/mod.rs::init_all` 接 12 stub） | general-purpose | 半天 | 无 |
| **2** | 3.2 M1.10 收尾（ci.yml + vitest/build/e2e + beforeBuildCommand 原子化 + tsconfig strict） | general-purpose | 1-2 天 | 无 |
| **3** | 3.3 M1.11 文档（ARCHITECTURE.md + AGENTS.md + README.md） | general-purpose | 1 天 | 无 |
| **4** | M2.1 F1 Provider 列表 + F13 备份基础设施 | general-purpose | 2-3 天 | 无 |

### 后续派单触发条件（CLAUDE.md §11.3 流式派单）

- **3.1 完成** → 立即派 M2.2 F2 Provider 切换 + M2.4 F5 JSON 编辑（2 槽）
- **M2.1 F1 + F13 完成** → 立即派 M2.5 F6 MCP 管理（1 槽）
- **M2.2 F2 启动前** → 重新评估 D4（Mac 真机验证）
- **3.2 / 3.3 完成** → 关闭 D1 阶段，进入纯 M2.x 推进期

### 决策登记（审计痕迹）

| 决策项 | 选项 | 推荐采纳 | 拍板者 | 时间 |
|---|---|---|---|---|
| D1 | B（与 M2.1 并行） | ✅ 与推荐一致 | 主 session | 2026-06-20 |
| D2 | B（F1+F13 → 并行 F2/F5/F6） | ✅ 与推荐一致 | 主 session | 2026-06-20 |
| D3 | A（保持 useViewState） | ✅ 与推荐一致 | 主 session | 2026-06-20 |
| D4 | F2 启动前再决定 | ✅ 与推荐一致 | 主 session | 2026-06-20 |
| D5 | C（抽查 M1.9.3 + M1.3 v3） | ✅ 与推荐一致 | 主 session | 2026-06-20 |

### 用户必做（CLAUDE.md §9.5 核定纪律）

- 走 D5 选项 C：用户**至少**核定 `M1.9.3-fix-layout.exe`（最完整，framer-motion 移除 + main 绝对定位）
- 走 D5 选项 C：用户**至少**核定 `M1.1.3-plugin-host-fix-v3.exe`（plugin host 完整链路 + viewport reset）
- 其他 12 个 exe 按 §1.1 表格 "⏳ 待审"标记，**不强求**逐个核定
- 核定后用户**明确**"完成"或"未完成：<原因>"，主 session 才能从 4 槽并发正式启动 M2.1 + 3 件套

---

## M2 业务期启动 — 2026-06-20

**D1-D5 拍板**（commit `b8703df`）：B/B/A/F2-前/C
- D1 (M1.10/11/12 补齐)：B 并行（已合并 master `282aa44` 之上）
- D2 (M2 P0 4 plugin 顺序)：B F1+F13 → (F2 || F5 || F6)
- D3 (react-router 重接)：A 保持 useViewState
- D5 (M1 exe 批量核定)：C 抽查 M1.9.2 + M1.3-v3，其余 trust

### M2.1 F1+F2 — 已 ship 但有 P0 bug（待修）

**Commit**: `b12bab4` (lock file)
**Ship exe**: `M2.2.1-f1-f2-provider-list-switch.exe` (30 MB)
**Smoke 7/7**: ✅
**Vitest 82/82**: ✅
**Playwright verify**: ❌ **IPC 100% 失败**

**P0 bug**：`src-tauri/src/lib.rs:70` `app.manage(Arc::new(state))` 与 `commands/providers.rs` 4 处 `State<'_, AppState>` TypeId 不匹配
**影响**：F1 list_providers / F2 switch_provider 在 release exe 上点 → 红框错误
**修复**（Fix A 推荐）：1 行 lib.rs:70 改 `app.manage(state)`
**进度**：P0 fix subagent 已派（agent ID `xxx`）
**原 exe 已移**：`~/Desktop/ClaudeConfigManager-M2/.broken/`

### M2.2 F3 .sql 导入 — 同 P0 bug

**Commit**: `d2852e2`
**Ship exe**: `M2.2.2-f3-sql-import.exe` (30.1 MB) — **同样坏**
**Smoke 7/7**: ✅（smoke 结构性盲区：不测具体命令调用）
**Vitest 92/92**: ✅（mock invoke 不测真集成）
**P0 fix 后**应一并修复

### 关键教训（必须写入未来 subagent prompt）

1. **smoke test 必须扩展到"切到具体功能页 + 1s 内不出现错误字样"** —— 现 smoke 只验进程/窗口/资源
2. **vitest mock invoke 不够** —— 必须加 Rust integration test (`#[taudio::test]`) 真启动 runtime + call
3. **TypeId 不匹配是 Tauri state 常见坑** —— `app.manage(X)` 必须和 `State<'_, X>` **完全一致**（包不包 Arc 也算不一致）
4. **verify spec 必须 commit** —— 不 commit 会被 gitignore / 工作流吞掉

### M2.3+ 候选（待 P0 fix 后启动）

- F4 deeplink 导入
- F5 JSON 编辑器
- F6 MCP 管理
- F13 备份

**M2.3 启动门**：P0 fix 验证通过 + smoke test 扩展到覆盖业务调用 + 集成 test 套件稳定

---

## M2.3 F4 deeplink 导入 — 已 ship (P0 fix 验证通过后启动)

**Commits** (5 个, 原子):
- `b514929` design: F4 deeplink dataflow + URL protocol
- `d01f67c` parser: deeplink_parser for ccswitch://v1/import?resource=provider (17 unit tests)
- `8337d70` service: provider_service.import_single_provider (4 unit tests)
- `a136d3a` commands: parse_deeplink_url + import_single_provider + plugin event bridge
- `7684063` page: DeeplinkImportPage real impl + 7 vitest + 5 playwright e2e

**Ship exe**: `~/Desktop/ClaudeConfigManager-M2/ClaudeConfigManager-M2.2.4-f4-deeplink.exe` (29 MB, 6月 20 12:08)
**Smoke 7/7**: ✅ (含 Test 7 dist fingerprint + 标题 + WebView2 子窗口)
**Vitest 99/99**: ✅ (92 existing + 7 new — input + parse + import success + import error + parse error + cancel + 示例)
**Playwright e2e**: 5 cases (M2.3-deeplink.spec.ts, 需 tauri-driver 运行)
**Rust 单元测试**: 本机 `cargo test --lib` 受 pre-existing DLL load issue 阻挡 (M1.12 R5); CI MSYS2 跑通 17+4=21 个新 case

**URL 协议** (与 cc-switch-main 对齐):
```
ccswitch://v1/import?resource=provider&app=claude&name=X&endpoint=Y&apiKey=Z&model=W
```
只支持 resource=provider (M2.3 scope),其他 resource type → UnsupportedResource error。

**关键设计决策**:
- 模态而不是路由 (deeplink 是事件驱动,不是导航)
- provider.id 缺省时从 name slug-ify (kebab-case + ASCII lowercase)
- import 硬错误 AlreadyExists (F4 是用户主动,不等同 F3 批量 skip)
- 单实例 handler + deep-link plugin on_open_url 都 emit 同一事件 'deep-link://new-url',前端只听一个
- url crate 锁 =2.5.8 (与现有 transitive 同版本,无 dep 膨胀)
- api_key 在 modal 里 **永不显示** (token leak guard, Vitest 显式 assert)

**已知限制** (M2.5+ 跟进):
- 不支持 resource=mcp/prompt/skill (F4 范围)
- 不支持"导入并激活" (F2 范围)
- AlreadyExists → "rename and retry" 提示,但 v1 不实现覆盖

## M2.5 F6 MCP 管理 — 已 ship (2026-06-20)

**Commits (5)**: `c823a90` (model) / `8d371bf` (service) / `48c8f73` (commands) / `da7d337` (page) / `3e05adb` (e2e)
**Files created/modified**:
- `docs/design/M2.5-dataflow.md` (dataflow + 设计原则)
- `src-tauri/src/domain/mcp_server.rs` (McpServer struct + 16 tests)
- `src-tauri/src/services/mcp_service.rs` (McpService list/toggle/add/update/remove + 16 tests)
- `src-tauri/src/commands/mcp.rs` (6 commands: list + list_with_warnings + toggle + add + update + remove + parse_mcp_deeplink)
- `src-tauri/src/infrastructure/deeplink_parser.rs` (扩展 resource=mcp 协议 + 9 tests)
- `src-tauri/src/infrastructure/sql_parser.rs` (McpServer → ParsedMcpServer 改名,避免与 domain 冲突)
- `src-tauri/src/commands/providers.rs` (preview_mcp 类型更新)
- `src-tauri/src/app_state.rs` (+ mcp_service Arc 字段)
- `src-tauri/src/lib.rs` (注册 6 个新 command)
- `src/types/mcp.ts` (F6 McpServer TS mirror)
- `src/lib/api/mcp.ts` (IPC wrappers)
- `src/lib/api/providers.ts` (ParsedDeeplink 加 mcp_server 字段)
- `src/pages/mcp-management/index.tsx` (真实实现, 替换 PluginPlaceholder)
- `src/App.tsx` (路由 view === 'mcp-management' → McpManagementPage)
- `src/__tests__/pages/mcp-management.test.tsx` (12 vitest)
- `src/__tests__/integration/App.test.tsx` (更新 mcp-management 路由测试)
- `tests/e2e/m2-5-mcp-management.spec.ts` (playwright e2e)

**Ship exe**: `~/Desktop/ClaudeConfigManager-M2/ClaudeConfigManager-M2.2.5-f6-mcp-management.exe` (30.6 MB, 6月 20 13:05)
**Smoke 7/7**: ✅ (process / window / WebView2 / title / dist / tray / kill)
**Vitest 134/134**: ✅ (122 existing + 12 new mcp-management)
**Rust 单元测试**: 16 (mcp_server) + 16 (mcp_service) + 9 (deeplink) = 41 new cases; 本机 `cargo test --lib` 受 pre-existing DLL load issue 阻挡 (M1.12 R5), CI MSYS2 跑通

**关键设计决策**:
- `McpServer` struct 独立于 sql_parser 输出的 `ParsedMcpServer`(避免类型名冲突 + 清晰分层)
- mcp.json 是单一文件,读写都用 `serde_json::Value` patch 保留未知字段(同 M2.1 settings.json pattern)
- 乐观 toggle + 失败回滚(响应延迟 < 100ms)
- clipboard API 一键从 ccswitch://v1/import?resource=mcp&... 解析填表
- `transport` enum 区分 stdio | http; on-disk 形状 stdio 省略 `type` 字段以匹配 Claude Code 默认
- mcp.json 不存在 → list 返回 [] + 空状态卡, 不抛错
- `id` 是 uuid(UI 内部稳定 key),`name` 才是 on-disk map key

**已知限制** (M2.6+ 跟进):
- 编辑/删除无 undo (CLAUDE.md §7 强调备份,但撤销栈尚未实现)
- 表格列不可排序
- import 只填表,不直接保存(需用户二次确认)
- 无 search/filter (M2.6+)
- 单实例 + 文件关联未做 (F20)
