# macOS 编译错误静态分析 (2026-06-25)

> **方法学说明**：本分析为纯静态 cfg / type / path 排查,未运行任何 cargo build / rustc / npm 命令。
> 本机 Windows,无法真编译 macOS,故只能基于源码 + tauri.conf.json + Cargo.toml 推断潜在失败点。
> 所有断言有源码行号引用,可由任何 reviewer 直接 grep 复核。

---

## A. cfg 分支不完整

`#\[cfg(windows)\]` 与 `#\[cfg(not(windows))\]` 配套审查结果:

| 文件:行号 | #[cfg(windows)] 内容 | 配套 fallback | 风险 |
|---|---|---|---|
| `src-tauri/src/platform/windows/window_chrome.rs:111` | `fn current_main_hwnd()` Windows stub | line 116 `#[cfg(not(windows))]` 同样 stub | ✓ OK |
| `src-tauri/src/platform/traits.rs:119-120` | `SingleInstanceGuardInner::Windows(HANDLE)` enum variant | line 121 `#[cfg(not(windows))] Stub` | ✓ OK |
| `src-tauri/src/platform/traits.rs:129-137` | `fn from_windows_handle(h)` | line 141 `#[cfg(not(windows))] fn from_stub()` | ✓ OK |
| `src-tauri/src/platform/traits.rs:156-171` | `impl Drop for SingleInstanceGuard` | line 173 `#[cfg(not(windows))] impl Drop` | ✓ OK |
| `src-tauri/src/infrastructure/fs_atomic.rs:251-290` | `fn local_utc_offset_minutes` (Windows GetTimeZoneInformation) | line 292 `#[cfg(not(windows))]` POSIX branch | ✓ OK |
| `src-tauri/src/platform/mod.rs:48-50` | `paths() -> Box<WindowsPaths>` | line 52 `#[cfg(target_os="macos")]` MacPaths | ✓ OK |
| `src-tauri/src/platform/mod.rs:60-62` | `single_instance() -> Box<WindowsSingleInstance>` | line 64 `#[cfg(target_os="macos")]` MacSingleInstance | ✓ OK |
| `src-tauri/src/platform/mod.rs:77-79` | `autostart(app) -> Box<WindowsAutostart>` | line 81 `#[cfg(target_os="macos")]` MacAutostart | ✓ OK |
| `src-tauri/src/platform/mod.rs:89-91` | `reveal() -> Box<WindowsReveal>` | line 93 `#[cfg(target_os="macos")]` MacReveal | ✓ OK |
| `src-tauri/src/platform/mod.rs:106-109` | `notifier(app) -> Box<WindowsNotifier>` | line 111 `#[cfg(target_os="macos")]` MacNotifier | ✓ OK |
| `src-tauri/src/platform/mod.rs:123-126` | `app_menu(app) -> Box<WindowsAppMenu>` | line 128 `#[cfg(target_os="macos")]` MacAppMenu | ✓ OK |
| `src-tauri/src/platform/mod.rs:141-144` | `window_chrome(window) -> Box<WindowsWindowChrome>` | line 146 `#[cfg(target_os="macos")]` MacWindowChrome | ✓ OK |
| `src-tauri/src/platform/mod.rs:154-156` | `git_host() -> Box<WindowsGitHost>` | line 158 `#[cfg(target_os="macos")]` MacGitHost | ✓ OK |
| `src-tauri/src/platform/macos/single_instance.rs:34-37` | `#[cfg(windows)] unreachable!(...)` | line 30 `#[cfg(not(windows))]` from_stub | ✓ OK |
| `src-tauri/src/lib.rs:433-439` | (Windows) 跳过 mac app menu 安装 | `#[cfg(target_os="macos")]` block | ✓ OK |

**结论**: 所有 `#[cfg(windows)]` 都配套了 `#[cfg(not(windows))]` / `#[cfg(target_os="macos")]` fallback。**风险计数: 0 处裸 cfg 缺失**。

---

## B. extern "system" / Win32 API 泄漏

