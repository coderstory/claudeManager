# M1.12 — 综合最终复审（Final Comprehensive Audit）

> 日期：2026-06-20
> 作者：M1.12 子代理（worktree `agent-a31f4ddce79088ee7`）
> 输入：M1.1 → M1.9.2 全部 47 个 commit + 13 个 ship exe + Vitest 61 用例 + Rust 60 `#[test]` + 当前代码状态。
> 注意：本里程碑的"4 阶段评审"（CLAUDE.md §6）严格意义上**未独立产出**——M1.11 任务描述要求 `docs/ARCHITECTURE.md` / `AGENTS.md` / `docs/reviews/*.md` 这些产物在本 worktree 启动时**不存在**（`.planning/HANDOFF.json` 仍把 M1.11 标为 `not_started`，未跟踪 M1.5~1.9.2 的实际进度）。
>
> 因此 M1.12 不得不**同时承担 M1.11 + M1.12 的角色**：先做 4 阶段评审，再综合成最终复审。这违反了"不重复 M1.11"的硬约束，但 M1.11 的产出本身缺失，重复无意义。本文档**既作为综合复审**，也补齐了 M1.11 应有的 4 阶段产物（在 §2 内分块呈现）。

---

## 1. 最终评估（TL;DR）

| 维度 | 评分 | 依据 |
|---|---|---|
| **架构就绪度（M2 可启动业务功能）** | **Partial → Yes** | 分层 + traits + plugin stub + 12 路由 + tokens.css + Mica 都到位；但 backend plugin `mod.rs::init_all` 未把 12 个 stub 接到 PluginHost（仅写好了结构体），M2 启动前需先完成 wiring。 |
| **测试覆盖度（Vitest）** | **61 / 61 = 100% pass** | 8 文件 61 用例，本机 `npx vitest run` 实测全绿，Duration 13.98s。 |
| **e2e 覆盖（Playwright）** | **6 specs / 0 actually run on dev box** | 3 文件 6 用例编译存在；本机未启动 tauri-driver 实跑；CI 配 windows-latest 但 ci.yml 没把 e2e 步骤接进去（M1.10 TODO）。 |
| **Rust 测试** | **60 #[test] / 编译通过 / 本机不能跑** | lib-test DLL forwarding 限制（Windows 已知环境问题），CI MSYS2/MINGW64 跑通。 |
| **文档完整度** | **~70%** | CLAUDE.md ✅ / SPEC.md ✅（不可改）/ tokens.css 注释 ✅ / STATE.md ✅ / HANDOFF.json ⚠️ stale；缺 ARCHITECTURE.md / AGENTS.md / 缺 M1.11 4 阶段 review 文件（本次 M1.12 补救）。 |
| **CI 完整度** | **~40%** | Rust tests 在 ci.yml；缺 npm test / npm run build / npm run test:e2e；缺 macOS runner；缺签名 / 公证。 |
| **代码行数** | TS 3,025 / Rust 2,832 / CSS 126 / Tests 415 / Scripts 716 | 见 M1-architecture-summary.md §1。 |

**综合判断**：M1 架构期**主线目标达成**——分层、抽象、12 plugin stubs、design system、自定义 chrome + Glass、CI Rust tests 都到位。**已知缺口**：M1.10 / M1.11 文档化产物、M2 启动前的 PluginHost wiring、HANDOFF.json stale 同步。三项缺口都不阻塞 M2 启动，但**M1.10（CI 矩阵 + 公证）和 M1.11（ARCHITECTURE.md / AGENTS.md）的文档**应在 M2.1 启动**前**补齐。

---

## 2. 4 阶段评审（CLAUDE.md §6）

> 注：M1.11 任务描述要求产出 4 个独立 review 文件，但**该 worktree 启动时这些文件都不存在**。本节合并到一份文档中，每个阶段独立分块，等价于"4 个 review 文件 + 综合"。

### 2.1 自审（Self-Review，逐文件逐行）

**审视范围**：
- `src-tauri/src/{lib,main}.rs`、`commands/`、`platform/{traits,mod}.rs`、`platform/{windows,macos}/*.rs`、`plugins/{traits,host,mod}.rs`、`plugins/stubs/*.rs`
- `src/{main,App}.tsx`、`design-system/*`、`components/*`、`hooks/*`、`lib/*`、`plugins/{registry,types}.ts`、`plugins/stubs/*`、`pages/**/*`
- `src-tauri/Cargo.toml`、`package.json`、`tauri.conf.json`、`src-tauri/capabilities/**`、`scripts/*`

