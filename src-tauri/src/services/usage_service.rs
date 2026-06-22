//! UsageService — F7 (用量查询) business logic for M3.8.
//!
//! Reads the active provider's token usage from
//! `~/.claude/projects/<encoded-path>/*.jsonl` (the cc-switch
//! JSONL pattern — see `services/usage_provider_ccswitch.rs`)
//! and caches the aggregated snapshot in-memory for 5 minutes per
//! `(provider_id, window)` key.
//!
//! ## Data flow
//!
//! ```text
//! [F7 数据流]
//! User click "用量查询" → setView('usage-query')
//!   → UsageQueryPage mount
//!   → invoke('get_current_usage', { window: '5h' | '1w' | '1m' })
//!   → Rust:
//!     1. 读 ~/.claude/settings.json → 找 active provider
//!     2. 查 in-memory cache（5min TTL）
//!     3. cache miss → 调 usage_provider_ccswitch::compute_usage_from_jsonl
//!        → 扫 ~/.claude/projects/<encoded-path>/*.jsonl
//!        → 内存聚合 per-model + per-day history
//!        → lookup_pricing(model) 算 cost
//!     4. 返回 UsageSnapshot { tokens_used, cost_usd, breakdown, model_count, ... }
//!   → UI 渲染 3 卡片 + breakdown 表格 + history chart
//! ```
//!
//! ## M3.8 error handling (4 classes)
//!
//! Per cc-switch pattern, partial failures are tolerated —
//! bad JSONL lines are skipped (counters in `ComputeStats`), the
//! aggregate still ships. Four error classes surfaced via
//! `UsageError`:
//!
//! - `PathUnresolved` — AppPaths returned no `claude_dir`.
//! - `PermissionDenied` — read on a JSONL file denied
//!   (translated from `UsageProviderError::PermissionDenied`).
//! - `JsonParse` — fatal JSON parse on metadata layer
//!   (line-level errors stay in stats, not surfaced).
//! - `EncodingError` — non-UTF8 bytes in a file.
//!
//! Missing `~/.claude/projects/` directory → empty snapshot
//! (NOT an error — first-run / fresh install).
//!
//! ## Cache policy (unchanged from M2.7)
//!
//! - Key: `(provider_id, window)` — when the user switches
//!   providers, the old key naturally expires (different provider).
//! - TTL: 5 minutes (CLAUDE.md §3.3 → F7 requirement).
//! - `refresh(window)` drops the cache entry and re-reads.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use thiserror::Error;

use crate::domain::{UsageHistoryEntry, UsageSnapshot, UsageWindow};
use crate::platform::AppPaths;
use crate::services::usage_provider_ccswitch::{
    self, UsageErrorKind, UsageProviderError,
};

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

#[derive(Debug, Error)]
pub enum UsageError {
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("invalid JSON in usage source: {0}")]
    Json(#[from] serde_json::Error),

    #[error("unknown window: {0}")]
    UnknownWindow(String),

    #[error("~/.claude directory could not be resolved from AppPaths")]
    PathUnresolved,

    #[error("权限被拒绝: {0}")]
    PermissionDenied(String),

    #[error("文件编码错误: {0}")]
    EncodingError(String),
}

