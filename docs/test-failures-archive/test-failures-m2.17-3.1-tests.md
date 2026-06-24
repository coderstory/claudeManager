# Test compile failure — M2.17-3.1-tests (plugin_host_wiring.rs)

- **Date**: 2026-06-21T23:29:41
- **Subagent**: A (this task)
- **Task**: Re-add orphaned integration test `src-tauri/tests/plugin_host_wiring.rs` to master
- **Status**: ❌ BLOCKED — compilation cannot proceed in current env

## Command

```bash
cargo test --no-run --manifest-path src-tauri/Cargo.toml --test plugin_host_wiring
```

## Failure type

**Build-script panic in `tauri-winres` crate — environment-level toolchain issue,
NOT a problem with the test file itself.** The compiler never reached the test
compilation phase; it died in the `build.rs` of the main crate when trying to
embed the Windows resource file.

## Error (verbatim, head 30 lines)

```
   Compiling claude-config-manager v0.1.0 (D:\project\winui3\src-tauri)
error: failed to run custom build command for `claude-config-manager v0.1.0 (D:\project\winui3\src-tauri)`

Caused by:
  process didn't exit successfully: `D:\project\winui3\src-tauri\target\debug\build\claude-config-manager-8d0303e98e8e7bcd\build-script-build` (exit code: 101)
  --- stdout
  cargo:rustc-env=BUILD_GIT_COMMIT=02e5b14
  cargo:rustc-env=BUILD_TIMESTAMP=1782055765
  cargo:rerun-if-env-changed=TAURI_CONFIG
  cargo:rustc-cfg=desktop
  cargo:rustc-cfg=dev
  cargo:PERMISSION_FILES_PATH=D:\project\winui3\src-tauri\target\debug\build\claude-config-manager-2582c46d96fda53b\out\app-manifest\__app__-permission-files
  cargo:rerun-if-changed=capabilities
  cargo:rustc-env=TAURI_ENV_TARGET_TRIPLE=x86_64-pc-windows-gnu
  package.metadata does not exist

  --- stderr

  thread 'main' (55088) panicked at C:\Users\e-Yunfei.Qian\.cargo\registry\src\index.crates.io-1949cf8c6b5b557f\tauri-winres-0.3.6\src\lib.rs:543:14:
  called `Result::unwrap()` on an `Err` value: Failed("Couldn't to execute windres to compile \"D:\\project\\winui3\\src-tauri\\target\\debug\\build\\claude-config-manager-2582c46d96fda53b\\out\\resource.rc\" into \"D:\\project\\winui3\\src-tauri\\target\\debug\\build\\claude-config-manager-2582c46d96fda53b\\out\\libresource.a\": program not found")
  note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace
```

## Root cause

- `tauri-winres` (the resource compiler that embeds the .ico into the Windows
  binary) invokes `windres` (part of GNU binutils / MinGW) to convert
  `resource.rc` → `libresource.a`.
- `windres` is not on PATH in this environment.
- This matches the previously-known Rust-on-Windows toolchain gotcha
  documented in `reference/rust-windows-dev-box.md` (windres missing).
- Compilation of the test binary itself never started — the build-script
  process panicked first.

## Why I did NOT attempt to fix

Per task instructions (CLAUDE.md §2.3 dependency lock, §2.4 careful file
modification) and the explicit subagent scope in the prompt:

> 如果编译失败: 报告失败原因 (报错前 30 行) 给主 session, **不要尝试修复**

Fixing this requires either:
1. Installing GNU windres (toolchain change — out of subagent scope)
2. Switching to MSVC toolchain — this would require modifying `Cargo.toml` /
   `.cargo/config.toml` and re-resolving the toolchain (explicitly forbidden
   by §2.3)
3. Disabling the Windows resource embedding (modifies `tauri.conf.json` or
   `build.rs` — explicitly forbidden by §2.4)

All three are human-decision territory.

## Working tree state (no commit was made)

```
 M src-tauri/Cargo.toml          (pre-existing, not mine)
?? src-tauri/tests/plugin_host_wiring.rs   (the orphaned test — still untracked)
```

The orphaned file remains on disk, untracked, exactly as I found it. No commit
was created.

## What needs to happen next (human decision)

The main session should choose between:

- **A.** Install GNU windres / MinGW (PATH fix) so the build script can run,
  then retry this task as-is.
- **B.** Switch the project to the MSVC toolchain (modifies `Cargo.toml`'s
  `rust-toolchain.toml` and likely adds `.cargo/config.toml`).
- **C.** Defer this fix until the next machine setup / toolchain audit;
  leave the orphaned file untracked for now.

Either way, the test file itself appears syntactically intact (it has a Rust
file header, hash-style signature, and uses standard `tokio::test` /
`tauri::test::mock_app()` patterns visible at first glance). The blocker is
100% build-script/environment, not the file content.

## RETRY UPDATE (2026-06-21 by Subagent A2)

**Status**: ✅ RESOLVED by retry
**Commit**: `2e575c7` (M2.17-3.1-tests: re-add plugin_host_wiring.rs)
**Root cause**: windres.exe not in PATH (tauri-winres build.rs)
**Permanent fix**: `~/.bashrc` 加 `export PATH="/c/msys64/mingw64/bin:$PATH"` (Subagent A2 任务 1)
**Verification**: `cargo test --no-run --test plugin_host_wiring` 编译成功, 产物 `src-tauri/target/debug/deps/plugin_host_wiring-a6b52adcefce0479.exe`