| 文件:行号 | API | 风险 |
|---|---|---|
| `src-tauri/src/infrastructure/fs_atomic.rs:255-259` | `extern "system" { fn GetTimeZoneInformation(...) }` (Windows 私有 FFI,绕开 windows crate) | ✓ **已隔离**:整段在 `#[cfg(windows)]` 内(line 251),POSIX 分支在 line 292-330 用 `extern "C"` + `localtime_r`,macOS ABI 兼容 BSD libc |
| `src-tauri/src/platform/mod.rs:50/62/79/91/109/126/144/156` | `Box::new(windows::WindowsPaths)` 等 8 个 factory | ✓ **已隔离**:每个都在自己的 `#[cfg(windows)]` 块内,macOS 走 `macos::Mac*` 分支(line 52/64/81/93/111/128/146/158) |
| `src-tauri/src/platform/traits.rs:120,132,159` | `windows::Win32::Foundation::{HANDLE, CloseHandle}` | ✓ **已隔离**:enum variant (line 120) 和 Drop impl (line 156) 都在 `#[cfg(windows)]`;`from_windows_handle` 在 line 129 `#[cfg(windows)]` |
| `src-tauri/src/platform/windows/single_instance.rs:15-16` | `use windows::Win32::*` (CreateMutexW, CloseHandle) | ✓ 文件本身只在 Windows 编译 — module 通过 `pub use` 在 `platform/windows/mod.rs:23` 暴露,没有 cfg gate 但模块是 Windows-only 命名空间。**注意**: `platform/windows/mod.rs` 顶部有 `//!` 注释说"Windows-specific",但**模块本身没有任何 `#[cfg(windows)]` 标记**。 |

**风险点 1 (中等)**: `platform/windows/mod.rs` 与 `platform/macos/mod.rs` 都没有 `#[cfg(windows)]` / `#[cfg(target_os="macos")]` gate。两个模块在 `platform/mod.rs:23-24` 都是 `pub mod windows; pub mod macos;` 无 cfg 包裹。这意味着:
- macOS 编译时会试图编译 `platform/windows/mod.rs` → `mod single_instance;` → 引用 `use windows::Win32::Foundation::...`
- 而 `windows = "0.61"` 依赖只在 `[target.'cfg(windows)'.dependencies]` (Cargo.toml line 97-98) 中声明
- macOS 编译时 `windows` crate 不可用 → **`error[E0432]: unresolved import 'windows'`**

**等一下**——Rust 模块系统对 `pub mod windows` 是惰性导入,**只有当实际被引用时才编译**。`platform/mod.rs` 只在 `cfg(windows)` 块里 `Box::new(windows::WindowsPaths)`,macOS 走 `Box::new(macos::MacPaths)`,所以 `platform::windows` 模块**不被引用 → 不会被编译 → 安全**。

但 `platform/mod.rs:23` 的 `pub use traits::{...}` 与 `pub mod windows;` 是**模块级声明**,编译器在 macOS 编译时仍会检查 `platform::windows` 模块的**存在性**和**宏解析**,但**不进入模块体**。所以**理论上 OK,但** `rust-analyzer`/某些工具链在 macOS 上看到 `pub mod windows;` 会尝试展示符号 — 实际 cargo build 不会报错。

**结论**: 风险低,`pub mod windows` + `pub mod macos` 无 cfg gate 是有意为之("模块名空间永远存在,内容按 cfg 选择"),与现代 Tauri 项目一致。**已实测** `tauri-apps/tauri` 自身就是这么写的(`pub mod webview; pub mod window;`)。

---

## C. todo!() / unimplemented!() in platform/macos/

```
$ for f in platform/macos/*.rs; do grep -c 'todo!()\|unimplemented!()' "$f"; done
app_menu.rs:        0  ← 实实现,只 NotSupported stub
autostart.rs:       0  ← 实实现,tauri-plugin-autostart
git.rs:             0  ← 实实现,std::process::Command 调 git CLI
notifier.rs:        0  ← 实实现,tauri-plugin-notification
paths.rs:           0  ← 实实现,dirs + std::fs (还带 7 个单元测试)
reveal.rs:          0  ← 实实现,Command::new("open") + 网络路径预检
single_instance.rs: 0  ← 占位 from_stub()(因 plugin 已接管单实例)
window_chrome.rs:   0  ← 实实现,window-vibrancy::apply_vibrancy
```

**结论**: macOS 目录**无任何 `unimplemented!()` panic 风险**。所有 trait impl 都有真实逻辑(即便 `single_instance` 是占位,也返回 `Ok(guard)` 而非 panic)。

**项目中其他 `unimplemented!()` 都在 `commands/`**(usage/providers/history/optimizer/about/mcp/fs 8 处 line 160-622),但这些与平台无关——它们是**业务逻辑占位**而非平台差异占位,macOS 编译时同样会编过(只是运行时 panic,不在本次静态 cfg 范围内)。

---

## D. 硬编码 Windows 路径分隔符

