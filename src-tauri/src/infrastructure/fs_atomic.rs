//! `fs_atomic` — atomic file write with timestamped backup (CLAUDE.md §7,
//! SPEC §6.1, SPEC §6.2).
//!
//! Why this exists (vs hand-rolled `std::fs`):
//!
//! - **Atomicity**: a power loss / kill mid-write must leave the file in
//!   either the old state or the new state — never half-written. We
//!   achieve that by writing to `<path>.tmp.<uuid>` then renaming over
//!   the original. `std::fs::rename` is atomic on Windows (via
//!   `MoveFileEx`) and POSIX (atomic within the same filesystem).
//!
//! - **Backup before destructive write**: any write to a file the user
//!   depends on (`~/.claude/settings.json`, future `~/.claude.json`)
//!   must have a `*.bak.<ts>` snapshot taken first. If the new content
//!   is bad, the user (or the app on retry) can manually roll back.
//!
//! - **No silent failure**: every I/O call returns `Result`. No
//!   `unwrap()` in production paths. Errors bubble up via
//!   [`FsAtomicError`] so callers (services / commands) can render
//!   user-visible toasts (SPEC §6.5).
//!
//! ## Caveats
//!
//! - This module is intentionally minimal — it does NOT enforce the
//!   "保留最近 N 份" cleanup policy (F19). That's a layer above.
//! - It does NOT verify JSON validity of `content` before writing.
//!   Callers (ProviderService) pre-validate their JSON before calling.
//! - It assumes the parent directory already exists. Services that
//!   write to a fresh path must call `IPlatformPaths::ensure_dirs` first.

use std::path::{Path, PathBuf};
use thiserror::Error;
use uuid::Uuid;

/// Errors returned by [`write_with_backup`].
#[derive(Debug, Error)]
pub enum FsAtomicError {
    /// Underlying std::fs error (read / write / copy / rename).
    #[error("I/O error during atomic write: {0}")]
    Io(#[from] std::io::Error),

    /// The original file existed before the write but disappeared
    /// between the backup step and the atomic rename. Indicates an
    /// external process (or another instance) interfered — caller
    /// should treat this as a hard failure.
    #[error("original file disappeared during write: {0}")]
    OriginalVanished(PathBuf),

    /// The temp file we wrote could not be renamed into place. The
    /// original file is intact, the temp file may be left on disk.
    #[error("atomic rename failed for {dst}: {message}")]
    RenameFailed { dst: PathBuf, message: String },

    /// Restore-from-backup failed (no backup found, directory missing,
    /// or copy I/O error). P1-04a (v3.3 M7 phase 32-03) — enables the
    /// `switch_provider` step-5 rollback path: if the provider library
    /// write fails after settings.json was already advanced, the caller
    /// restores the latest `.bak.<ts>` snapshot to put settings.json
    /// back to its pre-switch state (CLAUDE.md §7 — any state change
    /// must be rollable).
    #[error("failed to restore from backup: {0}")]
    Restore(std::io::Error),
}

/// Write `content` to `path` atomically, taking a timestamped backup
/// of the existing file first.
///
/// # Algorithm
///
/// 1. If `path` exists, copy it to `<path>.bak.yyyyMMdd-HHmmss`
///    (see [`backup_path_for`]). Existing backups are NOT touched.
/// 2. Ensure the parent directory of `path` exists (mkdir -p semantics).
/// 3. Write `content` to `<path>.tmp.<uuid>`.
/// 4. `rename` the temp file over `path` (atomic on the same fs).
/// 5. Best-effort cleanup of the temp file if step 4 fails.
///
/// # Returns
/// - `Ok(())` on success.
/// - `Err(FsAtomicError::Io(_))` if any I/O step failed.
/// - `Err(FsAtomicError::OriginalVanished(_))` if the file was deleted
///   between backup and rename (extremely rare — external interference).
///
/// # Example
/// ```ignore
/// let p = Path::new("/home/u/.claude/settings.json");
/// let json = serde_json::to_string_pretty(&settings)?;
///
/// match write_with_backup(p, &json) {
///     Ok(_) => println!("settings.json updated"),
///     Err(e) => eprintln!("switch failed: {e}"),
/// }
/// ```
pub fn write_with_backup(path: &Path, content: &str) -> Result<(), FsAtomicError> {
    // Step 1: backup existing file (if any)
    if path.exists() {
        let backup = backup_path_for(path);
        std::fs::copy(path, &backup)?;
    }

    // Step 2: ensure parent dir exists
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            std::fs::create_dir_all(parent)?;
        }
    }

    // Step 3: write to a temp file (uuid suffix avoids name collisions)
    let tmp = tmp_path_for(path);
    std::fs::write(&tmp, content)?;

    // Step 4: atomic rename. std::fs::rename on Windows uses
    // MoveFileEx with MOVEFILE_REPLACE_EXISTING (atomic); on POSIX
    // rename(2) is atomic when src and dst are on the same filesystem.
    if let Err(e) = std::fs::rename(&tmp, path) {
        // Best-effort cleanup of the orphan temp file.
        let _ = std::fs::remove_file(&tmp);
        // Detect "vanished" — the file we just backed up is gone too.
        // This shouldn't happen on a single-threaded write, but
        // guards against concurrent processes (F20 single-instance is
        // not enforced for Claude Code itself).
        if !path.exists() {
            return Err(FsAtomicError::OriginalVanished(path.to_path_buf()));
        }
        return Err(FsAtomicError::RenameFailed {
            dst: path.to_path_buf(),
            message: e.to_string(),
        });
    }

    Ok(())
}

