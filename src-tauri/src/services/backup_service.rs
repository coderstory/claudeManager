//! BackupService — F13 (M2.6) business logic for the backup &
//! restore page (SPEC §5.12).
//!
//! Wraps the lower-level `infrastructure::backup_scanner` (read side)
//! and `infrastructure::fs_atomic::write_with_backup` (write side)
//! behind a service-level surface that:
//!
//! - scans BOTH the live `~/.claude/` directory AND the
//!   `<app_data>/backups/` directory (so the user sees backups from
//!   every source the app has ever taken)
//! - reads the content of a single backup
//! - computes a field-level diff between any two backups
//! - restores a backup to its original location, taking a
//!   double-backup of the current file FIRST (CLAUDE.md §7: any
//!   destructive write must be reversible)
//! - manually creates a new backup from the current live file
//!
//! ## Path-safety
//!
//! All "the user clicked restore" / "the user wants to read" calls
//! pass through [`resolve_safe_path`], which rejects any path that
//! isn't a child of an allowed directory (`<app_data>/backups/`
//! or `<claude_dir>/`). The frontend cannot ask the backend to
//! read or overwrite arbitrary filesystem locations.

use std::path::{Path, PathBuf};

use serde::Serialize;
use thiserror::Error;

use crate::infrastructure::backup_scanner::{self, BackupEntry, BackupSource};
use crate::infrastructure::fs_atomic;
use crate::infrastructure::json_diff::{self, DiffEntry};
use crate::platform::AppPaths;

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

