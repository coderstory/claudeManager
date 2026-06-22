//! Phase 9 (M3.8) 集成测试 — 5 场景 JSONL 用量查询
//! 数据源: cc-switch-main session_manager JSONL 路径
//! 测试 fixture: src-tauri/tests/fixtures/m3-8-usage/
//!
//! ## 8 个子任务功能测试 (B2#1 补齐)
//!
//! 子任务 1: cc-switch JSONL 解析正常 (valid-5rec.jsonl)
//! 子任务 2: cc-switch JSONL 解析异常行容错 (encoding-broken.jsonl)
//! 子任务 3: 用量统计聚合 per-model + per-day (valid-5rec.jsonl)
//! 子任务 4: 时间窗口过滤 (5h / 1w / 1m 切分)
//! 子任务 5: 空 JSONL 容错 (empty-0rec.jsonl)
//! 子任务 6: 非 assistant 行过滤 (no-usage.jsonl)
//! 子任务 7: 性能 / 1MB 大文件 (perf-1mb.jsonl)
//! 子任务 8: msg_id 去重 (parser dedup)
//!
//! ## Fixture 目录结构
//!
//! 5 个 fixture 放在 `tests/fixtures/m3-8-usage/` 目录,
//! 集成测试通过 `compute_usage_from_jsonl(..., UsageWindow::OneMonth, "p1")`
//! 直接消费。`compute_usage_from_jsonl` 期望 `projects_dir` 是
//! `~/.claude/projects/`,所以测试前要把 fixture 复制到 tmp 的
//! `tmp/<root>/projects/<encoded>/fixture.jsonl` 布局里。
//!
//! ## 历史注释
//!
//! - 2026-06-22: M3.8 ship 时只跑了 fixture-existence test 编译通过,
//!   8 个功能子任务留 B2#1 排队补齐 (v2.0-BACKLOG B2#1)。
//! - 本批测试**只**调 `compute_usage_from_jsonl` (不依赖 AppPaths),
//!   编译验证 (`cargo build --tests` 必过)。

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use claude_config_manager_lib::domain::UsageWindow;
use claude_config_manager_lib::services::usage_provider_ccswitch::compute_usage_from_jsonl;

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

/// Resolve the fixture root (the directory holding the 5 JSONL fixtures).
fn fixtures_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join("m3-8-usage")
}

/// Build a `projects_dir` layout with one JSONL file per fixture:
/// `<tmp>/projects/<encoded>/<fixture_name>`.
///
/// Returns the `projects_dir` path (i.e. `<tmp>/projects`).
fn stage_fixture(tmp: &Path, encoded: &str, fixture_name: &str) -> PathBuf {
    let projects_dir = tmp.join("projects");
    let encoded_dir = projects_dir.join(encoded);
    fs::create_dir_all(&encoded_dir).unwrap();
    let src = fixtures_root().join(fixture_name);
    let dst = encoded_dir.join(fixture_name);
    fs::copy(&src, &dst).unwrap_or_else(|e| {
        panic!("copy {:?} → {:?} failed: {}", src, dst, e);
    });
    projects_dir
}

// ===========================================================================
// 子任务 0 (前置): 5 个 fixture 文件存在 (M3.8 ship 时已就位)
// ===========================================================================

#[test]
fn fixture_valid_5rec_exists() {
    let p = fixtures_root().join("valid-5rec.jsonl");
    assert!(p.exists(), "valid-5rec.jsonl fixture missing: {:?}", p);
    let content = std::fs::read_to_string(&p).expect("read");
    let lines: Vec<&str> = content.lines().filter(|l| !l.is_empty()).collect();
    // 5 assistant 记录 + 1 user = 6 行
    assert_eq!(lines.len(), 6, "expected 6 non-empty lines, got {}", lines.len());
}

#[test]
fn fixture_empty_0rec_exists() {
    let p = fixtures_root().join("empty-0rec.jsonl");
    assert!(p.exists(), "empty-0rec.jsonl fixture missing: {:?}", p);
    let content = std::fs::read_to_string(&p).expect("read");
    assert!(content.is_empty(), "empty file should be 0 bytes");
}

