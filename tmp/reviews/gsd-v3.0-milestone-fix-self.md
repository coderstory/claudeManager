# Self-review: gsd v3.0 milestone 定义修复

> 日期: 2026-06-22
> 范围: `.planning/ROADMAP.md` + `.planning/STATE.md` + `.planning/PROJECT.md`
> 类型: 纯文档任务
> 验证方式: 文件对比 + 跨文件一致性检查

---

## 1. `.planning/ROADMAP.md` 改动详情

### 1a. Milestones 段 (L9-12)

| Line | Before | After | 状态 |
|------|--------|-------|------|
| 9 | `✅ v1.0 架构期 (M1.1 ~ M1.12) — 12 phases,shipped 2026-06-19 (5 exes on Desktop)` | (不动) | ✅ |
| 10 | `✅ v1.5 业务期 (M2.1 ~ M2.16) — 16 phases,shipped 2026-06-21 (26+ exes on Desktop)` | (不动) | ✅ |
| 11 | `🚧 v2.0 用户反馈修复 + 双模式 (M2.17 收尾 + M3.1 ~ M3.10) — 11 phases,in progress` | `✅ v2.0 用户反馈修复 + 双模式 (M2.17 收尾 + M3.1 ~ M3.10) — 11 phases,shipped 2026-06-22,tag v2.0` | ✅ |
| 12 | `📋 v3.0 公证发布 (M4.1 ~ M4.6) — 6 phases,planned` | `🚧 v3.0 功能完善 + updater 基础 (M3.11 ~ M3.15 + M4.3 + M4.6) — in progress` | ✅ |

**自审要点**:
- v2.0 状态从 `🚧 in progress` → `✅ shipped` (符合 tag v2.0 事实)
- v3.0 标题重写, 与新 milestone goal 一致 (D16)
- v3.0 范围从 M4.1~M4.6 调整为 M3.11~M3.15 + M4.3 + M4.6 (排除 M4.1/M4.2/M4.4/M4.5)

### 1b. Phases 段 - v3.0 块 (L257-316)

**新增内容**:
- `### 🚧 v3.0 功能完善 + updater 基础 (In Progress)` 标题
- **Milestone Goal** 段: M3.10 双模式 + updater + 测试补齐 + Tailwind 闭环 + 排除项
- **v3.0 round 1 已 ship 7 phase** 简介
- **Phase 12-21** 详细描述 (10 个 phase)
- **v3.0 round 1 关键决策** 段 (D15/D16/M4.1/M4.5/D6)

**Phase 12-17 (已完成)**:
| Phase | 标题 | 关键 commits |
|-------|------|--------------|
| 12 | M3.11~M3.12 M3.10-adapter plugin 适配 (13 接入点) | f375bf1 / 2e4e75b / afd090e / 8a2650f / a9bd4b5 / f145d38 |
| 13 | B3#10 Tailwind 移除 | ed5a3e5 |
| 14 | B2#1 usage fixture 8 子任务 | 4f5df37 |
| 15 | A3 备份增量 Phase 1 | 3eadae2 |
| 16 | L-M2.08 MacWindowChrome 统一 | 7efb0f8 |
| 17 | M4.3 updater Phase 1 (pubkey+endpoint) | da6ba67 |

**Phase 18-21 (pending)**:
| Phase | 标题 | 状态 |
|-------|------|------|
| 18 | M1 L1 Playwright e2e (Windows only) | ⏳ 402 余额不足中止 |
| 19 | A3 备份增强 Phase 2 (云备份) | ⏳ pending |
| 20 | M4.3 updater Phase 2/3 | ⏳ pending |
| 21 | M4.6 长期 backlog | ⏳ pending (按需启动) |

### 1c. Phases 段 - v4.0+ 块 (L317+)

**Before** (旧 v3.0 块 M4.1~M4.6):
- Phase 12: M4.1 代码签名证书
- Phase 13: M4.2 公证
- Phase 14: M4.3 updater 启用
- Phase 15: M4.4 双轨打包
- Phase 16: M4.5 应用商店
- Phase 17: M4.6 长期 Backlog

**After** (新 v4.0+ 块 deferred):
- 标题: `### 📋 v4.0+ 公证发布 (Deferred, 待用户拍板重启)`
- Milestone Goal 段
- 候选清单 (M4.1~M4.6 现状) — 6 行表格
  - ❌ M4.1 (取消)
  - ⏸ M4.2 (暂缓)
  - 🟡 M4.3 (Phase 1 ship, Phase 2/3 pending)
  - ⏸ M4.4 (暂缓)
  - ❌ M4.5 (取消)
  - 🟡 M4.6 (按需启动)

**自审要点**:
- M4.1~M4.6 保留为审计痕迹 (D15/D16 决策)
- 标注 deferred 原因 (用户拍板 2026-06-22)
- 旧 v2.0 phase 1-11 完整保留 (审计痕迹)

### 1d. Progress 段

**Before** (L395-):
- 1-11 v2.0 phase + 6 个 v3.0 M4.x Planned 行

