// build.rs — compile-time injection for app metadata (M2.8 F8).
//
// Two env vars are emitted via `cargo:rustc-env=`, then read at runtime
// with `env!()` in `commands::app::get_app_metadata`:
//
//   - BUILD_GIT_COMMIT — short SHA of HEAD at build time
//   - BUILD_TIMESTAMP  — Unix epoch seconds at build time
//
// We also emit `cargo:rerun-if-changed` for the HEAD ref so cargo
// invalidates this script's output when the user commits between
// builds. Without that, `env!("BUILD_GIT_COMMIT")` would silently
// return the SHA from the first build of the session.
//
// Failure mode: if `git` is not on PATH (CI runner / clean tarball),
// we emit "unknown" rather than failing the build. The metadata
// command will surface "unknown" as-is, and tests assert the field
// is non-empty (not a specific value).
//
// v3.4.4 fix — also compute DIST_HASH = hex(max mtime of ../dist) and
// emit as `cargo:rustc-env=DIST_HASH`. Combined with the BUILD_MARKER
// const in lib.rs, this gives scripts/build-mac.sh a stable grep-able
// anchor to verify the dist was actually inlined into the binary
// (Tauri 2.x silently serves stale dist from codegen-assets cache).
// See .planning/milestones/v3.4-phases/bug-appheader-cache-stale.md
// + docs/superpowers/specs/2026-06-29-fix-appheader-cache-stale-design.md.

use std::path::Path;
use std::time::UNIX_EPOCH;
use walkdir::WalkDir;

fn main() {
    // ---- 1. Git commit ----
    let git_commit = std::process::Command::new("git")
        .args(["rev-parse", "--short", "HEAD"])
        .output()
        .ok()
        .and_then(|o| {
            if o.status.success() {
                String::from_utf8(o.stdout).ok()
            } else {
                None
            }
        })
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "unknown".to_string());
    println!("cargo:rustc-env=BUILD_GIT_COMMIT={git_commit}");

    // ---- 1b. M3.7 build_hash ----
    // 清单 18 要求 about 页显示 build hash (= git short SHA)。
    // 单独再 emit 一个 BUILD_HASH env var,以保持向后兼容(已有 F8
    // get_app_metadata 仍读 BUILD_GIT_COMMIT),并为后续在 JSON /
    // 标识符中嵌入 hash 留出独立字段。
    println!("cargo:rustc-env=BUILD_HASH={git_commit}");

    // ---- 2. Build timestamp (Unix epoch seconds) ----
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    println!("cargo:rustc-env=BUILD_TIMESTAMP={ts}");

    // ---- 2b. v3.4.4 DIST_HASH (max mtime of ../dist, hex epoch seconds) ----
    let dist_dir = Path::new("../dist");
    let dist_hash = compute_dist_mtime_max(dist_dir);
    println!("cargo:rustc-env=DIST_HASH={}", dist_hash);

    // ---- 3. Re-run triggers ----
    // Re-build when HEAD moves so the SHA above stays accurate.
    // The .git layout uses HEAD (a ref pointer) and refs/heads/<branch>
    // (the actual SHA). We watch both. Path is relative to src-tauri/.
    println!("cargo:rerun-if-changed=../.git/HEAD");
    println!("cargo:rerun-if-changed=../.git/refs/heads");

    tauri_build::build()
}

/// Returns the max mtime (epoch seconds, hex) across all files under `dir`.
/// Returns "0" if dir doesn't exist or is empty. Mirrors the bash
/// `compute_dist_hash_inline` helper in scripts/build-mac.sh so any
/// divergence between Rust and bash sides is caught at verification time.
fn compute_dist_mtime_max(dir: &Path) -> String {
    // Quantize to 5-second buckets to tolerate the ~1s mtime drift
    // between dist/ and target/.../tauri-codegen-assets/ (Tauri's
    // codegen step copies dist into codegen-assets during the build,
    // bumping its mtime by 1s). Without bucketing, [1.5/3] would
    // always report stale on warm cache and clear the codegen dir,
    // defeating the sccache warm-cache optimization.
    // Mirrors `compute_dist_hash_inline` in scripts/build-mac.sh.
    const BUCKET_SECS: u64 = 5;
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
                        let secs = (d.as_secs() / BUCKET_SECS) * BUCKET_SECS;
                        max_secs = max_secs.max(secs);
                    }
                }
            }
        }
    }
    format!("{:x}", max_secs)
}