#[derive(Debug, Error)]
pub enum BackupError {
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("invalid JSON: {0}")]
    Json(#[from] serde_json::Error),

    #[error("path {0} is outside any allowed backup directory")]
    PathNotAllowed(PathBuf),

    #[error("backup file not found: {0}")]
    NotFound(PathBuf),

    #[error("original file path could not be reconstructed from {0}")]
    CannotReconstruct(PathBuf),

    #[error("atomic write failed: {0}")]
    AtomicWrite(String),

    /// M3.12 — `active_root_dir` 接入。`restore_backup` 在
    /// `Some(root)` + root 不存在时拒绝还原(避免 mkdir 未知路径,
    /// 与 F18 apply_optimizations 安全边界对齐)。
    #[error("active root 目录不存在: {0} (拒绝还原,避免写入未知路径)")]
    ActiveRootMissing(PathBuf),

    /// M4.6 — 增量备份发现无变更时返回此错误,表示跳过创建新备份。
    /// 这不是硬失败;调用方(commands/backup)应映射为特定响应。
    #[error("no changes since previous backup at {0}")]
    NoChange(PathBuf),
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

pub struct BackupService {
    paths: AppPaths,
    /// M4.6 (Phase 21) — optional SQLite history sink. When set,
    /// every successful `backup_now` / `backup_incremental` /
    /// `restore_backup`-induced re-snapshot appends a row to
    /// `backup_history` (idempotent via UNIQUE backup_id).
    history: Option<std::sync::Arc<crate::services::history_service::HistoryService>>,
}

impl BackupService {
    pub fn new(paths: AppPaths) -> Self {
        Self {
            paths,
            history: None,
        }
    }

    /// M4.6 (Phase 21) — attach the SQLite history sink. Called
    /// from `AppState::build` after the history db is opened. Once
    /// attached, every successful backup writes a row to
    /// `backup_history` (idempotent).
    pub fn with_history(
        mut self,
        history: std::sync::Arc<crate::services::history_service::HistoryService>,
    ) -> Self {
        self.history = Some(history);
        self
    }

    /// Borrow resolved paths (read-only).
    #[allow(dead_code)]
    pub fn paths(&self) -> &AppPaths {
        &self.paths
    }

    // -----------------------------------------------------------------------
    // list
    // -----------------------------------------------------------------------

    /// Scan all known backup directories and return a merged,
    /// newest-first list of [`BackupEntry`].
    ///
    /// Sources merged:
    /// 1. `<app_data>/backups/` — explicitly-archived snapshots.
    /// 2. `<claude_dir>/` — same-directory `.bak.<ts>` files left
    ///    by `infrastructure::fs_atomic::write_with_backup` (the
    ///    typical location for settings.json backups).
    ///
    /// Each directory is scanned independently. A missing directory
    /// is not an error — we just skip it.
    ///
    /// ## M3.12 (A1#6) — `active_root_dir` 接入
    ///
    /// - `None` = user-level / system project; scans the same set
    ///   as M2.6 (backups + `~/.claude/`).
    /// - `Some(root)` = project mode; also scans `<root>/.claude/`
    ///   (the active project's `.claude/` directory). The project's
    ///   `.bak.<ts>` snapshots — taken by F18 apply_optimizations
    ///   when in project mode — surface in the F13 timeline.
    ///
    /// The user's intent is "show me every backup that could belong
    /// to this scope" — so the project dir is ADDED to the scan list
    /// rather than REPLACING the user-level scan (the user may have
    /// both project and user-level backups; both belong to the
    /// timeline of the active scope).
    pub fn list_backups(
        &self,
        active_root_dir: Option<&Path>,
    ) -> Vec<BackupEntry> {
        let mut all: Vec<BackupEntry> = Vec::new();
        for dir in self.allowed_directories_for_active_root(active_root_dir) {
            match backup_scanner::scan_backups_in(&dir) {
                Ok(entries) => all.extend(entries),
                Err(e) => {
                    // log but don't fail the whole list. eprintln is
                    // good enough for M2.6; M2.7+ may switch to the
                    // tauri-plugin-log pipe.
                    eprintln!("[backup] scan failed for {dir:?}: {e}");
                }
            }
        }
        // Re-sort the merged list (each scan returns sorted, but the
        // merge may have shuffled).
        all.sort_by(|a, b| match (a.timestamp_unix, b.timestamp_unix) {
            (Some(x), Some(y)) => y.cmp(&x),
            (Some(_), None) => std::cmp::Ordering::Less,
            (None, Some(_)) => std::cmp::Ordering::Greater,
            (None, None) => std::cmp::Ordering::Equal,
        });
        all
    }

    // -----------------------------------------------------------------------
    // read
    // -----------------------------------------------------------------------

    /// Read a single backup file's content. The path is validated
    /// against the allow-list first.
    ///
    /// ## M3.12 (A1#6) — `active_root_dir` 接入
    /// `active_root_dir = Some(root)` 扩展 allow-list 到
    /// `<root>/.claude/`,允许读项目级 `.bak.<ts>` 文件。
    /// `None` 保持 M2.6 行为。
    pub fn read_backup_content(
        &self,
        path: &Path,
        active_root_dir: Option<&Path>,
    ) -> Result<String, BackupError> {
        let safe = self.resolve_safe_path_for_active_root(path, active_root_dir)?;
        let content = std::fs::read_to_string(&safe)?;
        Ok(content)
    }

    // -----------------------------------------------------------------------
    // diff
    // -----------------------------------------------------------------------

    /// Field-level diff between two backup files. Either order is
    /// valid — `diff_backups(a, b)` is the same entries as
    /// `diff_backups(b, a)` with `Add` ↔ `Remove` and `Change`
    /// preserved (we don't swap — caller decides which is "old").
    ///
    /// ## M3.12 (A1#6) — `active_root_dir` 接入
    /// `active_root_dir = Some(root)` 扩展 allow-list 到
    /// `<root>/.claude/`,允许 diff 项目级 `.bak.<ts>`。
    pub fn diff_backups(
        &self,
        path1: &Path,
        path2: &Path,
        active_root_dir: Option<&Path>,
    ) -> Result<Vec<DiffEntry>, BackupError> {
        let p1 = self.resolve_safe_path_for_active_root(path1, active_root_dir)?;
        let p2 = self.resolve_safe_path_for_active_root(path2, active_root_dir)?;
        let a = std::fs::read_to_string(&p1)?;
        let b = std::fs::read_to_string(&p2)?;
        // If either file is not valid JSON, return an empty diff
        // (the UI will show "files contain non-JSON content").
        let (va, vb) = match (serde_json::from_str(&a), serde_json::from_str(&b)) {
            (Ok(va), Ok(vb)) => (va, vb),
            _ => return Ok(Vec::new()),
        };
        Ok(json_diff::diff_json(&va, &vb))
    }

    // -----------------------------------------------------------------------
    // restore
    // -----------------------------------------------------------------------

    /// Restore a backup to its original location.
    ///
    /// # Algorithm (CLAUDE.md §7 "回滚操作也要先备份当前文件")
    ///
    /// 1. Validate the backup path is inside an allowed dir
    ///    (with active_root expansion, see M3.12 notes).
    /// 2. Reconstruct the original file path (strip `.bak.<ts>`).
    /// 3. Read the backup content.
    /// 4. If the original file exists, copy it to
    ///    `<original>.bak.pre-restore.<ts>` (double-backup so the
    ///    user can reverse the restore too).
    /// 5. Atomic write the backup content to the original location
    ///    via `fs_atomic::write_with_backup` (which itself takes a
    ///    `.bak.<ts>` first — so we end up with two safety nets).
    ///
    /// ## M3.12 (A1#8) — `active_root_dir` 接入
    ///
    /// The active project mode may route the restored file to
    /// `<active_root>/.claude/settings.json` instead of
    /// `<home>/.claude/settings.json`:
    ///
    /// - `None` = user-level; restore to M2.6 location (cached
    ///   `paths.settings_json` parent).
    /// - `Some(root)` = project mode; restore target lives under
    ///   `<root>/.claude/`. The `<root>/.claude/` dir is added to
    ///   the allow-list so the `.bak.<ts>` file there is readable.
    ///
    /// **Safety boundary** (CLAUDE.md §7, mirrors F18
    /// apply_optimizations): when `active_root_dir = Some(root)`
    /// and `root` does not exist on disk, the restore is REJECTED
    /// with `BackupError::ActiveRootMissing`. We do NOT auto-mkdir
    /// the unknown root — that would let a stale UI state silently
    /// materialize an unwanted directory tree.
    pub fn restore_backup(
        &self,
        backup_path: &Path,
        active_root_dir: Option<&Path>,
    ) -> Result<(), BackupError> {
        // Safety boundary: refuse to write into a root that
        // doesn't exist (拒绝 mkdir). Mirrors F18
        // apply_optimizations:165-191 safety block.
        if let Some(root) = active_root_dir {
            if !root.exists() {
                return Err(BackupError::ActiveRootMissing(root.to_path_buf()));
            }
        }
        let safe = self.resolve_safe_path_for_active_root(backup_path, active_root_dir)?;
        let original = reconstruct_original(&safe).ok_or_else(|| {
            BackupError::CannotReconstruct(safe.clone())
        })?;

        // Read backup content first — fail fast if the file vanished.
        let content = std::fs::read_to_string(&safe).map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                BackupError::NotFound(safe.clone())
            } else {
                BackupError::Io(e)
            }
        })?;

        // Pre-restore double-backup of the current original.
        if original.exists() {
            let stamp = pre_restore_stamp();
            let mut safety = original.as_os_str().to_owned();
            safety.push(format!(".bak.pre-restore.{}", stamp));
            let safety_path = PathBuf::from(safety);
            if let Err(e) = std::fs::copy(&original, &safety_path) {
                return Err(BackupError::Io(e));
            }
        }

        // Atomic write — fs_atomic will take its own .bak.<ts> first.
        fs_atomic::write_with_backup(&original, &content).map_err(|e| {
            BackupError::AtomicWrite(format!("{e}"))
        })?;
        Ok(())
    }

    // -----------------------------------------------------------------------
    // manual backup trigger
    // -----------------------------------------------------------------------

    /// Manually take a backup of the current live file pointed at
    /// by `target`. Returns the path of the new backup.
    ///
    /// `target` must point at a real file inside the Claude dir
    /// (typically `settings.json` or `.claude.json`) — we don't
    /// allow arbitrary file paths here.
    pub fn backup_now(&self, target: &Path) -> Result<BackupEntry, BackupError> {
        if !target.exists() {
            return Err(BackupError::NotFound(target.to_path_buf()));
        }
        // Reuse the same path-allow-list — the "current" file is
        // also in an allowed dir.
        let _safe = self.resolve_safe_path(target)?;
        // Use fs_atomic's backup_path_for to get a consistent
        // timestamped filename. We just copy — fs_atomic will be
        // the source of the next .bak.<ts> when something else
        // writes to `target` later.
        let backup_path = fs_atomic::backup_path_for(target);
        std::fs::copy(target, &backup_path)?;
        // Parse the result via the same scanner so the caller gets
        // a uniform `BackupEntry` shape.
        let entry = backup_scanner::parse_backup_filename(&backup_path)
            .ok_or_else(|| BackupError::CannotReconstruct(backup_path.clone()))?;
        // M4.6 (Phase 21) — best-effort history append. Failures
        // are logged and swallowed (CLAUDE.md §7: never silent).
        self.record_to_history(&entry, "manual");
        Ok(entry)
    }

    // -----------------------------------------------------------------------
    // M4.6 — incremental backup
    // -----------------------------------------------------------------------

    /// Incremental backup: diff-based, skip no-change.
    ///
    /// Only creates a new `.bak.<ts>` snapshot when the current file
    /// content differs from the most recent backup for the same file.
    /// When the content is unchanged, returns `BackupError::NoChange`
    /// instead of creating a duplicate snapshot — this keeps the backup
    /// timeline clean and avoids disk waste.
    ///
    /// ## Algorithm
    ///
    /// 1. Validate `target` exists and is in an allowed directory.
    /// 2. Scan for the most recent backup of the same original file
    ///    (same `original_name` as `target`) via
    ///    [`list_backups`].
    /// 3. If a previous backup exists AND its content matches the
    ///    current live file byte-for-byte → return
    ///    `BackupError::NoChange`.
    /// 4. Otherwise, delegate to [`backup_now`] to create a new
    ///    full snapshot.
    ///
    /// ## active_root_dir
    ///
    /// Uses `active_root_dir` to scope the previous-backup search to
    /// the correct project / user-level context (mirrors
    /// `list_backups` semantics).
    ///
    /// ## Note: this is NOT byte-delta storage
    ///
    /// The "incremental" part is the *decision to skip* identical
    /// snapshots — not storing diffs on disk. JSON config files are
    /// small enough (< 100 KB) that full snapshots are cheaper than
    /// diff reconstruction at restore time, and the user-facing
    /// timeline is easier to reason about when each entry is a
    /// self-contained snapshot.
    pub fn backup_incremental(
        &self,
        target: &Path,
        active_root_dir: Option<&Path>,
    ) -> Result<BackupEntry, BackupError> {
        if !target.exists() {
            return Err(BackupError::NotFound(target.to_path_buf()));
        }
        let _safe = self.resolve_safe_path_for_active_root(target, active_root_dir)?;

        // Get the original basename this backup would be for.
        let original_name = target
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("settings.json");

        // Scan all known backup dirs (with active_root expansion).
        let all_backups = self.list_backups(active_root_dir);

        // Find the most recent backup for the SAME original file.
        // list_backups is already sorted newest-first.
        let prev = all_backups
            .iter()
            .find(|e| e.original_name == original_name);

        // If a previous backup exists, compare content byte-for-byte.
        if let Some(prev_entry) = prev {
            if prev_entry.path.exists() {
                let prev_content = std::fs::read_to_string(&prev_entry.path)
                    .map_err(BackupError::Io)?;
                let current_content = std::fs::read_to_string(target)
                    .map_err(BackupError::Io)?;
                if prev_content == current_content {
                    return Err(BackupError::NoChange(prev_entry.path.clone()));
                }
            }
        }

        // Content differs (or no previous backup exists) — create a
        // new full snapshot via the existing full-copy path.
        self.backup_now(target)
    }

    /// Directories the frontend is allowed to read backups from.
    pub fn allowed_directories(&self) -> Vec<PathBuf> {
        let mut v = Vec::new();
        v.push(self.paths.backups_dir.clone());
        if let Some(claude_dir) = self.paths.claude_dir() {
            v.push(claude_dir.to_path_buf());
        }
        v
    }

    // -----------------------------------------------------------------------
    // M4.6 (Phase 21) — history sink
    // -----------------------------------------------------------------------

    /// Best-effort: append `entry` to `backup_history` via the
    /// attached `HistoryService`. Logs + swallows on error so the
    /// F13 path is never blocked by history I/O.
    fn record_to_history(&self, entry: &BackupEntry, trigger: &str) {
        let Some(history) = &self.history else { return };
        let backup_id = entry
            .path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();
        let created_at = entry.timestamp_unix.unwrap_or_else(|| {
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs() as i64)
                .unwrap_or(0)
        });
        let insert = crate::services::history_service::BackupHistoryInsert {
            backup_id,
            file_name: entry
                .path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string(),
            file_size: entry.size_bytes as i64,
            scope: "user".to_string(),
            trigger_kind: trigger.to_string(),
            file_hash: None,
            metadata_json: None,
            created_at,
        };
        if let Err(e) = history.record_backup(&insert, None) {
            eprintln!("[backup] history insert failed: {e}");
        }
    }

    // -----------------------------------------------------------------------
    // M4.6.13 — delete
    // -----------------------------------------------------------------------

    /// Permanently delete a single backup file.
    ///
    /// # Safety boundary
    ///
    /// The path MUST be inside one of the allow-list dirs (the same
    /// allow-list as `read_backup_content` / `restore_backup`). A
    /// path outside the allow-list is rejected with
    /// `BackupError::PathNotAllowed` and the file is NOT touched.
    /// This mirrors CLAUDE.md §3.2 (no OS escape through the
    /// service layer) and §7 (destructive ops must be intentional).
    ///
    /// # Algorithm (CLAUDE.md §7 "destructive ops need safety net")
    ///
    /// 1. Validate the path lives under an allowed dir (allow-list
    ///    check, with active_root_dir expansion for project mode).
    /// 2. Check the file actually exists; if not → `NotFound`.
    /// 3. Move the file into a sibling `.trash/` dir using a
    ///    timestamped filename (avoids collision with other
    ///    deletions in the same session). The move is the
    ///    **reversible** step: at this point the original is gone
    ///    but the file is recoverable from `<parent>/.trash/`.
    /// 4. Remove the trash entry.
    ///
    /// If step 3 fails (e.g. cross-volume rename is not supported
    /// on Windows and the targets are on different drives), we
    /// fall back to a copy + remove sequence: copy original into
    /// trash, then remove original. The fallback also lands the
    /// file in trash before removing it from the original
    /// location, preserving the safety invariant.
    ///
    /// If step 4 (the final rm) fails, the file is in `.trash/` but
    /// not yet gone from disk. We treat this as Ok(()) because the
    /// user's intent (remove from F13 timeline) is satisfied — the
    /// list_backups scan skips files not in the allow-list, so the
    /// orphaned trash file is invisible to the F13 UI. A future
    /// "empty trash" feature can sweep these.
    ///
    /// # active_root_dir
    ///
    /// `active_root_dir = Some(root)` expands the allow-list to
    /// `<root>/.claude/` so project-level `.bak.<ts>` snapshots can
    /// be deleted. `None` keeps the user-level allow-list (M2.6
    /// behaviour).
    pub fn delete_backup(
        &self,
        backup_path: &Path,
        active_root_dir: Option<&Path>,
    ) -> Result<(), BackupError> {
        // 1. Allow-list check (same shape as read_backup_content /
        //    restore_backup). Uses the active-root-aware variant.
        let safe = self.resolve_safe_path_for_active_root(backup_path, active_root_dir)?;

        // 2. Existence check. `resolve_safe_path` already
        //    canonicalizes if possible, so `safe` reflects the
        //    real on-disk path.
        if !safe.exists() {
            return Err(BackupError::NotFound(safe));
        }
        if !safe.is_file() {
            return Err(BackupError::NotFound(safe));
        }

        // 3. Compute trash target.
        //
        // We pick the parent dir of the file (sibling of the
        // backup) as the trash root, then append
        // `.trash/<basename>.<nanos>` so:
        //   - the move stays on the same volume (rename is atomic
        //     on Windows / POSIX when source and dest are on the
        //     same volume — see `std::fs::rename` docs);
        //   - a unique suffix prevents collisions when the user
        //     deletes multiple files with the same basename in the
        //     same session (e.g. rapid [立刻备份] clicks).
        let parent = safe
            .parent()
            .ok_or_else(|| BackupError::NotFound(safe.clone()))?
            .to_path_buf();
        let trash_dir = parent.join(".trash");
        let basename = safe
            .file_name()
            .ok_or_else(|| BackupError::NotFound(safe.clone()))?
            .to_os_string();
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let mut trash_name = basename.clone();
        trash_name.push(format!(".{}", nanos));
        let trash_path = trash_dir.join(trash_name);

        // Lazy-create `.trash/`. `create_dir_all` handles the
        // missing-parent case.
        if let Err(e) = std::fs::create_dir_all(&trash_dir) {
            return Err(BackupError::Io(e));
        }

        // 4. Move original → trash.
        //
        // We try rename first (atomic, fast). If the source and
        // destination are on different volumes (rare in our
        // context — backups always live in the same dir as the
        // parent — but possible if `<app_data>` is on a different
        // drive from `~/.claude/`), rename would fail with
        // `cross-device link` on Linux or ERROR_NOT_SAME_DEVICE
        // on Windows. Fall back to copy + remove.
        if let Err(rename_err) = std::fs::rename(&safe, &trash_path) {
            // Fallback: copy then remove.
            if let Err(copy_err) = std::fs::copy(&safe, &trash_path) {
                return Err(BackupError::Io(std::io::Error::new(
                    std::io::ErrorKind::Other,
                    format!(
                        "delete_backup: rename failed ({rename_err}) and copy fallback failed ({copy_err})"
                    ),
                )));
            }
            // Copy succeeded → safe to remove the original.
            if let Err(rm_err) = std::fs::remove_file(&safe) {
                return Err(BackupError::Io(std::io::Error::new(
                    std::io::ErrorKind::Other,
                    format!(
                        "delete_backup: copy to trash succeeded but remove_file of original failed: {rm_err}"
                    ),
                )));
            }
        }

        // 5. Remove the trash entry (final sweep). A failure here
        //    leaves the file in `.trash/` — invisible to the F13
        //    timeline but still on disk. We log + return Ok so the
        //    UI shows success (the user's intent — remove from
        //    timeline — is achieved); a future "empty trash"
        //    sweep can clean the leftovers.
        if let Err(rm_err) = std::fs::remove_file(&trash_path) {
            eprintln!(
                "[backup] delete_backup: moved to {trash_path:?} but final rm failed ({rm_err}); file remains in .trash/"
            );
        }

        Ok(())
    }

    // -----------------------------------------------------------------------
    // M3.10 adapter — active_root_dir aware paths (3-high F13)
    // -----------------------------------------------------------------------

    /// M3.10 adapter — return the Claude dir for the **active** root.
    ///
    /// - `Some(root)` = active project; return `<root>/.claude/`.
    /// - `None` = user-level; return `paths.claude_dir()`.
    ///
    /// This is the 3-high F13 adaptation point (M3.10-dataflow §5).
    /// Plugin callers (commands::backup, future F13 commands) MUST
    /// call this rather than reading `paths.claude_dir()` directly so
    /// that user/project mode switches transparently.
    pub fn claude_dir_for_active_root(&self, active_root: Option<&Path>) -> PathBuf {
        match active_root {
            Some(root) => root.join(".claude"),
            None => self
                .paths
                .claude_dir()
                .map(|p| p.to_path_buf())
                .unwrap_or_else(|| self.paths.home.join(".claude")),
        }
    }

    /// M3.10 adapter — full allow-list for backup scans, expanded with
    /// the active project's `.claude/` if any. Same semantics as
    /// [`allowed_directories`] but consults `active_root` for the
    /// project-mode case.
    pub fn allowed_directories_for_active_root(
        &self,
        active_root: Option<&Path>,
    ) -> Vec<PathBuf> {
        let mut v = self.allowed_directories();
        if let Some(root) = active_root {
            v.push(self.claude_dir_for_active_root(Some(root)));
        }
        v
    }

    /// Confirm `path` lives under one of the allowed directories.
    /// Rejects `..` traversal and absolute paths to other drives.
    fn resolve_safe_path(&self, path: &Path) -> Result<PathBuf, BackupError> {
        self.resolve_safe_path_for_active_root(path, None)
    }

    /// M3.12 (A1#6+A1#8) — `active_root_dir` aware allow-list check.
    ///
    /// When `active_root_dir = Some(root)`, the allow-list is
    /// expanded to include `<root>/.claude/`, so project-level
    /// `.bak.<ts>` files (taken by F18 apply_optimizations in
    /// project mode) are readable. The safety check itself is
    /// identical to `resolve_safe_path` — same canonicalize +
    /// `starts_with` walk.
    fn resolve_safe_path_for_active_root(
        &self,
        path: &Path,
        active_root_dir: Option<&Path>,
    ) -> Result<PathBuf, BackupError> {
        // Canonicalize when possible so we catch `..` and symlink
        // games. If the file doesn't exist, fall back to lexical
        // comparison on the parent.
        let candidate = std::fs::canonicalize(path)
            .unwrap_or_else(|_| path.to_path_buf());

        for allowed in self.allowed_directories_for_active_root(active_root_dir) {
            // If `allowed` exists, canonicalize it; otherwise use
            // the lex form.
            let allowed_root = std::fs::canonicalize(&allowed)
                .unwrap_or(allowed.clone());
            if candidate.starts_with(&allowed_root) {
                return Ok(candidate);
            }
        }
        Err(BackupError::PathNotAllowed(path.to_path_buf()))
    }
}

