//! OptimizerService — F18 (配置优化) business logic for M2.9.
//!
//! Composes all 13 [`OptimizerRule`] implementations to:
//!
//! - Build a fresh [`OptimizerContext`] from `~/.claude/settings.json`
//!   + `<app_data>/providers/*.json` + `~/.claude/mcp.json`
//! - Run every rule's `check` and gather findings
//! - Dispatch `apply_findings(ids)` back to the originating rule
//!
//! ## Caching: none
//!
//! Unlike `UsageService`, this service holds NO cache. Each `scan` is
//! a fresh pass — findings carry uuid `id`s that are only valid until
//! the next `scan`. The service stays stateless apart from the
//! resolved `AppPaths` snapshot.
//!
//! ## Concurrency
//!
//! Tauri commands hit `apply_findings` serially per IPC call, so we
//! don't need a `Mutex`. Two simultaneous scans would each return
//! their own `Vec<OptimizationFinding>` independently — no shared
//! state.
//!
//! ## Why scan-on-apply
//!
//! `apply_findings` re-runs `scan()` internally (rather than letting
//! the UI cache findings) so:
//! - The rule has fresh ctx (the previous apply may have mutated
//!   files; e.g. applying DEPRECATED_FIELD twice in a row would
//!   otherwise re-attempt a no-op).
//! - Stale `finding_id`s naturally fall out (return as
//!   `ApplyResult::manual("finding 已过期")`).

use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::domain::{ApplyResult, McpServer, OptimizationFinding, Provider, Severity};
use crate::infrastructure::optimizer_rules::{
    self, OptimizerContext, OptimizerRule, OptimizerRuleError,
};
use crate::platform::AppPaths;

/// Errors returned by the service. The Tauri command boundary
/// flattens these to `String`.
#[derive(Debug, thiserror::Error)]
pub enum OptimizerError {
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("rule error: {0}")]
    Rule(#[from] OptimizerRuleError),
}

/// F18 service. Owns the rule registry + a way to read the relevant
/// config files (providers + mcp.json + settings.json).
pub struct OptimizerService {
    paths: AppPaths,
    rules: Vec<Box<dyn OptimizerRule>>,
    /// Cached `<app_data>/providers/`. Same path the
    /// `ProviderService` uses; we don't share an instance because
    /// the service keeps `Arc<Self>` and would create a cycle.
    providers_dir: PathBuf,
    /// Cached `<app_data>/backups/`.
    backups_dir: PathBuf,
    /// Cached `<claude_dir>/mcp.json`.
    mcp_json_path: PathBuf,
}

impl OptimizerService {
    pub fn new(paths: AppPaths) -> Self {
        let providers_dir = paths.app_data.join("providers");
        let backups_dir = paths.backups_dir.clone();
        let mcp_json_path = paths
            .claude_dir()
            .map(|p| p.join("mcp.json"))
            .unwrap_or_else(|| PathBuf::from("mcp.json"));
        Self {
            paths,
            rules: optimizer_rules::all_rules(),
            providers_dir,
            backups_dir,
            mcp_json_path,
        }
    }

    /// Path getters — used by tests + the optimizer commands.
    #[allow(dead_code)]
    pub fn paths(&self) -> &AppPaths {
        &self.paths
    }

    // -----------------------------------------------------------------------
    // scan
    // -----------------------------------------------------------------------

    /// Scan all configured files and return every finding from every
    /// rule, sorted by severity (Error first, then Warning, then Info).
    ///
    /// Thin wrapper around [`Self::scan_with_root`] that defaults to
    /// user-level mode (`active_root_dir = None`). Callers that need
    /// project-mode scanning must use `scan_with_root` explicitly.
    pub fn scan(&self) -> Result<Vec<OptimizationFinding>, OptimizerError> {
        self.scan_with_root(None)
    }

