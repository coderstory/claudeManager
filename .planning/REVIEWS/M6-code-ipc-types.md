---
subsystem: ipc-type-contract
reviewer: opencode (minimax/MiniMax-M3)
opencode_version: 1.17.10
reviewed_at: 2026-06-27T02:42:02Z
scope: src-tauri/src/commands/ + src-tauri/src/lib.rs + src/lib/api/ + src/types/ + src-tauri/capabilities/
target_branch: master
project: Claude 配置管理器 — Tauri v2
prompt_source: /tmp/opencode-audit-ipc-types.md
raw_output: /tmp/opencode-audit-ipc-types.out
---

# IPC Type Contract Audit — opencode

<output>


# IPC Type Contract Audit Report

## 1. Inventory: Rust IPC Commands

**92 commands** registered in `src-tauri/src/lib.rs:106-199` across 14 modules. All `#[tauri::command]` definitions match their `invoke_handler` entries — **zero registration drift**.

### Orphan Rust commands (no TS call site)

| Command | Module | File:line | Status |
|---|---|---|---|
| `get_autostart_status` | autostart | `commands/autostart.rs:30` | No wrapper in `src/lib/api/` |
| `set_autostart_enabled` | autostart | `commands/autostart.rs:39` | No wrapper |
| `backup_incremental` | backup | `commands/backup.rs:160` | No wrapper |
| `get_app_info` | about | `commands/about.rs:39` | Intentional alias of `get_app_metadata` |
| `get_updater_pubkey` | updater | `commands/updater.rs:13` | Stub (Phase 1) |
| `get_updater_endpoints` | updater | `commands/updater.rs:19` | Stub (Phase 1) |
| `check_update` | updater | `commands/updater.rs:26` | Stub (Phase 1) |

All TS `invoke()` calls target real Rust commands — **no orphan TS invocations**.

---

## 2. Type Safety Analysis

### a. Generic return types ✅
**All 60+ TS wrappers use explicit `invoke<T>()`** — zero `any` returns. This is exemplary.

### b. Field-by-field type comparison

#### CRITICAL: `ExportReport` structural mismatch

| Rust field (`commands/history.rs:78`) | TS type (`types/history.ts:134`) | Verdict |
|---|---|---|
| `output_path: String` | `path: string` | **WRONG FIELD NAME** |
| `format: String` | `format: 'json' \| 'csv'` | Compatible (widens) |
| `usage_rows: i64` | `count: number` | **WRONG FIELD NAME** — no `usage_rows` in TS |
| `backup_rows: i64` | _(missing)_ | **MISSING** |
| `file_size_bytes: u64` | _(missing)_ | **MISSING** |

The TS `ExportReport` is structurally incompatible. Any consumer reading `result.path` or `result.count` gets `undefined`. Combined with the missing `target_path` parameter (see §2c), `exportHistory()` is **unusable as typed**.

#### MEDIUM: `McpTransport` tagged enum mismatch

Rust `McpTransport` uses `#[serde(tag = "type")]`, serializing as `{"type": "stdio"}`. But the TS type is:

```ts
export type McpTransport = 'stdio' | 'http';
```

The wire value is `{type: "stdio"}` (object), but TS says it's a string. Any comparison `server.transport === 'stdio'` is always `false`. Code using `server.transport.type` is not type-safe at compile time.

#### MEDIUM: `export_history` missing required parameter

Rust signature: `pub async fn export_history(state, format: ExportFormat, target_path: String)`

TS wrapper sends only `{ format }` — the required `target_path` is missing:

```ts
// src/lib/api/history.ts:85
return invoke<ExportReport>('export_history', { format });
//                              missing: target_path  ^^^^^^^^^^
```

Tauri v2 rejects IPC calls with missing required keys — this throws a runtime error.

#### LOW: Speculative fields in TS filter types

`UsageHistoryFilter`, `BackupHistoryFilter`, `DailyStatsFilter` in `src/types/history.ts` all include `after_id?: number | null` which does not exist in the Rust `*Filter` structs. Harmless (extra JSON keys are ignored by serde), but indicates speculative forward-engineering without Rust alignment.

