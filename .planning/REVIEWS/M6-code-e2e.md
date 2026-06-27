---
subsystem: tdd-e2e
reviewer: opencode (minimax/MiniMax-M3)
reviewed_at: 2026-06-27T02:10:58Z
scope: src/__tests__/, tests/e2e/, tests/M4-e2e/, vitest.config.ts, playwright.config.ts, package.json test scripts, .github/workflows/ci.yml
target_branch: master
project: Claude 配置管理器 — Tauri v2
---

# TDD / E2E Test Framework Code Audit — opencode

<output>
Let me read the test setup and all subdirectories in the test areas:
Now let me read the CI workflow, integration tests, and remaining critical files:
Now let me check for the TDD compliance (missing tests for components) and remaining items:
---

# TDD / E2E Test Framework — Audit Report

**Project**: Claude Config Manager (Tauri v2 + React 19 + TypeScript)
**Date**: 2026-06-27
**Auditor**: opencode subagent

---

## 1. Inventory

| Layer | Tool | Files | Tests | Status |
|-------|------|-------|-------|--------|
| Unit (TS) | Vitest + jsdom | `src/__tests__/` (53 files) | 669 | **RED** — 170/669 fail (25.4%) |
| Integration (TS) | Vitest + jsdom | `src/__tests__/integration/` (8 files) | 105 | **RED** — 98/105 fail (93%) |
| E2E (Playwright) | Playwright + CDP | `tests/e2e/` (32 specs) | ~40 | **SKIPPED** — CI e2e job disabled |
| E2E (bash+AX) | Shell + osascript | `tests/M4-e2e/` (15 scenarios) | 15 | **ACTIVE** — macOS shell scripts |
| Rust | cargo test | `src-tauri/tests/` | — | **UNKNOWN** — not audited |

**Combined pass rate (Vitest)**: 499/669 = 74.6%

---

## 2. CRITICAL Findings

### C1. CI e2e job permanently disabled — `ci.yml:125`
File: `.github/workflows/ci.yml:125`
```
if: ${{ false }}
```
The entire `e2e` job is hardcoded to never run. Rationale comment: no green reference run, dev box cannot run `tauri-driver`. This means **zero e2e tests execute in CI**. The `test-frontend` job only runs Vitest unit tests.

### C2. 170 failing Vitest tests — test suite is RED
`npm test -- --run` reports **16/53 test files fail** (30%), **170/669 tests fail** (25%). Root causes:

- **AppSidebar crash** (`src/components/AppSidebar.tsx:152`): `Cannot read properties of undefined (reading 'icon')` — sidebar nav meta objects lack `icon` property. Causes cascading failure in all 7 integration test files that mount `<App />` (App.test.tsx, scroll-layout, m1-9-2, m1-9-3, m2-15-ui-layout, f10-drag-drop, ccm-splash) = 98 failures from this single bug.
- **ViewStateProvider import** (`backup-restore.test.tsx`): "Element type is invalid" — the `wrap()` wrapper's import of `ViewStateProvider` resolves to `undefined`, causing 32 backup-restore failures, 19 usage-query failures, 20 optimizer failures.
- **CSS animation changes** (`m1-9-3.test.tsx:227`): `@keyframes fadeIn` not found in CSS — framer-motion replacement contract broken.
- **Residual `single-file-deploy` refs** (`no-single-file-deploy-refs.test.ts:177`): `src/hooks/useViewState.ts:78/104` still reference the deleted F8 view id.

**Impact**: CI `test-frontend` job runs but passes because... wait, these tests DO fail on CI (`npm test -- --run` fails), so CI should be RED. This means CI may be broken or not running the full suite.

### C3. M1 §5.3 e2e checklist — 2 of 6 items have zero coverage

| Checklist item | Coverage | Evidence |
|---|---|---|
| 1. Launch + window title | ✅ `launch.spec.ts` | Asserts title + heading |
| 2. Tray icon present | ⚠️ `tray.spec.ts` | Only checks IPC bridge, not OS tray |
| 3. Close → hide (not quit) | ⚠️ `close-minimize.spec.ts` | Sends IPC close, can't assert process state from WebView |
| 4. Tray menu items shown | ❌ **NO COVERAGE** | Explicitly deferred to manual smoke test (close-minimize.spec.ts:20) |
| 5. Click "show" → restore window | ❌ **NO COVERAGE** | Requires OS tray interaction, not possible from WebView |
| 6. Click "quit" → process exits | ❌ **NO COVERAGE** | Not tested anywhere in Playwright e2e |

The `M4-e2e/01-launch-tray.sh` scenario partially covers #1+#2 on macOS via `osascript` / `pgrep`, but it's a bash script that runs outside CI.

---

## 3. HIGH Findings

