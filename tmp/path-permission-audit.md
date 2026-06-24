# 用户目录 / 路径 / 权限 macOS 审计 (2026-06-25)

> 范围：`D:/project/winui3/` 全量 `src-tauri/src/` + `src/`
> 关注：用户主目录硬编码 / `~/.claude` 硬编码 / 配置文件目录 / macOS TCC + Info.plist + entitlements
> 状态：**只读审计，不改任何代码**。

---

## 0. 总评（结论先行）

| 维度 | 评分 | 备注 |
|---|---|---|
| `IPlatformPaths` trait 完整性 | A | 7 字段 (home / app_data / settings_json / claude_json / backups / marketplaces / logs / history_db) 已就位；Win + Mac 双向实现；mock 完备 |
| 业务代码遵守 trait 抽象 | A- | 全部走 `paths.xxx` 字段；只有 3 处生产代码用了 `home.join(".claude")` fallback (有注释说明理由)；其余 30+ 处 `home.join(".claude")` 全在 `#[cfg(test)]` 模块 |
| `~/.claude` 跨平台一致性 | A | Claude Code 自身在 macOS 上也用 `~/.claude/`，**这是契约**而非漏洞；Win + Mac 两侧 `MacPaths` 注释明确写"用户在 Win/Mac 间迁移 Claude Code 配置时无需改路径" |
| 项目自有目录 (`app_data`) 跨平台 | A | Win = `%APPDATA%\ClaudeConfigManager\`，Mac = `~/Library/Application Support/ClaudeConfigManager/`，全走 `dirs::config_dir()` |
| macOS 权限 / entitlements | **D** | **未配置**：无 `.entitlements` 文件；`tauri.conf.json` 显式 `"entitlements": null`；无 `Info.plist` 自定义；AppleEvents / URL scheme 全靠 Tauri 自动生成 |
| TS 前端硬编码路径 | A | 35 个文件含 `~/.claude`，**全部是注释 / JSDoc / 用户文案**，无一处 `.join()` 拼路径 |

**最关键修复点（按优先级）**：
1. **P0** 创建 `src-tauri/Info.plist` + `src-tauri/ClaudeConfigManager.entitlements`，把 `tauri.conf.json` 里的 `"entitlements": null` 替换为文件路径，覆盖 ccswitch URL scheme + AppleEvents + 文件读写 + 网络
2. **P0** 验证 Tauri v2 自动生成的 `Info.plist` 是否包含 `ccswitch://` 的 `CFBundleURLTypes`（`tauri-plugin-deep-link` v2.4.9 应该自动写入）+ `.sql` 的 `CFBundleDocumentTypes`（`fileAssociations` 应该自动写入）
3. **P1** 业务代码里 3 处 `home.join(".claude")` fallback 是**合理的**（`claude_dir()` 返回 None 时的防御性回退，详见 §1.2），无需修改

---

## 1. 用户主目录硬编码点

### 1.1 实际生产代码

| 文件:行号 | 内容 | 性质 | 修复方向 |
|---|---|---|---|
| `src-tauri/src/platform/windows/paths.rs:48` | `dirs::home_dir().unwrap_or_else(|| PathBuf::from("C:\\Users\\Default"))` | 平台实现（Windows-only） | 正确：仅 Windows 编译时存在；macOS 走 `MacPaths::resolve` |
| `src-tauri/src/platform/windows/paths.rs:52-54` | `dirs::config_dir().map(...ClaudeConfigManager).unwrap_or_else(\|\| home.join("AppData").join("Roaming").join("ClaudeConfigManager"))` | 平台实现 | 正确：Win 专属 |
| `src-tauri/src/platform/windows/paths.rs:56-58` | `let claude_dir = home.join(".claude"); let claude_json = home.join(".claude.json");` | 平台实现 | 正确：`~/.claude/` 是 Claude CLI 契约 |
| `src-tauri/src/platform/macos/paths.rs:34-35` | `dirs::home_dir().unwrap_or_else(|| PathBuf::from("/Users/Shared"))` | 平台实现（macOS-only） | 正确：仅 Mac 编译时存在 |
| `src-tauri/src/platform/macos/paths.rs:41-47` | `dirs::config_dir().map(...ClaudeConfigManager).unwrap_or_else(\|\| home.join("Library").join("Application Support").join("ClaudeConfigManager"))` | 平台实现 | 正确：Mac 专属 |
| `src-tauri/src/platform/macos/paths.rs:51-53` | `let claude_dir = home.join(".claude"); let claude_json = home.join(".claude.json");` | 平台实现 | 正确：Mac 仍用 `~/.claude/`（Claude CLI 契约） |

