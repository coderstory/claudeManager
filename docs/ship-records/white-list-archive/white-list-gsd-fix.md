# GSD-fix 白名单 (auto 模式)

**任务**: 修 GSD-adapt 3 caveat (Fix1 + Fix2)
**文件影响**: 2 文件 (1 改内容 + 1 mv)

## 白名单

| # | 类型 | 路径 | 改动 |
|---|---|---|---|
| 1 | 修改 + 重命名 | `.planning/phases/01-m217-closeout/01-m217-closeout-PLAN.md` | rename → `01-01-PLAN.md` (内容是 M2.17-3.1 已 ship 段) |
| 2 | 新建 | `.planning/phases/01-m217-closeout/01-02-PLAN.md` | 新文件,描述 M2.17-batch4 pending 段 |
| 3 | mv 目录 | `.planning/phases/09-m38-usage-blocked/` → `.planning/phases/.deferred-m38-usage/` | 改名隐藏,parser 跳过 |

## 不动清单 (按约束)

- ❌ ROADMAP.md
- ❌ STATE.md / HANDOFF.json / PROJECT.md
- ❌ CLAUDE.md / SPEC.md
- ❌ src/ / src-tauri/ 任何文件
- ❌ .planning/research/ 任何文件
- ❌ 任何 git 操作 (add/commit/push)
- ❌ 任何全局 dotfile
- ❌ 任何 rm 操作 (用 mv 重命名)

## 边界

只改 GSD parser scope (.planning/phases/ 下),其他路径全部不碰。