### H1. Three untested features (no e2e, no integration test for F18)
| Feature | Unit test | Integration test | E2E test |
|---------|-----------|-----------------|----------|
| F1 provider-list | ✅ provider-list.test.tsx | ✅ App.test.tsx | ⚠️ m2-1-verify (dev mode) |
| F2 switch | ✅ provider-list.test.tsx | — | — |
| F4 deeplink | — | — | ⚠️ m2-2-6-real-invoke (dev mode) |
| F5 JSON editor | ✅ json-editor.test.tsx | — | ⚠️ m2-4-json-editor (dev mode) |
| F6 MCP | ✅ mcp-management.test.tsx | — | ⚠️ m2-5-mcp-management (dev mode) |
| F7 usage | ✅ usage-query.test.tsx | — | ⚠️ m2-7-usage (dev mode) |
| F13 backup | ✅ backup-restore.test.tsx | — | ⚠️ m2-6-backup-restore (dev mode) |
| F18 optimizer | ✅ optimizer.test.tsx | — | **❌ NO E2E** |
| F19 restore | ✅ backup-restore.test.tsx | — | **❌ NO E2E** |

"Dev mode" = these 32 e2e specs run against `http://localhost:1420` (Vite dev server), not against the real Tauri binary. They assert DOM structure but cannot test IPC commands, tray, window lifecycle, or native file I/O. Only 6 specs import from `fixtures.ts` (CDP endpoint path); all others import directly from `@playwright/test` and run in bare Chromium.

### H2. `F8 single-file-deploy` residual references violate M5 #18 deletion contract
File: `src/hooks/useViewState.ts:78,104`
```
| 'single-file-deploy'
'single-file-deploy',
```
The regression guard `no-single-file-deploy-refs.test.ts` catches these, but they were never cleaned up. This is a real regression: the App.tsx structural test (App.test.tsx:300) that asserts `sidebar-item-single-file-deploy` does NOT appear still passes because the sidebar currently crashes entirely (C2).

### H3. `playwright.config.ts` — tauri-driver not pinned, not installed
File: `playwright.config.ts:1-67`
The config references tauri-driver via comments only. No `@tauri-apps/tauri-driver` in `package.json`. CI installs it via `npm install -g @tauri-apps/tauri-driver` (unpinned). The project uses Playwright CDP mode, not WebDriver/WDIO. The `debuggerAddress` from tauri-driver session is extracted by `scripts/run-e2e.sh` (not audited — may not exist).

---

## 4. MEDIUM Findings

### M1. Two default-exported components lack unit tests
- `src/components/AboutCard.tsx` — no `src/__tests__/components/AboutCard.test.tsx`
- `src/components/InfoSection.tsx` — no `src/__tests__/components/InfoSection.test.tsx`
Violates §2.2 TDD: "任何新功能必须有对应的单元测试 + 集成测试 + UI e2e 测试"

### M2. M4 e2e framework — macOS-only, not in CI
The 15 `tests/M4-e2e/scenarios/*.sh` scripts are bash scripts using `osascript`/`AppleScript` for macOS AX automation. Windows driver is a stub:
```
File: tests/M4-e2e/scenarios/02-list-providers.sh:21-23
if [[ "$(uname -s)" == "Darwin" ]]; ...
else say_warn "02-list-providers.sh: non-macOS — soft-skip"
```
These scenarios do not run in `.github/workflows/ci.yml`. The `run-all.sh` orchestrator has `set -euo pipefail` but `trap cleanup EXIT` may not fire under all failure modes.

### M3. Flakiness sources
- **`setTimeout` in test body**: splash tests (`ccm-splash.test.tsx:67,72`) use 100ms + 400ms delays; e2e tests use `page.waitForTimeout(500)` and `1500` — these are timing-dependent
- **`Date.now()` in test fixture**: `usage-query.test.tsx:68` creates real date objects with `new Date()` — breaks determinism
- **`vi.spyOn(window, 'confirm')` without `restoreAllMocks` in afterEach**: `backup-restore.test.tsx:52` — not all tests call `vi.restoreAllMocks()`
- **WKWebView AX unreliability**: M4 e2e explicitly documents AX as flaky and soft-skips on timeout (scenario 02:37)

### M4. No visual regression testing
No Percy, no Chromatic, no `pixelmatch`, no `@playwright/test` screenshot assertions. `debug-vite.spec.ts` takes screenshots to `tmp/` but only for debugging. `m1-9-2-layout.spec.ts` screenshots to `.planning/diagnostics/` — not compared against baselines.