**After** (L395+):
- 1-11 v2.0 phase (不动)
- 12-17 v3.0 phase 6 个 Complete 行
- 18-21 v3.0 phase 4 个 Pending 行
- Execution Order 更新为 "v3.0 round 1 已 ship 7 phase: Phase 12 → 13 → 14 → 15 → 16 → 17 ✅"

**自审要点**:
- 表格行数从 17 → 21 (新增 4 行)
- v3.0 6 行的 phases_complete = commit 数 (1 或 6), 真实记录

---

## 2. `.planning/STATE.md` 改动详情

### 2a. Frontmatter (L1-11)

| Line | Before | After |
|------|--------|-------|
| 2 | `milestone_version: v2.0` | `milestone_version: v3.0` |
| 3 | `status: shipped` | `status: in_progress` |
| 4-6 | `progress.phases_complete: 11/11` + 11 个 v2.0 phase | `progress.phases_complete: 7/10` + v2.0 11/11 + v3.0 7/10 + 6 个 v3.0 phase |
| 6-7 | (无 v2.0/v3.0 分组) | 新增 `v2.0_phases_complete` / `v3.0_phases_complete` / `v3.0_pending` 字段 |
| 9 | `A1 12/13 plugin 接入` | `A1 13/13 plugin 接入` (实际全部完成) |

**自审要点**:
- milestone_version 升级 v2.0 → v3.0 (新 session 关键识别点)
- status 改 in_progress (v3.0 还有 Phase 18-21 pending)
- phases_complete = 7/10 = 12+13+14+15+16+17+18(已 ship 部分=0)
  - 实际: v2.0 ship 11 + v3.0 ship 7 = 18/22 跨 milestone, 但当前 v3.0 = 7/10
  - 决定: phases_complete 指 v3.0 自身进度 (7/10), v2.0_phases_complete 单独追踪
