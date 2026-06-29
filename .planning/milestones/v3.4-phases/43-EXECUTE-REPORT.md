# Phase 43 EXECUTE REPORT

**Phase:** 43 — MenuRegistry + tray/AppMenu 注册化
**Date:** 2026-06-28
**Status:** COMPLETE — all 7 tasks shipped

## Commits

| # | Hash | Subject | Files |
|---|---|---|---|
| 1 | `3458d27` | feat(plugins): MenuRegistry::build_tray + install_tray + build_app_menu (W0+W1, Task 1+3+4) | 5 files +528/-26 |
| 2 | `7132ab2` | feat(plugins): core plugin owns tray + macOS AppMenu (W1 Task 5) | 4 files +283/-4 |
| 3 | `8006e15` | refactor(platform): remove IPlatformAppMenu + delegate menus to core-plugin (W2 Task 6) | 9 files +59/-263 (2 deletes) |

W0 commit was combined (Tasks 1+3+4) because the build only succeeds with all 5 files together; splitting would require 3 broken intermediate states.

## Strong acceptances (G-1..G-12 from PLAN §1)

| ID | Status | Evidence |
|---|---|---|
| G-1 | PASS | `grep -nE 'MenuItem::with_id\|on_menu_event' src-tauri/src/lib.rs` (excluding comments) → 0 lines |
| G-2 | PASS | `test -f src-tauri/src/platform/macos/app_menu.rs` → absent; same for `windows/` |
| G-3 | PASS | `grep -rn 'IPlatformAppMenu\|MacAppMenu\|WindowsAppMenu\|app_menu_build_dispatch' src-tauri/src/` → 0 matches |
| G-4 | PASS | `git diff --stat` against pre-Phase-43 baseline shows only `core/mod.rs` is new in `stubs/`; 9 existing stubs untouched |
| G-5 | PASS | `plugins/mod.rs` line 65: `host.register(Box::new(stubs::CorePlugin))?;` — first register call |
| G-6 | PASS | `cargo test --lib plugins::menu_registry` → 3 tests pass |
| G-7 | PASS | `cargo test --lib plugins::traits::tests::default_tray_items_empty` → 1 test passes (plus `default_app_menu_items_returns_empty`) |
| G-8 | PARTIAL | `cargo test --lib plugins::` → 47/47 pass. **Other modules have ~20 pre-existing baseline failures** (commands::fs, commands::updater, commands::history, domain::provider, domain::usage, infrastructure::backup_scanner, infrastructure::deeplink_parser, infrastructure::fs_atomic, infrastructure::json_diff, infrastructure::optimizer_rules) — all unrelated to Phase 43 (verified by stashing local changes and re-running; failures persist on master). |
| G-9 | DEFERRED | `scripts/smoke-test.sh` 10/10 — out of scope here (requires Windows dev box + rebuilt exe). Defer to Phase 47. |
| G-10 | DEFERRED | macOS 真机 4 submenu 可见 — macOS 真机验证 D6 暂缓待 M4 (per CLAUDE.md). |
| G-11 | PASS | `grep -nE 'use tauri::(menu\|tray)' src-tauri/src/lib.rs` → 0 lines (only `tauri::{Emitter, Manager, RunEvent}`) |
| G-12 | NOTE | `grep -rn 'app_menu'` shows matches inside the new plugin API (`all_app_menu_items`, `app_menu_items` method names). The legacy `app_menu.rs` files + `IPlatformAppMenu::build_app_menu` etc. are all gone. Interpreting G-12 as "no legacy IPlatformAppMenu app_menu surface remains" — strict literal grep "0 occurrences" is unachievable since the new plugin trait method is named `app_menu_items()`. |

## Deviations from PLAN

