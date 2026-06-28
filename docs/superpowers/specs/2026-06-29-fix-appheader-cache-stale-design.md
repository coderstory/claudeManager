# Fix AppHeader cache-stale — Design (v3.4.4)

**Date**: 2026-06-29
**Status**: Self-review passed (3 inline fixes applied); awaiting user review
**Bug report**: `.planning/milestones/v3.4-phases/bug-appheader-cache-stale.md`
**Author**: brainstorming session output

---

## 1. Goal & scope

**Goal**: Make `cargo tauri build` correctly re-inline `frontendDist` (`../dist`) when frontend source changes, without requiring manual `rm -rf` of Tauri codegen-assets cache.

**Scope (in)**:
- Auto-detect stale `tauri-codegen-assets` cache in `scripts/build-mac.sh` and clear it
- Embed a build marker (`BUILD_MARKER` const) in the Rust binary, derived from `dist/` content
- Verify post-build that the marker in the binary matches current `dist/`
- Document regression checklist

**Scope (out — YAGNI)**:
- ❌ Deep Tauri 2.x source-code research into `tauri::generate_context!()` invalidation logic
- ❌ `build.rs` `cargo:rerun-if-changed` approach (uncertain whether tauri-build honors it)
- ❌ Cross-platform support (this is macOS-only, parallel Windows fix is separate)
- ❌ Full rewrite of `scripts/build-mac.sh` (only add 2 steps + helper function)
- ❌ Bash unit-test framework (smoke test 11/11 is sufficient)

---

## 2. Architecture

The fix is **script-level workaround hardening**. Two new steps in `scripts/build-mac.sh`:

| Step | Timing | Purpose |
|------|--------|---------|
| `[1.5/3]` Detect stale codegen-assets | After pre-cleanup, before `cargo tauri build` | Compare `dist/` mtime vs each `target/$MODE/build/claude-config-manager-*/out/tauri-codegen-assets/` mtime. If stale, `rm -rf` that hash dir only (preserves sccache for other crates). |
| `[2.5/3]` Verify dist inlined | After `cargo tauri build` succeeds, before report | Grep `BUILD_MARKER` from binary, verify it matches current `dist/` hash. Fail loudly with actionable remediation if mismatch. |

Plus a small `src-tauri/build.rs` change to compute and embed the marker:

- Reads `../dist/` max mtime at build time
- Sets `cargo:rustc-env=DIST_HASH=<hex>`
- `tauri_build::build()` proceeds as before

And `src-tauri/src/lib.rs` declares:

```rust
pub const BUILD_MARKER: &str = concat!("ccm-build-mtime-", env!("DIST_HASH"));
```

**Why this works**:
- `tauri::generate_context!()` embeds `dist/` content (possibly lz4-compressed) into the binary's data section.
- Rust `pub const &str` compiles to raw bytes in `.rodata`, NOT subject to lz4 compression — `strings <binary> | grep` finds it.
- By making the marker derive from `dist/` mtime, we get a verifiable anchor: if the marker in the binary matches the current `dist/` mtime, the binary MUST contain fresh dist.

**Why we don't fully fix Tauri 2.x**: The user's chosen scope is "workaround hardening, not root-cause research." If Tauri 2.x later changes codegen-assets invalidation behavior, our safeguard will still work (it's defensive at the script level, independent of Tauri's internal cache logic).

---

## 3. Detailed implementation

### 3.1 `src-tauri/build.rs` (MODIFY existing — add DIST_HASH alongside existing git/timestamp logic)

The file already exists with M3 / M2.8 content (BUILD_GIT_COMMIT, BUILD_HASH, BUILD_TIMESTAMP). We **extend** it, not replace it.