impl From<UsageProviderError> for UsageError {
    fn from(e: UsageProviderError) -> Self {
        match e.kind {
            UsageErrorKind::PermissionDenied => UsageError::PermissionDenied(e.message),
            UsageErrorKind::EncodingError => UsageError::EncodingError(e.message),
            UsageErrorKind::JsonParse | UsageErrorKind::NotFound => {
                // Per-file parse failures are tolerated; only surfaced
                // here when they bubble all the way up (which they
                // don't today — see provider's collect_jsonl_files).
                UsageError::Json(serde_json::Error::io(std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    e.message,
                )))
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/// Business logic for F7 (用量查询). Owns the in-memory 5-minute cache.
pub struct UsageService {
    paths: AppPaths,
    /// Cached snapshot per (provider_id, window) key. The history
    /// is cached alongside the snapshot — it's derived from the
    /// same JSONL scan so we don't want to recompute.
    cache: Mutex<HashMap<String, CacheEntry>>,
    /// Cache TTL. M3.8 default = 5 minutes. Tests can construct
    /// with a smaller TTL via [`UsageService::with_ttl`].
    ttl: Duration,
}

#[derive(Debug, Clone)]
struct CacheEntry {
    snapshot: UsageSnapshot,
    history: Vec<UsageHistoryEntry>,
    stored_at: Instant,
}

impl UsageService {
    pub fn new(paths: AppPaths) -> Self {
        Self {
            paths,
            cache: Mutex::new(HashMap::new()),
            ttl: Duration::from_secs(300),
        }
    }

    /// Constructor with a custom TTL — used by tests to exercise the
    /// "expired" branch without sleeping 5 minutes.
    #[allow(dead_code)]
    pub fn with_ttl(paths: AppPaths, ttl: Duration) -> Self {
        let mut svc = Self::new(paths);
        svc.ttl = ttl;
        svc
    }

    /// Borrow the resolved paths (read-only).
    #[allow(dead_code)]
    pub fn paths(&self) -> &AppPaths {
        &self.paths
    }

    /// Current TTL (read-only).
    #[allow(dead_code)]
    pub fn ttl(&self) -> Duration {
        self.ttl
    }

    // -----------------------------------------------------------------------
    // Public API
    // -----------------------------------------------------------------------

    /// Return the cached snapshot + history for
    /// `(provider_id, window)` if fresh; otherwise re-scan JSONL
    /// and refresh the cache.
    ///
    /// Returns `(snapshot, history)`. `history` is sorted by
    /// (date asc, model asc) for stable chart rendering.
    ///
    /// Errors only on truly exceptional conditions (path
    /// resolution + I/O + fatal JSON parse of metadata).
    /// Missing `~/.claude/projects/` directory → empty snapshot.
    pub fn get_usage(
        &self,
        provider_id: &str,
        window: UsageWindow,
    ) -> Result<(UsageSnapshot, Vec<UsageHistoryEntry>), UsageError> {
        let key = cache_key(provider_id, window);
        // Cache hit + fresh?
        if let Some(entry) = self.cache.lock().unwrap().get(&key).cloned() {
            if entry.stored_at.elapsed() < self.ttl {
                return Ok((entry.snapshot, entry.history));
            }
        }
        // Cache miss or expired — re-scan.
        let (snap, history) = self.compute_usage_for_window(provider_id, window)?;
        self.cache.lock().unwrap().insert(
            key,
            CacheEntry {
                snapshot: snap.clone(),
                history: history.clone(),
                stored_at: Instant::now(),
            },
        );
        Ok((snap, history))
    }

    /// Drop the cache entry for `(provider_id, window)` and re-scan.
    pub fn refresh(
        &self,
        provider_id: &str,
        window: UsageWindow,
    ) -> Result<(UsageSnapshot, Vec<UsageHistoryEntry>), UsageError> {
        let key = cache_key(provider_id, window);
        self.cache.lock().unwrap().remove(&key);
        self.get_usage(provider_id, window)
    }

    /// Return only the snapshot (no history). Used by the command
    /// layer when the UI doesn't need history (cheap path).
    #[allow(dead_code)]
    pub fn get_snapshot_only(
        &self,
        provider_id: &str,
        window: UsageWindow,
    ) -> Result<UsageSnapshot, UsageError> {
        let (snap, _history) = self.get_usage(provider_id, window)?;
        Ok(snap)
    }

    /// Return only the history. Re-uses the cache.
    #[allow(dead_code)]
    pub fn get_history_only(
        &self,
        provider_id: &str,
        window: UsageWindow,
    ) -> Result<Vec<UsageHistoryEntry>, UsageError> {
        let (_snap, history) = self.get_usage(provider_id, window)?;
        Ok(history)
    }

    // -----------------------------------------------------------------------
    // Internal
    // -----------------------------------------------------------------------

    /// Compute the snapshot + history by scanning JSONL. Path
    /// comes from `AppPaths::claude_dir().join("projects")`.
    fn compute_usage_for_window(
        &self,
        provider_id: &str,
        window: UsageWindow,
    ) -> Result<(UsageSnapshot, Vec<UsageHistoryEntry>), UsageError> {
        let claude_dir = self
            .paths
            .claude_dir()
            .ok_or(UsageError::PathUnresolved)?;
        let projects_dir = claude_dir.join("projects");
        let result = usage_provider_ccswitch::compute_usage_from_jsonl(
            &projects_dir,
            window,
            provider_id,
        )?;
        Ok((result.snapshot, result.history))
    }

    /// Test-only: inject a snapshot+history into the cache
    /// without going through the JSONL scanner. Useful for
    /// command-layer tests that need a pre-populated cache.
    #[cfg(test)]
    pub fn _seed_cache(
        &self,
        provider_id: &str,
        window: UsageWindow,
        snap: UsageSnapshot,
        history: Vec<UsageHistoryEntry>,
    ) {
        let key = cache_key(provider_id, window);
        self.cache.lock().unwrap().insert(
            key,
            CacheEntry {
                snapshot: snap,
                history,
                stored_at: Instant::now(),
            },
        );
    }
}

/// Compose the cache key from `(provider_id, window)`. The provider
/// id is sanitised (whitespace stripped) so equivalent keys collide.
fn cache_key(provider_id: &str, window: UsageWindow) -> String {
    format!("{}::{}", provider_id.trim(), window.as_str())
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    use std::fs;
    use std::path::{Path, PathBuf};
    use tempfile::TempDir;

    /// Build an `AppPaths` snapshot pointing at `tmp/claude/` for the
    /// usage.json file. Other paths are placeholders — the service
    /// only reads `claude_dir/projects/`.
    fn build_paths(claude_dir: &std::path::Path) -> AppPaths {
        AppPaths {
            home: claude_dir.to_path_buf(),
            app_data: claude_dir.join("appdata"),
            settings_json: claude_dir.join("settings.json"),
            claude_json: claude_dir.join("claude.json"),
            backups_dir: claude_dir.join("appdata/backups"),
            marketplaces_dir: claude_dir.join("appdata/marketplaces"),
            logs_dir: claude_dir.join("appdata/logs"),
        }
    }

    fn write_assistant_line(file: &Path, model: &str, input: u64, output: u64, msg_id: &str, ts: &str) {
        use std::io::Write;
        let mut f = fs::OpenOptions::new().create(true).append(true).open(file).unwrap();
        let line = format!(
            r#"{{"type":"assistant","message":{{"id":"{msg_id}","role":"assistant","model":"{model}","usage":{{"input_tokens":{input},"output_tokens":{output},"cache_creation_input_tokens":0,"cache_read_input_tokens":0}}}},"timestamp":"{ts}","sessionId":"s1","cwd":"C:\\foo"}}"#
        );
        writeln!(f, "{}", line).unwrap();
    }

    /// Build a `claude_dir/projects/<encoded>/sess.jsonl` fixture.
    fn write_sess_jsonl(claude_dir: &Path, encoded: &str, lines: &[(&str, u64, u64, &str, &str)]) -> PathBuf {
        let dir = claude_dir.join("projects").join(encoded);
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("sess.jsonl");
        for (model, input, output, msg_id, ts) in lines {
            write_assistant_line(&file, model, *input, *output, msg_id, ts);
        }
        file
    }

    #[test]
    fn get_usage_cache_miss_scans_jsonl() {
        let tmp = TempDir::new().unwrap();
        let claude = tmp.path().join("claude");
        fs::create_dir_all(&claude).unwrap();
        write_sess_jsonl(
            &claude,
            "C--foo",
            &[("claude-sonnet-4-20250514", 1000, 500, "m1", "2026-06-22T10:00:00Z")],
        );
        let svc = UsageService::new(build_paths(&claude));
        let (snap, _history) = svc.get_usage("p1", UsageWindow::OneMonth).unwrap();
        assert_eq!(snap.provider_id, "p1");
        assert_eq!(snap.tokens_used, 1500);
        assert_eq!(snap.breakdown.len(), 1);
    }

    #[test]
    fn get_usage_cache_hit_returns_cached() {
        let tmp = TempDir::new().unwrap();
        let claude = tmp.path().join("claude");
        fs::create_dir_all(&claude).unwrap();
        write_sess_jsonl(
            &claude,
            "C--foo",
            &[("claude-sonnet-4-20250514", 1000, 500, "m1", "2026-06-22T10:00:00Z")],
        );
        let svc = UsageService::new(build_paths(&claude));
        let (s1, _) = svc.get_usage("p1", UsageWindow::OneMonth).unwrap();
        // Bump file — cache must still return the original.
        write_sess_jsonl(
            &claude,
            "C--foo",
            &[("claude-sonnet-4-20250514", 9999, 9999, "m2", "2026-06-22T11:00:00Z")],
        );
        let (s2, _) = svc.get_usage("p1", UsageWindow::OneMonth).unwrap();
        assert_eq!(s1.tokens_used, s2.tokens_used);
    }

    #[test]
    fn get_usage_cache_expired_rescans() {
        let tmp = TempDir::new().unwrap();
        let claude = tmp.path().join("claude");
        fs::create_dir_all(&claude).unwrap();
        write_sess_jsonl(
            &claude,
            "C--foo",
            &[("claude-sonnet-4-20250514", 1000, 500, "m1", "2026-06-22T10:00:00Z")],
        );
        let svc = UsageService::with_ttl(build_paths(&claude), Duration::from_secs(1));
        let (s1, _) = svc.get_usage("p1", UsageWindow::OneMonth).unwrap();
        assert_eq!(s1.tokens_used, 1500);
        write_sess_jsonl(
            &claude,
            "C--foo",
            &[("claude-sonnet-4-20250514", 2000, 1000, "m2", "2026-06-22T11:00:00Z")],
        );
        // Within TTL — cache wins.
        let (s2, _) = svc.get_usage("p1", UsageWindow::OneMonth).unwrap();
        assert_eq!(s2.tokens_used, 1500);
        // Past TTL — re-scan.
        std::thread::sleep(Duration::from_millis(1100));
        let (s3, _) = svc.get_usage("p1", UsageWindow::OneMonth).unwrap();
        assert_eq!(s3.tokens_used, 3000);
    }

    #[test]
    fn refresh_clears_cache() {
        let tmp = TempDir::new().unwrap();
        let claude = tmp.path().join("claude");
        fs::create_dir_all(&claude).unwrap();
        write_sess_jsonl(
            &claude,
            "C--foo",
            &[("claude-sonnet-4-20250514", 1000, 500, "m1", "2026-06-22T10:00:00Z")],
        );
        let svc = UsageService::with_ttl(build_paths(&claude), Duration::from_secs(60));
        let (s1, _) = svc.get_usage("p1", UsageWindow::OneMonth).unwrap();
        assert_eq!(s1.tokens_used, 1500);
        write_sess_jsonl(
            &claude,
            "C--foo",
            &[("claude-sonnet-4-20250514", 2000, 1000, "m2", "2026-06-22T11:00:00Z")],
        );
        let (s2, _) = svc.refresh("p1", UsageWindow::OneMonth).unwrap();
        assert_eq!(s2.tokens_used, 3000);
    }

    #[test]
    fn missing_projects_dir_returns_empty_snapshot() {
        let tmp = TempDir::new().unwrap();
        let claude = tmp.path().join("claude");
        fs::create_dir_all(&claude).unwrap();
        // No projects/ dir at all.
        let svc = UsageService::new(build_paths(&claude));
        let (snap, history) = svc.get_usage("p1", UsageWindow::OneMonth).unwrap();
        assert_eq!(snap.provider_id, "p1");
        assert_eq!(snap.tokens_used, 0);
        assert!(snap.cost_usd.is_none());
        assert!(snap.breakdown.is_empty());
        assert_eq!(snap.model_count, 0);
        assert!(history.is_empty());
        assert!(snap.timestamp > 0);
    }

    #[test]
    fn cache_keys_isolated_per_provider_and_window() {
        let tmp = TempDir::new().unwrap();
        let claude = tmp.path().join("claude");
        fs::create_dir_all(&claude).unwrap();
        write_sess_jsonl(
            &claude,
            "C--foo",
            &[
                ("claude-sonnet-4-20250514", 1000, 500, "m1", "2026-06-22T10:00:00Z"),
                ("claude-haiku-4-20250514", 200, 100, "m2", "2026-06-22T10:00:00Z"),
            ],
        );
        let svc = UsageService::with_ttl(build_paths(&claude), Duration::from_secs(60));

        let (a, _) = svc.get_usage("p1", UsageWindow::FiveHours).unwrap();
        let (b, _) = svc.get_usage("p1", UsageWindow::OneWeek).unwrap();
        assert_eq!(a.tokens_used, 1800);
        assert_eq!(b.tokens_used, 1800);
        assert_ne!(a.window, b.window);
    }

    #[test]
    fn get_snapshot_only_skips_history_clone() {
        let tmp = TempDir::new().unwrap();
        let claude = tmp.path().join("claude");
        fs::create_dir_all(&claude).unwrap();
        write_sess_jsonl(
            &claude,
            "C--foo",
            &[("claude-sonnet-4-20250514", 1000, 500, "m1", "2026-06-22T10:00:00Z")],
        );
        let svc = UsageService::new(build_paths(&claude));
        let snap = svc.get_snapshot_only("p1", UsageWindow::OneMonth).unwrap();
        assert_eq!(snap.tokens_used, 1500);
    }

    #[test]
    fn get_history_only_returns_scanned_history() {
        let tmp = TempDir::new().unwrap();
        let claude = tmp.path().join("claude");
        fs::create_dir_all(&claude).unwrap();
        write_sess_jsonl(
            &claude,
            "C--foo",
            &[
                ("claude-sonnet-4-20250514", 1000, 500, "m1", "2026-06-20T10:00:00Z"),
                ("claude-sonnet-4-20250514", 2000, 1000, "m2", "2026-06-21T10:00:00Z"),
            ],
        );
        let svc = UsageService::new(build_paths(&claude));
        let history = svc.get_history_only("p1", UsageWindow::OneMonth).unwrap();
        assert_eq!(history.len(), 2);
        assert_eq!(history[0].date, "2026-06-20");
    }
}