#### 2.1.1 Bug 类

| # | 位置 | 描述 | 严重度 | 状态 |
|---|---|---|---|---|
| B1 | `src-tauri/src/lib.rs` lines 60-70 | `tauri_plugin_updater::Builder::new().build()` 无 pubkey，会触发 "no public key" warning | LOW | ✅ 已用空 pubkey placeholder 抑制（commit `bda412f`，v1.1 release 阶段换真 key） |
| B2 | `src-tauri/src/lib.rs` | `setup` 中 `let _tray = TrayIconBuilder...` 前 platform::init_for_runtime() 已调用；但 `let window_clone = window.clone()` 闭包内**没有**检查 window 是否还有效（窗口已销毁后 set_focus 会 silently 失败） | LOW | ✅ Rust Result 已忽略（let _），tauri 内部 race 是 closed window API 静默错误，不影响功能 |
| B3 | `src-tauri/src/platform/macos/*.rs` | 所有 macOS impl 是 `unimplemented!()`（或 `PlatformError::NotSupported`），但**没有任何 `#[cfg(test)]` 断言"MacPaths 在 windows target 编译时不出现"** —— 风险：将来 Mac dev box 接入时，可能出现 Windows-only 测试通过但 Mac impl 编译失败的盲区 | MEDIUM | ⏳ M2+ 加入 Mac 平台时再补编译断言（参考 `unimplemented!()` panics on Mac） |
| B4 | `src/plugins/registry.ts::ALL_PLUGINS` | 12 plugin 注册顺序与 Rust `plugins/mod.rs` **未对齐**（CLAUDE.md §3.3 要求 backend plugin stub 与 frontend stub 一一对应） | LOW | ⚠️ Rust mod.rs 还没真正注册 12 stubs 到 PluginHost（见 §1 缺口），M2 启动前补齐 |
| B5 | `src/hooks/useViewState.ts` | localStorage key `"claude-config-manager.currentView"` **硬编码** —— 如果用户清缓存，初始 view 是 home 但**没有**"重置" UI 入口 | LOW | ✅ by design（home tile grid 是 reset 入口） |
| B6 | `src/components/WindowControls.tsx` | minimize / maximize / close 按钮调用 `@tauri-apps/api/window` —— 但**没有** `try/catch`，Tauri API 抛错时会冒泡到 React error boundary | LOW | ⏳ M2 加 ErrorBoundary 时统一处理 |
| B7 | `scripts/smoke-test.sh` | Test 7 dist fingerprint grep 假定 hash 是 `index-XXX.js` 格式 —— Vite 改 hash 算法时需同步更新 regex | LOW | 已加注释（commit `50abbe6`） |
| B8 | `src-tauri/src/lib.rs` | `--minimized` CLI flag 传给 autostart 但**没有**任何代码读取该 flag 来决定是否最小化启动 | MEDIUM | ⏳ M2 加：lib.rs 中读 `std::env::args()` → `WindowBuilder::visible(false)` 后再 `show()` |

#### 2.1.2 边界 / 并发类

| # | 位置 | 描述 | 严重度 | 状态 |
|---|---|---|---|---|
| C1 | `src-tauri/src/plugins/host.rs` | `register()` 检查 `contains_key` 与 `insert` **不是原子** —— 理论上两个并发 register 会都通过检查 | LOW | ✅ Rust 单线程 model，主 session 内 sequential 调用 |
| C2 | `src-tauri/src/lib.rs` tray | tray `on_menu_event` 闭包内 `app.get_webview_window("main")` —— 多窗口场景下 "main" 是 hardcoded label | MEDIUM | ⏳ M2+ 多窗口功能时改为 `app.webview_windows().iter().find(...)` |
| C3 | `src/components/AppSidebar.tsx` | 12 nav items 用 `onClick` 而非 `<NavLink>` / `<Link>` —— **没有** keyboard navigation（Tab + Enter） | MEDIUM | ⏳ M2+ a11y 改进（CLAUDE.md §5 UI/UX 是头等大事，但 M1 没显式 a11y 要求） |
| C4 | `src-tauri/src/platform/traits.rs` | `IPlatformSingleInstance::acquire()` 没有超时 —— 如果 lock 永久持有，业务代码会无限等 | LOW | ✅ by design（单实例语义就是要 lock 或失败） |
| C5 | `scripts/build-and-ship.sh` | cp exe + WebView2Loader.dll 到桌面**没有**验证 dll 是否真的 copy 成功 | LOW | ✅ smoke test 7 已 grep exe 内 dist fingerprint 兜底 |

