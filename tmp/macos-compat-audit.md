# macOS 兼容性审查报告

> 审查日期：2026-06-21
> 审查范围：`D:\project\winui3`（Tauri v2 + React + TS + Rust）在 macOS 26 上的兼容性
> 审查方式：只读代码审查，未修改任何文件
> 依据：CLAUDE.md §3.1/§3.2（8 个 OS 抽象 trait + 分层架构）、§5（测试）、§9（构建交付）

---

## 总结

| 维度 | 结论 |
|---|---|
| 8 个 OS trait Mac 实现 | **真实现 1 个**（autostart）/ **stub(unimplemented!()) 7 个** |
| 其中在启动/命令热路径上会 panic 的 stub | **2 个**（paths=启动崩、reveal=命令崩） |
| 业务代码散落 OS 判断（违反 §3.2） | **3 处**（1 处会崩、2 处架构违规） |
| 前端 Mac 风险 | **4 处**（1 功能崩 + 3 UX） |
| tauri-plugin Mac 兼容 | 全部跨平台兼容，但 notification 缺权限请求 |
| 构建脚本 Mac 覆盖 | build-mac.sh 完整；build-and-ship.sh Windows-only（符合 §9） |
| CI Mac 覆盖 | **release.yml 有 macos matrix（会编译）；ci.yml 无 mac test/e2e**（mac 运行时崩溃不会被 CI 拦截） |

**最严重结论：应用当前无法在 macOS 上启动。** `AppState::build()`（lib.rs:108 → app_state.rs:56-57）在启动时调用 `MacPaths::resolve()`，而该方法是 `unimplemented!()`，会直接 panic，窗口永不出现。release.yml 的 macos matrix 会编译通过并产出 .dmg，但产出的应用一启动就崩。

---

## 逐 trait 审查（8 个）

### 1. IPlatformPaths — P0 启动崩溃

- **Mac 实现**：`src-tauri/src/platform/macos/paths.rs:12-18`
- **状态**：`unimplemented!()`（resolve + ensure_dirs 两个方法都是）
- **Mac 真机行为**：**启动即 panic**。调用链：`lib.rs:108 AppState::build()` → `app_state.rs:56 runtime::paths()` → `app_state.rs:57 paths_impl.resolve()` → `MacPaths::resolve()` = `unimplemented!()` → `thread 'main' panicked`，窗口不出现。即便 resolve 修好，紧接着 `app_state.rs:61 ensure_dirs()` 同样 `unimplemented!()` 会再 panic 一次。
- **修复方案**：照 `WindowsPaths`（windows/paths.rs:17-64）实现，差异仅在路径基：
  - `home` = `dirs::home_dir()`（跨平台，mac 返回 `~/`）
  - `app_data` = `dirs::config_dir().join("ClaudeConfigManager")`（mac = `~/Library/Application Support/ClaudeConfigManager`）
  - `settings_json` = `~/.claude/settings.json`、`claude_json` = `~/.claude.json`（与 Win 相同，Claude Code 在 mac 也用这俩路径）
  - `ensure_dirs` 逻辑完全复用（`std::fs::create_dir_all` 跨平台）
  - `dirs` crate 已是依赖（Cargo.toml:32），无需新增

### 2. IPlatformSingleInstance — 死代码（无崩溃）

- **Mac 实现**：`src-tauri/src/platform/macos/single_instance.rs:10-12`
- **状态**：`unimplemented!()`
- **Mac 真机行为**：**不会被调用**。lib.rs:32-48 直接用 `tauri_plugin_single_instance::init(...)`（跨平台，mac 用 unix 锁文件），绕过了 trait。`runtime::single_instance()` 全项目无调用方（仅 platform/mod.rs 定义 + traits.rs 测试）。
- **修复方案**：删除 `MacSingleInstance` stub（trait 已被 plugin 架空），或保留但标注 deprecated。架构上：single-instance 走 plugin、不走 trait，是合理决策，建议在 traits.rs 文档说明该 trait 当前未被生产路径使用。

### 3. IPlatformAutostart — 真实现，正常

- **Mac 实现**：`src-tauri/src/platform/macos/autostart.rs:29-49`
- **状态**：**真实现**，委托 `tauri_plugin_autostart`（`app.autolaunch()`）
- **Mac 真机行为**：正常。lib.rs:52-55 已用 `MacosLauncher::LaunchAgent` 注册 plugin，enable 时写 `~/Library/LaunchAgents/<bundle-id>.plist`，disable 时删。`--minimized` 参数已配。
- **修复方案**：无需修复。这是 8 个 trait 里唯一 Mac 真实现的。

