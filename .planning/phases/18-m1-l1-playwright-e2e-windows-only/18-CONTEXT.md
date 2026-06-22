# Phase 18: M1 L1 Playwright e2e (Windows only) - Context

**Gathered:** 2026-06-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Validate + run the 6 M1.8 Playwright e2e specs against the REAL Tauri WebView2 on the Windows dev box, fixing bugs found (time-boxed). This closes the M1 L1 e2e gap (B1#3 / B2#2): specs were authored in M1.8 but never actually executed locally; a prior v3.0 round 2 attempt wrote the CDP-bridge infrastructure but halted on API 402 quota before validation.

Deliverable: the 6 specs (launch / close-minimize / tray / m1-9-2-layout / m2-3-0-shortcuts-theme / m2-3-2-ui-layout-verify) run green (or skip-with-clear-reason) via `scripts/run-e2e.sh` against the real WebView2, bugs found are fixed (≤30min/spec) or logged for a follow-up task, and the e2e infra WIP is committed.

Out of scope: tauri-driver CI integration, macOS e2e, new spec authoring beyond fixing the existing 6.

</domain>

<decisions>
## Implementation Decisions

### Execution Path
- **Real Tauri WebView2 via tauri-driver + CDP** (not dev-server). All prereqs verified present: `tauri-driver` on PATH (`~/.cargo/bin/tauri-driver`), `msedgedriver.exe` in `%TEMP%` (auto-added to PATH by run-e2e.sh), release exe at `src-tauri/target/release/claude-config-manager.exe` (built 2026-06-22 19:19), `@playwright/test` installed.
- Rationale: dev-server mode (`PLAYWRIGHT_BASE_URL=http://localhost:1420`) cannot exercise `__TAURI_INTERNALS__` IPC, tray icon, or window-close interception — the dimensions CLAUDE.md §5.3 M1 acceptance explicitly requires (启动 / 托盘 / 关闭隐藏 / 退出).
- Dev-server path retained only as a fallback if the real-WebView2 path hits an unrecoverable blocker.

### Spec Scope
- **Run all 6 M1.8 specs** this round (not 1-2). run-e2e.sh launches a fresh app per WebDriver session, so marginal cost per spec is low; §5.3 wants 启动/托盘/关闭 verified and the layout/shortcut/theme specs are cheap once the bridge works.

### Bug-Fix Policy
- **Log + skip, time-box ≤30min/spec.** When a spec fails: attempt a fix for up to 30 min; if it exceeds the budget, record the failure (spec name, error, suspected cause) in the phase SUMMARY + STATE.md known limitations and skip to the next spec. Deep fixes that need architecture changes become their own follow-up task rather than blocking this phase.

### WIP Commit Strategy
- **Checkpoint-commit the existing e2e infra WIP first** (7 files: playwright.config.ts, tests/e2e/fixtures.ts, scripts/run-e2e.sh, 4 modified specs) as a coherent base BEFORE execute-phase runs validation. This preserves the prior session's work and gives execute a clean git tree for atomic fix commits.
- Execute-phase then commits validation results + any fixes on top.

### Quota / Blocker Handling
- **Proceed; pause + report if 402 recurs.** The prior halt was an API quota issue (0 tokens consumed, no commit, no damage). If a dispatched subagent halts on quota again, pause autonomous mode and surface to user rather than burning retries.

### Claude's Discretion
- Exact tauri-driver port choices (defaults 4444/4445 from run-e2e.sh are fine).
- Whether to run specs serially in one `npx playwright test` invocation or one-by-one for finer failure isolation (prefer one-by-one for first validation pass).
- Spec-level micro-fixes (selectors, timeouts, testid alignment) — at Claude's discretion within the 30min box.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `scripts/run-e2e.sh` — full tauri-driver + msedgedriver + CDP orchestration: prereq auto-detect, session creation via `tauri:options.application`, `debuggerAddress` extraction, Playwright `CDP_ENDPOINT` handoff, cleanup trap. Two modes: real WebView2 (default) + dev-server (`PLAYWRIGHT_BASE_URL`).
- `tests/e2e/fixtures.ts` — custom `test` fixture: reads `CDP_ENDPOINT`, connects via `chromium.connectOverCDP()`, grabs the single WebView2 page; falls back to default Playwright `page` when `CDP_ENDPOINT` unset. Re-exports `expect`. The 6 M1.8 specs import `{ test, expect }` from `./fixtures`.
- `playwright.config.ts` — `workers: 1`, `fullyParallel: false` (single-instance app), `baseURL = tauri://localhost` (overridable via `PLAYWRIGHT_BASE_URL`), project `windows` = Desktop Chrome.
- `scripts/kill-app.sh` — used by run-e2e.sh trap for cleanup.
- Release exe already built: `src-tauri/target/release/claude-config-manager.exe`.

### Established Patterns
- Tauri single-instance → one worker, no parallelism (already in config).
- Each spec gets its own app launch (tauri-driver starts fresh process per WebDriver session) → spec order does not share state.
- CDP mode: do NOT close browser/context (tauri-driver owns WebView2 lifetime); disconnect cleanly.

### Integration Points
- run-e2e.sh → tauri-driver (`/session` POST with `tauri:options.application`) → WebView2 CDP `debuggerAddress` → `CDP_ENDPOINT` env var → `tests/e2e/fixtures.ts` `connectOverCDP` → Playwright `page` fixture → specs.
- Specs that poke `window.__TAURI_INTERNALS__.invoke(...)` only work in CDP mode (real WebView2); dev-server mode must skip them with a clear message.

### Uncommitted WIP (to checkpoint-commit before execute)
- Modified: `playwright.config.ts`, `tests/e2e/close-minimize.spec.ts`, `tests/e2e/launch.spec.ts`, `tests/e2e/m1-9-2-layout.spec.ts`, `tests/e2e/m2-3-0-shortcuts-theme.spec.ts`, `tests/e2e/m2-3-2-ui-layout-verify.spec.ts`, `tests/e2e/tray.spec.ts`
- New: `tests/e2e/fixtures.ts`, `scripts/run-e2e.sh`

</code_context>

<specifics>
## Specific Ideas

- Prior session's infra WIP is high-quality and well-commented — build on it, do not rewrite.
- First validation pass: run specs one-by-one (`npx playwright test <spec>`) for clear failure isolation, not all-at-once.
- If a spec's testid/selector has drifted since M1.9, fix the spec (not the app) unless the drift reveals a real app regression.

</specifics>

<deferred>
## Deferred Ideas

- tauri-driver in CI (Windows matrix) — separate task; this phase is dev-box local execution only.
- macOS e2e — D6 Mac 真机验证 is deferred per user decision.
- Authoring new specs beyond the existing 6 — out of scope.
- Deep architectural fixes for any spec that fails beyond the 30min box → own follow-up task.

</deferred>
</content>
