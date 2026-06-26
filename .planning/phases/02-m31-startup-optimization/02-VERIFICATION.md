---
phase: 02-m31-startup-optimization
verified: 2026-06-26T07:30:00Z
status: gaps_found
score: 2/3 must-haves verified
behavior_unverified: 2
behavior_unverified_items:
  - truth: "e2e cold-start screenshot compare: launch → 1s → 3s → 5s, no white screen + no loading flash"
    test: "Launch /Applications/ClaudeManager.app from cold start, capture screen at 1s/3s/5s, verify no white screen flash and no loading flash"
    expected: "No white flash and no loading flicker across the 5s window"
    why_human: "Visual cold-start timing cannot be observed programmatically; requires Windows runner + tauri-driver (Win-only per CLAUDE.md §13/§15) or macOS 真机 (D6 deferred)"
  - truth: "ship ClaudeConfigManager-M3.1-startup-optimization.exe with smoke 7/7"
    test: "Run scripts/smoke-test.sh on the shipped M3.1 exe and observe all 7 (Windows) / 10 checks pass"
    expected: "All smoke test items PASS"
    why_human: "Smoke test is Windows-only (smoke test 10 项 in CLAUDE.md §13.1); tauri-driver not supported on macOS per CLAUDE-MACOS.md §15"
gaps:
  - truth: "src-tauri/src/lib.rs setup/show timing fix"
    status: failed
    reason: "PLAN.md claims lib.rs setup/show 时序修复 but the M3.1 commit (03e062a) added only 2 lines to lib.rs — and those 2 lines are M3.7's about page command registration, not M3.1 startup timing. No setup/show timing logic was added. The current setup hook (lib.rs:198-460) contains platform init + PluginHost wiring + window-vibrancy setup, but no M3.1 startup timing logic."
    artifacts:
      - path: ".planning/phases/02-m31-startup-optimization/02-m31-startup-optimization-PLAN.md"
        issue: "PLAN.md Implementation section lists 'src-tauri/src/lib.rs (setup/show 时序)' but no such code was added; the M3.1 commit's lib.rs change is actually M3.7's about command"
    missing:
      - "No code change in lib.rs introduces window.show() / setup() timing changes from M3.1"
      - "PLAN.md references src/components/Splash.tsx but the file does not exist (current splash code lives in App.tsx + index.html)"
      - "The actual cold-start splash fix that 'fixes the loading flash' was made in M3.13.2 commit fdaaaa5 (NOT in M3.1)"
deferred: []
overrides: []
overrides_applied: 0
human_verification:
  - test: "Launch /Applications/ClaudeManager.app on macOS, observe cold-start visuals"
    expected: "No white screen, no loading flash; smooth handoff to main UI"
    why_human: "Visual cold-start verification; macOS 真机 D6 deferred per CLAUDE.md §15"
  - test: "On Windows dev box, run scripts/smoke-test.sh against shipped M3.1 exe (30.4 MB)"
    expected: "All 7 (Win) smoke checks PASS"
    why_human: "Win-only smoke test 10/10 framework; tauri-driver does not run on macOS"
  - test: "On Windows dev box with tauri-driver, capture cold-start screenshots at 1s/3s/5s and compare"
    expected: "No white screen, no loading flash across the 5s window"
    why_human: "e2e cold-start screenshot compare is Win-only via tauri-driver + CDP; per CLAUDE.md §13/§15"
---

# Phase 2: M3.1 启动优化 Verification Report

**Phase Goal**: 冷启动事件链路 (Tauri setup → splash → window show → webview ready → first paint) 时序修复 + 透明度闪烁根因 + webview 预加载优化。
**Verified**: 2026-06-26T07:30:00Z
**Status**: gaps_found
**Re-verification**: No — initial verification

## Goal Achievement

### Observable Truths

| #   | Truth   | Status     | Evidence       |
| --- | ------- | ---------- | -------------- |
| 1   | splash hide 触发器修复 (loading 闪烁根因) | ✓ VERIFIED | M3.1 commit 03e062a switched splash hide from `setTimeout(2200)` to `tauri://ready` event listener + 8s failsafe (src/App.tsx:308-396 in M3.1 commit history). Later refined in M3.13.2 (commit fdaaaa5) to React-first-paint after tauri://ready was found unreliable on Win WebView2. Current code in src/App.tsx:348-396 implements double-rAF + MIN_SPLASH_MS=1200ms floor + 8s failsafe + tauri://ready idempotent fallback. |
| 2   | vitest 启动事件 mock 覆盖 setup/show/paint 4 个边界 | ✓ VERIFIED | src/__tests__/components/splash.test.tsx has 4 tests covering (a) main React-first-paint path, (b) 8s failsafe, (c) display:none 300ms after hidden class, (d) tauri://ready backward-compat. All 4 pass. Plus src/__tests__/integration/ccm-splash.test.tsx covers M2.16 baseline. Full suite: 541/541 vitest pass. |
| 3   | ship ClaudeConfigManager-M3.1-startup-optimization.exe (smoke 7/7) | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | SUMMARY.md claims exe shipped (30.4 MB) + smoke 7/7, commit f7196e8. Cannot verify on macOS dev box: (a) tauri-driver is Win-only per CLAUDE.md §13.1, (b) smoke test 10/10 is Win-only per §13.1. Requires Win dev box human verification. |

