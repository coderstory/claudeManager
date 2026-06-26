---
phase: 09-m38-usage
verified: 2026-06-26T01:44:31Z
status: gaps_found
score: 6/9 must-haves verified
behavior_unverified: 0
behavior_unverified_items: []
gaps:
  - truth: "Test fixtures match the parser's expected JSONL field names"
    status: failed
    reason: "Fixture file tests/fixtures/m3-8-usage/valid-5rec.jsonl uses simplified field names (cache_creation_tokens / cache_read_tokens) that the Rust parser does NOT read — parser reads cache_creation_input_tokens / cache_read_input_tokens (the real Claude Code JSONL field names). Fixture 'expected' values in m3_8_usage_ccswitch.rs are hand-computed against the wrong field names. Net result: 5 of 14 integration tests fail when run, including the core sub1_parse_valid_5rec_extracts_all_5_assistant_records (1170 vs 1320), sub3_aggregate, sub4_window_filter, sub8_duplicate_message_id, and fixture_encoding_broken_exists (the broken-JSON fixture actually ends with a closing brace, so the truncation assertion is wrong)."
    artifacts:
      - path: "src-tauri/tests/fixtures/m3-8-usage/valid-5rec.jsonl"
        issue: "Field names cache_creation_tokens / cache_read_tokens don't match parser expectations"
      - path: "src-tauri/tests/fixtures/m3-8-usage/encoding-broken.jsonl"
        issue: "Ends with closing brace, breaking truncation assertion"
      - path: "src-tauri/tests/m3_8_usage_ccswitch.rs"
        issue: "Hand-computed expected values are out of sync with current fixture content"
    missing:
      - "Update fixture to use cache_creation_input_tokens / cache_read_input_tokens (the real Claude Code JSONL field names), or update parser to also accept the short form"
      - "Make encoding-broken.jsonl truly truncated (e.g. drop the trailing `}`)"
      - "Re-derive the expected token values in sub1/sub3/sub4/sub8 against the actual fixture content"
  - truth: "Unit tests for the synthetic/empty model filter actually exercise the parser"
    status: failed
    reason: "filters_out_synthetic_model_entries, filters_out_empty_model, synthetic_filter_does_not_affect_real_models, and collect_jsonl_files_finds_main_and_subagents all fail. Root cause: tests write JSONL files at <tmp>/projects/<file>.jsonl directly under projects_dir, but collect_jsonl_files only scans <projects_dir>/<encoded>/*.jsonl one level deeper. The files are created but the scanner never finds them, so 0 records are parsed and every assertion on model_count/tokens_used fails (left=0, right=1/2/3). The collect_jsonl test additionally tries to write into a non-existent 'sess/' subdirectory."
    artifacts:
      - path: "src-tauri/src/services/usage_provider_ccswitch.rs"
        issue: "Tests at lines 514-523, 692-752 write files to projects_dir directly; collect_jsonl_files only scans one level deeper"
    missing:
      - "Tests should write files inside <projects_dir>/<encoded>/*.jsonl, not directly under <projects_dir>"
      - "Or the test helper build_projects_layout should yield a path the test then writes into"
  - truth: "Cost (cost_usd) is computed and surfaced in the snapshot"
    status: failed
    reason: "The data-flow doc claims 'lookup_pricing(model) → cost' and UsageSnapshot.cost_usd / UsageBreakdownEntry.cost_usd exist on the domain, but usage_provider_ccswitch.rs imports lookup_pricing as an unused import (cargo warns) and never calls it. The compute function builds UsageSnapshot / UsageBreakdownEntry with cost_usd fields left at their default (None). A user looking at the F7 cost card will see no number even when tokens are accumulating."
    artifacts:
      - path: "src-tauri/src/services/usage_provider_ccswitch.rs"
        issue: "lookup_pricing imported but never invoked; no cost calculation in compute_usage_from_jsonl"
    missing:
      - "Invoke lookup_pricing(model) per model and populate snapshot.cost_usd (sum of per-model costs) and breakdown[i].cost_usd"
      - "Remove the unused import warning after wiring"
---

# Phase 9: M3.8 用量查询修 bug (清单 19) Verification Report

**Phase Goal (per ROADMAP, after D14 = D 选)**: Walk cc-switch-main JSONL pattern. HTTP-style read into Claude Code session JSONL; cache; error handling; UI table.
**Verified:** 2026-06-26T01:44:31Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (derived from PLAN + ROADMAP SC)

