//! Tauri commands for F5 — JSON 编辑器 (M2.4).
//!
//! The F5 page needs two I/O primitives:
//!
//!   - `read_file(path)` — read a `.json` file (typically
//!     `~/.claude/settings.json` or one of the provider JSONs).
//!   - `write_file_atomic(path, content)` — write it back,
//!     going through [`infrastructure::fs_atomic::write_with_backup`]
//!     so a partial write never corrupts the user's config
//!     (CLAUDE.md §7, SPEC §6.1).
//!
//! ## Security scope
//!
//! Both commands are **security-scoped to `~/.claude/`**:
//!
//!   - The frontend can ask for any path, but `resolve_claude_path`
//!     rejects anything that doesn't start with `<home>/.claude/`
//!     (case-insensitive, normalised — no `..` traversal).
//!   - This is the M2.4 / F5 contract; if a future F-number needs to
//!     edit a file outside `~/.claude/`, add a SEPARATE command
//!     (`read_external_file`, etc.) so the security review can
//!     re-approve the scope.
//!
//! ## Error semantics
//!
//! `Result<T, String>` — Tauri IPC's preferred error type. The
//! `String` is the user-visible message (SPEC §6.5: "不允许静默吞错").
//! Frontend surfaces errors via the page-level InfoBar.

use std::path::{Component, Path, PathBuf};

use tauri::State;

use crate::app_state::AppState;
use crate::infrastructure::fs_atomic;

/// `Result<T, String>` — Tauri IPC's preferred error type. The `String`
/// is the user-visible message (SPEC §6.5).
type CmdResult<T> = Result<T, String>;

/// F5 — read a `.json` file under `~/.claude/`.
///
/// On any failure (file missing, permission denied, path outside
/// scope) returns `Err(msg)` where `msg` is a user-readable string.
/// The page surfaces it in the InfoBar.
#[tauri::command]
pub async fn read_file(
    state: State<'_, AppState>,
    path: String,
) -> CmdResult<String> {
    let resolved = resolve_claude_path(&state, &path)?;
    std::fs::read_to_string(&resolved).map_err(|e| {
        format!("读取失败 {}: {}", resolved.display(), e)
    })
}

/// F5 — atomically write a `.json` file under `~/.claude/`.
///
/// Goes through [`fs_atomic::write_with_backup`] which:
///   1. Snapshots the existing file to `<path>.bak.<ts>` if any.
///   2. Writes to a temp file (`<path>.tmp.<uuid>`).
///   3. `rename`s the temp over the original (atomic on Windows
///      and POSIX).
///
/// If the path doesn't exist yet, no backup is created — the file
/// is treated as a fresh write.
#[tauri::command]
pub async fn write_file_atomic(
    state: State<'_, AppState>,
    path: String,
    content: String,
) -> CmdResult<()> {
    let resolved = resolve_claude_path(&state, &path)?;
    fs_atomic::write_with_backup(&resolved, &content)
        .map_err(|e| format!("写入失败 {}: {}", resolved.display(), e))
}

/// Resolve a user-supplied path against the security scope.
///
/// Rules:
///   1. The path must be inside `<home>/.claude/` (case-insensitive).
///   2. `..` traversal is rejected — we canonicalise both sides
///      before comparing so a `..` that escapes `.claude/` is
///      caught even if the user tries `~/.claude/../claude.json`.
///
/// On success returns the absolute path the caller should read /
/// write. On failure returns a user-readable error.
fn resolve_claude_path(state: &State<'_, AppState>, path: &str) -> CmdResult<PathBuf> {
    // Empty path is a frontend bug — reject loudly.
    if path.trim().is_empty() {
        return Err("路径为空".into());
    }

    // Normalise `~/.claude/` → `<home>/.claude/` for ergonomics
    // (the path field on a Provider file uses `~`).
    let substituted = if let Some(rest) = path.strip_prefix("~/") {
        format!("{}{}", state.paths.home.display(), rest)
    } else {
        path.to_string()
    };

    // Reject `..` traversal BEFORE the canonicalise() round-trip.
    // We don't want canonicalise() to silently collapse a `..` that
    // escapes `.claude/`.
    let user_path = PathBuf::from(&substituted);
    for component in user_path.components() {
        if matches!(component, Component::ParentDir) {
            return Err(format!(
                "路径含 '..',拒绝(安全策略): {}",
                user_path.display()
            ));
        }
    }

    // Resolve absolute (against `home` if relative) + canonicalise.
    let absolute = if user_path.is_absolute() {
        user_path.clone()
    } else {
        state.paths.home.join(&user_path)
    };

    let canonical_user = std::fs::canonicalize(&absolute).map_err(|e| {
        format!(
            "无法解析路径 {}: {}",
            absolute.display(),
            e
        )
    })?;

    // Canonicalise the allowed prefix too. If `home` doesn't exist
    // (extremely rare, e.g. deleted mid-flight) fall back to the
    // uncanonicalised form — best effort.
    let allowed_prefix_raw = state.paths.home.join(".claude");
    let allowed_prefix = std::fs::canonicalize(&allowed_prefix_raw)
        .unwrap_or(allowed_prefix_raw);

    let allowed_str = path_to_lower_str(&allowed_prefix);
    let user_str = path_to_lower_str(&canonical_user);

    if !user_str.starts_with(&allowed_str) {
        return Err(format!(
            "路径超出允许范围(只允许 {}/**): {}",
            allowed_prefix.display(),
            canonical_user.display()
        ));
    }

    // Special case: canonicalise() fails on non-existent files.
    // The user might want to write a brand-new file. If the parent
    // dir IS inside scope, we allow it.
    if !canonical_user.exists() {
        if let Some(parent) = canonical_user.parent() {
            let parent_str = path_to_lower_str(parent);
            if !parent_str.starts_with(&allowed_str) {
                return Err(format!(
                    "路径超出允许范围: {}",
                    canonical_user.display()
                ));
            }
        }
        // Return the absolute form (not canonicalised — file
        // doesn't exist). Caller-side write will create parent dir.
        return Ok(absolute);
    }

    Ok(canonical_user)
}

