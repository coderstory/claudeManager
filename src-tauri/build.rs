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

    // ---- 3. Re-run triggers ----
    // Re-build when HEAD moves so the SHA above stays accurate.
    // The .git layout uses HEAD (a ref pointer) and refs/heads/<branch>
    // (the actual SHA). We watch both. Path is relative to src-tauri/.
    println!("cargo:rerun-if-changed=../.git/HEAD");
    println!("cargo:rerun-if-changed=../.git/refs/heads");

    tauri_build::build()
}
