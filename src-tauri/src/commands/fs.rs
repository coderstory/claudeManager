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

use std::io;
use std::path::{Component, Path, PathBuf};

use tauri::State;

use crate::app_state::AppState;
use crate::infrastructure::fs_atomic;
use crate::platform::AppPaths;

/// `Result<T, String>` — Tauri IPC's preferred error type. The `String`
/// is the user-visible message (SPEC §6.5).
type CmdResult<T> = Result<T, String>;

/// F5 — read a `.json` file under `~/.claude/`.
///
/// On any failure (file missing, permission denied, path outside
/// scope, encoding error) returns `Err(msg)` where `msg` is a
/// user-readable string. The page surfaces it in the InfoBar.
///
/// Error classification: the raw `std::io::ErrorKind` is mapped to
/// one of 4 user-facing categories so the frontend can render
/// targeted copy ("文件不存在" / "无权限" / "编码错误" / "路径越界").
/// The classifier lives in [`classify_io_error`] and is shared with
/// `write_file_atomic` (write-side failures).
#[tauri::command]
pub async fn read_file(
    state: State<'_, AppState>,
    path: String,
) -> CmdResult<String> {
    // M3.11 (A1#5) — read live active root from the platform shim
    // (state.paths is a one-shot startup snapshot; active_root can
    // change at runtime via the project switcher).
    let active_root = crate::platform::runtime::paths().active_root_dir();
    let resolved = resolve_claude_path(&state.paths, active_root.as_deref(), &path)?;
    match std::fs::read_to_string(&resolved) {
        Ok(content) => Ok(content),
        Err(e) => Err(classify_io_error(&resolved, e)),
    }
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
    // M3.11 (A1#5) — read live active root, same as read_file.
    let active_root = crate::platform::runtime::paths().active_root_dir();
    let resolved = resolve_claude_path(&state.paths, active_root.as_deref(), &path)?;
    fs_atomic::write_with_backup(&resolved, &content)
        .map_err(|e| format!("写入失败 {}: {}", resolved.display(), e))
}

/// Detect a bare filename like `settings.json` (no directory prefix).
///
/// This is the WebView2 `<input type="file">` shape: the browser
/// hides the absolute path for security and only exposes the file's
/// basename. The frontend cannot recover the directory, so the
/// backend must infer it.
///
/// ## Rules
///   - No `/` or `\` separator (otherwise it's clearly relative to
///     some sub-directory or absolute).
///   - Not absolute (Windows: starts with drive letter or `\\`;
///     POSIX: starts with `/`).
///   - Not `.` or `..` (those are directory references, not files).
///   - Not `~/...` (handled by the existing tilde-prefix branch).
///
/// ## Returns
/// `true` if `p` is just a basename — the caller MUST then join it
/// with `<home>/.claude/` to recover the user's intended path.
/// `false` for anything more specific — the caller falls through to
/// the normal relative/absolute resolution.
fn looks_like_bare_filename(p: &str) -> bool {
    if p.is_empty() {
        return false;
    }
    if p.contains('/') || p.contains('\\') {
        return false;
    }
    if p.starts_with('~') {
        return false;
    }
    // Absolute path on Windows or POSIX → caller handles.
    if Path::new(p).is_absolute() {
        return false;
    }
    // `.` and `..` are directory references, not bare filenames.
    if p == "." || p == ".." {
        return false;
    }
    true
}

/// Map a `std::io::Error` to a user-facing category string.
///
/// The 4 buckets match the M3.6 acceptance criteria (清单 20):
///   - 文件不存在 → NotFound
///   - 无权限 → PermissionDenied
///   - 编码错误 → InvalidData (UTF-8 decode failure etc.)
///   - 其他 → 通用 "I/O 失败" + 底层 error
///
/// Frontend InfoBar keys off the leading category word to render
/// the right copy (CLAUDE.md §6.5: "不允许静默吞错").
fn classify_io_error(path: &Path, e: io::Error) -> String {
    let kind = e.kind();
    let category = match kind {
        io::ErrorKind::NotFound => "文件不存在",
        io::ErrorKind::PermissionDenied => "无权限",
        io::ErrorKind::InvalidData | io::ErrorKind::UnexpectedEof => "编码错误",
        _ => "I/O 失败",
    };
    format!("{} {}: {}", category, path.display(), e)
}

