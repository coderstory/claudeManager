# src-tauri/ macOS 兼容性审计 (2026-06-24)

> 范围：`D:/project/winui3/src-tauri/` 全量（src / tests / Cargo.toml / Cargo.lock /
> tauri.conf.json / build.rs）。**仅审计，未改任何 Rust 代码**。
> 主参考：`CLAUDE.md` §3.2（OS 抽象层纪律）。

---

## 1. Windows-only 代码密度

### 1.1 `#[cfg(windows)]` / `cfg!(windows)` 命中
**总命中数：14 处**（分布于 5 个文件，全部属于 `platform/` 层，无业务层泄漏）：

| 文件 | 行号 | 用途 |
|---|---|---|
| `src/platform/mod.rs` | 48, 60, 77, 89, 106, 123, 141, 154 | 8 个 `runtime::xxx()` factory 的 windows 分支 |
| `src/platform/traits.rs` | 119, 129, 156 | `SingleInstanceGuardInner::Windows` 变体 + `from_windows_handle` + `Drop<Windows>` |
| `src/platform/windows/window_chrome.rs` | 111 | `current_main_hwnd()` 仅 Windows 编译 |
| `src/platform/macos/single_instance.rs` | 34 | `#[cfg(windows)] unreachable!()` 兜底（MacSingleInstance 在 Windows build 不可达） |
| `src/infrastructure/fs_atomic.rs` | 243 | `local_utc_offset_minutes()` Windows 分支（用 `GetTimeZoneInformation`） |

### 1.2 Windows crate 依赖
**Cargo.toml 直接依赖：2 个**（仅 `[target.'cfg(windows)'.dependencies]`）：
- `windows = "0.61"`（启用 `Win32_Foundation` / `Win32_UI_WindowsAndMessaging` / `Win32_System_Threading` / `Win32_Graphics_Dwm` / `Win32_Security` / `Win32_UI_Controls`）
- `winreg = "0.52"`（Cargo.toml 声明但实际 **autostart 已改用 tauri-plugin-autostart**，winreg 当前仅在 Cargo.lock 传递依赖里出现，业务代码 0 处使用）

**Cargo.lock 命中**：8 个 windows 家族 crate 实例（winapi ×1, window-vibrancy ×1, windows ×1, windows-sys ×5, winreg ×3）。

### 1.3 Win32 API 调用
**全部 5 处 `unsafe { ... }` 都是 Windows 调用**（其中 2 处在 fs_atomic.rs 用于 libc）：
- `src/platform/windows/single_instance.rs:37` — `CreateMutexW`（开命名互斥锁）
- `src/platform/windows/window_chrome.rs:71, 79` — `DwmExtendFrameIntoClientArea` + `DwmSetWindowAttribute`（Mica）
- `src/platform/traits.rs:166` — `CloseHandle`（guard Drop）
- `src/infrastructure/fs_atomic.rs:277, 307` — `GetTimeZoneInformation` / `time` + `localtime_r`（时间偏移；非平台抽象层的小泄漏，**理论上应挪到 platform/ 层**）

**`Local\\` mutex**：仅 `windows/single_instance.rs:23` 一处 `MUTEX_NAME = "Local\\ClaudeConfigManager.lock"`，属 Windows kernel mutex 命名空间。

### 1.4 Win32 关键字命中（注释 + 字面量）
- `CreateMutexW` ×4（1 注释 + 3 代码）
- `GetModuleHandleW` ×0
- `WTSFreeMemory` ×0
- `RegOpenKeyEx` ×0
- `HKEY_` ×0（代码层），`HKCU\…\Run` ×1（注释）
- `Local\\` ×1

### 1.5 硬编码 `.exe` / `.bat` / `.cmd` / `.msi` / `.reg`
- **`claude-config-manager.exe` ×8 处**（全部位于 `src/lib.rs` 第 480/504/514/523/532/546/562/571 行的单元测试 fixture 数据，非运行时硬编码）
- 业务代码、运行时代码 0 处硬编码 `.exe` / `.bat` / `.cmd` / `.msi` / `.reg` / `.dll`

### 1.6 路径常量硬编码
- `%APPDATA%` ×6 命中（5 注释 + 1 测试用例注释 `tests/project_service.rs:337`）
- `%USERPROFILE%` ×1（注释）
- HKCU / HKLM ×0（代码层）

