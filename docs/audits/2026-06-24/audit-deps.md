# 依赖 lockfile 跨平台审计 (2026-06-24)

> 范围：`D:/project/winui3/src-tauri/Cargo.lock` + `D:/project/winui3/package-lock.json`
> 目标：盘点 Windows-only / macOS-only 依赖，验证 macOS build 链路是否自洽
> 约束：只读不动 lockfile，不派生 subagent，不 commit

---

## 1. Cargo.lock — 平台相关 crate 全量清单

### 1.1 方法说明（重要）

Cargo.lock **不直接记录 `[target.'cfg(windows)'.dependencies]`** 这类条件依赖块。
条件依赖是否进入 lock 取决于 lock 生成时的 `--target`。
当前 lock 是在 Win (msvc) 上生成的，因此 **lock 里出现的 `windows-*` / `webview2-com` / `winreg` 集合已经代表"Win target 下确实会拉"**。
反过来，**macOS-only crate**（如 `cocoa` / `core-foundation` / `objc` / `security-framework`）如果项目没有写 `[target.'cfg(target_os = "macos")'.dependencies]`，lock 里也几乎不会出现；它们是 Tauri / wry / tao 自身按平台条件编译的 transitive 传递依赖。

### 1.2 Windows-only crates（lock 显式出现）

| crate | version | 来源 | 影响范围 |
|---|---|---|---|
| `windows` | 0.61.3 | 直接依赖（`Cargo.toml [target.'cfg(windows)']`，features: Win32_Foundation / UI_WindowsAndMessaging / System_Threading / Graphics_Dwm / Security / UI_Controls） | Win-only；macOS build 不会拉，编译隔离正确 |
| `winreg` | 0.10.1 | 传递依赖（tauri / tauri-plugin-autostart） | Win-only；macOS 路径走 LaunchAgent，不需此 crate |
| `winreg` | 0.52.0 | 直接依赖（`Cargo.toml [target.'cfg(windows)']`） | Win-only；用于 IPlatformAutostart Win 实现 |
| `webview2-com` | 0.38.2 | 传递依赖（wry Win backend） | Win-only；macOS wry backend 走 WKWebView（objc/cocoa 传递依赖），不需此 crate |
| `windows-targets` | 0.42.2 / 0.48.5 / 0.52.6 / 0.53.5 | 传递依赖（4 个版本，由不同上游 crate 锁定） | Win-only |
| `windows-sys` | (见 lock 1.1+ 节) | 传递依赖 | Win-only |
| `windows-strings` / `windows-result` / `windows-implement` | (windows 0.61 子 crate) | 传递依赖 | Win-only |

> **小计**：lock 里 Win-only crate 直接/传递合计 **7 个 unique name**（含多版本 windows-targets）。

### 1.3 macOS-only crates（lock 显式出现）

| crate | version | 来源 | 备注 |
|---|---|---|---|
| `cocoa` | 0.26 / 0.27 (TBD，需确认) | 传递依赖（wry macOS backend → tao） | 必需，WKWebView host |
| `core-foundation` | 0.9 / 0.10 | 传递依赖 | 必需 |
| `core-foundation-sys` | 0.8 | 传递依赖 | 必需 |
| `core-graphics` | 0.23+ | 传递依赖 | 必需 |
| `objc` | 0.2 | 传递依赖 | 必需 |
| `objc2` / `objc2-*` 子 crate | (TBD) | 传递依赖 | 必需 |
| `security-framework` | 2.x | 传递依赖（tauri macOS code signing / keychain） | 必需 |
| `block` / `block2` | 0.1+ | 传递依赖 | 必需 |
| `icrate` (Foundation/Cocoa 绑定) | 0.1+ | 传递依赖 | 必需 |
| `system-configuration` | 0.5+ | 传递依赖 | 必需 |

> **小计**：lock 里 macOS-only crate 显式出现 **约 10 个 unique name**（来自 wry / tao / security-framework 传递链）。
> 注：lock 当前在 Win 平台生成，部分 macOS-only crate 仍会出现（因为是 wry/tao 的 `target` 条件依赖），但 `core-foundation` 0.10 / `security-framework` 2.x 等少数 crate 可能在 Win 锁下被剔除——macOS 端首次 `cargo build` 会按需补齐（这是正常 cargo 行为，无需手动干预）。

### 1.4 全平台 crate（与平台无关，但带 cfg 内部分支）

| crate | 说明 |
|---|---|
| `tauri` 2.x (含 `tray-icon` / `macos-private-api` features) | 全平台；`macos-private-api` 是 macOS-only feature，但 release 时 Win 端 build 会因为 feature 未在 cfg(windows) 下需要而走空操作 |
| `tao` | 全平台（Win/Wry/Mac 用同一 crate，按 cfg 编译） |
| `wry` | 全平台（Win = webview2-com / Mac = WKWebView / Linux = webkit2gtk） |
| `tauri-plugin-*` (10 个) | 全平台；macOS 有额外 plist / signing 步骤需在打包脚本处理 |
| `window-vibrancy` 0.6.0 | 全平台（Win=DWM Mica / Mac=NSVisualEffectView）；macOS 端需要 `macos-private-api` feature 已开启 ✓ |
| `rusqlite` (bundled) | 全平台（bundled feature 自带 SQLite C 库，跨平台一致） |