**Score:** 2/3 truths verified (1 behavior-unverified; runs on Win-only infrastructure)

### Deferred Items

None. Items 3 routes to human_verification (Win-specific tooling), not deferred to a later phase.

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `src-tauri/src/lib.rs` setup/show timing | PLAN claims "setup/show 时序修复" | ✗ MISSING | M3.1 commit 03e062a added only 2 lines to lib.rs — and those 2 lines are M3.7's about command registration (`commands::about::get_app_info`), NOT M3.1 startup timing. No window.show() / setup() timing logic from M3.1 was ever added. |
| `src-tauri/tauri.conf.json` splash config | PLAN claims "splash config" | ✗ STUB | No M3.1 splash-specific config in tauri.conf.json. Window has `visible: true` (line 21) — splash is rendered via inline HTML+CSS in index.html, not via Tauri's native splash API. PLAN claim does not match codebase. |
| `src/components/Splash.tsx` (透明度) | PLAN claims file exists | ✗ MISSING | File does NOT exist. Splash logic lives in `src/App.tsx` (lines 308-396) + `index.html` (lines 47-184 inline CSS+HTML). PLAN.md's claim of modifying `src/components/Splash.tsx` is wrong. |
| `src/main.tsx` (Suspense fallback) | PLAN claims Suspense fallback | ✗ STUB | No Suspense boundary / fallback found in src/main.tsx related to startup. main.tsx contains only standard React mount logic (see src/main.tsx:25-62 comments about Tauri internals mock). |
| `src/__tests__/components/splash.test.tsx` | PLAN claims vitest coverage | ✓ VERIFIED | File exists (177 lines, 4 tests, all pass). Tests cover M3.13.2 React-first-paint + failsafe + display:none timing + tauri://ready backward-compat. |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | --- | --- | ------ | ------- |
| `index.html` splash HTML | `src/App.tsx` useEffect hide | `document.getElementById('ccm-splash')` + `.ccm-splash-hidden` class | ✓ WIRED | App.tsx:349-360 reads splash element + adds hidden class. CSS in index.html:86-88 fades opacity to 0. CSS in index.html:83 has 300ms transition. Wired correctly. |
| `src/App.tsx` React-first-paint | `index.html` inline failsafe | Both call `splash.style.display = 'none'` after class added | ✓ WIRED | App.tsx:357-359 sets display:none 300ms after class added. index.html:197-208 sets display:none at 4500ms failsafe. Both paths converge. |
| `src-tauri/src/lib.rs` setup | webview ready | M3.1 supposed to emit `tauri://ready` event from Rust | ✗ NOT_WIRED | No `app.emit("tauri://ready", ...)` or equivalent in src-tauri/src/lib.rs. The event-driven splash hide path depends on a Tauri runtime event that is never emitted from Rust. This is precisely why M3.13.2 had to switch to React-first-paint. |
| tauri.conf.json `transparent: true` | index.html splash opacity 0.92 | Compose with WebView2 background_color(0,0,0,0) | ✓ WIRED | tauri.conf.json:25 sets transparent:true. lib.rs:404-407 calls `set_background_color(Color(0,0,0,0))` (per comment). Splash opacity 0.92 in index.html:79. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
| -------- | ------------- | ------ | ------------------ | ------ |
| `index.html` splash | `ccm-splash` element | inline HTML (line 47-71) | Yes (static markup) | ✓ FLOWING |
| `src/App.tsx` useEffect hide | `splash` element + `hidden` flag | React mount + double-rAF + MIN_SPLASH_MS floor | Yes (real timing logic) | ✓ FLOWING |
| `src/__tests__/components/splash.test.tsx` | `getSplash()` | jsdom + synthesized DOM + fake timers | Yes (real test execution) | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| cargo check passes | `cd src-tauri && cargo check` | exit 0, 1 unused-import warning (lookup_pricing) | ✓ PASS |
| Full vitest passes | `npx vitest run` | 541/541 pass, 42/42 files | ✓ PASS |
| splash test passes | `npx vitest run src/__tests__/components/splash.test.tsx` | 4/4 pass in 37ms | ✓ PASS |
| Cargo binaries compile | `cargo check` | exit 0 | ✓ PASS |
| Release exe cold-start | `open /Applications/ClaudeManager.app` | NOT RUN (macOS 真机 D6 deferred) | ? SKIP |
| Windows smoke test 7/7 | `scripts/smoke-test.sh` | NOT RUN (Win-only) | ? SKIP |

### Probe Execution

