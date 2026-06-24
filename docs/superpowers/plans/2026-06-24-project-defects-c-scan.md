# Project Defects C-Scan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 全量盘点 Claude Config Manager 项目的 6 维度（跨平台架构 / 代码质量 / 工程流程 / 产品UX / 测试覆盖 / 文档管理）缺陷与不足，产出主报告 + 6 份子报告。

**Architecture:** Wave 0 解 conflict → Wave 1 派 6 个 subagent 并行扫描各维度（4 槽并发，分 2 批）→ Wave 2 派 1 个 subagent 汇总主报告 → Wave 3 主 session 自审。每个 Wave 输出独立 markdown 文件，可单独 review / commit。

**Tech Stack:** Tauri v2 + React 19 + TypeScript 5 + Rust + Markdown（报告）

---

## Global Constraints

CLAUDE.md 项目纪律（每个 task 必须遵守）:

- §8: subagent 禁止 WebFetch / WebSearch / curl 联网
- §11.2: 主 session 最多同时 4 个 subagent 槽
- §11.3: 流式派单（不等齐所有 subagent 完成才重新分配）
- §11.4: 派单前检查任务边界 / subagent 类型 / 上下文完整性
- §11.7: 同一问题 3 次失败必须暂停复盘（不派第 4 次）
- §14.1: subagent 禁止 commit / push / tag / 改全局配置（commit 由主 session 自己执行）
- §6.4: UI 文案改动需 3 处同步（本任务不涉及代码，无此风险）
- §2.4: 谨慎修改文件，影响 >2 文件改动需白名单

本任务专项约束（来自 design doc + 用户决策）:

- ❌ **不修改任何代码**（仅产出 markdown 报告 + Wave 0 解 conflict 必要的冲突解决）
- ❌ 不派生修改 `package.json` / `Cargo.toml` / `Cargo.lock` / `package-lock.json` 的 subagent
- ❌ 不跑 ship/build/kill-app 类脚本
- ✅ subagent 允许：tsc --noEmit / eslint / cargo clippy / cargo check / grep / npm test -- --run (只读) / 读文件
- ✅ 引用既有 6 份 audit 资产（`tmp/audit-{deps,docs,frontend,rust,scripts}.md` + `tmp/tailwind-audit.md`），不重复造轮
- ✅ 严格 5-10 条/维度，详细分析仅前 3 条 + 简要列举后续
- ✅ 主报告 ≤30 页，子报告 ≤30-50 页

---

## File Structure

**新建文件**（本 plan + Wave 1/2 输出）:
```
docs/superpowers/plans/2026-06-24-project-defects-c-scan.md   ← 本 plan

docs/superpowers/specs/defects-analysis/                       ← Wave 1 subagent 输出
├── A-platform-architecture/REPORT.md
├── B-code-quality/REPORT.md
├── C-engineering-process/REPORT.md                            ← 含 v3.0 ship 阻塞
├── D-product-ux/REPORT.md
├── E-test-coverage/REPORT.md
└── F-documentation-knowledge/REPORT.md

docs/superpowers/specs/2026-06-24-project-defects-analysis.md   ← Wave 2 主报告（≤30 页）
```

**修改文件**（仅 Wave 0 解 conflict 涉及，4 文件）:
```
src/__tests__/pages/home.test.tsx                              (M4.6 WIP merge conflict)
src/__tests__/pages/json-editor.test.tsx                       (M4.6 WIP merge conflict)
src/pages/json-editor/index.tsx                                (M4.6 WIP merge conflict)
src/pages/backup-restore/index.tsx                             (M4.6 WIP merge conflict)
```

**不修改**：所有源代码 / 测试代码（除 Wave 0 conflict 4 文件）/ 配置文件 / lockfile。

---

## Task 1: Wave 0 — 解 4 文件 git merge conflict (前置依赖)

**Files:**
- Modify: `src/__tests__/pages/home.test.tsx` (解 M4.6 WIP conflict)
- Modify: `src/__tests__/pages/json-editor.test.tsx` (解 M4.6 WIP conflict)
- Modify: `src/pages/json-editor/index.tsx` (解 M4.6 WIP conflict)
- Modify: `src/pages/backup-restore/index.tsx` (解 M4.6 WIP conflict)
- Read-only verify: `package.json` / `vite.config.ts` / `tsconfig.json` / `vitest.config.ts`

**Interfaces:**
- Consumes: 当前 git 工作区状态 (4 文件带 `<<<<<<< Updated upstream` 标记)
- Produces: 4 文件解 conflict 后的干净状态 + `tsc --noEmit` 通过 + `npm test -- --run` 通过（18 pre-existing failures 不增加）

**Subagent type:** general-purpose (1 subagent)

**Task rationale:**
v3.0 ship 阻塞根因。Wave 1 扫描需要 tsc + npm test 通过才能拿到真实代码证据，否则跳过大量文件导致覆盖率不足。design doc 决策 3.2 = Wave 0 先解 conflict。

