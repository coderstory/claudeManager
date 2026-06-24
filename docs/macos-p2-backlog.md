# macOS 兼容性 — 不做清单 (P2 + Spec B 延后项)

> **🚫 全局约束 (2026-06-24 user 决定)：本项目不做发布，不需要签名 / 公证 / .dmg 分发 / Apple Developer ID / notarization。所有依赖 Apple Developer 账号或 release 链路的需求项（CI-1 / CI-2 / Spec B-1 / Spec B-3）永久砍掉。**
>
> 来源：本 session brainstorming (2026-06-24) 的 Spec A: macOS 兼容性修复 (P0+P1) §5.3。
> 用途：下次开发 macOS 兼容性 / 调试工作流时，按本清单往下推。
> 不在本 spec 范围：P0-1 (MacPaths) + P1-3/4/5/6 (MacReveal / backup-restore / MacGitHost / ci.yml mac job)。
> 上下文来源：`tmp/macos-compat-audit.md` (2026-06-21) + `tmp/macos-compat-audit.md` §P0/P1/P2 完整清单。

---

## P2 — 体验/架构 (按优先级排序)

### P2-1 MacAppMenu 实现
- **现状**：`src-tauri/src/platform/macos/app_menu.rs:15-18` 是 `unimplemented!()`
- **业务影响**：mac 无标准应用菜单（无 Cmd+Q / About / 偏好设置）
- **修复方案**：用 `tauri::menu::Menu` API（lib.rs:146-148 已用）为 mac 建 app 菜单
- **优先级**：P2-高（mac 应用规范要求）
- **估时**：1-2h
- **参考**：lib.rs tray menu 实现作模板

### P2-2 MacNotifier 实现 + 通知功能两端
- **现状**：`platform/macos/notifier.rs:9-12` 是 `unimplemented!()` + lib.rs:28 注册 `tauri_plugin_notification` 但**无 command 调用**
- **业务影响**：双平台通知功能都未真正实现（WindowsNotifier 也只是 stub `eprintln!`）
- **前置决策**：先定通知场景（F15 错误反馈 / 用量阈值？）
- **修复方案**：
  - Win/Mac 两端 trait 实现都委托 `tauri_plugin_notification`
  - Mac 额外：`request_permission()` 必须在首次 `.show()` 前调
- **优先级**：P2-中（需产品决策场景）
- **估时**：2-3h（含场景决策）
- **CLAUDE.md §15.6 关联**：entitlements 文件需补通知权限

### P2-3 `lib.rs:198-215` cfg 块移进 IPlatformWindowChrome
- **现状**：`src-tauri/src/lib.rs` 直接用 `#[cfg(target_os = "windows")]` / `#[cfg(target_os = "macos")]` 调 `apply_mica` / `apply_vibrancy`
- **架构违规**：违反 CLAUDE.md §3.2 "业务代码不散落 OS 判断"
- **功能影响**：无（功能正常，仅架构）
- **修复方案**：把 cfg 块移进 `WindowsWindowChrome::apply` / `MacWindowChrome::apply`，lib.rs 统一调 `runtime::window_chrome().apply(...)`
- **优先级**：P2-中（架构治理）
- **估时**：1h
- **关联**：MacWindowChrome 当前是 `unimplemented!()`，需先做 P2-1-style trait 归位

### P2-4 `decorations:false` 决策（mac traffic lights UX）
- **现状**：`tauri.conf.json:25-27` `decorations:false + titleBarStyle:Overlay + transparent:true`
- **mac 实际行为**：`decorations:false` 移除全部原生装饰包括 traffic lights（红黄绿按钮），AppHeader.tsx:258-263 注释"mac OS 仍画 traffic lights"**错误**
- **业务影响**：mac UX 不地道（无 traffic lights / 无圆角阴影）
- **决策点（需产品拍板）**：
  - 选项 A：`decorations:true + titleBarStyle:Overlay`（保留 traffic lights，去掉自定义按钮）
  - 选项 B：维持 `decorations:false`（全自定义，但 mac 用户失去左侧 traffic lights 习惯）
  - 选项 C：CSS 模拟圆角阴影（`border-radius` + `box-shadow`）
