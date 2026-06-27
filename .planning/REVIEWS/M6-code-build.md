---
subsystem: build-packaging-smoke
reviewer: opencode (minimax/MiniMax-M3)
reviewed_at: 2026-06-27T02:09:30Z
scope: scripts/*.sh, src-tauri/tauri.conf.json, src-tauri/Cargo.toml, src-tauri/.cargo/config.toml, package.json, vite.config.ts
target_branch: master
project: Claude 配置管理器 — Tauri v2
---

# Build / Packaging / Smoke Test Code Audit — opencode

<output>

---

# Build / Packaging / Smoke Test — Code Audit Report

## 1. Overview

Audited 17 shell scripts under `scripts/`, plus `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `src-tauri/build.rs`, `src-tauri/.cargo/config.toml`, `package.json`, `vite.config.ts`. No `.github/workflows/` exist.

**Call hierarchy:**
```
build.sh → platform dispatch
  Windows: build-only.sh | build-and-ship.sh → bump-version.sh → tauri build → smoke-test.sh
  macOS:   build-mac.sh | install-to-applications-mac.sh → bump-version.sh → build-mac.sh

test-all.sh → check-ui-text-3-locations.sh → test-frontend.sh → test-verify.sh → run-e2e.sh → smoke-test.sh → tests/M4-e2e/run-all.sh

build-installer.sh (standalone) → tauri build --bundles (nsis|app,dmg)
```

---

## 2. Mandatory Checks

### 2.1 `--features tauri/custom-protocol` enforcement (§13.1)

Every script that invokes `cargo build --release` directly **MUST** pass `--features tauri/custom-protocol`. Scripts using `tauri build` / `cargo tauri build` are safe (CLI auto-enables it).

| Script | Line | Invocation | custom-protocol? | Verdict |
|--------|------|------------|-------------------|---------|
| `build-only.sh:71` | 71 | `cargo build --release --manifest-path src-tauri/Cargo.toml` | **NO** | **CRITICAL** |
| `build-only.sh:77` | 77 | `cargo build --manifest-path src-tauri/Cargo.toml` (debug) | **NO** | **CRITICAL** |
| `build-and-ship.sh:117` | 117 | `npm run tauri build -- --no-bundle` | auto-enabled | ✅ |
| `build-mac.sh:112,114` | 112,114 | `cargo tauri build` | auto-enabled | ✅ |
| `build-installer.sh:125,144` | 125,144 | `tauri build --bundles nsis\|app,dmg` | auto-enabled | ✅ |
| `test-verify.sh:43` | 43 | `cargo build --tests` | N/A (tests) | ✅ |

**Critical finding**: `build-only.sh:71` produces a release exe via `cargo build --release` without `--features tauri/custom-protocol`. This is the exact failure mode from CLAUDE.md §13.1 — `EmbeddedAssets::default()` fallback, webview loads vite dev server on port 1420, `ERR_CONNECTION_REFUSED`. Same for the debug build at line 77.

### 2.2 Cross-compile detection (§13.2)

No actual cross-compile flags found. The grep for `cross|zigbuild|--target` returned only false positives (comments mentioning "cross-platform"). **Clean.**

### 2.3 sccache config (§12.1/§12.2)

- `src-tauri/.cargo/config.toml:23` — `rustc-wrapper = "sccache"` exists ✅
- `build-mac.sh:49-50` — exports `SCCACHE_DIR` and `SCCACHE_CACHE_SIZE` ✅
- `build-mac.sh:48-55` — self-check for sccache presence, degrades gracefully with WARN ✅
- `build-mac.sh:49` — cache dir: `~/Library/Caches/sccache-claude-config-manager` (project-specific, per spec) ✅
- `build-mac.sh:50` — cache size: `5G` (per spec) ✅

**Flag:** No `pkill sccache` before exporting env vars (violates §12.4 last bullet — see 2.4).

### 2.4 Forbidden patterns (§12.4)

| Pattern | Found? | Location | Verdict |
|---------|--------|----------|---------|
| Cargo.toml profile tuning | **YES** | `Cargo.toml:130-141` — `profile.dev` + `profile.release` with codegen-units, LTO, strip, debug options | **HIGH** — exception noted in comments ("target/ 长期治理") but per §12.4 requires user whitelist |
| Dev build in ship flow | No | All ship scripts use release/tauri build | ✅ |
| Parallel cargo build | No | All serial | ✅ |
| `sudo xcode-select` | No | Only `xcode-select --install` in pre-check comments | ✅ |
| `RUST_LOG=trace` during build | No | Not present | ✅ |
| sccache env changes w/o `pkill` | **YES** | `build-mac.sh:49-50` — exports `SCCACHE_DIR` / `SCCACHE_CACHE_SIZE` without `pkill sccache` first | **HIGH** — server reads env at startup; existing server won't pick up new values |

### 2.5 Smoke test 10 items (§13.1)

The script lists **10** distinct checks, confirmed:

| # | Test | Category | macOS? |
|---|------|----------|--------|
| 1 | Launch (process running) | launch | ✅ Darwin branch |
| 2 | Main window visible | window | ✅ osascript |
| 3 | Close → tray (process survives) | tray | ✅ Cmd+W |
| 4 | Force kill → process gone | kill | ✅ pkill |
| 5 | WebView child window exists | webview | ✅ SKIP/PASS (WKWebView no child API) |
| 6 | Window title matches tauri.conf.json | title | ✅ osascript |
| 7 | Dist fingerprint embedded in exe | assets | ✅ strings on Mach-O |
| 8 | history.db file exists | db_exists | ✅ |
| 9 | db schema complete | schema | ✅ |
| 10 | db queryable | queryable | ✅ |

All 4 categories from §13.1 are covered.

**Silent-pass concerns:**
- Test 7: line 436 — `PASS` "skipped" when no `dist/assets/` found (no dist at all → silent pass)
- Test 9: line 555 — `PASS` "skipped" when no sqlite3/python available
- Test 10: lines 594-597 — `PASS` "skipped" on query failure

### 2.6 `bump-version.sh` traceability (§6.4/§6.5)

- Updates **3 version fields**: `package.json`, `tauri.conf.json`, `Cargo.toml` ✅
- **Does NOT** touch `productName` (version only, not display string) ✅
- **Does NOT** touch `IDENTIFIER` or `Cargo.toml` `[package].name` ✅
- Has `--dry-run` pre-flight check ✅
- Has `--print` mode ✅
- Post-write validation reads back all 3 files and confirms consistency ✅

**Gap**: Per §6.4, UI text changes (product name, etc.) must sync 3 display locations (frontend string, Rust IPC constant, test fixture). `bump-version.sh` handles version only, not display strings. This is correct scope, but there is no script that syncs the 3 display-string locations. The `check-ui-text-3-locations.sh` script *verifies* consistency but does not *update* them.

### 2.7 Hard-coded paths

1. **`build-and-ship.sh:49`** — `DESKTOP_BASE="/c/Users/e-Yunfei.Qian/Desktop"` → **CRITICAL**: breaks for any other user. Should be `$HOME/Desktop` with `cygpath -w` conversion.
2. **`run-e2e.sh:89`** — `"/c/Users/${USER:-e-Yunfei.Qian}/AppData/Local/Temp"` → partially variable but fallback is hardcoded developer name.

### 2.8 Error handling

- Full `set -euo pipefail`: 14/17 scripts ✅
- `set -eo pipefail` (no `-u`): `build-mac.sh`, `bump-version.sh`, `install-to-applications-mac.sh` — documented (bash 3.2 compat on macOS) but the lack of `-u` means unset variables silently produce empty strings.

### 2.9 Idempotency

- `build-and-ship.sh`: **Not idempotent** — each run bumps patch version (+1), overwrites desktop exe. Repeat runs diverge version numbers. No `rm -rf` of previous artifacts.
- `build-installer.sh`: **Idempotent** — overwrites installers/ output.
- `install-to-applications-mac.sh`: **Idempotent** — backs up existing `/Applications/ClaudeManager.app` to `~/Desktop/.trash-<ts>/`.
- Partial-state recovery: none of the scripts handle partial state from a crash. A killed `tauri build` may leave `src-tauri/target/` in an inconsistent state.

### 2.10 Tool version pinning (§2.3)

- `.nvmrc`: Node 22 ✅
- `package.json`: All dependencies use `^` or `~` ranges (not pinned) — e.g., `"react": "^19.1.0"`, `"@tauri-apps/api": "^2"`, `"vite": "^7.0.4"` → **violation** of §2.3 "所有依赖版本在 Cargo.toml / package.json 锁死"
- `Cargo.toml`: Properly pinned with `=X.Y.Z` for most deps ✅
- Rust toolchain: Not pinned anywhere
- No CI workflows to enforce versions

### 2.11 Code signing / notarization (macOS)

- **No** `notarytool`, `xcrun altool`, or `codesign --deep --strict` in any script
- `build-mac.sh:30` comment: "This script does NOT sign or notarize the bundle. v1.1 signing lives in CI (.github/workflows/release.yml)"
- The referenced `.github/workflows/release.yml` **does not exist** in the repo
- `install-to-applications-mac.sh:289` runs `codesign -dv` only for informational reporting, not for signing

---

## 3. Risk Assessment

### Overall health: **MODERATE RISK** — ship flow is functional but has critical gaps in edge paths.

The primary ship script (`build-and-ship.sh`) is relatively solid: it uses `tauri build --no-bundle` (which auto-enables custom-protocol, auto-runs `beforeBuildCommand`), runs a 10-item smoke test post-build, and refuses to ship on smoke failure. The sccache integration follows the project spec faithfully.

However, the **secondary build path** (`build-only.sh`) is the single biggest risk: it produces release exes via plain `cargo build --release` *without* `--features tauri/custom-protocol` and *without* auto-running `npm run build`. Any developer using this script for a "quick build" will produce an exe that appears to compile successfully but shows a blank white page at runtime — the exact M1.3 regression that §13.1 was created to prevent.

The macOS build scripts (`build-mac.sh`, `install-to-applications-mac.sh`) are well-structured with proper pre-cleanup and sccache integration, but the sccache env var change without `pkill sccache` means developers with an existing sccache server won't get the expected cache behavior.

Hardcoded developer-specific paths (`/c/Users/e-Yunfei.Qian/Desktop` in `build-and-ship.sh:49`) make the ship script non-portable — it will fail for anyone else running it.

The bump-version workflow is correct for its scope (version numbers), but the project lacks a script to update display-name strings across the 3 required locations (§6.4), relying only on a *verification* script.

**The project is ship-ready for the primary developer's machine only.** For multi-dev or CI adoption, the hardcoded paths and the `build-only.sh` vulnerability must be fixed first.

---

## 4. Top 5 Fixes (ranked)

### C1. `scripts/build-only.sh:71` — Add `--features tauri/custom-protocol` and auto-run `npm run build`

**Issue**: `cargo build --release` without `--features tauri/custom-protocol` produces exe with blank webview — the exact regression from M1.3 (§13.1). The script comments acknowledge the stale-dist problem but only use `touch src-tauri/src/lib.rs` which is insufficient.

**Patch**:
```bash
# Replace line 71
npm run build  # ensures frontend dist/ is current
cargo build --release --features tauri/custom-protocol --manifest-path src-tauri/Cargo.toml 2>&1 | tail -30
```

Same for debug build at line 77:
```bash
npm run build
cargo build --features tauri/custom-protocol --manifest-path src-tauri/Cargo.toml 2>&1 | tail -30
```

### C2. `scripts/build-and-ship.sh:49` — Replace hardcoded desktop path

**Issue**: `DESKTOP_BASE="/c/Users/e-Yunfei.Qian/Desktop"` breaks for any other developer or machine.

**Patch**:
```bash
# Detect Windows desktop via PowerShell
DESKTOP_BASE=$(powershell.exe -NoProfile -Command \
  "[Environment]::GetFolderPath('Desktop')" 2>/dev/null | tr -d '\r' | head -1)
if [[ -z "$DESKTOP_BASE" ]]; then
  # Fallback to HOME-based path
  DESKTOP_BASE="$HOME/Desktop"
fi
```

### H1. `scripts/build-mac.sh:48-50` — Add `pkill sccache` before exporting env vars

**Issue**: Per §12.4, sccache server reads env at startup; changing `SCCACHE_DIR`/`SCCACHE_CACHE_SIZE` without restarting the server means new values are silently ignored.

**Patch** (insert before line 48):
```bash
if command -v sccache >/dev/null 2>&1; then
  # Kill existing server so it picks up the new env vars on next cargo invocation
  pkill sccache 2>/dev/null || true
  export SCCACHE_DIR="${HOME}/Library/Caches/sccache-claude-config-manager"
  export SCCACHE_CACHE_SIZE="5G"
  ...
fi
```

### H2. `src-tauri/Cargo.toml:136-141` — Verify profile tuning whitelist

**Issue**: `[profile.release]` with `codegen-units = 1`, `lto = "thin"`, `strip = "symbols"` — and `[profile.dev]` with `codegen-units = 256`, `debug = 1` — constitutes "cargo profile 调优" forbidden by §12.4. The exception requires "用户白名单". The comments claim it's for "target/ 长期治理" but there's no explicit approval record.

**Recommendation**: Document the whitelist approval in a commit message or in CLAUDE.md. If not approved, revert to default profile settings.

### H3. `scripts/build.sh:170` — macOS `--check` mode bypasses sccache

**Issue**: On macOS `--check`, build.sh invokes `cargo check` directly, bypassing build-mac.sh which sets up sccache env vars.

**Patch**: Use `build-mac.sh` with a `--check` flag (or add sccache setup inline in build.sh):
```bash
# Replace lines 168-170
cd "$PROJECT_ROOT"
# Enable sccache if available (same logic as build-mac.sh)
if command -v sccache >/dev/null 2>&1; then
  export SCCACHE_DIR="${HOME}/Library/Caches/sccache-claude-config-manager"
  export SCCACHE_CACHE_SIZE="5G"
fi
cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | tail -30
```

---

## 5. Counts

| Severity | Count | Labels |
|----------|-------|--------|
| **CRITICAL** | 2 | C1 (build-only.sh missing custom-protocol + no npm run build), C2 (hardcoded path) |
| **HIGH** | 5 | H1 (profile tuning), H2 (sccache no pkill), H3 (macOS check bypasses sccache), H4 (no pre-cleanup before build), H5 (build-only.sh debug build same issue) |
| **MEDIUM** | 7 | M1 (smoke test silent passes), M2 (tail -25 truncation), M3 (no CI workflows), M4 (no display-string update script), M5 (^ version ranges in package.json), M6 (no post-installer smoke test), M7 (no code signing) |
| **LOW** | 4 | L1 (EXE_SUFFIX inconsistency), L2 (fallback hardcoded username), L3 (no set -u on macOS scripts), L4 (Test 10 PASS on failure) |
| **Total** | **18** | |

---

## 6. Smoke Test Detail

- **10 items confirmed** — no extras, no missing.
- All 4 categories from §13.1 covered: launch/window/webview/title (1,2,5,6), assets (7), db (8,9,10), tray/kill (3,4).
- Runs on both macOS and Windows with branches for each.
- Silent-PASS paths: Tests 7, 9, 10 have skipped branches that record as `PASS` rather than `WARN` — these could mask real failures when dependencies (dist/ assets, sqlite3 CLI) are absent.

</output>