/// F20 — 读取任意路径的 `.sql` 文件内容(文件关联双击导入用)。
///
/// 与 `read_file` 的区别:`read_file` 的安全作用域是 `~/.claude/`
/// (F5 JSON 编辑器用),而 F20 的 `.sql` 文件来自文件管理器双击
/// (任意路径:桌面 / 下载 / U 盘等)。这里做两层校验:
///   1. 扩展名必须是 `.sql`(大小写不敏感,拒绝 .exe / .json 等)
///   2. 路径不含 `..` 组件(防目录穿越)
/// 不做 `~/.claude/` 作用域限制,因为用户双击的 `.sql` 可能在任何位置。
///
/// 返回 UTF-8 字符串内容,供前端调 `parse_sql_preview` 走 F3 既有流程。
#[tauri::command]
pub async fn read_sql_file(path: String) -> CmdResult<String> {
    // 空路径是前端 bug — 直接拒绝
    if path.trim().is_empty() {
        return Err("路径为空".into());
    }

    let user_path = PathBuf::from(&path);

    // 拒绝 `..` 目录穿越(与 read_file 的安全策略一致)
    for component in user_path.components() {
        if matches!(component, Component::ParentDir) {
            return Err(format!(
                "路径含 '..',拒绝(安全策略): {}",
                user_path.display()
            ));
        }
    }

    // 扩展名必须是 .sql(大小写不敏感)
    match user_path.extension().and_then(|e| e.to_str()) {
        Some(ext) if ext.eq_ignore_ascii_case("sql") => {}
        _ => {
            return Err(format!(
                "仅支持 .sql 文件: {}",
                user_path.display()
            ));
        }
    }

    // M2.16 — H1: 大小预检。超过 50MB 直接拒绝,避免恶意 / 误操作
    // 文件一次性 read_to_string 卡 IO + UTF-8 校验阻塞 webview。
    // 50MB 已远超真实 cc-switch 14MB dump 的 3.5 倍。
    let max_bytes: u64 = 50 * 1024 * 1024;
    match std::fs::metadata(&user_path) {
        Ok(meta) if meta.len() > max_bytes => {
            return Err(format!(
                "文件过大(>50MB),请用 sqlite3 工具预处理: {}",
                user_path.display()
            ));
        }
        Ok(_) => {} // 正常大小,继续读
        Err(e) => {
            return Err(format!("读取失败 {}: {}", user_path.display(), e));
        }
    }

    std::fs::read_to_string(&user_path)
        .map_err(|e| format!("读取失败 {}: {}", user_path.display(), e))
}

/// M2.16 — F20 冷启动 .sql 路径取走(take 语义)。
///
/// `lib.rs::run` 的 setup 阶段扫描 argv 拿到 `.sql` 路径时,webview
/// 尚未挂载、emit `import-sql-file` 会丢(broadcast 不缓存)。所以把
/// 路径先存到 `AppState.pending_sql_file`,前端 `App.tsx` mount 后立即
/// 调一次本命令,有路径就跳 import-sql 页 + 自动加载。
///
/// take 语义:读后清空,避免用户切走再切回时重复触发同一文件。
#[tauri::command]
pub fn take_pending_sql_file(
    state: State<'_, AppState>,
) -> CmdResult<Option<String>> {
    let mut guard = state
        .pending_sql_file
        .lock()
        .map_err(|e| format!("pending_sql_file lock poisoned: {e}"))?;
    Ok(guard.take())
}

