---
subsystem: plugin-system
reviewer: opencode (minimax/MiniMax-M3)
reviewed_at: 2026-06-27T02:06:06Z
scope: src-tauri/src/plugins/ (host, traits, mod, stubs), src/plugins/ (frontend registry), App.tsx routing, plugin-registry.test.ts
target_branch: master
project: Claude 配置管理器 — Tauri v2
---

# Plugin System Code Audit — opencode

<output>
Now I have all the data. Here is the audit report.

---

# Plugin System Code Audit — claude_config_manager

## CRITICAL

- **C1: `init_all` aborts on first failure — already-initialized plugins orphaned** — `src-tauri/src/plugins/host.rs:91-101`. Uses `?` (early return) inside the init loop. If the 3rd plugin's `init()` returns `Err`, plugins 4-N never run but plugins 1-2 have already initialized. No deferred cleanup is triggered; the early plugins' `shutdown()` is never called. Fix: catch errors per-plugin, call `shutdown()` on already-initialized plugins, then return the first error.

- **C2: No lifecycle state machine — `init_all` and `shutdown_all` not idempotent** — `host.rs:91-101,106-125`. No flag tracks whether `init_all` has been called. Calling `init_all` twice calls `init()` on every plugin a second time. Similarly `shutdown_all` can be called multiple times. If a `shutdown()` implementation is not idempotent (e.g., drops a file lock), the second call corrupts state. Fix: add `initialized: bool` field; `init_all` returns `Ok(())` if already true; `shutdown_all` clears it.

- **C3: F6 mcp-management backend stub provides route `/mcp` but `App.tsx` has no rendering branch** — `src-tauri/src/plugins/stubs/mcp_management.rs:14-19` returns `PluginRoute { path: "/mcp", ... }`. `src/App.tsx:613-640` has no `view === 'mcp-management'` branch — the `McpManagementPage` import at line 68 is unused (per "Phase 27 Fix 6"). The backend advertises a route the frontend never mounts. The dead frontend stub `src/plugins/stubs/mcp-management.tsx` renders an unreachable `McpPage`. Fix: either remove the backend F6 stub's route or add the rendering branch.

## HIGH

- **H1: F2 provider-switch is an orphan backend stub with no frontend counterpart** — `src-tauri/src/plugins/stubs/provider_switch.rs` is registered in `mod.rs:41` but `src/plugins/registry.ts` has no entry, `src/plugins/stubs/mod.ts` has no export, and no `provider-switch.tsx` file exists. Test (`plugin-registry.test.ts:6`) claims "F2 merged into F1 action button" but the backend still carries a registered stub. Either remove `ProviderSwitchPlugin` from the backend or add a frontend stub.

- **H2: `PluginContext` lacks an event bus, command registry, or service locator** — `src-tauri/src/plugins/traits.rs:68-88`. Carries only `Option<&AppHandle>` and `&dyn IPlatformPaths`. A real plugin in M2+ (e.g., F6 MCP management) would need to register Tauri IPC commands and emit/receive events during `init()`. The only way to register commands is via `tauri::Builder::invoke_handler` at setup time, which happens before `PluginHost::init_all`. This means plugins cannot register commands from `init()`. Fix: add a `CommandRegistry` or require plugins to declare commands statically in their struct.

- **H3: `unregister()` removes plugin from `HashMap` before calling `shutdown()` — data loss on failure** — `host.rs:65-73`. `self.plugins.remove(id)` at line 67-68 returns `Option<Box<dyn IPlugin>>`; if `plugin.shutdown()` at line 70 returns `Err`, the `Err` propagates but the plugin is already gone from the map. Future `unregister()` calls for the same id get `NotFound`, and no retry is possible. Fix: call `shutdown()` while the plugin is still in the map; remove only on success.

- **H4: Zero panic recovery in lifecycle methods** — `host.rs:91-125`. If any plugin's `init()`, `shutdown()`, `routes()`, or `services()` panics, the process terminates (or the `Mutex` poisons). The `RunEvent::Exit` handler at `lib.rs:500-508` ignores a poisoned `Mutex` but that's only at app exit. Fix: use `std::panic::catch_unwind` around lifecycle calls on the plugin boundary (but requires `UnwindSafe` on the trait).

- **H5: `CLAUDE.md §3.3` still claims "12 stubs"** — `CLAUDE.md:62` says "stubs/ — 12 个功能模块的 stub" and lines 92-96 list F1-F24. Two stubs (F4 deeplink-import, F8 single-file-deploy) were removed but the doc was not updated. `src-tauri/src/plugins/mod.rs:10` correctly says "10 stub plugins". Fix: update `CLAUDE.md` stub count to 10 and reflect removed F-numbers.

## MEDIUM

