# macOS 调试 + entitlements — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 写 macOS 调试脚本 + entitlements 文件 + 调试文档

**Architecture:** 3 个新文件 1 个 atomic commit。Subagent 不 commit（CLAUDE.md §14.1），主 session 审 diff 后 commit。

**Tech Stack:** bash / Apple plist XML / Markdown

## Global Constraints

- 跨平台 bash 兼容（避免 bash 4+ only 语法如 `declare -A`）
- macOS only 调试工具（lldb / log / Console.app 都是 macOS 专属）
- 不引入新依赖（lldb / log / tail / grep / plutil 都是系统自带）
- 不修改 tauri.conf.json / Cargo.toml / package.json

---

## Task 1: 写 scripts/debug-mac.sh

**Files:**
- Create: `scripts/debug-mac.sh`

**Interfaces:**
- Consumes: lldb / log / tail / grep / ps 5 个 macOS 系统 CLI
- Produces: 一键调试脚本（attach / tail / stream / all 4 个子命令）

- [ ] **Step 1: 写脚本头 + 参数解析**

```bash
#!/usr/bin/env bash
# scripts/debug-mac.sh — macOS ClaudeManager 调试脚本
#
# Usage:
#   ./scripts/debug-mac.sh attach   # lldb attach 到运行中的 ClaudeManager
#   ./scripts/debug-mac.sh tail     # tail 应用日志，高亮 ERROR/WARN
#   ./scripts/debug-mac.sh stream   # macOS unified log stream
#   ./scripts/debug-mac.sh all      # attach + tail + stream (3 pane tmux)
#   ./scripts/debug-mac.sh          # 默认 = all
#
# 前置：先 `open src-tauri/target/debug/bundle/macos/ClaudeManager.app`
#
# macOS only。其他平台：`./scripts/debug-mac.sh` 第一行检查 uname。

set -euo pipefail

if [[ "$(uname)" != "Darwin" ]]; then
    echo "ERROR: debug-mac.sh is macOS-only (got $(uname))" >&2
    exit 1
fi

CMD="${1:-all}"

APP_NAME="ClaudeManager"
LOG_DIR="$HOME/Library/Logs/com.claudeconfigmanager.desktop"
LOG_FILE="$LOG_DIR/$APP_NAME.log"
```

- [ ] **Step 2: 写 attach 子命令**

```bash
cmd_attach() {
    local pid
    pid=$(pgrep -f "$APP_NAME.app" | head -1 || true)
    if [[ -z "$pid" ]]; then
        echo "ERROR: $APP_NAME.app not running. Start with: open src-tauri/target/debug/bundle/macos/$APP_NAME.app" >&2
        exit 1
    fi
    echo "Attaching lldb to PID $pid ..."
    exec lldb -p "$pid"
}
```

- [ ] **Step 3: 写 tail 子命令**

```bash
cmd_tail() {
    if [[ ! -f "$LOG_FILE" ]]; then
        echo "WARN: log file not found at $LOG_FILE. Start $APP_NAME first." >&2
    fi
    # tail -F 跟文件名变化（rotate 后继续跟）
    # grep --color=always 高亮 ERROR（红）/ WARN（黄）
    exec tail -F "$LOG_FILE" 2>/dev/null | grep --color=always -E "ERROR|WARN|$" || true
}
```

- [ ] **Step 4: 写 stream 子命令**

```bash
cmd_stream() {
    exec log stream --predicate "process == \"$APP_NAME\"" --style compact
}
```

- [ ] **Step 5: 写 all 子命令（tmux 3 pane）**

```bash
cmd_all() {
    if ! command -v tmux >/dev/null 2>&1; then
        echo "ERROR: 'all' requires tmux. Install with: brew install tmux" >&2
        exit 1
    fi
    # 创建 detached session, 3 pane: tail / stream / 交互 shell
    tmux new-session -d -s "$APP_NAME-debug" -n "ClaudeManager" \; \
        new-window -t "$APP_NAME-debug" -n "tail" "$0 tail" \; \
        new-window -t "$APP_NAME-debug" -n "stream" "$0 stream" \; \
        select-window -t "$APP_NAME-debug:0"
    echo "tmux session '$APP_NAME-debug' created (3 windows)."
    echo "  - window 0: interactive shell (run 'lldb -p <pid>' here)"
    echo "  - window 1: tail (app log)"
    echo "  - window 2: stream (unified log)"
    echo "Attach: tmux attach -t $APP_NAME-debug"
}
```

- [ ] **Step 6: 写 main dispatcher**

```bash
case "$CMD" in
    attach) cmd_attach ;;
    tail)   cmd_tail ;;
    stream) cmd_stream ;;
    all)    cmd_all ;;
    -h|--help) sed -n '2,12p' "$0" ;;
    *)      echo "Unknown command: $CMD. Try: attach | tail | stream | all" >&2; exit 1 ;;
esac
```