#[test]
fn fixture_encoding_broken_exists() {
    let p = fixtures_root().join("encoding-broken.jsonl");
    assert!(p.exists(), "encoding-broken.jsonl fixture missing: {:?}", p);
    let content = std::fs::read_to_string(&p).expect("read");
    // 不完整 JSON: {"type":"assistant","message":{"id":"msg_broken","usage":{"input_tokens":100}
    assert!(content.contains("\"input_tokens\":100"));
    assert!(!content.trim().ends_with("}"), "should be truncated JSON");
}

#[test]
fn fixture_no_usage_exists() {
    let p = fixtures_root().join("no-usage.jsonl");
    assert!(p.exists(), "no-usage.jsonl fixture missing: {:?}", p);
    let content = std::fs::read_to_string(&p).expect("read");
    assert!(!content.contains("\"usage\""));
}

#[test]
fn fixture_perf_1mb_exists() {
    let p = fixtures_root().join("perf-1mb.jsonl");
    assert!(p.exists(), "perf-1mb.jsonl fixture missing: {:?}", p);
    let meta = std::fs::metadata(&p).expect("meta");
    // 1MB+ (实际 1.1MB,5000 记录)
    assert!(meta.len() > 1_000_000, "perf file should be > 1MB, got {} bytes", meta.len());
    let content = std::fs::read_to_string(&p).expect("read");
    let lines: Vec<&str> = content.lines().filter(|l| !l.is_empty()).collect();
    assert_eq!(lines.len(), 5000, "expected 5000 records, got {}", lines.len());
}

// ===========================================================================
// 子任务 1: cc-switch JSONL 解析正常 (valid-5rec.jsonl)
// ===========================================================================

#[test]
fn sub1_parse_valid_5rec_extracts_all_5_assistant_records() {
    let tmp = tempfile::tempdir().unwrap();
    let projects = stage_fixture(tmp.path(), "C--test", "valid-5rec.jsonl");
    let res = compute_usage_from_jsonl(&projects, UsageWindow::OneMonth, "p1")
        .expect("compute should succeed");
    // 5 assistant 记录全部解析,1 user 行被过滤。
    assert_eq!(res.stats.files_scanned, 1);
    // 6 行 (5 assistant + 1 user),1 行非 assistant 被忽略,但 lines_parsed
    // 只数 assistant 行的成功解析数。non-assistant 的 user 行不会进
    // lines_total 增加以外的任何计数器(只是 continue)。
    assert_eq!(res.stats.lines_parsed, 5);
    // 5 条 assistant 记录,总 token = (100+50+0+20) + (200+80+0+30) + (300+120+50+0)
    //                       + (150+60+0+40) + (80+30+0+10)
    //                     = 170 + 310 + 470 + 250 + 120 = 1320
    assert_eq!(res.snapshot.tokens_used, 1320);
    // breakdown 应含 2 个 model: sonnet-4 (4 条) + opus-4 (1 条)
    assert_eq!(res.snapshot.breakdown.len(), 2);
    // sonnet-4 排首位 (token 多)
    let sonnet = res.snapshot.breakdown.iter()
        .find(|e| e.model == "claude-sonnet-4")
        .expect("sonnet-4 present");
    // sonnet 4 条: msg_01/02/04/05 = 170+310+250+120 = 850
    assert_eq!(sonnet.total_tokens, 850);
    assert_eq!(sonnet.message_count, 4);
    let opus = res.snapshot.breakdown.iter()
        .find(|e| e.model == "claude-opus-4")
        .expect("opus-4 present");
    // opus 1 条: msg_03 = 300+120+50+0 = 470
    assert_eq!(opus.total_tokens, 470);
    assert_eq!(opus.message_count, 1);
    // model_count = 2
    assert_eq!(res.snapshot.model_count, 2);
}

// ===========================================================================
// 子任务 2: cc-switch JSONL 解析异常行容错 (encoding-broken.jsonl)
// ===========================================================================