- **M1: Frontend test silently accepts a wrong stub count** — `src/__tests__/plugin-registry.test.ts:6-11`. Tests `ALL_PLUGINS.length === 9` with a comment explaining removals. If a developer accidentally adds or removes a stub, the test comment would need updating but the count assertion could match coincidentally. No cross-validation against the backend's 10 plugins exists. Fix: add a test that fetches the backend plugin count (via Tauri IPC) and asserts frontend-backend parity, OR add a separate expected-id list.

- **M2: `CLAUDE.md` lists F1-F24 but only F1-F7, F16-F19 are stubbed; F20-F24 have no stubs** — `CLAUDE.md:92-96`. Features F8-F15, F20-F24 have no plugin stubs at all. Some (F20 single-instance, F10 drag-drop) are implemented directly in `lib.rs` without plugin wrapping. This means the plugin system is not the universal feature encapsulation mechanism the spec describes. Fix: either create stubs for F8-F15/F20-F24 or update `CLAUDE.md` to reflect that only F1-F7/F16-F19 are plugins.

- **M3: F6 frontend stub `McpPage` is dead code** — `src/plugins/stubs/mcp-management.tsx:8-10` creates `McpPage` which is only referenced inside its own `FrontendPlugin` object. Since no `App.tsx` branch renders this plugin's route and no other code imports `McpPage`, it is compile-time dead. Fix: remove the frontend stub if F6 is truly abandoned as a standalone view, or restore its rendering branch.

## LOW

- **L1: `all_services()` creates new heap allocations every call** — `host.rs:86-88`. Each call re-invokes `services()` on every plugin, allocating new `Box<dyn PluginService>` items. Services are never cached or deduplicated. Fine for M1 stubs (empty lists) but wasteful for M2+. Fix: cache services at initialization time (once after `init_all`).

- **L2: Backend stub route paths are hardcoded with no central constant** — `src-tauri/src/plugins/stubs/*.rs`. Every `PluginRoute { path: "/..." }` is a string literal duplicated across backend stubs, frontend stubs, and `App.tsx` view branches. A rename (e.g., `/resources` → `/browse`) requires editing 3 files with no compile-time cross-check. Fix: define route path constants in `src-tauri/src/plugins/traits.rs` (or a shared `routes.rs`) and reference them in both Rust and TypeScript.

- **L3: F2 removal rationale is described as "merged" but the backend plugin still exists** — `src/__tests__/plugin-registry.test.ts:6-10`. The comment says "F2 removed — its action now lives on the F1 [激活] button". If the action lives on F1, the backend `ProviderSwitchPlugin` should either be removed or its registration should be removed from `mod.rs`. Its continued presence with no frontend binding creates confusion.

## Coverage gaps (tests / contracts not enforced)

1. **No cross-registry parity test**: The frontend test asserts `ALL_PLUGINS.length === 9` with no IPC call to validate against the backend's 10. A test registering a new backend stub without a frontend counterpart would pass.

2. **No lifecycle failure tests**: The backend `host.rs` tests cover `init` failure (line 377-382) but no test verifies that `init_all` calls `shutdown()` on already-initialized plugins when a later plugin fails.

3. **No `unregister`-after-shutdown-failure test**: The `host.rs` tests cover successful `unregister` (line 322-335) but not the case where `unregister`'s internal `shutdown()` call fails.

4. **No idempotency tests**: Neither `init_all`-twice nor `shutdown_all`-twice is tested.

5. **No service injection test**: `all_services()` is never called in any test.

6. **No panic recovery test**: No test verifies that a panicking plugin doesn't corrupt `PluginHost` state.

7. **No `PluginContext` null-handle test**: No test verifies that plugins receiving `app: None` (the test constructor path) gracefully degrade rather than panic.

8. **No route shape SBE (specification-based equivalence) test**: No automated comparison between backend `all_routes()` output and frontend `ALL_ROUTES`. A path mismatch between the two sides goes undetected.

## Stub ↔ F-number mapping table