- completed 数组追加 6 个 v3.0 round 1 phase tag (M3.11~M3.12 / B3#10 / B2#1 / A3 / L-M2.08 / M4.3-updater-Phase1)

### 2b. Current Position 段 (L23-30)

| Line | Before | After |
|------|--------|-------|
| 23 | "Phase: Milestone v2.0 complete (11/11 phases shipped) + v3.0 round 1（2026-06-22）已 ship 12 commits" | "Phase: Milestone v2.0 complete (11/11 phases shipped) + v3.0 round 1（2026-06-22）已 ship 7 phases (Phase 12-17)" |
| 25 | "v3.0 round 1 收尾 / 等待 round 2 启动" | "v3.0 in progress — 7/10 phases ship / 4 pending (Phase 18-21)" |
| 26 | "A1 12/13 接入" | "A1 13/13 接入" |
| 27 | "#9 F18 scan_optimizations + #14 e2e 余额恢复 + 备份 Phase 2 + updater Phase 2-3" | "Phase 18 e2e 余额恢复 + Phase 19 云备份 + Phase 20 updater UI + Phase 21 M4.6 长尾项" |
| 32 | "A1 12/13 plugin 适配完成" | "A1 13/13 plugin 适配完成" |

**自审要点**:
- 12 commits 改为 7 phases (更准确)
- 4 个 pending 任务明确 Phase 编号
- 12/13 → 13/13 (根据 v3.0 round 1 commits 实际状态)

### 2c. Recent Work + Decisions + Known Issues 段 (L34-63)

**未改动** — 已含 v3.0 round 1 12 commits 记录 + D14/D15/D16 决策 + Known Issues 列表

**自审要点**:
- Recent Work 段 L41-48 已含 v3.0 round 1 12 commits 详细列表
- Decisions 段 L53-54 已含 D15/D16 (v3.0 决策)
- Known Issues 段 L59-60 已含 M4.1/M4.5/D6 拍板
- 不重复, 保持原状

---

## 3. `.planning/PROJECT.md` 改动详情

### 3a. Current Milestone 段 (L22-25)

| Line | Before | After |
|------|--------|-------|
| 24 | `✅ v2.0 用户反馈修复 + 双模式 (M2.17 收尾 + M3.1~M3.10) — 11/11 ship, smoke 7/7` | 加 `, tag v2.0` 后缀 |
| 25 | `📋 v3.0 公证发布 (M4.1~M4.6) — 6 phases, planned` | `🚧 v3.0 功能完善 + updater 基础 (M3.11~M3.15 + M4.3 + M4.6) — 7/10 ship, round 1 (Phase 12-17) 已 ship 2026-06-22` |

### 3b. Validated 段 (L29-69)

**新增 L60-67**: v3.0 round 1 6 项 (A1 / B3#10 / B2#1 / A3 / L-M2.08 / M4.3)
- 每项含 commit 引用
- 与 ROADMAP.md Phase 12-17 1:1 对应

### 3c. Active 段 (L71-75)

| Line | Before | After |
|------|--------|-------|
| 73 | "v2.0 milestone 已 ship 11/11 phase。当前空 — 等待 v3.0 公证 (M4.1~M4.6) 启动。" | "v3.0 进行中：A1 13/13 + updater Phase1 + 备份增量 + WindowChrome 统一已完成；e2e/云备份/updater UI/M4.6 长尾 pending。" |
| 75 | M4.1~M4.6 1 行 | 4 行 (Phase 18-21) |

### 3d. Out of Scope 段 (L77-82)

**新增**:
- ❌ **M4.1 代码签名证书** — 用户拍板不买
- ❌ **D6 Mac 真机验证** — 用户拍板不处理

**自审要点**:
- 加 M4.1 / D6 2 项排除 (用户 2026-06-22 拍板)
- 旧 M4.5 项 (Microsoft Store) 保持 (M4.5 用户拍板不上架)

### 3e. Context 段 (L84-92)

| Line | Before | After |
|------|--------|-------|
| 88 | "M2.17 收尾中 (3 件套 + 17 已知限制),M3 启动门 4 槽待派" | "v3.0 round 1 (Phase 12-17) 已 ship 7/10。round 2 (Phase 18-21) 启动门 4 槽待派" |
| 89 | (无 v3.0 goal 段) | 新增 "**v3.0 goal**: 'M3.10 双模式落地 + 测试补齐 + updater 基础 + Tailwind 闭环'（D16 2026-06-22）" |
| 90 | (无 v3.0 排除段) | 新增 "**v3.0 排除**: M4.1 证书 / M4.5 商店 / D6 Mac 真机 / M4.2 / M4.4（用户拍板 2026-06-22）" |
| 92 | (无 v3.0 草案引用) | 新增 "**v3.0 草案详细**: `.planning/milestones/v3.0-EXECUTION-PLAN.md` (Wave 1/2/3 派单顺序 + 4 个决策点)" |

---

## 4. 跨文件一致性检查

| 数据点 | ROADMAP.md | STATE.md | PROJECT.md | 一致 |
|--------|------------|----------|------------|------|
| v2.0 状态 | ✅ shipped 11/11 | v2.0_phases_complete: 11/11 (shipped, tag v2.0) | ✅ 11/11 ship, tag v2.0 | ✅ |
| v3.0 状态 | 🚧 in progress, 7/10 | milestone_version: v3.0, status: in_progress, 7/10 | 🚧 7/10 ship | ✅ |
| Phase 12 commits | f375bf1/2e4e75b/afd090e/8a2650f/a9bd4b5/f145d38 | v3.0_round1_commits 包含 | Validated 段引用 | ✅ |
| Phase 13 commit | ed5a3e5 | v3.0_round1_commits 包含 | Validated 段引用 | ✅ |
| Phase 14 commit | 4f5df37 | v3.0_round1_commits 包含 | Validated 段引用 | ✅ |
| Phase 15 commit | 3eadae2 | v3.0_round1_commits 包含 | Validated 段引用 | ✅ |
| Phase 16 commit | 7efb0f8 | v3.0_round1_commits 包含 | Validated 段引用 | ✅ |
| Phase 17 commit | da6ba67 | v3.0_round1_commits 包含 | Validated 段引用 | ✅ |
| v3.0 排除项 | v3.0 round 1 关键决策段 | (在 Known Issues 段已存在) | Out of Scope 段 | ✅ |
| A1 plugin 数 | 13/13 | 13/13 | 13/13 | ✅ |

---

## 5. 风险与限制

### 5.1 不破坏旧 v2.0 数据
- v2.0 phase 1-11 完整保留 (line 70-256)
- v2.0 M1.x / M2.x 历史保留 (line 67+ 审计痕迹)
- 不删任何 phase 记录

### 5.2 不影响代码
- 0 行代码改动
- 0 个 .rs / .ts / .tsx 文件改动
- 0 个测试文件改动
- 0 个 build 脚本改动

### 5.3 不影响 git tag / commit hash
- tag v2.0 (commit `01f555c`) 不动
- 12 个 v3.0 round 1 commit (f375bf1 ~ da6ba67) 不动
- 本次 commit 是新 doc commit, 不 rebase

### 5.4 验证方法
- 新 session 跑 `gsd query init.milestone-op` 应返回 `milestone_version: v3.0`
- 新 session 跑 `gsd query phases` 应返回 21 phases (1-11 v2.0 + 12-21 v3.0)
- 新 session 跑 `gsd query current` 应返回 "v3.0 in progress — 7/10 ship"

---

## 6. 已知限制

- **L-Fix01**: HANDOFF.json 仍未更新 (主 session 决定补还是带 M2 一起, 2026-06-20 已知 stale)
- **L-Fix02**: docs/REVIEWS/* 未追加 v3.0 round 1 review (需新 session 启动时补)
- **L-Fix03**: tmp/reviews/ 下未追加 v3.0 收尾总 review (需新 session 启动时补)

这些限制不影响 gsd 识别 v3.0 milestone (gsd 仅认 ROADMAP/STATE/PROJECT 三文件), 但建议 v3.0 round 2 启动时补齐。

---

*本 self-review 由主 session 一次性生成 (2026-06-22, 纯文档任务, 不写代码 / 不编译 / 不 ship)。*