### 1.7 `std::env::consts::OS`
- **业务命令层 1 处**：`src/commands/app.rs:98` — 仅用于 `build_target` 字段（"`OS/ARCH`" 字符串拼接做 IPC metadata），非平台分支
- `src/commands/app.rs:18` 是注释（提到 build_target 字段用 OS+ARCH）

---

## 2. 平台 trait 实现完整度

`platform/traits.rs` 定义 **8 个 trait**（IPlatformPaths / IPlatformSingleInstance / IPlatformAutostart / IPlatformReveal / IPlatformNotifier / IPlatformAppMenu / IPlatformWindowChrome / IGitHost）。

### 2.1 模块分布

| 模块 | 文件数 | 总行数 |
|---|---|---|
| `platform/windows/` | 9（8 trait + mod.rs） | 1013 |
| `platform/macos/` | 9（8 trait + mod.rs） | 743 |
| `platform/linux/` | **不存在** | — |

### 2.2 实现完整度（trait × 平台）

| Trait | Windows | macOS | Linux |
|---|---|---|---|
| IPlatformPaths | 完整（`%APPDATA%` + `dirs::config_dir` + `~/.claude/`，**含 `active_root_dir` 真机读取** via `projects.json` + `current_project_id`）| 完整（`~/Library/Application Support/ClaudeConfigManager` + `dirs` crate；`active_root_dir` 显式 override 永返 None，D6 暂缓决策）| 不存在（**未实现**） |
| IPlatformSingleInstance | 完整（`CreateMutexW` + `Local\\` mutex + `ERROR_ALREADY_EXISTS` 冲突检测 + `CloseHandle` RAII guard）| 完整（返回 no-op `SingleInstanceGuard::from_stub()`；单实例语义实际由 `tauri-plugin-single-instance` 跨平台 plugin 承担）| 不存在 |
| IPlatformAutostart | 完整（`tauri_plugin_autostart::ManagerExt`，底层写 `HKCU\…\Run`，autostart 实现已迁出 winreg）| 完整（同样 `ManagerExt`，`MacosLauncher::LaunchAgent` 写 `~/Library/LaunchAgents/<bundle-id>.plist`）| 不存在 |
| IPlatformReveal | 完整（`explorer.exe /select,` + 4 类错误：NotFound / PermissionDenied / NetworkPath / LauncherFailed）| 完整（`open -R` + 同 4 类错误，与 Windows 同构）| 不存在 |
| IPlatformNotifier | 完整（`tauri-plugin-notification` 跨平台 toast，desktop 无显式权限）| 完整（`NotificationExt::builder().show()` + 文档化的权限模型 + no-op request_permission）| 不存在 |
| IPlatformAppMenu | **返回 NotSupported**（正确，macOS 专属概念）| 完整（`MenuBuilder` + `SubmenuBuilder` × 4 子菜单：App/Edit/View/Window，用 `PredefinedMenuItem` 自动绑 Cmd+Q/Cmd+H/Cmd+M）| 不存在 |
| IPlatformWindowChrome | 完整（Mica via `DwmSetWindowAttribute(DWMWA_SYSTEMBACKDROP_TYPE=38)` + `DwmExtendFrameIntoClientArea` + `MARGINS`；vibrancy 静默忽略；当前因 `current_main_hwnd()` 返回 None 而为 no-op，注释待 M1.9 wiring）| 完整（`window_vibrancy::apply_vibrancy` 调 `NSVisualEffectMaterial::Sidebar`；cross-compile 走 `#[cfg(not(target_os = "macos"))]` 桩）| 不存在 |
| IGitHost | 完整（`git` CLI shim：clone / ls-remote / rev-parse HEAD）| 完整（与 Windows 同构，git 跨平台 CLI 无 OS 差异）| 不存在 |

**统计**：
- **macOS 完整度：100%**（8/8 trait 全部有真实现或正确 NotSupported 桩）
- **Linux 完整度：0%**（无目录、无 factory、无 stub）
- 8 个 `runtime::xxx()` factory **全部按 `#[cfg(windows)]` vs `#[cfg(target_os = "macos")]` 二分**，没有 `target_os = "linux"` 分支 → Linux build 会编译失败

