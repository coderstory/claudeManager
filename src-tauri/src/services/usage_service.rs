//! UsageService — F7 (用量查询) business logic for M2.7.
//!
//! Reads the active provider's token usage from `~/.claude/usage.json`
//! (written by Claude Code itself) and caches it in-memory for 5
//! minutes per (provider, window) key.
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
//!     3. cache miss → 读 ~/.claude/usage.json（本地 Claude Code 写的）
//!     4. 返回 UsageSnapshot { tokensUsed, costUsd, balance, timestamp }
//!   → UI 渲染数字 + sparkline 趋势
//!
//! 点 "刷新" → 清 cache + 重 invoke
//! 切时间窗 → 重新 invoke（cache 可能 miss if different window）
//! ```
//!
//! ## Stub mode (M2.7)
//!
//! External provider APIs (Anthropic usage API / OpenAI billing /
//! etc.) are M2.8+. M2.7 only reads `~/.claude/usage.json`. If the
//! file is missing or the active window's field is absent, the
//! service returns a `UsageSnapshot::empty` so the page renders
//! with zeros and a friendly "无数据" message instead of an error.
//!
//! ## Cache policy
//!
//! - Key: `(provider_id, window)` — when the user switches
//!   providers, the old key naturally expires (different provider).
//! - TTL: 5 minutes (CLAUDE.md §3.3 → F7 requirement).
//! - `refresh(window)` drops the cache entry and re-reads.
//! - Invalidation on provider switch: the page always re-invokes
//!   `get_current_usage` after a switch (via the `currentProviderId`
//!   prop / store) so the new provider's snapshot is fetched even
//!   if the cache key collides.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde_json::Value;
use thiserror::Error;

use crate::domain::{UsageSnapshot, UsageWindow};
use crate::platform::AppPaths;

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