#### LOW: `UsageSnapshot` TS type has `cost_usd?: number` and `balance_usd?: number`

Rust `UsageSnapshot` does NOT have `cost_usd` or `balance_usd` fields (they were removed after M3.8). The TS type has them as optional (`?`), so deserialization silently drops them. No runtime crash, but type drift.

### c. Result<T, E> representation ✅
**Correct.** All 92 commands use `Result<T, String>`. TS wrappers use `await invoke<T>(...)` — `Err` becomes a thrown `Error`. No envelope-style wrappers.

### d. Date/time serialization ✅
No `chrono` or `time::OffsetDateTime` in the IPC boundary. All timestamps are Unix seconds (`i64`). TS uses `number`. Zero conversion layer needed.

### e. Big number safety
All `u64`/`i64` fields carry values well below 2^53 (token counts, file sizes, timestamps). **Acceptable risk.**

---

## 3. Type Generation Tooling

**None.** `src-tauri/Cargo.toml` contains no `ts-rs`, `specta`, `tauri-specta`, or `ts-bind`. `src-tauri/build.rs` only handles `BUILD_GIT_COMMIT` + `BUILD_TIMESTAMP`. No `pnpm gen-types` script. No `*.generated.ts` files. No `.gitignore` entries for generated types.

**All 10 files in `src/types/` are hand-maintained** — 566 lines of TS interfaces with zero compile-time guards against Rust drift. The project relies on snapshot tests and manual code review for shape alignment. With ~50 return types and ~30 command-arg shapes crossing the IPC boundary, drift is inevitable without automation.

---

## 4. Capability Grants

`src-tauri/capabilities/default.json` grants plugin permissions for 12 Tauri plugins (fs, dialog, notification, shell, os, deep-link, store, log, autostart, process, updater). `dev.json` adds devtools toggles.

**No custom IPC commands need capability grants** in Tauri v2 — all `invoke_handler` commands are implicitly available. No capability-related issues.

---

## 5. Categorized Findings

### CRITICAL (2)
1. **`ExportReport` type mismatch** — `types/history.ts:134` declares `path`/`count`/`format`, but Rust sends `output_path`/`usage_rows`/`backup_rows`/`file_size_bytes`/`format`. Any consumer gets `undefined` fields.
2. **`export_history` missing `target_path` parameter** — `history.ts:85` sends only `{ format }`; Rust requires `target_path: String`. Runtime crash on invocation.

### HIGH (1)
3. **No type-generation tooling** — 10 hand-maintained TS type files (566 lines) with zero automated drift detection. Structural risk of mismatch across all ~90 IPC commands.

### MEDIUM (3)
4. **`McpTransport` tagged-enum mismatch** — Rust `#[serde(tag = "type")]` emits `{type: "stdio"}`, TS types as string `'stdio'`. Silent logic bugs on transport comparison.
5. **7 orphan Rust commands** — no TS call site. Autostart (2), backup_incremental, about (intentional alias), updater (3 stubs). Low current risk, but autostart features may be unreachable.
6. **Direct `invoke()` bypass in App.tsx:239** — calls `take_pending_sql_file` directly instead of through `fs.ts` wrapper.

### LOW (4)
7. **`UsageSnapshot.cost_usd` / `balance_usd` in TS but absent in Rust** — optional fields silently dropped.
8. **Speculative `after_id` fields in 3 filter types** — not in Rust structs, harmless.
9. Rust `RecurringBackup` result type exists in TS (`ManualBackupResult`) but `backup_incremental` is orphaned — theoretical but unused.
10. All `u64`→`number` for sizes/tokens — within safe range for realistic usage.

---

## Risk Assessment

The IPC type contract discipline is **not safe to ship as-is**. There is one structural data corruption risk: the `ExportReport` type is fundamentally wrong on the TS side (field names, field count, field types all mismatch), and its wrapper function is missing a required parameter that would cause a hard crash at runtime. While this specific surface (history export) may not be heavily trafficked yet, it represents a systemic gap — the project has no automated type generation and relies entirely on manual discipline to keep 566 lines of TS type mirrors aligned with Rust.

