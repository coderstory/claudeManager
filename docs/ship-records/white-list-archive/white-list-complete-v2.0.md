# White-list: complete-v2.0 (gsd-complete-milestone v2.0 执行)

> Date: 2026-06-22
> Task: v2.0 milestone archive + tag + commit
> Mode: auto (小改动)

## 白名单 (6 文件, 任务模板指定)

| # | 文件 | 操作 | 实际 staged? | 备注 |
|---|---|---|---|---|
| 1 | `.planning/MILESTONES.md` | 新建 | ✅ staged (A) | hand-curated 覆盖 gsd 生成 |
| 2 | `.planning/milestones/v2.0-ROADMAP.md` | 新建 | ✅ staged (A) | gsd 归档 (ROADMAP snapshot) |
| 3 | `.planning/milestones/v2.0-MILESTONE-AUDIT.md` | 新建 (rename from .planning/) | ✅ staged (A) | gsd 移动 audit file |
| 4 | `.planning/ROADMAP.md` | 改 | ❌ 未 staged | gsd 实际未改 (只归档副本), 无 diff |
| 5 | `.planning/STATE.md` | 改 | ✅ staged (M) | revert gsd 重写 + surgical Edit Current Position |
| 6 | `.planning/v2.0-MILESTONE-AUDIT.md` | 改 | ❌ 未 staged | gsd rename 到 milestones/, 原文件已不存在 |

## 实际 commit (4 文件)

```
01f555c chore: archive v2.0 milestone (11/11 phase ship, D8 OK, audit passed)
 4 files changed, 489 insertions(+), 3 deletions(-)
 create mode 100644 .planning/MILESTONES.md
 create mode 100644 .planning/milestones/v2.0-MILESTONE-AUDIT.md
 create mode 100644 .planning/milestones/v2.0-ROADMAP.md
```

## 排除文件 (非白名单)

- `.planning/ROADMAP.md.bak` — 预先存在的 backup, 未 staged
- `.planning/PROJECT.md` — gsd 未改, 未 staged
- `.planning/HANDOFF.json` — 禁止改 (任务约束)
- `.planning/phases/*` — 禁止改 (任务约束, 11 phase 全 ship 闭环)
- `src/` / `src-tauri/` / `scripts/` / `docs/` — 禁止改 (任务约束)

## tag

- `v2.0` (annotated) → 01f555c

## 校验

- §6 自审: `tmp/reviews/complete-v2.0-self.md` ✅
- §5 测试: N/A (归档文件改动, 不跑测试)
- §2.4 白名单: 本文件 ✅
