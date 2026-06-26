---
phase: 10-m39-sql-import
verified: 2026-06-26T01:47:40Z
status: gaps_found
score: 4/5 must-haves verified
behavior_unverified: 0
behavior_unverified_items: []
re_verification: false
overrides_applied: 0
overrides: []
gaps:
  - truth: "校验失败 ErrorBanner + 错误详情 — driven by frontend sql-validator's 5-scenario pre-flight (empty / encoding_error trigger ErrorBanner before backend call)"
    status: failed
    reason: "Phase 10's frontend sql-validator was wired into import-sql/index.tsx (handleFileChosen + initialFilePath effect) in commit 3ed3ff3 (2026-06-22), but was REMOVED by commit 6f5f365 (2026-06-25, 'feat(sql-import): GBK/GB18030/Big5/UTF-16 编码探测 + 解码') under 'Phase 2 方案 D 第一变体: 跳过前端 validateSql'. The current import-sql/index.tsx has two comments (lines 122, 161) that explicitly state the validator is skipped. The 5-scenario pre-flight (empty / encoding_error → ErrorBanner before IPC) is not active in the current codebase. Validation now relies on backend parse_sql_preview's skipped_lines for all scenarios — different mechanism, no frontend pre-flight."
    artifacts:
      - path: "src/pages/import-sql/index.tsx"
        issue: "No import of validateSql; lines 122 and 161 explicitly comment '跳过前端 validateSql'; frontend pre-flight is bypassed."
      - path: "src/lib/sql-validator.ts"
        issue: "Library exists with 5-scenario implementation (336 lines) and 14 passing tests, but is now an orphan — zero production call sites."
    missing:
      - "Either re-wire validateSql in handleFileChosen + initialFilePath useEffect (matches Phase 10's SUMMARY contract), or amend the SUMMARY/ROADMAP to record the deliberate bypass and update the success criterion. Current state is 'library present + tests pass' but 'not integrated', which contradicts the shipped SUMMARY."
---

# Phase 10: M3.9 SQL 导入命名 + 校验 (清单 2/21) Verification Report

**Phase Goal:** 菜单改名 + SQL 文件 schema 校验 + 部分合法 dry-run 预览 (清单 2 P1 + 清单 21 P1)
**Verified:** 2026-06-26T01:47:40Z
**Status:** gaps_found
**Score:** 4/5 must-haves verified

## Goal Achievement

### Observable Truths (from ROADMAP.md Phase 10 success_criteria)

