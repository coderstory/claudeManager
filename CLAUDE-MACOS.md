# macOS 开发约束

> 本文件是 CLAUDE.md §15 的独立版本.  macOS 特有约束 / 编译 / 脚本 / 权限 / 沙箱.
> 其他章节见 [CLAUDE.md](../CLAUDE.md).

### 15.1 编译环境前置
- ✅ **必须装 Xcode Command Line Tools**（`xcode-select --install`，约 200 MB）
- ✅ **必须装 Rust toolchain apple-darwin**（`rustup target add aarch64-apple-darwin` + `x86_64-apple-darwin` 二选一，跟主机 CPU 走）
- ⚠️  Apple Silicon (M1/M2/M3) 默认 target = `aarch64-apple-darwin`；Intel Mac = `x86_64-apple-darwin`
- ❌ **不要从 Windows 跨编译 macOS**（缺 SDK + codesign 工具链，必失败）
- ⚠️  **本机是 Windows**，macOS 验证必须由用户在 Mac dev box 上跑

### 15.2 编译产物与路径
- 编译产物 = `target/release/bundle/macos/Claude Manager.app`（不是 `.exe`）
- 调试用裸二进制 = `target/release/claude-config-manager`（无后缀）
- 用户数据路径：
  - Windows: `%APPDATA%\ClaudeConfigManager\`
  - macOS: `~/Library/Application Support/ClaudeConfigManager\`
  - **`~/.claude/`** 是 Claude CLI 自己的目录，**跨平台都用这个路径**（不要改）

### 15.3 macOS 脚本能力 (M4 阶段补)
| 脚本 | Windows | macOS 替代 |
|---|---|---|
| `kill-app.sh` | powershell + taskkill | `osascript` + `pgrep -f` + `kill -9`（待改造）|
| `smoke-test.sh` | 10 项实跑 | 需 Rust IPC 加 `get_webview_children_count` + `get_window_state` 命令（详见 §15.4）|
| `build-and-ship.sh` | ✅ 全流程 | 部分（缺 smoke test 跨平台）|
| `build-only.sh --check` | ✅ | ✅ |
| `disk-usage-check.sh` | ✅ | ✅ |
| `npm run tauri dev` | ✅ | ✅（Vite + Tauri CLI 跨平台）|

**当前 mac subagent 可用命令**：`build-only.sh --check` + `disk-usage-check.sh` + `npm run tauri dev` + 直接 `cargo build` + `cargo test`。

### 15.4 Rust IPC 需补充的 macOS-only 命令
smoke test 在 macOS 上无法用 `EnumChildWindows` 枚举 WKWebView 子窗口，需 Rust 加 3 个 IPC：
- `get_webview_children_count() -> u32` — 返回主窗口下 webview 子窗口数
- `get_window_state() -> { handle: u64, responding: bool, title: String }`
- `get_app_metadata()` 已存在（display name 等），无需新增

### 15.5 长期治理场景的 Cargo.toml profile 调优（允许）
§12.4 写明"禁 cargo profile 调优"，但**target/ 长期治理**场景例外：
- 修改前必须列白名单给用户
- 只改 `[profile.dev]` / `[profile.release]` 的 `codegen-units` / `lto` / `strip` / `debug` 字段
- **不改** crate 版本 / 依赖 / 其他字段
- 改动记录在 commit message，说明为什么豁免 §12.4

**当前生效的豁免**（M3.0.3 cleanup）：`src-tauri/Cargo.toml` 已加 `[profile.dev]` + `[profile.release]`，预期 target/ 从 9.6GB 降到 ~4.5GB（-53%）。

### 15.6 macOS 权限与 entitlements
需创建 `src-tauri/<name>.entitlements` 含必要权限（app sandbox / 文件 / 网络 / Apple Events）；Tauri 自动生成的 `Info.plist` 已含 ccswitch URL scheme 注册（来自 `tauri.conf.json::plugins.deep-link.desktop.schemes`）。详见 `tmp/path-permission-audit.md`（待产出）。

**状态（2026-06-24）**：✅ dev 阶段 entitlements 已 ship 于 commit `2b621ab`。**不开** app-sandbox（仅 dev 调试用）。生产 release 不开 — 详见 §15.7。

### 15.7 🚫 本项目不做发布（2026-06-24 user 决定）

**全局约束**：本项目是 dev / 个人工具，**不**做公开发布 / 上 Apple App Store / 公开分发 .dmg。

**永久砍掉**（不再复活）：
- ❌ macOS 代码签名（`codesign --sign "Developer ID Application: ..."`）— 不需 Apple Developer 账号
- ❌ macOS 公证（`notarytool` / `xcrun altool`）— 不需 `APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID` secrets
- ❌ Hardened Runtime 配置 — 不需要
- ❌ `.dmg` 分发 / 桌面交付 cp 脚本（`scripts/cp-to-desktop-mac.sh`）— 无桌面交付需求
- ❌ macOS smoke test 改造（`get_webview_children_count` / `get_window_state` Rust IPC + `scripts/smoke-test-mac.sh`）— 不进 release CI 链路
- ❌ release.yml mac matrix `continue-on-error` 调优 — 不做 release 链路
- ❌ `docs/SIGNING.md` 维护 — 整文件相关

**dev 阶段**（仍做）：
- ✅ `./scripts/build-mac.sh --debug` — 本地 build + 手验
- ✅ mac 真机验证（`pgrep` + 日志 + GUI 打开）
- ✅ dev 阶段 entitlements（`src-tauri/ClaudeConfigManager.entitlements`）— 已 ship
- ✅ macOS 调试组件（`scripts/debug-mac.sh` + `docs/DEBUG-MAC.md`）— 已 ship
- ✅ `tauri.conf.json` 仍可产 unsigned `.app` + `.dmg`（仅 dev 用，不上传）

**影响**：
- §15.4 smoke test 改造：可仅做 dev 工具（不强制），不进 CI
- §15.6 entitlements：dev 阶段照常；不开 sandbox
- §9.6 build-and-ship.sh 仍是 Windows-only（M1.x 桌面交付流程）
- §9.7.3 "桌面交付" flow：仅 Windows 适用；mac dev 走 `scripts/build-mac.sh --debug` 自取

**详细 reasoning**：`docs/macos-p2-backlog.md` §「🚫 已砍清单」段。

## 15.9 sccache 共享编译缓存（dev 加速）

重复 build 时复用上一次编译的 crate `.rlib` 输出，避免 `wry` / `tao` / `tauri` 等 C/C++ 重链。**dev 工具，非硬依赖**——未装 sccache 也能 build（fallback 到普通 cargo 编译，build 不会失败）。

- ✅ **wrapper**：项目级 `src-tauri/.cargo/config.toml` 已加 `[build] rustc-wrapper = "sccache"`（覆盖全局 `~/.cargo/config.toml` 同名段；只影响本 crate，不污染其他项目）
- ✅ **缓存目录**：`$SCCACHE_DIR = ~/Library/Caches/sccache-claude-config-manager`（`scripts/build-mac.sh` 顶部 export，项目专属，不与其他项目共享）
- ✅ **容量上限**：`SCCACHE_CACHE_SIZE=5G`（sccache 默认 10G 容易把磁盘撑爆，主动限）
- ⚠️ **范围**：`scripts/build-mac.sh` 顶部 self-check 检测 sccache 是否安装；装了则 echo INFO 行 + 设环境变量；未装则 echo WARN 行 + 跳过（不阻断 build，跟 `scripts/clean-cache.sh` 容忍 `cargo-sweep` 缺失的哲学一致）

**验证方法**：
```bash
cd src-tauri
cargo check                # 第一次：Cache writes > 0（冷启）
cargo check                # 第二次：Cache hits  > 0（暖启，证明 wrapper 真生效）
sccache --show-stats        # 看 Cache hits rate (Rust) 是否 100%
```
注意：仅看 `Compile requests executed = 0` 不够——若 cargo incremental 命中 `target/`，sccache 可能不介入。**用 `cargo clean` 后再 build** 才能完整触发 sccache 写入。

**回滚**：删 `src-tauri/.cargo/config.toml` 即停用 sccache wrapper（全局 `~/.cargo/config.toml` 不动；本机其他项目不受影响）。