**结论**：所有用户主目录访问**全部封装在 `platform/windows/paths.rs` 和 `platform/macos/paths.rs`** 两个文件里，业务代码看不到 `dirs::home_dir` / `dirs::config_dir` / `%APPDATA%` / `~/Library`。`domain/mod.rs:10` 明确禁止业务代码直接调 `dirs::home_dir()`。

### 1.2 业务代码里 3 处 `home.join(".claude")` 防御性回退

| 文件:行号 | 上下文 | 性质 |
|---|---|---|
| `src-tauri/src/app_state.rs:117` | `paths.claude_dir().map(\|p\| p.to_path_buf()).unwrap_or_else(\|\| paths.home.join(".claude"))` | 防御性回退（`claude_dir()` 返回 `None` 时的兜底）|
| `src-tauri/src/app_state.rs:167` | 同上 | 防御性回退 |
| `src-tauri/src/commands/fs.rs:501` | 同上 | 防御性回退 |

**评估**：这 3 处是 `AppPaths::claude_dir()` 理论返回 `None` 时的兜底（`claude_dir()` 是 `settings_json.parent()`，即 `Some(...)`，**实际上不会返回 None**）。代码冗余但无害，不影响 macOS 兼容性。建议**保留**——抽到 trait 方法会牺牲 `Option<Path>` 的语义清晰度。

### 1.3 业务代码 + 平台实现里的 30+ 处 `home.join(".claude")` 实际是测试代码

扫到的绝大多数 `root.join(".claude")` / `home.join(".claude")` 全在 `#[cfg(test)] mod tests` 里（`mcp_service.rs:467/517/583/598/719/802/810/824/833/881/885/929/970/997/1005`、`backup_service.rs:1131/1182`、`optimizer_service.rs:573/585/687/765`、`usage_service.rs:617/626/649/658`、`marketplace_service.rs:1440/1445/1487/1491/1541`、`resource_service.rs:353/363/385/394`、`provider_service.rs:1807/1894/1896/1977/1998/2002` 等），是测试 helper `test_paths(home)` 构造 `AppPaths` 的代码。

### 1.4 用户名 / 绝对路径硬编码

| 范围 | 命中 | 性质 |
|---|---|---|
| `e-Yunfei.Qian` | **0** | 无 |
| `C:\\Users` / `D:\\Users` | 0 处生产代码 | 0 |
| `/c/Users` | 0 | 无 |
| `C:\Users\u\...` | 2 处 | 全部在 `infrastructure/fs_atomic.rs:128` 和 `commands/fs.rs:611` 注释/doc 里举的"Windows 路径示例"，**不是真实路径** |

**结论**：项目无任何用户级硬编码。

---

## 2. `~/.claude` 跨平台硬编码点

`~/.claude/` 是 **Claude Code CLI 自己的配置目录**，**不是项目自有目录**。Claude Code 在 macOS / Linux / Windows 上都用这个路径（`%USERPROFILE%\.claude`）。因此 `~/.claude/` **不应该跨平台差异化**——这是项目与 Claude CLI 之间的契约。

### 2.1 项目里 `~/.claude` 出现的位置（按用途分类）