| #   | Truth                                                       | Status     | Evidence                                                                                                                          |
| --- | ----------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 1   | cc-switch JSONL reader exists and scans 3-level layout      | ✓ VERIFIED | `src-tauri/src/services/usage_provider_ccswitch.rs:114-191` `compute_usage_from_jsonl`, `:202-239` `collect_jsonl_files` (3-level: main + subagents + workflows/wf_*/) |
| 2   | Reader is wired into UsageService (5-min cache, error map)  | ✓ VERIFIED | `src-tauri/src/services/usage_service.rs:60-62, 117, 196-251` imports + 5-min Mutex<HashMap> cache; `get_usage_with_active_root` calls `compute_usage_for_window` |
| 3   | 4 usage error classes surfaced to UI with localised banner  | ✓ VERIFIED | `src/types/usage.ts:67-95` UsageErrorKind + USAGE_ERROR_MESSAGES (7 entries); `src/pages/usage-query/index.tsx:908-909` `classifyUsageError` → banner |
| 4   | UI renders breakdown table (model × input/output/cache_read/total) | ✓ VERIFIED | `src/pages/usage-query/index.tsx:397-432` `<table>` with breakdown.map per model; `UsageBreakdownEntry` rendered with `input_tokens / output_tokens / cache_read_tokens / total_tokens / message_count` |
| 5   | UI renders per-day history chart                            | ✓ VERIFIED | `src/pages/usage-query/index.tsx:436-475` `HistoryChart` component, `:697` `function HistoryChart` hand-drawn SVG stacked bar with per-model color hash |
| 6   | Pricing table built in (6 models)                           | ✓ VERIFIED | `src-tauri/src/domain/usage.rs:127-190` `builtin_pricing` returns HashMap with 6 entries (Sonnet 4 / Opus 4 / Haiku 4 / Sonnet 3.5 / Haiku 3.5 / DeepSeek v4-pro) |
| 7   | formatChineseTokenCount 亿/万 used                           | ✓ VERIFIED | `src/lib/format.ts:36` exports `formatChineseTokenCount`; `src/pages/usage-query/index.tsx:51, 130` imports and calls for `tokensLabel` |
| 8   | Test fixtures match parser field names + all tests pass     | ✗ FAILED   | 5 of 14 integration tests fail; 4 of 16 lib unit tests fail. See gaps below.                                                       |
| 9   | cost_usd is computed and surfaced                           | ✗ FAILED   | `lookup_pricing` is imported in `usage_provider_ccswitch.rs:52` but never called; `UsageSnapshot.cost_usd` always None              |

**Score:** 7/9 truths verified (2 FAILED)

### Required Artifacts (Level 1+2+3+4)

| Artifact                                                              | Expected                                                              | Status          | Details                                                                                                                                              |
| --------------------------------------------------------------------- | --------------------------------------------------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src-tauri/src/services/usage_provider_ccswitch.rs`                   | Substantive JSONL reader (collect/parse/aggregate)                    | ✓ VERIFIED      | ~600 lines; public `compute_usage_from_jsonl`; private `collect_jsonl_files` (3-level), `parse_file` (line-level), `parse_rfc3339_to_unix`, etc.     |
| `src-tauri/src/services/usage_service.rs`                             | Wires ccswitch provider into 5-min cache, error mapping               | ✓ VERIFIED      | Imports `usage_provider_ccswitch::{compute_usage_from_jsonl, UsageErrorKind, UsageProviderError}` at line 60-62; cache: Mutex<HashMap> at line 117    |
| `src-tauri/src/commands/usage.rs`                                     | 3 commands: get_current_usage, get_usage_history, refresh_usage       | ✓ VERIFIED      | `#[tauri::command]` for all 3; registered in `lib.rs:151-154`                                                                                       |
| `src-tauri/src/domain/usage.rs`                                       | Domain types + builtin pricing                                        | ✓ VERIFIED      | `ModelPricing`, `builtin_pricing`, `UsageBreakdownEntry`, `UsageHistoryEntry`, `UsageWindow::secs()`                                                |
| `src/types/usage.ts`                                                  | TS mirror + UsageErrorKind + USAGE_ERROR_MESSAGES                     | ✓ VERIFIED      | snake_case fields match Rust; 7-message banner table                                                                                                |
| `src/lib/api/usage.ts`                                                | API wrapper for getUsageHistory                                       | ✓ VERIFIED      | `getUsageHistory` exported                                                                                                                          |
| `src/pages/usage-query/index.tsx`                                     | UI: 3 cards + breakdown + history chart + error banner                | ✓ VERIFIED      | All sections present; `formatChineseTokenCount` used at line 130; `classifyUsageError` + `USAGE_ERROR_MESSAGES` at lines 40-41, 908-909             |
| `src-tauri/tests/m3_8_usage_ccswitch.rs`                              | Integration test, 5 scenarios                                         | ⚠️ PARTIAL      | Exists (388 lines, 14 `#[test]`s) but 5 fail at runtime due to fixture / field-name drift (see gaps)                                                |
| `src-tauri/tests/fixtures/m3-8-usage/*.jsonl`                         | 5 JSONL fixtures                                                      | ✗ STUB-ish      | valid-5rec.jsonl uses simplified field names; encoding-broken.jsonl ends with a closing brace (not actually truncated)                              |