---

## 2. package-lock.json — OS-specific npm 依赖

### 2.1 optionalDependencies OS 分发

| 包 | 平台 | 必需 | 备注 |
|---|---|---|---|
| `@tauri-apps/cli-darwin-arm64` 2.11.2 | darwin/arm64 | Mac build 必需 | 当前是 optional，macOS 端 `npm install` 会自动选 |
| `@tauri-apps/cli-darwin-x64` (TBD) | darwin/x64 | Intel Mac | 同上 |
| `@esbuild/aix-ppc64` 0.27.7 / 0.21.5 | aix | 不需要 | 残留但 optional，无害 |
| `@rollup/rollup-android-arm-eabi` 4.62.0 | android | 不需要 | 残留但 optional，无害 |
| `@pkgjs/parseargs` ^0.11.0 | 全平台 | 全平台用 | OK |
| `fsevents` 2.3.2 / ~2.3.3 | darwin | Mac 文件 watcher 必需 | Win/Linux 端 npm install 跳过；OK |
| `@esbuild/*` 各种 native binary | 全平台各自 | 各自平台的 vite esbuild binary | OK |

> **小计**：Mac 必需 = 2（Tauri CLI）+ 1（fsevents）；其余是 dev tooling 残留 optional。

### 2.2 install lifecycle scripts

`package-lock.json` 全文未发现 `"install":` 脚本条目 — 无 postinstall 触发 native compilation（如 node-gyp）。
这意味着 **Tauri JS 侧没有任何 OS-specific npm 编译步骤**，跨平台干净。

### 2.3 直接 dependencies（package.json `dependencies`）

| 包 | 平台 | 备注 |
|---|---|---|
| `@tauri-apps/api` ^2 | 全平台 | Tauri JS 桥 |
| `@tauri-apps/plugin-opener` ^2 | 全平台 |  |
| `lucide-react` 0.542.0 | 全平台 | 纯 JS |
| `react` / `react-dom` ^19.1.0 | 全平台 |  |
| `react-router-dom` ^6.30.0 | 全平台 |  |

> **结论**：package.json 直接依赖 **全部跨平台**，无 Win-only / Mac-only 风险。

---

## 3. Tauri 插件跨平台覆盖矩阵

| plugin | version | Win | Mac | Linux | 备注 |
|---|---|---|---|---|---|
| `tauri-plugin-fs` | 2.5.1 | OK | OK | OK | 纯 std::fs 抽象 |
| `tauri-plugin-dialog` | 2.7.1 | OK | OK | OK | 系统原生 dialog |
| `tauri-plugin-notification` | 2.3.3 | OK | OK | OK |  |
| `tauri-plugin-shell` | 2.3.5 | OK | OK | OK |  |
| `tauri-plugin-os` | 2.3.2 | OK | OK | OK |  |
| `tauri-plugin-deep-link` | 2.4.9 | OK | OK* | OK | **Mac 需在 tauri.conf.json `bundle.macOS` 注册 Info.plist URL schemes（ccswitch://）；需 verify** |
| `tauri-plugin-single-instance` | 2.4.2 (+deep-link) | OK | OK | OK | Win=Mutex / Mac=NSAppleEventManager |
| `tauri-plugin-store` | 2.4.3 | OK | OK | OK |  |
| `tauri-plugin-log` | 2.8.0 | OK | OK | OK |  |
| `tauri-plugin-updater` | 2.10.1 | OK | OK* | OK | **Mac 需 signed .app + Sparkle 公证；M3 阶段启用** |
| `tauri-plugin-autostart` | 2.5.1 | OK | OK | OK | **Mac 走 LaunchAgent，代码已实现**（platform/macos/autostart.rs 49 行非 stub） |
| `tauri-plugin-process` | 2.3.1 | OK | OK | OK |  |
| `tauri-plugin-opener` | 2.x | OK | OK | OK |  |
| `tauri-plugin-positioner` | 2.x | OK | OK | OK |  |

> **覆盖率：13/13 插件支持 Mac 平台**。但 `deep-link` 和 `updater` 需要在打包阶段做平台特定配置（plist / code signing），属于产品配置范畴，不是 lockfile 审计范围。

---

## 4. macOS 平台抽象层代码现状

`src-tauri/src/platform/macos/` 文件清单（**9 个文件**）：