- [ ] **Step 1: 检查 conflict 状态**

Run: `cd /Users/coderstory/CodeSource/winui3 && git status --short`
Expected: 4 文件标记为 `UU` 或 `AA`（both modified）

- [ ] **Step 2: 检查冲突侧内容**

Run:
```bash
cd /Users/coderstory/CodeSource/winui3
for f in src/__tests__/pages/home.test.tsx src/__tests__/pages/json-editor.test.tsx src/pages/json-editor/index.tsx src/pages/backup-restore/index.tsx; do
  echo "=== $f ==="
  grep -nE "<<<<<<<|=======|>>>>>>>" "$f" | head -20
done
```

Expected: 每文件都有 `<<<<<<< Updated upstream` / `=======` / `>>>>>>> Stashed changes` 三段。

- [ ] **Step 3: 派 subagent 解 conflict (派单 prompt 见下方)**

派 1 个 general-purpose subagent，prompt 严格按下方模板。

**派单 prompt 模板（Wave 0）:**
```
任务: 解 4 文件 git merge conflict (v3.0 ship 阻塞)

文件清单 (4 文件):
- src/__tests__/pages/home.test.tsx
- src/__tests__/pages/json-editor.test.tsx
- src/pages/json-editor/index.tsx
- src/pages/backup-restore/index.tsx

决策规则:
1. 默认选 Upstream 侧 (即保留 M4.6 WIP 之外的最后干净版本)
2. 若 Stashed 侧含明显 WIP 重要改动 (新增测试用例 / 新功能), 改为 manual merge 保留两侧合理内容
3. 完成后必须保留一个完整版本, 不允许仍带 conflict marker

工具: ✅ git status / git diff / git log / grep / Read / Edit
     ✅ tsc --noEmit (验证)
     ✅ npm test -- --run (验证)
     ❌ 任何 ship/build/kill-app 脚本
     ❌ WebFetch / WebSearch 联网

约束 (CLAUDE.md §14.1):
- ❌ 不 commit / push / tag / 改全局配置
- ❌ 不派生 subagent
- ✅ 只修改这 4 个文件, 其他文件不动

验证 (必须全过才能报告完成):
1. tsc --noEmit 退出码 0
2. npm test -- --run 通过, 失败数 ≤ 18 (pre-existing baseline)
3. grep -E "<<<<<<<|=======|>>>>>>>" 上述 4 文件 输出为空

输出: 回报到主 session, 含:
- 选了哪一侧 (Upstream / manual merge)
- 每个文件改了什么 (diff stat)
- tsc + npm test 完整输出最后 30 行
- 若失败: 失败文件 + 失败原因 + 已尝试的修复
```

- [ ] **Step 4: 接收 subagent 完成通知 + 验证**

主 session 接收完成通知后, 自行跑验证命令:
```bash
cd /Users/coderstory/CodeSource/winui3
npx tsc --noEmit
echo "---"
npm test -- --run 2>&1 | tail -30
echo "---"
git status --short
```

Expected:
- tsc 退出码 0
- npm test 失败数 ≤ 18
- git status 4 文件显示为 `M` (modified) 无 `UU`

- [ ] **Step 5: 失败处理 (§11.7 三次失败规则)**

若 subagent 失败:
- 第 1 次失败: 重派, 在 prompt 加 "上次失败原因: <X>, 重点验证 <Y>"
- 第 2 次失败: 重派, 改为 manual merge 模式, 强调两侧都保留
- 第 3 次失败: **暂停**, 进入复盘:
  1. 收集 3 次失败日志
  2. 列候选根因 (≥3 个)
  3. 写暂停复盘报告到 `tmp/issue-retro-2026-06-24-wave0-conflict.md`
  4. AskUserQuestion 决定: 换方案 / 用户介入 / 回滚

- [ ] **Step 6: Commit (主 session 执行, §14.1)**

