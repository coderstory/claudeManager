//! Phase 9 (M3.8) 集成测试 — 5 场景 JSONL 用量查询
//! 数据源: cc-switch-main session_manager JSONL 路径
//! 测试 fixture: src-tauri/tests/fixtures/m3-8-usage/
//!
//! NOTE: Phase 9 状态 PENDING (见 .planning/phases/09-m38-usage/09-m38-usage-SUMMARY.md)
//! 此测试为"ready to wire" — 编译失败 (PENDING) 时不阻塞,仅作未来 Phase 9 ship 后的验证钩子

use std::path::PathBuf;

fn fixture_path(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join("m3-8-usage")
        .join(name)
}

#[test]
fn fixture_valid_5rec_exists() {
    let p = fixture_path("valid-5rec.jsonl");
    assert!(p.exists(), "valid-5rec.jsonl fixture missing: {:?}", p);
    let content = std::fs::read_to_string(&p).expect("read");
    let lines: Vec<&str> = content.lines().filter(|l| !l.is_empty()).collect();
    // 5 assistant 记录 + 1 user = 6 行
    assert_eq!(lines.len(), 6, "expected 6 non-empty lines, got {}", lines.len());
}

#[test]
fn fixture_empty_0rec_exists() {
    let p = fixture_path("empty-0rec.jsonl");
    assert!(p.exists(), "empty-0rec.jsonl fixture missing: {:?}", p);
    let content = std::fs::read_to_string(&p).expect("read");
    assert!(content.is_empty(), "empty file should be 0 bytes");
}

#[test]
fn fixture_encoding_broken_exists() {
    let p = fixture_path("encoding-broken.jsonl");
    assert!(p.exists(), "encoding-broken.jsonl fixture missing: {:?}", p);
    let content = std::fs::read_to_string(&p).expect("read");
    // 不完整 JSON: {"type":"assistant","message":{"id":"msg_broken","usage":{"input_tokens":100}
    assert!(content.contains("\"input_tokens\":100"));
    assert!(!content.trim().ends_with("}"), "should be truncated JSON");
}

#[test]
fn fixture_no_usage_exists() {
    let p = fixture_path("no-usage.jsonl");
    assert!(p.exists(), "no-usage.jsonl fixture missing: {:?}", p);
    let content = std::fs::read_to_string(&p).expect("read");
    assert!(!content.contains("\"usage\""));
}

#[test]
fn fixture_perf_1mb_exists() {
    let p = fixture_path("perf-1mb.jsonl");
    assert!(p.exists(), "perf-1mb.jsonl fixture missing: {:?}", p);
    let meta = std::fs::metadata(&p).expect("meta");
    // 1MB+ (实际 1.1MB,5000 记录)
    assert!(meta.len() > 1_000_000, "perf file should be > 1MB, got {} bytes", meta.len());
    let content = std::fs::read_to_string(&p).expect("read");
    let lines: Vec<&str> = content.lines().filter(|l| !l.is_empty()).collect();
    assert_eq!(lines.len(), 5000, "expected 5000 records, got {}", lines.len());
}