#[derive(Debug, Error)]
pub enum UsageError {
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("invalid JSON in usage.json: {0}")]
    Json(#[from] serde_json::Error),

    #[error("unknown window: {0}")]
    UnknownWindow(String),

    #[error("usage.json path could not be resolved from AppPaths")]
    PathUnresolved,
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/// Business logic for F7 (用量查询). Owns the in-memory 5-minute cache.
pub struct UsageService {
    paths: AppPaths,
    /// Resolved at construction: `<claude_dir>/usage.json`.
    usage_json_path: PathBuf,
    /// Cached snapshot per (provider_id, window) key.
    cache: Mutex<HashMap<String, CacheEntry>>,
    /// Cache TTL. M2.7 default = 5 minutes. Tests can construct
    /// with a smaller TTL via [`UsageService::with_ttl`].
    ttl: Duration,
}

#[derive(Debug, Clone)]
struct CacheEntry {
    snapshot: UsageSnapshot,
    stored_at: Instant,
}

impl UsageService {
    pub fn new(paths: AppPaths) -> Self {
        let usage_json_path = paths
            .claude_dir()
            .map(|p| p.join("usage.json"))
            .unwrap_or_else(|| PathBuf::from("usage.json"));
        Self {
            paths,
            usage_json_path,
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

    /// Path to the on-disk usage.json file (read-only).
    #[allow(dead_code)]
    pub fn usage_json_path(&self) -> &std::path::Path {
        &self.usage_json_path
    }

    /// Current TTL (read-only).
    #[allow(dead_code)]
    pub fn ttl(&self) -> Duration {
        self.ttl
    }

    // -----------------------------------------------------------------------
    // Public API
    // -----------------------------------------------------------------------

    /// Return the cached snapshot for `(provider_id, window)` if
    /// fresh; otherwise re-read usage.json and refresh the cache.
    ///
    /// Errors only on truly exceptional conditions (path resolution
    /// + I/O + JSON parse of the file if it exists). Missing file or
    /// missing window field → empty snapshot (not an error).
    pub fn get_usage(
        &self,
        provider_id: &str,
        window: UsageWindow,
    ) -> Result<UsageSnapshot, UsageError> {
        let key = cache_key(provider_id, window);
        // Cache hit + fresh?
        if let Some(entry) = self.cache.lock().unwrap().get(&key).cloned() {
            if entry.stored_at.elapsed() < self.ttl {
                return Ok(entry.snapshot);
            }
        }
        // Cache miss or expired — re-read.
        let snap = self.read_local_usage_json(provider_id, window)?;
        self.cache.lock().unwrap().insert(
            key,
            CacheEntry {
                snapshot: snap.clone(),
                stored_at: Instant::now(),
            },
        );
        Ok(snap)
    }

    /// Drop the cache entry for `(provider_id, window)` and re-read.
    pub fn refresh(
        &self,
        provider_id: &str,
        window: UsageWindow,
    ) -> Result<UsageSnapshot, UsageError> {
        let key = cache_key(provider_id, window);
        self.cache.lock().unwrap().remove(&key);
        self.get_usage(provider_id, window)
    }

    // -----------------------------------------------------------------------
    // Internal
    // -----------------------------------------------------------------------

    /// Read `~/.claude/usage.json` and extract the snapshot for the
    /// given window. Missing file or missing field → empty snapshot.
    fn read_local_usage_json(
        &self,
        provider_id: &str,
        window: UsageWindow,
    ) -> Result<UsageSnapshot, UsageError> {
        if self.usage_json_path.as_os_str().is_empty() {
            return Err(UsageError::PathUnresolved);
        }
        let raw = match std::fs::read_to_string(&self.usage_json_path) {
            Ok(s) => s,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                return Ok(UsageSnapshot::empty(provider_id, window));
            }
            Err(e) => return Err(UsageError::Io(e)),
        };
        if raw.trim().is_empty() {
            return Ok(UsageSnapshot::empty(provider_id, window));
        }
        let v: Value = serde_json::from_str(&raw)?;

        // usage.json shape (Claude Code native, M2.7 contract):
        //   {
        //     "providers": {
        //       "<provider_id>": {
        //         "5h":  { "tokens_used": 12345, "cost_usd": 0.12 },
        //         "1w":  { "tokens_used": 67890, "cost_usd": 1.23 },
        //         "1m":  { "tokens_used": 234567, "cost_usd": 4.56,
        //                  "balance_usd": 99.44 }
        //       }
        //     }
        //   }
        //
        // If the file's root shape doesn't match, or the active
        // provider isn't present, return empty. We deliberately do
        // NOT return an error — Claude Code may not have written
        // the file yet (fresh install / new provider).
        let bucket = v
            .get("providers")
            .and_then(|p| p.get(provider_id))
            .and_then(|p| p.get(window.as_str()));
        let bucket = match bucket {
            Some(b) if b.is_object() => b,
            _ => return Ok(UsageSnapshot::empty(provider_id, window)),
        };
        let tokens_used = bucket
            .get("tokens_used")
            .and_then(|v| v.as_u64())
            .unwrap_or(0);
        let cost_usd = bucket.get("cost_usd").and_then(|v| v.as_f64());
        let balance_usd = bucket.get("balance_usd").and_then(|v| v.as_f64());
        let timestamp = bucket
            .get("timestamp")
            .and_then(|v| v.as_i64())
            .unwrap_or_else(now_unix_secs);
        Ok(UsageSnapshot {
            provider_id: provider_id.to_string(),
            window,
            tokens_used,
            cost_usd,
            balance_usd,
            timestamp,
        })
    }
}

/// Compose the cache key from `(provider_id, window)`. The provider
/// id is sanitised (whitespace stripped) so equivalent keys collide.
fn cache_key(provider_id: &str, window: UsageWindow) -> String {
    format!("{}::{}", provider_id.trim(), window.as_str())
}

/// Cheap Unix-seconds-now. Mirrors `domain::usage::now_unix_secs` —
/// kept separate so the service module doesn't depend on a private
/// helper from the domain crate.
fn now_unix_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    use std::fs;
    use tempfile::TempDir;

    /// Build an `AppPaths` snapshot pointing at `tmp/claude/` for the
    /// usage.json file. Other paths are placeholders — the service
    /// only reads `claude_dir/usage.json`.
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

    #[test]
    fn get_usage_cache_miss_reads_file() {
        let tmp = TempDir::new().unwrap();
        let claude = tmp.path().join("claude");
        fs::create_dir_all(&claude).unwrap();
        let usage = claude.join("usage.json");
        fs::write(
            &usage,
            r#"{"providers":{"p1":{"5h":{"tokens_used":42,"cost_usd":1.5}}}}"#,
        )
        .unwrap();
        let svc = UsageService::new(build_paths(&claude));

        let snap = svc.get_usage("p1", UsageWindow::FiveHours).unwrap();
        assert_eq!(snap.provider_id, "p1");
        assert_eq!(snap.window, UsageWindow::FiveHours);
        assert_eq!(snap.tokens_used, 42);
        assert_eq!(snap.cost_usd, Some(1.5));
    }

    #[test]
    fn get_usage_cache_hit_returns_cached() {
        let tmp = TempDir::new().unwrap();
        let claude = tmp.path().join("claude");
        fs::create_dir_all(&claude).unwrap();
        fs::write(
            claude.join("usage.json"),
            r#"{"providers":{"p1":{"5h":{"tokens_used":1}}}}"#,
        )
        .unwrap();
        let svc = UsageService::new(build_paths(&claude));

        let s1 = svc.get_usage("p1", UsageWindow::FiveHours).unwrap();
        // Mutate the on-disk file. If we re-read from disk, tokens
        // would change. But cache must return the original.
        fs::write(
            claude.join("usage.json"),
            r#"{"providers":{"p1":{"5h":{"tokens_used":999}}}}"#,
        )
        .unwrap();
        let s2 = svc.get_usage("p1", UsageWindow::FiveHours).unwrap();
        assert_eq!(s1.tokens_used, s2.tokens_used);
        assert_eq!(s1.timestamp, s2.timestamp);
    }

    #[test]
    fn get_usage_cache_expired_rereads_file() {
        let tmp = TempDir::new().unwrap();
        let claude = tmp.path().join("claude");
        fs::create_dir_all(&claude).unwrap();
        fs::write(
            claude.join("usage.json"),
            r#"{"providers":{"p1":{"5h":{"tokens_used":1}}}}"#,
        )
        .unwrap();
        // 1-second TTL so we can sleep past it cheaply.
        let svc = UsageService::with_ttl(build_paths(&claude), Duration::from_secs(1));

        let s1 = svc.get_usage("p1", UsageWindow::FiveHours).unwrap();
        assert_eq!(s1.tokens_used, 1);
        // Bump file.
        fs::write(
            claude.join("usage.json"),
            r#"{"providers":{"p1":{"5h":{"tokens_used":2}}}}"#,
        )
        .unwrap();
        // Within TTL — cache wins.
        let s2 = svc.get_usage("p1", UsageWindow::FiveHours).unwrap();
        assert_eq!(s2.tokens_used, 1);
        // Past TTL — re-read.
        std::thread::sleep(Duration::from_millis(1100));
        let s3 = svc.get_usage("p1", UsageWindow::FiveHours).unwrap();
        assert_eq!(s3.tokens_used, 2);
    }

    #[test]
    fn refresh_clears_cache() {
        let tmp = TempDir::new().unwrap();
        let claude = tmp.path().join("claude");
        fs::create_dir_all(&claude).unwrap();
        fs::write(
            claude.join("usage.json"),
            r#"{"providers":{"p1":{"5h":{"tokens_used":10}}}}"#,
        )
        .unwrap();
        let svc = UsageService::with_ttl(build_paths(&claude), Duration::from_secs(60));

        let s1 = svc.get_usage("p1", UsageWindow::FiveHours).unwrap();
        assert_eq!(s1.tokens_used, 10);
        // Bump file + refresh.
        fs::write(
            claude.join("usage.json"),
            r#"{"providers":{"p1":{"5h":{"tokens_used":20}}}}"#,
        )
        .unwrap();
        let s2 = svc.refresh("p1", UsageWindow::FiveHours).unwrap();
        assert_eq!(s2.tokens_used, 20);
    }

    #[test]
    fn read_local_usage_json_missing_returns_default() {
        let tmp = TempDir::new().unwrap();
        let claude = tmp.path().join("claude");
        fs::create_dir_all(&claude).unwrap();
        // No usage.json at all.
        let svc = UsageService::new(build_paths(&claude));

        let snap = svc.get_usage("p1", UsageWindow::FiveHours).unwrap();
        assert_eq!(snap.provider_id, "p1");
        assert_eq!(snap.tokens_used, 0);
        assert!(snap.cost_usd.is_none());
        assert!(snap.balance_usd.is_none());
        assert!(snap.timestamp > 0);
    }

    #[test]
    fn read_local_usage_json_parses_correctly() {
        let tmp = TempDir::new().unwrap();
        let claude = tmp.path().join("claude");
        fs::create_dir_all(&claude).unwrap();
        fs::write(
            claude.join("usage.json"),
            r#"{
                "providers": {
                    "p1": {
                        "5h": {"tokens_used": 100, "cost_usd": 0.5},
                        "1w": {"tokens_used": 200, "cost_usd": 1.0, "balance_usd": 99.0},
                        "1m": {"tokens_used": 300}
                    },
                    "p2": {
                        "5h": {"tokens_used": 999}
                    }
                }
            }"#,
        )
        .unwrap();
        let svc = UsageService::new(build_paths(&claude));

        let s_5h = svc.get_usage("p1", UsageWindow::FiveHours).unwrap();
        assert_eq!(s_5h.tokens_used, 100);
        assert_eq!(s_5h.cost_usd, Some(0.5));
        assert!(s_5h.balance_usd.is_none());

        let s_1w = svc.get_usage("p1", UsageWindow::OneWeek).unwrap();
        assert_eq!(s_1w.tokens_used, 200);
        assert_eq!(s_1w.cost_usd, Some(1.0));
        assert_eq!(s_1w.balance_usd, Some(99.0));

        let s_1m = svc.get_usage("p1", UsageWindow::OneMonth).unwrap();
        assert_eq!(s_1m.tokens_used, 300);
        assert!(s_1m.cost_usd.is_none());

        // p2 has only 5h; asking for 1w returns empty.
        let s_p2_1w = svc.get_usage("p2", UsageWindow::OneWeek).unwrap();
        assert_eq!(s_p2_1w.tokens_used, 0);
    }

    #[test]
    fn cache_keys_isolated_per_provider_and_window() {
        let tmp = TempDir::new().unwrap();
        let claude = tmp.path().join("claude");
        fs::create_dir_all(&claude).unwrap();
        fs::write(
            claude.join("usage.json"),
            r#"{"providers":{"p1":{"5h":{"tokens_used":10},"1w":{"tokens_used":20}}}}"#,
        )
        .unwrap();
        let svc = UsageService::with_ttl(build_paths(&claude), Duration::from_secs(60));

        // p1 5h and p1 1w must be cached independently.
        let a = svc.get_usage("p1", UsageWindow::FiveHours).unwrap();
        let b = svc.get_usage("p1", UsageWindow::OneWeek).unwrap();
        assert_eq!(a.tokens_used, 10);
        assert_eq!(b.tokens_used, 20);
        assert_ne!(a.window, b.window);

        // Mutate both. Cache must still serve the original.
        fs::write(
            claude.join("usage.json"),
            r#"{"providers":{"p1":{"5h":{"tokens_used":11},"1w":{"tokens_used":21}}}}"#,
        )
        .unwrap();
        let a2 = svc.get_usage("p1", UsageWindow::FiveHours).unwrap();
        let b2 = svc.get_usage("p1", UsageWindow::OneWeek).unwrap();
        assert_eq!(a2.tokens_used, 10);
        assert_eq!(b2.tokens_used, 20);
    }
}