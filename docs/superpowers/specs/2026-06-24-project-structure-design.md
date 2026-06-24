# 项目结构 + 启动 + 编译 + 速查 — Design (spec 3)

> **日期**：2026-06-24
> **范围**：在 `docs/ARCHITECTURE.md` 追加 4 章
> **不做**：重写 ARCHITECTURE.md / 改 CLAUDE.md / 改任何代码

---

## 1. 目标 (Why)

新人 onboarding 看 `docs/ARCHITECTURE.md`（520 行）能懂架构，但**找不到**：
- 从 git clone 到 .app 跑通的全流程
- cargo tauri build 5 个常用 flag
- 10 个常见任务的速查（如何开 dev mode / 如何看日志 / 如何清缓存）

追加 4 章补齐。

## 2. 范围 (What)

**追加** 到 `docs/ARCHITECTURE.md` 末尾（不动现有 520 行）：

| 章 | 标题 | 内容 |
|---|---|---|
| 13 | 启动流程 | git clone → .app 跑通的全流程 |
| 14 | 编译选项 | cargo tauri build 5 个常用 flag + 常用组合 |
| 15 | 模块拓扑 | 已有 §0 概览 + 8 trait 速查表 |
| 16 | 常见任务速查 | 10 FAQ |

## 3. 架构 (How)

### 3.1 追加位置

`docs/ARCHITECTURE.md` 末尾追加 4 章，章号接现有 12 章之后（13-16）。`#` 一级标题沿用现有风格。

### 3.2 4 章内容（与 spec 2 docs/DEBUG-MAC.md 区别）

**关键问题**：spec 2 写了 `docs/DEBUG-MAC.md`（183 行，4 章），与本 spec 要写 ARCHITECTURE.md 4 章**内容重叠**。

**决策**：
- `docs/DEBUG-MAC.md`：macOS 专属调试工具的使用手册（脚本怎么跑、lldb 怎么用、log 怎么看）
- `docs/ARCHITECTURE.md` 追加 4 章：跨平台项目结构 + 启动 + 编译 + FAQ（DEBUG-MAC.md 是其中 macOS 部分的"延伸"）

**避免重复**：
- 启动流程在 ARCHITECTURE.md 只写**跨平台通用 5 步**（clone → npm ci → npm run build → tauri build → open），具体 macOS 步骤不重复
- 编译选项**只列 flag 表 + 1 行说明**，不写详细用法（详细在 DEBUG-MAC.md 第 2 章）
- 模块拓扑在 ARCHITECTURE.md **精简到 1 段**（OS 抽象层 8 trait），详细见 DEBUG-MAC.md 第 3 章
- FAQ 选 10 个**跨平台常见问题**，不重复 DEBUG-MAC.md 的 macOS 专属 Q

## 4. 验收

- ✅ `docs/ARCHITECTURE.md` 末尾追加 4 章（13-16）
- ✅ 现有 520 行 0 改动（git diff 显示 only append）
- ✅ 4 章内容与 DEBUG-MAC.md 不重复（启动/编译/拓扑/FAQ 4 个 topic 各有侧重）
- ✅ 1 个 atomic commit，commit message 说明 spec 3

## 5. 风险

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| 与 DEBUG-MAC.md 内容重复 | 高 | 文档冗余 | spec 3 §3.2 明确分工 |
| ARCHITECTURE.md 改大引起主 session 二次审 | 中 | commit 慢 | subagent 只 append，不动现有行 |
| 章号与未来 §17+ 冲突 | 低 | 文档结构乱 | 文档末尾注"§13-16 2026-06-24 追加" |

## 6. 实施 + 节奏

1. **写 PLAN**：writing-plans skill 写 PLAN.md
2. **Subagent 跑**：append 4 章到 ARCHITECTURE.md
3. **Subagent 不 commit**（CLAUDE.md §14.1）
4. **主 session 审 + commit**

## 7. 跨文档引用

- ARCHITECTURE.md 现有 12 章
- DEBUG-MAC.md（本 spec 2 新增）— 与本 spec 4 章分工
- CLAUDE.md §1 项目背景 + §2 工程纪律 + §3 架构原则

---

*本 spec 由 brainstorming skill 生成（2026-06-24）。spec 3/3 序列末位。*
