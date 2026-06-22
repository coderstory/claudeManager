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
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

pub struct BackupService {
    paths: AppPaths,
}

impl BackupService {
    pub fn new(paths: AppPaths) -> Self {
        Self { paths }
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
    pub fn list_backups(&self) -> Vec<BackupEntry> {
        let mut all: Vec<BackupEntry> = Vec::new();
        for dir in self.allowed_directories() {
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
    pub fn read_backup_content(&self, path: &Path) -> Result<String, BackupError> {
        let safe = self.resolve_safe_path(path)?;
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
    pub fn diff_backups(
        &self,
        path1: &Path,
        path2: &Path,
    ) -> Result<Vec<DiffEntry>, BackupError> {
        let p1 = self.resolve_safe_path(path1)?;
        let p2 = self.resolve_safe_path(path2)?;
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
    /// 1. Validate the backup path is inside an allowed dir.
    /// 2. Reconstruct the original file path (strip `.bak.<ts>`).
    /// 3. Read the backup content.
    /// 4. If the original file exists, copy it to
    ///    `<original>.bak.pre-restore.<ts>` (double-backup so the
    ///    user can reverse the restore too).
    /// 5. Atomic write the backup content to the original location
    ///    via `fs_atomic::write_with_backup` (which itself takes a
    ///    `.bak.<ts>` first — so we end up with two safety nets).
    pub fn restore_backup(&self, backup_path: &Path) -> Result<(), BackupError> {
        let safe = self.resolve_safe_path(backup_path)?;
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
        backup_scanner::parse_backup_filename(&backup_path)
            .ok_or_else(|| BackupError::CannotReconstruct(backup_path.clone()))
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

    /// Confirm `path` lives under one of the allowed directories.
    /// Rejects `..` traversal and absolute paths to other drives.
    fn resolve_safe_path(&self, path: &Path) -> Result<PathBuf, BackupError> {
        // Canonicalize when possible so we catch `..` and symlink
        // games. If the file doesn't exist, fall back to lexical
        // comparison on the parent.
        let candidate = std::fs::canonicalize(path)
            .unwrap_or_else(|_| path.to_path_buf());

        for allowed in self.allowed_directories() {
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

        let list = svc.list_backups();
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
        let list = svc.list_backups();
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

        let content = svc.read_backup_content(&s_new).unwrap();
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
        let err = svc.read_backup_content(&outside).unwrap_err();
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

        let d = svc.diff_backups(&s_old, &s_new).unwrap();
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
        let d = svc.diff_backups(&s_old, &s_new).unwrap();
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

        svc.restore_backup(&s_old).unwrap();

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

        svc.restore_backup(&s_old).unwrap();

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
        let err = svc.restore_backup(&outside).unwrap_err();
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
        let err = svc.restore_backup(&missing).unwrap_err();
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
}