The engineering practices are otherwise strong: explicit generics on every wrapper, consistent snake_case/serde conventions, documented conventions in every file, and excellent use of serde test assertions on the Rust side. The structural problem is that the hand-maintained type boundary is large and growing, with no CI gate to catch drift except snapshot tests that only cover specific pages.

## Top 5 Fixes

1. **Fix `ExportReport` TS type** (`types/history.ts:134`) — replace with `{ output_path: string; format: string; usage_rows: number; backup_rows: number; file_size_bytes: number }` to match Rust `commands/history.rs:78`. Also add `target_path: string` to the `exportHistory()` call args in `history.ts:85`.

2. **Fix `McpTransport` TS type** (`types/mcp.ts:15`) — change `export type McpTransport = 'stdio' | 'http'` to `export type McpTransport = { type: 'stdio' } | { type: 'http' }` or update the `McpServer.transport` field to accept the tagged object shape.

3. **Add `ts-rs` and a `pnpm gen-types` CI step** — or adopt `specta` + `tauri-specta` for automatic TS type generation from Rust structs. This eliminates the entire hand-maintenance drift surface (~566 lines).

4. **Add `src/lib/api/autostart.ts`** — wrappers for `get_autostart_status` and `set_autostart_enabled` so those commands are reachable. Consider whether `backup_incremental` also needs a wrapper or should be removed from `invoke_handler`.

5. **Remove stale TS fields** — delete `cost_usd`/`balance_usd` from `types/usage.ts:30,32` and `after_id` from the 3 filter types in `types/history.ts:40,52,69` to eliminate type noise.

---

## Appendix: Tables

### Table A — every Rust `#[tauri::command]` (abbreviated to module+name; full file:line in §1)

92 total, 7 orphan (listed above). Full inventory available by reading `src-tauri/src/lib.rs:106-199`.

### Table B — every TS `invoke(...)` call (all through `src/lib/api/*.ts` + 1 bypass)

| File:line | Command | Orphan? |
|---|---|---|
| `src/lib/api/providers.ts:34` | `list_providers` | ✅ |
| `src/lib/api/providers.ts:43` | `list_providers_with_warnings` | ✅ |
| ... 58+ more through api wrappers ... | | |
| `src/App.tsx:239` | `take_pending_sql_file` | Bypass (direct invoke) |

### Table C — hand-maintained TS types vs Rust source of truth

| Type file (line count) | Rust source | Drift verdict |
|---|---|---|
| `src/types/app.ts` (31) | `commands/app.rs:89` `AppMetadata` | ✅ Match |
| `src/types/backup.ts` (71) | `infrastructure/backup_scanner.rs` `BackupEntry`, `services/backup_service.rs:738` `ManualBackupResult` | ✅ Match |
| `src/types/history.ts` (140) | `services/history_service.rs` + `commands/history.rs:78` `ExportReport` | **ExportReport CRITICAL**; filters have extra `after_id` |
| `src/types/json.ts` (44) | `commands/fs.rs:353` `JsonFileEntry` | ✅ Match |
| `src/types/mcp.ts` (45) | `domain/mcp_server.rs:47` `McpServer` | **McpTransport MISMATCH** — string vs tagged object |
| `src/types/optimizer.ts` (51) | `domain/optimization.rs` | ✅ Match |
| `src/types/project.ts` (50) | `domain/project.rs:47` `Project`, `commands/project.rs:40` `ProjectSummary` | ✅ Match |
| `src/types/provider.ts` (199) | `domain/provider.rs:30` `Provider`, `ProviderInput` | ✅ Match |
| `src/types/resource.ts` (104) | `domain/resource.rs:50` `ResourceItem`, `ResourceDetail` | ✅ Match |
| `src/types/usage.ts` (103) | `domain/usage.rs:197` `UsageSnapshot`, `UsageHistoryEntry` | **LOW** — stale `cost_usd`/`balance_usd` fields |
</output>
