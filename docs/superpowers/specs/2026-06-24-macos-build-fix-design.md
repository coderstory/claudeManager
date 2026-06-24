# macOS 编译错修复 (Tauri 2.11.3 API 升级) — Design

> **日期**：2026-06-24
> **范围**：修 macOS 编译错直到 `cargo check --target aarch64-apple-darwin` 全过 + `scripts/build-mac.sh --debug` 产 .app
> **根因**：commit `c074187` (M2.16-mac-fix MacAppMenu) 写代码时 Tauri 版本未强制 1 参数；现 Tauri 2.11.3 升级后 `SubmenuBuilder::about()` 强制要 `Option<AboutMetadata>` 参数
> **不做**：升级 Tauri / 改业务逻辑 / 修 P0 启动崩溃（已修，commit `0d3de69`）/ 真机 GUI 验菜单栏（subagent 不验 GUI）

---

## 1. 目标 (Why)

`cargo check --target aarch64-apple-darwin` 当前 fail（1 个 `E0061`，但修这个错后会暴露其他错）。**目标**：
- ❌ → ✅ `cargo check --target aarch64-apple-darwin` 0 error
- ❌ → ✅ `scripts/build-mac.sh --debug` 产出可启动的 `.app`
- ❌ → ✅ `pgrep -f ClaudeConfigManager` 启动后 5 秒内命中

## 2. 范围 (What)

### 2.1 修复清单 (动态，按 cargo check 暴露)

**第 1 个错（已知）**：
- `src-tauri/src/platform/macos/app_menu.rs:54` `.about()` 缺参数 → 改 `.about(Some(AboutMetadata::default()))`

**后续错（未知）**：
- MacWindowChrome stub 等
- 其他 platform trait 缺
- 任何 `cargo check` 暴露的错

### 2.2 不在范围

- ❌ 不升级 Tauri（CLAUDE.md §2.3 版本锁）
- ❌ 不改业务逻辑
- ❌ 不修 P0 启动崩溃（已修，commit `0d3de69`）
- ❌ 不验 GUI（spec 2 调试组件范围）

## 3. 架构 (How)

### 3.1 TDD 流程（每错 1 循环）

1. **Red**：跑 `cargo check --target aarch64-apple-darwin` 看首个错
2. **定位**：从错信息读 `file:line`，搜 git blame 找引入 commit
3. **Green**：照 Tauri 2.11.3 API 改代码（最简：加缺参数 / 改返回类型）
4. **验证**：`cargo check --target aarch64-apple-darwin` 重跑
5. **循环**到 `cargo check --target aarch64-apple-darwin` 0 error
6. **最终验收**：`scripts/build-mac.sh --debug` + `open .app` + 5 秒后 `pgrep -f ClaudeConfigManager` 命中

### 3.2 第 1 个错目标代码

**文件**：`src-tauri/src/platform/macos/app_menu.rs`

**改前**：
```rust
let app_menu = SubmenuBuilder::new(&self.app, "App")
    .about()
    .separator()
    ...
```

**改后**：
```rust
use tauri::menu::{AboutMetadata, MenuBuilder, SubmenuBuilder};

let about_meta = AboutMetadata::default();
let app_menu = SubmenuBuilder::new(&self.app, "App")
    .about(Some(about_meta))
    .separator()
    ...
```

### 3.3 后续错处理原则

- 读 Tauri 2.11.3 源码（`/Users/coderstory/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tauri-2.11.3/`）找正确 API 签名
- 每个错一个 atomic commit（per CLAUDE.md §9.1）
- subagent 报告每错 1 行摘要（file:line + 改前/改后 + 测试方法）

## 4. 验收

- ✅ `cargo check --target aarch64-apple-darwin` 0 error
- ✅ `scripts/build-mac.sh --debug` 产出 `.app` 到 `src-tauri/target/debug/bundle/macos/ClaudeConfigManager.app`
- ✅ `open .app` 后 5 秒内 `pgrep -f ClaudeConfigManager` 命中
- ✅ 启动日志（`~/Library/Logs/ClaudeConfigManager/*.log`）无 `panicked at` 关键字
- 失败回退：`git revert <commit>` 恢复

## 5. 风险

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| 后续错比想象多（10+ 个）| 中 | spec 1 超出 1.5h 估时 | 标 P0-1/2/3.. 顺序修，不批量 |
| MacWindowChrome stub 修需 NSWindow API | 中 | 修到 macOS 专属代码，需 Xcode 知识 | 读 Tauri 文档 + window-vibrancy 0.6.0 源码 |
| `git blame` 找不到原 commit（多人改）| 低 | 错定位难 | 直接读 cargo check 报的行上下文 |
| Tauri 2.11.3 API 与代码假设差异大 | 低 | 需大改 | 接受降级到 stable API（Default impl）|

## 6. 实施 + 节奏

1. **写 PLAN**：writing-plans skill 写 PLAN.md
2. **Subagent 跑**：循环 cargo check → 修错 → 再 cargo check
3. **Subagent 不 commit**（CLAUDE.md §14.1），每个错报告 1 行 diff 给主 session
4. **主 session commit**：审 diff + 1 个错 1 commit（或每 N 个错 1 commit，看进度）
5. **最终验收**：主 session 跑 `scripts/build-mac.sh --debug` + pgrep 验

## 7. 跨文档引用

- 真机环境：CLAUDE.md §15.1 / §15.2
- build 脚本：`scripts/build-mac.sh`（已存在）
- 版本锁精神：CLAUDE.md §2.3
- Tauri 2.11.3 源码：`/Users/coderstory/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tauri-2.11.3/`

---

*本 spec 由 brainstorming skill 生成（2026-06-24）。3-spec 序列：spec 1（本 doc）→ spec 2（调试 + entitlements）→ spec 3（项目结构文档）。*