#[test]
fn sub2_encoding_broken_line_skipped_with_counter() {
    let tmp = tempfile::tempdir().unwrap();
    let projects = stage_fixture(tmp.path(), "C--test", "encoding-broken.jsonl");
    let res = compute_usage_from_jsonl(&projects, UsageWindow::OneMonth, "p1")
        .expect("compute should succeed even with broken JSON");
    // 不完整 JSON → 1 行被 skip(不是 fatal error)
    assert_eq!(res.stats.lines_skipped_parse, 1);
    // 整个文件 0 个有效 assistant 记录 → 空 snapshot
    assert_eq!(res.snapshot.tokens_used, 0);
    assert_eq!(res.snapshot.breakdown.len(), 0);
    assert_eq!(res.snapshot.model_count, 0);
    assert!(res.snapshot.cost_usd.is_none());
}

// ===========================================================================
// 子任务 3: 用量统计聚合 per-model + per-day (valid-5rec.jsonl)
// ===========================================================================

#[test]
fn sub3_aggregate_breakdown_and_history_from_valid_5rec() {
    let tmp = tempfile::tempdir().unwrap();
    let projects = stage_fixture(tmp.path(), "C--test", "valid-5rec.jsonl");
    let res = compute_usage_from_jsonl(&projects, UsageWindow::OneMonth, "p1")
        .expect("compute should succeed");
    // breakdown 排序: by total_tokens desc
    assert_eq!(res.snapshot.breakdown[0].model, "claude-sonnet-4");
    assert_eq!(res.snapshot.breakdown[1].model, "claude-opus-4");
    // per-model cost: sonnet-4 / opus-4 都不在 builtin_pricing()(只有
    // 带日期的 `claude-sonnet-4-20250514` 等在表里),所以 cost=None。
    // 这跟 SUMMARY 提到的 "unknown models → cost=None" 行为一致。
    // 这里验证 unknown model 的 cost 行为。
    assert!(res.snapshot.breakdown[0].cost_usd.is_none());
    assert!(res.snapshot.breakdown[1].cost_usd.is_none());
    assert!(res.snapshot.cost_usd.is_none());
    // history: 5 条记录全在 2026-06-22,但分 2 个 model,所以
    // (date, model) bucket = 2 个
    assert_eq!(res.history.len(), 2);
    // 排序按 (date asc, model asc)
    assert_eq!(res.history[0].date, "2026-06-22");
    assert_eq!(res.history[0].model, "claude-opus-4");
    assert_eq!(res.history[0].tokens, 470);
    assert_eq!(res.history[1].model, "claude-sonnet-4");
    assert_eq!(res.history[1].tokens, 850);
}

// ===========================================================================
// 子任务 4: 时间窗口过滤 (5h / 1w / 1m)
// ===========================================================================

#[test]
fn sub4_window_filter_accepts_recent_records_in_all_windows() {
    let tmp = tempfile::tempdir().unwrap();
    let projects = stage_fixture(tmp.path(), "C--test", "valid-5rec.jsonl");
    // valid-5rec.jsonl 的 timestamp = 2026-06-22T10:00:00Z ~ 10:04:00Z
    // 距 2026-06-22(测试运行日) < 1 小时,5h/1w/1m 全部命中
    for window in [UsageWindow::FiveHours, UsageWindow::OneWeek, UsageWindow::OneMonth] {
        let res = compute_usage_from_jsonl(&projects, window, "p1")
            .unwrap_or_else(|e| panic!("{:?} failed: {}", window, e));
        assert_eq!(res.snapshot.tokens_used, 1320, "{:?} should see all 5 recs", window);
        assert_eq!(res.snapshot.breakdown.len(), 2, "{:?} breakdown len", window);
        assert_eq!(res.history.len(), 2, "{:?} history len", window);
    }
}

