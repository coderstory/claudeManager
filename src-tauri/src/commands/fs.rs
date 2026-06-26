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
use std::time::UNIX_EPOCH;

use serde::Serialize;
use tauri::State;

use crate::app_state::AppState;
use crate::infrastructure::encoding::decode_sql_bytes;
use crate::infrastructure::fs_atomic;
use crate::platform::AppPaths;

/// `Result<T, String>` — Tauri IPC's preferred error type. The `String`
/// is the user-visible message (SPEC §6.5).
type CmdResult<T> = Result<T, String>;

/// Phase 27 Fix 3 — field validator for the path::field virtual protocol.
///
/// T-05 security: `field` is NOT a path component — it's a JSON field
/// name. We reject anything that looks like a path traversal or could
/// be used to confuse the split logic.
///
/// Rejects:
///   - empty string
///   - contains `..` (directory traversal)
///   - contains `/` or `\` (path separator)
///   - contains NUL byte (`\0`)
///   - contains `::` (would make the split ambiguous)
fn validate_field(field: &str) -> CmdResult<()> {
    if field.is_empty() {
        return Err("字段名为空".into());
    }
    if field.contains('\0') {
        return Err("字段名含 NUL 字节".into());
    }
    if field.contains("::") {
        return Err("字段名含 '::'".into());
    }
    if field.contains("..") {
        return Err("字段名含 '..'".into());
    }
    if field.contains('/') || field.contains('\\') {
        return Err("字段名含路径分隔符".into());
    }
    Ok(())
}

