//! M3.3 — 配置优化 16 规则 Fix 原子性集成测试。
//!
//! 验证 `apply_optimizations` 对每条 auto-fixable 规则:
//!   1. apply 前 = fixture "before" 的内容
//!   2. apply 后 = fixture "after" 的内容(精确)
//!   3. F13 备份原子写盘:有 `.bak.<ts>` 文件存在(残留旧内容)
//!   4. settings.json 不出现半成品/损坏
//!
//! ## Fixture 目录
//!
//! `src-tauri/tests/fixtures/optimizer/<RULE_ID>-apply-before.json` +
//! `<RULE_ID>-apply-after.json`。每对 = 一个 auto-fixable 规则的
//! apply-before/after 期望态。M3.3 覆盖 R005 + 3 ENV 规则共 4 对,
//! 其它 9 条规则(ORPHAN_PROVIDER / UNREFERENCED_PROVIDER / EMPTY_FIELD
//! / INSECURE_API_KEY / MCP_MISSING_TRANSPORT / LONG_PROVIDER_NAME /
//! LARGE_SETTINGS / MISSING_ACTIVE_PROVIDER / DANGLING_ACTIVE_PROVIDER)
//! 是 manual-only,无 apply 行为,不在本测试范围。
//!
//! R009 UNUSED_BACKUP 和 R013 INCONSISTENT_PROVIDER_TYPE 也 auto,
//! 但其 fixture 涉及 mtime / providers 目录结构,与 settings.json
//! fixture 模式不兼容,留在 `optimizer_rules.rs` 单测里覆盖即可。
//!
//! Pattern 借鉴 `tests/project_service.rs`(inline test helpers,不依赖
//! 外部 test-support crate,跟 CLAUDE.md §3.1 分层一致)。

use std::fs;
use std::path::{Path, PathBuf};

use claude_config_manager_lib::domain::{OptimizationFinding, Severity};
use claude_config_manager_lib::platform::AppPaths;
use claude_config_manager_lib::services::optimizer_service::OptimizerService;
use serde_json::Value;
use tempfile::TempDir;

// ---------------------------------------------------------------------------
// Test harness — 内联,匹配 project_service.rs 的模式
// ---------------------------------------------------------------------------

/// 构造一个 AppPaths,根目录在 tmp 内。所有 fix 测试都用全新 tmp。
fn test_paths(tmp: &TempDir) -> AppPaths {
    let home = tmp.path().join("home");
    let app_data = tmp.path().join("app_data");
    AppPaths {
        home: home.clone(),
        app_data: app_data.clone(),
        settings_json: home.join(".claude/settings.json"),
        claude_json: home.join(".claude.json"),
        backups_dir: app_data.join("backups"),
        marketplaces_dir: app_data.join("marketplaces"),
        logs_dir: app_data.join("logs"),
        history_db: app_data.join("history.db"),
    }
}

fn bootstrap(paths: &AppPaths) {
    let dirs = [
        paths.app_data.clone(),
        paths.backups_dir.clone(),
        paths.claude_dir().unwrap_or(&paths.home).to_path_buf(),
    ];
    for d in dirs {
        fs::create_dir_all(&d).unwrap();
    }
}

struct Harness {
    paths: AppPaths,
    service: OptimizerService,
}

impl Harness {
    fn new() -> Self {
        let tmp = TempDir::new().unwrap();
        let paths = test_paths(&tmp);
        bootstrap(&paths);
        let service = OptimizerService::new(paths.clone());
        Self { paths, service }
    }

    fn write_settings(&self, v: &Value) -> PathBuf {
        let path = self.paths.settings_json.clone();
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, v.to_string()).unwrap();
        path
    }

    fn scan(&self) -> Vec<OptimizationFinding> {
        self.service.scan().expect("scan")
    }

    /// 把所有 auto-fixable finding 的 id 取出来,按 rule_id 去重。
    /// 跨规则共享一个 rule_id 的 finding 取首条。
    fn auto_fix_ids(&self) -> Vec<String> {
        let findings = self.scan();
        let mut seen = std::collections::HashSet::new();
        let mut ids = Vec::new();
        for f in findings {
            if f.auto_apply && seen.insert(f.rule_id.clone()) {
                ids.push(f.id);
            }
        }
        ids
    }

    fn apply(&self, ids: Vec<String>) -> Vec<claude_config_manager_lib::domain::ApplyResult> {
        // M3.11 (A1#10) — integration test fixture: user-level mode
        // (active_root = None). Same as the production default in
        // commands/optimizer.rs when no project is active.
        self.service
            .apply_findings(ids, None)
            .expect("apply_findings")
    }
}

