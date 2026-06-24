# White-List D-槽4 (M3.8 调研) — §2.4 文件修改白名单

> **作者**: Subagent D-槽4
> **日期**: 2026-06-22
> **任务**: M3 启动门 D-槽4 (M3.8 用量查询方向调研)
> **范围**: 2 个新建文档, 0 个修改文档
> **目的**: CLAUDE.md §2.4 "任何变更影响超过 2 个文件时, 先列白名单给用户确认"

---

## 新建文件清单 (2 个)

| # | 绝对路径 | 类型 | 行数 | 用途 |
|---|---|---|---|---|
| 1 | `D:\project\winui3\docs\investigations\m3-8-usage-bug.md` | 调研报告 | ~280 行 | M3.8 用量查询 bug 根因排查 + 3 修复路径对比 |
| 2 | `D:\project\winui3\docs\design\cc-switch-usage-pattern.md` | 设计文档 | ~320 行 | cc-switch-main JSONL 用量读法调研 + 本项目集成路径 |

## 修改文件清单 (0 个)

**无修改**。本次任务严格遵守:
- ❌ 不写任何 `src/` 或 `src-tauri/` 代码
- ❌ 不触碰其他 D-槽范围 (project.rs / marketplace.rs / json-editor / usage service)
- ❌ 不触碰 `.planning/STATE.md` / HANDOFF.json / PROJECT.md / ROADMAP.md
- ❌ 不 git commit / git push

## 辅助文件 (非 ship, 不计入白名单)

| 路径 | 用途 | 备注 |
|---|---|---|
| `D:\project\winui3\tmp\reviews\m3.8-investigation-self.md` | §6 自审记录 | tmp/ 不入版本控制, 仅 subagent 内部审计用 |

## 验证

- ✅ 2 个新建文件, 符合任务 brief "新建 2 文档"
- ✅ 0 个修改文件, 符合任务 brief "不写代码"
- ✅ 不触碰其他 D-槽范围 (交叉验证见 §严禁 段)
- ✅ auto 模式: 失败不阻塞, 本白名单仅做记录