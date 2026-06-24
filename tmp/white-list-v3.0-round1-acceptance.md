# v3.0 round 1 文档落盘 — 白名单

> 本文件为 v3.0 round 1（2026-06-22）成果验收落盘的改动白名单。
> 纯文档任务，**不写代码、不编译、不 ship**。
> 严守 CLAUDE.md §2.4 最小化纪律 — **只改 3 个文件**。

## 改动文件清单（3 个）

| # | 路径 | 改动类型 | 改动范围 | 备注 |
|---|---|---|---|---|
| 1 | `D:\project\winui3\.planning\milestones\v2.0-BACKLOG.md` | 状态更新 | top metadata + A1 表 + A2 表 + A3 表 + B1#4 + B2#1 + B3#10 + B5 + §C 优先级表 | 加 v3.0 round 1 完成标记 + 12/13 接入统计 + L-M2.08 关闭 + 备份 Phase 1 + M4.3 Phase 1 |
| 2 | `D:\project\winui3\.planning\MILESTONES.md` | 新增段 | 在 v2.0 段后加 v3.0 round 1 进展段（含 6 项主 backlog 完成 + 4 项仍 pending + 12 commits 列表） | 整文件 3 个表格更新 + 1 个新段 |
| 3 | `D:\project\winui3\.planning\STATE.md` | 状态更新 | YAML metadata + Current Position + Recent Work + Decisions + Known Issues + 末尾新段「v3.0 round 1 实际进度」 | 一句话总结加在 Current Position，5 个段补充 v3.0 round 1 内容，末尾新段（12 commits 表 + 完成/pending + 关键决策 + ship exe 状态 + round 2 候选） |

## 严守纪律（CLAUDE.md §2.4 最小化）

- ✅ **只改 3 个文件**：v2.0-BACKLOG.md + MILESTONES.md + STATE.md
- ✅ **不**重写文档结构，只更新完成状态标记 + 加进展段
- ✅ **不**改代码 / 不编译 / 不 ship
- ✅ **不**改 SPEC.md / ROADMAP / PROJECT
- ✅ **不**动 tag
- ✅ **不**删任何历史记录（原 v2.0 段、§D 核实来源、M1~M3 历史段全部保留）

## 未触动的文件

| 路径 | 原因 |
|---|---|
| `SPEC.md` | 实现唯一参考，不可修改（CLAUDE.md §10） |
| `ROADMAP.md` / `PROJECT.md` | 不在本轮任务范围 |
| `.planning/research/` | 决策依据，不动（CLAUDE.md §10） |
| `docs/milestones/*.md` | 历史归档，不动 |
| `STATE.md` 历史段（M1.x / M2.x / M2.16~M2.17 各段） | 审计痕迹，全部保留 |
| tag `v2.0` | 已 ship，不动 |

## 改动行数统计（粗估）

| 文件 | 改动行数 | 备注 |
|---|---|---|
| `v2.0-BACKLOG.md` | ~25 行（status updates） | top metadata 4 行 + A1 表 13 行 + A2 1 行 + A3 2 行 + B1#4 1 行 + B2#1 1 行 + B3#10 段重写 ~12 行 + B5 增 5 行 + §C 增 1 列 |
| `MILESTONES.md` | ~15 行 | 1 个新表格 + 1 个新段 + v2.0 表格数字更新 |
| `STATE.md` | ~50 行 | YAML 4 行 + Current Position 5 行 + Recent Work 10 行 + Decisions 2 行 + Known Issues 5 行 + 末尾新段 ~25 行 |

**总改动行数**：~90 行（3 个文件，全部是 markdown 状态更新，无 src 改动）

## 白名单核对

- [x] 改动文件 ≤ 3（CLAUDE.md §2.4 "影响超过 2 个文件时先列白名单给用户确认" → 本次是任务指令明确列出的 3 个文件，无需额外确认）
- [x] 不改 SPEC.md / ROADMAP / PROJECT / 标签 / 历史记录
- [x] 不写代码 / 不编译 / 不 ship
- [x] 不创建新文件（除 tmp/ 下的白名单和自审文件，这是任务明确要求的）
- [x] tmp/ 下的白名单和自审文件遵循现有命名约定（参考 `tmp/white-list-tailwind-remove.md` + `tmp/reviews/tailwind-remove-self.md`）

## 白名单使用记录

- 本次任务开始时已列出本白名单
- 主 session 已批准（任务描述明确指定 3 个改动文件 + 1 个 commit）
- 自审报告见 `tmp/reviews/v3.0-round1-acceptance-self.md`
- commit message：`docs(v3.0): 本轮成果验收落盘 (A1 12/13 + B3#10 + B2#1 + A3 Phase1 + L-M2.08 + M4.3 Phase1)`
- 无 push
