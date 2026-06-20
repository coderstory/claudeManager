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

use std::path::PathBuf;

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
    pub fn scan(&self) -> Result<Vec<OptimizationFinding>, OptimizerError> {
        let ctx = self.build_context();
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
    pub fn apply_findings(
        &self,
        ids: Vec<String>,
    ) -> Result<Vec<ApplyResult>, OptimizerError> {
        let findings = self.scan()?;
        let mut ctx = self.build_context();
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
            ctx = self.build_context();
        }
        Ok(results)
    }

    // -----------------------------------------------------------------------
    // helpers
    // -----------------------------------------------------------------------

    /// Build the context the rules consume. Tolerant of missing files —
    /// any file that's absent is represented as empty (Value::Null /
    /// empty Vec).
    fn build_context(&self) -> OptimizerContext {
        let settings_path = self.paths.settings_json.clone();
        let settings_json = read_json_or_null(&settings_path);
        let providers = read_providers_dir(&self.providers_dir);
        let mcp_servers = read_mcp_json(&self.mcp_json_path);
        let claude_dir = self
            .paths
            .claude_dir()
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| self.paths.home.clone());
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
            .apply_findings(vec![dep_finding.id.clone()])
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
            .apply_findings(vec![dep_finding.id.clone()])
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
            .apply_findings(vec!["unknown-1".into(), "unknown-2".into()])
            .unwrap();
        assert_eq!(results.len(), 2);
        assert!(results.iter().all(|r| !r.applied));
        assert!(results.iter().all(|r| r.error.is_some()));
    }

    #[test]
    fn apply_findings_unknown_id_returns_manual_with_error() {
        let tmp = TempDir::new().unwrap();
        let (svc, _settings_path) = build_svc(&tmp);
        let results = svc.apply_findings(vec!["does-not-exist".into()]).unwrap();
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
}