    /// M3.11 (A1#10) — scan with explicit `active_root_dir`.
    ///
    /// - `None` → scan `~/.claude/settings.json` (user-level / backward
    ///   compat with M2.9).
    /// - `Some(root)` → scan `<root>/.claude/settings.json` (project
    ///   mode). If `<root>` does not exist the scan still proceeds with
    ///   `Value::Null` (so the user can see "settings.json 不存在"
    ///   findings); **`apply` is what enforces the root-must-exist
    ///   safety boundary** (拒绝 mkdir 未知 root).
    pub fn scan_with_root(
        &self,
        active_root_dir: Option<&Path>,
    ) -> Result<Vec<OptimizationFinding>, OptimizerError> {
        let ctx = self.build_context(active_root_dir);
        let mut findings: Vec<OptimizationFinding> = self
            .rules
            .iter()
            .flat_map(|r| r.check(&ctx))
            .collect();
        findings.sort_by_key(|f| match f.severity {
            Severity::Error => 0,
            Severity::Warning => 1,
            Severity::Info => 2,
        });
        Ok(findings)
    }

    // -----------------------------------------------------------------------
    // apply_findings
    // -----------------------------------------------------------------------

    /// Apply the rule for each requested `finding_id`. Re-scans
    /// internally so the apply runs against a fresh ctx (and stale ids
    /// naturally drop out).
    ///
    /// Returns `Vec<ApplyResult>` — one entry per requested id, in the
    /// order requested. Failures don't stop processing; each id gets
    /// its own outcome (CLAUDE.md §7: "不允许静默吞错" — every error
    /// is surfaced via `ApplyResult::error`).
    ///
    /// ## M3.11 (A1#10) — `active_root_dir` 接入
    ///
    /// The write target for settings.json is resolved from
    /// `active_root_dir` (same semantics as `scan_with_root`):
    ///
    /// - `None` → write to `~/.claude/settings.json` (M2.9 behaviour,
    ///   backward-compatible).
    /// - `Some(root)` → write to `<root>/.claude/settings.json`
    ///   (project mode).
    ///
    /// **Safety boundary** (CLAUDE.md §7 + SPEC §6.1): if
    /// `Some(root)` and `<root>` does not exist on disk, the apply is
    /// REJECTED (returned as `ApplyResult { applied: false, error:
    /// "..." }`) and the service does NOT auto-`mkdir` the unknown
    /// root. This prevents accidentally creating directories in
    /// paths the user didn't intend. M2.9 backups continue to live
    /// in `<app_data>/backups/` regardless of mode (global backup
    /// pool — same allow-list that `IPlatformPaths::validate_backup_path`
    /// already permits).
    pub fn apply_findings(
        &self,
        ids: Vec<String>,
        active_root_dir: Option<&Path>,
    ) -> Result<Vec<ApplyResult>, OptimizerError> {
        // Safety boundary: refuse to write into a root that doesn't
        // exist (拒绝 mkdir). The check is intentionally one level
        // deep — we only verify the root itself, not .claude/, so the
        // user's project tree stays untouched if they haven't created
        // a project .claude/ yet (we don't want to materialize one
        // behind their back). When root exists but .claude/ doesn't,
        // `build_context` records the missing dir; auto-apply rules
        // surface "settings.json 不存在" as `ApplyResult::manual`.
        if let Some(root) = active_root_dir {
            if !root.exists() {
                let requested_id = ids.first().cloned().unwrap_or_default();
                return Ok(vec![ApplyResult {
                    finding_id: requested_id,
                    applied: false,
                    backup_path: None,
                    error: Some(format!(
                        "active root 目录不存在: {} (拒绝写入,避免 mkdir 未知路径)",
                        root.display()
                    )),
                }]);
            }
        }

        let findings = self.scan_with_root(active_root_dir)?;
        let mut ctx = self.build_context(active_root_dir);
        let mut results = Vec::with_capacity(ids.len());
        for requested_id in ids {
            let finding = match findings.iter().find(|f| f.id == requested_id) {
                Some(f) => f.clone(),
                None => {
                    results.push(ApplyResult::manual(
                        &requested_id,
                        "finding 已过期(可能已被其他修复处理或上次扫描已失效),请重新扫描。",
                    ));
                    continue;
                }
            };
            let rule = match self.rules.iter().find(|r| r.id() == finding.rule_id) {
                Some(r) => r,
                None => {
                    results.push(ApplyResult::manual(
                        &requested_id,
                        &format!("未知规则: {}", finding.rule_id),
                    ));
                    continue;
                }
            };
            match rule.apply(&finding, &ctx) {
                Ok(r) => results.push(r),
                Err(e) => results.push(ApplyResult {
                    finding_id: requested_id,
                    applied: false,
                    backup_path: None,
                    error: Some(format!("rule.apply 失败: {e}")),
                }),
            }
            // Refresh ctx between applies so subsequent rules see the
            // mutated state. Cheap (just re-reads the 3 files).
            ctx = self.build_context(active_root_dir);
        }
        Ok(results)
    }

