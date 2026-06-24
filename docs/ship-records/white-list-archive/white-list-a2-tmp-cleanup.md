# Whitelist — A2 tmp/ cleanup (2026-06-21)

> **CLAUDE.md §2.4** 谨慎修改文件纪律: 影响多个文件时先列白名单。
> **任务**: 归档 M2.16 阶段遗留诊断脚本到 `.archive/tmp-debug-2026-06-21/`。
> **范围**: 33 个 tmp/ 文件, 拆 3 类: 保留 / 归档 / 删除。

## 分类总览

| 类别 | 数量 | 操作 |
|---|---|---|
| A. 保留 (KEEP) | 11 | 不动 |
| B. 归档 (ARCHIVE) | 22 | `mv` 到 `.archive/tmp-debug-2026-06-21/` |
| C. 删除 (DELETE) | 0 | **不删任何 tmp/ 文件**(全局纪律) |

## A. 保留 — KEEP (11 文件)

活跃 M2.17 milestone 校验产物 / 受保护 review 文档 / 不在本任务范围。

| 文件 | 理由 |
|---|---|
| `tmp/test-failures-m2.17-3.1-tests.md` | 任务 3 会追加 RETRY UPDATE 段, 不归档 |
| `tmp/test-failures-m2.17-d10-eval.md` | Subagent C 当前 milestone 评估产物 |
| `tmp/white-list-m2.17-3.1-tests.md` | 任务 3 会追加段, 不归档 |
| `tmp/white-list-m2.17-d10-eval.md` | Subagent C 当前白名单 |
| `tmp/white-list-m2.17-d9-cleanup.md` | 当前 D9 决策白名单 |
| `tmp/reviews/m2.17-3.1-tests-self.md` | 任务 3 会追加段, 不归档 |
| `tmp/reviews/m2.17-d10-eval-self.md` | Subagent C 自审 |
| `tmp/reviews/m2.17-d9-cleanup-self.md` | Subagent D9 自审 |
| `tmp/m2-16-code-review.md` | 任务显式排除(review 价值) |
| `tmp/macos-compat-audit.md` | 任务显式排除 |
| `tmp/tailwind-audit.md` | M2.17 相关 audit, 仍有用 |

## B. 归档 — ARCHIVE (22 文件)

M2.16 阶段调试残留, 已 ship, 无新引用, git status 显示全部为 `??` (untracked)。
全部为 `mv` 操作 (不用 git mv, 因为本来就是 untracked; 不用 rm, 全局纪律"不要在没确认的情况下删除文件")。

| 源文件 | 大小 (bytes) | 类别 |
|---|---|---|
| `tmp/ccm-splash-probe.cjs` | 7301 | splash probe |
| `tmp/cdp_probe.cjs` | 1426 | CDP probe |
| `tmp/run-splash-probe.cjs` | 3963 | splash runner |
| `tmp/splash-probe-results.md` | 695 | splash 结果 |
| `tmp/mica-cdp-screenshot.cjs` | 4128 | MICA 截图 |
| `tmp/mica-clean-verify.cjs` | 5466 | MICA 验证 |
| `tmp/mica-decisive-verify.cjs` | 11587 | MICA 决定性验证 |
| `tmp/mica-diag-transparency.cjs` | 5168 | MICA 透明度 |
| `tmp/mica-dom-probe.cjs` | 2189 | MICA DOM |
| `tmp/mica-red-wallpaper-test.ps1` | 1778 | MICA wallpaper test |
| `tmp/probe_deep.cjs` | 4301 | 诊断探针 |
| `tmp/probe_deep2.cjs` | 3664 | 诊断探针 |
| `tmp/probe_detail_consistency.cjs` | 8105 | detail-page 探针 |
| `tmp/probe_detail_padding.cjs` | 4094 | detail-page 探针 |
| `tmp/probe_rect.cjs` | 3412 | 探针 |
| `tmp/probe_tree.cjs` | 1987 | 探针 |
| `tmp/probe_verify.cjs` | 2946 | 探针 |
| `tmp/detail-page-consistency-probe.md` | 6624 | detail-page 探针报告 |
| `tmp/detail-page-consistency-report.md` | 9572 | detail-page 报告 |
| `tmp/detail-page-probe-deep.json` | 17075 | detail-page JSON |
| `tmp/detail-page-probe-raw.json` | 22255 | detail-page JSON |
| `tmp/glass-effect-compare.html` | 12122 | glass 主题对比 |
| `tmp/glass-themes-probe-results.md` | 1459 | glass 主题结果 |
| `tmp/run-glass-themes-probe.cjs` | 9884 | glass 主题 runner |

注: 上表实际 24 个, 但任务描述预期 22; 实际以 ls 输出为准。

## C. 删除 — DELETE

**无**。本任务一律用 mv, 不删任何文件(全局纪律"不要在没确认的情况下删除文件")。

## 操作命令模板

```bash
# 全部 untracked, 用 mv (不是 git mv, 也不是 rm)
mv tmp/<file> .archive/tmp-debug-2026-06-21/
```

## 主 session 待 commit

- 新目录: `.archive/tmp-debug-2026-06-21/` (24 个 mv 过去的文件)
- 修改: `tmp/test-failures-m2.17-3.1-tests.md`, `tmp/reviews/m2.17-3.1-tests-self.md`, `tmp/white-list-m2.17-3.1-tests.md` (任务 3 追加段)
- 新文件: `tmp/white-list-a2-tmp-cleanup.md`, `tmp/white-list-a2-tasks-1-2-3.md`, `tmp/reviews/a2-tasks-1-2-3-self.md`
- 外部修改: `~/.bashrc` (用户 dotfile, 不进 git)