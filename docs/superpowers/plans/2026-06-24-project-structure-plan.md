# 项目结构文档追加 (ARCHITECTURE.md 4 章) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `docs/ARCHITECTURE.md` 末尾追加 4 章（§13-16）— 启动流程/编译选项/模块拓扑/常见任务速查

**Architecture:** Append-only，不动现有 520 行。1 个 atomic commit。

**Tech Stack:** Markdown

## Global Constraints

- Append-only：不动 ARCHITECTURE.md 现有 520 行
- 不重写 / 不重组 / 不删现有章节
- 不引入新文件（4 章追加到现有 ARCHITECTURE.md）
- Subagent 不 commit（CLAUDE.md §14.1）

---

## Task 1: 读 ARCHITECTURE.md 末尾 + 定位 append 位置

**Files:**
- Read: `docs/ARCHITECTURE.md` (only last 20 lines)

**Interfaces:**
- Consumes: 现有 ARCHITECTURE.md
- Produces: 明确的 append 起点（行号）

- [ ] **Step 1: 读末尾 20 行**

```bash
tail -20 /Users/coderstory/CodeSource/winui3/docs/ARCHITECTURE.md
```

Expected: 看到最后一章内容 + 文档结尾空行

- [ ] **Step 2: 定位 append 位置**

- 如果末尾有 `---` 分隔符，在 `---` 之后追加（保留原 `---` 作为章 12 结束）
- 如果末尾直接是文本，直接追加（保留最后 1 个空行）

- [ ] **Step 3: 报告 append 起点行号**

格式：`[Task 1] ARCHITECTURE.md 末尾 20 行已读，append 起点 = 第 N 行 (原文 <preview>)`

---

## Task 2: 追加 §13 启动流程

**Files:**
- Modify: `docs/ARCHITECTURE.md` (append §13)

**Interfaces:**
- Consumes: Task 1 定位的 append 起点
- Produces: §13 启动流程章节

- [ ] **Step 1: 写 §13 内容**

```markdown


## 13. 启动流程 (从 git clone 到 .app 跑通)

> 跨平台通用 5 步。具体 macOS 步骤 + 调试工具见 `docs/DEBUG-MAC.md` 第 1 章。

### 13.1 5 步速通

```bash
# 1. 装系统级依赖
# - Node 22 LTS (nvm)
# - Rust stable (rustup)
# - 平台工具链 (macOS: xcode-select --install / Windows: WebView2 + MSVC)

# 2. clone + 装 npm 依赖
git clone <repo>
cd claude-config-manager
npm ci

# 3. 编译前端
npm run build

# 4. 编译 + bundle 应用
# - macOS:  ./scripts/build-mac.sh [--debug]
# - Windows: ./scripts/build-and-ship.sh --milestone M1 --task 1.1 --slug scaffold
# - 通用:    cargo tauri build [--debug] [--no-bundle]

# 5. 启动
# - macOS:   open src-tauri/target/<debug|release>/bundle/macos/ClaudeManager.app
# - Windows: src-tauri/target/release/claude-config-manager.exe
```

### 13.2 验证跑通

- 进程在 5 秒内运行：`pgrep -f <app-name>` (mac) / `Get-Process` (Windows)
- 启动日志无 panic：见 `docs/DEBUG-MAC.md` §Q2 / `docs/investigations/m1.1-launch.md` (Windows)
- 主窗口出现 + WebView2/WKWebView 加载前端
```

- [ ] **Step 2: 用 `cat >>` 追加（保留最后 1 个空行）**

```bash
cat >> /Users/coderstory/CodeSource/winui3/docs/ARCHITECTURE.md << 'EOF'

[上面 §13 内容]
EOF
```

- [ ] **Step 3: 验证追加位置 + 行数**

```bash
grep -n "^## 13\." /Users/coderstory/CodeSource/winui3/docs/ARCHITECTURE.md
wc -l /Users/coderstory/CodeSource/winui3/docs/ARCHITECTURE.md
```

Expected: 看到 `## 13. 启动流程 (...)` 标题 + 总行数 ~520 + §13 行数

- [ ] **Step 4: 报告主 session**

格式：`[Task 2] ARCHITECTURE.md §13 启动流程追加完 - 跨平台 5 步 + 验证 - 总行数 N`

---

## Task 3: 追加 §14 编译选项

**Files:**
- Modify: `docs/ARCHITECTURE.md` (append §14)

