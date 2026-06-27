---
phase: 28-v3-2-m6-13-bug-bug-bz-01-13
plan: 02
subsystem: planning
tags: [stub, m6, deferred, v3.2.1]

# Dependency graph
requires:
  - 28-01 (7 真修 + 6 验证回归测试 ship)
provides:
  - "BUG-BZ-08~13 留空登记 — 推到 v3.2.1 backlog,不阻塞 v3.2 ship gate"
affects:
  - v3.2.1 milestone 启动时补 BUG-BZ-08~13 具体描述

# Tech tracking
tech-stack:
  added: []   # 0 代码改动 (CLAUDE.md §2.3 — 此 plan 全是 markdown)

key-decisions:
  - "本 plan 是 0 代码改动 stub,沿用 27-02 M5-PLAN §6 重构 9 bug stub 模式"
  - "BUG-BZ-08~13 在 v3.2 ship 时仍 [ ] (留空),不进 v3.2 ship scope"
  - "v3.2.1 backlog 段在 REQUIREMENTS.md 创建;State.md D18 决策登记"
  - "docs commit 与 28-01 的 doc 收尾合并到 master merge 前的 .planning/ 三件套更新"

requirements-completed:
  - BUG-BZ-08 (留空)
  - BUG-BZ-09 (留空)
  - BUG-BZ-10 (留空)
  - BUG-BZ-11 (留空)
  - BUG-BZ-12 (留空)
  - BUG-BZ-13 (留空)

# Coverage metadata — drives DETERMINISTIC UAT routing in verify-work
coverage: []   # 0 代码改动,无 coverage

duration: ~1 min (纯文档登记,已在 28-01 merge 前 master 合并时一并更新 .planning/ 三件套)
tasks: 1 (.planning/STATE.md / ROADMAP.md / REQUIREMENTS.md 更新)
---

# Phase 28 Plan 02: v3.2 M6 业务 13 bug — Stub for BUG-BZ-08~13 (v3.2.1 Backlog)

This plan is the sibling stub plan for 28-01 (7 real fixes). Zero code changes; the only work is to formally register BUG-BZ-08~13 as the v3.2.1 backlog so the v3.2 ship gate isn't blocked by 6 undefined slots.

## What this plan does

Per REQUIREMENTS.md §v3.2 Active Requirements and ROADMAP §Plans second paragraph:

> **BUG-BZ-08~13**: (留空待用户实测补)
> **Phase 28 BUG-BZ-08~13**: 留空待用户实测补 (v3.2.1 follow-up)

The 6 slots are M5 33-bug naming-convention placeholders. M6 user feedback after M5 ship only generated 7 actionable bug reports (BUG-BZ-01~07). The remaining 6 slots will get concrete descriptions when users exercise ClaudeManager.app post-v3.2 and file new feedback.

## Artifacts (to be committed in the master-merge docs commit)

- `.planning/STATE.md`:
    - Current Position: Phase 28 marked Complete (28-01 + 28-02 stub)
    - Recent Work: add Phase 28 row + emphasize 28-02 is a stub plan
    - Decisions: add D18 — v3.2 Phase 28 decision (7 bug fixes + 6 deferred to v3.2.1)
    - Known Issues: BUG-BZ-08~13 deferred to v3.2.1
- `.planning/ROADMAP.md`:
    - Phase 28 Plans field: "2 plans (28-01 7 真修 + 28-02 stub 0 代码改动)"
    - Plans list add 28-02-PLAN.md → [x]
    - Phase 28 Success Criteria: all 7 items [x]
- `.planning/REQUIREMENTS.md`:
    - v3.2 Active Requirements → BUG-BZ-01~07 marked [x]
    - BUG-BZ-08~13 remain [ ]
    - Traceability table: BUG-BZ-08~13 rows tagged "⏸ v3.2.1"
    - **New section** "## v3.2.1 Backlog (post-v3.2 follow-up)" listing BUG-BZ-08~13 as deferred slots

## Commits

This stub plan's doc updates are folded into the pre-master-merge commit that also updates the .planning/ three-file set. No separate `docs(28-2)` commit lands on the worktree branch.

## Deviations from Plan

- **No code changes — pure docs.** This is by design; the plan is type: stub (wave 2, depends on 28-01).
- **Docs commit folded.** Rather than landing as a separate `docs(28-2): register BUG-BZ-08~13 as v3.2.1 backlog` commit on the worktree branch, the .planning/ updates go into the pre-master-merge commit alongside the 28-01 SUMMARY/VERIFICATION files. Reduces branch noise; no behaviour difference.
- **Total deviations: 2 (intentional stub design + commit folding).** All per plan §task 1.

## Known Stubs

- BUG-BZ-08~13 remain empty slots — no descriptions, no tests, no fixes. They become real work items when v3.2 ships and users provide feedback on ClaudeManager.app.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: deferred_bugs_undefined | .planning/REQUIREMENTS.md | BUG-BZ-08~13 have no concrete description. If a user reports a bug that should slot here, the next milestone must (1) capture the description, (2) assign to the next available slot (08/09/10...), (3) update the traceability table. |
| threat_flag: docs_in_master_merge | .planning/STATE.md / .planning/ROADMAP.md / .planning/REQUIREMENTS.md | The .planning/ three-file set is updated in a single pre-merge commit. If that commit is lost, the planning artefacts will be out of sync with the branch state. Mitigated by always merging from the worktree branch (where 28-02 SUMMARY.md already references the planned state). |

## Next

Phase 28 complete on master. v3.2 ship gate unblocked. v3.2.1 (next milestone) will pick up BUG-BZ-08~13 once user feedback lands.

CLAUDE.md §10 invariants upheld: zero code changes, zero new dependencies, zero version bumps, zero capabilities changes (this plan touches only markdown).