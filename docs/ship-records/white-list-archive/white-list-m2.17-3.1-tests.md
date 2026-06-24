# Whitelist — M2.17-3.1-tests (subagent A)

- **Date**: 2026-06-21
- **Scope**: 1 file

## Files allowed to be added/modified

| Path | Operation | Reason |
|---|---|---|
| `src-tauri/tests/plugin_host_wiring.rs` | `git add` (only) | Orphaned integration test from dangling commit `d5443c3`; re-add to master so `cargo test --test plugin_host_wiring` runs in CI. |

## Files explicitly NOT to touch

- `src-tauri/Cargo.toml` (pre-existing dirty from another task; §2.3 dependency lock)
- `src-tauri/Cargo.lock` (§2.3)
- `src-tauri/src/lib.rs`, `src-tauri/src/plugins/mod.rs` (§2.4)
- `src-tauri/tauri.conf.json`, `src-tauri/build.rs` (out of scope)
- `scripts/build-and-ship.sh` and other scripts (no ship this round)

## Execution outcome

**Not executed.** Cargo test compile blocked by missing `windres` toolchain
(see `tmp/test-failures-m2.17-3.1-tests.md`). The whitelist above describes
what *would* be done once the environment is fixed.

## RETRY UPDATE (2026-06-21 by Subagent A2)

**Status**: ✅ RESOLVED by retry
**Commit**: `2e575c7` (M2.17-3.1-tests: re-add plugin_host_wiring.rs)
**Root cause**: windres.exe not in PATH (tauri-winres build.rs)
**Permanent fix**: `~/.bashrc` 加 `export PATH="/c/msys64/mingw64/bin:$PATH"` (Subagent A2 任务 1)
**Verification**: `cargo test --no-run --test plugin_host_wiring` 编译成功, 产物 `src-tauri/target/debug/deps/plugin_host_wiring-a6b52adcefce0479.exe`
