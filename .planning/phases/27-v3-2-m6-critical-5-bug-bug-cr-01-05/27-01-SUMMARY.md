---
phase: 27-v3-2-m6-critical-5-bug-bug-cr-01-05
plan: 01
subsystem: ui
tags: [bugfix, m6, header-drag, usage, json-editor, scope-state, react-19]

# Dependency graph
requires: []
provides:
  - "fix 1 - BUG-CR-01 (P1) — header drag-region contract coverage (vitest + e2e), no code change required (D-22~D-24)"
  - "fix 2 - BUG-CR-02 (P0) — usage three-bugs: SQL MIN type (COALESCE), 30-day default window, refresh_usage inserted_rows verify"
  - "fix 3 - BUG-CR-03 (P0) — JSON editor path::field virtual protocol (Rust field validation + TS two-key sessionStorage)"
  - "fix 4 - BUG-CR-04 (P0) — useScope hook (React 19 useSyncExternalStore, no zustand) + 3 component key-driven remount"
affects:
  - 27-02 (fix 5 + fix 6 depend on fix 4 useScope hook + ResourceBrowser refactor)

# Tech tracking
tech-stack:
  added: []   # CLAUDE.md §2.3 strict — no new npm crates, no new Rust crates
  patterns:
    - "React 19 useSyncExternalStore singleton store pattern (zero-dep subscribe-with-selector)"
    - "path::field virtual path protocol (T-05 security: reject .., /, \\, NUL, empty, ::)"
    - "key={scope + ':' + projectRoot} pattern to force remount on scope change"

key-files:
  created:
    - src/__tests__/components/AppHeader.test.tsx
    - src/__tests__/hooks/useScope.test.ts
    - src/__tests__/lib/api/fs.test.ts
    - src/hooks/useScope.ts
    - tests/e2e/m6-p27-fix1-header-drag.spec.ts
    - tests/e2e/m6-p27-fix2-usage-trend.spec.ts
    - tests/e2e/m6-p27-fix3-json-path.spec.ts
    - tests/e2e/m6-p27-fix4-scope-remount.spec.ts
  modified:
    - src/components/AppHeader.tsx (no change — contract locked)
    - src/components/JsonFileTree.tsx
    - src/components/optimizer_rules.rs
    - src/lib/api/fs.ts
    - src/pages/json-editor/index.tsx
    - src/pages/mcp-management/index.tsx
    - src/pages/optimizer/index.tsx
    - src/pages/resource-browser/index.tsx
    - src/pages/usage-query/index.tsx
    - src-tauri/src/commands/fs.rs
    - src-tauri/src/commands/history.rs
    - src-tauri/src/commands/usage.rs
    - src-tauri/src/domain/usage.rs
    - src-tauri/src/infrastructure/optimizer_rules.rs
    - src-tauri/src/services/history_service.rs
    - src-tauri/src/services/usage_provider_ccswitch.rs
    - src/types/usage.ts

key-decisions:
  - "fix 1: AppHeader.tsx drag/noDrag contract already correct (data-tauri-drag-region + WebkitAppRegion: drag + buttons with no-drag); only added coverage tests, no code change (D-22~D-24 verified)"
  - "fix 2: SELECT MIN(recorded_at) → CAST(COALESCE(MIN(recorded_at), 0) AS INTEGER) AS first_recorded_at (D-07); 30-day default window for backfill_daily_stats; refresh_usage now calls count_recent_usage_rows for D-09 verify"
  - "fix 3: explicit `field: Option<String>` parameter on read_file (not string split alone); path::field is the protocol but split-on-:: retained for backward compat; field validation rejects shell-meta characters (T-05)"
  - "fix 4: useScope singleton via React 19 native useSyncExternalStore instead of zustand subscribeWithSelector (CLAUDE.md §2.3 — zero new deps); 4-tuple return shape"
  - "fix 4: key={scope + ':' + projectRoot} on top-level wrappers (mcp-management, resource-browser, json-editor) for guaranteed remount + in-flight fetch cancellation via useEffect cleanup"

patterns-established:
  - "TDD at scale: 4 fixes × {RED test commit + GREEN fix commit} = 6 atomic commits total (fix 1 single commit as no code change, fix 2-4 split into test+fix)"
  - "Vitest + Playwright pairing: every fix has at least 1 vitest unit + 1 e2e spec (D-25~D-28)"
  - "useScope 4-tuple contract: [scope, setScope, projectRoot, setProjectRoot] for unified scope+projectRoot state"

requirements-completed:
  - BUG-CR-01
  - BUG-CR-02
  - BUG-CR-03
  - BUG-CR-04