// ---------------------------------------------------------------------------
// DTO for manual backups — the frontend needs to know what the
// caller passed so it can refresh the timeline.
// ---------------------------------------------------------------------------

/// Return shape of [`BackupService::backup_now`].
#[derive(Debug, Serialize)]
pub struct ManualBackupResult {
    pub path: PathBuf,
    pub original_path: PathBuf,
    /// M3.2 polish — basename alias (see BackupEntry::original_name).
    #[serde(alias = "original_filename")]
    pub original_name: String,
    pub size_bytes: u64,
    pub source: BackupSource,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Strip `.bak.<ts>` (or `.backup.<ts>`) from a path to recover the
/// original file path. Returns `None` if the filename doesn't look
/// like a backup.
fn reconstruct_original(backup_path: &Path) -> Option<PathBuf> {
    let name = backup_path.file_name()?.to_str()?;
    for sep in &[".backup.", ".bak."] {
        if let Some(idx) = name.rfind(sep) {
            let original = &name[..idx];
            if original.is_empty() {
                return None;
            }
            let mut p = backup_path.to_path_buf();
            p.set_file_name(original);
            return Some(p);
        }
    }
    None
}

/// "yyyyMMdd-HHmmss" using a local-time approximation. Kept here
/// instead of imported from fs_atomic to avoid making that module's
/// helper `pub` (and to keep the prefix `pre-restore.` obvious
/// in a `ls`-grep).
fn pre_restore_stamp() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let days = secs.div_euclid(86_400);
    let secs_in_day = secs.rem_euclid(86_400);
    let (y, mo, d) = civil_from_days(days);
    let h = secs_in_day / 3600;
    let mi = (secs_in_day / 60) % 60;
    let s = secs_in_day % 60;
    format!("{:04}{:02}{:02}-{:02}{:02}{:02}", y, mo, d, h, mi, s)
}

fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = (if mp < 10 { mp + 3 } else { mp - 9 }) as u32;
    let y = if m <= 2 { y + 1 } else { y };
    (y, m, d)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn test_paths(app_data: &Path, settings: &Path) -> AppPaths {
        AppPaths {
            home: app_data.to_path_buf(),
            app_data: app_data.to_path_buf(),
            settings_json: settings.to_path_buf(),
            claude_json: app_data.join(".claude.json"),
            backups_dir: app_data.join("backups"),
            marketplaces_dir: app_data.join("marketplaces"),
            logs_dir: app_data.join("logs"),
            history_db: app_data.join("history.db"),
        }
    }

    /// Pre-create backups in BOTH allowed dirs so tests don't
    /// depend on the actual scanner module's behaviour.
    fn seed_backups(app_data: &Path, claude_dir: &Path) -> (PathBuf, PathBuf, PathBuf) {
        std::fs::create_dir_all(app_data.join("backups")).unwrap();
        std::fs::create_dir_all(claude_dir).unwrap();

        // settings.json in claude dir with two backups
        let s_live = claude_dir.join("settings.json");
        fs::write(
            &s_live,
            br#"{"env":{"ANTHROPIC_BASE_URL":"https://new"}}"#,
        )
        .unwrap();
        let s_bak_old = claude_dir.join("settings.json.bak.20260619-120000");
        let s_bak_new = claude_dir.join("settings.json.bak.20260619-140000");
        fs::write(
            &s_bak_old,
            br#"{"env":{"ANTHROPIC_BASE_URL":"https://old"}}"#,
        )
        .unwrap();
        fs::write(
            &s_bak_new,
            br#"{"env":{"ANTHROPIC_BASE_URL":"https://mid"}}"#,
        )
        .unwrap();

        // One backup in the backups dir
        let archived = app_data
            .join("backups")
            .join(".claude.json.bak.20260619-130000");
        fs::write(&archived, br#"{"mcpServers":{}}"#).unwrap();

        (s_bak_old, s_bak_new, archived)
    }

    // ----- list_backups -----

    #[test]
    fn list_backups_merges_both_dirs_newest_first() {
        let tmp = TempDir::new().unwrap();
        let claude_dir = tmp.path().join("claude");
        let settings = claude_dir.join("settings.json");
        let (s_old, s_new, _archived) = seed_backups(tmp.path(), &claude_dir);
        let svc = BackupService::new(test_paths(tmp.path(), &settings));

        let list = svc.list_backups(None);
        assert!(list.len() >= 3, "got {} entries: {list:?}", list.len());
        // Newest first: 14:00:00 > 13:00:00 > 12:00:00
        let ts: Vec<_> = list.iter().map(|e| e.timestamp_unix).collect();
        for w in ts.windows(2) {
            match (w[0], w[1]) {
                (Some(a), Some(b)) => assert!(a >= b, "not sorted: {ts:?}"),
                _ => {}
            }
        }
        // s_new (14:00) should be in the list
        assert!(list.iter().any(|e| e.path == s_new));
        // s_old (12:00) should be in the list
        assert!(list.iter().any(|e| e.path == s_old));
    }

    #[test]
    fn list_backups_empty_when_no_dirs() {
        let tmp = TempDir::new().unwrap();
        let settings = tmp.path().join("settings.json");
        let svc = BackupService::new(test_paths(tmp.path(), &settings));
        let list = svc.list_backups(None);
        assert!(list.is_empty());
    }

    // ----- read_backup_content -----

    #[test]
    fn read_backup_content_returns_full_string() {
        let tmp = TempDir::new().unwrap();
        let claude_dir = tmp.path().join("claude");
        let settings = claude_dir.join("settings.json");
        let (_s_old, s_new, _archived) = seed_backups(tmp.path(), &claude_dir);
        let svc = BackupService::new(test_paths(tmp.path(), &settings));

        let content = svc.read_backup_content(&s_new, None).unwrap();
        assert!(content.contains("https://mid"));
    }

    #[test]
    fn read_backup_content_rejects_path_outside_allowed_dirs() {
        let tmp = TempDir::new().unwrap();
        let settings = tmp.path().join("settings.json");
        let svc = BackupService::new(test_paths(tmp.path(), &settings));
        // A random temp file outside both allowed dirs.
        let outside = tmp.path().join("not-a-backup.txt");
        fs::write(&outside, b"hi").unwrap();
        let err = svc.read_backup_content(&outside, None).unwrap_err();
        assert!(matches!(err, BackupError::PathNotAllowed(_)));
    }

    // ----- diff_backups -----

    #[test]
    fn diff_backups_returns_field_changes() {
        let tmp = TempDir::new().unwrap();
        let claude_dir = tmp.path().join("claude");
        let settings = claude_dir.join("settings.json");
        let (s_old, s_new, _archived) = seed_backups(tmp.path(), &claude_dir);
        let svc = BackupService::new(test_paths(tmp.path(), &settings));

        let d = svc.diff_backups(&s_old, &s_new, None).unwrap();
        assert_eq!(d.len(), 1);
        assert_eq!(d[0].path, "env.ANTHROPIC_BASE_URL");
        assert_eq!(d[0].old.as_ref().unwrap(), &serde_json::json!("https://old"));
        assert_eq!(d[0].new.as_ref().unwrap(), &serde_json::json!("https://mid"));
    }

    #[test]
    fn diff_backups_handles_invalid_json_gracefully() {
        let tmp = TempDir::new().unwrap();
        let claude_dir = tmp.path().join("claude");
        let settings = claude_dir.join("settings.json");
        let (s_old, s_new, _archived) = seed_backups(tmp.path(), &claude_dir);
        // Corrupt the new file.
        fs::write(&s_new, b"not json").unwrap();
        let svc = BackupService::new(test_paths(tmp.path(), &settings));
        let d = svc.diff_backups(&s_old, &s_new, None).unwrap();
        assert!(d.is_empty(), "non-JSON diff returns empty: {d:?}");
    }

    // ----- restore_backup -----

    #[test]
    fn restore_backup_creates_safety_backup_first() {
        let tmp = TempDir::new().unwrap();
        let claude_dir = tmp.path().join("claude");
        let settings = claude_dir.join("settings.json");
        let (s_old, _s_new, _archived) = seed_backups(tmp.path(), &claude_dir);
        let svc = BackupService::new(test_paths(tmp.path(), &settings));

        svc.restore_backup(&s_old, None).unwrap();

        // The live file is now the OLD content (from s_old backup).
        let live = fs::read_to_string(&settings).unwrap();
        assert!(live.contains("https://old"));

        // A `.bak.pre-restore.<ts>` was created from the NEW content
        // (which was live at the time of restore).
        let mut found = false;
        for entry in fs::read_dir(&claude_dir).unwrap() {
            let entry = entry.unwrap();
            let name = entry.file_name().into_string().unwrap();
            if name.contains(".bak.pre-restore.") {
                found = true;
                let body = fs::read_to_string(entry.path()).unwrap();
                assert!(body.contains("https://new"), "pre-restore body: {body}");
            }
        }
        assert!(found, "pre-restore backup not found");
    }

    #[test]
    fn restore_backup_atomic_write_creates_secondary_backup() {
        let tmp = TempDir::new().unwrap();
        let claude_dir = tmp.path().join("claude");
        let settings = claude_dir.join("settings.json");
        let (s_old, _s_new, _archived) = seed_backups(tmp.path(), &claude_dir);
        let svc = BackupService::new(test_paths(tmp.path(), &settings));

        svc.restore_backup(&s_old, None).unwrap();

        // fs_atomic's own `.bak.<ts>` should also exist.
        let mut count = 0;
        for entry in fs::read_dir(&claude_dir).unwrap() {
            let name = entry.unwrap().file_name().into_string().unwrap();
            if name.starts_with("settings.json.bak.") && !name.contains(".pre-restore.") {
                count += 1;
            }
        }
        assert!(count >= 1, "expected fs_atomic .bak.<ts> after restore");
    }

    #[test]
    fn restore_backup_invalid_path_errors() {
        let tmp = TempDir::new().unwrap();
        let settings = tmp.path().join("settings.json");
        let svc = BackupService::new(test_paths(tmp.path(), &settings));

        let outside = tmp.path().join("not-a-backup.txt");
        fs::write(&outside, b"hi").unwrap();
        let err = svc.restore_backup(&outside, None).unwrap_err();
        assert!(matches!(err, BackupError::PathNotAllowed(_)));
    }

    #[test]
    fn restore_backup_missing_file_errors() {
        let tmp = TempDir::new().unwrap();
        let claude_dir = tmp.path().join("claude");
        let settings = claude_dir.join("settings.json");
        let (_s_old, _s_new, _archived) = seed_backups(tmp.path(), &claude_dir);
        let svc = BackupService::new(test_paths(tmp.path(), &settings));

        let missing = claude_dir.join("settings.json.bak.20990101-000000");
        let err = svc.restore_backup(&missing, None).unwrap_err();
        assert!(matches!(err, BackupError::NotFound(_)));
    }

    // ----- backup_now -----

    #[test]
    fn backup_now_creates_new_backup_file() {
        let tmp = TempDir::new().unwrap();
        let claude_dir = tmp.path().join("claude");
        let settings = claude_dir.join("settings.json");
        let (_s_old, _s_new, _archived) = seed_backups(tmp.path(), &claude_dir);
        let svc = BackupService::new(test_paths(tmp.path(), &settings));

        let entry = svc.backup_now(&settings).unwrap();
        assert!(entry.path.exists());
        let body = fs::read_to_string(&entry.path).unwrap();
        assert!(body.contains("https://new"));
    }

    // ----- M3.10 adapter (3-high F13) -----

    /// 用户级(None) → 返回 `paths.claude_dir()`(原 `~/.claude/`)。
    #[test]
    fn claude_dir_for_active_root_none_returns_user_level() {
        let tmp = TempDir::new().unwrap();
        let claude_dir = tmp.path().join("claude");
        let settings = claude_dir.join("settings.json");
        let svc = BackupService::new(test_paths(tmp.path(), &settings));
        let got = svc.claude_dir_for_active_root(None);
        assert_eq!(got, claude_dir);
    }

    /// 项目级(Some) → 返回 `<active_root>/.claude/`。
    #[test]
    fn claude_dir_for_active_root_some_returns_project_claude() {
        let tmp = TempDir::new().unwrap();
        let claude_dir = tmp.path().join("claude");
        let settings = claude_dir.join("settings.json");
        let svc = BackupService::new(test_paths(tmp.path(), &settings));
        let project_root = PathBuf::from("/proj-x");
        let got = svc.claude_dir_for_active_root(Some(&project_root));
        assert_eq!(got, PathBuf::from("/proj-x/.claude"));
    }

    /// 切换(None → Some) → 返回路径会变,但 allowed_directories 同时扩展。
    #[test]
    fn allowed_directories_expand_with_active_project() {
        let tmp = TempDir::new().unwrap();
        let claude_dir = tmp.path().join("claude");
        let settings = claude_dir.join("settings.json");
        let svc = BackupService::new(test_paths(tmp.path(), &settings));

        let user_dirs = svc.allowed_directories();
        assert_eq!(user_dirs.len(), 2, "user-level = backups + ~/.claude");

        let project_root = PathBuf::from("/proj-y");
        let project_dirs = svc.allowed_directories_for_active_root(Some(&project_root));
        assert_eq!(project_dirs.len(), 3, "project-mode = backups + ~/.claude + <root>/.claude");
        assert!(project_dirs.contains(&PathBuf::from("/proj-y/.claude")));
    }

    /// 失败/边界:活跃项目根不存在 → 不报错,只是路径在磁盘上不存在
    /// (allow-list 是路径级校验,不要求目标文件存在)。
    #[test]
    fn claude_dir_for_active_root_nonexistent_path_is_accepted() {
        let tmp = TempDir::new().unwrap();
        let settings = tmp.path().join("settings.json");
        let svc = BackupService::new(test_paths(tmp.path(), &settings));
        let ghost = PathBuf::from("/this/does/not/exist");
        let got = svc.claude_dir_for_active_root(Some(&ghost));
        assert_eq!(got, PathBuf::from("/this/does/not/exist/.claude"));
    }

    // ----- M3.12 adapter (A1#6+A1#8) — F13 list_backups + F19 restore_backup -----

    /// F13 list_backups 场景 1: `active_root = None` (用户级 / system project)。
    /// 扫描 `<backups_dir>` + `<user_claude_dir>`,与 M2.6 行为一致。
    #[test]
    fn list_backups_with_active_root_none_scans_user_level() {
        let tmp = TempDir::new().unwrap();
        let claude_dir = tmp.path().join("claude");
        let settings = claude_dir.join("settings.json");
        let (_s_old, s_new, archived) = seed_backups(tmp.path(), &claude_dir);

        let svc = BackupService::new(test_paths(tmp.path(), &settings));
        let list = svc.list_backups(None);

        // 三个 seed_backup 写入的 backup 都应出现(用户级扫描)。
        assert!(list.iter().any(|e| e.path == s_new));
        assert!(list.iter().any(|e| e.path == archived));
    }

    /// F13 list_backups 场景 2: `active_root = Some(<root>)` (项目模式)。
    /// 扫描 `<backups_dir>` + `<user_claude_dir>` + `<root>/.claude/`。
    /// 项目级 `.claude/` 下的 `.bak.<ts>` 必须出现在时间线里。
    #[test]
    fn list_backups_with_active_root_some_includes_project_backups() {
        let tmp = TempDir::new().unwrap();
        let user_claude_dir = tmp.path().join("claude");
        let user_settings = user_claude_dir.join("settings.json");
        let (_s_old, _s_new, _archived) = seed_backups(tmp.path(), &user_claude_dir);

        // 创建项目级 .claude/ 并放一个 .bak.<ts>。
        let project_root = tmp.path().join("myproj");
        let project_claude = project_root.join(".claude");
        std::fs::create_dir_all(&project_claude).unwrap();
        let project_live = project_claude.join("settings.json");
        fs::write(&project_live, br#"{"env":{"ANTHROPIC_BASE_URL":"https://proj-now"}}"#).unwrap();
        let project_bak = project_claude.join("settings.json.bak.20260619-150000");
        fs::write(&project_bak, br#"{"env":{"ANTHROPIC_BASE_URL":"https://proj-past"}}"#).unwrap();

        let svc = BackupService::new(test_paths(tmp.path(), &user_settings));
        let list = svc.list_backups(Some(&project_root));

        // 项目级 backup 必须出现在时间线里。
        assert!(
            list.iter().any(|e| e.path == project_bak),
            "project-level .bak.<ts> must appear in scan with active_root=Some, list: {list:?}"
        );
        // 用户级 backup 仍然可见 (list 是 ADD 语义,不是 REPLACE)。
        assert!(list.iter().any(|e| e.path == _s_new));
    }

    /// F19 restore_backup 场景 3: `active_root = None` (用户级 / 向后兼容)。
    /// 还原到 `<home>/.claude/settings.json` (用户级),与 M2.6 行为一致。
    #[test]
    fn restore_backup_with_active_root_none_restores_to_user_level() {
        let tmp = TempDir::new().unwrap();
        let claude_dir = tmp.path().join("claude");
        let settings = claude_dir.join("settings.json");
        let (s_old, _s_new, _archived) = seed_backups(tmp.path(), &claude_dir);

        let svc = BackupService::new(test_paths(tmp.path(), &settings));
        svc.restore_backup(&s_old, None).unwrap();

        // 用户级 settings.json 现在是 s_old 的内容。
        let live = fs::read_to_string(&settings).unwrap();
        assert!(
            live.contains("https://old"),
            "user-level settings.json must contain restored content, got: {live}"
        );
    }

    /// F19 restore_backup 场景 4: `active_root = Some(<root>)` (项目模式)。
    /// 还原到 `<root>/.claude/settings.json`,用户级文件**不**被改写。
    /// 还要保留 double-backup (pre-restore + fs_atomic .bak.<ts>)。
    #[test]
    fn restore_backup_with_active_root_some_restores_to_project_level() {
        let tmp = TempDir::new().unwrap();
        let user_claude_dir = tmp.path().join("claude");
        let user_settings = user_claude_dir.join("settings.json");
        let (_s_old, _s_new, _archived) = seed_backups(tmp.path(), &user_claude_dir);

        // 创建项目级 .claude/,有 settings.json 和一个 .bak.<ts>。
        let project_root = tmp.path().join("myproj");
        let project_claude = project_root.join(".claude");
        std::fs::create_dir_all(&project_claude).unwrap();
        let project_live = project_claude.join("settings.json");
        fs::write(&project_live, br#"{"env":{"ANTHROPIC_BASE_URL":"https://proj-new"}}"#).unwrap();
        let project_bak = project_claude.join("settings.json.bak.20260619-150000");
        fs::write(
            &project_bak,
            br#"{"env":{"ANTHROPIC_BASE_URL":"https://proj-old"}}"#,
        )
        .unwrap();

        let svc = BackupService::new(test_paths(tmp.path(), &user_settings));
        svc.restore_backup(&project_bak, Some(&project_root)).unwrap();

        // 项目级 settings.json 现在是 backup 的内容 (proj-old)。
        let live = fs::read_to_string(&project_live).unwrap();
        assert!(
            live.contains("https://proj-old"),
            "project-level settings.json must contain restored content, got: {live}"
        );
        // 用户级 settings.json **不**被改写 (仍是 seed_backups 写入的 "new")。
        let user_live = fs::read_to_string(&user_settings).unwrap();
        assert!(
            user_live.contains("https://new"),
            "user-level settings.json must NOT be touched by project-mode restore, got: {user_live}"
        );
        // pre-restore double-backup 存在(里面是 proj-new)。
        let mut found_pre = false;
        for entry in fs::read_dir(&project_claude).unwrap() {
            let entry = entry.unwrap();
            let name = entry.file_name().into_string().unwrap();
            if name.contains(".bak.pre-restore.") {
                found_pre = true;
                let body = fs::read_to_string(entry.path()).unwrap();
                assert!(
                    body.contains("https://proj-new"),
                    "pre-restore backup must hold pre-restore content (proj-new), got: {body}"
                );
            }
        }
        assert!(found_pre, "pre-restore backup must exist for project-mode restore");
    }

    /// F19 restore_backup 场景 5: `active_root = Some(<ghost>)` + root 不存在。
    /// 拒绝还原 + 返回 `ActiveRootMissing` + **不**mkdir 未知 root。
    /// (与 F18 apply_optimizations 安全边界对齐,见 `optimizer_service.rs:178-191`)。
    #[test]
    fn restore_backup_with_active_root_missing_dir_rejects_and_does_not_mkdir() {
        let tmp = TempDir::new().unwrap();
        let claude_dir = tmp.path().join("claude");
        let settings = claude_dir.join("settings.json");
        let (s_old, _s_new, _archived) = seed_backups(tmp.path(), &claude_dir);

        // ghost root 不存在
        let ghost = tmp.path().join("does_not_exist_yet");
        assert!(!ghost.exists(), "ghost root must not exist before call");

        let svc = BackupService::new(test_paths(tmp.path(), &settings));
        let err = svc
            .restore_backup(&s_old, Some(&ghost))
            .expect_err("restore into nonexistent root must be rejected");

        // 错误类型必须是 ActiveRootMissing (新增 variant)。
        match err {
            BackupError::ActiveRootMissing(p) => {
                assert_eq!(p, ghost, "error path must point at the missing root");
            }
            other => panic!("expected ActiveRootMissing, got: {other:?}"),
        }

        // ghost root 仍然不存在 — service 不能 mkdir 未知路径。
        assert!(
            !ghost.exists(),
            "service must NOT auto-mkdir the unknown active root"
        );

        // 用户级 settings.json 也**不**被改写 (还原被拒绝)。
        let user_live = fs::read_to_string(&settings).unwrap();
        assert!(
            user_live.contains("https://new"),
            "user-level settings.json must be untouched after rejected restore, got: {user_live}"
        );
    }

    // ----- M4.6 incremental backup -----

    /// 场景 1: 首次备份 → 等于全量 (无前备参考, 必定创建新备份)。
    #[test]
    fn backup_incremental_first_time_creates_new_backup() {
        let tmp = TempDir::new().unwrap();
        let claude_dir = tmp.path().join("claude");
        std::fs::create_dir_all(&claude_dir).unwrap();
        let settings = claude_dir.join("settings.json");
        fs::write(&settings, r#"{"env":{"url":"https://first"}}"#).unwrap();

        let svc = BackupService::new(test_paths(tmp.path(), &settings));
        let entry = svc.backup_incremental(&settings, None).unwrap();

        // 应该创建了一个 .bak.<ts> 文件。
        assert!(entry.path.exists());
        assert!(entry.path.file_name().unwrap().to_str().unwrap().contains(".bak."));
        assert_eq!(entry.original_name, "settings.json");

        // 内容与 live 文件一致。
        let bak_content = fs::read_to_string(&entry.path).unwrap();
        assert!(bak_content.contains("https://first"));
    }

    /// 场景 2: 前备存在 + 只改 1 文件 → 创建新的增量备份。
    #[test]
    fn backup_incremental_when_changed_creates_backup() {
        let tmp = TempDir::new().unwrap();
        let claude_dir = tmp.path().join("claude");
        std::fs::create_dir_all(&claude_dir).unwrap();
        let settings = claude_dir.join("settings.json");
        fs::write(&settings, r#"{"env":{"url":"https://old"}}"#).unwrap();

        let svc = BackupService::new(test_paths(tmp.path(), &settings));

        // 先做一次全量备份 (模拟前备)。
        let first = svc.backup_now(&settings).unwrap();
        assert!(first.path.exists());

        // 修改 live 文件。
        fs::write(&settings, r#"{"env":{"url":"https://new"}}"#).unwrap();

        // 增量备份应该创建新文件。
        let second = svc.backup_incremental(&settings, None).unwrap();
        assert!(second.path.exists());
        assert_ne!(first.path, second.path, "new backup must have different path from old one");

        let bak_content = fs::read_to_string(&second.path).unwrap();
        assert!(bak_content.contains("https://new"), "backup must contain updated content: {bak_content}");
    }

    /// 场景 3: 前备存在 + 未改动 → 不备份 (返回 NoChange)。
    #[test]
    fn backup_incremental_unchanged_returns_no_change() {
        let tmp = TempDir::new().unwrap();
        let claude_dir = tmp.path().join("claude");
        std::fs::create_dir_all(&claude_dir).unwrap();
        let settings = claude_dir.join("settings.json");
        fs::write(&settings, r#"{"env":{"url":"https://same"}}"#).unwrap();

        let svc = BackupService::new(test_paths(tmp.path(), &settings));

        // 先做一次全量备份。
        let first = svc.backup_now(&settings).unwrap();
        assert!(first.path.exists());

        // 不修改 live 文件 → 增量备份应返回 NoChange。
        let result = svc.backup_incremental(&settings, None);
        match result {
            Err(BackupError::NoChange(p)) => {
                assert_eq!(p, first.path, "NoChange must reference the previous backup path");
            }
            Ok(entry) => panic!("expected NoChange but got new backup: {entry:?}"),
            Err(other) => panic!("expected NoChange but got: {other:?}"),
        }
    }
}