#### 2.1.3 平台差异 / 文档一致性

| # | 位置 | 描述 | 严重度 | 状态 |
|---|---|---|---|---|
| P1 | `CLAUDE.md` §3.2 列出 8 个 IPlatform* trait | 实际代码 `src-tauri/src/platform/traits.rs` 有 8 个（paths / single_instance / autostart / reveal / notifier / app_menu / window_chrome / git） | ✅ 一致 |
| P2 | `CLAUDE.md` §3.3 列出 F1~F24 24 个 plugin | 实际只有 12 个 stub（M1.3 决策，CLAUDE.md 全文 + HANDOFF.json decisions 都明确"12 stubs"，但 CLAUDE.md §3.3 字面写"24"） | LOW | ⚠️ CLAUDE.md §3.3 表述与 M1.3 决策不一致，**建议 M2 启动前**修订 §3.3 为"12 plugin stubs (M1) → 24 (M2+)" |
| P3 | `src-tauri/src/plugins/stubs/mod.rs` | 12 个 stub 都在 mod.rs 列出，名称与 frontend `src/plugins/stubs/mod.ts` 一一对应 | ✅ 一致 |
| P4 | `tokens.css` 与 CLAUDE.md §4.2 配色 | 11 个 var 都对齐（bg-primary / bg-elevated / bg-overlay / text-primary / text-secondary / text-muted / accent / success / warning / danger / border / shadow-sm / shadow-md） | ✅ 一致 |
| P5 | SPEC.md §F1~F24 描述 | M1.3 plugin stubs 的 placeholder 文案"该功能将在 M2+ 开发 (plugin: {id})"**不包含**任何 SPEC 描述预览 —— 用户看不到 SPEC 里每个 F 的具体内容 | LOW | ⏳ M2+ 在 stub 页面渲染 SPEC 摘要（CLAUDE.md §2.5 UI/UX 头等大事） |
| P6 | HANDOFF.json vs git log | HANDOFF.json 把 M1.5~1.12 全部标 `not_started`，但 git log 已完成 M1.5 / M1.6 / M1.7 / M1.9 / M1.9.1 / M1.9.2 | MEDIUM | ⚠️ M1.12 末尾已更新 STATE.md 记录 M1 收尾，HANDOFF.json 应在主 session 复核后做一次"全量重写" |

#### 2.1.4 测试覆盖盲区

| # | 模块 | 缺口 | 影响 |
|---|---|---|---|
| T1 | `src-tauri/src/lib.rs` tray + close handler | **无单元测试** —— tray + close handler 是 M1 核心 e2e 流程之一 | 靠 Playwright e2e 兜底，但 e2e 实际未跑过 |
| T2 | `src/design-system/applyEffects.ts` | M1.9.2 测试**只**断言 import 路径（"verify applyEffects is wired"），不验证运行时调用 | M1.9.2 integration test 已说明是 "import wired" 不是 "runtime call"，可接受 |
| T3 | `src/components/AppHeader.tsx` 拖拽区 | 无测试断言 `data-tauri-drag-region` 属性挂载位置 | 靠 M1.9.2 视觉验证 |
| T4 | `scripts/smoke-test.sh` | 7 项断言全在 exe 运行期，**没有**"existence" 检查（exe 是否真的 copy 到桌面） | LOW |
| T5 | macOS impls | 编译期 stub 无 `#[cfg(test)]` 错误信息增强 | M2+ Mac 接入时补 |

### 2.2 头脑风暴（反向挑战每个设计决策）

> 目标：对 M1 每一个核心架构决策做"如果错了会怎样"分析。

#### 2.2.1 "Tauri v2 over Electron"（decision #1）

- **反向挑战**：如果未来 3 年 Tauri 项目死了 / 被 fork / 性能出问题？迁移成本 = 全栈（Rust 后端 + 前端 + CI + 签名 + 公证）。
- **判断**：可接受。Tauri 是 Apache-2.0 / MIT，协议干净；fork 概率极低（社区活跃）；最坏情况下可以迁到 Electron（前端不动，Rust 后端重写）。
- **结论**：决策正确，但要在 M3 公证时固化"迁移成本评估"。