| #   | Truth                                                                                       | Status     | Evidence                                                                                                                                                                                                                                                              |
| --- | ------------------------------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 菜单/页面标题 "SQL导入" → "SQL导入配置"                                                      | VERIFIED   | All 5 surfaces updated: `AppSidebar.tsx:65` `short: 'SQL导入配置'`; `App.tsx:97` `title: 'SQL导入配置'`; `import-sql/index.tsx:290` H1 `'SQL导入配置'`; `plugins/stubs/import-sql.tsx:9,14,20`; `src-tauri/src/plugins/stubs/import_sql.rs:2,12,18`. Test assertion updated: `src/__tests__/pages/import-sql.test.tsx:147` `getByRole('heading', { name: 'SQL导入配置' })`. |
| 2   | SQL schema 校验 (cc-switch 格式: CREATE TABLE providers / INSERT statements)                 | VERIFIED (library only) | `src/lib/sql-validator.ts` exists (336 lines), implements `validateSql()` returning 5-scenario `SqlValidationResult` with INSERT/CREATE/PRAGMA/BEGIN/COMMIT/OTHER classification and target-table extraction for `providers` / `mcp_servers`. 14 tests pass. **However: zero production call sites in current codebase** (see Gap #1). |
| 3   | 校验失败 ErrorBanner + 错误详情                                                              | PARTIAL    | `ErrorBanner` component is imported in `import-sql/index.tsx:35` and rendered at line 970 (data-testid="import-sql-error"). The error state is reached on `parseSqlPreview` throw (line 134, 182, 201) — driven by backend parse error, NOT by the Phase 10 frontend validator. Phase 10's documented flow (pre-flight `empty` / `encoding_error` → ErrorBanner before IPC) is **not active**. |
| 4   | 部分合法时 dry-run 预览 (列出将导入的 N 条 + 跳过的 M 条)                                     | VERIFIED   | `import-sql/index.tsx` Preview component renders `data-testid="import-sql-stat-importable"` and `import-sql-stat-skipped"` (lines 443, 449). The counts come from `preview.importable` / `preview.skipped` (backend `SqlPreview`). The "partially valid" dry-run UX works, but the frontend sql-validator's `importableCount`/`skippedCount` (the source Phase 10 planned) is bypassed. |
| 5   | 5 场景测试: 合法 / 非法 / 部分合法 / 空文件 / 编码错误                                       | VERIFIED   | `src/__tests__/lib/sql-validator.test.ts`: 5 `describe` blocks for `valid` / `partially_valid` / `illegal` / `empty` / `encoding_error`, plus 7 `splitStatements` edge cases = 14 tests, all pass. 22 tests in `import-sql.test.tsx` also pass. Combined 36/36.                                                                                                                                       |

**Score:** 4/5 ROADMAP success criteria fully verified, 1 partial (#3). Plus 1 gap on the deeper question of "is the pre-flight validator actually integrated?" — see gaps.

### Required Artifacts (from PLAN frontmatter)

| Artifact | Expected                                                | Exists | Substantive | Wired | Status                                  |
| -------- | ------------------------------------------------------- | ------ | ----------- | ----- | --------------------------------------- |
| `src/components/AppSidebar.tsx`         | short label "SQL导入配置"                       | YES    | YES         | YES   | VERIFIED                                |
| `src/App.tsx`                            | PAGE_META.title "SQL导入配置"                  | YES    | YES         | YES   | VERIFIED                                |
| `src/pages/import-sql/index.tsx`         | H1 heading "SQL导入配置"                       | YES    | YES         | YES   | VERIFIED                                |
| `src/plugins/stubs/import-sql.tsx`       | stub displayName "SQL导入配置"                 | YES    | YES         | YES   | VERIFIED                                |
| `src-tauri/src/plugins/stubs/import_sql.rs` | stub name "SQL导入配置"                      | YES    | YES         | YES   | VERIFIED                                |
| `src/lib/sql-validator.ts`              | 5-scenario SQL pre-flight classifier          | YES    | YES (336 LOC) | **NO** | ORPHANED (zero call sites)              |
| `src/__tests__/lib/sql-validator.test.ts` | 14 unit tests covering 5 scenarios + edges  | YES    | YES (14 tests) | n/a  | VERIFIED                                |
| `src/__tests__/pages/import-sql.test.tsx` | H1 assertion update to "SQL导入配置"         | YES    | YES         | YES   | VERIFIED                                |

### Key Link Verification

| From                                  | To                          | Via                                          | Status                | Details                                                                                                                |
| ------------------------------------- | --------------------------- | -------------------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| import-sql page handleFileChosen      | sql-validator.validateSql   | call + scenario check                        | **NOT_WIRED**         | Comments at import-sql/index.tsx:122, 161 explicitly say "跳过前端 validateSql" (Phase 2 bypass)                        |
| import-sql page initialFilePath effect| sql-validator.validateSql   | call + scenario check                        | **NOT_WIRED**         | Same comments; `readSqlFile` is called but `validateSql` is not                                                       |
| sql-validator tests                   | sql-validator source        | import { validateSql, splitStatements }      | WIRED                 | Tests pass (14/14)                                                                                                     |
| AppSidebar                            | import-sql route            | short label → navigation item                | WIRED                 | `short: 'SQL导入配置'` is rendered in sidebar                                                                          |

### Behavioral Spot-Checks

| Behavior                                                           | Command                                                  | Result            | Status   |
| ------------------------------------------------------------------ | -------------------------------------------------------- | ----------------- | -------- |
| sql-validator test suite passes                                    | `npx vitest run src/__tests__/lib/sql-validator.test.ts` | 14/14 passed      | PASS     |
| import-sql page test suite passes                                  | `npx vitest run src/__tests__/pages/import-sql.test.tsx` | 22/22 passed      | PASS     |
| H1 assertion uses "SQL导入配置"                                    | grep `getByRole('heading', { name: 'SQL导入配置' })`     | match at line 147 | PASS     |
| sql-validator is a usable library (5 scenarios)                    | `grep "scenario" src/lib/sql-validator.ts`               | 5 values present  | PASS     |
| sql-validator is wired into the page                               | `grep "import { validateSql" src/pages/import-sql/index.tsx` | NO MATCH       | **FAIL** |

### Anti-Patterns Found

| File                              | Line | Pattern | Severity | Impact                                                                                          |
| --------------------------------- | ---- | ------- | -------- | ----------------------------------------------------------------------------------------------- |
| `src/pages/import-sql/index.tsx`  | 122  | "跳过前端 validateSql" comment (Phase 2 bypass)   | WARNING | Documents a deliberate design decision, but creates truth drift with SUMMARY.md & ROADMAP SC.  |
| `src/pages/import-sql/index.tsx`  | 161  | "跳过前端 validateSql" comment (Phase 2 bypass)   | WARNING | Same as above.                                                                                  |
| `src/lib/sql-validator.ts`        | 35   | "把 `validateSql` 移到 `lib/api/sql.ts`" — future-deferred item   | INFO | The library's own header notes it may be moved/re-wired later. Matches current state.           |

No `TODO` / `FIXME` / `unimplemented!` / `placeholder` / `stub` markers in any Phase 10 file.

### M5-ANALYSIS Bug #2 — SkippedLine 'name' field

**Status: RESOLVED** (as a side note, not the focus of Phase 10)

- `src-tauri/src/infrastructure/sql_parser.rs:90-99` — `pub struct SkippedLine { pub line: usize, pub name: Option<String>, pub reason: String, ... }` (the `name` field is present)
- `src/types/provider.ts:77-80` — `export interface SkippedLine { line: number; name?: string | null; reason: string; }`
- Added in commit `8c3853a` (2026-06-26, M5 fix #8)

## M3.9 Phase Timeline Reconstruction

The Phase 10 SUMMARY is **historically accurate** (the wiring existed at phase-ship time on 2026-06-22) but **stale** (the wiring was removed 3 days later on 2026-06-25). This is the root cause of the gap.

| Date       | Commit    | Change                                                                              |
| ---------- | --------- | ----------------------------------------------------------------------------------- |
| 2026-06-22 | `3ed3ff3` | M3.9 Phase 10: adds sql-validator.ts + wires it into import-sql page (handleFileChosen + initialFilePath effect) |
| 2026-06-25 | `6f5f365` | "Phase 2 方案 D 第一变体: 跳过前端 validateSql" — bypasses Phase 10's wiring; backend now does encoding detection |
| 2026-06-26 | `530d734` | Adds per-row provider entry validation (different mechanism, NOT re-wiring Phase 10's 5-scenario pre-flight) |
| 2026-06-26 | `8c3853a` | M5 fix #8: adds `name` field to `SkippedLine` (Rust + TS)                            |

## Human Verification Required

None — all Phase 10 artifacts are either verified by code reading + test execution, or the gap is structurally observable from grep.

## Gaps Summary

**One structural gap (not a stub, not a crash, but a documented-vs-actual drift):**

- **Phase 10's frontend 5-scenario pre-flight SQL validator is bypassed in the current codebase.** The `src/lib/sql-validator.ts` library exists with a complete 5-scenario implementation and a 14-test suite that all pass, but it has **zero production call sites** in the current `import-sql/index.tsx`. The phase's SUMMARY.md claims it was "integrated" (and historically that was true at phase-ship time on 2026-06-22), but commit `6f5f365` (2026-06-25) explicitly removed the wiring under a "Phase 2 方案 D 第一变体" comment. The 5-scenario ErrorBanner trigger flow (empty / encoding_error → ErrorBanner before backend IPC) is therefore not active.

- **Impact assessment:** the user-facing flow still works — the backend `parseSqlPreview` returns a `SqlPreview` with `skipped` and `importable` counts, and the page renders them in the dry-run preview. The 5-scenario *frontend* classifier is functionally redundant with backend diagnostics (which the SUMMARY itself acknowledges: "把诊断交由既有 preview / skipped 流程"). So the gap is a **truth-drift / documentation-vs-code gap**, not a functional gap.

- **What needs to happen to close:** either (a) re-wire `validateSql` into `import-sql/index.tsx` to match the SUMMARY contract, or (b) amend the Phase 10 SUMMARY + ROADMAP success criterion #3 to record the deliberate Phase 2 bypass (e.g., change "校验失败 ErrorBanner + 错误详情" to "校验失败 ErrorBanner + 错误详情 (by backend parser; frontend pre-flight deferred)"). Option (b) is cheaper and matches the current architecture (single source of validation = backend Rust parser); option (a) keeps the SUMMARY honest.

The remaining 4 of 5 success criteria are clearly VERIFIED.

---

_Verified: 2026-06-26T01:47:40Z_
_Verifier: Claude (gsd-verifier)_