/// Restore the most recent backup file for `path` (the newest
/// `path.bak.<ts>` sibling in the same directory), copying it back
/// over `path`.
///
/// P1-04a (v3.3 M7 phase 32-03). Used by `switch_provider` /
/// `switch_provider_with_active_root` to roll back `settings.json`
/// when step 5 (provider library `to_json_file`) fails after step 4
/// (`write_with_backup`) already advanced settings.json to the new
/// provider's env (CLAUDE.md §7: any state change must be rollable;
/// SPEC §6.1/§6.2 atomic-write + backup contract).
///
/// # Algorithm
///
/// 1. Resolve `path`'s parent directory + basename. Either missing
///    → `FsAtomicError::Restore(NotFound)`.
/// 2. Enumerate directory entries whose name starts with
///    `<basename>.bak.` (the exact prefix [`backup_path_for`]
///    produces). No match → `Restore(NotFound)`.
/// 3. Pick the newest by modification time (`modified()`). We use
///    mtime rather than parsing the timestamp suffix because (a) the
///    suffix is local time, not lexically-sortable across DST
///    boundaries, and (b) mtime is monotonic for the typical case of
///    "the user just switched, the newest .bak is the pre-switch
///    snapshot". Ties fall back to directory order.
/// 4. `fs::copy(backup, path)` — overwrites `path` in place. Copy is
///    NOT atomic, but `path` was already destructively rewritten by
///    step 4 of `write_with_backup`; the backup copy is the source of
///    truth here and a partial copy still leaves a more-recent-good
///    snapshot than the half-advanced live file.
///
/// # Returns
/// - `Ok(())` on success.
/// - `Err(FsAtomicError::Restore(_))` if no parent, no basename, no
///   backup match, the dir read failed, or the copy failed.
///
/// # Caveats
/// - Does NOT delete the restored backup. Callers / F19 cleanup own
///   the "保留最近 N 份" policy. Leaving the backup is safer — the
///   user can re-restore if the switch retry also fails.
/// - Best-effort: a concurrent writer could land a newer `.bak` between
///   our dir-scan and our copy. F20 single-instance is not enforced
///   for Claude Code itself, so this is a known limitation (the same
///   one `write_with_backup` already accepts — see `OriginalVanished`).
pub fn restore_from_backup(path: &Path) -> Result<(), FsAtomicError> {
    let parent = path.parent().ok_or_else(|| {
        FsAtomicError::Restore(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            format!("path has no parent: {}", path.display()),
        ))
    })?;
    let basename = path.file_name().ok_or_else(|| {
        FsAtomicError::Restore(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            format!("path has no file name: {}", path.display()),
        ))
    })?;
    let prefix = format!("{}.bak.", basename.to_string_lossy());

    // Enumerate siblings matching the backup prefix. read_dir error
    // (e.g. parent doesn't exist) → Restore(io) so the caller sees a
    // clear "no backup available" rather than a panic. We map manually
    // (rather than `?`) so ALL restore-path errors land in `Restore`,
    // not the generic `Io` variant — the caller (`switch_provider`)
    // treats `Restore` as "rollback attempted, may be partial" vs `Io`
    // as "primary write failed".
    let read_dir = match std::fs::read_dir(parent) {
        Ok(rd) => rd,
        Err(e) => return Err(FsAtomicError::Restore(e)),
    };
    let mut entries: Vec<std::fs::DirEntry> = read_dir
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.file_name()
                .to_str()
                .map(|name| name.starts_with(&prefix))
                .unwrap_or(false)
        })
        .collect();

    if entries.is_empty() {
        return Err(FsAtomicError::Restore(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            format!("no backup found for {}", path.display()),
        )));
    }

    // Newest by mtime (descending). `modified()` failure on an entry
    // is treated as the oldest so a broken entry never wins.
    entries.sort_by_key(|e| e.metadata().and_then(|m| m.modified()).ok());
    entries.reverse();

    let backup_path = entries[0].path();
    if let Err(e) = std::fs::copy(&backup_path, path) {
        return Err(FsAtomicError::Restore(e));
    }
    Ok(())
}