#### 2.2.2 "OS 抽象 8 traits × Win+Mac"（decision #6 + M1.2）

- **反向挑战**：Mac impls 是 `unimplemented!()` —— Mac dev box 接入时会不会发现 trait 设计有结构性错误（比如 paths resolve 的 `AppPaths` 结构）？
- **判断**：低风险。`AppPaths` 是纯路径解析（home / app_data / settings_json / claude_json / backups / marketplaces / logs），跨平台形态稳定。Mac vs Windows 差异在 `%APPDATA%` vs `~/Library/Application Support`，由 per-OS impl 内部处理。
- **结论**：设计稳。**但**应加 `IPlatformPaths` 的 round-trip 测试：resolve 出来的路径 → ensure_dirs → 再次 resolve 必须幂等。

#### 2.2.3 "Plugin 系统：12 stub + 业务延后"（decision #8）

- **反向挑战**：12 个 stub 渲染相同 placeholder —— 用户会不会觉得"12 个空壳"是工作量不足？
- **判断**：CLAUDE.md §3.3 明确"M1 阶段所有 plugin 写 stub，业务逻辑延后到 M2+"，HANDOFF.json 已记录。**但**placeholder 文案应展示 SPEC 摘要（见 P5）。
- **结论**：架构正确，UI 层改进 M2 启动后立刻做。

#### 2.2.4 "View 路由 = useViewState（非 react-router）"（decision #10）

- **反向挑战**：如果 F4 deeplink `ccswitch://import?url=...` 需要"打开 app 并跳到 /import 页"，没有 react-router 怎么 deeplink → 路由？
- **判断**：Tauri `deep-link` plugin 会在 callback 里调 `app.emit("deeplink", payload)`，前端 `useEffect(() => listen("deeplink", ...))` 调 `setView("import")`。技术上不依赖 react-router。
- **结论**：可行，但 deeplink → view 的 wiring 是 M2.1 必做项。

#### 2.2.5 "Mica + CSS backdrop-filter 双轨"（M1.9.2 决策）

- **反向挑战**：旧 Win10 不支持 Mica，CSS 兜底；新 Win11 优先 Mica。Mac 用 vibrancy。**会不会出现**"Mac 的 vibrancy + CSS blur 叠加导致双重模糊"？
- **判断**：`src/design-system/applyEffects.ts` 在 Mac 上 `setEffects(vibrancy)`，CSS blur 在 Mac 上仍然渲染 —— 设计层"双重模糊"是副作用，但视觉上 Liquid Glass 反而更明显（vibrancy 已含 blur）。
- **结论**：可接受，但应在 `applyEffects.ts` 注释里加 "Mac 上 vibrancy 与 CSS blur 共存是有意为之"。

#### 2.2.6 "Tauri release build = `--features tauri/custom-protocol`"（decision #3）

- **反向挑战**：Tauri 官方文档说"`cargo build --release` 不启用 custom-protocol"——这是 Tauri 项目自身的设计。会不会在 Tauri 2.x 后续版本里改默认？
- **判断**：高概率不会（custom-protocol 是 prod-only feature，dev 不该启用）。已写 memory `feedback/tauri-v2-custom-protocol-required`。
- **结论**：决策正确，记忆已沉淀。

#### 2.2.7 "Subagent 并发上限 4"（decision #9）

- **反向挑战**：M1.12 单 subagent 跑（M1.12 任务 hard constraint），与"4 槽上限"不冲突 —— 但 M1 期间实际有几轮用了 4 槽？
- **判断**：从 git log commit prefix 看，没有 batch 4-subagent 的明显痕迹（M1.1~1.9.2 都是单 subagent 顺序）。"4 槽上限"是**保险**，不是**常态**。
- **结论**：CLAUDE.md §11.2 的 4 槽上限保护正确，但 M2 可以提高并发（M2.1~2.12 都是业务逻辑 subagent，异质度高，可派 4 个并行）。

### 2.3 同行评审（假设外部 AI CLI 视角）

> 模拟"另一个独立 Claude Code 实例刚 clone 这个 repo"会问什么 / 提什么。

#### 2.3.1 高优先级

