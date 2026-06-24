# macOS 调试指南

> 适用：macOS 26 (Tahoe) on Apple Silicon。本地开发环境（CLAUDE.md §15.1）。

## 1. 启动流程 (从 git clone 到 .app 跑通)

### 1.1 前置依赖
- Xcode Command Line Tools: `xcode-select --install`
- Rust stable: `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
- Node 22 LTS (nvm): `nvm install --lts`
- Tauri CLI (via npx, 不全局装)

### 1.2 编译 + 运行

```bash
# 1. 装 npm 依赖
npm ci

# 2. 编译前端
npm run build

# 3. 编译 + bundle macOS .app
./scripts/build-mac.sh --debug

# 4. 启动
open src-tauri/target/debug/bundle/macos/ClaudeManager.app

# 5. 验证进程在
pgrep -f ClaudeManager  # 应返回 1+ PID

# 6. 看日志
tail -F ~/Library/Logs/com.claudeconfigmanager.app/ClaudeManager.log
```

### 1.3 一键调试脚本

```bash
./scripts/debug-mac.sh attach   # lldb attach
./scripts/debug-mac.sh tail     # tail 日志
./scripts/debug-mac.sh stream   # unified log
./scripts/debug-mac.sh all      # tmux 3 pane
```

完整脚本见 `scripts/debug-mac.sh`。

## 2. 编译选项 (cargo tauri build 5 个常用 flag)

| Flag | 用途 | 何时用 |
|---|---|---|
| `--debug` | 编译 debug 变体，含调试信息 | 本地开发、需要 lldb attach |
| `--no-bundle` | 只 cargo build 不 bundle | 改 Rust 后快速验编译 |
| `--bundles app` | 只产 .app（不产 .dmg）| 默认 |
| `--bundles app,dmg` | .app + .dmg | Release ship |
| `--target aarch64-apple-darwin` | 显式 Apple Silicon target | Apple Silicon Mac 默认 target |
| `--target x86_64-apple-darwin` | 显式 Intel target | Intel Mac / 通用二进制 |

### 2.1 常用组合

```bash
# 本地 dev (快)
cargo tauri build --debug --no-bundle

# 验编译 (最快)
npm run build && cargo check --target aarch64-apple-darwin

# Release ship
./scripts/build-mac.sh  # 默认 release + .app + .dmg
```

### 2.2 编译性能

`~/.cargo/config.toml` 已配 sccache（CLAUDE.md §12.2）。二次 build ~1-2 min，改 1-2 行 ~10-30s。

### 2.3 编译错误排查

- `note: method defined here` → Tauri API 改了，看官方文档
- `linker not found` → `xcode-select --install` 重装
- `wry/tao` 编译 5-8 min 长时间 → sccache 没生效，`sccache --show-stats` 验证

## 3. 模块拓扑 (src-tauri 目录树)

```
src-tauri/
├── main.rs                # 入口
├── lib.rs                 # Tauri builder + plugin registration
├── build.rs               # build.rs (tauri-build)
├── tauri.conf.json        # Tauri 配置 (window / bundle / plugins)
├── Cargo.toml             # Rust 依赖 (锁版本)
├── ClaudeConfigManager.entitlements  # macOS entitlements (本 spec 新增)
├── src/
│   ├── main.rs
│   ├── lib.rs
│   ├── commands/          # Tauri IPC commands (前端 invoke 入口)
│   ├── domain/            # 业务模型 (Provider / McpServer / UsageSnapshot)
│   ├── services/          # 业务逻辑 (ProviderService / McpService)
│   ├── infrastructure/    # 基础设施 (文件 IO / HTTP / git / sqlite)
│   ├── platform/          # OS 抽象层
│   │   ├── traits.rs      # 8 个 trait 定义
│   │   ├── windows/       # Windows 实现
│   │   ├── macos/         # macOS 实现
│   │   ├── mod.rs         # runtime factory (cfg 分发)
│   │   └── runtime        # 8 个 runtime::xxx() 工厂函数
│   └── plugins/           # 插件系统 (M1.x 12 个 stub, M2+ 实装)
├── tests/                 # Rust 集成测试
└── target/                # 编译产物
```

### 3.1 OS 抽象层 (8 trait)

| Trait | Win 用途 | Mac 用途 |
|---|---|---|
| `IPlatformPaths` | 解析 %APPDATA% 路径 | 解析 ~/Library/Application Support |
| `IPlatformSingleInstance` | Win mutex | macOS unix 锁文件 (走 plugin, 不用 trait) |
| `IPlatformAutostart` | 注册表 Run | LaunchAgent |
| `IPlatformReveal` | `explorer /select,` | `open -R` |
| `IPlatformNotifier` | 系统通知 | UNUserNotificationCenter |
| `IPlatformAppMenu` | (NotSupported) | NSMenu |
| `IPlatformWindowChrome` | Mica DWM | NSVisualEffectView vibrancy |
| `IGitHost` | `git` CLI shim | `git` CLI shim (跨平台同实现) |

业务代码只调 trait，**不**直接 `#[cfg(target_os = "...")]`（CLAUDE.md §3.2）。

## 4. 常见任务速查 (10 FAQ)

### Q1: 如何开 dev mode (Vite HMR + Tauri auto-rebuild)?
```bash
npm run tauri dev
```

### Q2: 如何看应用日志?
```bash
tail -F ~/Library/Logs/com.claudeconfigmanager.app/ClaudeManager.log
# 或
./scripts/debug-mac.sh tail
```

### Q3: 如何 attach 调试器?
```bash
# 1. debug build
./scripts/build-mac.sh --debug
# 2. 启动
open src-tauri/target/debug/bundle/macos/ClaudeManager.app
# 3. attach
./scripts/debug-mac.sh attach
# 或手动
PID=$(pgrep -f ClaudeManager)
lldb -p $PID
```

### Q4: 如何清 app 缓存?
```bash
rm -rf ~/Library/Application\ Support/ClaudeConfigManager
# 下次启动会重建
```

### Q5: 如何验 entitlements?
```bash
codesign -d --entitlements - src-tauri/target/debug/bundle/macos/ClaudeManager.app
```

### Q6: 编译报 "method takes 1 argument but 0 supplied"?
通常是 Tauri API 改了。查 `~/.cargo/registry/src/.../tauri-2.11.3/` 源码看正确签名。

### Q7: pgrep 找不到 ClaudeManager?
- 确认 .app 启动成功（`open` 不报错）
- 进程名是 `ClaudeManager`（看 tauri.conf.json productName），不是 `ClaudeConfigManager`

### Q8: dev 模式 ccswitch:// 链接打不开?
mac dev 模式需手动注册 deep-link。`tauri plugin` 临时注册。生产 bundle 由 tauri-action 自动写 Info.plist。

### Q9: 如何看前端 console.log?
- DevTools: mac dev 模式默认开 devtools (右键 → Inspect Element)
- Tauri release 模式不开 devtools，需在代码里 `window.__TAURI_INTERNALS__.invoke('tauri::open_devtools')` 临时开

### Q10: 如何跑 cargo test 跑 platform::macos?
```bash
cargo test -p claude_config_manager_lib --lib platform::macos
# CI 上 macos-latest job 自动跑 (`.github/workflows/ci.yml::test-rust-mac`)
```

---

> 最后验证：2026-06-24。如内容过期，提 issue。