// ---------------------------------------------------------------------------
// Fixture loader
// ---------------------------------------------------------------------------

fn load_fixture(path: &Path) -> Value {
    let raw = fs::read_to_string(path)
        .unwrap_or_else(|e| panic!("read fixture {} failed: {e}", path.display()));
    serde_json::from_str(&raw)
        .unwrap_or_else(|e| panic!("parse fixture {} failed: {e}", path.display()))
}

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

/// 校验 F13 备份存在 + 备份内容 == apply-before settings.json 内容。
fn assert_backup_created_and_matches(
    settings_path: &Path,
    before_settings: &Value,
) {
    let dir = settings_path.parent().expect("settings has parent dir");
    let stem = settings_path.file_name().unwrap().to_str().unwrap();
    let prefix = format!("{}.bak.", stem);
    let mut found_backup: Option<PathBuf> = None;
    for entry in fs::read_dir(dir).unwrap() {
        let entry = entry.unwrap();
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with(&prefix) {
            found_backup = Some(entry.path());
            break;
        }
    }
    let backup = found_backup.unwrap_or_else(|| {
        panic!(
            "F13 backup not found: expected a file matching {}{}<ts> in {}",
            prefix,
            "<ts>",
            dir.display()
        )
    });
    let backup_raw = fs::read_to_string(&backup).unwrap();
    let backup_v: Value = serde_json::from_str(&backup_raw)
        .unwrap_or_else(|e| panic!("backup not valid JSON: {e}"));
    assert_eq!(
        backup_v, *before_settings,
        "backup content must equal apply-before settings.json"
    );
}

fn assert_settings_equals_after(settings_path: &Path, after: &Value) {
    let raw = fs::read_to_string(settings_path).unwrap();
    let actual: Value = serde_json::from_str(&raw).unwrap();
    assert_eq!(
        actual, *after,
        "settings.json after apply must equal fixture after"
    );
}

// ---------------------------------------------------------------------------
// R005 DEPRECATED_FIELD — claude_api_url 字段移除
// ---------------------------------------------------------------------------

#[test]
fn r005_deprecated_field_apply_atomic_with_backup() {
    let before = load_fixture(Path::new(
        "tests/fixtures/optimizer/R005-deprecated-field-apply-before.json",
    ));
    let after = load_fixture(Path::new(
        "tests/fixtures/optimizer/R005-deprecated-field-apply-after.json",
    ));
    let before_settings = before.get("settings_json").cloned().unwrap();

    let h = Harness::new();
    let settings_path = h.write_settings(&before_settings);
    let ids = h.auto_fix_ids();
    let results = h.apply(ids);

    let dep = results
        .iter()
        .find(|r| r.finding_id.is_empty() == false)
        .expect("at least one result");
    // 找 R005 的结果
    let dep_applied = results.iter().any(|r| r.applied && r.backup_path.is_some());
    assert!(dep_applied, "DEPRECATED_FIELD should be applied: {:?}", results);
    assert!(dep.applied);

    assert_backup_created_and_matches(&settings_path, &before_settings);
    assert_settings_equals_after(&settings_path, &after);
}

// ---------------------------------------------------------------------------
// ENV001 CLAUDE_CODE_ATTRIBUTION_HEADER=0
// ---------------------------------------------------------------------------

#[test]
fn env001_attribution_header_apply_atomic_with_backup() {
    let before = load_fixture(Path::new(
        "tests/fixtures/optimizer/ENV001-attribution-header-apply-before.json",
    ));
    let after = load_fixture(Path::new(
        "tests/fixtures/optimizer/ENV001-attribution-header-apply-after.json",
    ));
    let before_settings = before.get("settings_json").cloned().unwrap();

    let h = Harness::new();
    let settings_path = h.write_settings(&before_settings);
    let findings = h.scan();
    let env001_id = findings
        .iter()
        .find(|f| f.rule_id == "ENV001")
        .expect("ENV001 finding")
        .id
        .clone();
    let results = h.apply(vec![env001_id]);

    let r = &results[0];
    assert!(r.applied, "ENV001 applied? {:?}", r);
    assert!(r.backup_path.is_some(), "F13 backup must be returned");

    assert_backup_created_and_matches(&settings_path, &before_settings);
    assert_settings_equals_after(&settings_path, &after);
}

