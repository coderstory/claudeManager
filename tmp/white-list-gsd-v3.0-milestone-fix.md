# White-list: gsd v3.0 milestone 定义修复

> 日期: 2026-06-22
> 任务: 让 gsd chain (新 session) 能识别 v3.0 milestone，可继续执行 v3.0 round 2 (Phase 18-21)
> 纪律: 纯文档任务，不写代码 / 不编译 / 不 ship / 不动 tag
> 范围: 仅 3 个文件 — ROADMAP.md / STATE.md / PROJECT.md

---

## 改动文件清单（3 个）

### 1. `.planning/ROADMAP.md`
**理由**: gsd 认 `ROADMAP.md` 顶层 Milestones + Phases 段。当前 line 11 仍标 v2.0 为 `🚧 in progress`、line 12 列 v3.0 为 `📋 planned (公证发布)`。新 session 跑 gsd 命令时报"没有定义 M3"（M3.11+ 不在 ROADMAP Phases 段）。

**改动点**:
- L11 Milestones 段: v2.0 从 `🚧 in progress` → `✅ shipped 2026-06-22, tag v2.0`
- L12 Milestones 段: v3.0 标题从 `📋 公证发布 (M4.1~M4.6) 6 phases, planned` → `🚧 功能完善 + updater 基础 (M3.11~M3.15 + M4.3 + M4.6) in progress`
- L257 Phases 段: `### 📋 v3.0 公证发布 (Planned)` → `### 🚧 v3.0 功能完善 + updater 基础 (In Progress)` + 新增 Milestone Goal + 7 phase (Phase 12-18)
- 新增 Phase 12-21 (M3.11~M3.12 plugin 适配 / B3#10 Tailwind / B2#1 usage / A3 备份增量 / L-M2.08 WindowChrome / M4.3 updater Phase 1 / Phase 18-21 pending)
- 新增 v3.0 round 1 关键决策段
- L317 Phases 段: 旧 M4.1~M4.6 phase 12-17 内容替换为 `### 📋 v4.0+ 公证发布 (Deferred, ...)` 段
- L395 Progress 段: 表格追加 Phase 12-21 (12 行为 ✅ Complete, 4 行为 Pending)
- L398 Execution Order: 更新为 v3.0 round 1 已 ship 7 phase 顺序

### 2. `.planning/STATE.md`
**理由**: frontmatter `milestone_version: v2.0` 让 gsd 误以为 v2.0 是当前 active milestone（虽然 status 已是 shipped）。新 session 需看到 v3.0 在 in progress。

**改动点**:
- L2 frontmatter `milestone_version: v2.0` → `v3.0`
- L3 frontmatter `status: shipped` → `in_progress`
- L4-6 `progress.phases_complete: 11/11` → `7/10` (v3.0 round 1 已 ship 7 phase)
- L6 `completed:` 数组追加 v3.0 round 1 6 项 (M3.11~M3.12 / B3#10 / B2#1 / A3 / L-M2.08 / M4.3)
- 新增 `v2.0_phases_complete` / `v3.0_phases_complete` / `v3.0_pending` 字段
- L9 `v3.0_round1_completed` A1 12/13 → 13/13
- L23 Current Position: 改为 "v3.0 in progress — 7/10 phases ship / 4 pending (Phase 18-21)"
- L27 Next: 更新为 Phase 18-21 4 项 pending

### 3. `.planning/PROJECT.md`
**理由**: line 25 v3.0 仍标 `📋 公证发布 (M4.1~M4.6)` 与新 v3.0 goal 不符;line 73 Active 段说 "当前空 — 等待 v3.0" 已过时。

**改动点**:
- L24 Current Milestone: v2.0 加 `, tag v2.0`
- L25 Current Milestone: v3.0 标题从 `📋 公证发布 (M4.1~M4.6) — 6 phases, planned` → `🚧 功能完善 + updater 基础 (M3.11~M3.15 + M4.3 + M4.6) — 7/10 ship, round 1 (Phase 12-17) 已 ship 2026-06-22`
- L60 Validated 段追加 v3.0 round 1 6 项 (A1 / B3#10 / B2#1 / A3 / L-M2.08 / M4.3)
- L73 Active 段: "v2.0 milestone 已 ship 11/11 phase。当前空 — 等待 v3.0 公证" → "v3.0 进行中：A1 13/13 + updater Phase1 + 备份增量 + WindowChrome 统一已完成；e2e/云备份/updater UI/M4.6 长尾 pending"
- L75 Active 列表: M4.1~M4.6 → Phase 18-21 4 项 (e2e / 云备份 / updater UI / M4.6 long tail)
- L80 Out of Scope: 加 M4.1 / D6 Mac 2 项排除
- L88 Context: 更新当前进度 + v3.0 goal (D16) + v3.0 排除项
- L92 Context: 加 `v3.0 草案详细: .planning/milestones/v3.0-EXECUTION-PLAN.md`

---

## 不改的文件（明确边界）

- ❌ `.planning/milestones/v2.0-BACKLOG.md` — 历史归档，不动
- ❌ `.planning/milestones/v3.0-EXECUTION-PLAN.md` — 已是 v3.0 文档，不动
- ❌ `.planning/HANDOFF.json` — 主 session 决定补还是带 M2 一起（已 stale 标记）
- ❌ `CLAUDE.md` — 顶层项目规则
- ❌ `SPEC.md` — 只读
- ❌ `docs/REVIEWS/*` — 归档
- ❌ `docs/superpowers/*` — 临时审查文档
- ❌ `src-tauri/**` / `src/**` / `tests/**` — 代码不动
- ❌ tag v2.0 — 不动

---

## 验证步骤

1. gsd 跑 query 顶层 milestones → 应返回 4 个 (v1.0 / v1.5 / v2.0 / v3.0)
2. gsd 跑 query phases → 应看到 Phase 1-21 (1-11 v2.0, 12-21 v3.0)
3. gsd 跑 query init.milestone-op → 应返回 milestone_version: v3.0
4. ROADMAP.md / STATE.md / PROJECT.md 跨文件一致性: v2.0 = shipped 11/11 / v3.0 = in progress 7/10