### 4. IPlatformReveal — P1 命令崩溃

- **Mac 实现**：`src-tauri/src/platform/macos/reveal.rs:9-12`
- **状态**：`unimplemented!()`
- **Mac 真机行为**：**点击"在文件管理器中显示"即 panic**。调用链：`commands/resource.rs:62-65 reveal_in_file_manager` → `resource_service.reveal()` → `MacReveal::reveal()` = `unimplemented!()`。`MacReveal` 在启动时被构造（app_state.rs:88 `runtime::reveal()`）但不调用，所以启动不崩；只有用户触发 reveal 命令才崩。
- **修复方案**：照 `WindowsReveal`（windows/reveal.rs:16-44）实现，把 `explorer.exe /select,` 换成 `open -R`：
  ```rust
  Command::new("open").arg("-R").arg(path)  // mac
  ```
  存在性检查、错误映射逻辑完全复用。`std::process::Command` 跨平台。

### 5. IPlatformNotifier — 死代码（功能双平台缺失）

- **Mac 实现**：`src-tauri/src/platform/macos/notifier.rs:9-12`
- **状态**：`unimplemented!()`
- **Mac 真机行为**：**不会被调用**。`runtime::notifier()` 全项目无调用方。注意：`WindowsNotifier`（windows/notifier.rs:18-35）也只是 stub（`eprintln!` + `Ok(())`），并非真通知。lib.rs:28 虽然注册了 `tauri_plugin_notification`（跨平台，mac 走 `UNUserNotificationCenter`），但没有任何 command 调用 `app.notification().builder()...show()`。所以通知功能在 **Windows 和 mac 都未真正实现**。
- **修复方案**：Mac 实现应委托 `tauri_plugin_notification`（与 Win 一致），而不是自己调 `UNUserNotificationCenter`。但首要问题是：当前根本没有 command 触发通知，trait 是空的。需先决定通知用在哪些场景（F15 错误反馈？用量阈值？），再补 Win/Mac 两端实现。mac 额外要求：首次 `.show()` 前需 `request_permission()`（macOS 11+ 强制），否则通知静默不显示。

### 6. IPlatformAppMenu — 死代码（mac UX 缺失）

- **Mac 实现**：`src-tauri/src/platform/macos/app_menu.rs:15-18`
- **状态**：`unimplemented!()`
- **Mac 真机行为**：**不会被调用**。`runtime::app_menu()` 全项目无调用方。后果是 mac 上没有标准应用菜单（菜单栏没有 "Claude 配置管理器" 菜单项，没有 Cmd+Q 退出、Cmd+, 偏好设置、About 等）。用户只能靠托盘菜单或窗口关闭。不影响启动，但是 mac 应用规范要求的 UX。
- **修复方案**：用 `tauri::menu::Menu` API（lib.rs:146-148 已用它建托盘菜单）为 mac 建一个 app 菜单（About / Separator / Quit），`[NSApp setMainMenu:]` 由 Tauri 抽象。可走 trait 或直接在 lib.rs setup 里 `#[cfg(target_os = "macos")]` 建。优先级低（P2）。

### 7. IPlatformWindowChrome — 死代码 + lib.rs §3.2 违规

- **Mac 实现**：`src-tauri/src/platform/macos/window_chrome.rs:10-13`
- **状态**：`unimplemented!()`
- **Mac 真机行为**：**trait 不会被调用**，但 vibrancy 功能 **已通过另一条路径实现**：lib.rs:204-215 用 `#[cfg(target_os = "macos")]` 直接调 `window_vibrancy::apply_vibrancy(NSVisualEffectMaterial::Sidebar, ...)`。所以 mac 上 vibrancy 实际生效，trait 是被架空的死代码。
- **§3.2 违规**：lib.rs:198-215 有 `#[cfg(target_os = "windows")]` / `#[cfg(target_os = "macos")]` 两个块直接调 `window-vibrancy`，这违反 "业务代码不散落 OS 判断"（lib.rs 是 wiring 层，严格说也算业务侧）。正确做法是让 `MacWindowChrome::apply` 调 `apply_vibrancy`、`WindowsWindowChrome::apply` 调 `apply_mica`，lib.rs 只调 `runtime::window_chrome().apply(&opts)`。
- **修复方案**：把 lib.rs:198-215 的 cfg 块移进 trait 实现（Win→apply_mica，Mac→apply_vibrancy），lib.rs 统一调 `runtime::window_chrome().apply(...)`。功能已具备，只是架构归位。P2。