- **优先级**：P2-中（产品决策）
- **估时**：2-4h（含决策 + UI 调整 + WindowControls 改造）

### P2-5 `applyEffects.ts` mac 分支去重
- **现状**：`src/design-system/applyEffects.ts:49-55` `navigator.userAgent` 嗅探 → `setEffects([Effect.Sidebar/Mica])`
- **问题**：与 lib.rs Rust `window-vibrancy::apply_vibrancy` 重复应用 mac vibrancy
- **当前影响**：幂等不崩（重复调用 OK）
- **修复方案**：mac 分支删除，JS 只留 Windows Mica fallback（注释 docstring 改成"mac 由 Rust window-vibrancy 处理"）
- **优先级**：P2-低（清理）
- **估时**：15min

### P2-6 死代码 trait 清理
- **现状**：
  - `MacSingleInstance` stub（`platform/macos/single_instance.rs:10-12`）— trait 被 `tauri_plugin_single_instance` 架空
  - `MacWindowChrome` stub（`platform/macos/window_chrome.rs:10-13`）— vibrancy 通过 lib.rs cfg 块实现
  - `MacNotifier` stub（同 P2-2）
  - `MacAppMenu` stub（同 P2-1）
- **决策**：
  - 选项 A：删除 stub（trait 删除，plugin 直接用）
  - 选项 B：保留 stub + 标注 `#[allow(dead_code)]` + 文档说明延后
  - 选项 C：保留 stub + 加 `unimplemented!()` 编译期 fail（强制实现时再删）
- **优先级**：P2-低（清理）
- **估时**：30min

---

## 工具链 / CI / Smoke Test 缺口

### CI-1 release.yml mac matrix 处理
- **现状**：`.github/workflows/release.yml:61-64` 有 macos-latest / aarch64-apple-darwin / --bundles app,dmg
- **P0-1 修后状态**：mac matrix 能产出**能启动**的 .dmg（不再 panic）
- **未做**：
  - ~~mac 签名 / 公证 secrets（CLAUDE.md `docs/SIGNING.md`，v1.1 启用）~~ — **已砍**（本项目不做发布）
  - mac matrix 加 `continue-on-error` 或 disable 直到真机验证通过
  - ~~mac release artifact 自动化测试（无 mac smoke test）~~ — **已砍**（不做 release 链路）
- **优先级**：CI-中（仅 continue-on-error 仍可能需要）
- **估时**：1h

### CI-2 macOS smoke test 改造 (CLAUDE.md §15.4)
- **现状**：`scripts/smoke-test.sh` 仅 Windows 10/10 项。macOS 缺：
  - `get_webview_children_count` IPC（WKWebView 子窗口枚举无 CLI 等价）
  - `get_window_state` IPC（mac window 状态查询）
  - `get_app_metadata` 已有
- **需补 Rust IPC**：
  ```rust
  #[tauri::command]
  pub fn get_webview_children_count(window: tauri::Window) -> u32 { ... }

  #[tauri::command]
  pub fn get_window_state(window: tauri::Window) -> WindowState { ... }
  ```
- **新脚本**：`scripts/smoke-test-mac.sh`（`pgrep` + `osascript` 查 NSWindow + IPC 调上面两个）
- **优先级**：CI-中（仅供本地 dev 用，**不**进 release CI 链路）
- **估时**：4-6h
- **🚫 不做 release 链路**（user 2026-06-24 决定）—— 本项可仅做本地 dev smoke，不上传 CI

### CI-3 ci.yml mac e2e
- **现状**：`.github/workflows/ci.yml` 3 个 job（test-rust / test-frontend / e2e）全 `runs-on: windows-latest`
- **P1-6 修后状态**：加 `test-rust-mac` job（cargo check + cargo test platform::macos）
- **未做**：mac frontend e2e（Playwright 需 tauri-driver，mac 上无现成 runner）
- **优先级**：CI-低
- **估时**：1d（tauri-driver 在 mac runner 配通）

