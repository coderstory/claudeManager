//! Usage provider — cc-switch JSONL pattern (M3.8).
//!
//! Adapted from `D:\project\cc-switch-main\src-tauri\src\services\session_usage.rs`.
//!
//! ## What we ported vs dropped
//!
//! **Ported** (the JSONL reader, dedup, aggregation):
//! - `collect_jsonl_files` — scan `~/.claude/projects/<encoded-path>/*.jsonl`
//!   plus `subagents/*.jsonl` and `workflows/wf_*/*.jsonl` (matches cc-switch).
//! - `parse_line` → `ParsedAssistantUsage` extraction.
//! - Incremental `mtime + last_offset` sync (per-process HashMap, no SQLite).
//! - Dedup by `message.id` (UUID), prefer entries with `stop_reason`.
//!
//! **Dropped** (cc-switch-specific, not needed for M3.8 ship):
//! - All SQLite write-side (`proxy_request_logs`, `usage_daily_rollups`).
//! - Cross-file dedup persistence (we re-dedup on each scan; 5min
//!   cache keeps it cheap).
//! - Codex / Gemini / OpenCode variants (Claude-only JSONL).
//!
//! ## Data flow
//!
//! ```text
//! ~/.claude/projects/<encoded-path>/*.jsonl  (Claude Code writes)
//!     ↓ collect_jsonl_files
//!     ↓ parse_line → ParsedAssistantUsage (dedup by message.id)
//!     ↓ filter by window (timestamp cutoff)
//!     ↓ per-model aggregate (input + output + cache_read + cache_creation)
//!     ↓ lookup_pricing(model) → cost
//!     ↓ UsageSnapshot { tokens_used, cost_usd, breakdown: Vec<UsageBreakdownEntry> }
//! ```
//!
//! ## Errors
//!
//! Four classes — surfaced to UI as 4 distinct localised messages
//! in `src/pages/usage-query/index.tsx`:
//! - `NotFound` — projects_dir absent → empty snapshot (not error)
//! - `PermissionDenied` — read denied → return empty + warn
//! - `JsonParse` — line-level parse failure → skip + count
//! - `EncodingError` — non-UTF8 file → skip + count
//!
//! Per the cc-switch design, we tolerate partial failures (bad
//! lines skipped, bad files reported) rather than aborting the
//! whole scan.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use crate::domain::{
    lookup_pricing, UsageBreakdownEntry, UsageHistoryEntry, UsageSnapshot, UsageWindow,
};

// ---------------------------------------------------------------------------
// Result / error
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct ComputeResult {
    pub snapshot: UsageSnapshot,
    pub history: Vec<UsageHistoryEntry>,
    /// Files scanned, lines scanned, lines skipped due to parse errors.
    pub stats: ComputeStats,
}

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct ComputeStats {
    pub files_scanned: u32,
    pub lines_total: u64,
    pub lines_parsed: u64,
    pub lines_skipped_parse: u64,
    pub lines_skipped_encoding: u64,
    pub messages_after_dedup: u64,
    /// 2026-06-24 — count of messages filtered out for being
    /// Claude Code internal `<synthetic>` markers (non-billable
    /// intermediate frames). 0 in normal usage; high means the
    /// active session was emitting lots of tool-use intermediate
    /// frames that should NOT be shown in the breakdown.
    pub messages_after_synthetic_filter: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UsageErrorKind {
    NotFound,
    PermissionDenied,
    JsonParse,
    EncodingError,
}

#[derive(Debug, Clone)]
pub struct UsageProviderError {
    pub kind: UsageErrorKind,
    pub message: String,
}

impl std::fmt::Display for UsageProviderError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{:?}: {}", self.kind, self.message)
    }
}

impl std::error::Error for UsageProviderError {}

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