### 8. IGitHost — 死代码（F17 未实现，落地即崩）

- **Mac 实现**：`src-tauri/src/platform/macos/git.rs:13-24`
- **状态**：`unimplemented!()`（clone / ls_remote / current_head 三个方法都是）
- **Mac 真机行为**：**当前不会被调用**（F17 在线安装 / marketplace git clone 尚未实现，`runtime::git_host()` 无调用方）。但一旦 F17 落地调用此 trait，mac 上会 panic。
- **修复方案**：`WindowsGitHost` 实际是跨平台的 `GitHostCli`（windows/git.rs:1 "cross-platform implementation"，只是 wrap `git` CLI），mac 的 `git` CLI 行为完全一致。`MacGitHost` 应直接做成 `GitHostCli` 的类型别名或薄 wrapper（git.rs 注释已指出这点）。无需任何 mac 专属 API。**建议在 F17 开发前先做这个归一**，否则 F17 会重蹈 paths/reveal 的覆辙。

---

## 业务代码散落 OS 判断（违反 §3.2）

| 文件:行 | 代码 | 问题 | 修复 |
|---|---|---|---|
| `src/pages/backup-restore/index.tsx:221-223` | `process.platform === 'win32' ? ... USERPROFILE ... : ... HOME ...` | **P1 会崩**。`process` 在 Tauri webview 里未定义（Vite 不 polyfill `process.platform`，只替换 `process.env.NODE_ENV`）。`process.platform` 抛 `ReferenceError`，被 handleBackupNow 的 try/catch 吞成"备份失败: process is not defined"。**Windows/mac 双平台都有此问题**，只是 mac 必现。且这是业务 page 直接做 OS 判断，违反 §3.2。 | 删除前端 OS 判断，让后端 `backup_now` command 自己从 `AppPaths.settings_json` 取默认路径（app_state 已缓存）。前端只传 "default" 或空串。 |
| `src/design-system/applyEffects.ts:49-55` | `navigator.userAgent` 嗅探 mac/win → `setEffects([Effect.Sidebar/Mica])` | **P2 冗余**。该文件 docstring 自称 §3.1 允许 OS 分支留在这里（设计系统层），属边界豁免。但 lib.rs:204-215 已用 Rust `window-vibrancy::apply_vibrancy` 直接应用了 mac vibrancy，JS 这条 `setEffects(Sidebar)` 是重复调用。两路叠加目前不崩（幂等），但 lib.rs 注释明确说 setEffects 在 decorations:false 无边框窗口上不稳定（tao#72，针对 Win Mica）。mac 侧重复应用应去掉。 | mac 分支删除或保留作 fallback；建议统一到 Rust window-vibrancy 一条路，JS 只留 Windows Mica fallback。 |
| `src-tauri/src/lib.rs:198-215` | `#[cfg(target_os = "windows")] apply_mica` / `#[cfg(target_os = "macos")] apply_vibrancy` | **P2 架构违规**。lib.rs setup 里直接 cfg 分发 OS，绕过 `IPlatformWindowChrome` trait（见 trait #7）。功能正常。 | 移进 `WindowsWindowChrome::apply` / `MacWindowChrome::apply`，lib.rs 统一走 `runtime::window_chrome().apply(...)`。 |

---

## 前端 macOS 风险