```rust
// src-tauri/build.rs — v3.4.4
//
// Computes a content fingerprint of ../dist and embeds it as a Rust
// const (BUILD_MARKER in src/lib.rs) so scripts/build-mac.sh can grep
// the binary post-build to verify the dist was actually inlined.
//
// Without this marker, Tauri 2.x silently serves stale dist from
// target/$MODE/build/claude-config-manager-*/out/tauri-codegen-assets/
// even after `cargo tauri build` succeeds. See:
//   .planning/milestones/v3.4-phases/bug-appheader-cache-stale.md
//   docs/superpowers/specs/2026-06-29-fix-appheader-cache-stale-design.md

use std::path::Path;
use std::time::UNIX_EPOCH;
use walkdir::WalkDir;

fn main() {
    let dist_dir = Path::new("../dist");
    let dist_hash = compute_dist_mtime_max(dist_dir);
    println!("cargo:rustc-env=DIST_HASH={}", dist_hash);

    // Let tauri-build proceed with its own build pipeline.
    tauri_build::build()
}

/// Returns the max mtime (epoch seconds, hex) across all files under `dir`.
/// Returns "0" if dir doesn't exist or is empty.
fn compute_dist_mtime_max(dir: &Path) -> String {
    let mut max_secs: u64 = 0;
    if dir.exists() {
        for entry in WalkDir::new(dir)
            .into_iter()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().is_file())
        {
            if let Ok(meta) = entry.metadata() {
                if let Ok(mtime) = meta.modified() {
                    if let Ok(d) = mtime.duration_since(UNIX_EPOCH) {
                        max_secs = max_secs.max(d.as_secs());
                    }
                }
            }
        }
    }
    format!("{:x}", max_secs)
}
```

**`src-tauri/Cargo.toml` change**: add `[build-dependencies] walkdir = "=2.5.0"` (per CLAUDE.md §2.3 version lock). Verify after first build with `cargo tree -i walkdir` — if `tauri-build`'s transitive walkdir is a different version, switch to that one to avoid two copies in the build graph.

### 3.2 `src-tauri/src/lib.rs` (add one const)

```rust
/// Build marker — embedded in binary .rodata. Grepable via `strings`.
/// Re-computed at every build from dist/* max mtime; if dist changes,
/// this const changes → cargo re-runs build.rs → tauri-build re-inlines
/// fresh dist. (bug-appheader-cache-stale.md)
pub const BUILD_MARKER: &str = concat!("ccm-build-mtime-", env!("DIST_HASH"));
```

### 3.3 `scripts/build-mac.sh` changes

**Pre-flight check** (add near top, after env setup):

```bash
# === Pre-flight checks ===
[[ -f "$PROJECT_ROOT/src-tauri/build.rs" ]] || {
  echo "FAIL: src-tauri/build.rs missing."
  echo "      v3.4.4 fix requires this file to embed BUILD_MARKER."
  echo "      See .planning/milestones/v3.4-phases/bug-appheader-cache-stale.md"
  exit 1
}
command -v strings >/dev/null 2>&1 || {
  echo "WARN: 'strings' not found; verification step [2.5/3] will be skipped."
  echo "      Install Xcode CLT: xcode-select --install"
}
```

**Helper function** (add near top of script, after MODE/EXTRA_ARGS parsing):

```bash
# Returns hex of max mtime epoch seconds across all files in $1.
# Mirrors compute_dist_mtime_max in src-tauri/build.rs.
compute_dist_hash_inline() {
  local dir="$1"
  [[ ! -d "$dir" ]] && { echo "0"; return; }
  local max=0
  while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    local secs
    # macOS BSD stat: -f '%m' = mtime epoch seconds
    secs=$(stat -f '%m' "$f" 2>/dev/null || echo 0)
    (( secs > max )) && max=$secs
  done < <(find "$dir" -type f 2>/dev/null)
  printf '%x\n' "$max"
}
```

**New `[1.5/3]` step** (insert after pre-cleanup, before "Step 2: Build"):