1. **W0 combined commit (Tasks 1+3+4)** — see Commits table above.
2. **`PluginContext::new` signature changed** — PLAN §1 example shows `new(app, paths, host)` (3 args) or `new(app, paths, host, services)` (4 args). Implementation settled on 4 args; `host` parameter is `*const PluginHost` (raw pointer), NOT `&PluginHost`. This was forced by the borrow checker: `init_all` needs `&mut host` for `host.init_all()` while `PluginContext` holds a reference to the same host. Using a raw pointer (with documented `unsafe` contract via the `host()` method accessor) sidesteps the conflict without forcing the entire host through `Arc<Mutex<...>>`. The contract is upheld because `init_all` constructs both the host and the context together; the host lives in `app.manage(Mutex::new(host))` for the lifetime of the app.
3. **`init_all` public signature** — PLAN PITFALL-43-1 mentions splitting into `register_all` + `init_all`. Implementation: kept as a single `init_all(app, paths)` that internally creates the host, registers all stubs, builds the PluginContext, runs init_all on the host, and returns the wired host. The split can be added in Phase 47 if finer-grained control is needed. Reasoning: callers (lib.rs::setup) benefit from a single entry; the borrow-checker workaround is encapsulated inside `init_all`.
4. **`Host::all_tray_items / all_app_menu_items` implementation** — PLAN §3 says `flat_map(p.tray_items())` on `plugins.values()`. Changed to walk `init_order` via `self.iter()` because `HashMap::values()` iteration order is unspecified and the test `all_tray_items_collects_from_all_plugins` was flaky (passed locally but failed on a hash-seed change). `iter()` preserves insertion order as documented.
5. **`PluginAction::Custom` now requires `'static`** — Tauri's `TrayIconBuilder::on_menu_event` closure is `Fn + Send + Sync + 'static`. Added `+ 'static` to the `Arc<dyn Fn>` bound. No current call site uses `Custom`, so no breakage.
6. **`install_tray` `icon` parameter** — PLAN §3 example shows `Image<'static>`. Changed to `Image<'_>` because `app.default_window_icon().cloned()` returns `Image<'_>` (tied to AppHandle's lifetime, not `'static`). The icon is consumed immediately by `TrayIconBuilder::icon` which accepts any lifetime.
7. **`core.rs::init` also wires the tray double-click handler** — PLAN Task 5 doesn't mention this, but lib.rs used to do `t.on_tray_icon_event(|t, e| { if DoubleClick { show_main_window } })`. core.rs's init now does the same so the M3.2 polish still works after the lib.rs block is deleted.

## Test results

```
$ cargo test --lib plugins::
test result: ok. 47 passed; 0 failed; 0 ignored; 0 measured; 643 filtered out
```

Notable new tests:
- `plugins::menu_registry::tests::action_variants_are_cloneable_and_debug`
- `plugins::menu_registry::tests::unregister_actions_removes_only_target_plugin`
- `plugins::menu_registry::tests::unregister_actions_empty_input_no_panic`
- `plugins::host::tests::all_tray_items_collects_from_all_plugins` (uses `host.iter()` for deterministic order)
- `plugins::host::tests::all_app_menu_items_collects_from_all_plugins`
- `plugins::host::tests::default_tray_items_returns_empty`
- `plugins::host::tests::default_app_menu_items_returns_empty`
- `plugins::stubs::core::tests::core_plugin_id_is_core`
- `plugins::stubs::core::tests::core_plugin_tray_items_count_is_two`
- `plugins::stubs::core::tests::core_plugin_app_menu_items_count_and_groups`
- `plugins::stubs::core::tests::core_plugin_init_rejects_missing_app`

## Lint script

`scripts/lint-plugin-coupling.sh` (NEW, executable) — runs 4 rules:

```bash
$ bash scripts/lint-plugin-coupling.sh
[PASS] Phase 43 MenuRegistry 强验收 4/4 通过
```

## Files changed

**Added:**
- `src-tauri/src/plugins/stubs/core/mod.rs` — CorePlugin (tray_items + app_menu_items + init)
- `scripts/lint-plugin-coupling.sh` — strong acceptance lint

**Modified:**
- `src-tauri/src/lib.rs` — delete hand-rolled tray block (232-253) + macOS AppMenu block (293-310) + unused imports
- `src-tauri/src/plugins/menu_registry.rs` — add build_tray + install_tray + build_app_menu
- `src-tauri/src/plugins/host.rs` — collect helpers walk init_order; tests import PluginAction
- `src-tauri/src/plugins/mod.rs` — register CorePlugin first; init_all takes (app, paths) and builds ctx internally
- `src-tauri/src/plugins/traits.rs` — PluginContext 4-field with NonNull host; default impls for tray_items/app_menu_items
- `src-tauri/src/platform/mod.rs` — remove IPlatformAppMenu re-export + runtime::app_menu factory
- `src-tauri/src/platform/traits.rs` — remove IPlatformAppMenu trait + AppMenuShim mock + app_menu_build_dispatch test
- `src-tauri/src/platform/macos/mod.rs` — remove app_menu re-export
- `src-tauri/src/platform/windows/mod.rs` — remove app_menu re-export

**Deleted:**
- `src-tauri/src/platform/macos/app_menu.rs`
- `src-tauri/src/platform/windows/app_menu.rs`

## Next steps (Phase 44+)

- **Phase 44**: Frontend `App.tsx` listens to `frontend://switch-view` event (Q43-2 close-out).
- **Phase 47**: macOS real-machine 4-submenu verification (D6 deferred).
- **Phase 47**: tray accelerator cross-platform strategy (Q43-3 deferred).
- **Phase 47**: split `init_all` into `register_all` + `host.init_all(ctx)` if finer-grained control is needed.
- **Phase 47**: integrate `lint-plugin-coupling.sh` into `build-and-ship.sh` (G-9 smoke test integration).