**Interfaces:**
- Consumes: Task 2 已加 §13
- Produces: §14 编译选项章节

- [ ] **Step 1: 写 §14 内容**

```markdown


## 14. 编译选项 (cargo tauri build 常用 flag)

> 详细 macOS 编译选项 + 性能调优见 `docs/DEBUG-MAC.md` 第 2 章 + CLAUDE.md §12。

| Flag | 用途 |
|---|---|
| `--debug` | 编译 debug 变体（含调试信息） |
| `--no-bundle` | 只 cargo build，不 bundle（快） |
| `--bundles app` | 只产 .app（不产 .dmg） |
| `--bundles app,dmg` | .app + .dmg |
| `--target aarch64-apple-darwin` | Apple Silicon |
| `--target x86_64-apple-darwin` | Intel |
| `--target x86_64-pc-windows-msvc` | Windows x64 |
```

- [ ] **Step 2: 用 `cat >>` 追加**

```bash
cat >> /Users/coderstory/CodeSource/winui3/docs/ARCHITECTURE.md << 'EOF'

[上面 §14 内容]
EOF
```

- [ ] **Step 3: 验证追加**

```bash
grep -n "^## 14\." /Users/coderstory/CodeSource/winui3/docs/ARCHITECTURE.md
```

Expected: 看到 `## 14. 编译选项 (...)` 标题

- [ ] **Step 4: 报告主 session**

格式：`[Task 3] ARCHITECTURE.md §14 编译选项追加完 - 7 flag 表 - 详细指向 DEBUG-MAC.md`

---

## Task 4: 追加 §15 模块拓扑

**Files:**
- Modify: `docs/ARCHITECTURE.md` (append §15)

**Interfaces:**
- Consumes: Task 3 已加 §14
- Produces: §15 模块拓扑章节

- [ ] **Step 1: 写 §15 内容**

```markdown


## 15. 模块拓扑 (1 段精简)

> 详细 src-tauri 目录树 + 8 trait 表见 `docs/DEBUG-MAC.md` 第 3 章。

```
src-tauri/
├── main.rs / lib.rs       # 入口 / Tauri builder
├── commands/              # Tauri IPC commands (前端 invoke)
├── domain/                # 业务模型 (Provider / McpServer / ...)
├── services/              # 业务逻辑
├── infrastructure/        # 文件 IO / HTTP / git / sqlite
├── platform/              # OS 抽象层 (traits + windows + macos)
└── plugins/               # 插件系统 (M1.x 12 stub, M2+ 实装)
```

业务代码只调 `platform/traits.rs` 定义的 trait，**不**直接 `#[cfg(target_os = "...")]`（CLAUDE.md §3.2）。
```

- [ ] **Step 2: 用 `cat >>` 追加**

```bash
cat >> /Users/coderstory/CodeSource/winui3/docs/ARCHITECTURE.md << 'EOF'

[上面 §15 内容]
EOF
```

- [ ] **Step 3: 验证追加**

```bash
grep -n "^## 15\." /Users/coderstory/CodeSource/winui3/docs/ARCHITECTURE.md
```

Expected: 看到 `## 15. 模块拓扑 (...)` 标题

- [ ] **Step 4: 报告主 session**

格式：`[Task 4] ARCHITECTURE.md §15 模块拓扑追加完 - 1 段精简 - 详细指向 DEBUG-MAC.md`

---

## Task 5: 追加 §16 常见任务速查

**Files:**
- Modify: `docs/ARCHITECTURE.md` (append §16)

**Interfaces:**
- Consumes: Task 4 已加 §15
- Produces: §16 常见任务速查章节

- [ ] **Step 1: 写 §16 内容（10 FAQ, 跨平台，不重复 DEBUG-MAC.md）**