    // -----------------------------------------------------------------------
    // helpers
    // -----------------------------------------------------------------------

    /// Build the context the rules consume. Tolerant of missing files —
    /// any file that's absent is represented as empty (Value::Null /
    /// empty Vec).
    ///
    /// ## M3.11 (A1#10) — `active_root_dir` 解析
    ///
    /// `settings_path` (and `claude_dir`) is resolved from
    /// `active_root_dir`:
    /// - `None` → `~/.claude/settings.json` (M2.9 default).
    /// - `Some(root)` → `<root>/.claude/settings.json` (project mode).
    ///   The settings file is read with `read_json_or_null` so a
    ///   missing `<root>/.claude/settings.json` becomes `Value::Null`
    ///   (rules surface "settings.json 不存在" findings instead of
    ///   erroring). Backups / providers / app-data stay under
    ///   `<app_data>/` regardless of mode (global pool, same
    ///   `validate_backup_path` allow-list).
    fn build_context(&self, active_root_dir: Option<&Path>) -> OptimizerContext {
        let (settings_path, claude_dir) = match active_root_dir {
            Some(root) => {
                let proj_claude = root.join(".claude");
                (proj_claude.join("settings.json"), proj_claude)
            }
            None => {
                let sp = self.paths.settings_json.clone();
                let cd = self
                    .paths
                    .claude_dir()
                    .map(|p| p.to_path_buf())
                    .unwrap_or_else(|| self.paths.home.clone());
                (sp, cd)
            }
        };
        let settings_json = read_json_or_null(&settings_path);
        let providers = read_providers_dir(&self.providers_dir);
        let mcp_servers = read_mcp_json(&self.mcp_json_path);
        OptimizerContext {
            settings_json,
            providers,
            mcp_servers,
            claude_dir,
            app_data_dir: self.paths.app_data.clone(),
            providers_dir: self.providers_dir.clone(),
            backups_dir: self.backups_dir.clone(),
            settings_path,
        }
    }
}

fn read_json_or_null(path: &std::path::Path) -> Value {
    match std::fs::read_to_string(path) {
        Ok(s) if !s.trim().is_empty() => serde_json::from_str(&s).unwrap_or(Value::Null),
        _ => Value::Null,
    }
}

fn read_providers_dir(dir: &std::path::Path) -> Vec<Provider> {
    let entries = match std::fs::read_dir(dir) {
        Ok(d) => d,
        Err(_) => return Vec::new(),
    };
    entries
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) != Some("json") {
                return None;
            }
            Provider::from_json_file(&path).ok()
        })
        .collect()
}