- [ ] **Step 7: chmod +x + 验证语法**

```bash
chmod +x scripts/debug-mac.sh
bash -n scripts/debug-mac.sh && echo "SYNTAX_OK"
```

Expected: `SYNTAX_OK`

- [ ] **Step 8: 报告主 session 1 行摘要**

格式：`[Task 1] scripts/debug-mac.sh 写完 - 4 子命令 (attach/tail/stream/all) - chmod +x + bash -n OK`

---

## Task 2: 写 src-tauri/ClaudeConfigManager.entitlements

**Files:**
- Create: `src-tauri/ClaudeConfigManager.entitlements`

**Interfaces:**
- Consumes: Apple plist 1.0 DTD
- Produces: 4 个核心 entitlements key（不开启 sandbox）

- [ ] **Step 1: 写 plist XML**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <!-- Dev only: 不开 sandbox (签名 + 公证时再开) -->
    <!-- F7 用量查询 + F17 marketplace git clone 出站 HTTP -->
    <key>com.apple.security.network.client</key>
    <true/>
    <!-- F3 .sql picker / F5/F14 save-open 对话框 -->
    <key>com.apple.security.files.user-selected.read-write</key>
    <true/>
    <!-- F19 备份与恢复的下载目录 -->
    <key>com.apple.security.files.downloads.read-write</key>
    <true/>
    <!-- deep-link / 文件关联 (Finder Apple Events) -->
    <key>com.apple.security.temporary-exception.apple-events</key>
    <array>
        <string>com.apple.finder</string>
    </array>
</dict>
</plist>
```

写到 `src-tauri/ClaudeConfigManager.entitlements`

- [ ] **Step 2: plutil 验证**

```bash
plutil -lint src-tauri/ClaudeConfigManager.entitlements
```

Expected: `OK`

- [ ] **Step 3: 报告主 session 1 行摘要**

格式：`[Task 2] ClaudeConfigManager.entitlements 写完 - 4 keys (network.client / files.user-selected / files.downloads / apple-events[finder]) - plutil -lint OK`

---

## Task 3: 写 docs/DEBUG-MAC.md

**Files:**
- Create: `docs/DEBUG-MAC.md`

**Interfaces:**
- Consumes: 现有 CLAUDE.md §15 + scripts/build-mac.sh + tauri.conf.json
- Produces: 4 章调试指南

- [ ] **Step 1: 写第 1 章 — 启动流程**

```markdown
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
tail -F ~/Library/Logs/com.claudeconfigmanager.desktop/ClaudeManager.log
```

### 1.3 一键调试脚本

```bash
./scripts/debug-mac.sh attach   # lldb attach
./scripts/debug-mac.sh tail     # tail 日志
./scripts/debug-mac.sh stream   # unified log
./scripts/debug-mac.sh all      # tmux 3 pane
```

完整脚本见 `scripts/debug-mac.sh`。
```

写到 `docs/DEBUG-MAC.md`

- [ ] **Step 2: 写第 2 章 — 编译选项**

```markdown
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
```

- [ ] **Step 3: 写第 3 章 — 模块拓扑**

```markdown
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
```

- [ ] **Step 4: 写第 4 章 — 常见任务速查**

```markdown
## 4. 常见任务速查 (10 FAQ)

### Q1: 如何开 dev mode (Vite HMR + Tauri auto-rebuild)?
```bash
npm run tauri dev
```

### Q2: 如何看应用日志?
```bash
tail -F ~/Library/Logs/com.claudeconfigmanager.desktop/ClaudeManager.log
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
```

- [ ] **Step 5: 验证文件存在 + 4 章齐全**

```bash
ls -la docs/DEBUG-MAC.md && grep -c "^## [1-4]\." docs/DEBUG-MAC.md
```

Expected: 文件存在 + `4`（4 章标题）

- [ ] **Step 6: 报告主 session 1 行摘要**

格式：`[Task 3] docs/DEBUG-MAC.md 写完 - 4 章 (启动流程/编译选项/模块拓扑/常见任务速查)`

---

## Self-Review

1. **Spec 覆盖**：spec 2 3 项目标（debug-mac.sh / entitlements / DEBUG-MAC.md）→ Task 1-3 全部覆盖 ✅
2. **占位符扫描**：无 TBD/TODO/`???` ✅
3. **类型一致**：`ClaudeManager` (Task 1 app name) = `tauri.conf.json productName` = spec 1 Task 3+4 subagent 实际发现 ✅
4. **不引入依赖**：仅用 lldb / log / tail / grep / plutil / tmux 系统 CLI ✅
5. **不修改 tauri.conf.json / Cargo.toml / package.json**：✅

---

*Plan 由 writing-plans skill 生成（2026-06-24）。subagent 实施前必读 CLAUDE.md §14.1。*