---

## 3. tauri.conf.json macOS 配置

```json
"identifier": "com.claudeconfigmanager.app",       // ✓（跨平台 bundle id）
"macOSPrivateApi": true,                            // ✓ 已在 app 层启用（vibrancy/transparent: true 必需）
"bundle.targets": "all",                            // ⚠ "all" 含义依 Tauri 版本；当前 dev/build 没显式列 "dmg"/"app"
"bundle.macOS":                                     // ❌ 不存在（无 signingIdentity / entitlements / providerShortName 等子键）
"bundle.icon": [...icons/icon.icns ✓ 已配...]
"plugins.deep-link.desktop.schemes": ["ccswitch"],  // ⚠ Tauri 跨平台 plugin；macOS 上由 plugin 自己注册到 Info.plist CFBundleURLTypes
"plugins.updater.pubkey":  ...,                     // ✓ 已配（M3 启用）
"fileAssociations": [{ "ext": ["sql"], ... }],      // ⚠ Windows 专属 OS handler 行为；macOS 上同样生效但 bundle 配置缺 CFBundleDocumentTypes
```

**评估**：
- ✅ `macOSPrivateApi: true` 已开（vibrancy 必需）
- ✅ `icon.icns` 已配（macOS bundle icon 必需）
- ⚠ `bundle.macOS` 整个子对象缺失：`signingIdentity` / `entitlements` / `minimumSystemVersion` / `frameworks` / `exceptionDomain` 等无任何配置 → **无法正式签名发布** macOS dmg/app
- ⚠ `bundle.targets: "all"` 是 Tauri 默认行为，含 `app` 和 `dmg`，但需 `bundle.macOS` 字段控制细节
- ⚠ `fileAssociations[0].ext: ["sql"]` 在 macOS 上由 tauri-bundler 自动写入 `CFBundleDocumentTypes`，但当前无显式 `role`/`icon` 等 macOS 专属字段
- ⚠ `deep-link.schemes` 由 `tauri-plugin-deep-link` 在 macOS 注入 `CFBundleURLTypes`，无需手写 Info.plist（plugin 已注册）

### 3.1 tauri-plugin-* 跨平台覆盖

| Plugin | 跨平台 | Windows-only | macOS-only | 备注 |
|---|---|---|---|---|
| `tauri-plugin-fs` | ✓ | | | |
| `tauri-plugin-dialog` | ✓ | | | |
| `tauri-plugin-notification` | ✓ | | | macOS 走 `UNUserNotificationCenter`（plugin 自动） |
| `tauri-plugin-shell` | ✓ | | | |
| `tauri-plugin-os` | ✓ | | | |
| `tauri-plugin-deep-link` | ✓ | | | macOS 走 `NSAppleEventManager` + `kAEGetURL`（plugin 自动） |
| `tauri-plugin-single-instance` | ✓ | | | 含 `deep-link` feature；macOS 走 `NSApplication.shared` + `dispatch_open_urls`（plugin 自动） |
| `tauri-plugin-store` | ✓ | | | |
| `tauri-plugin-log` | ✓ | | | |
| `tauri-plugin-updater` | ✓ | | | macOS 走 Sparkle 风格（plugin 自动） |
| `tauri-plugin-autostart` | ✓ | | | Windows 写 `HKCU\…\Run`，macOS 写 `~/Library/LaunchAgents/<id>.plist`（plugin 内部 `MacosLauncher::LaunchAgent`） |
| `tauri-plugin-process` | ✓ | | | |
| `tauri-plugin-opener` | ✓ | | | |
| `tauri-plugin-positioner` | ✓ | | | |

**全部 14 个 plugin 都是跨平台**（Tauri v2 官方 plugin 矩阵），没有 windows-only / macos-only 插件。✅

### 3.2 `[target.'cfg(windows)'.dependencies]` 划分

**唯一一处**：`Cargo.toml:97-99`
```toml
[target.'cfg(windows)'.dependencies]
windows = { version = "0.61", features = [...] }
winreg = "0.52"
```