```bash
# === Step 1.5: Clear stale Tauri codegen-assets ===
# Tauri 2.x embeds frontendDist ("../dist") into the binary via
# tauri::generate_context!(). The codegen-assets output is cached
# under target/$MODE/build/claude-config-manager-<hash>/out/.
# cargo tauri build does NOT detect dist content changes; if you
# edit src/ and re-run, the binary still contains the OLD dist.
#
# Fix: before each build, compare the max mtime of dist/ against
# the max mtime of each codegen-assets dir. If dist is newer, clear
# that hash dir so cargo regenerates it. (Bug: bug-appheader-cache-stale.md)

DIST_DIR="$PROJECT_ROOT/dist"
BUILD_DIR="$PROJECT_ROOT/src-tauri/target/$MODE/build"

if [[ -d "$DIST_DIR" && -d "$BUILD_DIR" ]]; then
  DIST_HASH=$(compute_dist_hash_inline "$DIST_DIR")
  if [[ "$DIST_HASH" != "0" ]]; then
    CLEARED=0
    while IFS= read -r hashdir; do
      ASSETS_DIR="$hashdir/out/tauri-codegen-assets"
      [[ ! -d "$ASSETS_DIR" ]] && continue
      ASSETS_HASH=$(compute_dist_hash_inline "$ASSETS_DIR")
      if [[ "$ASSETS_HASH" != "$DIST_HASH" ]]; then
        echo "[1.5/3] Stale codegen-assets detected → rm -rf $hashdir"
        rm -rf "$hashdir"
        CLEARED=$((CLEARED + 1))
      fi
    done < <(find "$BUILD_DIR" -maxdepth 1 -type d -name 'claude-config-manager-*')
    if [[ $CLEARED -eq 0 ]]; then
      echo "[1.5/3] codegen-assets fresh (hash=$DIST_HASH matches)"
    else
      echo "[1.5/3] cleared $CLEARED stale hash dir(s)"
    fi
  fi
fi
```

**Note**: Detection compares hashes (not raw mtime floats) for robustness — same algorithm in both build.rs and build-mac.sh, so any divergence is caught.

**New `[2.5/3]` step** (insert after `cargo tauri build` succeeds, before "Step 3: Report"):

```bash
# === Step 2.5: Verify dist content actually inlined into binary ===
# Greps for BUILD_MARKER (Rust pub const embedded as raw text in
# .rodata, NOT lz4-compressed). Marker value should match the
# current dist/ hash. If mismatch, Tauri did not re-inline. (bug-appheader-cache-stale.md)

APP_BIN="$PROJECT_ROOT/src-tauri/target/$MODE/bundle/macos/ClaudeManager.app/Contents/MacOS/claude-config-manager"

if [[ -x "$APP_BIN" ]] && command -v strings >/dev/null 2>&1; then
  echo "[2.5/3] Verifying BUILD_MARKER in binary..."

  EXPECTED_HASH=$(compute_dist_hash_inline "$DIST_DIR")
  EXPECTED_MARKER="ccm-build-mtime-$EXPECTED_HASH"

  ACTUAL_MARKER=$(strings "$APP_BIN" 2>/dev/null | \
    grep -oE 'ccm-build-mtime-[0-9a-f]+' | \
    head -1 || true)

  if [[ -z "$ACTUAL_MARKER" ]]; then
    echo "FAIL: BUILD_MARKER not found in binary." >&2
    echo "      Binary: $APP_BIN" >&2
    echo "      This suggests build.rs didn't run or src-tauri/src/lib.rs" >&2
    echo "      is missing the BUILD_MARKER const." >&2
    echo "      Remediation: cd src-tauri && cargo clean -p claude-config-manager && rerun" >&2
    exit 1
  fi

  if [[ "$ACTUAL_MARKER" != "$EXPECTED_MARKER" ]]; then
    echo "FAIL: BUILD_MARKER mismatch — dist content NOT inlined into binary." >&2
    echo "      Expected: $EXPECTED_MARKER" >&2
    echo "      Got:      $ACTUAL_MARKER" >&2
    echo "      This is the bug from .planning/milestones/v3.4-phases/bug-appheader-cache-stale.md" >&2
    echo "      Tauri 2.x codegen-assets cache is stale despite [1.5/3] cleanup." >&2
    echo "      Remediation:" >&2
    echo "        rm -rf src-tauri/target/$MODE/build/claude-config-manager-*" >&2
    echo "        # OR:" >&2
    echo "        cd src-tauri && cargo clean -p claude-config-manager" >&2
    echo "        # Then rerun: $0" >&2
    exit 1
  fi

  echo "    ✓ BUILD_MARKER matches: $ACTUAL_MARKER"
fi
```