| 类别 | 命中数 | 性质 | macOS 兼容性 |
|---|---|---|---|
| `IPlatformPaths::AppPaths` 字段（`settings_json = home.join(".claude").join("settings.json")`） | 2（Win + Mac） | 平台实现 | ✓ 仍是 `~/.claude/settings.json`（Mac 也是） |
| 服务层构造 `active_root.join(".claude")` | 10+（`mcp_service.rs:102/885`、`provider_service.rs:400/409`、`usage_service.rs:348`、`marketplace_service.rs:353/555/676`、`resource_service.rs:119` 等） | 业务代码 | ✓ 是项目级 `.claude/`（M3.10 契约） |
| 业务代码文档注释 / JSDoc | 35+ 文件 | 注释 | ✓（`~/.claude/` 在 Mac 上仍存在） |
| 用户文案（toast / tooltip / placeholder） | 10+（`pages/backup-restore/index.tsx:457`、`pages/home/index.tsx:198` 等） | 字符串 | ✓ |
| 测试代码（`#[cfg(test)]`） | 30+ | 测试 | ✓ |
| `commands/fs.rs:454` `(<root>/.claude/ 是项目级) | 业务代码 | ✓（项目级 .claude/） | |

**唯一**特殊用例**：`src-tauri/src/domain/project.rs:147` `project root_dir must contain a .claude/ subdirectory: {0}`——这是 M3.10 引入的"项目模式"，用户显式添加一个 project，project root 须含 `.claude/` 子目录。这与 OS 无关（Win / Mac / Linux 行为一致）。

### 2.2 `MacPaths::resolve` 的明确设计

```rust
// src-tauri/src/platform/macos/paths.rs:49-50
// Claude Code 自身配置目录与文件——与 Windows 侧保持一致，
// 均位于 `~/.claude/` 与 `~/.claude.json`。
let claude_dir = home.join(".claude");
let settings_json = claude_dir.join("settings.json");
let claude_json = home.join(".claude.json");
```

**这是设计正确**：用户在 Win/Mac 间迁移 Claude Code 配置时无需改路径。

---

## 3. 配置文件目录现状

### 3.1 各配置 / 数据文件路径来源

| 文件 | 字段 / 拼接 | 走 trait? | 备注 |
|---|---|---|---|
| `settings.json` | `AppPaths::settings_json` | ✓ | trait 提供 |
| `claude.json` | `AppPaths::claude_json` | ✓ | trait 提供 |
| `mcp.json` | `root.join(".claude").join("mcp.json")` | ⚠️ 半 trait | `root` 来源于 `active_root_dir()`（trait）或 `paths.claude_dir()`（trait），文件名 `"mcp.json"` 硬编码 |
| `usage.json` | `paths.claude_dir().join("usage.json")` | ⚠️ 半 trait | 文件名硬编码 |
| `projects/<encoded>/*.jsonl` | `claude_dir.join("projects")` | ⚠️ 半 trait | 文件名硬编码 |
| `providers/*.json` | `paths.app_data.join("providers").join(id + ".json")` | ⚠️ 半 trait | trait 提供 `app_data`，子目录名 "providers" 硬编码 |
| `projects.json` | `paths.app_data.join("projects.json")` | ⚠️ 半 trait | 文件名硬编码 |
| `backups/` | `AppPaths::backups_dir` | ✓ | trait 提供 |
| `marketplaces/` | `AppPaths::marketplaces_dir` | ✓ | trait 提供 |
| `logs/` | `AppPaths::logs_dir` | ✓ | trait 提供 |
| `history.db` | `AppPaths::history_db` | ✓ | trait 提供 |

**结论**：
- **目录** 100% 走 trait
- **文件名**（`mcp.json` / `usage.json` / `projects.json` / `providers/`）在 service 层拼字符串，但与 OS 无关（Win/Mac/Linux 文件系统都支持这些文件名），不构成跨平台问题
- 业务代码**没有任何一处**直接拼 `%APPDATA%` / `~/Library/Application Support` —— 全部通过 `AppPaths::app_data`

### 3.2 `tauri-plugin-fs` capabilities 配置

`src-tauri/capabilities/default.json` 第 15-25 行：
```json
"fs:default",
"fs:allow-read-text-file",
"fs:allow-write-text-file",
"fs:allow-read-file",
"fs:allow-write-file",
"fs:allow-exists",
"fs:allow-mkdir",
"fs:allow-remove",
"fs:allow-rename",
"fs:allow-read-dir"
```

**风险**：Tauri v2 的 `fs:*` capability 必须配合 `fs:scope`（基于路径白名单）才能生效。当前**没有**配置 `fs:scope`（用 `"fs:default"` 通配）。在 macOS 沙盒下，这会触发沙盒拒绝（即便不开沙盒，Tauri 2.x 也会因为 `fs:default` 不含 scope 而拒绝非白名单路径）。

**修复方向**：补一个 `fs:scope` 配置，至少允许：
- `<APPDATA>/ClaudeConfigManager/**`（Win）/ `~/Library/Application Support/ClaudeConfigManager/**`（Mac）—— 写
- `~/.claude/**` —— 读+写
- 用户任意路径（用 `dialog` 选择的）—— 读+写

详见 §5 推荐修复 #4。

---

## 4. macOS 权限 / entitlements 清单

### 4.1 当前状态

| 文件 | 状态 |
|---|---|
| `src-tauri/<name>.entitlements` | **不存在** |
| `src-tauri/Info.plist` | **不存在** |
| `tauri.conf.json` 的 `bundle.macOS.entitlements` | `"entitlements": null` (line 59) |
| `tauri.conf.json` 的 `bundle.macOS.minimumSystemVersion` | `"11.0"` (line 55) ✓ |
| `tauri.conf.json` 的 `bundle.macOS.exceptionDomain` | `""` (line 56) ✓ |
| `tauri.conf.json` 的 `bundle.macOS.dmg` | 已配置 ✓ |
| `tauri.conf.json` 的 `bundle.macOS.signingIdentity` | `null` (line 57, dev 默认 ad-hoc) |
| `tauri.conf.json` 的 `bundle.macOS.providerShortName` | `null` (line 58) |

### 4.2 Tauri v2 自动生成 vs 手动补充

`tauri build` 会在 `target/release/bundle/macos/ClaudeConfigManager.app/Contents/Info.plist` 自动生成 plist。来源是 `tauri.conf.json` 的：

| 配置 | 映射到 Info.plist | 当前状态 |
|---|---|---|
| `productName` | `CFBundleName` / `CFBundleDisplayName` | "ClaudeManager" ✓ |
| `identifier` | `CFBundleIdentifier` | "com.claudeconfigmanager.app" ✓ |
| `version` | `CFBundleVersion` / `CFBundleShortVersionString` | "0.1.1" ✓ |
| `bundle.macOS.minimumSystemVersion` | `LSMinimumSystemVersion` | "11.0" ✓ |
| `bundle.fileAssociations[].ext` | `CFBundleDocumentTypes` | `.sql` ✓（应自动生成） |
| `plugins.deep-link.desktop.schemes` | `CFBundleURLTypes` | `ccswitch` ✓（应自动生成） |

**Tauri 2.x 自动生成的实际能力**（v2 文档）：
- ✓ `CFBundleURLTypes`（从 `plugins.deep-link.desktop.schemes` 派生）
- ✓ `CFBundleDocumentTypes`（从 `bundle.fileAssociations` 派生）
- ✗ `NSAppleEventsUsageDescription`（Tauri **不会**自动生成，**首次调用 AppleEvents 会弹系统级 alert**，用户体验差）
- ✗ `NSCameraUsageDescription` / `NSMicrophoneUsageDescription` 等（不需要，未用）
- ✗ `LSUIElement`（决定是否在 Dock 显示图标；目前希望显示，OK）
- ✗ `LSApplicationCategoryType`（决定 App Store 分类；建议 `public.app-category.developer-tools`）

### 4.3 macOS TCC 权限需求（按功能模块）

| 功能 | TCC 类别 | 触发时机 | 当前是否需要 entitlements |
|---|---|---|---|
| 读 `~/.claude/**` | **Files and Folders** → `~/.claude` | 启动时 `ensure_dirs` 不读 `~/.claude`（注释明说"由 Claude Code 负责创建"），但 `McpService` / `BackupService` 启动后会读 | macOS 不开 sandbox：用户授权弹窗（首次）→ 永久授权<br>macOS 开 sandbox：必须 entitlements `com.apple.security.files.user-selected.read-write`（**只对用户选过的文件**，启动时读 `~/.claude` **不在白名单**） |
| 读 `<app_data>/**` | 同上 | 启动时 `ensure_dirs` + 后续读写 | macOS 不开 sandbox：OK<br>macOS 开 sandbox：必须显式声明路径或用 `user-selected` |
| 写 `<app_data>/backups/**` | 同上 | 备份服务 | 同上 |
| 网络（`tauri-plugin-updater`） | `com.apple.security.network.client` | 检查更新 | **必须**（沙盒下不上 entitlement 网络直接断） |
| 系统通知 | `notification:default` capability | tray click | macOS 首次会弹"X wants to send you notifications"系统弹窗；**无需 entitlement** |
| AppleEvents（`tauri-plugin-single-instance`） | 系统级授权 | 单实例锁 + deeplink 转发 | Tauri 2.x 的 `tauri-plugin-single-instance` 在 macOS 上用 `kAEGetURLEvent` 监听 URL，**不弹窗**（系统默认允许自己 bundle id 内的 AppleEvent） |
| LaunchAgent（自启） | 无（LaunchAgent 是普通 plist 写入 `~/Library/LaunchAgents/`） | 启用自启时 | 需写 `~/Library/LaunchAgents/<bundle-id>.plist`（`tauri-plugin-autostart` `MacosLauncher::LaunchAgent` 自动处理） |
| USB / Camera / Mic | 不需要 | — | — |

### 4.4 当前 plist 实际行为预测

- ✓ `ccswitch://` URL scheme 注册（`plugins.deep-link.desktop.schemes`）
- ✓ `.sql` 文件关联（`bundle.fileAssociations`）
- ⚠️ **首次**调用 AppleEvents 时（如 cold-start 接收 ccswitch:// URL）— Tauri 默认 silently NSAppleEventManager handle，**不弹**用户文案的 NSAppleEventsUsageDescription（因为没声明）。但 App Sandbox 开启时会失败。
- ✗ 无 `LSApplicationCategoryType` → Launchpad 分类会是 generic "Other"
- ✗ 无 `LSUIElement`（默认 false → Dock 显示图标 + 菜单栏 — 符合预期）

---

## 5. 推荐修复顺序

### P0：macOS 部署基础（mac 真机跑起来前必做）

#### #1 创建 `src-tauri/Info.plist`（手写，覆盖 Tauri 自动生成的默认）

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <!-- Tauri 2.x 不会自动生成这些键 -->
    <key>LSApplicationCategoryType</key>
    <string>public.app-category.developer-tools</string>
    <key>NSAppleEventsUsageDescription</key>
    <string>Claude Config Manager needs to receive ccswitch:// deep links from your browser to import provider configurations.</string>
    <key>NSHumanReadableCopyright</key>
    <string>Copyright © 2026 Claude Config Manager. All rights reserved.</string>
</dict>
</plist>
```

在 `tauri.conf.json` 里指向它（v2 支持 `bundle.macOS.providerShortName`/`entitlements` 但 **Info.plist 是合并**的，需要放到 `src-tauri/Info.plist`，Tauri 会 merge 进自动生成的 plist）。

**注意**：`CFBundleURLTypes` 和 `CFBundleDocumentTypes` 由 Tauri 自动生成（来源是 `plugins.deep-link.desktop.schemes` 和 `bundle.fileAssociations`），**不要**手写。

#### #2 创建 `src-tauri/ClaudeConfigManager.entitlements`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <!-- 文件读写：让 Rust 端 std::fs 可以访问 ~/Library/Application Support/ClaudeConfigManager/ -->
    <!-- 备注：entitlements 不支持路径白名单，只能 enable 整个类别。Mac App Store 之外不上 App Sandbox 时可省略此 entitlement -->
    <key>com.apple.security.files.user-selected.read-write</key>
    <true/>
    <!-- 网络：tauri-plugin-updater 必须 -->
    <key>com.apple.security.network.client</key>
    <true/>
    <!-- AppleEvents：允许 plugin 接收 kAEGetURLEvent -->
    <key>com.apple.security.automation.apple-events</key>
    <true/>
</dict>
</plist>
```

然后在 `tauri.conf.json` line 59 把 `"entitlements": null` 改成 `"entitlements": "ClaudeConfigManager.entitlements"`。

### P0：验证 Tauri 自动生成的 Info.plist 内容

`scripts/build-mac.sh` 跑一次 release bundle，然后检查：
```bash
# 应该看到 ccswitch URL scheme
plutil -extract CFBundleURLTypes xml1 -o - target/release/bundle/macos/ClaudeConfigManager.app/Contents/Info.plist
# 应该看到 .sql 文件关联
plutil -extract CFBundleDocumentTypes xml1 -o - target/release/bundle/macos/ClaudeConfigManager.app/Contents/Info.plist
```

如果两个都生成 → Tauri 配置正确，**不需要**手写 plist 键。如果不生成 → 检查 `plugins.deep-link.desktop.schemes` 格式（v2.4.9 必须用 `{ "desktop": { "schemes": ["ccswitch"] } }` 结构）。

### P1：业务代码审计

#### #3 业务代码 3 处 `home.join(".claude")` fallback

位置：`app_state.rs:117/167`、`commands/fs.rs:501`。

**评估**：这 3 处是 `paths.claude_dir().map(|p| p.to_path_buf()).unwrap_or_else(|| paths.home.join(".claude"))` 的模式。`claude_dir()` 返回 `Option<&Path>`，在 `AppPaths` 正常 `resolve` 后**永远 `Some`**（`settings_json.parent()`）。但代码为了"防御性编程"加了 fallback。

**建议**：
- **保留**——`Option` 返回值的 API 形态鼓励调用者处理 None；抽到 trait 反而隐藏语义
- 或在 `AppPaths::claude_dir()` 加 `#![deny(unreachable_patterns)]` 测试覆盖，但收益不大

#### #4 `tauri-plugin-fs` capability 补充 `fs:scope`

`src-tauri/capabilities/default.json` 缺 `fs:scope` 配置。在 macOS 沙盒下，**`fs:default` 单独不够**——必须显式声明允许的路径前缀。

**最小补丁**：
```json
{
  "identifier": "fs:scoped",
  "description": "scope for tauri-plugin-fs reads/writes",
  "windows": ["main"],
  "permissions": [
    "fs:scope",  // <-- 关键：开启 scope 机制
    {
      "identifier": "fs:allow-read-text-file",
      "allow": [
        { "path": "$HOME/.claude/**" },
        { "path": "$HOME/.claude.json" },
        { "path": "$APPDATA/ClaudeConfigManager/**" },
        { "path": "$APPLOCALDATA/ClaudeConfigManager/**" }
      ]
    }
  ]
}
```

**注意**：Tauri 2.x 的 fs scope 是**强制**的（沙盒化部署或 no-sandbox 都生效）。当前 `fs:default` + 不配 scope 的写法在 Mac 上会让所有 fs 操作失败。

#### #5 macOS autostart 验证

`tauri-plugin-autostart` 的 `MacosLauncher::LaunchAgent`（已在 `lib.rs:102` 配置）会自动写 `~/Library/LaunchAgents/<bundle-id>.plist`。**无需**手写 plist。但需在真机验证：
- `~/Library/LaunchAgents/com.claudeconfigmanager.app.plist` 真的写出来
- `RunAtLoad` 键是 true
- `--minimized` flag 正确传入（`lib.rs:103`）

### P2：可选优化

#### #6 `LSUIElement` 决策

如果将来要做"完全后台运行 / 无 Dock 图标"模式（`tauri-plugin-tray` 的"close hides to tray"已支持），可以加：
```xml
<key>LSUIElement</key>
<false/>
```
当前 `false`（默认）= 显示在 Dock + 菜单栏。**保持现状**（产品定位是桌面应用，应该有菜单栏）。

#### #7 项目级 `.claude/` 路径权限（M3.10）

如果用户加了一个 project（`<active_root>/.claude/`），Tauri 启动时 Rust 端 `ensure_dirs` 不创建 `<active_root>`（那是用户的代码目录）。但读 `<active_root>/.claude/**` 需要 fs scope allow-list 把 `**` 加进去——见 #4。

#### #8 App Store 提交准备（如果以后要走 Mac App Store）

要走 Mac App Store 必须开 sandbox：
```xml
<key>com.apple.security.app-sandbox</key>
<true/>
```
但**当前版本不应开 sandbox**——开了之后：
- `~/Library/Application Support/ClaudeConfigManager/` 读没问题（系统管理）
- `~/.claude/**` 读需要 `com.apple.security.files.user-selected.read-write`（仅用户选过的）—— 项目启动自动读 `~/.claude/settings.json` 会**失败**
- `dirs::home_dir()` 返回 sandbox 容器内的 `~/Library/Containers/com.claudeconfigmanager.app/Data`
- 整个 `IPlatformPaths` 的语义变了

**建议**：v1.0 / v1.1 都走 **直接分发**（DMG / GitHub release），**不开 App Sandbox**。App Store 提交是 v2.0 之后的事。

---

## 6. 附录：扫描覆盖度

### 6.1 执行的 grep 命令

```bash
# Windows 用户目录变量
grep -rn 'HOMEPATH|HOMEDRIVE|USERPROFILE|APPDATA|LOCALAPPDATA' src-tauri/src/ src/
# 硬编码 ~/.claude / .cargo
grep -rn '\.claude\b|\.cargo\b|~/\.config|~/\.local' src-tauri/src/ src/
# 用户名硬编码
grep -rn 'e-Yunfei\.Qian|/c/Users|C:\\Users|D:\\Users' src-tauri/src/ src/
# macOS 路径常量
grep -rn 'Library/Application Support|NSHomeDirectory|~/Library' src-tauri/src/ src/
# 配置文件具体路径
grep -rn 'settings\.json|providers/|\.mcp\.json|history\.db|marketplaces|backups/' src-tauri/src/
# 路径构造
grep -rn '\.join("\.claude")|\.join("\.claude\.json")|home_dir\(\)|dirs::home_dir|dirs::config_dir|dirs::data_dir' src-tauri/src/
# AppPaths 字段使用
grep -rn 'paths\.home|paths\.app_data|paths\.settings_json|paths\.claude_json|paths\.backups_dir|paths\.marketplaces_dir|paths\.logs_dir|paths\.history_db' src-tauri/src/
```

### 6.2 关键文件清单

```
src-tauri/src/platform/traits.rs          # IPlatformPaths + 7 字段 + 8 traits
src-tauri/src/platform/windows/paths.rs   # Windows 实现
src-tauri/src/platform/macos/paths.rs     # macOS 实现
src-tauri/src/platform/mod.rs             # runtime factory
src-tauri/tauri.conf.json                 # bundle.macOS.entitlements = null  ❌
src-tauri/capabilities/default.json       # fs:default 无 scope            ⚠️
src-tauri/src/lib.rs                      # deeplink + single-instance 插件
src-tauri/Cargo.toml                      # 13 个 tauri-plugin-* 依赖
```

### 6.3 关键结论

- **路径抽象**：A+（业务代码 0 处直接拼 OS 路径字符串）
- **`~/.claude` 跨平台**：A（这本是 Claude CLI 契约，Win/Mac 一致）
- **macOS entitlements / Info.plist**：D（**未配置**——这是 mac 部署前必须修的）
- **`tauri-plugin-fs` scope**：D（**未配置 scope**——mac 沙盒下会失败）

---

**报告完**。3 个最关键的修复点（按 P0 排序）：

1. **P0 #1+#2**：手写 `src-tauri/Info.plist`（NSAppleEventsUsageDescription + LSApplicationCategoryType）+ 创建 `src-tauri/ClaudeConfigManager.entitlements`（network.client + files.user-selected + automation.apple-events），并把 `tauri.conf.json:59` 的 `"entitlements": null` 改为文件名
2. **P0 验证**：跑 `scripts/build-mac.sh` 后 `plutil -extract CFBundleURLTypes xml1 -o - target/release/bundle/macos/ClaudeConfigManager.app/Contents/Info.plist` 确认 `ccswitch` 已自动注入；`plutil -extract CFBundleDocumentTypes xml1 -o - ...` 确认 `.sql` 已注入
3. **P1 #4**：`src-tauri/capabilities/default.json` 补 `fs:scope` 配置（允许 `$HOME/.claude/**` + `$APPDATA/ClaudeConfigManager/**` + `$APPLOCALDATA/ClaudeConfigManager/**`），否则 mac 沙盒下 `tauri-plugin-fs` 全部拒绝