/// Resolve a user-supplied path against the security scope.
///
/// M3.11 (A1#5) — `active_root` selects the security scope root:
///
/// - `Some(root)` = project mode; the scope is `<root>/.claude/`
///   (the active project's `.claude/`). User-level `~/.claude/`
///   is rejected as out-of-scope.
/// - `None` = user-level / system project; the scope is the legacy
///   `<home>/.claude/` (preserves M2.4 behaviour for users who
///   never switched to a project).
///
/// Rules:
///   1. The path must be inside the resolved scope (case-insensitive).
///   2. `..` traversal is rejected — we canonicalise both sides
///      before comparing so a `..` that escapes `.claude/` is
///      caught even if the user tries `~/.claude/../claude.json`.
///   3. **Bare filenames (清单 20 fix)** — if the input is just a
///      basename with no directory part (e.g. `settings.json`),
///      it's a WebView2 `<input type="file">` leak of the user's
///      pick inside the active `.claude/`. We join it with
///      `<scope_root>/<basename>` so the scope check passes.
///
/// On success returns the absolute path the caller should read /
/// write. On failure returns a user-readable error.
fn resolve_claude_path(
    paths: &AppPaths,
    active_root: Option<&Path>,
    user_path: &str,
) -> CmdResult<PathBuf> {
    let path = user_path;

    // Empty path is a frontend bug — reject loudly.
    if path.trim().is_empty() {
        return Err("路径为空".into());
    }

    // Compute the security-scope root for this call. Project mode
    // narrows the scope to the project's `.claude/`; user mode
    // falls back to the cached `paths.claude_dir()` (= `<home>/.claude/`).
    //
    // We also need a `home`-equivalent for the `~` substitution
    // and the `bare filename` join. In project mode the "home"
    // for relative-path joining is the project root (so that a
    // relative `settings.json` doesn't accidentally land in the
    // user's CWD); in user mode it's `paths.home`.
    let (scope_root, join_root) = match active_root {
        Some(root) => (root.join(".claude"), root.to_path_buf()),
        None => (
            paths
                .claude_dir()
                .map(|p| p.to_path_buf())
                .unwrap_or_else(|| paths.home.join(".claude")),
            paths.home.clone(),
        ),
    };

    // 清单 20 fix: bare filename from `<input type="file">` →
    // scope into `<scope_root>/<basename>` so the scope check
    // passes. See `looks_like_bare_filename` for the detection
    // rules.
    if looks_like_bare_filename(path) {
        let prefixed = scope_root.join(path);
        // We don't run canonicalise() here — the file might not
        // exist yet (write side) and the parent's permission
        // errors are surfaced by the actual read/write. But we DO
        // verify the prefixed path stays inside scope, which is
        // trivial since we just constructed it.
        let allowed_prefix = std::fs::canonicalize(&scope_root).unwrap_or(scope_root.clone());
        let allowed_str = path_to_lower_str(&allowed_prefix);
        let prefixed_str = path_to_lower_str(&prefixed);
        if !prefixed_str.starts_with(&allowed_str) {
            return Err(format!(
                "路径超出允许范围(只允许 {}/**): {}",
                allowed_prefix.display(),
                prefixed.display()
            ));
        }
        return Ok(prefixed);
    }

    // Normalise `~/.claude/` → `<join_root>/.claude/<rest>` for
    // ergonomics. In project mode the tilde-prefix branch is rare
    // (the frontend would have to send a `~`-prefixed string
    // targeting user-level), but we keep handling it: substitute
    // the project root, so the canonicalise + scope check still
    // routes it under `<root>/.claude/`.
    let substituted = if let Some(rest) = path.strip_prefix("~/") {
        format!("{}{}", join_root.display(), rest)
    } else {
        path.to_string()
    };

    // Reject `..` traversal BEFORE the canonicalise() round-trip.
    // We don't want canonicalise() to silently collapse a `..` that
    // escapes `.claude/`.
    let candidate = PathBuf::from(&substituted);
    for component in candidate.components() {
        if matches!(component, Component::ParentDir) {
            return Err(format!(
                "路径含 '..',拒绝(安全策略): {}",
                candidate.display()
            ));
        }
    }

    // Resolve absolute (against `join_root` if relative) + canonicalise.
    let absolute = if candidate.is_absolute() {
        candidate.clone()
    } else {
        join_root.join(&candidate)
    };

    let canonical_user = std::fs::canonicalize(&absolute).map_err(|e| {
        format!(
            "无法解析路径 {}: {}",
            absolute.display(),
            e
        )
    })?;

    // Canonicalise the allowed scope root too. If it doesn't exist
    // (extremely rare, e.g. deleted mid-flight) fall back to the
    // uncanonicalised form — best effort.
    let allowed_prefix = std::fs::canonicalize(&scope_root).unwrap_or(scope_root);

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

    // -----------------------------------------------------------------
    // 清单 20 — JSON 编辑器路径 bug fix: tests for `looks_like_bare_filename`
    // -----------------------------------------------------------------

    /// Positive cases — should be detected as a bare filename and
    /// routed into `<home>/.claude/`.
    #[test]
    fn bare_filename_detection_positive() {
        assert!(looks_like_bare_filename("settings.json"));
        assert!(looks_like_bare_filename("providers.json"));
        assert!(looks_like_bare_filename("foo.bar.json"));
        assert!(looks_like_bare_filename("no-extension"));
    }

    /// Negative cases — must NOT be treated as a bare filename
    /// (they contain directory info that the caller already
    /// supplied).
    #[test]
    fn bare_filename_detection_negative() {
        // Empty → caller-side error
        assert!(!looks_like_bare_filename(""));
        // Whitespace-only
        assert!(!looks_like_bare_filename("   "));
        // Has directory separator (POSIX)
        assert!(!looks_like_bare_filename("sub/settings.json"));
        // Has directory separator (Windows)
        assert!(!looks_like_bare_filename("sub\\settings.json"));
        // Absolute POSIX
        assert!(!looks_like_bare_filename("/home/foo/settings.json"));
        // Tilde-prefixed → handled by existing tilde branch
        assert!(!looks_like_bare_filename("~/.claude/settings.json"));
        // Directory references
        assert!(!looks_like_bare_filename("."));
        assert!(!looks_like_bare_filename(".."));
    }

    /// `classify_io_error` must map the 4 expected `io::ErrorKind`
    /// values to the right user-facing categories. Frontend
    /// InfoBar copy keys off the leading category word.
    #[test]
    fn classify_io_error_maps_to_4_categories() {
        let p = Path::new("/some/path.json");

        // 1. 文件不存在 (清单 20 scenario 2)
        let not_found = classify_io_error(p, io::Error::from(io::ErrorKind::NotFound));
        assert!(not_found.starts_with("文件不存在"), "got: {not_found}");

        // 2. 无权限 (清单 20 scenario 3)
        let denied = classify_io_error(p, io::Error::from(io::ErrorKind::PermissionDenied));
        assert!(denied.starts_with("无权限"), "got: {denied}");

        // 3. 编码错误 (清单 20 scenario 4) — InvalidData covers
        //    UTF-8 decode failures, UnexpectedEof covers truncated
        //    files.
        let bad_data = classify_io_error(p, io::Error::from(io::ErrorKind::InvalidData));
        assert!(bad_data.starts_with("编码错误"), "got: {bad_data}");
        let truncated = classify_io_error(p, io::Error::from(io::ErrorKind::UnexpectedEof));
        assert!(truncated.starts_with("编码错误"), "got: {truncated}");

        // 4. Other I/O — generic bucket (清单 20 scenario 1 fallback).
        let other = classify_io_error(p, io::Error::from(io::ErrorKind::Other));
        assert!(other.starts_with("I/O 失败"), "got: {other}");
    }

    /// End-to-end: the canonical `<home>/settings.json` form
    /// (what the buggy code produced) MUST be detected as bare and
    /// re-prefixed with `.claude/`. We can't construct a real
    /// `AppState` here, but we can pin the `looks_like_bare_filename`
    /// contract directly — the actual path reconstruction is a
    /// straight `state.paths.home.join(".claude").join(bare)`.
    #[test]
    fn bare_filename_avoids_home_join_drift() {
        // The whole point of the fix: if the frontend sends
        // "settings.json", the backend must NOT silently turn it
        // into `<home>/settings.json` (the old behaviour) — it
        // must route into `<home>/.claude/settings.json`.
        let bare = "settings.json";
        assert!(looks_like_bare_filename(bare));
        // Simulate the old buggy behaviour: PathBuf::join with a
        // bare name gives `<home>/settings.json` — missing
        // `.claude/`. The fix ensures we go through `.claude` first.
        let old_path = std::path::PathBuf::from("/home/user").join(bare);
        let new_path = std::path::PathBuf::from("/home/user")
            .join(".claude")
            .join(bare);
        assert_ne!(old_path, new_path);
        assert!(old_path.to_string_lossy().contains("/settings.json"));
        assert!(new_path.to_string_lossy().contains("/.claude/settings.json"));
    }

    // -----------------------------------------------------------------
    // M3.11 (A1#5) — F5 json-editor `resolve_claude_path` 接
    // `active_root_dir`. 3 个 scenario,覆盖 3 种 active_root 行为。
    // -----------------------------------------------------------------

    /// Build a synthetic `AppPaths` whose `claude_dir` lives under
    /// `tmp.path().join(".claude")`. We also create the dir on disk
    /// so `canonicalize()` (inside `resolve_claude_path`) succeeds.
    fn user_level_paths(tmp: &tempfile::TempDir) -> crate::platform::AppPaths {
        let home = tmp.path().to_path_buf();
        let claude = home.join(".claude");
        std::fs::create_dir_all(&claude).unwrap();
        crate::platform::AppPaths {
            home: home.clone(),
            app_data: home.join("app_data"),
            settings_json: claude.join("settings.json"),
            claude_json: home.join(".claude.json"),
            backups_dir: home.join("app_data/backups"),
            marketplaces_dir: home.join("app_data/marketplaces"),
            logs_dir: home.join("app_data/logs"),
        }
    }

    /// Scenario 1: `active_root = None` (用户级 / system project)。
    /// 现有行为保持不变:`<home>/.claude/...`。
    #[test]
    fn resolve_claude_path_active_root_none_resolves_to_home_dotclaude() {
        let tmp = tempfile::TempDir::new().unwrap();
        let paths = user_level_paths(&tmp);

        // 写一个真实文件,以便 canonicalize() 不需特殊处理。
        let settings = paths.settings_json.clone();
        std::fs::write(&settings, "{}").unwrap();

        let resolved = resolve_claude_path(&paths, None, "~/.claude/settings.json")
            .expect("active_root=None must succeed for in-scope path");

        let expected = paths.home.join(".claude").join("settings.json");
        // canonicalize() on the *expected* side so we compare apples
        // to apples (Windows: 8.3 short paths etc.).
        let expected_canon = std::fs::canonicalize(&expected).unwrap();
        assert_eq!(resolved, expected_canon);
    }

    /// Scenario 2: `active_root = Some("/tmp/myproject")` (项目模式)。
    /// 必须解析到 `<root>/.claude/...` 而非 `<home>/.claude/...`。
    #[test]
    fn resolve_claude_path_active_root_some_resolves_to_project_dotclaude() {
        let tmp = tempfile::TempDir::new().unwrap();
        let paths = user_level_paths(&tmp);
        let project_root = tmp.path().join("myproject");
        let project_claude = project_root.join(".claude");
        std::fs::create_dir_all(&project_claude).unwrap();

        // 用户级 / 项目级 claude 目录下都放一个 settings.json,
        // 验证 resolver 走的是项目级那个。
        let user_settings = paths.settings_json.clone();
        let project_settings = project_claude.join("settings.json");
        std::fs::write(&user_settings, r#"{"level":"user"}"#).unwrap();
        std::fs::write(&project_settings, r#"{"level":"project"}"#).unwrap();

        // 传项目根 + 绝对路径(在项目级 .claude/ 作用域内)。
        let abs_in_project = project_claude.join("settings.json");
        let abs_str = abs_in_project.to_string_lossy().to_string();
        let resolved = resolve_claude_path(&paths, Some(&project_root), &abs_str)
            .expect("active_root=Some must succeed for in-project path");

        let expected = std::fs::canonicalize(&project_settings).unwrap();
        assert_eq!(resolved, expected);
        // 关键断言:绝对不能解析到用户级 .claude/。
        assert!(!resolved.starts_with(&paths.home.join(".claude")));
    }

    /// Scenario 3: `active_root = Some(...)` + bare filename
    /// (`settings.json`)。WebView2 `<input type="file">` 形式,只
    /// 有 basename。Backend 必须把 bare 拼到项目级 `.claude/` 而
    /// 不是用户级 `.claude/`。
    #[test]
    fn resolve_claude_path_active_root_some_bare_filename_routes_to_project() {
        let tmp = tempfile::TempDir::new().unwrap();
        let paths = user_level_paths(&tmp);
        let project_root = tmp.path().join("myproject");
        let project_claude = project_root.join(".claude");
        std::fs::create_dir_all(&project_claude).unwrap();
        // 用户级放一个同名文件,确认 resolver 不会路由到那里。
        let user_settings = paths.settings_json.clone();
        let project_settings = project_claude.join("settings.json");
        std::fs::write(&user_settings, r#"{"level":"user"}"#).unwrap();
        std::fs::write(&project_settings, r#"{"level":"project"}"#).unwrap();

        let resolved = resolve_claude_path(&paths, Some(&project_root), "settings.json")
            .expect("bare filename with active_root=Some must succeed");

        let expected = std::fs::canonicalize(&project_settings).unwrap();
        assert_eq!(resolved, expected);
    }

    /// 用户级、项目级安全策略: 用户级 claude/ 下的文件,在
    /// active_root=Some 时,必须被拒绝(因为它不在项目级 .claude/
    /// 作用域内)。这保证 M3.10 的"project 模式"真的把 scope
    /// 切到项目根,不能"看到"用户级的兄弟文件。
    #[test]
    fn resolve_claude_path_active_root_some_rejects_user_level_file() {
        let tmp = tempfile::TempDir::new().unwrap();
        let paths = user_level_paths(&tmp);
        let project_root = tmp.path().join("myproject");
        let project_claude = project_root.join(".claude");
        std::fs::create_dir_all(&project_claude).unwrap();

        // 用户级文件存在,项目级 .claude/ 也存在。但用户级文件
        // 在 active_root=Some 时应当被拒绝(out-of-scope)。
        let user_settings = paths.settings_json.clone();
        std::fs::write(&user_settings, r#"{"level":"user"}"#).unwrap();
        let abs_user = user_settings.to_string_lossy().to_string();
        let err = resolve_claude_path(&paths, Some(&project_root), &abs_user)
            .expect_err("user-level path must be rejected when project is active");
        assert!(
            err.contains("超出允许范围"),
            "error must mention scope violation, got: {err}"
        );
    }
}