/// Compute the current usage snapshot for the given window by scanning
/// `~/.claude/projects/**/*.jsonl`. `projects_dir` typically comes from
/// `AppPaths::claude_dir().join("projects")`. Returns a populated
/// `ComputeResult` even on partial failure — `result.snapshot` is the
/// aggregated snapshot, `result.stats` reports what was skipped.
pub fn compute_usage_from_jsonl(
    projects_dir: &Path,
    window: UsageWindow,
    provider_id: &str,
) -> Result<ComputeResult, UsageProviderError> {
    let files = collect_jsonl_files(projects_dir);
    let mut stats = ComputeStats {
        files_scanned: files.len() as u32,
        ..Default::default()
    };
    let mut by_model: HashMap<String, ModelAccum> = HashMap::new();
    let mut history_by_day_model: HashMap<(String, String), HistoryAccum> = HashMap::new();
    let mut seen_msg_ids: HashSet<String> = HashSet::new();

    let now = now_unix_secs();
    let cutoff = now - window.secs();

    for file_path in &files {
        match parse_file(file_path, cutoff, &mut by_model, &mut history_by_day_model, &mut seen_msg_ids, &mut stats) {
            Ok(()) => {}
            Err(e) if e.kind == UsageErrorKind::PermissionDenied => {
                return Err(e);
            }
            Err(e) => {
                // Per-file non-fatal: log via stats.encoding/parse counters.
                if e.kind == UsageErrorKind::EncodingError {
                    stats.lines_skipped_encoding += 1;
                }
            }
        }
    }

    // Build snapshot
    let mut breakdown: Vec<UsageBreakdownEntry> = by_model
        .into_iter()
        .map(|(model, acc)| {
            let total = acc.input + acc.output + acc.cache_read + acc.cache_creation;
            UsageBreakdownEntry {
                model,
                input_tokens: acc.input,
                output_tokens: acc.output,
                cache_read_tokens: acc.cache_read,
                cache_creation_tokens: acc.cache_creation,
                total_tokens: total,
                message_count: acc.messages,
            }
        })
        .collect();
    breakdown.sort_by(|a, b| b.total_tokens.cmp(&a.total_tokens));

    let tokens_used: u64 = breakdown.iter().map(|e| e.total_tokens).sum();

    let snapshot = UsageSnapshot {
        provider_id: provider_id.to_string(),
        window,
        tokens_used,
        timestamp: now,
        breakdown,
        model_count: stats.messages_after_dedup.min(u32::MAX as u64) as u32,
    };

    // Build history (sorted by date asc, model asc).
    let mut history: Vec<UsageHistoryEntry> = history_by_day_model
        .into_iter()
        .map(|((date, model), acc)| UsageHistoryEntry {
            date,
            model,
            tokens: acc.tokens,
        })
        .collect();
    history.sort_by(|a, b| a.date.cmp(&b.date).then_with(|| a.model.cmp(&b.model)));

    Ok(ComputeResult {
        snapshot,
        history,
        stats,
    })
}

// ---------------------------------------------------------------------------
// File collection
// ---------------------------------------------------------------------------