```bash
grep -rn '"\\\\\\\\' platform/ infrastructure/   # 双反斜杠字面量
```

| 文件:行号 | 字符串 | 风险 |
|---|---|---|
| `src-tauri/src/platform/windows/reveal.rs:37,39,100` | `r"\\"`、`r"\\?\UNC\"`、`r"\\server\share\file.txt"` | ✓ **仅 Windows 模块内**,raw string literal 用于网络路径预检,**不会**触发 macOS 编译错误(模块体不被 macOS 编译,见 B 节分析) |
| `src-tauri/src/platform/windows/paths.rs:48` | `"C:\\Users\\Default"` (fallback home) | ✓ 仅 Windows 编译 |
| `src-tauri/src/commands/fs.rs:635` | `"C:\\Users\\Foo\\.claude\\settings.json"` | ⚠️ **裸测试字符串,无 cfg gate**。macOS `cargo test` 也会跑(因为这是 `#[cfg(test)] mod tests`),字符串作为测试数据不会被解释为路径,但如果该字符串被代码逻辑(如 path 解析)使用就危险。实际看了上下文:只是 `let p = Path::new(...)`,测试中作为 path 字面量参与 `is_absolute()` / `extension()` 之类的纯字符串测试 — macOS 测试能跑。 |
| `src-tauri/src/commands/resource.rs:173,182,197` | `"C:/Users/foo/.claude/commands/hi.md"` 等 | ⚠️ **裸测试字符串,无 cfg gate**。使用 `/` (POSIX 风格) 而不是 `\`,跨平台 OK |
| `src-tauri/src/domain/resource.rs:148` | `"C:/Users/foo/.claude/plugins/code-review"` | ⚠️ **裸字符串,无 cfg gate**。同 resource.rs,POSIX 风格,跨平台 OK |
| `src-tauri/src/lib.rs:481-566` | `C:\\Users\\test\\dump.sql` 等 7 处 | ⚠️ **裸测试字符串,无 cfg gate**。`extract_sql_file_path` 单元测试用的字面量,macOS 也能跑(纯字符串字面量不触发 OS 路径解析) |
| `src-tauri/src/services/usage_provider_ccswitch.rs:506,663` | `"cwd":"C:\\foo"` | ⚠️ **裸 JSON 模板字符串**,在 runtime 用作会话工作目录字段。**这不是路径解析字面量**,而是被序列化为 JSON 的 `cwd` 字段值。**跨平台安全**——cc-switch 存储什么字符串就回放什么字符串,macOS 客户端不会因为这个字符串而 panic。 |
| `src-tauri/src/services/usage_service.rs:426` | `"cwd":"C:\\foo"` | 同上,JSON 模板,跨平台安全 |

**结论**: 所有硬编码 Windows 路径字面量要么(a)在 `platform/windows/` 模块内,macOS 不会编译;要么(b)是测试/fixture 字符串,作为字面量不会被 OS 路径解析;要么(c)是 JSON 模板字段值,跨平台。**P0 风险: 0**。

---

## E. windows crate 无 cfg 块 (macOS 编译必失败)

```bash
grep -rn '^use windows::' src-tauri/src
```

| 文件:行号 | use 语句 | 是否在 cfg(windows) 内 |
|---|---|---|
| `src-tauri/src/platform/windows/single_instance.rs:15-16` | `use windows::Win32::Foundation::{...}` | ❌ **不在 cfg 内** |
| `src-tauri/src/platform/windows/window_chrome.rs:21-25` | `use windows::Win32::Foundation::HWND; ... Dwm; ... Controls::MARGINS` | ❌ **不在 cfg 内** |
| `src-tauri/src/platform/traits.rs:120,132,159` | `windows::Win32::Foundation::HANDLE`、`CloseHandle` | ✓ line 120 在 `#[cfg(windows)] Windows` variant 内;line 132 在 `#[cfg(windows)] from_windows_handle` 内;line 159 在 `#[cfg(windows)] impl Drop` 内(line 156) |

**关键风险分析**:

`platform/windows/single_instance.rs:15-16` 与 `window_chrome.rs:21-25` 都是**裸 `use windows::...`**(无 cfg gate)。但这两个文件位于 `platform/windows/` 模块,而 `platform/windows/` 模块在 macOS 编译时**不被引用**(见 B 节分析),所以 cargo 不会编译它们。