### M5. Fixture schema drift risk
File: `tests/M4-e2e/fixtures/3-providers.json`
Uses old camelCase format (`baseUrl`, `isActive`, `apiKeyEnv`). The TypeScript `Provider` type uses snake_case (`api_base`, `is_active`, `api_key`). The M4 scenario scripts validate filesystem JSON via `jq`, not the React component rendering. If the fixture falls out of sync with the TS type (per §6.4), filesystem assertions still pass but the app might render incorrectly.

### M6. Coverage tooling not enforced
- `@vitest/coverage-v8` installed but no threshold in `vitest.config.ts`
- No `--coverage` flag in `package.json` test scripts
- No coverage reporting in CI

---

## 5. LOW Findings

### L1. `vitest.config.ts` does not set `clearMocks: true` or `restoreMocks: true`
Each test file must manually call `mockInvoke.mockReset()` in `beforeEach`. Missing this in one file (or adding a new test file without it) leads to cross-test pollution.

### L2. `package.json` test scripts minimal
```
"test": "vitest",
"test:e2e": "playwright test"
```
No `test:coverage`, `test:ci`, `test:integration`, or `--shard` scripts.

### L3. E2E specs use `@playwright/test` import directly (not custom fixtures)
Of 32 e2e specs, only 6 import from `./fixtures` (the custom CDP fixture). The remaining 26 use `import { test, expect } from '@playwright/test'` — they only work in dev-server mode and cannot run against the real Tauri binary. This creates a false sense of "e2e coverage" when in reality these are DOM-smoke tests running in bare Chromium.

### L4. Rust unit tests coverage unknown
`src-tauri/tests/` exists but was not audited. CI runs `cargo test` for Rust but only on Windows, with `--no-default-features` which skips any feature-gated tests.

---

## 6. Risk Assessment

**The TDD/E2E test framework has severe structural problems.** The test suite is RED (25.4% failure rate) due to two root causes: (1) the AppSidebar crashes at runtime because navigation metadata lacks `icon` properties, and (2) the ViewStateProvider import is broken for standalone page tests. These failures are REAL bugs being caught by the test suite — which is exactly what TDD aims for — but they also mean the test gate is effectively non-functional: developers running `npm test` see 170 failures and likely ignore the entire suite.

The CI pipeline provides no e2e coverage at all (JavaScript disabled), and the Playwright e2e specs that do exist run against a Vite dev server (not the real Tauri binary), making them DOM smoke tests rather than true end-to-end tests. The M4 bash-e2e framework covers the right scenarios (launch, tray, provider switching) but only runs on macOS and is excluded from CI.

Of the M1 §5.3 e2e checklist, only 2 of 6 items have any automated coverage; the critical "restore window from tray" and "quit" paths are entirely manual.

---

## 7. Top 5 Fixes (Ranked by Impact)

1. **Fix AppSidebar icon crash — unblocks 98 failing tests**
   - Files: `src/components/AppSidebar.tsx:152`
   - Root cause: sidebar plugin metadata objects lack `icon: string` field
   - Fix: Add `icon` field to all nav meta entries, or add defensive `meta.icon ?? fallbackIcon` fallback

2. **Fix ViewStateProvider import — unblocks 71 additional failing tests**
   - Files: `src/__tests__/pages/backup-restore.test.tsx:25`, `usage-query.test.tsx:24`, `optimizer.test.tsx:69`
   - Root cause: `ViewStateProvider` resolves to `undefined` in the test import graph
   - Fix: Verify the default export in `src/hooks/useViewState.tsx` exists and is importable

3. **Enable CI e2e job & un-skip `if: ${{ false }}`**
   - File: `.github/workflows/ci.yml:125`
   - Remove `if: ${{ false }}` blocker
   - Add `@tauri-apps/tauri-driver` to `package.json` devDependencies with pinned version
   - Add WebView2 bootstrapping step for Windows CI runner

4. **Add M1 §5.3 items 4-6 e2e coverage**
   - Files: `tests/e2e/tray.spec.ts`, `tests/e2e/close-minimize.spec.ts`
   - Add test for tray menu "显示主窗口" interaction (requires either CDP-endpoint approach or Rust-side IPC probe command)
   - Add test for "退出" that asserts clean process exit via `page.isClosed()` + polling `pgrep`
   - Document in CLAUDE.md that these require the real Tauri binary (not dev-server mode)

5. **Clean up residual `single-file-deploy` references and restore F8 regression guard**
   - File: `src/hooks/useViewState.ts:78,104`
   - Remove the two `'single-file-deploy'` entries from the view ID arrays
   - Re-run `no-single-file-deploy-refs.test.ts` to confirm pass
   - Add a README note per §6.4 that deleting a feature requires ALL references cleaned in 4 places (sidebar, ALL_VIEWS, plugin stub, capability grant)

---

**End of report. 16/53 test files audited in depth; all 32 e2e specs and 15 M4 scenarios reviewed.**

</output>