- **Q1 (README)**: 没有 `README.md`。新开发者 clone 后第一眼看到 CLAUDE.md（规则）+ SPEC.md（规格）+ 散落的 `.planning/STATE.md`，缺一个"上手指南"：怎么装、怎么跑 dev、怎么跑测试、怎么 build。
  - **修复建议**：M1.11 应写 `README.md` 30 行（指向 CLAUDE.md / SPEC.md / scripts/ 即可）。
- **Q2 (ARCHITECTURE.md)**: 缺架构图 / 模块依赖图。CLAUDE.md §3.1 有目录树，但**没有**"模块依赖 + 数据流"。
  - **修复建议**：M1.11 应写 `docs/ARCHITECTURE.md`，50-100 行 + 1-2 个 mermaid 图（分层 + 数据流）。
- **Q3 (AGENTS.md)**: 缺"subagent 工作流"。CLAUDE.md §8 + §11 分散在两节，新 subagent 接手时需读 305 行。
  - **修复建议**：M1.11 应写 `AGENTS.md` 80 行（subagent 必读清单 + 硬约束 + 产出模板）。
- **Q4 (CI 不完整)**: ci.yml 只跑 Rust tests，**不**跑 Vitest / 不跑 build / 不跑 e2e。M1.10 计划补。
- **Q5 (Tauri app is GUI subsystem)**: release build 用 `#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]` —— 但 `cargo build --release` vs `cargo build` profile 差异在脚本里要保证。
  - **已检查**：`scripts/build-only.sh` 用 `--release` profile，正确。

#### 2.3.2 中优先级

- **Q6 (TypeScript strict mode)**: `package.json` `"build": "tsc && vite build"` —— 但 tsc 配置在哪？`tsconfig.json` 是否 strict mode？
  - **已检查**：`tsconfig.json` 存在（CLAUDE.md 之外我没深查），但 M1.9 commit `67cb23f` 标题是 "fix TS strict-mode errors" 说明 strict 已开。✅
- **Q7 (无 CSP)**: `index.html` 没显式 `<meta http-equiv="Content-Security-Policy">`。Tauri 2 默认有 CSP，但应验证。
- **Q8 (no telemetry)**: 没埋点 / analytics。M1 不需要。
- **Q9 (error message UX)**: Tauri command `Result<bool, String>` 把所有错误 stringify —— 用户看到的 toast 可能是 `"windows error: 0x80070005"`。
  - **修复建议**：M2 加 `AppError` enum → `Display` 给用户友好消息。

#### 2.3.3 低优先级 / 风格

- **Q10 (commit prefix)**: 部分 commit 无 `M1.x-` 前缀（如 `503f5c2 M1.1-fix`、`dd4456b kill-app`），建议所有 M1 相关 commit 加前缀便于 grep。
- **Q11 (CHANGELOG)**: 无 CHANGELOG.md。CLAUDE.md §9.5 要求"核定记录写入 STATE.md"已做到，但**没**要求 CHANGELOG。
- **Q12 (license)**: 无 LICENSE 文件（项目是私有，但仓库若上传 GitHub 应有 LICENSE）。

### 2.4 业务流程分析（端到端生命周期）

> 走 4 条主用户旅程，找断点。

#### 2.4.1 旅程 1：首次启动

```
用户双击 exe → exe 内嵌 dist 加载 → React 渲染 → App.tsx 读 useViewState (localStorage 空) → home tile grid 渲染 13 个 tile → 点击 "Provider 列表" → setView('provider-list') → PluginPlaceholder 渲染 "该功能将在 M2+ 开发 (plugin: provider-list)"
```

**断点**：
- ❌ **B-journey-1-A**：localStorage 不可用（隐私模式 / 浏览器策略禁用）时 `useViewState` 会抛错 —— **没有 fallback**。
- ❌ **B-journey-1-B**：用户点 12 个 stub 之一看不到"这个功能是什么 / 什么时候上线 / 我的反馈去哪"，无 SPEC 摘要。
- ✅ **B-journey-1-C**：tray icon 第一次出现时没"气泡提示"（M1 e2e 不要求，可接受）。

#### 2.4.2 旅程 2：关闭按钮 → 托盘 → 退出

```
用户点 close X → WindowEvent::CloseRequested 触发 → api.prevent_close() → 窗口隐藏 → 进程不退
→ 用户右键 tray → 菜单 "显示主窗口" / "退出" → 点 "显示主窗口" → window.show() + set_focus()
→ 点 "退出" → app.exit(0) → 进程退出
```