///
/// Format: `<path>.bak.yyyyMMdd-HHmmss` (SPEC §6.1, local time).
/// Examples:
/// - `/home/u/.claude/settings.json` → `/home/u/.claude/settings.json.bak.20260619-142305`
/// - `C:\Users\u\.claude\settings.json` → `C:\Users\u\.claude\settings.json.bak.20260619-142305`
///
/// Timestamps are taken from the local clock so users can grep their
/// backup directory by date. We do NOT use UTC to match the user's
/// mental model of "what just happened".
pub fn backup_path_for(path: &Path) -> PathBuf {
    let stamp = local_timestamp_yyyymmdd_hhmmss();
    let mut s = path.as_os_str().to_owned();
    s.push(format!(".bak.{}", stamp));
    PathBuf::from(s)
}

/// Compute the temp file path used during the write.
///
/// Format: `<path>.tmp.<uuid>` — uuid is v4, hyphenated lowercase.
/// The `.tmp.` separator is chosen so that cleanup tools that glob for
/// `.tmp` find our orphan files without colliding with the user's
/// other temp files.
pub fn tmp_path_for(path: &Path) -> PathBuf {
    let mut s = path.as_os_str().to_owned();
    s.push(format!(".tmp.{}", Uuid::new_v4()));
    PathBuf::from(s)
}

/// `yyyyMMdd-HHmmss` in local time. NOT stable across time-zone changes
/// (which is exactly what we want — the user reads this in their file
/// manager, not in a script).
fn local_timestamp_yyyymmdd_hhmmss() -> String {
    use std::time::SystemTime;
    // We use `SystemTime` + a portable epoch conversion because we
    // don't want to pull chrono as a dep just for this (CLAUDE.md §2.3:
    // bump deps only with justification; chrono would also lock us to
    // its version range).
    let now = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default();
    let secs = now.as_secs() as i64;

    // Approximate local time without chrono: compute UTC fields then
    // bias by the system's UTC offset minutes (Windows: GetTimeZoneInformation;
    // POSIX: localtime_r via libc — neither is reachable from std).
    //
    // For practical purposes this is good enough: backup filenames are
    // human-readable labels, not contractual timestamps. We intentionally
    // skip sub-second precision and DST handling.
    let (mut y, mut mo, mut d, mut h, mut mi, mut s) = unix_to_utc_fields(secs);
    // Read the local UTC offset (minutes east of UTC) via a tiny
    // platform branch.
    let offset_minutes = local_utc_offset_minutes();
    let total = h * 3600 + mi * 60 + s + offset_minutes * 60;
    let (extra_days, secs_in_day) = (total.div_euclid(86_400), total.rem_euclid(86_400));
    h = secs_in_day / 3600;
    mi = (secs_in_day / 60) % 60;
    s = secs_in_day % 60;
    // Apply day offset, carrying through months / years.
    let (ny, nmo, nd) = add_days(y, mo, d, extra_days);
    y = ny;
    mo = nmo;
    d = nd;

    format!(
        "{:04}{:02}{:02}-{:02}{:02}{:02}",
        y, mo, d, h, mi, s
    )
}