---

## Spec B — macOS 安装包 / 调试工作流（完整新 spec）

> **🚫 Spec B-1 / Spec B-3 已砍**（user 2026-06-24 决定：本项目不做发布）。Spec B-2 (调试) / Spec B-4 (entitlements) 仍可选——其中 Spec B-4 已 ship 于 commit `2b621ab`（仅 dev 阶段 entitlements，无 sandbox）。

### ~~Spec B-1 macOS 安装包签名 + 公证~~ — **已砍**
- **砍原因**：本项目不做发布，不需要签名 / 公证 / .dmg 分发
- **影响**：
  - `docs/SIGNING.md` 整文件可删（**待 R1 决**——CLAUDE.md §15.6 / R1 需同步更新）
  - `tauri.conf.json` 仍可产 unsigned .app + .dmg（dev 阶段用）
  - 不需 Apple Developer ID / `APPLE_*` secrets
- **移除依赖**：CI-2 / Spec B-1 整体 / Spec B-3 桌面交付（依赖 Spec B-1 签名）

### Spec B-2 macOS 调试组件
- **现状**：
  - 无 macOS 专用调试指南
  - `console.log` / `console.error` 在 Tauri webview 默认输出到 stdout（mac 上 terminal 能看）
  - Rust 日志走 `tauri-plugin-log`（CLAUDE.md §M1.7 已用），但缺 mac 路径
  - lldb / Instruments / Console.app 集成缺失
- **未做**：
  - `scripts/debug-mac.sh`（lldb attach + log tail + Console.app stream）
  - docs 章节：`docs/DEBUG-MAC.md`（lldb 符号 / Instruments trace / WKWebView inspect）
  - 前端 `window.__TAURI_INTERNALS__` 调试 hook 文档
- **优先级**：Spec B-中（M4 阶段补）
- **估时**：4-8h
- **状态**：✅ 部分 ship — `scripts/debug-mac.sh` + `docs/DEBUG-MAC.md` 已 commit 于 `2b621ab`（仅 dev 调试用，不涉及发布）

### ~~Spec B-3 macOS 桌面交付流程~~ — **已砍**
- **砍原因**：本项目不做发布，不需要 cp .app 到桌面给用户核定
- **影响**：
  - 无 mac 桌面 cp 脚本
  - `scripts/build-and-ship.sh` 仍是 Windows-only（CLAUDE.md §9.6 "⚠️ 部分" — 此状态保留，因不需要补）

### Spec B-4 macOS 权限 / entitlements
- **现状**：`tauri.conf.json` 引用 `ClaudeConfigManager.entitlements` 但**文件未创建**（dev 不需要，v1.1 notarization 需要）
- **需补 entitlements**：
  - `com.apple.security.app-sandbox`（Mac App Store 必需；非 Store 分发可选）
  - `com.apple.security.files.user-selected.read-write`（文件选择）
  - `com.apple.security.network.client`（出站 HTTP）
  - `com.apple.security.files.downloads.read-write`（备份下载目录）
  - Apple Events 权限（`com.apple.security.temporary-exception.apple-events`）— 留给 deep-link
- **优先级**：Spec B-高（v1.1 notarization 必需）
- **估时**：2-3h
- **参考**：`tmp/path-permission-audit.md`（待产出）

---

## Spec C — 已完成项归档

### C-1 v3.0 merge conflict 收尾
- **现状**：STATE.md 标"❌ 阻塞"，4 文件带 `<<<<<<< Updated upstream`：
  - `src/__tests__/pages/home.test.tsx`
  - `src/__tests__/pages/json-editor.test.tsx`
  - `src/pages/json-editor/index.tsx`
  - `src/pages/backup-restore/index.tsx`