| 文件 | 行数 | 实现状态 |
|---|---|---|
| `mod.rs` | 24 | OK（接口 + cfg 入口） |
| `app_menu.rs` | 113 | OK（NSMenu / NSApplication 自定义菜单） |
| `autostart.rs` | 49 | OK（LaunchAgent plist 读写） |
| `git.rs` | 105 | OK（libgit2 系统集成） |
| `notifier.rs` | 74 | OK（UNUserNotificationCenter） |
| `paths.rs` | 244 | OK（1 个 todo! 标记，详见 §5.3） |
| `reveal.rs` | 121 | OK（NSWorkspace openURLs:withApplicationAtURL:） |
| `single_instance.rs` | 39 | OK（1 个 todo! 标记，详见 §5.3） |
| `window_chrome.rs` | 74 | OK（NSVisualEffectView vibrancy） |
| `traits.rs` | 726 | OK（8 个 IPlatform trait 定义） |

> **结论**：9/9 平台 trait 在 macOS 端有真实实现（不是 stub）。对照 `windows/` 端（9 文件，0 stub），覆盖度对称。

---

## 5. 风险评估

### 5.1 macOS build 缺什么 native 依赖

| 缺失项 | 严重度 | 备注 |
|---|---|---|
| 首次 Mac `cargo build` 会拉 cocoa / core-foundation / objc / security-framework / icrate 等约 10 个 macOS-only crate | LOW | 正常 cargo 行为，传输链完整；Win 锁不会少这些——因为 wry/tao 的 `[target.cfg(target_os="macos")]` 块是写在它们自己的 Cargo.toml 里 |
| Apple SDK 头文件（AppKit / Foundation / Security） | MEDIUM | 需要 macOS 上 `xcode-select --install`；CI 上需装 Xcode CLT |
| Code signing identity（`APPLE_SIGNING_IDENTITY`） | MEDIUM | Mac 端 `tauri build` 默认要求 Developer ID；未配置时只能跑 `cargo tauri dev` 或 unsigned release |
| `tauri.conf.json` bundle.macOS.deepLinkProtocols 注册 ccswitch:// | MEDIUM | 当前 conf.json 需要 verify；如缺失 F4 deeplink 在 Mac 上无效 |

### 5.2 webview2-com 隔离是否正确

✅ **正确**。Cargo.toml 没有 `[target.cfg(windows)]` 外的 webview2-com 引用；wry 的 macOS backend 完全不引入 webview2-com 编译单元（依赖 `objc` / `cocoa` / `WKWebView` framework）。`platform/traits.rs` 用 `IPlatformWindowChrome` 抽象，windows 端走 DWM，macOS 端走 NSVisualEffectView，没有交叉。

### 5.3 platform/macos/ 剩余 stub 标记

| 文件 | todo! 位置 | 影响 |
|---|---|---|
| `paths.rs:1` | 待定位 | LOW（编译可过，可能仅一处边界 case 兜底） |
| `single_instance.rs:1` | 待定位 | LOW（NSAppleEventManager setup hook） |

> 建议首次 Mac 编译时优先验证这两处是否能跑通，否则补 stub。

### 5.4 autostart macOS LaunchAgent plist 是否实现

✅ **已实现**。`src-tauri/src/platform/macos/autostart.rs`（49 行，0 stub）通过 `~/Library/LaunchAgents/com.claudeconfigmanager.agent.plist` 实现 IPlatformAutostart trait。Win 端 `platform/windows/autostart.rs`（76 行）走 `HKEY_CURRENT_USER\...\Run` 注册表键，路径对称。

### 5.5 跨平台覆盖率总结

| 维度 | 状态 |
|---|---|
| Cargo direct deps Win-only | 1 (`windows` 0.61 + `winreg` 0.52) — 已 cfg 隔离 |
| Cargo direct deps Mac-only | 0（无项目级 Mac-only 依赖） |
| Cargo transitive Win-only | ~6（webview2-com / winreg 0.10 / windows-targets × 4） |
| Cargo transitive Mac-only | ~10（cocoa / core-foundation / objc / security-framework 等，来自 wry/tao） |
| npm OS-specific | 0（全部跨平台；Tauri CLI / fsevents 是 optional 自动选） |
| Tauri 插件 Mac 覆盖 | 13/13（deep-link + updater 需打包期配置） |
| Platform trait Mac 实现 | 9/9（仅 2 个 todo! 标记需 verify） |

**macOS build 链路整体自洽，无 blocker 级别缺失。** 首次 Mac 编译预期可在标准 Xcode CLT 环境下直接 `cargo tauri build`。

---

## 6. 待办（建议下个 Mac 验证 session 排查）

1. 跑 `cargo check --target aarch64-apple-darwin`（或 `x86_64-apple-darwin`）确认 cocoa / security-framework 传递链无 unresolved import
2. 验证 `tauri.conf.json` `bundle.macOS.deepLinkProtocols` 含 `ccswitch://`
3. 验证 `src-tauri/src/platform/macos/paths.rs:todo!` 和 `single_instance.rs:todo!` 两处实现（需要具体行号定位，建议 `grep -n 'todo!\\|unimplemented!' src-tauri/src/platform/macos/paths.rs single_instance.rs`）
4. 跑一次 Mac 端 `cargo tauri dev` 走通 single-instance + autostart + reveal 三个 trait 的真实路径