```bash
cd /Users/coderstory/CodeSource/winui3
git add src/__tests__/pages/home.test.tsx src/__tests__/pages/json-editor.test.tsx src/pages/json-editor/index.tsx src/pages/backup-restore/index.tsx
git commit -m "fix(v3.0): resolve 4 file merge conflict (M4.6 WIP, Upstream side)

- Wave 0 of project defects C-scan
- 选 Upstream 侧 (M4.6 WIP 之外的最后干净版本)
- 验证: tsc --noEmit 通过 + npm test 失败数 ≤18 pre-existing baseline
- 解锁 v3.0 ship 阻塞

Refs: docs/superpowers/specs/2026-06-24-project-defects-analysis-design.md §4.1

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

**Task 1 验收标准:**
- 4 文件 conflict marker 全部清除
- `tsc --noEmit` 退出码 0
- `npm test -- --run` 失败数 ≤ 18
- 1 个 atomic commit
- 主 session 派单不超过 3 次 (§11.7)

---

## Task 2: Wave 1 批 1 — 派 4 subagent 并行扫描 A/B/C/D 维度

**Files:**
- Create: `docs/superpowers/specs/defects-analysis/A-platform-architecture/REPORT.md`
- Create: `docs/superpowers/specs/defects-analysis/B-code-quality/REPORT.md`
- Create: `docs/superpowers/specs/defects-analysis/C-engineering-process/REPORT.md`
- Create: `docs/superpowers/specs/defects-analysis/D-product-ux/REPORT.md`
- Read-only: 既有 6 份 audit (`tmp/audit-{deps,docs,frontend,rust,scripts}.md` + `tmp/tailwind-audit.md`)

**Interfaces:**
- Consumes: Task 1 解 conflict 后的干净工作区
- Produces: 4 份子报告，每份 ≤30-50 页，严格按 design doc §2.2 模板

**Subagent type:** general-purpose (4 subagent 并行, 4 槽全占)

**Task rationale:**
设计决策 3.1 = 主+6 子报告结构。Wave 1 批 1 = 前 4 个维度 (A/B/C/D)，每个 subagent 独立扫描独立输出，避免相互阻塞。**流式接收**（§11.3）—— 哪个先完成哪个先 review。

### 维度 A: 跨平台架构

- [ ] **Step 1: 派维度 A subagent**

**派单 prompt 模板（维度 A）:**
```
任务: 跨平台架构缺陷深扫 (维度 A)

扫描范围:
- src-tauri/src/platform/ (traits.rs + windows/ + macos/)
- src-tauri/Cargo.toml + Cargo.lock
- src-tauri/tauri.conf.json
- scripts/ (全部 .sh / .py / .cjs)
- src-tauri/ClaudeConfigManager.entitlements

复用资产 (必读, 不重复造轮):
- tmp/audit-deps.md (跨平台依赖)
- tmp/audit-rust.md (Rust macOS 兼容性)
- tmp/audit-scripts.md (scripts macOS 兼容性, 34 处不兼容点)
- tmp/audit-frontend.md (前端 + 构建链 macOS)
- CLAUDE.md §3.2 (OS 抽象层纪律) + §13.2 (跨平台 build 陷阱) + §15 (macOS 约束)

工具: ✅ tsc --noEmit / eslint / cargo clippy / cargo check
     ✅ Read / Grep / Glob / Bash (grep/find/wc)
     ✅ 引用既有 audit 资产
     ✅ npm test -- --run / cargo test (只读)
     ❌ ship/build/kill-app 类脚本
     ❌ WebFetch / WebSearch 联网
     ❌ 任何写操作 (Read-Only)

约束 (CLAUDE.md §14.1):
- ❌ 不 commit / push / tag / 改全局配置
- ❌ 不派生 subagent
- ❌ 不修改任何代码

输出: docs/superpowers/specs/defects-analysis/A-platform-architecture/REPORT.md
      (≤30-50 页, 严格按 design doc §2.2 子报告模板)