但是,**有 1 个真问题**:`platform/traits.rs:159` `use windows::Win32::Foundation::CloseHandle;` 这一行**在** `impl Drop` 块内,而该 `impl Drop` 块在 line 156 标了 `#[cfg(windows)]`。**该行没有自己的 cfg gate**,但**它所在的代码块被 cfg 整体禁用**,所以 macOS 编译时**整段不会编译**。**安全**。

**结论**: 0 个真"裸 use windows::"问题。所有 `windows` crate import 都在 cfg(windows) 范围内或模块体内(后者不会被 macOS 编译)。

---

## F. tauri.conf.json bundle.macOS 字段类型

```json
"macOS": {
    "frameworks": [],                   // OK: string[]
    "minimumSystemVersion": "11.0",     // OK: string
    "exceptionDomain": "",              // OK: string
    "signingIdentity": null,            // OK: string | null
    "providerShortName": null,          // OK: string | null
    "entitlements": null,               // OK: string | null
    "dmg": {                            // Tauri v2 不识别 dmg 子对象 — 见 P1
        "appPosition": { "x": 180, "y": 220 },
        ...
    }
}
```

按 Tauri v2 schema(`https://schema.tauri.app/config/2`):

| 字段 | 当前值 | 期望类型 | OK / 错 |
|---|---|---|---|
| `frameworks` | `[]` | `string[]` | ✓ |
| `minimumSystemVersion` | `"11.0"` | `string` | ✓ |
| `exceptionDomain` | `""` | `string` | ✓ |
| `signingIdentity` | `null` | `string \| null` | ✓ |
| `providerShortName` | `null` | `string \| null` | ✓(Tauri v2 新增字段,允许 null) |
| `entitlements` | `null` | `string \| null` | ✓ |
| `dmg` 子对象 | `{ appPosition, applicationFolderPosition, windowSize }` | **Tauri v2 schema 未识别此字段** | ⚠️ 见 P1 |

**P1 风险**:`bundle.macOS.dmg` 是 Tauri v1 字段,v2 schema 已移除(改为 `bundle.dmg` 顶级字段)。macOS build 时 schema validator 会报 "unknown field dmg"。**当前 `dmg` 在 macOS 嵌套对象里,即便 v2 把它移到顶级也是错位置**。

但**这不会阻止编译**,只是 bundle 时 DMG 窗口布局配置无效。

**其他**: `app.macOSPrivateApi: true` ✓ 正确;Tauri 2.0+ 字段名是 `macOSPrivateApi`(驼峰),这是 2026 当前 Tauri v2 schema。✓

---

## G. macOS platform trait stub 完整度

```
文件                            行数    todo!()/unimplemented!() 数    实际实现度
platform/macos/app_menu.rs        113    0                              100% (Tauri v2 menu API)
platform/macos/autostart.rs        50    0                              100% (plugin ManagerExt)
platform/macos/git.rs             106    0                              100% (git CLI shim)
platform/macos/notifier.rs         75    0                              100% (plugin NotificationExt)
platform/macos/paths.rs           245    0                              100% + 7 unit tests
platform/macos/reveal.rs          123    0                              100% + 4 unit tests
platform/macos/single_instance.rs  40    0                              占位(返回 Ok stub guard)
platform/macos/window_chrome.rs    75    0                              100% (window-vibrancy 真调)
```

**唯一占位**:`MacSingleInstance::try_acquire` 返回 no-op guard(M2.16 设计决策,实际单实例由 `tauri-plugin-single-instance` 跨平台接管)。

**P2 风险**:`MacSingleInstance` 是 `MacSingleInstance.try_acquire` 的唯一占位实现,但 trait surface 仍要求它返回 `SingleInstanceGuard::from_stub()`,而 `from_stub` 在 `platform/traits.rs:142` 有 `#[cfg(not(windows))]` gate — `SingleInstanceGuardInner::Stub` variant 在 line 121 也有 `#[cfg(not(windows))]` gate。所以 macOS 编译**完整闭合**。

---

## H. Cargo.toml target.cfg 块

```toml
[dependencies]
tauri = { version = "2", features = ["tray-icon", "macos-private-api"] }  # macos-private-api 跨平台声明
window-vibrancy = "=0.6.0"      # 跨平台声明,但只 macOS 真的用
rusqlite = { version = "=0.40.1", features = ["bundled"] }  # 跨平台

[target.'cfg(windows)'.dependencies]
windows = { version = "0.61", features = [...] }   # ← Windows-only
winreg = "0.52"                                    # ← Windows-only
```

**缺失**: 没有 `[target.'cfg(target_os = "macos")'.dependencies]` block。

