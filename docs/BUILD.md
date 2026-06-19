# Build & Distribution

> Single source of truth for building Claude Config Manager locally
> and shipping releases via CI. If anything here disagrees with the
> scripts in `scripts/`, the scripts win (they're tested) — please
> update this doc to match.

---

## 1. Two build modes

| Mode | Tool | Output | Use case |
|---|---|---|---|
| **Dev (local)** | `scripts/build-and-ship.sh` (Windows) / `scripts/build-mac.sh` (macOS) | Debug exe + WebView2Loader.dll copied to `~/Desktop/ClaudeConfigManager-M1/` | M1.x iteration; user verifies each iteration |
| **Release (CI)** | `.github/workflows/release.yml` | NSIS installer (Windows) + .dmg (macOS) uploaded as GitHub Release assets | v1.1 ship; auto on `v*` tag push |

The dev mode is for M1 because every milestone ships an iteration exe
to the user's desktop for manual review (see CLAUDE.md §9). The CI mode
is for actual public release tags; in M1.10 we wire it up but do not
ship through it yet.

---

## 2. Local dev: Windows

The local Windows dev box uses `cargo build --release` directly (NOT
`tauri build`) because of a known cache-invalidation workaround —
see `scripts/build-and-ship.sh` header for the full story.

### 2.1 One-shot: build + smoke + cp to desktop

```bash
# Close any leftover instance
./scripts/kill-app.sh

# Full pipeline — produces a kebab-cased exe on the desktop
./scripts/build-and-ship.sh --milestone M1 --task 1.10 --slug build-ci
```

What it does:

1. Pre-cleanup: kill any existing `claude-config-manager.exe`
2. `npm run build` — rebuild frontend (`dist/`)
3. `touch src-tauri/src/lib.rs` — invalidate Cargo's cache so relink
   actually picks up the new `dist/`
4. `cargo build --release --features tauri/custom-protocol --manifest-path src-tauri/Cargo.toml`
   — `--features tauri/custom-protocol` is **required** when bypassing
   `tauri build` (Tauri's codegen defaults to `dev = true` without it,
   resulting in an empty embedded frontend).
5. `cp` exe + `WebView2Loader.dll` to `~/Desktop/ClaudeConfigManager-M1/`
6. Run `scripts/smoke-test.sh` against the copied exe (7 checks)
7. If smoke fails, delete the desktop copy and exit 1
8. If smoke passes, print "SHIPPED ✓" and wait for user review

### 2.2 Fast iteration: Rust-only rebuild

```bash
./scripts/build-only.sh            # cargo build (debug)
./scripts/build-only.sh --release  # cargo build --release
./scripts/build-only.sh --check    # cargo check only
./scripts/build-only.sh --clean    # cargo clean release target, then build
```

Use this when you only edited Rust files. If you also edited React/Vite
sources, run `npm run build` first OR use `build-and-ship.sh` (which
does both).

### 2.3 Smoke test alone

```bash
./scripts/smoke-test.sh src-tauri/target/release/claude-config-manager.exe
```

The 7 checks (per `scripts/smoke-test.sh`):

| # | Check | What it proves |
|---|---|---|
| 1 | Process running 5s after launch | exe didn't crash on startup |
| 2 | `MainWindowHandle != 0` AND `Responding = True` | Tauri created the window + message loop alive |
| 3 | Close → process survives | Tray + min-on-close works (M1.1) |
| 4 | Force kill → process gone in 2s | Clean exit path |
| 5 | WebView2 child window exists under main HWND | Frontend bundle actually loaded (not empty) |
| 6 | Window title contains `app.windows[0].title` from `tauri.conf.json` | Tauri read config and applied it |
| 7 | dist fingerprint (e.g. `index-Cc-j-zqL.js`) found in exe strings | Frontend assets were embedded (catches missing `--features tauri/custom-protocol`) |

Tests 5/6/7 were added after a M1.x regression where the exe ran but
showed an empty page because the build skipped frontend embedding.
Always run the full 7; never trim down to "the basics".

### 2.4 Kill the app

```bash
./scripts/kill-app.sh           # graceful (CloseMainWindow → wait 5s → force)
./scripts/kill-app.sh --force   # immediate taskkill -F -IM claude-config-manager.exe
```

---

## 3. Local dev: macOS

`scripts/build-mac.sh` is the macOS equivalent of
`scripts/build-and-ship.sh`. Unlike the Windows version it does NOT
copy to the desktop (macOS dev iteration uses different distribution)
and it runs `cargo tauri build` rather than `cargo build --release`
directly — because the mingw64 windres workaround is Windows-only.

### 3.1 macOS dev build

```bash
./scripts/build-mac.sh
```

Output: `src-tauri/target/release/bundle/macos/ClaudeConfigManager.app`
and `src-tauri/target/release/bundle/dmg/ClaudeConfigManager_0.1.0_aarch64.dmg`.

Launch with:

```bash
open src-tauri/target/release/bundle/macos/ClaudeConfigManager.app
```

Or open the .dmg in Finder.

### 3.2 Why macOS scripts are simpler

- `cargo tauri build` (vs `cargo build --release` directly) — runs
  `beforeBuildCommand` (npm run build) automatically, no cache touch
  needed
- No mingw64 / windres — macOS uses Apple's native linker
- No WebView2Loader.dll dance — WebKit ships with macOS
- No "exe name" mangling — `.app` is a directory, not a single PE file

### 3.3 Smoke testing on macOS

There is **no macOS smoke-test script** yet (M1.10 scope is build +
CI; macOS smoke testing lands when there's a Mac dev box to write
it on). For now, launch the .app, click around manually.

---

## 4. Release: CI

### 4.1 Trigger

The release workflow (`.github/workflows/release.yml`) runs on:

- `push` of any tag matching `v*` (e.g. `v0.1.0`, `v0.2.3-rc1`)
- `workflow_dispatch` (manual from GitHub UI → Actions → release → Run workflow)

Tag format follows semver: `v<MAJOR>.<MINOR>.<PATCH>`.

### 4.2 What the workflow does

For each matrix entry (`windows-latest` and `macos-latest`):

1. Checkout (`actions/checkout@v4`)
2. Setup Node LTS (`actions/setup-node@v4`)
3. Install Rust stable + matrix target (`dtolnay/rust-toolchain@stable`)
4. Cache `src-tauri/target/` (`swatinem/rust-cache@v2`)
5. `npm ci`
6. `tauri-apps/tauri-action@v0.6.2` — handles `tauri build`, artifact
   collection, GitHub Release creation
7. Upload raw exe + .app bundles as workflow artifacts (in addition
   to release assets)

### 4.3 Matrix

| Runner | Target | Bundles |
|---|---|---|
| `windows-latest` | `x86_64-pc-windows-msvc` | `--bundles nsis` |
| `macos-latest` | `aarch64-apple-darwin` | `--bundles app,dmg` |

Notes:

- We pin the target triple explicitly so a future runner-image change
  (e.g. GitHub flipping default to ARM) does not silently change our
  build output.
- `windows-latest` defaults to MSVC. The local Windows dev box uses
  GNU (mingw64); they produce different PE binaries but both are
  valid Tauri apps. CI uses MSVC because it needs no extra setup —
  no mingw64 install, no windres on PATH.
- macOS is currently aarch64-only (Apple Silicon). x86_64 build can
  be added as a second matrix entry once we have a real Mac to test
  the .app bundle on.
- Linux is **out of scope** for M1.10 — see CLAUDE.md §1 ("目标平台"
  lists Windows + macOS only).

### 4.4 GitHub Release output

On tag push, the workflow creates a **draft** GitHub Release named
`Claude Config Manager v<VERSION>` with:

- `ClaudeConfigManager_<VERSION>_x64-setup.exe` (NSIS, Windows)
- `ClaudeConfigManager_<VERSION>_aarch64.dmg` (macOS)
- Optional `latest.json` for `tauri-plugin-updater` (v1.1+, requires
  `pubkey` in tauri.conf.json)

Draft status means a maintainer must click "Publish" before users see
it. Manual workflow runs (`workflow_dispatch`) on the default branch
also create draft releases — useful for verifying the build pipeline
without shipping to users.

### 4.5 What you need to do to ship v1.1

1. Complete the checklist in `docs/SIGNING.md` (provision certs +
   add 10 GitHub secrets)
2. Uncomment the `env:` blocks in `.github/workflows/release.yml`
3. Set `releaseDraft: false`
4. Tag the commit: `git tag v0.1.0 && git push origin v0.1.0`
5. Monitor the workflow at
   `https://github.com/<org>/<repo>/actions/workflows/release.yml`
6. Once both matrix legs pass, click "Publish" on the draft release

---

## 5. Versioning policy

- **M1.x**: dev iterations, no public tags. Internal version stays
  `0.1.0` (in `package.json` + `src-tauri/Cargo.toml` +
  `src-tauri/tauri.conf.json`).
- **v1.1**: first public release candidate. Bump to `0.1.0` → `0.1.0-rc1`
  for RC, then `0.1.0` for stable.
- **Stable tags**: semver `vMAJOR.MINOR.PATCH`. Pre-release tags use
  the standard `-rc1`, `-beta2` suffix after the patch.

The `tauri-action` `tagName: v__VERSION__` template substitutes the
version from `src-tauri/tauri.conf.json` automatically — don't manually
edit the workflow to change tag format.

---

## 6. Troubleshooting

### 6.1 "dist not embedded" / blank frontend

You probably built with `cargo build --release` directly and forgot
`--features tauri/custom-protocol`. Either:

- Use `scripts/build-and-ship.sh` (handles it automatically), or
- Pass the flag manually: `cargo build --release --features tauri/custom-protocol --manifest-path src-tauri/Cargo.toml`

Smoke test #7 will catch this — `strings <exe> | grep index-.*\.js`
should return ≥ 1 hit.

### 6.2 CI: "linker not found" on windows-latest

Should not happen — windows-latest ships Visual Studio 2022 with the
C++ workload preinstalled. If you see this, the runner image may have
changed; pin a specific runner version via `runs-on: windows-2022`
in `.github/workflows/release.yml`.

### 6.3 CI: "xcrun: error: unable to find utility" on macos-latest

Means Xcode CLI tools broke. `macos-latest` always has them — if this
fires, the runner image changed. Pin `macos-14` (or specific major).

### 6.4 Cargo cache invalidated every run

Normal when `src-tauri/src/lib.rs` mtime changes. Don't fight it. The
`touch` in `scripts/build-and-ship.sh` is intentional.

### 6.5 Smoke test flake on first launch

PowerShell `Start-Process` + WebView2 cold-start can take 6-10s on a
fresh Windows VM. The smoke test waits 5s before checking; if you're
on a slow VM, increase `sleep 5` in `scripts/smoke-test.sh` Test 1.