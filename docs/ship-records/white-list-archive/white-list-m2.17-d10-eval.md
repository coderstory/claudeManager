# §2.4 白名单 — M2.17 D10 评估 (Subagent C)

> **CLAUDE.md §2.4** 谨慎修改文件纪律: 任何变更影响超过 2 个文件时,先列白名单给用户确认。
> **本任务范围**: 仅新建 1 个文件,**不修改任何源文件**。

## 白名单 (1 个新文件)

| # | 文件路径 | 类型 | 行数(估) | 用途 |
|---|---|---|---|---|
| 1 | `docs/investigations/m2.16-limitations-eval.md` | 新建 (md) | ~290 | D10 决策产出: 17 MEDIUM/LOW 限制评估,每条 3 段子结构 (现状/建议/派单) + 表格式总览 + 决策一致性 |

## 校验产物 (3 个,非源文件)

| # | 文件路径 | 类型 | 用途 |
|---|---|---|---|
| 1 | `tmp/reviews/m2.17-d10-eval-self.md` | 新建 (md) | §6 自审 (auto 模式 1 步): 自审方法 / 决策一致性 / 风险点 |
| 2 | `tmp/white-list-m2.17-d10-eval.md` | 新建 (md) | §2.4 白名单 (本文件) |
| 3 | `tmp/test-failures-m2.17-d10-eval.md` | 新建 (md) | §5 测试失败项登记 (本任务无测试,N/A) |

## 显式不动文件

- ❌ `src-tauri/src/**` (后端 Rust 代码) — 不修改
- ❌ `src/**` (前端 TS/TSX/CSS) — 不修改
- ❌ `Cargo.toml` / `package.json` — 不修改
- ❌ `SPEC.md` — CLAUDE.md §10 禁改
- ❌ `.planning/research/**` — CLAUDE.md §10 禁改
- ❌ `.planning/STATE.md` — 主 session 独占
- ❌ `.planning/HANDOFF.json` — 主 session 独占
- ❌ `docs/ARCHITECTURE.md` / `docs/BUILD.md` / `docs/SIGNING.md` — 不修改
- ❌ `docs/milestones/*` — 不修改 (003-L M2-final-report 落地是 M2.17 业务副线,非本任务范围)

## 修改方式

- ❌ 禁 `git add .`
- ✅ `git add docs/investigations/m2.16-limitations-eval.md tmp/reviews/m2.17-d10-eval-self.md tmp/white-list-m2.17-d10-eval.md tmp/test-failures-m2.17-d10-eval.md` (主 session 收报告后统一 commit)

---

*Subagent C 白名单遵守 §2.4 纪律: 1 个新文件 + 3 个校验产物 = 4 个 md 写入,不动任何源文件。*