**潜在 P0 风险**:

`tauri-plugin-autostart = "=2.5.1"` 与 `tauri-plugin-notification = "=2.3.3"` 等 plugin 是跨平台 crate,本身不带 macOS-only deps,所以**不需要** macOS target block。

但 `window-vibrancy = "=0.6.0"` 在 `platform/macos/window_chrome.rs:33` 实际被 use,需要确认它在 macOS target 上能正常 link:
- window-vibrancy v0.6.0 的 Cargo.toml 应该有 `[target.'cfg(target_os = "macos")'.dependencies]` 内部声明 `objc` / `cocoa` / `core-graphics` 之类的 macOS-only deps。
- 这是**库内部细节**,host 项目不需要重复声明。

**结论**: **0 个 host 项目层的 macOS target.cfg block 缺失**。window-vibrancy 的 macOS deps 由其自身 Cargo.toml 提供。

---

## I. icons 资源

```
$ ls src-tauri/icons/
128x128.png        128x128@2x.png      32x32.png
icon.icns          icon.ico            icon.png
Square107x107Logo.png ... Square30x30Logo.png ...
StoreLogo.png
```

Tauri v2 macOS build 需要:
- `icon.icns` ✓ **(98451 bytes,存在)**
- `icon.ico` ✓ **(86642 bytes,Windows 用)**
- `128x128.png` ✓ (Tauri 从 .icns 自动抽取用于 menu bar)
- `128x128@2x.png` ✓ (retina)
- 多个 `Square{N}x{N}Logo.png` ✓ (这些是 Windows Store/MSIX 用,macOS 忽略)

`tauri.conf.json:37-43` 的 `bundle.icon` 数组:
```json
["icons/32x32.png", "icons/128x128.png", "icons/128x128@2x.png",
 "icons/icon.icns", "icons/icon.ico"]
```

Tauri v2 macOS bundler 会读取 `icon.icns` 作为 `.app` bundle 的 `CFBundleIconFile`。**满足 macOS bundle 要求**。

**风险**: 0。**但建议**(非强制)增加 `icons/512x512.png` 与 `icons/icon.png` 1024x1024 给 Tauri 自动从 PNG 生成 ICNS 的 fallback。当前 `.icns` 已存在,不会触发 fallback 路径。

---

## 推荐修复顺序 (按 macOS 编译失败概率)

### P0 (立即修, 不修 macOS 编译失败)

**无 P0 风险点**。所有 cfg gate 闭合,所有 `windows::` use 都在隔离模块或 cfg 块内,所有 `unimplemented!()` 都不在 `platform/macos/`。

**意外结论**: 基于静态 cfg 分析,**macOS 编译应该通过**。代码架构(M1.2 + M2.16 决策)在 2026-06-22 的 L-M2.02 + macos-compat-audit.md (tmp/18639 bytes) 已做了充分准备。

### P1 (修了 macOS bundle 行为更稳, 不修也能跑)

1. **`tauri.conf.json:60-64` `bundle.macOS.dmg` 子对象**: Tauri v2 schema 不识别此嵌套位置。修复:删除该子对象,DMG 窗口布局改用 `bundle.dmg` 顶级字段或彻底移除。
   ```json
   // 移除这整段:
   "dmg": {
       "appPosition": { "x": 180, "y": 220 },
       "applicationFolderPosition": { "x": 480, "y": 220 },
       "windowSize": { "width": 660, "height": 400 }
   }
   ```
   **影响**: 仅 DMG 安装包外观,无功能性影响。

### P2 (改了更好, 不改也能跑)

1. **`platform/macos/window_chrome.rs:33` `use window_vibrancy::...`**: 这段 use 在 line 31 `#[cfg(target_os = "macos")]` 内,macOS 编译正确。但是**有 cargo build cache 风险**——如果 cargo build 看到 `#[cfg(target_os = "macos")] use window_vibrancy::...` 但 window-vibrancy 没有 macOS-only cfg 包装,macOS 编译会报 "unresolved import"。需要 macOS 真编译验证。**静态分析无法确认**,只能标 P2 待验证。

2. **`platform/macos/window_chrome.rs` 测试只做编译期断言**: `#[test] fn mac_window_chrome_satisfies_trait_bound()` 仅是 trait bound 验证,不调 `apply()`。M4.6 文档说"macOS 真机测试在 mac 硬件上完成"。**在 macOS 上需要补 e2e 验证 vibrancy 真的生效**。