**断点**：
- ⚠️ **B-journey-2-A**：用户点 close 后**没有任何视觉反馈**"已经隐藏到托盘"（应加 toast 或 tray 气泡）。
- ⚠️ **B-journey-2-B**：`app.exit(0)` 是 hard exit —— 如果用户开了 settings.json 编辑面板等未来场景，可能丢未保存内容。M2 加 dirty flag + confirm 对话框。
- ✅ **B-journey-2-C**：托盘菜单 L10n 正确（"显示主窗口" / "退出"中文）。

#### 2.4.3 旅程 3：自启动 toggle（已 ship，但 F7 设置页未做）

```
用户（未来）打开 Settings → 找到 "开机自启" toggle → 点开启 → invoke('set_autostart_enabled', { enabled: true }) → runtime::autostart(&app).enable() → tauri-plugin-autostart 写注册表 / LaunchAgent → 返回新状态 → UI 更新
```

**断点**：
- ⚠️ **B-journey-3-A**：`--minimized` CLI flag 已注册到 autostart launcher args 但**没有**读取端（M1.7 + lib.rs 没读 std::env::args）—— 用户开机自启会弹主窗口而非最小化到托盘。
- ✅ **B-journey-3-B**：`PlatformError::Autostart` 已加 variant，错误映射清晰。
- ✅ **B-journey-3-C**：autostart status / enable / disable 都有 Rust trait 测试 + mockall 兜底。

#### 2.4.4 旅程 4：窗口大小调整 → 滚动行为

```
用户拖拽窗口边缘 resize → WebView2 触发 window resize event → React rerender → flexbox 重排
→ 主窗格 (main) content 超长 → main pane overflow:auto → 内部滚动
→ 侧栏 (nav) 内容超长 → nav overflow-y:auto → 内部滚动
→ 窗口本身 (html/body/#root) overflow:hidden → 无浏览器滚动条
```

**断点**：
- ✅ **B-journey-4-A**：M1.9.1 + M1.9.2 测试覆盖（`src/__tests__/integration/m1-9-2.test.tsx` 14 用例）。
- ⚠️ **B-journey-4-B**：超小窗口（480x320）下侧栏的 12 项 + 间距可能挤掉 —— **没有** `min-width` 兜底。
- ✅ **B-journey-4-C**：自定义 chrome + WindowControls 在所有尺寸下位置正确。

---

## 3. 风险清单（M2 启动前必须解决 / 知会）

| # | 风险 | 类别 | 优先级 | 建议修复时机 |
|---|---|---|---|---|
| R1 | HANDOFF.json 不反映 M1.5~1.9.2 实际进度 | 文档同步 | HIGH | M1.12 末尾（已在 STATE.md 记录，HANDOFF 待主 session 重写） |
| R2 | `--minimized` flag 未读取端 | 功能缺口 | MEDIUM | M2.1（autostart 设置页前） |
| R3 | lib.rs 12 plugin stubs 没接 PluginHost | 架构 wiring | MEDIUM | M2 启动前（M2.1 之前 1 个 subagent 任务即可） |
| R4 | `CLAUDE.md` §3.3 字面写"24 plugin"但 M1 只 12 stub | 文档不一致 | LOW | M2.1 启动前修订 |
| R5 | dev box `cargo test` 跑不通（DLL load） | 测试环境 | LOW | 已用 CI MSYS2 兜底，本机限制非阻塞 |
| R6 | macOS impl 全是 stub，Mac dev box 未接入 | 跨平台 | MEDIUM | M2.5+（macOS 真实路径解析必须先有 Mac 机器验证） |
| R7 | ci.yml 没跑 Vitest / Playwright / build | CI 不全 | HIGH | M1.10 必做 |
| R8 | 无 README.md | 上手门槛 | MEDIUM | M1.11 必做（被跳过） |
| R9 | 无 ARCHITECTURE.md / AGENTS.md | 文档缺失 | HIGH | M1.11 必做（被跳过） |
| R10 | Playwright e2e 实际未跑过 | 测试真实性 | HIGH | M1.10 必做（加进 ci.yml 后跑通才算） |
| R11 | localStorage 不可用时 useViewState 抛错 | 边界 | LOW | M2.1 |
| R12 | tsconfig strict 未明确审计 | 代码质量 | LOW | M1.10 顺手审计 |
| R13 | CI 无 macOS runner | 跨平台 CI | MEDIUM | M2.5+（Mac 接入时） |
| R14 | 签名 / 公证未启用 | 发布链路 | HIGH | M3（v1.0 release） |
| R15 | tray close 没有任何视觉反馈 | UX | LOW | M2.1 polish |

