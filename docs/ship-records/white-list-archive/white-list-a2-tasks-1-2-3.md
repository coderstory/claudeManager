# Whitelist — A2 Tasks 1/2/3 (subagent A2, 2026-06-21)

> **CLAUDE.md §2.4** 谨慎修改文件纪律 + 全局纪律"批量操作必须有白名单"。
> **任务范围**: 3 项独立修复, 串行执行, 不重叠。

## 任务 1: windres PATH 永久修复

| 文件 | 操作 | 行数 | 理由 |
|---|---|---|---|
| `~/.bashrc` | append 3 行 (含 1 空行) | +3 | Tauri v2 build.rs 需 GNU windres from MSYS2 MinGW, 当前 PATH 缺 `/c/msys64/mingw64/bin` |

**严禁**:
- ❌ 不碰 `~/.bash_profile` / `~/.profile` / `~/.zshrc`
- ❌ 不删 bashrc 现有行
- ❌ 不改 ~/.* 权限

## 任务 2: tmp 探针归档

| 文件数 | 操作 | 目标 |
|---|---|---|
| 24 | `mv tmp/<file> .archive/tmp-debug-2026-06-21/` | 归档 (不删) |
| 0 | `rm` | **全局纪律禁止** |

详细分类见 `tmp/white-list-a2-tmp-cleanup.md`。

## 任务 3: A retry 产物更新

| 文件 | 操作 | 备注 |
|---|---|---|
| `tmp/test-failures-m2.17-3.1-tests.md` | append "## RETRY UPDATE" 段 | 保留原 BLOCKED 段 |
| `tmp/reviews/m2.17-3.1-tests-self.md` | append "## RETRY UPDATE" 段 | 同上 |
| `tmp/white-list-m2.17-3.1-tests.md` | append "## RETRY UPDATE" 段 | 同上 |

## 新增临时产物 (本任务自审)

| 文件 | 操作 | 备注 |
|---|---|---|
| `tmp/white-list-a2-tmp-cleanup.md` | write (new) | 任务 2 分类白名单 |
| `tmp/white-list-a2-tasks-1-2-3.md` | write (new) | 本文件 (3 任务总白名单) |
| `tmp/reviews/a2-tasks-1-2-3-self.md` | write (new) | §6 自审产物 |

## 严禁操作 (整批)

- ❌ `git add` / `git commit` (主 session 统一处理)
- ❌ 改任何 src/ src-tauri/src/ 源文件
- ❌ `cargo build` / `tauri build` (无代码改动)
- ❌ 改 `.planning/STATE.md` / `HANDOFF.json` / `PROJECT.md` / `ROADMAP.md` (主 session 独占)
- ❌ `rm` 任何 `tmp/` 文件

## 主 session 待 commit 清单

```
?? tmp/white-list-a2-tmp-cleanup.md   (新增)
?? tmp/white-list-a2-tasks-1-2-3.md   (新增)
?? tmp/reviews/a2-tasks-1-2-3-self.md (新增)
?? .archive/tmp-debug-2026-06-21/     (新增目录, 24 文件)
 M tmp/test-failures-m2.17-3.1-tests.md       (任务 3 追加)
 M tmp/reviews/m2.17-3.1-tests-self.md        (任务 3 追加)
 M tmp/white-list-m2.17-3.1-tests.md          (任务 3 追加)
```

(注: `~/.bashrc` 是用户 dotfile, **不进 git**, 主 session 已知会 diff。)