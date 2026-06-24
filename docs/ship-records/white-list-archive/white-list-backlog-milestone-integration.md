# White List — v2.0 backlog 里程碑归档

> 任务：把 v2.0 backlog 正式纳入里程碑归档 + 同步 STATE.md 两条已拍板决策
> 纯文档任务，不写代码 / 不编译 / 不 ship
> 日期：2026-06-22

## 改动文件清单（3 个）

| # | 文件 | 改动类型 | 改动范围 | 说明 |
|---|---|---|---|---|
| 1 | `.planning/MILESTONES.md` | 编辑 | 替换 "v2.0 → v3.0 backlog" 段（原 3 行 bullet → 引用链接 + 完成状态摘要表 + 关键说明） | 行 15-18 → 行 15-27 |
| 2 | `.planning/STATE.md` | 编辑 | Known Issues 段 M4.1 + M4.5 两行（"需用户拍板" → "已拍板"） | 行 40-41 |
| 3 | `.planning/milestones/v2.0-BACKLOG.md` | 新增（上一子代理已写，本次纳入 commit） | 全文 359 行 | 已核实代码 + 标记完成状态 |

## 不动的文件

- `SPEC.md` — 不可修改（CLAUDE.md §10）
- `.planning/milestones/v2.0-ROADMAP.md` — 不动
- `.planning/PROJECT.md` — 不动
- `src-tauri/src/**` / `src/**` — 不动代码
- v2.0 tag — 不重新打（已存在）
- STATE.md 其他段落（M4 阶段任务表 line 1067/1071 是任务定义非决策状态，按 §2.4 最小化影响不动）

## 纪律核对

- [x] CLAUDE.md §2.4 谨慎修改文件 — 只改 2 个文件 + commit 1 个已写好文件
- [x] CLAUDE.md §10 不修改 SPEC / 不动 tag
- [x] 影响未超 2 文件需列白名单 — 已列（实际编辑 2 个）
- [x] 不写代码 / 不编译 / 不 ship
- [x] STATE.md 只改拍板两行，不动其他
