# Self-review: complete-v2.0 (gsd-complete-milestone v2.0 执行)

> Date: 2026-06-22
> Scope: v2.0 milestone archive + tag + commit
## 决策追溯

### 1. gsd-tools milestone complete v2.0 — 跑了但只部分采用

**做了什么**: `gsd-tools milestone complete v2.0` 成功运行:
- ✅ 归档 ROADMAP → `.planning/milestones/v2.0-ROADMAP.md`
- ✅ 移动 audit file → `.planning/milestones/v2.0-MILESTONE-AUDIT.md`
- ✅ 生成 MILESTONES.md (但内容质量差)
- ⚠️ 重写 STATE.md frontmatter (破坏项目格式 + 丢数据)

**关键问题**: gsd 把项目自定义 frontmatter (`milestone_version:` / `phases_complete: 11/11` / 显式 completed list) 替换成 gsd 标准格式:
- `completed_phases: 10` (错, 应是 11/11 — gsd parser Phase 9 partial flag 误判)
- 丢了显式 phase 列表 `[M2.17, M3.1, ..., M3.10]`

**为什么 revert STATE.md**: 项目 memory (`feedback/gsd-planning-fits-this-project.md`) 明确 gsd-* 不适用本项目 STATE.md 跟踪。revert 后用 Edit 工具 surgical 改 Current Position 段, 保留项目 frontmatter。

**白名单内**: `.planning/STATE.md (改)` 明确在任务白名单。

### 2. MILESTONES.md — hand-curate 覆盖 gsd 生成

gsd 生成的 MILESTONES.md accomplishments 全是 `"Status"` (12 个重复, 因为 SUMMARY.md frontmatter 没 one-liner 字段, gsd fallback 提取错)。用任务模板的 hand-curated 内容覆盖, 包含:
- v1.0 / v1.5 / v2.0 三行 archive index
- v2.0 关键产物 (12 exe + 11 SUMMARY + audit + 3 沉淀)
- v2.0 → v3.0 backlog (3 项)

### 3. ROADMAP.md / PROJECT.md — 未改

gsd 只创建归档副本 (`milestones/v2.0-ROADMAP.md`), 未改原 ROADMAP.md。任务模板 step 1 说 gsd 会"更新 ROADMAP 为一行 summary", 但实际 gsd milestone complete 不动 ROADMAP (只归档)。PROJECT.md 同理未动。

→ commit 只含 4 文件 (MILESTONES.md + milestones/2 + STATE.md), 符合白名单 6 文件 (2 个不在 = ROADMAP/PROJECT 未被 gsd 改)。

## 边界检查

- ✅ 未改 src/ / src-tauri/ / scripts/ / docs/
- ✅ 未改 .planning/phases/ (11 phase 全 ship 闭环)
- ✅ 未改 .planning/HANDOFF.json
- ✅ 未 git push (只 commit + tag)
- ✅ 未写全局 dotfile
- ✅ 未 rm (audit file 是 rename, 由 gsd 完成)
- ✅ 未派下级 subagent
- ✅ ROADMAP.md.bak (预先存在的 backup) 未 staged
## 并发 / 平台差异

- N/A (归档文件改动, 单线程, 无 OS 差异)
## 文档一致性

- ✅ MILESTONES.md 三行 archive index 与 audit file (v1.0/v1.5/v2.0) 一致
- ✅ STATE.md Current Position 与 git log 最新 commit (01f555c) 一致
- ✅ tag v2.0 指向 01f555c (archive commit)
## 失败项

- ⚠️ gsd milestone complete 生成的 MILESTONES.md 质量差 → 已 hand-curate 覆盖
- ⚠️ gsd milestone complete 重写 STATE.md 破坏项目格式 → 已 revert + surgical Edit

两项都已修复, 无阻塞。
## 给主 session

v2.0 milestone 归档完成 (4 文件 commit + v2.0 tag)。下一步 /gsd-new-milestone 启动 v3.0。
