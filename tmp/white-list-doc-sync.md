# doc-sync 白名单 (3 文件, auto 模式)

## 改动范围

| 文件 | 改前 | 改后 | 操作 |
|---|---|---|---|
| `.planning/STATE.md` | 1136 行 | 1182 行 (+46) | prepend YAML frontmatter + Current Position + Recent Work + Decisions + Known Issues 段;原 M1.x/M2.x 历史保留 |
| `.planning/PROJECT.md` | 117 行 | 126 行 (+9) | 新增 Current Milestone 段;Validated 加 M2.17 + M3.1~M3.10 共 12 项;Active 清空已 ship 仅留 M4.1~M4.6 |
| `.planning/ROADMAP.md` | 359 行 | 357 行 (-2) | Progress 段表格 11 phase 数据行替换为 v2.0 ship;Execution Order 移除状态修饰词;`## Progress` heading + table headers 不动 |

## 未改文件 (per task 约束)

- ❌ CLAUDE.md
- ❌ SPEC.md
- ❌ 任何 src/ / src-tauri/ 文件
- ❌ .planning/HANDOFF.json (项目自有格式, 不是 gsd 链)
- ❌ .planning/ROADMAP.md.bak (备份)
- ❌ .planning/WATCHDOG.json
- ❌ .planning/.continue-here.md
- ❌ .planning/phases/ (gsd 阶段产物)
- ❌ ROADMAP.md 的 phase heading (`## Progress` + table headers)

## 影响范围
仅 planning 文档同步, 不影响运行时行为, 不影响 gsd parser (verified: phase_count: 11 仍识别)。