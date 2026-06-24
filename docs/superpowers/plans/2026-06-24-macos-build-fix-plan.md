# macOS 编译错修复 (Tauri 2.11.3) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修 macOS 编译错直到 `cargo check --target aarch64-apple-darwin` 0 error + `scripts/build-mac.sh --debug` 产可启动 .app

**Architecture:** 循环 cargo check → 修错 → 再 cargo check。每错 1 atomic commit。Subagent 不 commit（CLAUDE.md §14.1），主 session 审 diff 后 commit。

**Tech Stack:** Rust 1.x / Tauri 2.11.3 / macOS 26.5.1 / Apple Silicon

## Global Constraints

- 目标平台：macOS 26.5.1 (Tahoe) on Apple Silicon (arm64)
- Tauri 版本锁：2.11.3（`Cargo.lock` 锁死，**不**升级）
- Subagent 行为禁区：CLAUDE.md §14.1（不 commit / push / 改全局配置）
- 每错 1 atomic commit，commit message 含 file:line + 错代号
- Subagent 不验 GUI（spec 1 不含 GUI 验证）

---

## Task 1: 修 MacAppMenu .about() 编译错 (E0061)

**Files:**
- Modify: `src-tauri/src/platform/macos/app_menu.rs:1-30` (加 AboutMetadata import)
- Modify: `src-tauri/src/platform/macos/app_menu.rs:54` (.about() 加参数)

**Interfaces:**
- Consumes: Tauri 2.11.3 `tauri::menu::AboutMetadata` (Default 实现)
- Produces: `MacAppMenu::build_app_menu` 编译通过

- [ ] **Step 1: 跑 cargo check 看当前错**

```bash
cargo check --target aarch64-apple-darwin --manifest-path /Users/coderstory/CodeSource/winui3/src-tauri/Cargo.toml 2>&1 | grep -E "^(error|warning: unused)" | head -10
```

Expected: 1 个 `error[E0061]` 关于 `.about()` 缺参数

- [ ] **Step 2: 读 .about() 当前代码**

```bash
sed -n '50,60p' /Users/coderstory/CodeSource/winui3/src-tauri/src/platform/macos/app_menu.rs
```

Expected: 看到 `.about()` 调用

- [ ] **Step 3: 改 app_menu.rs — 加 AboutMetadata import + 改 .about()**

**改 import 行**（约 30-34 行附近）：
```rust
use tauri::menu::{MenuBuilder, SubmenuBuilder};
```
改为：
```rust
use tauri::menu::{AboutMetadata, MenuBuilder, SubmenuBuilder};
```

**改 .about() 调用**（54 行附近）：
```rust
let app_menu = SubmenuBuilder::new(&self.app, "App")
    .about()
    .separator()
```
改为：
```rust
let about_meta = AboutMetadata::default();
let app_menu = SubmenuBuilder::new(&self.app, "App")
    .about(Some(about_meta))
    .separator()
```

- [ ] **Step 4: 跑 cargo check 验修后**

```bash
cargo check --target aarch64-apple-darwin --manifest-path /Users/coderstory/CodeSource/winui3/src-tauri/Cargo.toml 2>&1 | grep -E "^(error|warning: unused)" | head -10
```

Expected: 0 error（可能有 warning，不阻塞）

- [ ] **Step 5: 报告主 session 1 行 diff 摘要**

格式：`[Task 1] MacAppMenu::build_app_menu (file:line) - .about() 0 args → .about(Some(AboutMetadata::default())) - cargo check 0 error`

**Subagent 不 commit**，等主 session 审 + commit。

---

## Task 2: 跑完整 cargo check 找剩余错

**Files:**
- Modify: 任何 cargo check 暴露的 .rs 文件

**Interfaces:**
- Consumes: Tauri 2.11.3 / window-vibrancy 0.6.0 / dirs 5
- Produces: `cargo check --target aarch64-apple-darwin` 0 error

- [ ] **Step 1: 跑 cargo check 看剩余错**

```bash
cargo check --target aarch64-apple-darwin --manifest-path /Users/coderstory/CodeSource/winui3/src-tauri/Cargo.toml 2>&1 | grep -E "^error" | head -20
```