| Stub (backend) | F-num | Backend 6-method impl | Frontend registry | App.tsx route | M-stage claim | Mismatch? |
|---|---|---|---|---|---|---|
| `provider_list.rs` | F1 | ✅ id, name, routes | ✅ `provider-list.tsx` | ✅ `view === 'provider-list'` | Stub (M1) | Route path `/` vs. rendered via `view`, not React Router — vestigial contract |
| `provider_switch.rs` | F2 | ✅ id, name only (action) | ❌ No frontend stub | N/A action-only | Stub (M1) | **Orphan** — backend registered, frontend missing |
| `import_sql.rs` | F3 | ✅ id, name, routes (`/import`) | ✅ `import-sql.tsx` | ✅ `view === 'import-sql'` | Stub (M1) | None |
| *(removed)* | F4 | N/A | N/A | N/A | Removed per `0ff5b86` | None |
| `json_editor.rs` | F5 | ✅ id, name only (no routes) | ✅ `json-editor.tsx` (routes: []) | ✅ `view === 'json-editor'` | Stub (M1) | None |
| `mcp_management.rs` | F6 | ✅ id, name, routes (`/mcp`) | ✅ `mcp-management.tsx` | ❌ No rendering branch (dead code) | Stub (M1) | **Route orphan** — backend provides `/mcp`, App.tsx doesn't render it |
| `usage_query.rs` | F7 | ✅ id, name only (no routes) | ✅ `usage-query.tsx` (routes: []) | ✅ `view === 'usage-query'` | Stub (M1) | None |
| *(removed)* | F8 | N/A | N/A | N/A | Removed per `M5 #18` | None |
| — | F9-F15 | — | — | — | Never stubbed | CLAUDE.md lists them but no plugin exists |
| `resource_browser.rs` | F16 | ✅ id, name, routes (`/resources`) | ✅ `resource-browser.tsx` | ✅ `view === 'resource-browser'` | Stub (M1) | None |
| `marketplace.rs` | F17 | ✅ id, name, routes (`/marketplace`) | ✅ `marketplace.tsx` | ✅ `view === 'marketplace'` | Stub (M1) | None |
| `optimizer.rs` | F18 | ✅ id, name, routes (`/optimizer`) | ✅ `optimizer.tsx` | ✅ `view === 'optimizer'` | Stub (M1) | None |
| `backup_restore.rs` | F19 | ✅ id, name, routes (`/backup`) | ✅ `backup-restore.tsx` | ✅ `view === 'backup-restore'` | Stub (M1) | None |
| — | F20-F24 | — | — | — | Never stubbed | F20/F21/F10 implemented directly in `lib.rs`/`App.tsx` without plugin |

### Symmetry dead zone

- **Backend stubs**: 10 (F1+F2+F3+F5+F6+F7+F16+F17+F18+F19)
- **Frontend stubs**: 9 (same minus F2)
- **App.tsx view branches**: 12 (`home`, `provider-list`, `import-sql`, `json-editor`, `usage-query`, `resource-browser`, `marketplace`, `optimizer`, `backup-restore`, `history`, `about`, `PluginPlaceholder` fallback)
- **App.tsx pages with real (non-placeholder) components**: 10 (`HomeView`, `ProviderListPage`, `ImportSqlPage`, `JsonEditorPage`, `UsageQueryPage`, `ResourceBrowserPage`, `MarketplacePage`, `OptimizerPage`, `BackupRestorePage`, `HistoryPage`, `AboutPage`) — vastly more pages than frontend stubs because real page components replaced many stubs.

## Risk Assessment

The plugin system architecture (trait + host + stubs) is sound in structure. However, the lifecycle has two critical gaps: `init_all` does not clean up on partial failure, and there is no lifecycle state machine preventing double-init or double-shutdown. These are not exploitable today because all stubs are no-ops, but they will cause real bugs the moment any M2+ plugin has non-trivial `init`/`shutdown` logic. The orphaned F2 and F6 stubs indicate that the plugin registry has drifted from code reality — features are removed or moved without updating the stub set, undermining the "every feature = one plugin" contract. The 40+ Tauri commands registered directly in `lib.rs` (providers, MCP, backup, usage, optimizer, resource, marketplace, project, updater, history) show that real business logic never migrated into plugins; the plugin system remains a stub-only shell while the actual feature work lives outside it. On the positive side, `PluginHost` has good test coverage for happy-path lifecycle, and the frontend registry is cleanly typed. The top risk is that someone adds a real `init` to a plugin without also adding the cleanup-on-failure logic, creating a resource leak on first crash.

## Top 5 fixes (ordered by impact)

1. **Make `init_all` resilient to partial failure** — `src-tauri/src/plugins/host.rs:91-101`. Trap errors per-plugin instead of `?`, call `shutdown()` on already-initialized plugins before returning the first error.

2. **Add lifecycle state machine** — `host.rs:28-34`. Add `initialized: bool` to `PluginHost`. `init_all` checks it (returns `Ok(())` if already true). `shutdown_all` clears it. Prevents double-init and double-shutdown bugs.

3. **Fix `unregister` to call shutdown before removal** — `host.rs:65-73`. Move `self.plugins.remove(id)` after `plugin.shutdown()` (or use a temporary `take` pattern with re-insertion on error).

4. **Resolve F2/F6 orphan stubs** — Either remove `provider_switch.rs` backend registration (H1) and remove `mcp_management.rs` route (C3), or restore frontend bindings. The drift between registered plugins and actual UI routes is a maintenance hazard.

5. **Add cross-registry parity test** — In `plugin-registry.test.ts`, add a test that hardcodes the expected backend plugin id list (`provider-list`, `provider-switch`, `import-sql`, `json-editor`, `mcp-management`, `usage-query`, `resource-browser`, `marketplace`, `optimizer`, `backup-restore`) and asserts the frontend list matches (with explicit notes for known mismatches). This prevents silent registry drift in either direction.
</output>