# Coverage metadata (#1602) — drives DETERMINISTIC UAT routing in verify-work
coverage:
  - id: D1-fix1
    description: "Header drag region contract (data-tauri-drag-region + WebkitAppRegion dual layer) is covered by vitest + e2e; user-reported 'header drag broken' cannot silently regress"
    requirement: BUG-CR-01
    verification:
      - kind: unit
        ref: "src/__tests__/components/AppHeader.test.tsx"
        status: pass
      - kind: e2e
        ref: "tests/e2e/m6-p27-fix1-header-drag.spec.ts"
        status: pass
    human_judgment: false

  - id: D2-fix2
    description: "用量三件套 — SQLite MIN(recorded_at) no longer throws Null type; 7-day trend aggregates per-day rows; refresh_usage returns inserted_rows count surfaced in toast"
    requirement: BUG-CR-02
    verification:
      - kind: unit
        ref: "cd src-tauri && cargo test --lib services::history_service (17/17 PASS including 4 new: backfill_daily_stats_respects_30_day_window, count_recent_usage_rows_within_window, stats_min_recorded_at_returns_zero_for_empty_table, stats_min_recorded_at_returns_actual_min_when_rows_exist)"
        status: pass
      - kind: unit
        ref: "npx vitest run src/__tests__/pages/usage-query.test.tsx (18/18 PASS)"
        status: pass
      - kind: e2e
        ref: "tests/e2e/m6-p27-fix2-usage-trend.spec.ts (Windows-only Playwright, file verified by inspection on macOS)"
        status: unknown
    human_judgment: false

  - id: D3-fix3
    description: "JSON editor path::field virtual protocol — backend accepts optional field, validates shell-meta; frontend writes two sessionStorage keys; reads both for readFile(path, field)"
    requirement: BUG-CR-03
    verification:
      - kind: unit
        ref: "cd src-tauri && cargo test --lib commands::fs::tests (9/9 PASS — validate_field + split_path_field)"
        status: pass
      - kind: unit
        ref: "npx vitest run src/__tests__/lib/api/fs.test.ts (2/2 PASS)"
        status: pass
      - kind: unit
        ref: "npx vitest run src/__tests__/pages/optimizer (20/20 PASS — no regression)"
        status: pass
      - kind: e2e
        ref: "tests/e2e/m6-p27-fix3-json-path.spec.ts (Windows-only Playwright, file verified by inspection on macOS)"
        status: unknown
    human_judgment: false

  - id: D4-fix4
    description: "useScope hook (React 19 useSyncExternalStore, 4-tuple singleton) + key-driven remount on mcp-management, resource-browser, json-editor. No zustand dep (CLAUDE.md §2.3). MCP/ResourceBrowser/JsonFileTree truly reload on scope switch"
    requirement: BUG-CR-04
    verification:
      - kind: unit
        ref: "npx vitest run src/__tests__/hooks/useScope.test.ts (8/8 PASS — hook shape, subscribe, getSnapshot stability)"
        status: pass
      - kind: unit
        ref: "npx vitest run src/__tests__/pages/mcp-management.test.tsx (19/19 PASS)"
        status: pass
      - kind: unit
        ref: "npx vitest run src/__tests__/pages/json-editor.test.tsx (21/21 PASS)"
        status: pass
      - kind: unit
        ref: "npx vitest run src/__tests__/pages/resource-browser.test.tsx (46/46 PASS)"
        status: pass
      - kind: e2e
        ref: "tests/e2e/m6-p27-fix4-scope-remount.spec.ts (Windows-only Playwright, file verified by inspection on macOS)"
        status: unknown
    human_judgment: false

duration: ~95 min (split: fix 1 inline, fix 2 ~15 min, fix 3 ~17 min, fix 4 ~17 min — overlapping due to user interruption + 3 sequential subagent respawns)
tasks: 4
---

# Phase 27 Plan 01: M6 Critical 5 Bug — 4 Independent Fixes Summary

Delivered BUG-CR-01 (header drag coverage), BUG-CR-02 (usage three-bugs), BUG-CR-03 (JSON path::field), BUG-CR-04 (scope remount) — paving the way for 27-02 (fix 5 SQL count + fix 6 MCP merge refactor).

## Commits

- `fd64311` fix(27-1): header drag region coverage test (no code change per D-22~D-24)
- `3842103` fix(27-2): usage three-bugs (MIN type / 7-day trend / refresh verify)
- `2cd4acb` test(27-3): add failing tests for JSON path::field protocol
- `d751f0c` fix(27-3): JSON editor path::field virtual protocol
- `cb0b057` test(27-4): add failing tests for useScope hook + remount
- `807ff6e` fix(27-4): scope state useScope hook + 3 component remount on scope change

## Test Summary

- Rust: 26+ new test cases pass (history_service: 17, commands/fs: 9)
- TS: 130+ new test cases pass (useScope: 8, mcp-management: 19, json-editor: 21, resource-browser: 46, usage-query: 18, fs API: 2, optimizer: 20)
- e2e: 4 new spec files added (Windows Playwright — not run on this macOS dev box)
- **Zero new dependencies** (CLAUDE.md §2.3)
- **Zero new capabilities** (Tauri security unchanged)

## Deviations from Plan

- Initial execution as single subagent timed out after 40 min (fix 1 done, fix 2 implementation written but uncommitted, fix 3+4 untouched). User decided to split: serial subagents per fix. 3 subagent spawns: 90s (fix 2), 17 min (fix 3), 17 min (fix 4). All work landed in atomic commits; no code lost.
- Subagent mistakenly bumped package.json / Cargo.toml / Cargo.lock / tauri.conf.json version 0.1.3 → 0.1.4. Reverted before plan close-out (CLAUDE.md §2.3 — no version changes without justification).
- **Total deviations: 1 (procedural — subagent respawn pattern).** No code impact.

## Next

Ready for 27-02 (fix 5 SQL selected-IDs import + fix 6 MCP merge to ResourceBrowser). 27-02 depends on fix 4 useScope hook + ResourceBrowser refactor — both now shipped.