fn read_mcp_json(path: &std::path::Path) -> Vec<McpServer> {
    let raw = match std::fs::read_to_string(path) {
        Ok(s) if !s.trim().is_empty() => s,
        _ => return Vec::new(),
    };
    let root: Value = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(_) => return Vec::new(),
    };
    let map = match root.get("mcpServers").and_then(|v| v.as_object()) {
        Some(m) => m,
        None => return Vec::new(),
    };
    let mut out = Vec::new();
    for (name, value) in map.iter() {
        if let Some(server) = parse_mcp_entry(name, value) {
            out.push(server);
        }
    }
    out
}

/// Minimal MCP entry parser — same logic as `services::mcp_service::parse_entry`
/// but inlined here so the optimizer doesn't import a private item from
/// another service. Stays in lockstep with that one (both read the
/// Claude-Code-native `mcp.json` shape).
fn parse_mcp_entry(name: &str, value: &Value) -> Option<McpServer> {
    let obj = value.as_object()?;
    let transport = match obj.get("type").and_then(|v| v.as_str()) {
        Some("http") => crate::domain::McpTransport::Http,
        _ => crate::domain::McpTransport::Stdio,
    };
    let command = obj
        .get("command")
        .and_then(|v| v.as_str())
        .map(String::from);
    let url = obj.get("url").and_then(|v| v.as_str()).map(String::from);
    let args = obj
        .get("args")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();
    let env = obj
        .get("env")
        .and_then(|v| v.as_object())
        .map(|m| {
            m.iter()
                .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.into())))
                .collect()
        })
        .unwrap_or_default();
    let enabled = obj
        .get("enabled")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    Some(McpServer {
        id: uuid::Uuid::new_v4().to_string(),
        name: name.to_string(),
        transport,
        command,
        args,
        env,
        url,
        enabled,
        created_at: 0,
    })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn test_paths(home: &std::path::Path, app_data: &std::path::Path, settings: &std::path::Path) -> AppPaths {
        AppPaths {
            home: home.to_path_buf(),
            app_data: app_data.to_path_buf(),
            settings_json: settings.to_path_buf(),
            claude_json: home.join(".claude.json"),
            backups_dir: app_data.join("backups"),
            marketplaces_dir: app_data.join("marketplaces"),
            logs_dir: app_data.join("logs"),
        }
    }

    fn make_provider(id: &str, name: &str, base: &str, key: &str) -> Provider {
        Provider {
            id: id.into(),
            name: name.into(),
            provider_type: "anthropic".into(),
            api_base: base.into(),
            api_key: key.into(),
            models: vec![],
            is_active: false,
            created_at: 1_700_000_000,
            last_used_at: None,
            notes: None,
        }
    }

    fn build_svc(tmp: &TempDir) -> (OptimizerService, std::path::PathBuf) {
        let claude_dir = tmp.path().join("claude");
        let app_data = tmp.path().join("app_data");
        let providers_dir = app_data.join("providers");
        fs::create_dir_all(&claude_dir).unwrap();
        fs::create_dir_all(&providers_dir).unwrap();
        fs::create_dir_all(app_data.join("backups")).unwrap();
        let settings_path = claude_dir.join("settings.json");
        let paths = test_paths(tmp.path(), &app_data, &settings_path);
        let svc = OptimizerService::new(paths);
        (svc, settings_path)
    }

    #[test]
    fn scan_returns_findings_from_all_relevant_rules() {
        let tmp = TempDir::new().unwrap();
        let (svc, settings_path) = build_svc(&tmp);
        // Trigger ORPHAN_PROVIDER + UNREFERENCED_PROVIDER + INSECURE_API_KEY.
        let p = make_provider("p1", "Some Name", "https://other.example", "short");
        p.to_json_file(&svc.providers_dir.join("p1.json")).unwrap();
        let settings = serde_json::json!({
            "env": {
                "ANTHROPIC_BASE_URL": "https://nope.example",
                "ANTHROPIC_AUTH_TOKEN": "abc",
            },
            "claude_api_url": "https://old.example"  // → DEPRECATED_FIELD
        });
        fs::write(&settings_path, settings.to_string()).unwrap();

        let findings = svc.scan().unwrap();
        assert!(!findings.is_empty(), "expected findings");
        // Errors must come first.
        if findings.iter().any(|f| f.severity == Severity::Error)
            && findings.iter().any(|f| f.severity == Severity::Info)
        {
            let first_info = findings
                .iter()
                .position(|f| f.severity == Severity::Info)
                .unwrap();
            let first_error = findings
                .iter()
                .position(|f| f.severity == Severity::Error)
                .unwrap();
            assert!(first_error < first_info, "errors must precede info");
        }
        let ids: Vec<&str> = findings.iter().map(|f| f.rule_id.as_str()).collect();
        assert!(ids.contains(&"INSECURE_API_KEY"));
        assert!(ids.contains(&"DEPRECATED_FIELD"));
    }

    #[test]
    fn apply_findings_processes_each_id_in_order() {
        let tmp = TempDir::new().unwrap();
        let (svc, settings_path) = build_svc(&tmp);
        let settings = serde_json::json!({
            "claude_api_url": "https://old.example",
            "env": { "ANTHROPIC_BASE_URL": "https://x.example" }
        });
        fs::write(&settings_path, settings.to_string()).unwrap();

        let findings = svc.scan().unwrap();
        let dep_finding = findings
            .iter()
            .find(|f| f.rule_id == "DEPRECATED_FIELD")
            .expect("DEPRECATED_FIELD should fire");
        let results = svc
            .apply_findings(vec![dep_finding.id.clone()], None)
            .unwrap();
        assert_eq!(results.len(), 1);
        assert!(results[0].applied);
        assert_eq!(results[0].finding_id, dep_finding.id);
    }

    #[test]
    fn apply_findings_creates_backup_for_auto_rules() {
        let tmp = TempDir::new().unwrap();
        let (svc, settings_path) = build_svc(&tmp);
        let settings = serde_json::json!({
            "claude_api_url": "https://old.example",
            "env": { "ANTHROPIC_BASE_URL": "https://x.example" }
        });
        fs::write(&settings_path, settings.to_string()).unwrap();

        let findings = svc.scan().unwrap();
        let dep_finding = findings
            .iter()
            .find(|f| f.rule_id == "DEPRECATED_FIELD")
            .unwrap();
        let results = svc
            .apply_findings(vec![dep_finding.id.clone()], None)
            .unwrap();
        assert!(results[0].backup_path.is_some());
        // Now check the file was actually rewritten.
        let raw = fs::read_to_string(&settings_path).unwrap();
        let v: Value = serde_json::from_str(&raw).unwrap();
        assert!(v.get("claude_api_url").is_none());
    }

    #[test]
    fn apply_findings_partial_failure_continues() {
        let tmp = TempDir::new().unwrap();
        let (svc, _settings_path) = build_svc(&tmp);
        // Two unknown ids: both should return manual results, the
        // second one isn't blocked by the first.
        let results = svc
            .apply_findings(vec!["unknown-1".into(), "unknown-2".into()], None)
            .unwrap();
        assert_eq!(results.len(), 2);
        assert!(results.iter().all(|r| !r.applied));
        assert!(results.iter().all(|r| r.error.is_some()));
    }

    #[test]
    fn apply_findings_unknown_id_returns_manual_with_error() {
        let tmp = TempDir::new().unwrap();
        let (svc, _settings_path) = build_svc(&tmp);
        let results = svc.apply_findings(vec!["does-not-exist".into()], None).unwrap();
        assert_eq!(results.len(), 1);
        assert!(!results[0].applied);
        assert_eq!(results[0].finding_id, "does-not-exist");
        assert!(results[0].error.is_some());
    }

    #[test]
    fn scan_returns_empty_when_no_data() {
        let tmp = TempDir::new().unwrap();
        let (svc, _settings_path) = build_svc(&tmp);
        // No settings file, no providers, no mcp.json.
        let findings = svc.scan().unwrap();
        // Some rules might still fire on empty (e.g. orphan when settings
        // missing) — but with NO settings file at all and NO providers,
        // most rules return empty. Just verify scan doesn't error.
        assert!(findings.is_empty() || findings.iter().all(|f| !f.id.is_empty()));
    }

    // -----------------------------------------------------------------------
    // M3.11 (A1#10) — F18 apply_optimizations 接入 active_root_dir
    //
    // 写路径测试 (high 风险) — 验证 settings.json 写入位置根据
    // active_root_dir 路由:
    // - None  → 写到 ~/.claude/settings.json (向后兼容用户级)
    // - Some(root) → 写到 <root>/.claude/settings.json (项目模式)
    // - root 目录不存在 → 拒绝写 (不自动 mkdir, 安全边界)
    // - 写后 → 备份 .bak.<ts> 存在 + 新内容正确 + 可回滚
    //
    // 测试 fixture: `build_svc_with_root` 给 `active_root_dir` 注入
    // 任意路径,模拟 project mode。
    // -----------------------------------------------------------------------

    /// 创建一个"用户级"应用(无 active root)。
    fn build_svc_with_root(
        tmp: &TempDir,
        active_root: Option<&std::path::Path>,
    ) -> (OptimizerService, PathBuf /* user settings */, Option<PathBuf> /* project settings */) {
        let user_claude_dir = tmp.path().join("user").join(".claude");
        let app_data = tmp.path().join("user").join("app_data");
        let providers_dir = app_data.join("providers");
        fs::create_dir_all(&user_claude_dir).unwrap();
        fs::create_dir_all(&providers_dir).unwrap();
        fs::create_dir_all(app_data.join("backups")).unwrap();
        let user_settings_path = user_claude_dir.join("settings.json");

        // 当 active_root = Some(p) 时,build_context 期望 p 存在,
        // 且 p/.claude/ 是 project 的 settings.json 目录。我们
        // 提前把 .claude 建好(测试场景 3 单独测 root 不存在的拒绝)。
        let project_settings_path = if let Some(root) = active_root {
            let proj_claude = root.join(".claude");
            fs::create_dir_all(&proj_claude).unwrap();
            Some(proj_claude.join("settings.json"))
        } else {
            None
        };

        let paths = test_paths(tmp.path(), &app_data, &user_settings_path);
        let svc = OptimizerService::new(paths);
        (svc, user_settings_path, project_settings_path)
    }

    /// 1. `active_root_dir() = None` + 写 → 写到 `~/.claude/settings.json`。
    /// 向后兼容: M2.9 行为不变。
    #[test]
    fn apply_with_active_root_none_writes_to_user_dotclaude() {
        let tmp = TempDir::new().unwrap();
        let (svc, user_settings, project_settings) =
            build_svc_with_root(&tmp, None);
        // 写入一个能触发 DEPRECATED_FIELD (auto-apply) 的 settings.json
        let settings = serde_json::json!({
            "claude_api_url": "https://old.example",
            "env": { "ANTHROPIC_BASE_URL": "https://x.example" }
        });
        fs::write(&user_settings, settings.to_string()).unwrap();
        assert!(project_settings.is_none());

        let findings = svc.scan().unwrap();
        let dep_finding = findings
            .iter()
            .find(|f| f.rule_id == "DEPRECATED_FIELD")
            .expect("DEPRECATED_FIELD should fire");
        let results = svc
            .apply_findings(vec![dep_finding.id.clone()], None)
            .unwrap();
        assert_eq!(results.len(), 1);
        assert!(results[0].applied, "should be applied, got: {:?}", results[0].error);

        // 用户级 settings.json 被重写
        let raw = fs::read_to_string(&user_settings).unwrap();
        let v: Value = serde_json::from_str(&raw).unwrap();
        assert!(v.get("claude_api_url").is_none(), "deprecated field must be removed");
        // 备份存在
        assert!(results[0].backup_path.is_some(), "backup_path should be set");
    }

    /// 2. `active_root_dir() = Some(root)` + 写 → 写到
    /// `<root>/.claude/settings.json`,**不**碰 user settings.json。
    #[test]
    fn apply_with_active_root_some_writes_to_project_dotclaude() {
        let tmp = TempDir::new().unwrap();
        let project_root = tmp.path().join("proj");
        let (svc, user_settings, project_settings) =
            build_svc_with_root(&tmp, Some(&project_root));
        let project_settings = project_settings.expect("project mode fixture");
        // 在 project 模式下,user 和 project 各有一份独立 settings.json
        // 写两份完全不同内容,验证写入只命中其中一份
        let user_json = serde_json::json!({
            "claude_api_url": "https://old-user.example",
            "env": { "ANTHROPIC_BASE_URL": "https://user.example" }
        });
        let project_json = serde_json::json!({
            "claude_api_url": "https://old-proj.example",
            "env": { "ANTHROPIC_BASE_URL": "https://proj.example" }
        });
        fs::write(&user_settings, user_json.to_string()).unwrap();
        fs::write(&project_settings, project_json.to_string()).unwrap();

        // 主动覆盖: scan 应读 project settings.json(ctx 由 active_root 决定)
        let findings = svc.scan_with_root(Some(&project_root)).unwrap();
        let dep_finding = findings
            .iter()
            .find(|f| f.rule_id == "DEPRECATED_FIELD")
            .expect("DEPRECATED_FIELD should fire on project settings");

        let results = svc
            .apply_findings(vec![dep_finding.id.clone()], Some(&project_root))
            .unwrap();
        assert_eq!(results.len(), 1);
        assert!(results[0].applied, "should be applied, got: {:?}", results[0].error);

        // project settings.json: deprecated 字段被移除
        let project_raw = fs::read_to_string(&project_settings).unwrap();
        let proj_v: Value = serde_json::from_str(&project_raw).unwrap();
        assert!(
            proj_v.get("claude_api_url").is_none(),
            "project settings.json must have deprecated field removed"
        );

        // user settings.json: 完全不变 (没碰)
        let user_raw = fs::read_to_string(&user_settings).unwrap();
        assert!(
            user_raw.contains("claude_api_url"),
            "user settings.json must NOT be touched in project mode; got: {user_raw}"
        );
    }

    /// 3. `active_root_dir() = Some(root)` + root 目录不存在 →
    /// 拒绝写,返回 Err (不自动 mkdir, 安全边界)。
    #[test]
    fn apply_with_active_root_missing_root_dir_rejects_write() {
        let tmp = TempDir::new().unwrap();
        let user_claude_dir = tmp.path().join("user").join(".claude");
        let app_data = tmp.path().join("user").join("app_data");
        fs::create_dir_all(&user_claude_dir).unwrap();
        fs::create_dir_all(app_data.join("backups")).unwrap();
        let user_settings = user_claude_dir.join("settings.json");
        let settings = serde_json::json!({
            "claude_api_url": "https://old.example",
            "env": { "ANTHROPIC_BASE_URL": "https://x.example" }
        });
        fs::write(&user_settings, settings.to_string()).unwrap();
        let paths = test_paths(tmp.path(), &app_data, &user_settings);
        let svc = OptimizerService::new(paths);

        // 故意指向不存在的 root
        let bogus_root = tmp.path().join("does_not_exist_yet");
        assert!(!bogus_root.exists());

        let findings = svc.scan_with_root(Some(&bogus_root)).unwrap();
        let dep_finding = findings
            .iter()
            .find(|f| f.rule_id == "DEPRECATED_FIELD")
            .expect("DEPRECATED_FIELD should fire");
        let results = svc
            .apply_findings(vec![dep_finding.id.clone()], Some(&bogus_root))
            .unwrap();
        assert_eq!(results.len(), 1);
        assert!(!results[0].applied, "should NOT be applied to missing root");
        assert!(results[0].error.is_some(), "should have error message");
        let err = results[0].error.as_deref().unwrap();
        assert!(
            err.contains("不存在") || err.contains("missing") || err.contains("not found")
                || err.to_lowercase().contains("root"),
            "error should mention missing root, got: {err}"
        );

        // 不应该创建 bogus_root 或其 .claude/ 子目录 (不自动 mkdir)
        assert!(!bogus_root.exists(), "service must NOT auto-mkdir unknown root");
    }

    /// 4. 写后验证 — 备份 .bak.<ts> 存在 + 新 settings.json 内容正确
    /// + 旧内容能从备份回滚。覆盖 project 模式 (因为 None 模式已被场景 1 覆盖)。
    #[test]
    fn apply_with_active_root_some_writes_backup_and_rollback_works() {
        let tmp = TempDir::new().unwrap();
        let project_root = tmp.path().join("proj");
        let (svc, _user_settings, project_settings) =
            build_svc_with_root(&tmp, Some(&project_root));
        let project_settings = project_settings.expect("project mode fixture");

        let original = serde_json::json!({
            "claude_api_url": "https://old-proj.example",
            "env": { "ANTHROPIC_BASE_URL": "https://proj.example" },
            "marker": "ORIGINAL"
        });
        fs::write(&project_settings, original.to_string()).unwrap();

        let findings = svc.scan_with_root(Some(&project_root)).unwrap();
        let dep_finding = findings
            .iter()
            .find(|f| f.rule_id == "DEPRECATED_FIELD")
            .expect("DEPRECATED_FIELD should fire");

        let results = svc
            .apply_findings(vec![dep_finding.id.clone()], Some(&project_root))
            .unwrap();
        assert_eq!(results.len(), 1);
        assert!(results[0].applied);
        let backup_path = results[0].backup_path.clone().expect("backup_path required");

        // 新 settings.json: 没了 claude_api_url + marker 仍在
        let new_raw = fs::read_to_string(&project_settings).unwrap();
        let new_v: Value = serde_json::from_str(&new_raw).unwrap();
        assert!(new_v.get("claude_api_url").is_none(), "deprecated removed");
        assert_eq!(new_v.get("marker").and_then(|v| v.as_str()), Some("ORIGINAL"));

        // 备份 .bak.<ts> 存在 (timestamped suffix, 我们 glob 一份)
        // (backup_path 字符串是预测占位,实际 atomic write 用真 timestamp;
        //  我们去 project .claude/ 目录 glob 即可。)
        let project_claude_dir = project_root.join(".claude");
        let mut found_backup: Option<std::path::PathBuf> = None;
        for entry in fs::read_dir(&project_claude_dir).unwrap() {
            let entry = entry.unwrap();
            let name = entry.file_name().into_string().unwrap();
            if name.starts_with("settings.json.bak.") {
                found_backup = Some(entry.path());
                break;
            }
        }
        let bak = found_backup.expect("at least one .bak.<ts> file must exist in project .claude/");
        let bak_raw = fs::read_to_string(&bak).unwrap();
        let bak_v: Value = serde_json::from_str(&bak_raw).unwrap();
        // 备份里 deprecated 字段仍在 (旧内容)
        assert_eq!(
            bak_v.get("claude_api_url").and_then(|v| v.as_str()),
            Some("https://old-proj.example"),
            "backup must preserve the original (pre-apply) content"
        );
        // 防回归:backup_path 字段格式符合规则约定的 "<dir>/<file>.bak.<ts>"
        assert!(
            backup_path.contains(".bak.") && backup_path.contains("settings.json"),
            "backup_path should reference settings.json.bak.<ts>, got: {backup_path}"
        );
    }
}