| 组件 / 配置 | 风险 | 严重度 | 修复 |
|---|---|---|---|
| `tauri.conf.json:25-27` `decorations:false` + `titleBarStyle:Overlay` + `transparent:true` | mac 上 `decorations:false` 会移除 **全部** 原生装饰包括 traffic lights（红黄绿按钮）。`titleBarStyle:Overlay` 在 decorations:false 时被忽略。AppHeader.tsx:258-263 注释称"mac OS 仍画 traffic lights"是 **错误的** —— 实际 mac 上没有任何原生窗口按钮，只能靠自定义 WindowControls。 | 中 | 决策：要么 mac 用 `decorations:true + titleBarStyle:Overlay`（保留 traffic lights，去掉自定义按钮），要么维持 decorations:false（全自定义，但 mac 用户失去左侧 traffic lights 习惯）。当前全自定义方案能工作，但 mac UX 不地道。 |
| `tauri.conf.json` `decorations:false + transparent:true`（mac） | mac 窗口失去原生圆角和阴影，变成直角浮动矩形。 | 低 | mac 侧可加 `decorations:true` 或用 CSS `border-radius` + `box-shadow` 模拟（但 transparent 窗口阴影需 OS 支持）。 |
| `WindowControls.tsx` 自定义 min/max/close | mac 上唯一窗口控制（见上）。close 调 `getCurrentWindow().close()` 触发 lib.rs:172-177 的 `CloseRequested → prevent_close + hide()`（最小化到托盘）。功能正常，但 mac 用户按红按钮预期"关闭"，实际藏到托盘，行为反直觉。 | 低 | mac 侧 close 行为可改为真退出（或加偏好设置）。 |
| `src/pages/backup-restore/index.tsx:221` `process.platform` | 见上表，mac 必崩。 | 高 | 见上表。 |
| drag region（`data-tauri-drag-region` / `-webkit-app-region:drag`） | Tauri v2 在 mac WKWebView 支持 `data-tauri-drag-region`（tao 抽象），正常工作。 | 无 | 无需修复。 |

---

## tauri-plugin Mac 兼容

| plugin | Mac 兼容 | 备注 |
|---|---|---|
| tauri-plugin-single-instance (=2.4.2) | ✅ | mac 用 unix 锁文件。lib.rs:32 直接用 plugin，绕过 trait。 |
| tauri-plugin-autostart (=2.5.1) | ✅ | `MacosLauncher::LaunchAgent` 已配（lib.rs:53），写 `~/Library/LaunchAgents/`。 |
| tauri-plugin-deep-link (=2.4.9) | ✅（生产）/ ⚠️（dev） | 生产 bundle 由 tauri-action 自动写 Info.plist URL scheme。dev 模式 mac 需手动注册（`tauri plugin` 临时注册），否则 ccswitch:// 链接打不开。lib.rs:119-144 的 on_open_url + argv 兜底逻辑 mac 适用。 |
| tauri-plugin-notification (=2.3.3) | ⚠️ | plugin 本身跨平台（mac 走 UNUserNotificationCenter），但 **mac 需先 request_permission**，当前无任何代码请求权限 → 首次通知静默失败。且无 command 实际调用 notify（见 trait #5）。 |
| tauri-plugin-shell (=2.3.5) | ✅ | 跨平台。 |
| tauri-plugin-fs / dialog / os / store / log / updater / process | ✅ | 全部跨平台，无 mac 已知问题。 |
| window-vibrancy (=0.6.0) | ✅ | `apply_vibrancy` mac 原生支持。Cargo.toml:27 已开 `macos-private-api` feature，tauri.conf.json:13 `macOSPrivateApi:true`，vibrancy 前置条件齐备。 |

---

## 构建 / CI

### scripts/build-mac.sh — 完整
- 存在（scripts/build-mac.sh），用 `cargo tauri build`，支持 `--debug` / `--no-bundle`。
- 产 `.app` + `.dmg`，unsigned（注释说明 v1.1 在 CI 签名）。
- 不 cp 到桌面（符合 §9：桌面交付是 Windows M1.x 流程）。
- **但**：此脚本产出的 .app 一启动就因 MacPaths panic 崩溃（P0）。

### scripts/build-and-ship.sh — Windows-only（符合 §9）
- 硬编码 `/c/Users/.../Desktop`、`WebView2Loader.dll`、`claude-config-manager.exe`。预期行为，无需改。

### CI ci.yml — 无 mac 测试门禁（P1）
- 三个 job（test-rust / test-frontend / e2e）全部 `runs-on: windows-latest`。
- 第 92-93 行注释明确："macos-latest deferred to M1.10"。
- **后果**：MacPaths/reveal 的 `unimplemented!()` panic 不会被 CI 拦截。Mac 编译错误也不会被拦（除非 release.yml 跑）。

### CI release.yml — 有 mac matrix，但会产出崩溃包（P0 级隐患）
- 第 61-64 行：`macos-latest / aarch64-apple-darwin / --bundles app,dmg`。
- tauri-action 会编译 mac 并上传 .dmg 到 GitHub Release。
- **但编译通过 ≠ 运行正常**：产出的 .dmg 解压运行即 panic（MacPaths）。
- 签名/公证 secrets 全注释（第 110-115 行），v1.1 才启用。

