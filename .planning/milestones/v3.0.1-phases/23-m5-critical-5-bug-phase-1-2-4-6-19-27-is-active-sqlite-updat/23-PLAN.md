# Phase 23: M5 critical 5 bug 修复 — Master Plan

**Status**: ready-for-execution
**Goal**: Verify 5 critical bug fixes (commits `8a56d4e` `a588f64` `1c4a64d` `9f4d5bd` `6dc4007`) ship clean on master and all test suites pass
**Depends on**: Phase 22 (M4 e2e framework ship)
**Requirements**: 23-CONTEXT.md §decisions (Q5/Claude's Discretion on 5 开放问题)
**Mode**: Verification-only phase — no new code modifications expected; only test execution + retrospective documentation

## Context Summary

The 5 critical M5 bugs (#2 #4 #6 #19 #27) have already been fixed and committed to master (12 commits ahead of origin). Phase 23 is therefore a **verification + retrospective planning phase**, not an implementation phase. The actual code work is done; we validate that:

1. Each of the 5 fix commits is present, contains the correct file changes, and includes a regression test.
2. `cargo test` passes (5 regression tests + existing).
3. `npm run test` (vitest) passes (5 new vitest + existing).
4. `scripts/test-all.sh` 6-stage gate remains green.
5. macOS 真机验证 is documented as deferred to D6 (or recorded if executed).

## Sub-plan Wave Structure

| Wave | Plan | Type | Purpose |
|------|------|------|---------|
| 1 | 23-01-PLAN.md | execute | T1 verify-shipping: git show 5 commits, confirm fix content + regression tests |
| 2 | 23-02-PLAN.md | execute | T2 verify-rust-tests: cargo test full suite passes |
| 2 | 23-03-PLAN.md | execute | T3 verify-frontend-tests: vitest full suite passes |
| 3 | 23-04-PLAN.md | execute | T4 verify-test-all-6-stages: scripts/test-all.sh all green |
| 4 | 23-05-PLAN.md | execute | T5 manual-smoke: macOS 真机 verification (optional, deferred to D6) |

## Verification Architecture

This phase produces **5 PLAN.md** (one per sub-task) + **5 SUMMARY.md** (written during execution) + **23-VERIFICATION.md** (final goal-backward audit by `gsd-verifier`).

```
23-PLAN.md (master)
├── 23-01-PLAN.md  (T1 verify-shipping)        → 23-01-SUMMARY.md
├── 23-02-PLAN.md  (T2 verify-rust-tests)      → 23-02-SUMMARY.md
├── 23-03-PLAN.md  (T3 verify-frontend-tests)  → 23-03-SUMMARY.md
├── 23-04-PLAN.md  (T4 verify-test-all)        → 23-04-SUMMARY.md
└── 23-05-PLAN.md  (T5 manual-smoke optional)  → 23-05-SUMMARY.md
```

After all 5 plans execute, `gsd-verifier` produces `23-VERIFICATION.md` confirming:
- All 5 fix commits on master match the documented scope
- All 5 regression tests pass
- test-all 6 stages green
- macOS D6 verification status recorded (executed or deferred)

## Must-Have Truths (Phase Goal)

- [ ] 5 fix commits (`8a56d4e` `a588f64` `1c4a64d` `9f4d5bd` `6dc4007`) are present on master with correct file changes
- [ ] Each fix commit includes at least one regression test (cargo or vitest)
- [ ] `cargo test` runs to completion with 0 failures (5 new regression tests pass)
- [ ] `npm run test` (vitest) runs to completion with 0 failures (5 new vitest tests pass)
- [ ] `scripts/test-all.sh` 6 stages all PASS (test-frontend / test-rust / test-frontend-build / test-vite-build / test-smoke / m4-e2e)
- [ ] macOS 真机 verification status documented (or deferred to D6 with rationale)

## Constraints (CLAUDE.md)

- §2.3 version lock: no new dependencies (all 5 fixes use std + pre-locked crates — verified)
- §5.3 M1 acceptance: test-all.sh 5+1 stages must remain green (M4 e2e stage 6 added 2026-06-26)
- §6 review discipline: no silent failure — every fix commit must have a paired regression test
- §10 don'ts: no new code, no scope creep, no architectural changes

## Out of Scope (Deferred)

- Phase 24: B 业务 13 bug (Phase 2)
- Phase 25: C 重构 9 bug (Phase 3)
- Phase 26: A 类 5 bug (Phase 4)
- M6 candidates (performance baseline / tauri-driver macOS / pixel diff / e2e coverage)

## Exit Criteria

Phase 23 is **complete** when:
1. All 5 SUMMARY files exist with concrete pass/fail evidence
2. `23-VERIFICATION.md` written with status `passed` (or `passed with documented limitations`)
3. Phase 24 can be planned with confidence that the critical 5 fixes are stable on master