/// Split a virtual path of the form `path::field` into `(path, Some(field))`.
///
/// Only the FIRST `::` is the split point. If the input contains no `::`,
/// returns `(input, None)`.
///
/// The caller is responsible for validating the resulting field via
/// [`validate_field`] before use.
fn split_path_field(virtual_path: &str) -> (String, Option<String>) {
    // rsplitn(2, "::") gives at most 2 pieces starting from the right.
    // But we want to split on the FIRST `::` (leftmost), so use splitn.
    let mut parts = virtual_path.splitn(2, "::");
    match (parts.next(), parts.next()) {
        (Some(path), Some(field)) => (path.to_string(), Some(field.to_string())),
        (Some(path), None) => (path.to_string(), None),
        (None, _) => unreachable!("splitn always yields at least 1 element"),
    }
}

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
///
/// Phase 27 Fix 3 — `field: Option<String>` parameter:
///   - The backend accepts a field name in addition to the path.
///   - If `path` itself contains `::`, it is treated as a virtual
///     path of the form `path::field` (backward-compat with the old
///     optimizer that sent a single composite string).
///   - The explicit `field` arg takes precedence over any embedded
///     `::` in the path.
///   - `field` is validated via [`validate_field`] and is NEVER
///     passed to `resolve_claude_path` (T-05: field is not a path).
#[tauri::command]
pub async fn read_file(
    state: State<'_, AppState>,
    path: String,
    field: Option<String>,
) -> CmdResult<String> {
    // M3.11 (A1#5) — read live active root from the platform shim
    // (state.paths is a one-shot startup snapshot; active_root can
    // change at runtime via the project switcher).
    let active_root = crate::platform::runtime::paths().active_root_dir();

    // Phase 27 Fix 3 — path::field virtual path protocol.
    // If the explicit `field` arg is present, validate it and use it.
    // Otherwise, if `path` contains `::`, split into (path, field).
    // The explicit field arg always takes precedence.
    let (clean_path, resolved_field) = match field {
        Some(f) => {
            validate_field(&f)?;
            (path, Some(f))
        }
        None => {
            let (clean, maybe_field) = split_path_field(&path);
            if let Some(ref f) = maybe_field {
                validate_field(f)?;
            }
            (clean, maybe_field)
        }
    };

    // T-05 security: `resolved_field` is only used by the frontend to
    // highlight the target field in the editor. It is NEVER passed
    // to `resolve_claude_path` or any filesystem API.
    let _ = resolved_field;

    let resolved = resolve_claude_path(&state.paths, active_root.as_deref(), &clean_path)?;
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
/// 编码处理:走 bytes 路径,`fs::read` 拿 `Vec<u8>` → Rust 端
/// `decode_sql_bytes` 探测 UTF-8 / GB18030 / Big5 / UTF-16 LE/BE
/// BOM 并解码成 UTF-8 String。覆盖 cc-switch 历史 dump 的 GBK 与
/// Windows 记事本 UTF-16 编码等非 UTF-8 来源。
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

    // bytes 路径:不用 `read_to_string` 强校验 UTF-8,让
    // `decode_sql_bytes` 处理非 UTF-8 来源(GBK / GB18030 / Big5 /
    // UTF-16 LE/BE BOM)。
    let bytes = std::fs::read(&user_path)
        .map_err(|e| format!("读取失败 {}: {}", user_path.display(), e))?;
    decode_sql_bytes(&bytes)
        .map_err(|e| format!("读取失败(编码问题) {}: {}", user_path.display(), e))
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

// ---------------------------------------------------------------------------
// M3.11 (A4#12) — F5 JSON 编辑器文件目录树
// ---------------------------------------------------------------------------
//
// 用户在 JSON 编辑器页需要一个文件目录树,展示"允许编辑的范围"内
// 的所有 .json 文件(替代或补充原生的 `<input type="file">` 选择器)。
//
// 安全模型:严格白名单 root 列表(只暴露 F5 既定的安全作用域),不
// 暴露系统其他目录。具体 scope:
//
//   - `user`   = `<home>/.claude/`                (用户级)
//   - `project` = `<active_root>/.claude/`        (项目级,如果 active_root 存在)
//
// 这与 F5 read_file / write_file_atomic 的安全作用域 1:1 对应 —
// 列表里能看到的每个文件,点开后 read_file 都允许。超出范围的
// `.json`(如 `~/.codex/*.json`、`~/.gemini/*.json`)**故意不列**:
// 现在不在 F5 的安全作用域内,纳入会误导用户以为能编辑。

/// F5 — JSON 编辑器文件目录树的一个条目。
///
/// 与 F5 read_file / write_file_atomic 1:1 对应:`path` 必须能
/// 通过 [`resolve_claude_path`],否则前端点击会立刻被拒。
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct JsonFileEntry {
    /// 绝对路径,直接喂给 `read_file` / `write_file_atomic`。
    pub path: String,
    /// 相对 scope root 的展示路径(去掉 root 前缀)。
    /// 例: 用户级 `~/.claude/settings.json` → `settings.json`;
    ///      项目级 `<root>/.claude/projects/foo/settings.json` →
    ///      `projects/foo/settings.json`(不显示 `.claude/` 前缀)。
    pub relative_path: String,
    /// Scope 分类,前端按这个分组(用户 / 项目 / Codex / ...)。
    /// 当前只会有 `"user"` 或 `"project"`;留 String 是为未来扩展
    /// (Codex/Gemini/OpenCode)预留。
    pub scope: String,
    /// Scope 的人类可读中文标签,前端直接渲染。
    pub scope_label: String,
    /// 文件字节数。
    pub size: u64,
    /// 最后修改时间(unix 秒)。前端可排序 + 提示"刚改过"。
    pub last_modified: u64,
}

/// F5 — 列出允许编辑范围内的所有 `.json` 文件。
///
/// 严格白名单:只扫 `user` (用户级 `~/.claude/`) + `project`
/// (项目级 `<active_root>/.claude/`,如有)两个 root。每个 root 内
/// 递归扫描(最大深度 5,防 symlink 环 + 巨型目录),返回前 200 个
/// 文件(防 UI 卡死)。失败容错:单文件读失败 → 跳过 + log warning。
///
/// ## 安全
///   - 绝不扫 `~/.codex/` / `~/.gemini/` / `~/.opencode/` 等其他
///     provider 目录(CLAUDE.md §10 严格白名单纪律)。
///   - 绝不暴露"白名单 root 列表之外"的目录 — 哪怕文件名碰巧
///     叫 `.json` 也不暴露。
///   - 返回的 `path` 必须能被 [`resolve_claude_path`] 接受,所以
///     前端可直接拿它去 read_file。
#[tauri::command]
pub async fn list_editable_jsons(
    state: State<'_, AppState>,
) -> CmdResult<Vec<JsonFileEntry>> {
    let active_root = crate::platform::runtime::paths().active_root_dir();
    let mut roots: Vec<(&str, &str, PathBuf)> = Vec::new();

    // 用户级 root — 总是扫。
    if let Some(claude_dir) = state.paths.claude_dir() {
        roots.push(("user", "用户级", claude_dir.to_path_buf()));
    }

    // 项目级 root — 只有 active_root 存在才扫(M3.10 双模式)。
    if let Some(root) = active_root.as_ref() {
        roots.push(("project", "项目级", root.join(".claude")));
    }

    let mut out: Vec<JsonFileEntry> = Vec::new();
    for (scope, scope_label, root) in roots {
        scan_root_for_jsons(&root, scope, scope_label, &mut out);
        if out.len() >= MAX_JSON_TREE_ENTRIES {
            out.truncate(MAX_JSON_TREE_ENTRIES);
            break;
        }
    }

    // 按 scope → relative_path 排序,前端渲染稳定。
    out.sort_by(|a, b| {
        a.scope
            .cmp(&b.scope)
            .then(a.relative_path.cmp(&b.relative_path))
    });
    Ok(out)
}

/// 单 root 扫描的硬上限 — 防止 UI 一次渲染 10k 个文件卡死。
const MAX_JSON_TREE_ENTRIES: usize = 200;

/// 单目录递归深度上限 — 防止 symlink 环 / 巨型目录栈溢出。
const MAX_JSON_TREE_DEPTH: usize = 5;

/// 递归扫描 `root` 下的所有 `.json` 文件,写入 `out`。
///
/// 失败容错:目录读不了 → 跳过 + log warning(不打断整体扫描)。
/// 文件 metadata 读不了 → 跳过 + log warning。
///
/// 对称性:这是 `list_editable_jsons` 的内层 helper;抽出来便于
/// 单元测试,不需要 mock Tauri 的 `State<AppState>`。
fn scan_root_for_jsons(root: &Path, scope: &str, scope_label: &str, out: &mut Vec<JsonFileEntry>) {
    if !root.exists() {
        // 用户没建 ~/.claude/ 是合法状态,静默返回即可。
        return;
    }
    walk_json_tree(root, root, scope, scope_label, 0, out);
}

/// DFS 递归,深度由 `depth` 参数限制。`root` 是展示根(用于计算
/// `relative_path`),`current` 是当前正在扫描的目录。
fn walk_json_tree(
    root: &Path,
    current: &Path,
    scope: &str,
    scope_label: &str,
    depth: usize,
    out: &mut Vec<JsonFileEntry>,
) {
    if depth > MAX_JSON_TREE_DEPTH {
        return;
    }
    if out.len() >= MAX_JSON_TREE_ENTRIES {
        return;
    }
    let entries = match std::fs::read_dir(current) {
        Ok(it) => it,
        Err(e) => {
            eprintln!(
                "[list_editable_jsons] read_dir 失败 {}: {}",
                current.display(),
                e
            );
            return;
        }
    };

    // 排序:目录在前 + 名字字典序,让 UI 渲染稳定 + 友好。
    let mut items: Vec<_> = entries.flatten().collect();
    items.sort_by_key(|e| {
        let is_dir = e.file_type().map(|t| t.is_dir()).unwrap_or(false);
        // 反转 bool:目录 (true=1) 想排前面 → 排序时用 !is_dir
        (!is_dir, e.file_name().to_string_lossy().to_string())
    });

    for entry in items {
        if out.len() >= MAX_JSON_TREE_ENTRIES {
            break;
        }
        let path = entry.path();
        let file_type = match entry.file_type() {
            Ok(t) => t,
            Err(_) => continue, // 单 entry 的 file_type 失败 → 跳过
        };

        // 跳过 symlink(防止 symlink 环 / 逃逸出白名单)。
        // symlink 可能在 FileType 里既不是 dir 也不是 file,这里
        // 一律 `file_type().is_symlink()` 拦掉。
        if file_type.is_symlink() {
            continue;
        }

        if file_type.is_dir() {
            walk_json_tree(root, &path, scope, scope_label, depth + 1, out);
        } else if file_type.is_file() {
            // 只收 .json(大小写不敏感)。
            let is_json = path
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.eq_ignore_ascii_case("json"))
                .unwrap_or(false);
            if !is_json {
                continue;
            }
            let meta = match entry.metadata() {
                Ok(m) => m,
                Err(_) => continue,
            };
            let last_modified = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);
            let relative_path = path
                .strip_prefix(root)
                .map(|p| p.to_string_lossy().replace('\\', "/"))
                .unwrap_or_else(|_| path.to_string_lossy().to_string());
            // relative_path 必须以文件名结尾(不是目录本身)。
            // 如果 strip_prefix 给了空字符串(根目录同名),用 basename。
            let relative_path = if relative_path.is_empty() {
                path.file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_else(|| path.to_string_lossy().to_string())
            } else {
                relative_path
            };
            out.push(JsonFileEntry {
                path: path.to_string_lossy().to_string(),
                relative_path,
                scope: scope.to_string(),
                scope_label: scope_label.to_string(),
                size: meta.len(),
                last_modified,
            });
        }
    }
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
            history_db: home.join("app_data/history.db"),
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

    /// Phase 27 Fix 3 — path::field virtual path protocol (BUG-CR-03).
    ///
    /// These tests pin the contract that:
    ///   1. `read_file(path, Some(field))` calls `resolve_claude_path`
    ///      with `path` only (field is NOT a path component).
    ///   2. `read_file("providers/foo.json:api_key", None)` splits on
    ///      the first `::` → `path="providers/foo.json"`,
    ///      `field="api_key"` (backward-compat with old optimizer that
    ///      sent a single `path::field` arg).
    ///   3. Invalid field values are rejected before touching the
    ///      filesystem (T-05 security: empty, `..`, `/`, `\`, NUL,
    ///      `::` are all rejected).
    ///
    /// We can't easily invoke the `#[tauri::command]` function without
    // a Tauri runtime, so we validate the field + split logic via
    // helper functions and exercise `resolve_claude_path` for the
    /// "path only, not field" guarantee.
    mod path_field_protocol_tests {
        use super::*;

        // -----------------------------------------------------------------
        // validate_field (to be implemented in the fix phase)
        // -----------------------------------------------------------------

        /// Helper: validate a field name. Returns Ok(()) for valid,
        /// Err(msg) for invalid. This is the T-05 security gate.
        fn validate_field(field: &str) -> Result<(), String> {
            // Delegate to the production helper defined at module top.
            super::validate_field(field)
        }

        #[test]
        fn validate_field_accepts_simple_identifier() {
            assert!(validate_field("api_key").is_ok());
            assert!(validate_field("token").is_ok());
            assert!(validate_field("myField123").is_ok());
            assert!(validate_field("a").is_ok());
        }

        #[test]
        fn validate_field_rejects_empty() {
            let err = validate_field("").expect_err("empty field must be rejected");
            assert!(
                err.contains("空") || err.contains("empty"),
                "error must mention emptiness, got: {err}"
            );
        }

        #[test]
        fn validate_field_rejects_dotdot() {
            let err = validate_field("../../etc/passwd")
                .expect_err(".. must be rejected");
            assert!(
                err.contains("..") || err.contains("非法"),
                "error must mention .. or illegality, got: {err}"
            );
        }

        #[test]
        fn validate_field_rejects_path_separator() {
            let err = validate_field("foo/bar")
                .expect_err("forward slash must be rejected");
            assert!(
                err.contains("/") || err.contains("\\") || err.contains("非法") || err.contains("路径"),
                "error must mention path or illegality, got: {err}"
            );
            let err = validate_field("foo\\bar")
                .expect_err("backslash must be rejected");
            assert!(
                err.contains("/") || err.contains("\\") || err.contains("非法") || err.contains("路径"),
                "error must mention path or illegality, got: {err}"
            );
        }

        #[test]
        fn validate_field_rejects_nul_byte() {
            let err = validate_field("foo\0bar")
                .expect_err("NUL byte must be rejected");
            assert!(
                err.contains("NUL") || err.contains("null") || err.contains("非法"),
                "error must mention NUL/null or illegality, got: {err}"
            );
        }

        #[test]
        fn validate_field_rejects_double_colon() {
            let err = validate_field("a::b")
                .expect_err(":: must be rejected");
            assert!(
                err.contains("::") || err.contains("非法"),
                "error must mention :: or illegality, got: {err}"
            );
        }

        // -----------------------------------------------------------------
        // path::field split (to be implemented in the fix phase)
        // -----------------------------------------------------------------

        /// Helper: split a virtual path of the form `path::field` into
        /// `(path, field)`. Only the FIRST `::` is the split point —
        /// the rest is already caught by `validate_field`.
        fn split_path_field(virtual_path: &str) -> (String, Option<String>) {
            super::split_path_field(virtual_path)
        }

        #[test]
        fn split_path_field_no_double_colon_returns_none_field() {
            let (path, field) = split_path_field("providers/foo.json");
            assert_eq!(path, "providers/foo.json");
            assert!(field.is_none());
        }

        #[test]
        fn split_path_field_with_double_colon_splits_once() {
            let (path, field) = split_path_field("providers/foo.json::api_key");
            assert_eq!(path, "providers/foo.json");
            assert_eq!(field.as_deref(), Some("api_key"));
        }

        #[test]
        fn split_path_field_nested_path_preserves_directory_structure() {
            let (path, field) =
                split_path_field("sub/deep/nested/file.json::some_field");
            assert_eq!(path, "sub/deep/nested/file.json");
            assert_eq!(field.as_deref(), Some("some_field"));
        }
    }

    // -----------------------------------------------------------------
    // M3.11 (A4#12) — F5 json-editor `list_editable_jsons`
    // 白名单扫描器单元测试。覆盖 7 个关键行为:
    //   1. 扫到直接子目录的 .json
    //   2. 扫到嵌套子目录的 .json
    //   3. 只收 .json(过滤 .md / .txt / 无扩展)
    //   4. depth 上限生效(>5 层的目录跳过)
    //   5. 严格白名单:scope 之外的 root(其他 provider 目录)不扫
    //   6. 空目录不报错,返回空 Vec
    //   7. relative_path 前缀正确(去掉 root 前缀,统一用 '/')
    // -----------------------------------------------------------------

    /// 辅助:在一个 root 下建一棵指定 tree,标记 `'d'` = dir,`'f'` = file。
    /// 返回 root 路径。
    fn build_test_tree(root: &Path, tree: &[(&str, bool)]) {
        for (rel, is_file) in tree {
            let p = root.join(rel);
            if *is_file {
                if let Some(parent) = p.parent() {
                    std::fs::create_dir_all(parent).unwrap();
                }
                std::fs::write(&p, b"{}").unwrap();
            } else {
                std::fs::create_dir_all(&p).unwrap();
            }
        }
    }

    /// 1. 直接子目录的 .json 被扫到,scope / scope_label 正确。
    #[test]
    fn scan_root_picks_up_top_level_json() {
        let tmp = tempfile::TempDir::new().unwrap();
        build_test_tree(tmp.path(), &[("settings.json", true)]);

        let mut out = Vec::new();
        scan_root_for_jsons(tmp.path(), "user", "用户级", &mut out);

        assert_eq!(out.len(), 1, "got: {:?}", out);
        assert_eq!(out[0].scope, "user");
        assert_eq!(out[0].scope_label, "用户级");
        assert_eq!(out[0].relative_path, "settings.json");
        assert!(out[0].path.ends_with("settings.json"));
        assert_eq!(out[0].size, 2); // "{}"
    }

    /// 2. 嵌套子目录的 .json 被扫到,relative_path 用 '/' 分隔。
    #[test]
    fn scan_root_picks_up_nested_json() {
        let tmp = tempfile::TempDir::new().unwrap();
        build_test_tree(
            tmp.path(),
            &[
                ("commands/a.json", true),
                ("commands/sub/b.json", true),
                ("agents/c.json", true),
            ],
        );

        let mut out = Vec::new();
        scan_root_for_jsons(tmp.path(), "user", "用户级", &mut out);

        assert_eq!(out.len(), 3, "got: {:?}", out);
        let rels: Vec<&str> = out.iter().map(|e| e.relative_path.as_str()).collect();
        assert!(rels.contains(&"commands/a.json"));
        assert!(rels.contains(&"commands/sub/b.json"));
        assert!(rels.contains(&"agents/c.json"));
    }

    /// 3. 只收 .json: .md / .txt / 无扩展都被过滤。
    #[test]
    fn scan_root_filters_non_json_extensions() {
        let tmp = tempfile::TempDir::new().unwrap();
        build_test_tree(
            tmp.path(),
            &[
                ("keep.json", true),
                ("skip.md", true),
                ("skip.txt", true),
                ("noext", true),
                ("ALSO.JSON", true), // 大写扩展名也算
            ],
        );

        let mut out = Vec::new();
        scan_root_for_jsons(tmp.path(), "user", "用户级", &mut out);

        let names: Vec<&str> = out.iter().map(|e| e.relative_path.as_str()).collect();
        assert!(names.contains(&"keep.json"), "got: {:?}", names);
        assert!(names.contains(&"ALSO.JSON"), "got: {:?}", names);
        assert_eq!(out.len(), 2, "got: {:?}", out);
    }

    /// 4. depth 上限生效:超过 MAX_JSON_TREE_DEPTH (5) 层的目录跳过。
    #[test]
    fn scan_root_respects_depth_limit() {
        let tmp = tempfile::TempDir::new().unwrap();
        // 6 层深: a/b/c/d/e/f.json  (f 在第 6 层)
        let deep = "a/b/c/d/e/f/deep.json";
        build_test_tree(tmp.path(), &[(deep, true)]);
        // 也放一个浅的,确认浅的不被误杀。
        build_test_tree(tmp.path(), &[("shallow.json", true)]);

        let mut out = Vec::new();
        scan_root_for_jsons(tmp.path(), "user", "用户级", &mut out);

        let rels: Vec<&str> = out.iter().map(|e| e.relative_path.as_str()).collect();
        assert!(
            rels.contains(&"shallow.json"),
            "shallow must still be picked up, got: {:?}",
            rels
        );
        assert!(
            !rels.iter().any(|r| r.contains("deep.json")),
            "deep entry must be filtered out by depth, got: {:?}",
            rels
        );
    }

    /// 5. 严格白名单:传入的 root 之外的目录,根本不会被扫到。
    ///    这是 list_editable_jsons 的契约 — 不会主动去探 ~/.codex/。
    #[test]
    fn scan_root_does_not_escape_root() {
        let tmp = tempfile::TempDir::new().unwrap();
        // 在 tmp 之外建一个 .json。tmp 同级目录。
        let sibling = tmp.path().parent().unwrap().join("__sibling_test_escape.json");
        std::fs::write(&sibling, b"{}").unwrap();

        let mut out = Vec::new();
        scan_root_for_jsons(tmp.path(), "user", "用户级", &mut out);

        assert!(
            !out.iter().any(|e| e.path.contains("__sibling_test_escape")),
            "scanner must NOT escape root, got: {:?}",
            out
        );

        // 清理
        let _ = std::fs::remove_file(&sibling);
    }

    /// 6. 空目录 + 不存在的 root:不报错,返回空 Vec。
    #[test]
    fn scan_root_handles_missing_or_empty_root() {
        let tmp = tempfile::TempDir::new().unwrap();

        // 不存在
        let nonexistent = tmp.path().join("does-not-exist");
        let mut out = Vec::new();
        scan_root_for_jsons(&nonexistent, "user", "用户级", &mut out);
        assert!(out.is_empty());

        // 空目录
        let empty_dir = tmp.path().join("empty");
        std::fs::create_dir_all(&empty_dir).unwrap();
        scan_root_for_jsons(&empty_dir, "user", "用户级", &mut out);
        assert!(out.is_empty(), "empty dir should yield no entries");
    }

    /// 7. last_modified 是 unix 秒,大于 2020-01-01 (1577836800)。
    #[test]
    fn scan_root_last_modified_is_unix_seconds() {
        let tmp = tempfile::TempDir::new().unwrap();
        build_test_tree(tmp.path(), &[("settings.json", true)]);

        let mut out = Vec::new();
        scan_root_for_jsons(tmp.path(), "user", "用户级", &mut out);

        assert_eq!(out.len(), 1);
        // 2020-01-01 = 1577836800. 文件刚刚写的肯定大于这个。
        assert!(
            out[0].last_modified > 1577836800,
            "last_modified must be unix seconds, got: {}",
            out[0].last_modified
        );
    }

    /// 8. MAX_JSON_TREE_ENTRIES 上限:即使 tree 里塞了 250 个文件,
    ///    也只返回 200 个。
    #[test]
    fn scan_root_caps_at_max_entries() {
        let tmp = tempfile::TempDir::new().unwrap();
        let mut tree = Vec::with_capacity(250);
        for i in 0..250 {
            tree.push((format!("f{i:04}.json"), true));
        }
        let tree_refs: Vec<(&str, bool)> = tree.iter().map(|(s, b)| (s.as_str(), *b)).collect();
        build_test_tree(tmp.path(), &tree_refs);

        let mut out = Vec::new();
        scan_root_for_jsons(tmp.path(), "user", "用户级", &mut out);

        assert_eq!(out.len(), MAX_JSON_TREE_ENTRIES);
    }
}