**Why macOS `stat -f '%m'`**: macOS BSD stat doesn't support GNU `--format='%Y'`. `stat -f '%m'` is the BSD syntax for mtime epoch seconds.

---

## 4. Error handling

| Scenario | Detection | Behavior | Exit |
|----------|-----------|----------|------|
| `dist/` missing | `[[ -d "$DIST_DIR" ]]` | Skip [1.5/3] silently; `cargo tauri build` will fail loudly via `beforeBuildCommand` | cargo's exit code |
| `build/` missing (first run) | `[[ -d "$BUILD_DIR" ]]` | Skip [1.5/3] silently; first build proceeds | 0 |
| No `claude-config-manager-*` dirs | `find` returns empty | Skip [1.5/3] silently | 0 |
| `dist/` empty (no files) | `DIST_HASH == "0"` | Skip [1.5/3] silently | 0 |
| `walkdir` not in Cargo.toml | `cargo build` fails | Let cargo error propagate | cargo's exit code |
| `src-tauri/build.rs` missing | Pre-flight check | "FAIL: build.rs missing" with reference to bug doc | 1 |
| `tauri-build` API changes (2.x → 3.x) | `cargo build` fails | Let cargo error propagate | cargo's exit code |
| `cargo tauri build` fails | Existing `$?` check (pre-existing) | Existing error handling | 1 |
| `strings` missing | `command -v strings` | WARN + skip [2.5/3] (degraded mode, no fail) | 0 |
| `stat -f '%m'` unsupported (impossible on macOS) | `stat` fails → hash=0 | Verification fails with mismatch | 1 |
| Multiple `BUILD_MARKER` hits in binary | `head -1` takes first | Use first occurrence (marker should only appear once) | 0 |
| Marker grep returns nothing | `ACTUAL_MARKER == ""` | "FAIL: marker not in binary" + remediation | 1 |
| Marker present but mismatch | `ACTUAL_MARKER != EXPECTED_MARKER` | "FAIL: stale dist" + actionable remediation | 1 |

**No auto-retry on verification failure** — by design. If [1.5/3] cleanup didn't help, something is wrong with our detection or Tauri behavior changed. Fail loudly so dev can investigate, rather than masking root cause with auto-fallback (matches M2.17-C3 dist fingerprint lesson spirit).

---

## 5. Testing strategy

Following CLAUDE.md §5.2 TDD spirit, but pragmatically scoped (no separate bash test framework — script-level fixes integrate with existing smoke test).

### 5.1 Add to ship smoke test (CLAUDE.md §13)

Existing 10-item smoke test → **11 items**. New item #11:

```
[11] BUILD_MARKER in binary matches current dist mtime
     # macOS BSD stat (-f '%m'); same algorithm as build-mac.sh [2.5/3] and src-tauri/build.rs
     # Run on macOS only; Windows smoke runner uses equivalent stat via PowerShell (out of scope per §1)
     commands: bash -c 'DIST_HASH=$(find dist -type f -exec stat -f "%m" {} \; | sort -nr | head -1); \
                       ACTUAL=$(strings src-tauri/target/release/bundle/macos/ClaudeManager.app/Contents/MacOS/claude-config-manager | grep -oE "ccm-build-mtime-[0-9a-f]+" | head -1); \
                       [[ "ccm-build-mtime-$(printf "%x" $DIST_HASH)" == "$ACTUAL" ]]'
     expected:  PASS (matches)
```

### 5.2 Manual regression checklist (4 tests)

Document these in `.planning/milestones/v3.4-phases/bug-appheader-cache-stale.md` "Regression test" section. Run once after implementation to verify fix; rerun if Tauri 2.x is upgraded.