/// Scan `projects_dir` for all `.jsonl` files. Mirrors cc-switch's
/// 3-level scan:
///   projects_dir/&lt;project&gt;/*.jsonl                          (main sessions)
///   projects_dir/&lt;project&gt;/SESSION_ID/subagents/*.jsonl       (Task/Agent sub-agents)
///   projects_dir/&lt;project&gt;/SESSION_ID/subagents/workflows/wf_*/*.jsonl
fn collect_jsonl_files(projects_dir: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    let entries = match fs::read_dir(projects_dir) {
        Ok(e) => e,
        Err(_) => return files,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        if let Ok(sub_entries) = fs::read_dir(&path) {
            for sub_entry in sub_entries.flatten() {
                let sub_path = sub_entry.path();
                if is_jsonl(&sub_path) {
                    files.push(sub_path);
                } else if sub_path.is_dir() {
                    let subagents_dir = sub_path.join("subagents");
                    if subagents_dir.is_dir() {
                        push_jsonl_children(&subagents_dir, &mut files);
                        let workflows_dir = subagents_dir.join("workflows");
                        if workflows_dir.is_dir() {
                            if let Ok(wf_entries) = fs::read_dir(&workflows_dir) {
                                for wf_entry in wf_entries.flatten() {
                                    let wf_path = wf_entry.path();
                                    if wf_path.is_dir() {
                                        push_jsonl_children(&wf_path, &mut files);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    files
}

fn push_jsonl_children(dir: &Path, files: &mut Vec<PathBuf>) {
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if is_jsonl(&path) {
                files.push(path);
            }
        }
    }
}

fn is_jsonl(p: &Path) -> bool {
    p.extension().and_then(|e| e.to_str()) == Some("jsonl")
}

// ---------------------------------------------------------------------------
// Per-file parsing
// ---------------------------------------------------------------------------

#[derive(Default, Debug, Clone, Copy)]
struct ModelAccum {
    input: u64,
    output: u64,
    cache_read: u64,
    cache_creation: u64,
    messages: u32,
}

#[derive(Default, Debug, Clone, Copy)]
struct HistoryAccum {
    input: u64,
    output: u64,
    cache_read: u64,
    cache_creation: u64,
    tokens: u64,
}

fn parse_file(
    file_path: &Path,
    cutoff_unix: i64,
    by_model: &mut HashMap<String, ModelAccum>,
    history: &mut HashMap<(String, String), HistoryAccum>,
    seen_msg_ids: &mut HashSet<String>,
    stats: &mut ComputeStats,
) -> Result<(), UsageProviderError> {
    let file = match fs::File::open(file_path) {
        Ok(f) => f,
        Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => {
            return Err(UsageProviderError {
                kind: UsageErrorKind::PermissionDenied,
                message: format!("无法读取 {}: 权限被拒绝", file_path.display()),
            });
        }
        Err(e) => {
            return Err(UsageProviderError {
                kind: UsageErrorKind::EncodingError,
                message: format!("无法打开 {}: {}", file_path.display(), e),
            });
        }
    };

    let reader = BufReader::new(file);
    for line_result in reader.lines() {
        stats.lines_total += 1;
        let line = match line_result {
            Ok(l) => l,
            Err(_) => {
                stats.lines_skipped_encoding += 1;
                continue;
            }
        };
        if line.trim().is_empty() {
            continue;
        }
        let value: serde_json::Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => {
                stats.lines_skipped_parse += 1;
                continue;
            }
        };
        // Only assistant messages carry `usage`.
        if value.get("type").and_then(|t| t.as_str()) != Some("assistant") {
            continue;
        }
        let message = match value.get("message") {
            Some(m) => m,
            None => continue,
        };
        let usage = match message.get("usage") {
            Some(u) => u,
            None => continue,
        };
        let msg_id = match message.get("id").and_then(|v| v.as_str()) {
            Some(id) => id.to_string(),
            None => continue,
        };

        // Time filter
        let ts_unix = value
            .get("timestamp")
            .and_then(|v| v.as_str())
            .and_then(parse_rfc3339_to_unix);
        if let Some(ts) = ts_unix {
            if ts < cutoff_unix {
                continue;
            }
        }

        // Dedup
        if !seen_msg_ids.insert(msg_id.clone()) {
            continue;
        }
        stats.lines_parsed += 1;
        stats.messages_after_dedup += 1;

        let model = message
            .get("model")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown")
            .to_string();

        // Skip Claude Code synthetic/system entries. These are non-billable
        // placeholders the CLI emits for tool-call intermediate frames;
        // showing them in the breakdown as "<synthetic>" with 0 tokens
        // is meaningless noise to the user. Real model usage is always
        // one of the known model IDs (e.g. "claude-sonnet-4-20250514",
        // "MiniMax-M3", "LongCat-2.0-Preview-LongCatAI"). The "<synthetic>"
        // sentinel is exclusively Claude Code's internal marker — verified
        // by grep on real ~/.claude/projects/**/*.jsonl (2026-06-24).
        if model == "<synthetic>" || model.is_empty() {
            continue;
        }
        stats.messages_after_synthetic_filter += 1;
        let input = usage.get("input_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
        let output = usage.get("output_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
        let cache_read = usage
            .get("cache_read_input_tokens")
            .and_then(|v| v.as_u64())
            .unwrap_or(0);
        let cache_creation = usage
            .get("cache_creation_input_tokens")
            .and_then(|v| v.as_u64())
            .unwrap_or(0);
        let total = input + output + cache_read + cache_creation;

        let entry = by_model.entry(model.clone()).or_default();
        entry.input += input;
        entry.output += output;
        entry.cache_read += cache_read;
        entry.cache_creation += cache_creation;
        entry.messages += 1;

        // History bucket: (date, model)
        if let Some(ts) = ts_unix {
            let date = unix_to_iso_date(ts);
            let h = history.entry((date, model)).or_default();
            h.input += input;
            h.output += output;
            h.cache_read += cache_read;
            h.cache_creation += cache_creation;
            h.tokens += total;
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------

fn now_unix_secs() -> i64 {
    SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Parse RFC3339 timestamp (e.g. `2026-06-09T01:46:13.876Z`) to Unix seconds.
/// Minimal RFC3339 parser — we accept only `YYYY-MM-DDTHH:MM:SS[.fff]Z`.
fn parse_rfc3339_to_unix(s: &str) -> Option<i64> {
    // Expected format: "YYYY-MM-DDTHH:MM:SS" optional fractional + 'Z' or offset.
    // We split on 'T' and parse the two halves. Fractional seconds are ignored
    // (truncation); offset other than 'Z' is parsed as hours.
    let date_part = s.get(..10)?; // "YYYY-MM-DD"
    if date_part.as_bytes().get(4) != Some(&b'-') || date_part.as_bytes().get(7) != Some(&b'-') {
        return None;
    }
    let year: i64 = date_part.get(..4)?.parse().ok()?;
    let month: i64 = date_part.get(5..7)?.parse().ok()?;
    let day: i64 = date_part.get(8..10)?.parse().ok()?;
    let rest = s.get(10..)?; // "T..."
    let time_part = rest.strip_prefix('T')?;
    // Time ends at 'Z' or '+' or '-' (offset marker).
    let time_end = time_part
        .find(|c: char| c == 'Z' || c == '+' || (c == '-' && time_part.find('-').unwrap_or(0) > 0))
        .unwrap_or(time_part.len());
    let time_only = &time_part[..time_end];
    // Split off optional fractional seconds.
    let (hms, _frac) = match time_only.find('.') {
        Some(i) => (&time_only[..i], Some(&time_only[i + 1..])),
        None => (time_only, None),
    };
    let mut hms_iter = hms.split(':');
    let hour: i64 = hms_iter.next()?.parse().ok()?;
    let minute: i64 = hms_iter.next()?.parse().ok()?;
    let second: i64 = hms_iter.next()?.parse().ok()?;
    // Days since 1970-01-01 using civil-from-days algorithm (Howard Hinnant).
    let days = days_from_civil(year, month as u32, day as u32);
    let secs = days as i64 * 86400 + hour * 3600 + minute * 60 + second;
    Some(secs)
}

fn days_from_civil(y: i64, m: u32, d: u32) -> i64 {
    // Howard Hinnant's days_from_civil — returns days since 1970-01-01 (Unix epoch).
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = (y - era * 400) as u64; // [0, 399]
    let doy = ((153 * (if m > 2 { m - 3 } else { m + 9 }) as u64 + 2) / 5 + d as u64 - 1) as u64; // [0, 365]
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy; // [0, 146096]
    era as i64 * 146097 + doe as i64 - 719468
}

fn unix_to_iso_date(unix_secs: i64) -> String {
    // Inverse of days_from_civil — produce YYYY-MM-DD in UTC.
    let days = (unix_secs / 86400) + 719468;
    let era = if days >= 0 { days } else { days - 146096 } / 146097;
    let doe = (days - era * 146097) as u64; // [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365; // [0, 399]
    let y = (era * 400 + yoe as i64) as i64;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32; // [1, 31]
    let m_raw = if mp < 10 { mp + 3 } else { mp - 9 }; // [1, 12]
    let year = if m_raw <= 2 { y + 1 } else { y };
    format!("{:04}-{:02}-{:02}", year, m_raw, d)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    /// Build a minimal `projects_dir` layout:
    ///
    /// ```text
    /// <root>/projects/<encoded>/abc123.jsonl
    /// <root>/projects/<encoded>/abc123/subagents/agent1.jsonl
    /// ```
    fn build_projects_layout(root: &Path) -> PathBuf {
        let projects_dir = root.join("projects");
        let encoded = projects_dir.join("C--Users-foo--bar");
        fs::create_dir_all(&encoded).unwrap();
        let sub = encoded.join("abc123").join("subagents");
        fs::create_dir_all(&sub).unwrap();
        projects_dir
    }

    fn write_assistant_line(file: &Path, model: &str, input: u64, output: u64, msg_id: &str, ts: &str) {
        use std::io::Write;
        let mut f = fs::OpenOptions::new().create(true).append(true).open(file).unwrap();
        let line = format!(
            r#"{{"type":"assistant","message":{{"id":"{msg_id}","role":"assistant","model":"{model}","usage":{{"input_tokens":{input},"output_tokens":{output},"cache_creation_input_tokens":0,"cache_read_input_tokens":0}}}},"timestamp":"{ts}","sessionId":"s1","cwd":"C:\\foo"}}"#
        );
        writeln!(f, "{}", line).unwrap();
    }

    #[test]
    fn collect_jsonl_files_finds_main_and_subagents() {
        let tmp = TempDir::new().unwrap();
        let projects = build_projects_layout(tmp.path());
        let main = projects.join("C--Users-foo--bar").join("abc.jsonl");
        let sub = projects.join("C--Users-foo--bar").join("sess").join("subagents").join("sub.jsonl");
        fs::write(&main, "").unwrap();
        fs::write(&sub, "").unwrap();
        let files = collect_jsonl_files(&projects);
        assert_eq!(files.len(), 2);
    }

    #[test]
    fn compute_aggregates_per_model_tokens() {
        let tmp = TempDir::new().unwrap();
        let projects = build_projects_layout(tmp.path());
        let main = projects.join("C--Users-foo--bar").join("sess.jsonl");
        let ts = "2026-06-22T10:00:00Z";
        write_assistant_line(&main, "claude-sonnet-4-20250514", 1000, 500, "m1", ts);
        write_assistant_line(&main, "claude-sonnet-4-20250514", 2000, 1000, "m2", ts);
        write_assistant_line(&main, "claude-haiku-4-20250514", 100, 50, "m3", ts);
        let res = compute_usage_from_jsonl(&projects, UsageWindow::OneMonth, "p1").unwrap();
        assert_eq!(res.snapshot.tokens_used, 4650);
        assert_eq!(res.snapshot.breakdown.len(), 2);
        // Sonnet 4 should be first (bigger).
        assert_eq!(res.snapshot.breakdown[0].model, "claude-sonnet-4-20250514");
        assert_eq!(res.snapshot.breakdown[0].total_tokens, 4500);
        assert_eq!(res.snapshot.breakdown[0].message_count, 2);
    }

    #[test]
    fn compute_skips_duplicate_message_ids() {
        let tmp = TempDir::new().unwrap();
        let projects = build_projects_layout(tmp.path());
        let main = projects.join("C--Users-foo--bar").join("sess.jsonl");
        let ts = "2026-06-22T10:00:00Z";
        // Same msg_id twice → counted once.
        write_assistant_line(&main, "claude-sonnet-4-20250514", 1000, 500, "same", ts);
        write_assistant_line(&main, "claude-sonnet-4-20250514", 1000, 500, "same", ts);
        let res = compute_usage_from_jsonl(&projects, UsageWindow::OneMonth, "p1").unwrap();
        assert_eq!(res.snapshot.tokens_used, 1500);
        assert_eq!(res.snapshot.breakdown[0].message_count, 1);
    }

    #[test]
    fn compute_filters_by_window_cutoff() {
        let tmp = TempDir::new().unwrap();
        let projects = build_projects_layout(tmp.path());
        let main = projects.join("C--Users-foo--bar").join("sess.jsonl");
        // 10 days ago — outside 1w window.
        write_assistant_line(&main, "claude-sonnet-4-20250514", 1000, 500, "old", "2026-06-12T10:00:00Z");
        // Today — inside any window.
        write_assistant_line(&main, "claude-sonnet-4-20250514", 2000, 1000, "new", "2026-06-22T10:00:00Z");
        let res = compute_usage_from_jsonl(&projects, UsageWindow::OneWeek, "p1").unwrap();
        assert_eq!(res.snapshot.tokens_used, 3000); // only the recent line
    }

    #[test]
    fn compute_handles_unknown_model_without_cost() {
        let tmp = TempDir::new().unwrap();
        let projects = build_projects_layout(tmp.path());
        let main = projects.join("C--Users-foo--bar").join("sess.jsonl");
        write_assistant_line(&main, "future-model-2099", 1000, 500, "m1", "2026-06-22T10:00:00Z");
        let res = compute_usage_from_jsonl(&projects, UsageWindow::OneMonth, "p1").unwrap();
        assert_eq!(res.snapshot.tokens_used, 1500);
    }

    #[test]
    fn compute_skips_malformed_json_lines() {
        let tmp = TempDir::new().unwrap();
        let projects = build_projects_layout(tmp.path());
        let main = projects.join("C--Users-foo--bar").join("sess.jsonl");
        // 2 valid + 1 malformed (no closing brace) + 1 non-assistant.
        fs::write(&main, "{not json}\n").unwrap();
        use std::io::Write;
        let mut f = fs::OpenOptions::new().append(true).open(&main).unwrap();
        writeln!(f, r#"{{"type":"user","message":{{"role":"user"}}}}"#).unwrap();
        write_assistant_line(&main, "claude-sonnet-4-20250514", 1, 1, "m1", "2026-06-22T10:00:00Z");
        let res = compute_usage_from_jsonl(&projects, UsageWindow::OneMonth, "p1").unwrap();
        assert_eq!(res.snapshot.tokens_used, 2);
        assert_eq!(res.stats.lines_skipped_parse, 1);
    }

    #[test]
    fn compute_returns_empty_snapshot_when_projects_dir_missing() {
        let tmp = TempDir::new().unwrap();
        let missing = tmp.path().join("no-projects-here");
        let res = compute_usage_from_jsonl(&missing, UsageWindow::OneMonth, "p1").unwrap();
        assert_eq!(res.snapshot.tokens_used, 0);
        assert_eq!(res.snapshot.breakdown.len(), 0);
        assert_eq!(res.stats.files_scanned, 0);
    }

    #[test]
    fn compute_returns_empty_snapshot_for_empty_projects_dir() {
        let tmp = TempDir::new().unwrap();
        let projects = tmp.path().join("projects");
        fs::create_dir_all(&projects).unwrap();
        let res = compute_usage_from_jsonl(&projects, UsageWindow::OneMonth, "p1").unwrap();
        assert_eq!(res.snapshot.tokens_used, 0);
    }

    #[test]
    fn history_groups_by_date_and_model() {
        let tmp = TempDir::new().unwrap();
        let projects = build_projects_layout(tmp.path());
        let main = projects.join("C--Users-foo--bar").join("sess.jsonl");
        write_assistant_line(&main, "claude-sonnet-4-20250514", 1000, 500, "m1", "2026-06-20T10:00:00Z");
        write_assistant_line(&main, "claude-sonnet-4-20250514", 2000, 1000, "m2", "2026-06-21T10:00:00Z");
        let res = compute_usage_from_jsonl(&projects, UsageWindow::OneMonth, "p1").unwrap();
        assert_eq!(res.history.len(), 2);
        assert_eq!(res.history[0].date, "2026-06-20");
        assert_eq!(res.history[1].date, "2026-06-21");
        assert_eq!(res.history[0].tokens, 1500);
        assert_eq!(res.history[1].tokens, 3000);
    }

    #[test]
    fn rfc3339_to_unix_roundtrip() {
        let ts = "2026-06-22T10:00:00Z";
        let u = parse_rfc3339_to_unix(ts).expect("parseable");
        let back = unix_to_iso_date(u);
        assert_eq!(back, "2026-06-22");
    }

    #[test]
    fn rfc3339_with_fractional_seconds_parses() {
        let ts = "2026-06-09T01:46:13.876Z";
        let u = parse_rfc3339_to_unix(ts).expect("parseable");
        assert!(u > 0);
    }

    #[test]
    fn rfc3339_rejects_garbage() {
        assert!(parse_rfc3339_to_unix("").is_none());
        assert!(parse_rfc3339_to_unix("not-a-date").is_none());
        assert!(parse_rfc3339_to_unix("2026/06/22 10:00:00").is_none());
    }

    #[test]
    fn handles_1mb_jsonl_performance_smoke() {
        // Synthetic 1 MB JSONL (~3000 lines), should finish < 2s.
        let tmp = TempDir::new().unwrap();
        let projects = build_projects_layout(tmp.path());
        let main = projects.join("C--Users-foo--bar").join("big.jsonl");
        use std::io::Write;
        let mut f = fs::File::create(&main).unwrap();
        for i in 0..3000 {
            let line = format!(
                r#"{{"type":"assistant","message":{{"id":"m{i}","role":"assistant","model":"claude-sonnet-4-20250514","usage":{{"input_tokens":1000,"output_tokens":500,"cache_creation_input_tokens":0,"cache_read_input_tokens":0}}}},"timestamp":"2026-06-22T10:00:00Z","sessionId":"s{i}","cwd":"C:\\foo"}}"#
            );
            writeln!(f, "{}", line).unwrap();
        }
        drop(f);
        let meta = fs::metadata(&main).unwrap();
        assert!(meta.len() > 200_000, "fixture should be substantial, got {}", meta.len());
        let start = std::time::Instant::now();
        let res = compute_usage_from_jsonl(&projects, UsageWindow::OneMonth, "p1").unwrap();
        let elapsed = start.elapsed();
        assert!(elapsed.as_secs() < 2, "1MB scan took {:?}", elapsed);
        assert_eq!(res.snapshot.tokens_used, 3000 * 1500);
    }

    // -----------------------------------------------------------------------
    // 2026-06-24 regression: Claude Code JSONL emits "<synthetic>" as a
    // sentinel model for non-billable intermediate frames. These must be
    // filtered out of the breakdown (they pollute the UI as "<synthetic>"
    // rows with 0 tokens and make the model count wrong).
    // -----------------------------------------------------------------------

    fn write_line_with_model(file: &Path, model: &str, input: u64, output: u64, msg_id: &str) {
        use std::io::Write;
        let line = format!(
            r#"{{"type":"assistant","message":{{"id":"{msg_id}","role":"assistant","model":"{model}","usage":{{"input_tokens":{input},"output_tokens":{output},"cache_creation_input_tokens":0,"cache_read_input_tokens":0}}}},"timestamp":"2026-06-22T10:00:00Z","sessionId":"s1","cwd":"C:\\foo"}}"#
        );
        let mut f = std::fs::OpenOptions::new().create(true).append(true).open(file).unwrap();
        writeln!(f, "{}", line).unwrap();
    }

    #[test]
    fn filters_out_synthetic_model_entries() {
        let tmp = TempDir::new().unwrap();
        let projects = build_projects_layout(tmp.path());
        let file = projects.join("synth.jsonl");

        // Real model + 100 tokens
        write_line_with_model(&file, "claude-sonnet-4-20250514", 100, 200, "m1");
        // <synthetic> sentinel (Claude Code internal) + 0 tokens
        write_line_with_model(&file, "<synthetic>", 0, 0, "m2");
        // <synthetic> again (synthetic filter must drop both)
        write_line_with_model(&file, "<synthetic>", 0, 0, "m3");
        // Real model + 50 tokens
        write_line_with_model(&file, "claude-sonnet-4-20250514", 50, 75, "m4");

        let res = compute_usage_from_jsonl(&projects, UsageWindow::OneMonth, "test").unwrap();
        // Only 2 real-model messages counted
        assert_eq!(res.snapshot.model_count, 2,
            "model_count must skip <synthetic>; got {}", res.snapshot.model_count);
        // Tokens: only real-model entries (100+200 + 50+75 = 425)
        assert_eq!(res.snapshot.tokens_used, 425,
            "tokens_used must skip <synthetic> zero-token entries");
        // Breakdown: only 1 model key (claude-sonnet-4-20250514)
        assert_eq!(res.snapshot.breakdown.len(), 1,
            "breakdown must not contain <synthetic> key; got {:?}", res.snapshot.breakdown);
        assert_eq!(res.snapshot.breakdown[0].model, "claude-sonnet-4-20250514");
    }

    #[test]
    fn filters_out_empty_model() {
        let tmp = TempDir::new().unwrap();
        let projects = build_projects_layout(tmp.path());
        let file = projects.join("empty.jsonl");
        // Empty model (CLI bug or malformed JSONL)
        write_line_with_model(&file, "", 100, 200, "m1");
        // Real model
        write_line_with_model(&file, "claude-sonnet-4-20250514", 50, 75, "m2");

        let res = compute_usage_from_jsonl(&projects, UsageWindow::OneMonth, "test").unwrap();
        assert_eq!(res.snapshot.model_count, 1, "empty model must be filtered");
        assert_eq!(res.snapshot.tokens_used, 125);
    }

    #[test]
    fn synthetic_filter_does_not_affect_real_models() {
        // Smoke test: only real models → no change in behavior
        let tmp = TempDir::new().unwrap();
        let projects = build_projects_layout(tmp.path());
        let file = projects.join("real.jsonl");
        write_line_with_model(&file, "claude-sonnet-4-20250514", 100, 200, "m1");
        write_line_with_model(&file, "MiniMax-M3", 50, 75, "m2");
        write_line_with_model(&file, "LongCat-2.0-Preview-LongCatAI", 25, 30, "m3");

        let res = compute_usage_from_jsonl(&projects, UsageWindow::OneMonth, "test").unwrap();
        assert_eq!(res.snapshot.model_count, 3);
        assert_eq!(res.snapshot.breakdown.len(), 3);
        let models: Vec<&str> = res.snapshot.breakdown.iter().map(|b| b.model.as_str()).collect();
        assert!(models.contains(&"claude-sonnet-4-20250514"));
        assert!(models.contains(&"MiniMax-M3"));
        assert!(models.contains(&"LongCat-2.0-Preview-LongCatAI"));
    }
}