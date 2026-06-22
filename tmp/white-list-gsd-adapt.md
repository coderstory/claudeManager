# White-list: gsd-adapt 修改范围

**Date**: 2026-06-22
**Subagent**: GSD-adapt
**Auto 模式**: 是

## 1. 实际修改 (白名单内)

### 改 1 个文件
| 文件 | 操作 | 行数变化 |
|------|------|----------|
| `.planning/ROADMAP.md` | 17 处 `#### Phase M<x>.<y>:` → `### Phase <N>: M<x>.<y> <rest>` | heading 17 行 |
| 备份 | `.planning/ROADMAP.md.bak` (18189 字节) | 不可逆 backup 已留 |

### 新建 11 个目录 + 18 个文件

```
.planning/phases/
├── 01-m217-closeout/
│   ├── 01-m217-closeout-PLAN.md
│   └── 01-m217-closeout-SUMMARY.md
├── 02-m31-startup-optimization/
│   ├── 02-m31-startup-optimization-PLAN.md
│   └── 02-m31-startup-optimization-SUMMARY.md
├── 03-m32-polish/
│   └── 03-m32-polish-PLAN.md
├── 04-m33-rules-16/
│   ├── 04-m33-rules-16-PLAN.md
│   └── 04-m33-rules-16-SUMMARY.md
├── 05-m34-marketplace/
│   ├── 05-m34-marketplace-PLAN.md
│   └── 05-m34-marketplace-SUMMARY.md
├── 06-m35-reveal-bug/
│   └── 06-m35-reveal-bug-PLAN.md
├── 07-m36-provider-crud/
│   ├── 07-m36-provider-crud-PLAN.md
│   └── 07-m36-provider-crud-SUMMARY.md
├── 08-m37-about-page/
│   ├── 08-m37-about-page-PLAN.md
│   └── 08-m37-about-page-SUMMARY.md
├── 09-m38-usage-blocked/
│   └── 09-m38-usage-blocked-PLAN.md
├── 10-m39-sql-import/
│   └── 10-m39-sql-import-PLAN.md
└── 11-m310-dual-mode/
    ├── 11-m310-dual-mode-PLAN.md
    └── 11-m310-dual-mode-SUMMARY.md
```

## 2. 明确未触碰 (按任务约束)

- ❌ `.planning/STATE.md`
- ❌ `.planning/HANDOFF.json`
- ❌ `.planning/PROJECT.md`
- ❌ `CLAUDE.md` / `SPEC.md`
- ❌ `src/`, `src-tauri/`, `docs/`
- ❌ 无 git add / commit / push
- ❌ 无 cargo / npm build
- ❌ 无全局 dotfile
- ❌ 无 rm 操作

## 3. 临时自审文件 (新建,不算白名单外)

| 文件 | 用途 |
|------|------|
| `tmp/reviews/gsd-adapt-self.md` | §6 自审报告 |
| `tmp/white-list-gsd-adapt.md` | 本文件 |

## 4. 备份 (可回滚)

`.planning/ROADMAP.md.bak` — 修改前完整备份,如需回滚 `cp .planning/ROADMAP.md.bak .planning/ROADMAP.md && rm -rf .planning/phases/`。