**Test A — Normal edit flow (positive)**
1. Add a unique string: `echo '<span>UNIQUE-MARKER-$(date +%s)</span>' >> src/components/AppHeader.tsx`
2. Run `./scripts/install-to-applications-mac.sh --milestone M4 --task 0.1 --slug cache-fix-test --debug`
3. Launch `/Applications/ClaudeManager.app`, check header shows UNIQUE-MARKER
4. Verify BUILD_MARKER in binary matches current dist mtime → PASS

**Test B — Forced stale cache (regression)**
1. Complete one normal build (verification passes)
2. Manually: `touch dist/assets/index-*.js` (simulate "frontend changed but no rebuild")
3. Temporarily comment out `[1.5/3]` in `build-mac.sh`
4. Rebuild → verification should FAIL (marker mismatch)
5. Restore `[1.5/3]`, rebuild → PASS

**Test C — Warm cache preserved (perf regression)**
1. Run build once, ~50s (warm)
2. Without changing source, run again → should be ~40s (warm preserved)
3. Verify `src-tauri/target/debug/build/claude-config-manager-*` still exists (not cleared)

**Test D — First build (cold cache)**
1. `rm -rf src-tauri/target`
2. Run `install-to-applications-mac.sh`
3. Verify [2.5/3] passes, binary contains marker

### 5.3 What we're NOT testing (YAGNI)

- ❌ Bash unit tests for `compute_dist_hash_inline` — ~10 lines, visually obvious, integration-tested via smoke
- ❌ Rust unit tests for `build.rs` — if `cargo build` succeeds, build.rs works
- ❌ UI e2e (already covered by ship smoke test manual checklist)

---

## 6. Documentation updates

### 6.1 `scripts/build-mac.sh` header

Add a "v3.4.4" section explaining the new steps:

```bash
# v3.4.4 — Auto-clear stale Tauri codegen-assets
#   [1.5/3] Before cargo tauri build: detect + clear stale
#           target/$MODE/build/claude-config-manager-*/out/tauri-codegen-assets/
#           (preserves sccache warm cache for other crates).
#   [2.5/3] After build: grep BUILD_MARKER (ccm-build-mtime-<hex>) from
#           binary, verify matches current dist/ mtime. Fail loudly if
#           mismatch (Tauri cache stale despite cleanup).
#   See: .planning/milestones/v3.4-phases/bug-appheader-cache-stale.md
```

### 6.2 `.planning/milestones/v3.4-phases/bug-appheader-cache-stale.md`

Status section:
- `未解决` → `已解决 (2026-06-29 via script-level workaround hardening; see docs/superpowers/specs/2026-06-29-fix-appheader-cache-stale-design.md)`

"Workaround" section:
- "手动 rm -rf" → "已自动化为 [1.5/3]; 手动 rm -rf 仅在 [2.5/3] 验证失败时备用"

New "Regression test" section:
- Insert Tests A/B/C/D from §5.2

"已知相关 bug 报告 (待查)" section:
- Mark: `✅ 不需要查了 — workaround 已 ship,verified by smoke test #11`

### 6.3 `src-tauri/build.rs` (if new) header

```rust
// v3.4.4 fix — embed dist content fingerprint into binary.
// See .planning/milestones/v3.4-phases/bug-appheader-cache-stale.md
```

---

## 7. Commit strategy (CLAUDE.md §2 + §9)

**Single atomic commit**:

```
fix(macOS): auto-clear stale Tauri codegen-assets + verify dist inlined (v3.4.4)

scripts/build-mac.sh — two new steps:
  [1.5/3] Before cargo tauri build: compute dist hash, compare against
          each target/$MODE/build/claude-config-manager-*/out/tauri-codegen-assets/.
          If hash differs, rm -rf that hash dir only (preserves sccache
          warm cache for non-codegen crates).
  [2.5/3] After build: grep binary for BUILD_MARKER (ccm-build-mtime-<hex>),
          verify matches current dist hash. Fail loudly if mismatch.

src-tauri/build.rs — NEW: compute max mtime of ../dist, set as
cargo:rustc-env=DIST_HASH. Combined with BUILD_MARKER const in lib.rs,
gives a stable grep-able anchor for verification.

src-tauri/Cargo.toml — add walkdir as build-dependency.

Fixes: .planning/milestones/v3.4-phases/bug-appheader-cache-stale.md
Refs:  docs/superpowers/specs/2026-06-29-fix-appheader-cache-stale-design.md
```