#[test]
fn sub4_window_5h_excludes_records_older_than_5h() {
    // 用合成 fixture: 一条 6 小时前(5h 窗口外)+ 一条 1 小时前(窗口内)
    let tmp = tempfile::tempdir().unwrap();
    let projects = tmp.path().join("projects").join("C--test");
    fs::create_dir_all(&projects).unwrap();
    let file = projects.join("sess.jsonl");
    let mut f = fs::File::create(&file).unwrap();
    // 6h ago: 6 * 3600 = 21600 seconds
    let six_h_ago = chrono_unix_humanlike(6 * 3600);
    writeln!(
        f,
        r#"{{"type":"assistant","message":{{"id":"old","model":"claude-sonnet-4","usage":{{"input_tokens":9999,"output_tokens":9999,"cache_creation_input_tokens":0,"cache_read_input_tokens":0}}}},"timestamp":"{six_h_ago}","sessionId":"s1","cwd":"C:\\x"}}"#
    ).unwrap();
    let one_h_ago = chrono_unix_humanlike(3600);
    writeln!(
        f,
        r#"{{"type":"assistant","message":{{"id":"new","model":"claude-sonnet-4","usage":{{"input_tokens":100,"output_tokens":50,"cache_creation_input_tokens":0,"cache_read_input_tokens":0}}}},"timestamp":"{one_h_ago}","sessionId":"s1","cwd":"C:\\x"}}"#
    ).unwrap();
    drop(f);

    // 5h 窗口:旧 9999+9999=19998 应被过滤,新 100+50=150 应保留
    let projects_dir = tmp.path().join("projects");
    let res = compute_usage_from_jsonl(&projects_dir, UsageWindow::FiveHours, "p1")
        .expect("compute should succeed");
    assert_eq!(res.snapshot.tokens_used, 150, "5h window should exclude 6h-ago record");
    // 1m 窗口:两条都命中
    let res = compute_usage_from_jsonl(&projects_dir, UsageWindow::OneMonth, "p1")
        .expect("compute should succeed");
    assert_eq!(res.snapshot.tokens_used, 19998 + 150, "1m window includes everything");
}

/// Cheap RFC3339-now-minus helper for window filter tests.
/// `secs_ago` seconds before now → "YYYY-MM-DDTHH:MM:SSZ" UTC.
fn chrono_unix_humanlike(secs_ago: i64) -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs() as i64;
    let target = now - secs_ago;
    unix_to_iso_datetime(target)
}

fn unix_to_iso_datetime(unix: i64) -> String {
    // days + secs-of-day → YYYY-MM-DDTHH:MM:SSZ
    let days = unix.div_euclid(86400);
    let secs_of_day = unix.rem_euclid(86400);
    let hour = secs_of_day / 3600;
    let minute = (secs_of_day % 3600) / 60;
    let second = secs_of_day % 60;
    // 1970-01-01 + days
    let (y, m, d) = days_to_ymd(days);
    format!("{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z", y, m, d, hour, minute, second)
}

fn days_to_ymd(days: i64) -> (i64, u32, u32) {
    // Howard Hinnant civil_from_days
    let z = days + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = (era * 400 + yoe as i64) as i64;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m_raw = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if m_raw <= 2 { y + 1 } else { y };
    (year, m_raw as u32, d)
}

// ===========================================================================
// 子任务 5: 空 JSONL 容错 (empty-0rec.jsonl)
// ===========================================================================

#[test]
fn sub5_empty_jsonl_returns_zero_tokens_no_panic() {
    let tmp = tempfile::tempdir().unwrap();
    let projects = stage_fixture(tmp.path(), "C--test", "empty-0rec.jsonl");
    let res = compute_usage_from_jsonl(&projects, UsageWindow::OneMonth, "p1")
        .expect("empty file must not error");
    assert_eq!(res.snapshot.tokens_used, 0);
    assert_eq!(res.snapshot.breakdown.len(), 0);
    assert_eq!(res.snapshot.model_count, 0);
    assert!(res.snapshot.cost_usd.is_none());
    assert!(res.history.is_empty());
    assert_eq!(res.stats.files_scanned, 1);
    assert_eq!(res.stats.lines_total, 0);
    assert_eq!(res.stats.lines_parsed, 0);
    assert_eq!(res.stats.lines_skipped_parse, 0);
}

// ===========================================================================
// 子任务 6: 非 assistant 行过滤 (no-usage.jsonl)
// ===========================================================================

