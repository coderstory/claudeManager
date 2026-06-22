# cargo test precheck failures — M-finalize (auto-mode)

## Status

`cargo test` binary execution fails on this Windows dev box with
`STATUS_ENTRYPOINT_NOT_FOUND` (0xc0000139). The binary itself compiles
and links cleanly. The crash happens at process startup, before any
test code runs.

## Verified

- `cargo check`: PASS (no errors, no warnings)
- `cargo test --no-run`: PASS (binary builds successfully)
- `cargo test --lib`: compiles, then process crashes with 0xc0000139
  before `--list` even responds
- Manual invocation: `./target/release/deps/claude_config_manager_lib-*.exe --list`
  exits silently with no stdout / stderr
- A standalone `rustc /tmp/test_simple.rs` binary runs fine

## Diagnosis

The crash is reproducible for BOTH `--lib` and `--test about`
binaries. Both import `WebView2Loader.dll` (visible via
`objdump -p ... | grep "DLL Name"`). The DLL is present in
`target/<profile>/deps/`, but the loader cannot resolve all its
imported symbols — possibly the result of a WebView2 SDK version
mismatch between `tauri-build` (which links the loader) and the
system-installed WebView2 Runtime (which provides the symbols).

This is documented in `~/.claude/plugins-dev/cs-knowledge-base/memory/reference/rust-windows-dev-box.md`
("Rust Windows dev box 4 类工具链陷阱").

## Impact

- Vitest (TS): 371/371 PASS
- Cargo unit tests: cannot be run on this dev box (loader issue, not code)
- Code compiles cleanly (`cargo check` clean, `npm run build` clean)
- Ship via `scripts/build-and-ship.sh` will be exercised next

## Workaround

- Ship-time build path is independent of this loader mismatch
  (bundled exe links the same DLL, but loads via the bundled runtime
  not the test binary loader)
- A clean dev box with matching WebView2 SDK + runtime would resolve
  this; out of scope for the M-finalize task.