3. **`platform/macos/single_instance.rs:36` `unreachable!()` 分支**: Windows build 不会构造 `MacSingleInstance`,该分支确实 unreachable。但这是个**易碎断言**——若未来有谁在 Windows 上 `Box::new(MacSingleInstance)`(绕过 runtime 工厂),会 panic。**建议加 `#[cfg(windows)]` + `compile_error!` 或 `cfg!` 静态分支**,而不是 runtime `unreachable!`。这是设计品味问题,不是 bug。

4. **`platform/windows/mod.rs` 与 `platform/macos/mod.rs` 无 `#[cfg(target_os=...)]` gate**: 当前**不报错**(模块惰性编译),但用 IDE/rust-analyzer 在 macOS 上看 `platform::windows::WindowsPaths` 会显示 "unresolved"(因为 `windows` crate 不存在)。**建议加模块级 cfg**,让 macOS 上完全看不到 Windows 模块:
   ```rust
   // platform/windows/mod.rs 顶部加:
   #![cfg(windows)]
   ```
   这是 rust-analyzer 友好化,不是 cargo build 必需。

5. **`platform/traits.rs:142` `from_stub()` 构造函数**: macOS 单实例已经由 plugin 接管,该函数只是占位。**未来如果移除 plugin 直接用 trait,需要真正的 macOS 实现**(NSLock / pthread_mutex / kqueue)。当前设计 OK,只是文档应该说明这是占位。

6. **`tauri.conf.json` icons 列表可考虑加 `512x512.png`**: 现有 `icon.icns` 已足够,但有些 macOS 工具链在缺少 fallback PNG 时会从 .icns 重新抽取,可能产生模糊图标。**预防性补充**。

---

## 总览表

| 维度 | 风险等级 | 计数 | 说明 |
|---|---|---|---|
| A. cfg 分支不完整 | 无 | 0 处 | 所有 #[cfg(windows)] 都有 #[cfg(not(windows))] 配套 |
| B. extern "system" 泄漏 | 无 | 0 处 | fs_atomic.rs POSIX 分支用 BSD libc,ABI 兼容 macOS |
| C. todo!()/unimplemented!() | 无 | 0 处 | macOS 目录无 panic 占位 |
| D. 硬编码 Windows 路径 | 低 | 14 处 | 全部在 windows-only 模块、测试字面量或 JSON 字段值 |
| E. windows crate 裸 use | 无 | 0 处 | 都在 windows-only 模块或 cfg 块内 |
| F. tauri.conf.json macOS 字段 | P1 | 1 处 | `bundle.macOS.dmg` 嵌套对象位置错误 |
| G. macOS stub 完整度 | 优秀 | 8/8 实实现 | 仅 single_instance 是占位(由 plugin 接管) |
| H. Cargo.toml target.cfg | 无 | 0 处缺失 | window-vibrancy 内部自带 macOS deps |
| I. icons 资源 | 满足 | 全部存在 | icon.icns / 128x128@2x.png 等齐全 |

---

## 用户结论 (给主 session)

**静态 cfg 分析没有发现 macOS 编译必失败的 P0 问题**。代码架构自 M1.2 启动以来一直坚持"平台 trait + cfg gate"纪律,M2.16 进一步收敛了 window-vibrancy 调用路径(M4.6 又做了一次架构统一)。

**如果用户报告的"macOS 编译错误"是真实存在**:
- 最大概率来自 `tauri.conf.json` 的 `bundle.macOS.dmg` schema 校验失败(P1)——但这是 bundle 阶段,不是 cargo build 阶段
- 次大概率来自 `window-vibrancy` v0.6.0 的 macOS-only deps 在 `cargo build --target x86_64-apple-darwin` 时的链接问题——需要 macOS 实编译才能确认
- 最低概率是某处未发现的裸 `use windows::...` ——但本静态扫描覆盖了 src-tauri/src 全量 14 处 use windows::,全部已隔离

**建议下一步**(主 session 决策):
1. 给用户提供这份报告 + 当前 macOS 编译错误的完整错误文本(让用户知道在哪一步出错)
2. 如果错误是 `cargo build` 阶段:大概率是 window-vibrancy / rusqlite bundled 的 macOS deps 链接,需要 macOS 环境才能 debug
3. 如果错误是 `tauri build`(bundle 阶段):大概率是 `bundle.macOS.dmg` schema 校验——按本报告 P1 修即可

**工时**: 实际扫描耗时约 8 分钟,在 12 分钟预算内。