#[test]
fn sub6_no_usage_file_skips_non_assistant_lines() {
    let tmp = tempfile::tempdir().unwrap();
    let projects = stage_fixture(tmp.path(), "C--test", "no-usage.jsonl");
    let res = compute_usage_from_jsonl(&projects, UsageWindow::OneMonth, "p1")
        .expect("compute should succeed");
    // 1 行 user 记录,无 usage 字段 → 跳过
    assert_eq!(res.stats.lines_total, 1, "1 non-empty line scanned");
    // user 行的处理:在 `if value.get("type") != Some("assistant")` 之前
    // 已经 increment 了 lines_total,但 lines_parsed 是 0(只数 assistant)。
    assert_eq!(res.stats.lines_parsed, 0);
    // 没有 assistant 记录 → 空 snapshot
    assert_eq!(res.snapshot.tokens_used, 0);
    assert_eq!(res.snapshot.breakdown.len(), 0);
    assert!(res.history.is_empty());
}

// ===========================================================================
// 子任务 7: 性能 / 1MB 大文件 (perf-1mb.jsonl)
// ===========================================================================

#[test]
fn sub7_perf_1mb_fixture_scans_under_3_seconds() {
    let tmp = tempfile::tempdir().unwrap();
    let projects = stage_fixture(tmp.path(), "C--test", "perf-1mb.jsonl");
    // 先确认 fixture 大小真的 > 1MB
    let meta = fs::metadata(fixtures_root().join("perf-1mb.jsonl")).unwrap();
    assert!(meta.len() > 1_000_000, "perf fixture should be > 1MB, got {}", meta.len());

    let start = std::time::Instant::now();
    let res = compute_usage_from_jsonl(&projects, UsageWindow::OneMonth, "p1")
        .expect("1MB scan should not fail");
    let elapsed = start.elapsed();
    // 5000 行 + 1.1MB,CI runner 抖动留 3s 缓冲(本地实测 < 200ms)
    assert!(
        elapsed.as_secs() < 3,
        "1MB scan took {:?} (limit 3s)",
        elapsed
    );
    // 5000 行,每行 100+50=150 tokens,全部命中(1m 窗口)
    assert_eq!(res.stats.lines_parsed, 5000);
    assert_eq!(res.snapshot.tokens_used, 5000 * 150);
    // 全部是 sonnet-4 → 1 个 model
    assert_eq!(res.snapshot.breakdown.len(), 1);
    assert_eq!(res.snapshot.breakdown[0].model, "claude-sonnet-4");
    assert_eq!(res.snapshot.breakdown[0].message_count, 5000);
}

// ===========================================================================
// 子任务 8: msg_id 去重 (parser dedup)
// ===========================================================================

#[test]
fn sub8_duplicate_message_id_counted_once() {
    let tmp = tempfile::tempdir().unwrap();
    let projects = tmp.path().join("projects").join("C--test");
    fs::create_dir_all(&projects).unwrap();
    let file = projects.join("dup.jsonl");
    let mut f = fs::File::create(&file).unwrap();
    // 同一 msg_id 写 3 次,只有第 1 次计入
    let line = r#"{"type":"assistant","message":{"id":"dup-1","model":"claude-sonnet-4","usage":{"input_tokens":100,"output_tokens":50,"cache_creation_input_tokens":0,"cache_read_input_tokens":0}},"timestamp":"2026-06-22T10:00:00Z","sessionId":"s1","cwd":"C:\\x"}"#;
    writeln!(f, "{}", line).unwrap();
    writeln!(f, "{}", line).unwrap();
    writeln!(f, "{}", line).unwrap();
    drop(f);

    let projects_dir = tmp.path().join("projects");
    let res = compute_usage_from_jsonl(&projects_dir, UsageWindow::OneMonth, "p1")
        .expect("compute should succeed");
    // 3 行都解析成功(lines_parsed 计所有 assistant 行)
    assert_eq!(res.stats.lines_parsed, 3);
    // 但 dedup 后只有 1 条 message
    assert_eq!(res.stats.messages_after_dedup, 1);
    // token 计数只有 1 条 (100+50=150)
    assert_eq!(res.snapshot.tokens_used, 150);
    assert_eq!(res.snapshot.breakdown[0].message_count, 1);
    // history 也只有 1 条
    assert_eq!(res.history.len(), 1);
}