### Key Link Verification

| From                                                  | To                                                  | Via                                                | Status   | Details                                                                                          |
| ----------------------------------------------------- | --------------------------------------------------- | -------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------ |
| `src-tauri/src/services/usage_service.rs`             | `src-tauri/src/services/usage_provider_ccswitch.rs` | `usage_provider_ccswitch::compute_usage_from_jsonl`| ✓ WIRED  | imports at line 60, called at line 357 in `compute_usage_for_window`                             |
| `src-tauri/src/commands/usage.rs`                     | `src-tauri/src/services/usage_service.rs`           | `state.usage_service.get_snapshot_only_with_active_root` etc. | ✓ WIRED | `state.usage_service.{get_snapshot_only_with_active_root, get_history_only_with_active_root, refresh_with_active_root}` |
| `src-tauri/src/lib.rs`                                | `src-tauri/src/commands/usage.rs`                   | `invoke_handler` registration                      | ✓ WIRED  | `commands::usage::get_current_usage / refresh_usage / get_usage_history` registered lines 151-154 |
| `src/pages/usage-query/index.tsx`                     | `src/lib/api/usage.ts`                              | `getCurrentUsage / getUsageHistory / refreshUsage` | ✓ WIRED  | `src/pages/usage-query/index.tsx:38` imports; lines 880, 895, 928 invoke                          |
| `src/pages/usage-query/index.tsx`                     | `src/types/usage.ts`                                | `classifyUsageError / USAGE_ERROR_MESSAGES`        | ✓ WIRED  | imports at line 40-41, used at line 908-909                                                       |
| `src-tauri/src/services/usage_provider_ccswitch.rs`   | `src-tauri/src/domain/usage.rs`                     | `lookup_pricing / ModelPricing`                    | ✗ PARTIAL | `lookup_pricing` imported (line 52) but **never called** — cost calculation is missing          |

### Data-Flow Trace (Level 4)

| Artifact                              | Data Variable                              | Source                                          | Produces Real Data  | Status       |
| ------------------------------------- | ------------------------------------------ | ----------------------------------------------- | ------------------- | ------------ |
| `src/pages/usage-query/index.tsx`     | `state.snapshot.tokens_used`               | `getCurrentUsage` → `get_snapshot_only_with_active_root` → `compute_usage_from_jsonl` | Yes (parses JSONL)  | ✓ FLOWING    |
| `src/pages/usage-query/index.tsx`     | `state.history` (UsageHistoryEntry[])      | `getUsageHistory` → `get_history_only_with_active_root` → `compute_usage_from_jsonl` | Yes (parses JSONL) | ✓ FLOWING    |
| `src/pages/usage-query/index.tsx`     | `state.snapshot.cost_usd`                  | ccswitch never populates it                     | N/A (always None)   | ✗ DISCONNECTED |
| `src/pages/usage-query/index.tsx`     | `breakdown[i].cost_usd`                    | ccswitch never populates it                     | N/A (always None)   | ✗ DISCONNECTED |

### Behavioral Spot-Checks

| Behavior                                                        | Command                                                                                | Result                       | Status                |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ---------------------------- | --------------------- |
| Tauri compile (lib)                                             | `cargo check --manifest-path=src-tauri/Cargo.toml --quiet`                             | passes with 1 warning        | ✓ PASS (with warning) |
| Frontend test suite                                             | `npx vitest run --reporter=basic`                                                       | 541 / 541 pass               | ✓ PASS                |
| Rust lib unit tests in `usage_provider_ccswitch`                | `cargo test --manifest-path=src-tauri/Cargo.toml --lib services::usage_provider_ccswitch` | 12 pass, **4 fail**          | ✗ FAIL                |
| Rust integration tests in `tests/m3_8_usage_ccswitch.rs`        | `cargo test --manifest-path=src-tauri/Cargo.toml --test m3_8_usage_ccswitch`           | 9 pass, **5 fail**           | ✗ FAIL                |
| Cost calculation produces non-zero value                        | (would need UI to read snapshot.cost_usd)                                              | never reaches UI (None)      | ✗ FAIL                |