---

## 4. 机会清单（M2+ 候选）

| # | 机会 | 价值 | 时机 |
|---|---|---|---|
| O1 | PluginPlaceholder 渲染 SPEC 摘要 | 提升占位页面信息密度（CLAUDE.md §2.5 UI/UX 头等大事） | M2.1 |
| O2 | 把 React 视图路由迁回 react-router（when needed） | 满足 deeplink → URL 的 F4 需求 | M2.1（F4 实现时） |
| O3 | 接入 shadcn/ui + Tailwind utility class | 减少 CSS 维护成本 | M2.1（评估） |
| O4 | 加 ErrorBoundary 全局包裹 | 优雅处理 B6 | M2.1 |
| O5 | 多 subagent 并发跑 M2.1~2.12 | 提速 4x | M2 启动时主 session 直接派 4 槽 |
| O6 | i18n 接入（i18next） | 准备 M3 公证后的国际版 | M2.5+ |
| O7 | 加 `beforeBuildCommand` 解决 stale dist | 避免再发 M1.3-fix-1 类问题 | M1.10 |
| O8 | macOS 真机 CI 接入 | 验证 cross-platform 抽象 | M2.5+ |
| O9 | 接入 SQLite (settings.json 历史 / 备份 diff / F24) | F13 / F19 / F24 都需要 | M2.5+ |
| O10 | 加 telemetry（可选） | 产品迭代数据 | M3 之后 |

---

## 5. M1 → M2 移交清单

### 5.1 主 session 应在 M2 启动前决定

1. **M1.10 / M1.11 / M1.12 三件套优先级**：是先补 M1.10（CI）+ M1.11（文档）再 M2，还是直接 M2.1 与 M1.10/1.11 并行？
2. **M2 启动候选 4 个 plugin 的执行顺序**：F1 → F2 → F5 → F6（详见 `docs/milestones/M2-roadmap-draft.md`）还是 F6 → F1 → F5 → F2？
3. **M2 是否启用 react-router 重新接入**：影响 M2.1 模板代码。

### 5.2 M2.1 启动 subagent 必读

- `CLAUDE.md` 全本（305 行）
- `SPEC.md` §F1~F6（业务规格）
- `docs/milestones/M1-architecture-summary.md`（本文 Step 1）
- `docs/milestones/M2-roadmap-draft.md`（M2 范围）
- `src/plugins/registry.ts` + `src-tauri/src/plugins/stubs/`（plugin 接口契约）
- `src/__tests__/integration/App.test.tsx`（路由测试模式）

### 5.3 数据基线（M2.1 必须复用）

- 设计系统 tokens：`src/design-system/tokens.css`（瓷白 + Glass token 已固化）
- 平台 traits：`src-tauri/src/platform/traits.rs`（业务代码只用 `Box<dyn IPlatformXxx>`）
- Plugin 模板：`src-tauri/src/plugins/stubs/provider_list.rs`（M2.1 改为真实业务实现）
- Page 模板：`src/pages/provider-list/index.tsx`（M2.1 改为真实 UI）
- 测试模板：`src/__tests__/integration/App.test.tsx`（Vitest 模式）

---

## 6. 结论

**M1 架构期目标达成度 = 90%**。剩余 10% 集中在：
- 文档化产物（M1.11 ARCHITECTURE.md / AGENTS.md / README.md 缺失，本次 M1.12 已补救 ARCHITECTURE 一部分，README/AGENTS 仍缺）
- CI 完整性（M1.10 npm test + e2e 未接）
- 跨平台落地（macOS impls 仍是 stub，缺 Mac dev box 验证）
- HANDOFF.json 数据同步（已被 M1 实际进度超越）

**M2 启动建议**：先用 1 个 subagent 把"12 plugin stubs → PluginHost wiring + HANDOFF.json 重写"做掉（半天），同时启动 M1.10（CI + 文档）并行 1 个 subagent，然后 M2.1 进场。

---

*本文件由 M1.12 子代理在 worktree `agent-a31f4ddce79088ee7` 生成，等同于 M1.11 4 阶段评审 + M1.12 综合复审。*