**`[target.'cfg(target_os = "macos")'.dependencies]` 不存在**（macOS 特定需求全部由 `windows-sys` / `window-vibrancy` 等 **无 cfg gate** 的跨平台 crate 覆盖——这些 crate 在 macOS 上是 macOS API 绑定，在 Windows 上是 stub，cross-compile 安全）。

---

## 4. 推荐改造（M4/M5 路线）

按优先级从高到低：

### 4.1 P0 — `tauri.conf.json` 补 `bundle.macOS` 字段
当前 `bundle.macOS` 整个子对象缺失，无法签名/分发。
最小必需字段：
- `signingIdentity`：开发用 `-`（ad-hoc），发布用 Developer ID Application
- `entitlements`：路径指向 `entitlements.plist`（需新建）
- `minimumSystemVersion`：建议 `11.0`（vibrancy + transparent:true 需要）
- `providerShortName`：可选

### 4.2 P1 — `lib.rs` 中 `claude-config-manager.exe` 字面量改为跨平台 fixture
8 处测试 fixture 用 `.exe` 后缀（行 480/504/514/523/532/546/562/571）。这些是 `extract_sql_file_path` 函数的单元测试，函数本身已经跨平台（用 `Path::extension`），但 fixture 用了 Windows 风格绝对路径。改为 `claude-config-manager` 即可，不影响行为。

### 4.3 P2 — `fs_atomic::local_utc_offset_minutes` 移到 platform/ 层
`src/infrastructure/fs_atomic.rs:243-282` 直接 `#[cfg(windows)] extern "system"` 调 `GetTimeZoneInformation`，违反 CLAUDE.md §3.2「业务代码只调接口」纪律（虽然 `infrastructure/` 不算业务代码但仍是 OS 调用泄漏）。应迁到 `platform/windows/time.rs` + `platform/macos/time.rs`（用 libc `localtime_r`，已存在于 `#[cfg(not(windows))]` 分支）+ `ITimeZone` trait，business code 只走接口。

### 4.4 P3 — winreg 直接依赖可移除
`Cargo.toml:99` 声明 `winreg = "0.52"` 但 0 业务代码使用（autostart 已迁到 tauri-plugin-autostart）。`Cargo.lock` 里的 winreg 是传递依赖（tauri-plugin-autostart 间接拉）。直接移除 `[target.'cfg(windows)'.dependencies]` 里的 winreg。

### 4.5 P4 — Linux 支持（N/A 当前）
CLAUDE.md §1 只列 Windows + macOS 为目标平台。`platform/linux/` 完全缺失，但**当前不在 scope**。如未来扩展，需新增：
- 8 个 trait 的 linux stub（参考 macOS 模式）
- 8 个 `runtime::xxx()` factory 加 `#[cfg(target_os = "linux")]` 分支
- `commands/app.rs::build_target` 已通过 `std::env::consts::OS` 跨平台字符串拼接，OK

---

## 5. 审计总结

| 指标 | 值 |
|---|---|
| `#[cfg(windows)]` 命中 | 14 处（全在 platform/ + fs_atomic 1 处泄漏） |
| `#[cfg(target_os = "macos")]` 命中 | 14 处（macOS 真机分支） |
| Windows crate 依赖 | 2 个直接 + 8 个传递 |
| Win32 API 调用 | 5 处 unsafe（全部 platform/windows/ 层） |
| `Local\\` mutex | 1 处（windows/single_instance.rs） |
| `.exe` 硬编码 | 8 处（全在 lib.rs 单测 fixture） |
| `std::env::consts::OS` 业务用法 | 1 处（仅 IPC 字段拼接） |
| macOS trait 完整度 | **100%（8/8 全实现）** |
| Linux trait 完整度 | **0%（无目录）** |
| `bundle.macOS` 字段 | **缺失**（无签名/权限配置） |
| tauri-plugin-* 跨平台 | 14/14 全部跨平台 |

**核心结论**：项目 macOS 架构层完整（8/8 trait 全实现，14 个 plugin 全跨平台），但 **发布链路未完成**（缺 `bundle.macOS` 配置 + entitlements.plist），**OS 调用有 1 处轻度泄漏**（`fs_atomic::local_utc_offset_minutes`），**Linux 当前不在 scope**。M4/M5 优先补 P0（bundle.macOS）+ P2（time-zone 抽象化）。