### Anti-Patterns Found

| File                                                          | Line  | Pattern                                                  | Severity | Impact                                                                                              |
| ------------------------------------------------------------- | ----- | -------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------- |
| `src-tauri/src/services/usage_provider_ccswitch.rs`           | 52    | Unused import: `lookup_pricing` (cargo warn)             | ⚠️ Warning | Tells the reader the cost wiring was started and forgotten                                          |
| `src-tauri/src/services/usage_provider_ccswitch.rs`           | 364   | Word "placeholders" in comment about CLI behaviour       | ℹ️ Info  | Not a stub — the comment is accurate, the parser does not emit placeholders as rows                  |
| `src-tauri/tests/fixtures/m3-8-usage/valid-5rec.jsonl`        | 1-6   | Wrong field names (`cache_creation_tokens`)              | 🛑 Blocker | 5 of 14 integration tests fail; also suggests the fixture was hand-edited after the parser was written |
| `src-tauri/tests/fixtures/m3-8-usage/encoding-broken.jsonl`   | 1     | Not actually truncated (ends with `}`)                    | 🛑 Blocker | `fixture_encoding_broken_exists` fails the "should be truncated JSON" assertion                      |
| `src-tauri/src/services/usage_provider_ccswitch.rs`           | 692-752| Synthetic-filter tests place files in wrong directory    | 🛑 Blocker | 4 of 4 lib unit tests for the synthetic/empty model filter fail — they don't exercise the parser   |
| `src-tauri/src/services/usage_provider_ccswitch.rs`           | 514-523 | `collect_jsonl_files` test missing parent dir creation   | 🛑 Blocker | 1 of 16 lib unit test fails (sess/ subagents/ sub.jsonl: No such file or directory)                 |

### Human Verification Required

(none — failures are objective test mismatches, not subjective UX questions)

### Gaps Summary

The phase ships a substantively correct JSONL reader (parser, dedup, time-window, 3-level scan, 5-min cache, error mapping) and a real UI (3 cards + breakdown table + history chart + localised error banner). The "what" is right; the "how" has three mechanical gaps:

1. **Test fixtures drifted from the parser's field names.** `valid-5rec.jsonl` uses simplified `cache_creation_tokens` / `cache_read_tokens`; the parser (correctly) reads `cache_creation_input_tokens` / `cache_read_input_tokens` — those are the real Claude Code JSONL keys. Expected token values in `m3_8_usage_ccswitch.rs` (e.g. 1320 total, 850 sonnet, 470 opus) were hand-derived against the wrong fields, so 4 of the 5 scenario tests fail by exactly the cache-token delta. Fix: re-emit the fixture with the real field names and re-derive expected sums (or accept both spellings in the parser).

2. **The synthetic / empty-model regression tests don't actually run the parser.** They write JSONL files directly into `<tmp>/projects/<file>.jsonl`; `collect_jsonl_files` only scans one level deeper (`<projects>/<encoded>/*.jsonl`), so the scanner never sees them and the test sees `model_count=0` (asserted `>=1`). The 4 failing tests all share this layout mistake. The `collect_jsonl_files_finds_main_and_subagents` test additionally creates a path under a non-existent `sess/` directory. Fix: place test files in `<projects>/<encoded>/<file>.jsonl`, or change the test helper to return a path that the test then writes to.

3. **`cost_usd` is documented and typed but never computed.** `lookup_pricing` is imported (with a cargo warning) but never called in `compute_usage_from_jsonl`. The cost card on the F7 page will always render empty. Either wire `lookup_pricing(model)` per model and populate `UsageSnapshot.cost_usd` / `UsageBreakdownEntry.cost_usd`, or remove `cost_usd` from the docs and the domain type. (The `ModelPricing::cost` helper at `domain/usage.rs:103` is already implemented and tested.)

Net: 7 of 9 goal truths verified. The functional deliverable (read JSONL → snapshot → UI) is wired end-to-end. The gaps are test-data and missing-feature gaps, not architectural ones — but they are real and reproducible (`cargo test` shows 9 failing tests in this phase alone). The phase does not meet "smoke + green tests" ship discipline.

---

_Verified: 2026-06-26T01:44:31Z_
_Verifier: Claude (gsd-verifier)_