### tauri.conf.json mac 配置缺口
- 无 `bundle.macOS` 段（`minimumSystemVersion` 默认 10.15，对 macOS 26 足够；但显式声明更好）。
- 无 entitlements 文件（dev 不需要，v1.1 notarization 需要）。
- `identifier: com.claudeconfigmanager.app` —— mac bundle id 合规。

---

## Mac 真机前必修清单（按严重度排序）

### P0（会崩，必须修）

1. **MacPaths::resolve + ensure_dirs 是 `unimplemented!()`，启动即 panic** — `src-tauri/src/platform/macos/paths.rs:12-18`。这是 mac 能启动的唯一硬阻塞。修复 = 照 `WindowsPaths` 实现路径基（`~/Library/Application Support/ClaudeConfigManager` + `~/.claude/...`），逻辑全复用。
2. **release.yml macos matrix 会发布启动即崩的 .dmg** — 一旦打 tag 触发 release，用户下载的 mac 包打不开。修 P0-1 即解除；建议同时在 ci.yml 加 mac test job 作门禁。

### P1（功能缺失/崩溃，应该修）

3. **MacReveal::reveal 是 `unimplemented!()`，"在文件管理器中显示"崩溃** — `src-tauri/src/platform/macos/reveal.rs:10`。F16 资源浏览的 reveal 功能在 mac 不可用。修复 = `open -R` 替换 `explorer /select,`。
4. **backup-restore 页 `process.platform` 在 webview 抛 ReferenceError** — `src/pages/backup-restore/index.tsx:221`。手动备份功能 mac 必崩（Windows 也脆弱）。修复 = 删前端 OS 判断，后端取默认路径。
5. **MacGitHost 三方法全 `unimplemented!()`，F17 落地即崩** — `src-tauri/src/platform/macos/git.rs:14-23`。当前 F17 未实现不崩，但必须在 F17 开发前修。修复 = 做成跨平台 `GitHostCli` 别名（git CLI mac/Win 一致）。
6. **ci.yml 无 mac 测试门禁** — mac 运行时崩溃（P0/P1）无 CI 拦截。修复 = 加 `runs-on: macos-latest` 的 test-rust job（至少 `cargo test --no-run` 验证 mac 编译 + 跑 platform traits 的 mock 测试）。

### P2（体验/架构问题，可延后）

7. **lib.rs:198-215 cfg(target_os) 块绕过 IPlatformWindowChrome trait**（§3.2 违规）— 功能正常，架构归位即可。
8. **MacAppMenu 是 stub，mac 无标准应用菜单**（无 Cmd+Q / About / 偏好设置）— `src-tauri/src/platform/macos/app_menu.rs:17`。
9. **MacNotifier 是 stub + 通知功能双平台未实现 + mac 缺 request_permission** — `src-tauri/src/platform/macos/notifier.rs:11`。需先定通知场景再补两端。
10. **decorations:false 导致 mac 无 traffic lights / 无圆角阴影** — UX 不地道，需产品决策。
11. **applyEffects.ts 与 Rust window-vibrancy 重复应用 mac vibrancy** — 幂等不崩，建议去重。
12. **MacSingleInstance / MacWindowChrome stub 是死代码** — trait 被 plugin/cfg 架空，建议清理或标注。

---

## 建议修复顺序

1. **P0-1 MacPaths**（解锁启动，~30 分钟，照 WindowsPaths 改路径基 + 复用 ensure_dirs）
2. **P1-4 backup-restore process.platform**（5 分钟，删前端判断 + 后端取默认路径，双平台受益）
3. **P1-3 MacReveal**（15 分钟，`open -R`）
4. **P1-5 MacGitHost**（10 分钟，做成 GitHostCli 别名，为 F17 扫雷）
5. **P1-6 ci.yml 加 mac test job**（30 分钟，至少编译 + mock 测试门禁，防回归）
6. **P0-2 release.yml**（P0-1 修后自动解除，可选：给 mac release job 加 `continue-on-error` 或先 disable 直到 mac 真机验证）
7. P2 项按 UX 优先级排（app menu > 通知 > window chrome 归位 > traffic lights 决策）

> 修复 P0-1 + P1-3/4/5 后，mac 可启动 + 核心功能（provider 切换 / MCP / 备份 / 用量 / 优化 / 资源浏览 reveal）可用。P2 不阻塞 v1.0 mac 可用性。