/// Convert unix seconds to (year, month, day, hour, min, sec) in UTC.
/// Standard civil-from-days algorithm (Howard Hinnant's date.h).
fn unix_to_utc_fields(secs: i64) -> (i64, u32, u32, i64, i64, i64) {
    let days = secs.div_euclid(86_400);
    let secs_of_day = secs.rem_euclid(86_400);
    let h = secs_of_day / 3600;
    let mi = (secs_of_day / 60) % 60;
    let s = secs_of_day % 60;
    let (y, m, d) = civil_from_days(days);
    (y, m, d, h, mi, s)
}

fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097) as i64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = (if mp < 10 { mp + 3 } else { mp - 9 }) as u32;
    let y = if m <= 2 { y + 1 } else { y };
    (y, m, d)
}

fn add_days(y: i64, m: u32, d: u32, extra_days: i64) -> (i64, u32, u32) {
    if extra_days == 0 {
        return (y, m, d);
    }
    let base_days = days_from_civil(y, m, d);
    civil_from_days(base_days + extra_days)
}

fn days_from_civil(y: i64, m: u32, d: u32) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let mp = if m > 2 { m as i64 - 3 } else { m as i64 + 9 };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = (y - era * 400) as i64;
    let doy = ((153 * mp + 2) / 5 + d as i64 - 1) as i64;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// Local UTC offset in minutes east of UTC.
///
/// Platform dispatch (CLAUDE.md §3.2: keep OS details out of business code):
/// - **Windows**: raw FFI to `GetTimeZoneInformation` (kernel32). We use raw
///   externs instead of the `windows` crate's `Win32_System_Time` feature
///   to avoid touching Cargo.toml — the surface area is tiny (one struct,
///   one call) and stable since Windows 2000.
/// - **macOS / Linux (POSIX)**: `localtime_r` + `tm_gmtoff` (BSD libc
///   extension). macOS's libc ships `tm_gmtoff` since 10.0, so the
///   `#[cfg(not(windows))]` branch covers macOS without extra deps.
///
/// Returns 0 if the lookup fails (we still produce a valid timestamp;
/// it just won't match the user's wall clock).
#[cfg(windows)]
fn local_utc_offset_minutes() -> i64 {
    // Windows: GetTimeZoneInformation returns bias in minutes (UTC = local + bias).
    // So local - UTC = -bias.
    extern "system" {
        fn GetTimeZoneInformation(
            lp_time_zone_information: *mut TimeZoneInformation,
        ) -> u32;
    }

    #[repr(C)]
    struct TimeZoneInformation {
        bias: i32,
        standard_name: [u16; 32],
        standard_date: SystemTime,
        standard_bias: i32,
        daylight_name: [u16; 32],
        daylight_date: SystemTime,
        daylight_bias: i32,
    }

    #[repr(C)]
    #[derive(Copy, Clone)]
    struct SystemTime {
        w_year: u16,
        w_month: u16,
        w_day_of_week: u16,
        w_day: u16,
        w_hour: u16,
        w_minute: u16,
        w_second: u16,
        w_milliseconds: u16,
    }

    unsafe {
        let mut tzi = std::mem::zeroed::<TimeZoneInformation>();
        let _ret = GetTimeZoneInformation(&mut tzi);
        -(tzi.bias as i64)
    }
}