```markdown


## 16. 常见任务速查 (10 FAQ, 跨平台)

> macOS 专属 FAQ 见 `docs/DEBUG-MAC.md` 第 4 章。

### Q1: 如何开 dev mode (Vite HMR + Tauri auto-rebuild)?
`npm run tauri dev` — dev server + Tauri dev build，HMR 实时预览。**不** ship。

### Q2: 如何清 app 缓存?
- macOS: `rm -rf ~/Library/Application\ Support/ClaudeConfigManager`
- Windows: `Remove-Item -Recurse $env:APPDATA\ClaudeConfigManager`
- 下次启动会重建。

### Q3: tauri::generate_context!() panic 怎么办?
通常是 `dist/` 缺失或过期。跑 `npm run build` 重生 dist。

### Q4: 编译报 "method takes N argument but M supplied"?
Tauri API 改了。看 `.cargo/registry/src/.../tauri-<version>/` 源码 + 官方 changelog。**不**降级 Tauri（CLAUDE.md §2.3）。

### Q5: 如何加新 plugin?
M1.x 阶段所有 plugin 写 stub。建 `src-tauri/src/plugins/<id>/`，在 `plugins/mod.rs` 注册。

### Q6: 如何加新 page?
- 前端: `src/pages/<id>/index.tsx` + 在 `App.tsx` router 注册
- 后端: `src-tauri/src/commands/<id>.rs` 注册到 `lib.rs::invoke_handler`

### Q7: 测试在哪个目录?
- Rust 单元: 同文件 `#[cfg(test)] mod tests`
- Rust 集成: `src-tauri/tests/`
- TS 单元: `src/__tests__/`
- E2E: `tests/e2e/`

### Q8: 如何看前端 console.log?
- Dev: 右键 → Inspect Element (默认开 devtools)
- Release: 需临时开 `window.__TAURI_INTERNALS__.invoke('tauri::open_devtools')`

### Q9: 如何 dev 注册 deep-link (ccswitch://)?
- Windows: 注册表自动 (dev 模式)
- macOS: dev 模式需手动。`tauri plugin` 临时注册。生产 bundle 由 tauri-action 自动写 Info.plist。

### Q10: CI 跑哪几个 job?
- `ci.yml`: test-rust (Win) / test-frontend (Win) / e2e (Win) / test-rust-mac
- `release.yml`: macos-latest (aarch64) + windows-latest (x64) matrix
```

- [ ] **Step 2: 用 `cat >>` 追加**

```bash
cat >> /Users/coderstory/CodeSource/winui3/docs/ARCHITECTURE.md << 'EOF'

[上面 §16 内容]
EOF
```

- [ ] **Step 3: 验证追加**

```bash
grep -n "^## 16\." /Users/coderstory/CodeSource/winui3/docs/ARCHITECTURE.md
grep -c "^### Q" /Users/coderstory/CodeSource/winui3/docs/ARCHITECTURE.md
```

Expected: 看到 `## 16. 常见任务速查` + `10`（10 FAQ）

- [ ] **Step 4: 报告主 session**

格式：`[Task 5] ARCHITECTURE.md §16 常见任务速查追加完 - 10 FAQ 跨平台 - 不重复 DEBUG-MAC.md`

---

## Task 6: 验证 append-only (现有 520 行 0 改动)

**Files:**
- N/A

**Interfaces:**
- Consumes: 完整 ARCHITECTURE.md
- Produces: 验证现有 0-520 行 0 改动

- [ ] **Step 1: 对比现有 12 章行数**

```bash
git show HEAD:docs/ARCHITECTURE.md | grep -c "^## " 
grep -c "^## " /Users/coderstory/CodeSource/winui3/docs/ARCHITECTURE.md
```

Expected: HEAD = 12 (现有 12 章) → 工作区 = 16 (12 + 4)

- [ ] **Step 2: 验证前 12 章内容未改**

```bash
git diff docs/ARCHITECTURE.md | head -20
```

Expected: diff 只显示 4 个 `+## 13.` / `+## 14.` / `+## 15.` / `+## 16.` 章节追加，无 `-` 行

- [ ] **Step 3: 总行数 + 报告**

```bash
wc -l /Users/coderstory/CodeSource/winui3/docs/ARCHITECTURE.md
```

Expected: 总行数 ~520 + §13-16 总行数

格式：`[Task 6] 验证 append-only: HEAD 12 章 → 工作区 16 章, diff 仅 + 行, 总 N 行`

---

## Self-Review

1. **Spec 覆盖**：spec 3 4 项目标（启动/编译/拓扑/FAQ）→ Task 2-5 全部覆盖 ✅
2. **占位符扫描**：无 TBD/TODO/`???` ✅
3. **Append-only**：Task 6 显式验证现有 520 行 0 改动 ✅
4. **不重复 DEBUG-MAC.md**：4 章分工明确（spec §3.2）✅
5. **不引入新文件**：追加到现有 ARCHITECTURE.md ✅

---

*Plan 由 writing-plans skill 生成（2026-06-24）。subagent 必读 CLAUDE.md §14.1。*