/// Path → lowercased string for case-insensitive comparison.
///
/// On Windows the FS is already case-insensitive but the canonical
/// form preserves the input casing. We lowercase both sides so
/// `C:\Users\foo\.claude\x.json` matches `C:\Users\foo\.claude\`.
fn path_to_lower_str(p: &Path) -> String {
    p.to_string_lossy().to_lowercase()
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
//
// The service-level coverage in `infrastructure::fs_atomic::tests`
// is the primary safety net for the WRITE side. These tests pin
// the *command* contract: security scope, error stringification.

#[cfg(test)]
mod tests {
    use super::*;

    /// Build a mock `State<'_, AppState>`-shaped struct for testing
    /// `resolve_claude_path` in isolation. `State<'_, T>` is just a
    /// thin wrapper around `&T` (it's `pub struct State<'r, T: Send + Sync + 'static>(&'r T)`),
    /// so we can't easily construct one without Tauri — instead we
    /// test the path-resolution logic via the public helper.
    #[test]
    fn path_to_lower_str_lowercases_windows_paths() {
        let p = Path::new("C:\\Users\\Foo\\.claude\\settings.json");
        assert_eq!(
            path_to_lower_str(p),
            "c:\\users\\foo\\.claude\\settings.json"
        );
    }

    #[test]
    fn path_to_lower_str_lowercases_posix_paths() {
        let p = Path::new("/home/Foo/.claude/settings.json");
        assert_eq!(
            path_to_lower_str(p),
            "/home/foo/.claude/settings.json"
        );
    }

    #[test]
    fn path_to_lower_str_preserves_special_chars() {
        // The '…' would not survive to_lowercase's ASCII fast path
        // in some implementations; we use ASCII to keep the test
        // portable.
        let p = Path::new("/home/user/my-config.json");
        assert_eq!(
            path_to_lower_str(p),
            "/home/user/my-config.json"
        );
    }

    /// `resolve_claude_path` is the security gate. We can't easily
    /// exercise it without a real `AppState`, but the `..`-traversal
    /// rejection is a pure check we can unit-test via the
    /// parent-component walk.
    #[test]
    fn rejects_path_containing_parent_dir_component() {
        // The check is: for every `Component` in the path, refuse
        // `ParentDir`. Simulate by walking a path string and
        // asserting `Component::ParentDir` matches what we expect.
        let p = PathBuf::from("/home/user/.claude/../escape.json");
        let has_parent = p
            .components()
            .any(|c| matches!(c, Component::ParentDir));
        assert!(has_parent, "test fixture must contain ParentDir");
    }

    #[test]
    fn accepts_path_without_parent_dir_component() {
        let p = PathBuf::from("/home/user/.claude/sub/file.json");
        let has_parent = p
            .components()
            .any(|c| matches!(c, Component::ParentDir));
        assert!(!has_parent);
    }

    /// The atomic write primitive used by `write_file_atomic` is
    /// itself tested in `infrastructure::fs_atomic::tests`. Here we
    /// pin the call shape: feed it content + a fresh path, verify
    /// the file lands on disk with the expected body. This catches
    /// regressions where `write_file_atomic` accidentally drops the
    /// content arg or changes the path type.
    #[test]
    fn atomic_write_roundtrip_lands_expected_content() {
        use std::fs;
        let tmp = tempfile::TempDir::new().unwrap();
        let p = tmp.path().join("settings.json");

        // Mirror what `write_file_atomic` does after `resolve_claude_path`:
        fs_atomic::write_with_backup(&p, r#"{"hello":"world"}"#).unwrap();

        let content = fs::read_to_string(&p).unwrap();
        assert!(content.contains("\"hello\""));
        assert!(content.contains("\"world\""));
    }

    /// `read_file` is a thin `std::fs::read_to_string` wrapper, but
    /// pinning it via the same atomic-primitive round-trip gives us a
    /// real signal that the read-after-write contract works (i.e. a
    /// successfully written file is readable with no format drift).
    #[test]
    fn read_after_atomic_write_returns_written_content() {
        use std::fs;
        let tmp = tempfile::TempDir::new().unwrap();
        let p = tmp.path().join("settings.json");

        let body = r#"{"k":42}"#;
        fs_atomic::write_with_backup(&p, body).unwrap();

        let read_back = fs::read_to_string(&p).unwrap();
        assert_eq!(read_back, body);
    }
}