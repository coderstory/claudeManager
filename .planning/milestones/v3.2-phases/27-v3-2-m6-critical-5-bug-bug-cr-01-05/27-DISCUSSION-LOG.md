# Phase 27: v3.2 M6 critical 5 bug 修复 - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-26
**Phase:** 27-v3.2 M6 critical 5 bug 修复
**Areas discussed:** Meta 决策（预排 vs 实测错位）/ 映射决策 / 灰区 1 scope 修复 / 灰区 2 用量三件套共根 / 灰区 3 MCP 合并 / 灰区 4 测试覆盖 / 灰区 5 修法时序

---

## Meta 决策：预排 vs 实测错位

| Option | Description | Selected |
|--------|-------------|----------|
| (A) 抛掉预排重排 27-30 | 完全按实测 11 条重排 27-30 阶段 | |
| (B) 实测 + 预排并行 | phase 27 修实测 11 条, 预排 CR-01~05 作为 phase 27.5 hot patch | |
| (C) 实测映射到预排阶段 (推荐) | 把实测 11 条合并到对应阶段, 保留原 ROADMAP 粒度 | ✓ |
| (D) 复占预排 slotID | 用 BUG-CR-01~05 slotID 重新定义, 0 重写 ROADMAP | |

**User's choice:** (C) 实测映射到预排阶段 (推荐)
**Notes:** 用户选 C 后追问 "采纳推荐映射 (进 27/28)" — 确认把实测 11 条按"哪类 bug 适合哪阶段"映射到 phase 27 critical 5 + phase 28 业务。

---

## 映射决策：实测 11 条 → 预排阶段

| Option | Description | Selected |
|--------|-------------|----------|
| 推荐映射 (进 27/28) | 5 fix 进 phase 27, 6 业务进 phase 28 | ✓ |
| 紧凑 5 fix 剩余进 28 | 5 fix 保持预算, 剩余 6 业务进 phase 28 | |
| 我手动写映射 | 用户手动重写 | |

**User's choice:** 推荐映射 (进 27/28)
**Notes:** 5 fix = #1 header 拖动 (CR-01) / #2 用量 SQL (CR-02) / #4 JSON 路径 (CR-03) / #8 scope 切换 (CR-04) / #11 SQL 导入 (CR-05)。第 6 fix (MCP 合并重构) 作 BUG-CR-06 新增 slot。剩余 6 业务 (#5 #6 #7 #9 #10 #12) 进 phase 28。

---

## 灰区 1: scope 状态修复策略 (#8 #10 #12)

| Option | Description | Selected |
|--------|-------------|----------|
| (R1) React 组件层修 | 三个组件 useEffect 漏依赖 + 加 useScope hook + React key={scope} 强制重 mount | |
| (R2) 状态管理层修 (推荐) | zustand subscribeWithSelector middleware + 重构 scope 为 atom + useScope hook 集中订阅 | ✓ |
| (R3) 后端 IPC 修 | 走 "scope 在前端只作 UI hint, 所有真相在后端" | |
| 其他 | 用户手动指定 | |

**User's choice:** (R2) 状态管理层修 (推荐)
**Notes:** 一次性治好"状态传递"问题。代码量最大但根治。决策固定为 D-01~D-05。

---

## 灰区 2: 用量三件套共根 (#2 #6 #7)

| Option | Description | Selected |
|--------|-------------|----------|
| 同根 - 1 query bug (推荐) | 3 个反馈是同一份 query 的 3 个症状, 1 个 fix 修 3 个 | ✓ |
| 独立 3 fix | 3 个独立 fix 分别诊断 | |
| 重写 F7 service | 重写整个 UsageService | |

**User's choice:** 同根 - 1 query bug (推荐)
**Notes:** 决策 D-06~D-09。COALESCE 修类型 + 30 天时间窗 + GROUP BY day + refresh verify。

---

## 灰区 3: MCP 合并重构