- **本 spec 关联**：subagent 在 Wave 1 前**最小动作解阻塞**（仅 cargo check 报错文件）
- **未做**：业务逻辑收尾（json-editor 改动 / home 改动）— M4.6 WIP 主人决定哪侧
- **优先级**：Spec C-高（主线 ship 阻塞）
- **估时**：30min 解冲突 + 2-4h 业务收尾（看 M4.6 WIP 复杂度）
- **不在本 spec**：业务逻辑改动需 M4.6 WIP 主人授权

### C-2 target/ 长期治理
- **现状**：CLAUDE.md §15.5 已豁免 `Cargo.toml` profile 调优（M3.0.3 cleanup）；预期 9.6GB → 4.5GB
- **未做**：实际验证是否达到 4.5GB
- **优先级**：Spec C-低
- **估时**：1h

---

## 跨 spec 引用

- 详细 mac 风险分析：`tmp/macos-compat-audit.md`（2026-06-21，只读审计）
- macOS dev 约束：CLAUDE.md §15
- 编译性能基线：CLAUDE.md §12（sccache 50x 加速，macOS 调研已做）
- 脚本能力矩阵：CLAUDE.md §15.3（mac subagent 当前限制）

---

## 本清单维护规则

- 每完成一项 → 从本表移到「已完成」段
- 新增 macOS 兼容性 / 安装 / 调试工作 → 加进对应 P2 / 工具链 / Spec B 段
- 优先级 / 估时每次迭代复审（产品决策可能改变优先级）

---

## 🚫 已砍清单 (per user 2026-06-24 决定)

**全局原则**：本项目不做发布。所有依赖 Apple Developer 账号 / release 链路 / .dmg 分发 / Apple notarization 的需求永久砍掉，不再复活。

### 已砍项
| 原 ID | 项 | 砍原因 | 替代方案 |
|---|---|---|---|
| ~~R15~~ | macOS 签名 (`codesign --sign "Developer ID Application: ..."`) | 本项目不做发布 | N/A |
| ~~R16~~ | macOS 公证 (`notarytool` + `xcrun altool`) | 本项目不做发布 | N/A |
| ~~R17~~ | macOS smoke test 改造 (CI-2 + Rust IPC) | 不进 release CI，仅 dev 可选 | 本地手动 `pgrep` + 日志验（已够用）|
| ~~R18~~ | `scripts/build-and-ship.sh` macOS 改造 + 桌面交付 cp 脚本 (Spec B-3) | 不做 release，无桌面交付需求 | dev 阶段用 `scripts/build-mac.sh` 自取 .app |
| ~~CI-1~~ | release.yml mac matrix `continue-on-error` | 不做 release | N/A（matrix 仍跑但产 .dmg 不上传 release）|
| ~~Spec B-1~~ | macOS 安装包签名 + 公证 | 不做发布 | N/A |
| ~~Spec B-3~~ | macOS 桌面交付流程 | 不做发布 | N/A |

### 仍可做（dev only，不进 release 链路）
- Spec B-2 调试组件 — **已 ship** 部分（`2b621ab`）
- Spec B-4 entitlements（dev 阶段）— **已 ship**（`2b621ab`）
- CI-2 macOS smoke test 改造 — **可仅做本地 dev**（不进 CI）

### 需同步更新的文档
- `docs/SIGNING.md` — 整文件是签名相关，**待 R1 决**（CLAUDE.md §15.6 / R1 需同步）
- CLAUDE.md §15.6 — "签名 + 公证时再开" 表述需改（写"本项目不做发布"）
- `docs/design/M3.7-about-page.md` — identifier 表 + spec 1 旧 spec 文档需校

### 影响到的 session 后续行为
- ❌ 不再生成 `~/Desktop/ClaudeConfigManager-M*/` 目录
- ❌ 不再申请 Apple Developer 账号 / 配 `APPLE_*` secrets
- ❌ 不再优化 .dmg 体积 / 跑 `xcrun altool --validate`
- ❌ 不再修 release.yml 签名相关 workflow step
- ✅ dev 阶段一切照常：`scripts/build-mac.sh --debug` + 本地手验