Expected: 可能 0 错（Task 1 已全修）/ 或 N 个新错

- [ ] **Step 2: 若 0 错，跳到 Task 3**

- [ ] **Step 3: 若 N 个错，对每个错跑子任务循环**

子任务模板（每个错 1 个）：
1. 读错信息定位 file:line
2. 读 git blame 找引入 commit（如 `git blame -L <line>,+1 <file>`）
3. 读 Tauri 2.11.3 源码（`~/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tauri-2.11.3/src/menu/mod.rs`）找正确 API
4. 改代码（最简：加缺参数 / 改返回类型 / 删未用 import）
5. 跑 `cargo check` 验
6. 报告主 session 1 行 diff 摘要

**禁止**：
- ❌ 升级 Tauri（§2.3 版本锁）
- ❌ 改业务逻辑
- ❌ 批量改（每错单独 commit）

---

## Task 3: 跑 build-mac.sh 产 .app

**Files:**
- N/A（只跑脚本，不改文件）

**Interfaces:**
- Consumes: `scripts/build-mac.sh`（已存在）
- Produces: `src-tauri/target/debug/bundle/macos/ClaudeConfigManager.app`

- [ ] **Step 1: 跑 build-mac.sh debug 模式**

```bash
cd /Users/coderstory/CodeSource/winui3 && ./scripts/build-mac.sh --debug 2>&1 | tail -30
```

Expected: 产出 `.app` 路径，exit code 0

- [ ] **Step 2: 验证 .app 存在**

```bash
ls -la /Users/coderstory/CodeSource/winui3/src-tauri/target/debug/bundle/macos/ClaudeConfigManager.app 2>&1 | head -3
```

Expected: `.app` 存在，size > 1MB

- [ ] **Step 3: 报告主 session build 结果**

格式：`[Task 3] build-mac.sh --debug → .app <size>MB @ <path> - exit 0`

---

## Task 4: 启动 .app 验进程在

**Files:**
- N/A（只跑命令）

**Interfaces:**
- Consumes: 产出的 `.app`
- Produces: `pgrep` 命中 + 启动日志无 panic

- [ ] **Step 1: 启动 .app**

```bash
open /Users/coderstory/CodeSource/winui3/src-tauri/target/debug/bundle/macos/ClaudeConfigManager.app 2>&1
```

Expected: 启动成功（exit 0，可能无 stdout）

- [ ] **Step 2: 等 5 秒**

```bash
sleep 5
```

- [ ] **Step 3: pgrep 验进程在**

```bash
pgrep -f ClaudeConfigManager
```

Expected: 返回 1+ 行 PID（如 `12345`）

- [ ] **Step 4: 再 pgrep 验 5 秒后仍在**

```bash
sleep 1 && pgrep -f ClaudeConfigManager
```

Expected: 返回 1+ 行 PID（与上一步同）

- [ ] **Step 5: 读启动日志验无 panic**

```bash
grep -E "panicked at|thread 'main' panicked" ~/Library/Logs/ClaudeConfigManager/*.log 2>/dev/null | head -5 || echo "NO_PANIC"
```

Expected: `NO_PANIC`（macOS log 路径可能不存在，看实际）

- [ ] **Step 6: 关掉 app**

```bash
pkill -f ClaudeConfigManager
```

- [ ] **Step 7: 报告主 session 启动结果**

格式：`[Task 4] .app 启动 5 秒后 pgrep 命中 <PID>, 5 秒后再命中 <PID>, 日志无 panic`

---

## Self-Review

1. **Spec 覆盖**：spec 1 4 项目标（cargo check / build-mac.sh / pgrep / 5 秒仍在 / 日志无 panic）→ Task 1-4 全部覆盖 ✅
2. **占位符扫描**：无 TBD/TODO/`???` ✅
3. **类型一致**：`AboutMetadata` (Task 1) 与 `tauri::menu::AboutMetadata` (Tauri 2.11.3 源码) 一致 ✅
4. **subagent 不 commit**：每 Step 5/7 明确"Subagent 不 commit，等主 session" ✅

---

*Plan 由 writing-plans skill 生成（2026-06-24）。实施前需 subagent 阅读 CLAUDE.md §11（派遣纪律）+ §14.1（行为禁区）。*
