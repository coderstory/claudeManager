# macOS 调试 + entitlements — Design

> **日期**：2026-06-24
> **范围**：写 macOS 调试脚本 + entitlements 文件 + 调试文档
> **不做**：签名 / 公证（v1.1 release work）/ 桌面交付 cp 脚本（v1.1）
> **依据**：CLAUDE.md §15.6 (entitlements) + subagent Task 3+4 新发现的 4 个事实

---

## 1. 目标 (Why)

修完 macOS 编译错后，开发者/用户需要：
- 在 macOS 上能 attach 调试器看 Rust 崩溃
- 能实时 tail app 日志
- 能给 .app 配 entitlements（sandbox / 文件 / 网络 / Apple Events）
- 知道 "出了错怎么 debug" 的入口文档

## 2. 范围 (What)

### 2.1 新增 3 个文件

| 文件 | 用途 | 估时 |
|---|---|---|
| `scripts/debug-mac.sh` | 一键调试脚本（lldb attach + log tail + Console.app stream）| 2h |
| `src-tauri/ClaudeConfigManager.entitlements` | macOS entitlements plist | 1h |
| `docs/DEBUG-MAC.md` | 调试指南 | 1h |

### 2.2 修改 0 个文件

不修改 tauri.conf.json / Cargo.toml / package.json / 任何业务代码。

### 2.3 subagent Task 3+4 新发现的事实 → 进 backlog（不属本 spec）

- `tauri.conf.json productName = "ClaudeManager"`（已是 M3.0.3 重命名结果）
- `build-mac.sh` 2 个 shell bug（CRLF + bash 3.2 set -u）→ 进 `tmp/macos-p2-backlog.md` 追加 2 项
- `npm run build` 缺 `@testing-library/user-event` → 进 backlog
- bundle identifier 末 `.app` 警告 → 进 backlog

## 3. 架构 (How)

### 3.1 scripts/debug-mac.sh

**职责**：
- 参数解析：`./scripts/debug-mac.sh [attach | tail | stream | all]`
- `attach`: 调 `lldb -p <pid>` attach 到 ClaudeManager 进程（需先启动 .app）
- `tail`: `tail -F ~/Library/Logs/com.claudeconfigmanager.desktop/ClaudeManager.log` + grep 高亮 ERROR/WARN
- `stream`: `log stream --predicate 'process == "ClaudeManager"'`（macOS unified log）
- `all`: 同时 attach + tail + stream（3 pane 终端 / tmux 分割）

**约束**：
- 跨平台 bash 兼容（`set -euo pipefail`，但避免 bash 4+ only 语法）
- 跨平台：macOS only（开头 `[[ "$(uname)" != "Darwin" ]] && { echo "macOS only"; exit 1; }`）
- 不引入新依赖（只用 lldb / log / tail / grep 4 个系统 CLI）
- 含 README 注释（`# Usage:` 在脚本前 30 行）

### 3.2 src-tauri/ClaudeConfigManager.entitlements

**内容**（plist XML）：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <!-- Dev only: 不开 sandbox (签名 + 公证 时再开) -->
    <key>com.apple.security.network.client</key>
    <true/>
    <key>com.apple.security.files.user-selected.read-write</key>
    <true/>
    <key>com.apple.security.files.downloads.read-write</key>
    <true/>
    <key>com.apple.security.temporary-exception.apple-events</key>
    <array>
        <string>com.apple.finder</string>
    </array>
</dict>
</plist>
```

**字段说明**（commit message 含）：
- `network.client`: F7 用量查询 + F17 marketplace git clone 出站 HTTP
- `files.user-selected.read-write`: F3 .sql picker / F5/F14 save-open 对话框
- `files.downloads.read-write`: F19 备份与恢复的下载目录
- `apple-events` (Finder): deep-link / 文件关联

**注册到 tauri.conf.json**：

不修改 tauri.conf.json（已有 `bundle.macOS.entitlements = "ClaudeConfigManager.entitlements"`，等文件存在即可生效）。

### 3.3 docs/DEBUG-MAC.md

**4 章**：
1. **启动流程**：从 `git clone` 到 `.app` 跑通的全流程
2. **编译选项**：`cargo tauri build` 5 个常用 flag（`--debug` / `--no-bundle` / `--bundles app` / `--target aarch64-apple-darwin` / `--ci`）
3. **模块拓扑**：src-tauri 目录树 + 每个 module 一句话职责
4. **常见任务速查**：10 个 FAQ（如何开 dev mode / 如何看日志 / 如何 attach 调试器 / 如何清缓存 / 如何验签名 / ...）

## 4. 验收

- ✅ `./scripts/debug-mac.sh attach` 能 attach 到 ClaudeManager 进程（先手动 open .app）
- ✅ `./scripts/debug-mac.sh tail` 输出日志且高亮 ERROR/WARN
- ✅ `ClaudeConfigManager.entitlements` 是合法 plist（`plutil -lint` 通过）
- ✅ `docs/DEBUG-MAC.md` 存在，4 章齐全
- 不引入 Cargo.toml / package.json 改动

## 5. 风险

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| lldb 找不到符号（debug build 不含） | 低 | attach 失败 | 文档说明必须用 debug build |
| entitlements 缺字段导致某 command 拒 | 中 | 用户点 F3/F7 失败 | 5 个核心 command 跑一遍手动验（subagent 不验，留你手跑）|
| docs 内容与代码 drift | 高 | 文档失效 | 每章后注"最后验证日期"，让人能看出过时 |

## 6. 实施 + 节奏

1. **写 PLAN**：writing-plans skill 写 PLAN.md
2. **Subagent 跑**：3 个文件 subagent 一次写完（atomic 1 commit）
3. **Subagent 不 commit**（CLAUDE.md §14.1），主 session 审 + commit
4. **验收**：主 session 跑 `plutil -lint` + 翻看 docs

## 7. 跨文档引用

- 真机环境：CLAUDE.md §15.1
- 编译性能：CLAUDE.md §12（sccache 50x 加速）
- 已有 entitlements 引用：`tauri.conf.json:48` `bundle.macOS.entitlements`
- 已有 build 脚本：`scripts/build-mac.sh`
- 已有文档：`docs/ARCHITECTURE.md`

---

*本 spec 由 brainstorming skill 生成（2026-06-24）。spec 2/3 序列：spec 1 (mac 编译修) → spec 2（本 doc, 调试+entitlements）→ spec 3 (项目结构文档)。*