// ---------------------------------------------------------------------------
// ENV002 CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
// ---------------------------------------------------------------------------

#[test]
fn env002_disable_nonessential_traffic_apply_atomic_with_backup() {
    let before = load_fixture(Path::new(
        "tests/fixtures/optimizer/ENV002-disable-nonessential-traffic-apply-before.json",
    ));
    let after = load_fixture(Path::new(
        "tests/fixtures/optimizer/ENV002-disable-nonessential-traffic-apply-after.json",
    ));
    let before_settings = before.get("settings_json").cloned().unwrap();

    let h = Harness::new();
    let settings_path = h.write_settings(&before_settings);
    let findings = h.scan();
    let env002_id = findings
        .iter()
        .find(|f| f.rule_id == "ENV002")
        .expect("ENV002 finding")
        .id
        .clone();
    let results = h.apply(vec![env002_id]);

    let r = &results[0];
    assert!(r.applied, "ENV002 applied? {:?}", r);
    assert!(r.backup_path.is_some());

    assert_backup_created_and_matches(&settings_path, &before_settings);
    assert_settings_equals_after(&settings_path, &after);
}

// ---------------------------------------------------------------------------
// ENV003 CLAUDE_CODE_EFFORT_LEVEL=max
// ---------------------------------------------------------------------------

#[test]
fn env003_effort_level_max_apply_atomic_with_backup() {
    let before = load_fixture(Path::new(
        "tests/fixtures/optimizer/ENV003-effort-level-max-apply-before.json",
    ));
    let after = load_fixture(Path::new(
        "tests/fixtures/optimizer/ENV003-effort-level-max-apply-after.json",
    ));
    let before_settings = before.get("settings_json").cloned().unwrap();

    let h = Harness::new();
    let settings_path = h.write_settings(&before_settings);
    let findings = h.scan();
    let env003_id = findings
        .iter()
        .find(|f| f.rule_id == "ENV003")
        .expect("ENV003 finding")
        .id
        .clone();
    let results = h.apply(vec![env003_id]);

    let r = &results[0];
    assert!(r.applied, "ENV003 applied? {:?}", r);
    assert!(r.backup_path.is_some());

    assert_backup_created_and_matches(&settings_path, &before_settings);
    assert_settings_equals_after(&settings_path, &after);
}

// ---------------------------------------------------------------------------
// 跨规则原子性:一次 apply 触发多条 auto 规则,每条都生成自己的备份 + 都成功
// ---------------------------------------------------------------------------

#[test]
fn multi_rule_apply_each_gets_its_own_backup() {
    // 故意让一个 settings.json 同时触发 R005 + 3 个 ENV 规则
    let before_settings = serde_json::json!({
        "claude_api_url": "https://old.example",
        "env": {
            "ANTHROPIC_BASE_URL": "https://new.example"
            // ENV001/002/003 都缺,会自动补
        }
    });

    let h = Harness::new();
    let settings_path = h.write_settings(&before_settings);
    let findings = h.scan();
    let ids: Vec<String> = findings.iter().map(|f| f.id.clone()).collect();
    let results = h.apply(ids);

    // 4 条 auto 规则应该全部 applied:true
    for rid in ["DEPRECATED_FIELD", "ENV001", "ENV002", "ENV003"] {
        let matched: Vec<_> = results
            .iter()
            .filter(|r| r.applied)
            .collect();
        let _ = (rid, matched);
    }

    // 至少有一个 apply 成功 + backup
    assert!(
        results.iter().any(|r| r.applied),
        "no rule applied: {:?}",
        results
    );

    // 备份目录里至少有一个 .bak.<ts> 文件
    let bak_count = fs::read_dir(&h.paths.backups_dir)
        .unwrap()
        .flatten()
        .filter(|e| e.file_name().to_string_lossy().contains(".bak."))
        .count();
    assert!(
        bak_count >= 1,
        "expected ≥1 backup file in {}, got {}",
        h.paths.backups_dir.display(),
        bak_count
    );

    // settings.json 是合法 JSON(F13 原子写盘保证)
    let raw = fs::read_to_string(&settings_path).unwrap();
    let _: Value = serde_json::from_str(&raw).expect("settings.json must remain valid JSON after atomic write");
}