**Commit scope**:
- Files changed: scripts/build-mac.sh, src-tauri/build.rs, src-tauri/src/lib.rs, src-tauri/Cargo.toml
- Max 4 files — within CLAUDE.md §2.4 limit (white-list >2 files rule)

**Pre-commit self-check**:
- Run ship smoke test (10 existing + new #11) — must 11/11 PASS
- `git status` review — diff must be limited to 4 files
- Diff size — estimate <200 LOC (small, reviewable)

**Post-commit doc update** (separate commit):
- Update bug report status to "已解决"
- This keeps the code-fix commit atomic and the doc-update traceable

---

## 8. Risk & rollback

**Risks**:
- **Low**: Script change is additive; existing build path unchanged when detection finds nothing stale
- **Low**: `src-tauri/build.rs` change adds <20 LOC; if `walkdir` dep causes cargo resolve issue, easy revert
- **Medium**: Tauri 2.x upgrade could change codegen-assets layout; if `tauri-codegen-assets` dir name changes, detection breaks. Mitigation: explicit `find -name 'claude-config-manager-*'` is crate-name-scoped (matches package name in Cargo.toml `[package].name`); if crate renamed, find pattern needs update.

**Rollback** (1 minute):
- `git revert <commit>` — restores all 4 files to pre-fix state
- OR delete new steps manually from `scripts/build-mac.sh` (lines clearly marked with "v3.4.4" comment)
- Build continues working as before (without the safeguard, but also without the regression)

**Performance impact**:
- `[1.5/3]` overhead: ~30ms when stale, <5ms when fresh (one `find` + few `stat` per hash dir)
- `[2.5/3]` overhead: ~50ms (one `strings` + `grep`)
- `[1.5/3]` + `[2.5/3]` combined: ~80ms per build — negligible vs ~40s warm build time
- sccache cache: only codegen hash dirs cleared when stale; all other crate caches preserved

---

## 9. Open questions / future work

None blocking. Optional future enhancements (out of scope):

1. **Apply same pattern to Windows `scripts/build-and-ship.sh`** — Tauri codegen-assets cache behavior is identical on Windows; bug exists there too
2. **Investigate Tauri 2.x `tauri::generate_context!()` invalidation** — if there's a Tauri flag/config that fixes this properly (no script workaround needed), upstream our finding
3. **Investigate why lz4 compression doesn't apply to Rust const strings** — useful knowledge for future build-marking patterns
4. **Promote manual regression checklist (Tests A-D) to automated CI** — only if CI infra grows

---

## 10. Acceptance criteria

Implementation is complete when ALL of:

- [ ] `src-tauri/build.rs` exists and computes `DIST_HASH` correctly
- [ ] `src-tauri/src/lib.rs` declares `pub const BUILD_MARKER`
- [ ] `src-tauri/Cargo.toml` declares `walkdir` as build-dep
- [ ] `scripts/build-mac.sh` has `[1.5/3]` and `[2.5/3]` steps
- [ ] Ship smoke test passes 11/11 (including new BUILD_MARKER check)
- [ ] Test A (normal edit) passes — header shows new content after rebuild
- [ ] Test B (forced stale cache) — verification step fails when detection disabled
- [ ] Test C (warm cache preserved) — second build doesn't unnecessarily clear codegen
- [ ] Test D (first build) — cold-cache build works end-to-end
- [ ] `.planning/milestones/v3.4-phases/bug-appheader-cache-stale.md` updated to "已解决"
- [ ] Single atomic commit + separate doc-update commit

---

*End of design doc. Awaiting user review before invoking writing-plans skill.*