| Option | Description | Selected |
|--------|-------------|----------|
| 路由合并 + MCP 默认 tab (推荐) | 删除 /mcp-management 路由, MCP 内容迁移到 /resource-browser/mcp | ✓ |
| 保留老路由 + redirect | 保留 /mcp-management 路由 + redirect, 兼容老用户 | |
| 暂不合并, 只修 scope | 只修 #8 #10 #12, MCP 菜单项保留但点击转发 | |

**User's choice:** 路由合并 + MCP 默认 tab
**Notes:** 决策 D-10~D-14。删路由 + tab 结构 + 侧边栏清理 + 1 里程碑后删老 redirect。data schema 不合并。

---

## 灰区 4: 测试覆盖优先级

| Option | Description | Selected |
|--------|-------------|----------|
| (T1) 单元+集成先行, e2e 后面 (推荐) | 5 fix × {vitest + integration}, fix 完一次补 2-3 e2e | |
| (T2) 单元 + e2e 并行 | 5 fix × {vitest + e2e} → M4 15/15 + 5 = 20/20 ship gate | ✓ |
| (T3) 只修不测 (不推荐) | 只修 bug 不加测试 | |
| (T4) 只单元+集成 | 不加 e2e | |

**User's choice:** (T2) 单元 + e2e 并行 (初次) → 坚持 T2 (确认)
**Notes:** 决策 D-25~D-28。5 fix → 5 新 e2e 场景，ship gate 15/15 → 20/20。e2e spec 命名 `tests/e2e/m6-p27-{fix-name}.spec.ts`。用户已知 T2 会拉长 ship 时间 2-3 天，仍坚持。

---

## 灰区 5: 修法时序

| Option | Description | Selected |
|--------|-------------|----------|
| (P1) 5 subagent 并行 (限 4 槽) | 5 subagent 2 批: 4+1 | ✓ |
| (P2) 3 批并行按文件互不重叠分组 (推荐) | 3 组并行, 按修改文件互不重叠原则 | |
| (P3) 5 fix 串行 | 5 fix 串行, 无冲突 | |

**User's choice:** (P1) 5 subagent 并行 (限 4 槽)
**Notes:** 决策 D-29~D-32。第 1 批 4 subagent 派 fix 1/2/3/4，第 2 批 1 subagent 派 fix 5；fix 6 跨 fix 4 跟在第 2 批里。主 session 负责 rebase 协调。

---

## Claude's Discretion

- 单元测试 fixture 复用 `src-tauri/src/services/` 既有 test helper（D-25 隐含）
- Playwright e2e spec 走 M1.8 已建框架
- vitest mock 模式：Rust IPC mock 用 `@tauri-apps/api` mock 模板
- `useScope` hook API 形态：返回 `[scope, setScope, projectRoot, setProjectRoot]` 4-tuple
- 5 fix 原子 commit message 风格：沿用 M5 `fix(27-{n}): {description}`
- 路由表修改走 `src/router/index.tsx` 既有模式
- Sidebar 删除走 `src/components/sidebar/index.tsx` 既有 mode

## Deferred Ideas

### v3.2.1 backlog（实测未发现 + 预排原内容）
- 原 BUG-CR-01: F2 switch atomic backup → write → reload Claude
- 原 BUG-CR-02: F13 备份可恢复
- 原 BUG-CR-03: sqlite read settings 缺表 / 解析错容错
- 原 BUG-CR-04: F2 switch UI round-trip
- 原 BUG-CR-05: F18 finding timestamp 过期检测
- 原 BUG-BZ-01~07 / BUG-RF-01~09 / UI-A-01~05 全套

### phase 28 业务 bug 候选
- #5 资源浏览 plugins 数据源错 → BUG-BZ-01
- #9 JSON 编辑器目录树默认折叠 → BUG-BZ-02

### 跨 phase 决策
- v3.0 round 3 废弃项（云备份 / updater UI / M4.6 长尾）保持废弃
- FTS5 全文搜索 / SQLCipher 加密 / 跨 process SQLite 共享 — 独立 backlog
</content>
</invoke>