No `scripts/*/tests/probe-*.sh` declared in PLAN/SUMMARY. No probe execution required.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| ----------- | ---------- | ----------- | ------ | -------- |
| 清单 1 (P0) | M3.1 | Cold-start chain (setup → splash → window show → webview ready → first paint) timing fix + opacity flash root cause + webview preload | ⚠️ PARTIAL | Splash hide timing fixed via React-first-paint (current App.tsx:308-396). But: (a) lib.rs setup/show timing never changed in M3.1 (only M3.7's about command added); (b) tauri://ready event never emitted from Rust; (c) webview preload optimization not implemented (no `with_webview` or preload hook in lib.rs setup). |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| `src-tauri/src/services/usage_provider_ccswitch.rs` | 52 | unused import `lookup_pricing` | ℹ️ Info | warning only, no functional impact |
| PLAN.md Implementation list | 6-11 | Lists artifacts (`src/components/Splash.tsx`, `src-tauri/tauri.conf.json splash config`) that don't exist or don't have the claimed changes | ⚠️ Warning | PLAN.md doesn't match codebase — fails the goal-backward check on artifact existence |
| SUMMARY.md | 1-7 | Claims shipped exe + smoke 7/7 without verification trail on Mac dev box | ℹ️ Info | Unverifiable on Mac; requires Win dev box |

### Human Verification Required

The following items cannot be verified on the macOS dev box and require either:
- Windows dev box + tauri-driver + smoke test 10/10 framework
- macOS 真机 (D6 currently deferred per CLAUDE.md §15)

1. **e2e cold-start screenshot compare** — Launch from cold, capture at 1s/3s/5s, verify no white screen and no loading flash. Requires tauri-driver + CDP (Win-only per CLAUDE.md §13.1).

2. **smoke test 7/7 on shipped M3.1 exe** — Run `scripts/smoke-test.sh` against `/Users/coderstory/Desktop/ClaudeConfigManager-M3/ClaudeConfigManager-M3.1-startup-optimization.exe`. Win-only framework; Mac cannot run tauri-driver.

3. **macOS cold-start visual** — On a Mac with `/Applications/ClaudeManager.app`, launch from cold and observe splash handoff. D6 Mac 真机 deferred per CLAUDE.md §15.

### Gaps Summary

**The phase goal "冷启动事件链路 (Tauri setup → splash → window show → webview ready → first paint) 时序修复" is partially achieved but with significant PLAN-vs-codebase drift:**

1. **PLAN.md claims artifacts that don't exist or weren't modified:**
   - `src/components/Splash.tsx` — file does not exist; splash logic is in `App.tsx` + `index.html`
   - `src-tauri/src/lib.rs (setup/show 时序)` — M3.1 commit (03e062a) added only 2 lines, both of which are M3.7's `commands::about::get_app_info` registration, not M3.1 startup timing
   - `src-tauri/tauri.conf.json (splash config)` — no M3.1-specific splash config (the existing `transparent: true` predates M3.1)
   - `src/main.tsx (Suspense fallback)` — no Suspense boundary added in M3.1

2. **The actual splash timing fix was made in M3.13.2, not M3.1:** Commit `fdaaaa5` (M3.13.2) replaced M3.1's `tauri://ready` event-driven approach with React-first-paint + double-rAF + MIN_SPLASH_MS floor after empirically verifying that `tauri://ready` is not reliably dispatched on Win WebView2. This is the current state of `src/App.tsx:308-396`.

3. **`tauri://ready` event is never emitted from Rust:** M3.1's design relied on Tauri dispatching this event, but no Rust code emits it (verified: `grep "tauri://ready\|emit.*ready"` in `src-tauri/src/` returns no matches). The fallback to tauri://ready as an "optional early-hide signal" in the current code (App.tsx:384-385) is therefore effectively dead on all platforms — it can only fire if Tauri's runtime auto-dispatches it, which is unreliable per M3.13.2's commit message.

4. **Win-specific items (smoke test 7/7 + e2e cold-start screenshot compare) require Win dev box + tauri-driver.** Cannot be verified on macOS dev box. Routed to human_verification.

**Phase goal "清单 1 P0 (cold-start chain fix + opacity flash root cause)" — splash hide timing root cause is fixed (via M3.13.2's React-first-paint), but the original M3.1 PLAN.md does not accurately describe what was actually shipped. The `webview 预加载优化` sub-bullet in the ROADMAP goal also appears unimplemented (no preload hook in lib.rs setup).**

---

## Verification Metadata

- **Phase**: 02-m31-startup-optimization
- **Verifier**: Claude (gsd-verifier)
- **Mode**: Initial verification (no prior VERIFICATION.md found)
- **Platform**: macOS 26 (Darwin 25.5.0, arm64)
- **Tooling checks**: cargo check (1 unused-import warning, exit 0), vitest (541/541 pass), splash test (4/4 pass)
- **Anti-pattern scan**: 1 info-level (unused import), 1 warning-level (PLAN.md artifact drift)
- **Git evidence**: M3.1 commit `03e062a` (stall recovery merge) — lib.rs only +2 lines (M3.7's about cmd). Real cold-start splash fix landed later in M3.13.2 commit `fdaaaa5`.
- **Time spent**: ~10 minutes (read-only)
- **Read-only**: Yes — no source files modified