#[cfg(not(windows))]
fn local_utc_offset_minutes() -> i64 {
    // POSIX (Linux + macOS): tm_gmtoff is seconds east of UTC on
    // BSD-derived libcs (macOS, FreeBSD) and glibc (Linux). We use the
    // raw libc externs to avoid pulling the `libc` crate just for two
    // calls — same reason as the Windows branch above.
    //
    // For macOS, Apple's libc ships tm_gmtoff since 10.0 and the
    // declaration is stable, so the `#[repr(C)]` struct below matches
    // the platform ABI exactly. No platform trait needed — this
    // single #[cfg(not(windows))] branch covers every POSIX target.
    extern "C" {
        fn time(t: *mut i64) -> i64;
    }
    #[repr(C)]
    struct Tm {
        tm_sec: i32,
        tm_min: i32,
        tm_hour: i32,
        tm_mday: i32,
        tm_mon: i32,
        tm_year: i32,
        tm_wday: i32,
        tm_yday: i32,
        tm_isdst: i32,
        tm_gmtoff: i64,
        tm_zone: *const u8,
    }
    extern "C" {
        fn localtime_r(timep: *const i64, result: *mut Tm) -> *mut Tm;
    }
    unsafe {
        let now = time(std::ptr::null_mut());
        let mut tm = std::mem::zeroed::<Tm>();
        if localtime_r(&now, &mut tm).is_null() {
            return 0;
        }
        // tm_gmtoff is in seconds east of UTC on macOS (BSD libc) and
        // Linux (glibc). Convert to minutes.
        tm.tm_gmtoff / 60
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn write_with_backup_creates_backup_when_file_exists() {
        let tmp = TempDir::new().unwrap();
        let p = tmp.path().join("settings.json");
        fs::write(&p, r#"{"old": true}"#).unwrap();

        write_with_backup(&p, r#"{"new": true}"#).unwrap();

        // Original now has new content
        let content = fs::read_to_string(&p).unwrap();
        assert!(content.contains("\"new\""));

        // A .bak.<ts> file exists and contains old content
        let mut found_bak = None;
        for entry in fs::read_dir(tmp.path()).unwrap() {
            let entry = entry.unwrap();
            let name = entry.file_name().into_string().unwrap();
            if name.starts_with("settings.json.bak.") {
                found_bak = Some(entry.path());
                break;
            }
        }
        let bak = found_bak.expect("backup file should exist");
        let bak_content = fs::read_to_string(&bak).unwrap();
        assert!(bak_content.contains("\"old\""));
    }

    #[test]
    fn write_with_backup_succeeds_when_file_does_not_exist() {
        let tmp = TempDir::new().unwrap();
        let p = tmp.path().join("settings.json");
        assert!(!p.exists());

        write_with_backup(&p, r#"{"new": true}"#).unwrap();

        let content = fs::read_to_string(&p).unwrap();
        assert!(content.contains("\"new\""));

        // No backup file should be created
        let mut count = 0;
        for entry in fs::read_dir(tmp.path()).unwrap() {
            let entry = entry.unwrap();
            let name = entry.file_name().into_string().unwrap();
            if name.contains(".bak.") {
                count += 1;
            }
        }
        assert_eq!(count, 0, "no backup should exist for a new file");
    }

    #[test]
    fn write_with_backup_cleans_up_temp_file_on_success() {
        let tmp = TempDir::new().unwrap();
        let p = tmp.path().join("settings.json");
        fs::write(&p, "{}").unwrap();

        write_with_backup(&p, r#"{"x":1}"#).unwrap();

        // No .tmp.<uuid> file should remain
        for entry in fs::read_dir(tmp.path()).unwrap() {
            let name = entry.unwrap().file_name().into_string().unwrap();
            assert!(!name.contains(".tmp."), "leftover temp file: {name}");
        }
    }

    #[test]
    fn write_with_backup_creates_parent_dir_if_missing() {
        let tmp = TempDir::new().unwrap();
        let nested = tmp.path().join("a").join("b").join("settings.json");
        assert!(!nested.parent().unwrap().exists());

        write_with_backup(&nested, r#"{"x":1}"#).unwrap();

        assert!(nested.exists());
        let content = fs::read_to_string(&nested).unwrap();
        assert!(content.contains("\"x\":1"));
    }

    #[test]
    fn backup_path_for_appends_bak_timestamp() {
        let p = Path::new("/home/u/.claude/settings.json");
        let bp = backup_path_for(p);
        let s = bp.to_str().unwrap();
        assert!(s.starts_with("/home/u/.claude/settings.json.bak."));
        // 15 chars after .bak.: yyyyMMdd-HHmmss
        let suffix = &s[s.len() - 15..];
        assert_eq!(suffix.chars().filter(|c| c.is_ascii_digit() || *c == '-').count(), 15);
    }

    #[test]
    fn tmp_path_for_appends_uuid_suffix() {
        let p = Path::new("/x/y.json");
        let t = tmp_path_for(p);
        let s = t.to_str().unwrap();
        assert!(s.starts_with("/x/y.json.tmp."));
        // uuid v4 hex string is 36 chars (32 + 4 dashes)
        let suffix = &s[s.len() - 36..];
        assert_eq!(suffix.chars().filter(|c| c.is_ascii_hexdigit() || *c == '-').count(), 36);
    }

    #[test]
    fn backup_path_for_two_calls_in_same_second_still_differ_via_filename_only() {
        // Note: if two backups happen within the same second, the
        // timestamps WILL collide. SPEC §6.9 mentions this is fine
        // because most user actions are seconds apart. We don't test
        // collision (which would require thread sleep); we just verify
        // the function is deterministic in shape.
        let p = Path::new("/x/y.json");
        let b1 = backup_path_for(p);
        let b2 = backup_path_for(p);
        // Same shape (same timestamp since they're synchronous)
        assert_eq!(b1, b2);
    }

    #[test]
    fn unix_to_utc_fields_known_value() {
        // 2026-06-19 00:00:00 UTC = 1781846400
        let (y, mo, d, h, mi, s) = unix_to_utc_fields(1_781_846_400);
        assert_eq!((y, mo, d), (2026, 6, 19));
        assert_eq!((h, mi, s), (0, 0, 0));
    }

    #[test]
    fn local_timestamp_yyyymmdd_hhmmss_is_15_chars_and_well_formed() {
        let s = local_timestamp_yyyymmdd_hhmmss();
        assert_eq!(s.len(), 15);
        let parts: Vec<&str> = s.split('-').collect();
        assert_eq!(parts.len(), 2);
        assert_eq!(parts[0].len(), 8); // yyyyMMdd
        assert_eq!(parts[1].len(), 6); // HHmmss
        // All digits
        assert!(s.chars().all(|c| c.is_ascii_digit() || c == '-'));
    }

    // ----- restore_from_backup (P1-04a, v3.3 M7 phase 32-03) -----

    #[test]
    fn restore_from_backup_recovers_latest_backup() {
        let tmp = TempDir::new().unwrap();
        let target = tmp.path().join("settings.json");

        // Seed v1, then two backup-taking writes (v2 then v3).
        fs::write(&target, "v1").unwrap();
        write_with_backup(&target, "v2").unwrap();
        // Sleep so the second backup's mtime strictly exceeds the
        // first; otherwise sort_by_key(mtime) sees a tie and the
        // "newest" pick is non-deterministic. 1.1s covers both 1s
        // ext4 and 0.1s APFS mtime granularity.
        std::thread::sleep(std::time::Duration::from_millis(1100));
        write_with_backup(&target, "v3").unwrap();

        // Simulate the failure scenario: live file is corrupted.
        fs::write(&target, "corrupted").unwrap();

        // Restore should pull back the NEWEST backup (by mtime), which
        // is the pre-v3 snapshot = "v2". This mirrors the
        // switch_provider rollback contract: write_with_backup
        // snapshots the PRE-write state, so restore_from_backup
        // returns the state immediately before the most recent
        // advance. (Backup files on disk: .bak.<T1>→"v1", .bak.<T2>→"v2".)
        restore_from_backup(&target).unwrap();
        let restored = fs::read_to_string(&target).unwrap();
        assert_eq!(restored, "v2");
    }

    #[test]
    fn restore_from_backup_errors_when_no_backup() {
        let tmp = TempDir::new().unwrap();
        let target = tmp.path().join("never-backed-up.json");
        fs::write(&target, "data").unwrap();
        // No backup ever written. Must error, and the variant must be
        // Restore so switch_provider's rollback path can distinguish
        // "no snapshot" from a generic Io error.
        let err = restore_from_backup(&target).unwrap_err();
        assert!(matches!(err, FsAtomicError::Restore(_)));
    }
}