输出格式:
- 元信息 (维度 ID / 扫描范围 / 扫描方法 / 引用资产 / 扫描时长)
- Top 问题清单 5-10 条 (表格: # / 问题 / file_path:line / 严重度 / 证据 / 修复建议 / 关联)
- 详细分析 (前 3 条展开: 症状 / 证据 / 根因 / 修复建议 / 关联)
- 简要列举 (第 4-10 条, 一行描述)
- 扫描未覆盖 / 已知限制

证据要求: 每条问题必须有 file_path:line + 代码片段, 引用既有 audit 必须标 audit 文件名 + §X

严重度定义:
- CRITICAL: ship 阻塞 / 数据丢失 / 安全漏洞
- HIGH: 跨平台不可用 / 架构违反 §3.2
- MEDIUM: 性能 / 维护性下降
- LOW: 代码风格 / 文档缺失
```

### 维度 B: 代码质量

- [ ] **Step 2: 派维度 B subagent**

**派单 prompt 模板（维度 B）:**
```
任务: 代码质量缺陷深扫 (维度 B)

扫描范围:
- src/ (全量, 跳过 4 个冲突文件 — 已由 Task 1 解 conflict)
- src-tauri/src/ (全量)
- src-tauri/Cargo.toml + src-tauri/tauri.conf.json
- package.json + tsconfig.json + vite.config.ts

复用资产 (必读):
- tmp/audit-frontend.md (前端审计)
- tmp/audit-rust.md (Rust 审计)
- tmp/tailwind-audit.md (Tailwind utility class 死代码 — 9 文件清单)
- CLAUDE.md §2 (工程纪律)

工具: 同维度 A

特别关注:
- TypeScript 严格模式违反 (any / as / @ts-ignore)
- Rust clippy warning (unwrap / expect / panic)
- 未使用的导入 / 未使用的变量 / dead code
- 错误处理不一致 (Result vs panic vs anyhow)
- Tailwind utility class 死代码 (tailwind-audit 已识别 9 文件)
- 命名不一致 / 文件大小超 500 行
- TODO / FIXME / XXX 注释

输出: docs/superpowers/specs/defects-analysis/B-code-quality/REPORT.md
      (≤30-50 页, 严格按 design doc §2.2 子报告模板)
```

### 维度 C: 工程流程 (含 v3.0 ship 阻塞)

- [ ] **Step 3: 派维度 C subagent**

**派单 prompt 模板（维度 C）:**
```
任务: 工程流程缺陷深扫 (维度 C) — 含 v3.0 ship 阻塞分析

扫描范围:
- CLAUDE.md 全部 15 章节
- STATE.md 全部版本 (v3.0 round-1 + round-2 + 当前状态)
- .planning/ (HANDOFF / ROADMAP / STATE / research)
- tmp/white-list-*.md (90+ 文件)
- tmp/retro-2026-06-25-sccache-discipline.md
- tmp/test-failures-*.md + tmp/smoke-failures-*.md
- git log --oneline -100 (近 100 commits)
- docs/superpowers/specs/2026-06-24-project-defects-analysis-design.md (本任务 design)

复用资产 (必读):
- STATE.md (v3.0 round-2 教训段 + ship 阻塞描述)
- tmp/retro-2026-06-25-sccache-discipline.md
- 所有 white-list-*.md (派单纪律白名单历史)

工具:
- ✅ Read / Grep / Glob / Bash (git log / git status / git diff / grep / wc)
- ✅ 引用既有 STATE / retro / white-list 资产
- ❌ 任何修改操作 (Read-Only)
- ❌ ship / build / kill-app / smoke-test 脚本 (本任务不验证, 只盘点流程缺陷)
- ❌ WebFetch / WebSearch 联网

特别关注 (流程缺陷典型症状):
- v3.0 ship 阻塞根因 (4 文件 merge conflict 反复出现)
- §11.7 三次失败规则触发历史 (是否有 subagent 死循环案例)
- §14.1 subagent 禁区违反案例 (sccache subagent 自行 commit 案例 — commit 645680b)
- §11.8 核定未到不派 ship 类 subagent 违反案例 (M3.0.3 → M3.0.3-fix-v2 链)
- §6.4 UI 文案 3 处同步反复失败 (ClaudeConfigManager → ClaudeManager 5 轮)
- base.css + anime.css 落地顺序错误 (v3.0 round-2 lesson)
- pre-existing 18 个 vitest failures 是否长期未修
- tmp/ 目录膨胀 (90+ white-list 文件是否散落难找)
- 主 session 与 subagent 边界模糊案例

输出: docs/superpowers/specs/defects-analysis/C-engineering-process/REPORT.md
      (≤30-50 页, 严格按 design doc §2.2 子报告模板)

重要: 维度 C 是 v3.0 ship 阻塞的归类维度, 必须把 "merge conflict 反复出现" "ship 反复阻塞" "subagent 派单反复失败" 这 3 类反复症状列 Top 问题
```

### 维度 D: 产品/UX

- [ ] **Step 4: 派维度 D subagent**

**派单 prompt 模板（维度 D）:**
```
任务: 产品/UX 缺陷深扫 (维度 D)

扫描范围:
- src/pages/ (14 个内页 + index)
- src/components/ (AppHeader / AppSidebar / ErrorBanner / WindowControls / ConfirmDialog)
- src/design-system/ (tokens.css / base.css / themes/ / ThemeRegistry / ThemeProvider)
- src/App.tsx + src/main.tsx
- SPEC.md §5 (设计规范)

复用资产 (必读):
- SPEC.md §5 (设计规范权威源)
- STATE.md §v3.0 round-2 (3 个用户反馈问题 + 修复)
- tmp/ui-redesign/demo-c-anime.html (v3.0 demo C 基线)

工具: 同维度 A

特别关注 (产品/UX 缺陷典型症状):
- SPEC.md §5 vs 实际实现的 gap (14 个内页逐页对照)
- 主题切换 (light/anime) 视觉一致性问题
- base.css 落地顺序错误 (v3.0 round-2 已修, 是否有同类)
- 设计 token 一致性 (--radius-* 别名 / --bg-* 命名)
- 状态色使用 (#388E3C 成功 / #F57C00 警告 / #D32F2F 错误)
- 圆角规范 (卡片 8px / 按钮 4px / 弹窗 12px)
- 字体加载 (Nunito / Fredoka Google Fonts 是否加 link — STATE.md 已知限制)
- 间距 4px 网格合规性
- 交互反馈缺失 (按钮 hover / focus / active / disabled 状态)
- 空状态 / 加载状态 / 错误状态 (3 个状态覆盖)
- 可访问性 (键盘导航 / 屏幕阅读器 / 颜色对比度)
- i18n 准备 (中英文案混排)

输出: docs/superpowers/specs/defects-analysis/D-product-ux/REPORT.md
      (≤30-50 页, 严格按 design doc §2.2 子报告模板)
```

- [ ] **Step 5: 流式接收 4 subagent 完成通知 (§11.3)**

主 session 收到每个 subagent 完成通知后立即:
1. 检查 REPORT.md 是否存在且非空
2. 检查是否符合模板 (元信息 / Top 清单 / 详细分析 / 简要列举 / 已知限制)
3. 检查证据要求 (每条问题有 file_path:line + 代码片段)
4. 若不合格: 派 1 个 fix subagent (限 1 次重试)
5. 若合格: 标记 task 完成, 进入 Step 6

- [ ] **Step 6: Commit (主 session 执行, §14.1)**

```bash
cd /Users/coderstory/CodeSource/winui3
git add docs/superpowers/specs/defects-analysis/A-platform-architecture/REPORT.md \
        docs/superpowers/specs/defects-analysis/B-code-quality/REPORT.md \
        docs/superpowers/specs/defects-analysis/C-engineering-process/REPORT.md \
        docs/superpowers/specs/defects-analysis/D-product-ux/REPORT.md
git commit -m "docs(defects-scan): Wave 1 批 1 — 4 维度子报告 (A/B/C/D)

- A: 跨平台架构 (复用 audit-{deps,rust,scripts,frontend})
- B: 代码质量 (复用 audit-{frontend,rust} + tailwind-audit)
- C: 工程流程 (含 v3.0 ship 阻塞根因分析)
- D: 产品/UX (对照 SPEC.md §5)

Refs: docs/superpowers/specs/2026-06-24-project-defects-analysis-design.md §4.2

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

**Task 2 验收标准:**
- 4 份 REPORT.md 全部创建且符合模板
- 每份子报告 Top 问题 5-10 条 + 详细分析前 3 条 + 简要列举后续
- 每条问题有 file_path:line + 代码片段证据
- 1 个 atomic commit (含 4 子报告)
- 4 subagent 总失败次数 ≤ 8 (每个 ≤2 次, §11.7)

---

## Task 3: Wave 1 批 2 — 派 2 subagent 并行扫描 E/F 维度

**Files:**
- Create: `docs/superpowers/specs/defects-analysis/E-test-coverage/REPORT.md`
- Create: `docs/superpowers/specs/defects-analysis/F-documentation-knowledge/REPORT.md`
- Read-only: 既有 test-failures / smoke-failures / white-list 资产

**Interfaces:**
- Consumes: Task 1 解 conflict + Task 2 的 4 份子报告 (可作为交叉引用)
- Produces: 2 份子报告 + 引用 Task 2 子报告 (跨维度交叉)

**Subagent type:** general-purpose (2 subagent 并行, 4 槽剩 2 槽)

### 维度 E: 测试覆盖

- [ ] **Step 1: 派维度 E subagent**

**派单 prompt 模板（维度 E）:**
```
任务: 测试覆盖缺陷深扫 (维度 E)

扫描范围:
- src/__tests__/ 全量 (vitest)
- src-tauri/tests/ 全量 (cargo test)
- tests/ 全量 (Playwright e2e)
- playwright.config.ts + vitest.config.ts
- scripts/smoke-test.sh (10 项)
- src-tauri/src/commands/ (IPC 命令的测试覆盖)

复用资产 (必读):
- STATE.md "Pre-existing 18 个 vitest failures" 段
- tmp/test-failures-m2.17-3.1-tests.md
- tmp/test-failures-m3.10-rust.md
- tmp/test-failures-m3.4.md
- tmp/test-failures-m-finalize.md
- tmp/smoke-failures-m-finalize.md
- tmp/smoke-failures-m3.10.md
- tmp/smoke-failures-m3.4.md

工具: 同维度 A, 加上:
- ✅ npm test -- --run (跑全部 vitest)
- ✅ cargo test (跑全部 Rust test)
- ✅ npx playwright test (跑 e2e, 可能失败)
- ✅ npm test -- --coverage (生成覆盖率报告)

特别关注 (测试覆盖缺陷典型症状):
- pre-existing 18 个 vitest failures 是否长期未修 (STATE.md 已知)
- 关键 IPC 命令无单测 (commands/ 下哪些命令没测试)
- 关键页面无单测 (pages/ 下 14 个内页哪些没测试)
- e2e 覆盖空白 (Playwright 跑哪些 user journey)
- smoke-test 10 项是否真的覆盖 4 类 build regression (§13.1)
- TDD 违反案例 (§2.2 强制, 是否有 subagent 先写代码后补测试)
- 测试夹具 / mock 复用度 (重复 fixture / hard-coded mock)
- 跨平台测试 (Windows 跑 / macOS 是否也跑)
- CI 配置覆盖 (.github/workflows/ci.yml 跑哪些)

输出: docs/superpowers/specs/defects-analysis/E-test-coverage/REPORT.md
      (≤30-50 页, 严格按 design doc §2.2 子报告模板)
```

### 维度 F: 文档/知识管理

- [ ] **Step 2: 派维度 F subagent**

**派单 prompt 模板（维度 F）:**
```
任务: 文档/知识管理缺陷深扫 (维度 F)

扫描范围:
- CLAUDE.md (637 行, 15 章节)
- SPEC.md (1434 行)
- docs/ARCHITECTURE.md (654 行)
- docs/ 全部 (BUILD.md / DEBUG-MAC.md / SIGNING.md / macos-p2-backlog.md / design / investigations / milestones / reviews / rules / superpowers)
- AGENTS.md (212 行)
- README.md
- .planning/ (HANDOFF / ROADMAP / STATE / research)
- tmp/ (90+ white-list / audit / test-failures / smoke-failures / retro / scripts-usage-guide)

复用资产 (必读):
- tmp/audit-docs.md (228 行, 文档 macOS 覆盖度)
- 所有 tmp/white-list-*.md (90+ 文件, 派单历史)

工具:
- ✅ Read / Grep / Glob / Bash (wc / find / grep)
- ✅ 引用既有 audit 资产
- ❌ 任何写操作 (Read-Only)
- ❌ 联网

特别关注 (文档管理缺陷典型症状):
- CLAUDE.md 膨胀 (637 行, 还在 §15.7 加段, 是否该拆分)
- ARCHITECTURE.md 与代码 drift (M2.16 后 8 traits 还准确吗)
- SPEC.md 与实现 drift (CLAUDE.md §10 禁止修改 SPEC, 但实现是否对齐 SPEC)
- docs/milestones/ 是否覆盖到 M3 / M4 (当前最新到 M2.16 / v3.0)
- tmp/ 散落文件 (90+ white-list / audit 是否该归档到 docs/ 或清理)
- 重复内容 (CLAUDE.md §15.7 与 docs/macos-p2-backlog.md 是否有重复)
- 缺失文档 (M4 阶段缺什么文档?)
- 文档与代码同步 (commit 后是否同步更新相关文档)
- 文档维护责任 (谁负责同步 / 何时同步)
- 索引完整性 (README.md "进一步阅读" 是否覆盖所有 docs/)

输出: docs/superpowers/specs/defects-analysis/F-documentation-knowledge/REPORT.md
      (≤30-50 页, 严格按 design doc §2.2 子报告模板)
```

- [ ] **Step 3: 流式接收 2 subagent 完成通知 (§11.3)**

同 Task 2 Step 5 流程.

- [ ] **Step 4: Commit (主 session 执行, §14.1)**

```bash
cd /Users/coderstory/CodeSource/winui3
git add docs/superpowers/specs/defects-analysis/E-test-coverage/REPORT.md \
        docs/superpowers/specs/defects-analysis/F-documentation-knowledge/REPORT.md
git commit -m "docs(defects-scan): Wave 1 批 2 — 2 维度子报告 (E/F)

- E: 测试覆盖 (含 pre-existing 18 failures + smoke test 覆盖度)
- F: 文档/知识管理 (CLAUDE.md 637 行膨胀 + tmp/ 散落)

Refs: docs/superpowers/specs/2026-06-24-project-defects-analysis-design.md §4.3

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

**Task 3 验收标准:**
- 2 份 REPORT.md 全部创建且符合模板
- 每份子报告 Top 问题 5-10 条 + 详细分析前 3 条
- 1 个 atomic commit (含 2 子报告)
- 2 subagent 总失败次数 ≤ 4 (每个 ≤2 次, §11.7)

---

## Task 4: Wave 2 — 派 1 subagent 撰写主报告

**Files:**
- Create: `docs/superpowers/specs/2026-06-24-project-defects-analysis.md` (≤30 页)
- Read-only: 6 份子报告 + 6 份既有 audit

**Interfaces:**
- Consumes: Task 2 + Task 3 的 6 份子报告
- Produces: 主报告 (汇总 + 路线图), 严格按 design doc §3 模板

**Subagent type:** general-purpose (1 subagent)

- [ ] **Step 1: 派 Wave 2 subagent**

**派单 prompt 模板（Wave 2）:**
```
任务: 撰写项目缺陷盘点主报告 (汇总 6 份子报告)

输入 (全部只读):
- docs/superpowers/specs/defects-analysis/A-platform-architecture/REPORT.md
- docs/superpowers/specs/defects-analysis/B-code-quality/REPORT.md
- docs/superpowers/specs/defects-analysis/C-engineering-process/REPORT.md
- docs/superpowers/specs/defects-analysis/D-product-ux/REPORT.md
- docs/superpowers/specs/defects-analysis/E-test-coverage/REPORT.md
- docs/superpowers/specs/defects-analysis/F-documentation-knowledge/REPORT.md
- tmp/audit-deps.md
- tmp/audit-docs.md
- tmp/audit-frontend.md
- tmp/audit-rust.md
- tmp/audit-scripts.md
- tmp/tailwind-audit.md
- docs/superpowers/specs/2026-06-24-project-defects-analysis-design.md

工具:
- ✅ Read / Grep / Glob (只读 markdown)
- ❌ 任何写操作 (Read-Only)
- ❌ 联网

输出: docs/superpowers/specs/2026-06-24-project-defects-analysis.md
      (≤30 页, 严格按 design doc §3 模板)

模板结构:
## 元信息
## 1. 项目当前状态摘要
## 2. 6 维度摘要 (每维 1 段 + Top 3)
## 3. 跨维度交叉问题 (出现 ≥2 维度的根因) — 必须举 ≥3 个具体例子
## 4. 优先级矩阵 (P0/P1/P2/P3, 每行必须有具体问题, 不允许 "待评估")
## 5. 修复路线图 (推荐 3-5 个具体迭代建议, 含估时)
## 6. 已知限制 / 不在本扫描范围
## 附录 A: 6 份子报告路径
## 附录 B: 复用既有审计资产清单
## 附录 C: 排除文件清单 (Wave 0 之前) — 已由 Wave 0 解 conflict, 此附录注明 "Wave 0 后纳入扫描"

要求:
- 不引入新问题 (只汇总 + 交叉引用)
- 每条问题引用对应子报告 §X.Y
- 跨维度交叉问题段必须举 ≥3 个具体例子 (e.g. "merge conflict 反复出现" → C + E + F)
- 优先级矩阵 P0/P1/P2/P3 必须有具体问题, 至少 8 条 (每优先级 ≥2 条)
- 修复路线图必须给出 3-5 个具体迭代建议, 含估时 (e.g. "迭代 N+1: 解 conflict (Wave 0 完成后) + 修 P0 (1d)")
```

- [ ] **Step 2: 接收完成通知 + 主 session 自校**

主 session 自行检查:
1. 主报告 ≤30 页 (wc -l < 1500 行)
2. 模板结构完整 (6 章节 + 3 附录)
3. 跨维度交叉问题 ≥3 个具体例子
4. 优先级矩阵 ≥8 条 (P0/P1/P2/P3 各 ≥2)
5. 修复路线图 3-5 个具体迭代 + 估时
6. 不引入新问题 (与子报告一致)

若不合格: 派 1 个 fix subagent (限 1 次重试, 修改具体段, 不重写整篇).

- [ ] **Step 3: Commit (主 session 执行, §14.1)**

```bash
cd /Users/coderstory/CodeSource/winui3
git add docs/superpowers/specs/2026-06-24-project-defects-analysis.md
git commit -m "docs(defects-scan): Wave 2 — 主报告 (汇总 + 路线图, ≤30 页)

- 6 维度 Top 3 摘要
- 跨维度交叉问题 (≥3 个具体例子)
- 优先级矩阵 P0/P1/P2/P3 (≥8 条具体问题)
- 修复路线图 (3-5 个具体迭代 + 估时)
- 引用 6 子报告 + 6 既有 audit

Refs: docs/superpowers/specs/2026-06-24-project-defects-analysis-design.md §4.4

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

**Task 4 验收标准:**
- 主报告 ≤30 页
- 6 维度摘要 + 跨维度交叉 ≥3 + 优先级矩阵 ≥8 + 路线图 3-5 迭代 + 3 附录
- 1 个 atomic commit
- 1 subagent 失败 ≤1 次

---

## Task 5: Wave 3 — 主 session 自审 spec (无 subagent)

**Files:** (无创建, 仅 review)

**Interfaces:**
- Consumes: 6 份子报告 + 主报告
- Produces: 自审报告到主 session context (不落盘, 用于 §11.7 失败规则触发判断)

**Task rationale:**
按 brainstorming 第 7 步 + writing-plans Self-Review 章节, 主 session 自行做 4 项检查。

- [ ] **Step 1: 占位符扫描**

Run:
```bash
cd /Users/coderstory/CodeSource/winui3
for f in docs/superpowers/specs/2026-06-24-project-defects-analysis.md \
         docs/superpowers/specs/defects-analysis/*/REPORT.md; do
  echo "=== $f ==="
  grep -nE "TBD|TODO|XXX|FIXME|\\?\\?\\?|待[补决评修拟]|vague|placeholder|TBA" "$f" | grep -vE "vague \(.*\)|vague 和|扫描.*vague" || echo "  (无占位符)"
done
```

Expected: 除 "vague" 用于描述性词汇外, 无遗留占位符. 若有, 修复.

- [ ] **Step 2: 内部一致性**

```bash
cd /Users/coderstory/CodeSource/winui3
echo "=== 维度清单一致性 ==="
echo "主报告维度数:"
grep -c "^### 2\\.[A-F]" docs/superpowers/specs/2026-06-24-project-defects-analysis.md
echo "子报告数:"
ls docs/superpowers/specs/defects-analysis/*/REPORT.md | wc -l
echo "附录 A 维度数:"
grep -c "REPORT.md" docs/superpowers/specs/2026-06-24-project-defects-analysis.md
```

Expected: 三者一致 (6). 若不一致, 修复主报告附录 A.

- [ ] **Step 3: 范围检查**

主报告 §5 修复路线图 是否聚焦于"接下来 1-3 个迭代的具体动作", 不是"未来半年的愿景"?
- ✅ 推荐 3-5 个迭代 + 估时
- ❌ 不允许 "长期治理" "持续优化" "未来规划" 等无具体动作的描述

若不合格, 修改主报告 §5.

- [ ] **Step 4: 歧义检查**

随机抽 5 条子报告 + 主报告里的具体问题, 检查是否可被两种解释. 若有, 选一种并明示.

- [ ] **Step 5: 自审报告输出**

主 session 输出一段自审结论到 context (不落盘):
```
Wave 3 自审结论 (2026-06-24):
- 占位符扫描: ✅ 通过 / ⚠️ 修复 X 处
- 内部一致性: ✅ 通过 / ⚠️ 修复 X 处
- 范围检查: ✅ 通过 / ⚠️ 修复 X 处
- 歧义检查: ✅ 通过 / ⚠️ 修复 X 处
- 总结: 主报告 + 6 子报告 达到可交付状态, 用户可进入审阅
```

- [ ] **Step 6: 报告用户 + 等待用户审阅**

主 session 在 chat 中向用户呈现自审结论 + 主报告 + 6 子报告路径列表, 等待用户审阅.

**Task 5 验收标准:**
- 4 项自审全通过
- 主报告 + 6 子报告达到可交付状态
- 用户确认 OK 后整个 brainstorming → writing-plans → execution 闭环结束

---

## 总览

| Task | 内容 | Subagent 数 | 单个时长 | Commit | Wall clock |
|---|---|---|---|---|---|
| 1 | Wave 0 解 conflict | 1 | 0.5-1h | 1 个 | 1h |
| 2 | Wave 1 批 1 (A/B/C/D) | 4 | 1-2h | 1 个 | 2h (4 槽并行) |
| 3 | Wave 1 批 2 (E/F) | 2 | 1-1.5h | 1 个 | 1.5h |
| 4 | Wave 2 主报告 | 1 | 1-1.5h | 1 个 | 1.5h |
| 5 | Wave 3 自审 | 0 (主 session) | 0.5h | 0 | 0.5h |
| **合计** | | **8 subagent** | **~11h 总时长** | **4 个 commit** | **~5-6h wall clock** |

**并发控制**: Task 2 满 4 槽 → Task 3 用 2 槽 (剩 2 槽空闲) → Task 4 用 1 槽 → Task 5 主 session.

**失败处理**: §11.7 三次失败规则, 每个 subagent 失败 ≤2 次自动重试, 第 3 次暂停复盘.

**commit 时机**: Task 1/2/3/4 各 1 个 atomic commit, Task 5 不 commit (仅 review).

---

## Self-Review

**1. Spec coverage:** design doc 6 章节全覆盖.
- §1 项目背景 → Task 0 (前置) + Task 5 自审
- §2 6 维度 + §2.2 模板 → Task 2 (A/B/C/D) + Task 3 (E/F)
- §3 主报告结构 → Task 4
- §4 subagent 编排 → Task 1/2/3/4 派单模板
- §5 时间估算 → 本 plan 总览表
- §6 交付流程 → Task 5 Step 6
- §7 已知限制 → 主报告 §6

**2. Placeholder scan:** 已搜 "TBD/TODO/XXX/FIXME/???/待/vague/placeholder/TBA", 无遗留占位符.

**3. Type consistency:** 各 task 的子报告路径统一 (`docs/superpowers/specs/defects-analysis/<dim>-<name>/REPORT.md`); 主报告路径统一 (`docs/superpowers/specs/YYYY-MM-DD-project-defects-analysis.md`); commit message 格式统一 (含 Refs + Co-Authored-By).

无 plan failures (无 "Similar to Task N" / "Add appropriate error handling" / "implement later").

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-24-project-defects-c-scan.md`.

**接下来两个执行选项:**

1. **Subagent-Driven (recommended)** — 每 task 派 fresh subagent, 主 session 在 task 间 review, 快速迭代
2. **Inline Execution** — 主 session 直接执行 task (含派 subagent + 接收回报 + commit), 批量执行 + checkpoint

按本任务特性 (8 subagent × 长时长), 强烈推荐 **Subagent-Driven** — 主 session 一直在线接收 subagent 完成通知 (§11.3 流式派单), 不需要执行 plan 的 subagent 兼顾派单 / 接收 / commit / 自审 4 件事.

**接下来请你选执行方式.**

---

*本 plan 为完整可执行版本, 无外部依赖 (除 git 工作区干净). Task 1 是 Wave 1-3 的前置, 必须先完成.*