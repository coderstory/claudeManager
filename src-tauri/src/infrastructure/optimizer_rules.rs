//! optimizer_rules — 13 individual rules for F18 (M2.9).
//!
//! Each rule is a `struct` implementing [`OptimizerRule`]. The
//! [`OptimizerService`] (in `services/optimizer_service.rs`) registers
//! all 13 rules and dispatches `scan` / `apply` calls to them.
//!
//! # Why "infrastructure" not "domain"
//!
//! These rules touch real files (settings.json / providers/*.json /
//! mcp.json / backups/) — they're I/O, not pure domain logic.
//! `infrastructure` is the right layer (CLAUDE.md §3.1).
//!
//! # Rule taxonomy (per docs/design/M2.9-dataflow.md)
//!
//! | rule_id                       | severity | auto_apply | what it does |
//! |-------------------------------|----------|------------|---------------|
//! | ORPHAN_PROVIDER               | warning  | false      | settings refs missing provider |
//! | UNREFERENCED_PROVIDER         | info     | false      | provider never used |
//! | DUPLICATE_MCP                 | warning  | false      | dup command/url |
//! | EMPTY_FIELD                   | warning  | false      | empty api_key/api_base |
//! | DEPRECATED_FIELD              | info     | true       | remove old claude_api_url |
//! | INSECURE_API_KEY              | error    | false      | api_key < 16 chars |
//! | MCP_MISSING_TRANSPORT         | warning  | false      | missing command/url |
//! | LONG_PROVIDER_NAME            | info     | false      | name > 50 chars |
//! | UNUSED_BACKUP                 | info     | true       | bak.* mtime > 30 days |
//! | LARGE_SETTINGS                | warning  | false      | settings.json > 1 MB |
//! | MISSING_ACTIVE_PROVIDER       | warning  | false      | env.ANTHROPIC_BASE_URL absent |
//! | DANGLING_ACTIVE_PROVIDER      | error    | false      | active doesn't match any provider |
//! | INCONSISTENT_PROVIDER_TYPE    | info     | true       | mixed-case provider_type |

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use serde_json::Value;

use crate::domain::{ApplyResult, McpServer, OptimizationFinding, Provider, Severity};
use crate::infrastructure::fs_atomic;

// ---------------------------------------------------------------------------
// Trait + context
// ---------------------------------------------------------------------------

/// Public error returned by `apply`. Maps cleanly to `String` for the
/// Tauri command boundary, and uses `thiserror` so the Rust-side
/// caller can match if needed.
#[derive(Debug, thiserror::Error)]
pub enum OptimizerRuleError {
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("atomic write failed: {0}")]
    Atomic(String),
    #[error("rule cannot auto-apply: {0}")]
    Manual(String),
}

impl From<fs_atomic::FsAtomicError> for OptimizerRuleError {
    fn from(e: fs_atomic::FsAtomicError) -> Self {
        OptimizerRuleError::Atomic(e.to_string())
    }
}

/// What every rule is given to scan + apply against. Built once per
/// scan by [`OptimizerService::build_context`].
pub struct OptimizerContext {
    /// Live `~/.claude/settings.json` parsed as a JSON Value.
    /// `Value::Null` if the file is missing — rules must tolerate this.
    pub settings_json: Value,
    /// All providers loaded from `<app_data>/providers/*.json`.
    pub providers: Vec<Provider>,
    /// All MCP servers loaded from `~/.claude/mcp.json`.
    pub mcp_servers: Vec<McpServer>,
    /// `~/.claude/` (parent of settings.json). Used to compute
    /// `affected_path` strings and resolve sibling files.
    pub claude_dir: PathBuf,
    /// `<app_data>/` — used for the providers dir + backups dir.
    pub app_data_dir: PathBuf,
    /// `<app_data>/providers/` — written to by INCONSISTENT_PROVIDER_TYPE.
    pub providers_dir: PathBuf,
    /// `<app_data>/backups/` — scanned by UNUSED_BACKUP.
    pub backups_dir: PathBuf,
    /// Path to `settings.json`. Cached so rules don't recompute.
    pub settings_path: PathBuf,
}

/// Rule contract — every rule answers "do I see anything wrong?" via
/// `check`, and "fix it" via `apply` (which may be a no-op for manual
/// rules, returning [`ApplyResult::manual`]).
pub trait OptimizerRule: Send + Sync {
    /// Stable, uppercase-snake id (e.g. `ORPHAN_PROVIDER`).
    fn id(&self) -> &'static str;

    /// Run the check against `ctx`. Returns 0..N findings.
    fn check(&self, ctx: &OptimizerContext) -> Vec<OptimizationFinding>;

    /// Apply the fix for a specific finding. For manual rules this
    /// simply returns `Ok(ApplyResult::manual(...))`. For auto rules
    /// it must perform an `fs_atomic::write_with_backup` (CLAUDE.md
    /// §7) and return `Ok(ApplyResult::ok(..., backup_path))`.
    fn apply(
        &self,
        finding: &OptimizationFinding,
        ctx: &OptimizerContext,
    ) -> Result<ApplyResult, OptimizerRuleError>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn finding_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

/// Read settings env field as a string, ignoring the rest. Returns
/// None if `env` or the key is missing / non-string.
fn settings_env_str<'a>(settings: &'a Value, key: &str) -> Option<&'a str> {
    settings.get("env")?.get(key)?.as_str()
}

/// Common manual-fix ApplyResult builder.
fn manual(finding: &OptimizationFinding, reason: &str) -> ApplyResult {
    ApplyResult::manual(&finding.id, reason)
}

// ---------------------------------------------------------------------------
// Rule 1 — ORPHAN_PROVIDER
// ---------------------------------------------------------------------------

pub struct OrphanProviderRule;

impl OptimizerRule for OrphanProviderRule {
    fn id(&self) -> &'static str {
        "ORPHAN_PROVIDER"
    }

    fn check(&self, ctx: &OptimizerContext) -> Vec<OptimizationFinding> {
        let active_base = match settings_env_str(&ctx.settings_json, "ANTHROPIC_BASE_URL") {
            Some(s) if !s.is_empty() => s,
            _ => return Vec::new(),
        };
        let active_key = settings_env_str(&ctx.settings_json, "ANTHROPIC_AUTH_TOKEN")
            .unwrap_or("");
        if ctx.providers.is_empty() {
            return Vec::new();
        }
        // If any provider matches both base + key, NOT an orphan.
        let any_match = ctx.providers.iter().any(|p| {
            p.api_base == active_base
                && (active_key.is_empty() || p.api_key == active_key)
        });
        if any_match {
            return Vec::new();
        }
        vec![OptimizationFinding {
            id: finding_id(),
            rule_id: self.id().into(),
            severity: Severity::Warning,
            title: "孤儿 provider 引用".into(),
            description: format!(
                "settings.json 引用了 {} 作为活动 provider,但 providers/ 下没有匹配的 provider 文件。",
                active_base
            ),
            affected_path: "~/.claude/settings.json:env.ANTHROPIC_BASE_URL".into(),
            suggested_action: "请回到 Provider 列表页删除 settings 引用,或新建对应的 provider。".into(),
            auto_apply: false,
        }]
    }

    fn apply(
        &self,
        finding: &OptimizationFinding,
        _ctx: &OptimizerContext,
    ) -> Result<ApplyResult, OptimizerRuleError> {
        Ok(manual(
            finding,
            "请回到 Provider 列表页删除 settings 引用,或新建对应的 provider。",
        ))
    }
}

// ---------------------------------------------------------------------------
// Rule 2 — UNREFERENCED_PROVIDER
// ---------------------------------------------------------------------------

pub struct UnreferencedProviderRule;

impl OptimizerRule for UnreferencedProviderRule {
    fn id(&self) -> &'static str {
        "UNREFERENCED_PROVIDER"
    }

    fn check(&self, ctx: &OptimizerContext) -> Vec<OptimizationFinding> {
        let active_base = settings_env_str(&ctx.settings_json, "ANTHROPIC_BASE_URL")
            .unwrap_or("");
        ctx.providers
            .iter()
            .filter(|p| p.last_used_at.is_none() && p.api_base != active_base)
            .map(|p| OptimizationFinding {
                id: finding_id(),
                rule_id: self.id().into(),
                severity: Severity::Info,
                title: format!("未使用的 provider: {}", p.name),
                description: format!(
                    "Provider \"{}\" 从未被使用过,可以考虑删除以减少混乱。",
                    p.name
                ),
                affected_path: format!("providers/{}.json", p.id),
                suggested_action: "如不再需要,请回到 Provider 列表页删除该 provider。".into(),
                auto_apply: false,
            })
            .collect()
    }

    fn apply(
        &self,
        finding: &OptimizationFinding,
        _ctx: &OptimizerContext,
    ) -> Result<ApplyResult, OptimizerRuleError> {
        Ok(manual(
            finding,
            "如不再需要,请回到 Provider 列表页删除该 provider。",
        ))
    }
}

// ---------------------------------------------------------------------------
// Rule 3 — DUPLICATE_MCP
// ---------------------------------------------------------------------------

pub struct DuplicateMcpRule;

impl OptimizerRule for DuplicateMcpRule {
    fn id(&self) -> &'static str {
        "DUPLICATE_MCP"
    }

    fn check(&self, ctx: &OptimizerContext) -> Vec<OptimizationFinding> {
        let mut by_key: HashMap<String, Vec<&str>> = HashMap::new();
        for s in &ctx.mcp_servers {
            // dedup key = "stdio:<command>" / "http:<url>".
            let key = match (s.command.as_deref(), s.url.as_deref()) {
                (Some(c), _) if !c.is_empty() => format!("stdio:{}", c),
                (_, Some(u)) if !u.is_empty() => format!("http:{}", u),
                _ => continue,
            };
            by_key.entry(key).or_default().push(&s.name);
        }
        by_key
            .into_iter()
            .filter(|(_, names)| names.len() > 1)
            .map(|(key, names)| OptimizationFinding {
                id: finding_id(),
                rule_id: self.id().into(),
                severity: Severity::Warning,
                title: format!("重复的 MCP server: {} 个共享 {}", names.len(), key),
                description: format!(
                    "MCP servers {:?} 共享同一 transport 目标 ({})。可能是配置重复。",
                    names, key
                ),
                affected_path: "~/.claude/mcp.json".into(),
                suggested_action: "请回到 MCP 管理页删除重复项。".into(),
                auto_apply: false,
            })
            .collect()
    }

    fn apply(
        &self,
        finding: &OptimizationFinding,
        _ctx: &OptimizerContext,
    ) -> Result<ApplyResult, OptimizerRuleError> {
        Ok(manual(finding, "请回到 MCP 管理页删除重复项。"))
    }
}

// ---------------------------------------------------------------------------
// Rule 4 — EMPTY_FIELD
// ---------------------------------------------------------------------------

pub struct EmptyFieldRule;

impl OptimizerRule for EmptyFieldRule {
    fn id(&self) -> &'static str {
        "EMPTY_FIELD"
    }

    fn check(&self, ctx: &OptimizerContext) -> Vec<OptimizationFinding> {
        let mut out = Vec::new();
        for p in &ctx.providers {
            if p.api_key.trim().is_empty() {
                out.push(OptimizationFinding {
                    id: finding_id(),
                    rule_id: self.id().into(),
                    severity: Severity::Warning,
                    title: format!("空 api_key: {}", p.name),
                    description: format!("Provider \"{}\" 的 api_key 字段为空。", p.name),
                    affected_path: format!("providers/{}.json:api_key", p.id),
                    suggested_action: "请到 Provider 详情页填写 api_key。".into(),
                    auto_apply: false,
                });
            }
            if p.api_base.trim().is_empty() {
                out.push(OptimizationFinding {
                    id: finding_id(),
                    rule_id: self.id().into(),
                    severity: Severity::Warning,
                    title: format!("空 api_base: {}", p.name),
                    description: format!("Provider \"{}\" 的 api_base 字段为空。", p.name),
                    affected_path: format!("providers/{}.json:api_base", p.id),
                    suggested_action: "请到 Provider 详情页填写 api_base。".into(),
                    auto_apply: false,
                });
            }
        }
        out
    }

    fn apply(
        &self,
        finding: &OptimizationFinding,
        _ctx: &OptimizerContext,
    ) -> Result<ApplyResult, OptimizerRuleError> {
        Ok(manual(finding, "请到 Provider 详情页填写空字段。"))
    }
}

// ---------------------------------------------------------------------------
// Rule 5 — DEPRECATED_FIELD (auto-applies)
// ---------------------------------------------------------------------------

pub struct DeprecatedFieldRule;

impl DeprecatedFieldRule {
    const DEPRECATED_KEYS: &'static [&'static str] =
        &["claude_api_url", "claude_api_key", "claude_api_base"];
}

impl OptimizerRule for DeprecatedFieldRule {
    fn id(&self) -> &'static str {
        "DEPRECATED_FIELD"
    }

    fn check(&self, ctx: &OptimizerContext) -> Vec<OptimizationFinding> {
        let obj = match ctx.settings_json.as_object() {
            Some(o) => o,
            None => return Vec::new(),
        };
        Self::DEPRECATED_KEYS
            .iter()
            .filter(|k| obj.contains_key(**k))
            .map(|k| OptimizationFinding {
                id: finding_id(),
                rule_id: self.id().into(),
                severity: Severity::Info,
                title: format!("已弃用的 settings 字段: {}", k),
                description: format!(
                    "字段 \"{}\" 是 Claude Code 旧版本的命名,新版本使用 env.ANTHROPIC_* 字段。可安全移除。",
                    k
                ),
                affected_path: format!("~/.claude/settings.json:{}", k),
                suggested_action: "自动从 settings.json 移除该字段(已自动备份原文件)。".into(),
                auto_apply: true,
            })
            .collect()
    }

    fn apply(
        &self,
        finding: &OptimizationFinding,
        ctx: &OptimizerContext,
    ) -> Result<ApplyResult, OptimizerRuleError> {
        // Extract key from `affected_path` suffix after the last ':'.
        let key = finding
            .affected_path
            .rsplit(':')
            .next()
            .unwrap_or("")
            .to_string();
        if key.is_empty() || !Self::DEPRECATED_KEYS.contains(&key.as_str()) {
            return Ok(ApplyResult::manual(
                &finding.id,
                "无法识别要移除的字段(请重新扫描)。",
            ));
        }
        // Re-read settings to avoid stale ctx (apply may run after a previous
        // auto-apply mutated the file).
        let mut current: Value = match std::fs::read_to_string(&ctx.settings_path) {
            Ok(s) if !s.trim().is_empty() => serde_json::from_str(&s)?,
            _ => return Ok(ApplyResult::manual(&finding.id, "settings.json 不存在或为空。")),
        };
        let removed = current
            .as_object_mut()
            .map(|o| o.remove(&key).is_some())
            .unwrap_or(false);
        if !removed {
            return Ok(ApplyResult::manual(
                &finding.id,
                &format!("字段 {} 已不存在(可能已被其他修复移除)。", key),
            ));
        }
        let backup = backup_path_for(&ctx.settings_path);
        let json = serde_json::to_string_pretty(&current)?;
        fs_atomic::write_with_backup(&ctx.settings_path, &json)?;
        Ok(ApplyResult::ok(&finding.id, Some(backup)))
    }
}

// ---------------------------------------------------------------------------
// Rule 6 — INSECURE_API_KEY
// ---------------------------------------------------------------------------

pub struct InsecureApiKeyRule;

impl InsecureApiKeyRule {
    const MIN_LEN: usize = 16;
}

impl OptimizerRule for InsecureApiKeyRule {
    fn id(&self) -> &'static str {
        "INSECURE_API_KEY"
    }

    fn check(&self, ctx: &OptimizerContext) -> Vec<OptimizationFinding> {
        ctx.providers
            .iter()
            .filter(|p| {
                let trimmed = p.api_key.trim();
                !trimmed.is_empty() && trimmed.chars().count() < Self::MIN_LEN
            })
            .map(|p| OptimizationFinding {
                id: finding_id(),
                rule_id: self.id().into(),
                severity: Severity::Error,
                title: format!("不安全的 api_key: {}", p.name),
                description: format!(
                    "Provider \"{}\" 的 api_key 长度 < {} 字符,可能不是合法 token。",
                    p.name,
                    Self::MIN_LEN
                ),
                affected_path: format!("providers/{}.json:api_key", p.id),
                suggested_action: "请到 Provider 详情页重新填写 api_key(至少 16 字符)。".into(),
                auto_apply: false,
            })
            .collect()
    }

    fn apply(
        &self,
        finding: &OptimizationFinding,
        _ctx: &OptimizerContext,
    ) -> Result<ApplyResult, OptimizerRuleError> {
        Ok(manual(
            finding,
            "请到 Provider 详情页重新填写 api_key(至少 16 字符)。",
        ))
    }
}

// ---------------------------------------------------------------------------
// Rule 7 — MCP_MISSING_TRANSPORT
// ---------------------------------------------------------------------------

pub struct McpMissingTransportRule;

impl OptimizerRule for McpMissingTransportRule {
    fn id(&self) -> &'static str {
        "MCP_MISSING_TRANSPORT"
    }

    fn check(&self, ctx: &OptimizerContext) -> Vec<OptimizationFinding> {
        ctx.mcp_servers
            .iter()
            .filter(|s| match s.transport {
                crate::domain::McpTransport::Stdio => {
                    s.command.as_deref().unwrap_or("").is_empty()
                }
                crate::domain::McpTransport::Http => {
                    s.url.as_deref().unwrap_or("").is_empty()
                }
            })
            .map(|s| OptimizationFinding {
                id: finding_id(),
                rule_id: self.id().into(),
                severity: Severity::Warning,
                title: format!("MCP 缺 transport 字段: {}", s.name),
                description: format!(
                    "MCP server \"{}\" 是 {:?} transport,但缺少必需字段。",
                    s.name, s.transport
                ),
                affected_path: format!("~/.claude/mcp.json:{}", s.name),
                suggested_action: "请回到 MCP 管理页编辑该 server 补全字段。".into(),
                auto_apply: false,
            })
            .collect()
    }

    fn apply(
        &self,
        finding: &OptimizationFinding,
        _ctx: &OptimizerContext,
    ) -> Result<ApplyResult, OptimizerRuleError> {
        Ok(manual(finding, "请回到 MCP 管理页编辑该 server 补全字段。"))
    }
}

// ---------------------------------------------------------------------------
// Rule 8 — LONG_PROVIDER_NAME
// ---------------------------------------------------------------------------

pub struct LongProviderNameRule;

impl LongProviderNameRule {
    const MAX_LEN: usize = 50;
}

impl OptimizerRule for LongProviderNameRule {
    fn id(&self) -> &'static str {
        "LONG_PROVIDER_NAME"
    }

    fn check(&self, ctx: &OptimizerContext) -> Vec<OptimizationFinding> {
        ctx.providers
            .iter()
            .filter(|p| p.name.chars().count() > Self::MAX_LEN)
            .map(|p| OptimizationFinding {
                id: finding_id(),
                rule_id: self.id().into(),
                severity: Severity::Info,
                title: format!("过长的 provider name: {}", &p.name.chars().take(20).collect::<String>()),
                description: format!(
                    "Provider name \"{}\" 长度 = {} 字符(> {} 字符在 UI 会被截断)。",
                    p.name,
                    p.name.chars().count(),
                    Self::MAX_LEN
                ),
                affected_path: format!("providers/{}.json:name", p.id),
                suggested_action: "请到 Provider 详情页缩短 name。".into(),
                auto_apply: false,
            })
            .collect()
    }

    fn apply(
        &self,
        finding: &OptimizationFinding,
        _ctx: &OptimizerContext,
    ) -> Result<ApplyResult, OptimizerRuleError> {
        Ok(manual(finding, "请到 Provider 详情页缩短 name。"))
    }
}

// ---------------------------------------------------------------------------
// Rule 9 — UNUSED_BACKUP (auto-applies — deletes file)
// ---------------------------------------------------------------------------

pub struct UnusedBackupRule;

impl UnusedBackupRule {
    /// Hard-coded 30-day threshold per design doc.
    const STALE_AGE: Duration = Duration::from_secs(30 * 24 * 60 * 60);
}

impl OptimizerRule for UnusedBackupRule {
    fn id(&self) -> &'static str {
        "UNUSED_BACKUP"
    }

    fn check(&self, ctx: &OptimizerContext) -> Vec<OptimizationFinding> {
        let mut out = Vec::new();
        let now = SystemTime::now();
        let dir = match std::fs::read_dir(&ctx.backups_dir) {
            Ok(d) => d,
            Err(_) => return out,
        };
        for entry in dir.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            // Match `.bak.<ts>` pattern in any file name.
            let name = match path.file_name().and_then(|s| s.to_str()) {
                Some(s) => s,
                None => continue,
            };
            if !name.contains(".bak.") {
                continue;
            }
            let mtime = match entry.metadata().and_then(|m| m.modified()) {
                Ok(t) => t,
                Err(_) => continue,
            };
            let age = now.duration_since(mtime).unwrap_or_default();
            if age >= Self::STALE_AGE {
                let path_str = path.to_string_lossy().to_string();
                out.push(OptimizationFinding {
                    id: finding_id(),
                    rule_id: self.id().into(),
                    severity: Severity::Info,
                    title: format!(
                        "过期备份: {}",
                        name.chars().take(40).collect::<String>()
                    ),
                    description: format!(
                        "备份文件 mtime 已超过 30 天 ({}天前)。可安全删除。",
                        age.as_secs() / 86400
                    ),
                    affected_path: path_str,
                    suggested_action: "自动删除该过期备份。".into(),
                    auto_apply: true,
                });
            }
        }
        out
    }

    fn apply(
        &self,
        finding: &OptimizationFinding,
        _ctx: &OptimizerContext,
    ) -> Result<ApplyResult, OptimizerRuleError> {
        let path = Path::new(&finding.affected_path);
        if !path.exists() {
            return Ok(ApplyResult::manual(
                &finding.id,
                "备份文件不存在(可能已被其他工具清理)。",
            ));
        }
        // Sanity check — refuse to delete anything that doesn't have ".bak."
        // in its name (defence-in-depth).
        let name = path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("");
        if !name.contains(".bak.") {
            return Ok(ApplyResult::manual(
                &finding.id,
                "拒绝删除:文件名不像备份(.bak.)。",
            ));
        }
        std::fs::remove_file(path)?;
        // No "backup of a backup" — return None for backup_path.
        Ok(ApplyResult::ok(&finding.id, None))
    }
}

// ---------------------------------------------------------------------------
// Rule 10 — LARGE_SETTINGS
// ---------------------------------------------------------------------------

pub struct LargeSettingsRule;

impl LargeSettingsRule {
    const THRESHOLD: u64 = 1024 * 1024; // 1 MB
}

impl OptimizerRule for LargeSettingsRule {
    fn id(&self) -> &'static str {
        "LARGE_SETTINGS"
    }

    fn check(&self, ctx: &OptimizerContext) -> Vec<OptimizationFinding> {
        let meta = match std::fs::metadata(&ctx.settings_path) {
            Ok(m) => m,
            Err(_) => return Vec::new(),
        };
        if meta.len() < Self::THRESHOLD {
            return Vec::new();
        }
        vec![OptimizationFinding {
            id: finding_id(),
            rule_id: self.id().into(),
            severity: Severity::Warning,
            title: "settings.json 过大".into(),
            description: format!(
                "文件大小 = {} KB(> {} KB 阈值)。可能含多余字段或 hooks 脚本嵌入,建议人工 review。",
                meta.len() / 1024,
                Self::THRESHOLD / 1024
            ),
            affected_path: ctx.settings_path.to_string_lossy().to_string(),
            suggested_action: "请到 JSON 编辑器页人工 review 并精简。".into(),
            auto_apply: false,
        }]
    }

    fn apply(
        &self,
        finding: &OptimizationFinding,
        _ctx: &OptimizerContext,
    ) -> Result<ApplyResult, OptimizerRuleError> {
        Ok(manual(finding, "请到 JSON 编辑器页人工 review 并精简。"))
    }
}

// ---------------------------------------------------------------------------
// Rule 11 — MISSING_ACTIVE_PROVIDER
// ---------------------------------------------------------------------------

pub struct MissingActiveProviderRule;

impl OptimizerRule for MissingActiveProviderRule {
    fn id(&self) -> &'static str {
        "MISSING_ACTIVE_PROVIDER"
    }

    fn check(&self, ctx: &OptimizerContext) -> Vec<OptimizationFinding> {
        let base = settings_env_str(&ctx.settings_json, "ANTHROPIC_BASE_URL")
            .unwrap_or("");
        if !base.is_empty() {
            return Vec::new();
        }
        // Don't fire if there are no providers at all (empty state — UI
        // shows the onboarding flow and this finding would be noise).
        if ctx.providers.is_empty() {
            return Vec::new();
        }
        vec![OptimizationFinding {
            id: finding_id(),
            rule_id: self.id().into(),
            severity: Severity::Warning,
            title: "未设置活动 provider".into(),
            description: "settings.json 的 env.ANTHROPIC_BASE_URL 字段缺失或为空,Claude Code 无法使用任何 provider。".into(),
            affected_path: "~/.claude/settings.json:env.ANTHROPIC_BASE_URL".into(),
            suggested_action: "请回到 Provider 列表页选一个 provider 切换。".into(),
            auto_apply: false,
        }]
    }

    fn apply(
        &self,
        finding: &OptimizationFinding,
        _ctx: &OptimizerContext,
    ) -> Result<ApplyResult, OptimizerRuleError> {
        Ok(manual(finding, "请回到 Provider 列表页选一个 provider 切换。"))
    }
}

// ---------------------------------------------------------------------------
// Rule 12 — DANGLING_ACTIVE_PROVIDER
// ---------------------------------------------------------------------------

pub struct DanglingActiveProviderRule;

impl OptimizerRule for DanglingActiveProviderRule {
    fn id(&self) -> &'static str {
        "DANGLING_ACTIVE_PROVIDER"
    }

    fn check(&self, ctx: &OptimizerContext) -> Vec<OptimizationFinding> {
        let base = match settings_env_str(&ctx.settings_json, "ANTHROPIC_BASE_URL") {
            Some(s) if !s.is_empty() => s,
            _ => return Vec::new(),
        };
        // Only fire when there ARE providers but none match — empty
        // library is a different finding (covered by ORPHAN_PROVIDER /
        // MISSING_ACTIVE_PROVIDER).
        if ctx.providers.is_empty() {
            return Vec::new();
        }
        let any_match = ctx.providers.iter().any(|p| p.api_base == base);
        if any_match {
            return Vec::new();
        }
        vec![OptimizationFinding {
            id: finding_id(),
            rule_id: self.id().into(),
            severity: Severity::Error,
            title: "活动 provider 指向不存在的目标".into(),
            description: format!(
                "settings.json 的 env.ANTHROPIC_BASE_URL = {} 但 providers/ 下没有任何 provider 的 api_base 与之匹配。",
                base
            ),
            affected_path: "~/.claude/settings.json:env.ANTHROPIC_BASE_URL".into(),
            suggested_action: "请回到 Provider 列表页选一个有效 provider 切换。".into(),
            auto_apply: false,
        }]
    }

    fn apply(
        &self,
        finding: &OptimizationFinding,
        _ctx: &OptimizerContext,
    ) -> Result<ApplyResult, OptimizerRuleError> {
        Ok(manual(
            finding,
            "请回到 Provider 列表页选一个有效 provider 切换。",
        ))
    }
}

// ---------------------------------------------------------------------------
// Rule 13 — INCONSISTENT_PROVIDER_TYPE (auto-applies)
// ---------------------------------------------------------------------------

pub struct InconsistentProviderTypeRule;

impl OptimizerRule for InconsistentProviderTypeRule {
    fn id(&self) -> &'static str {
        "INCONSISTENT_PROVIDER_TYPE"
    }

    fn check(&self, ctx: &OptimizerContext) -> Vec<OptimizationFinding> {
        // Group lowercased -> set of original casings.
        let mut variants: HashMap<String, HashSet<String>> = HashMap::new();
        for p in &ctx.providers {
            let lower = p.provider_type.to_lowercase();
            variants.entry(lower).or_default().insert(p.provider_type.clone());
        }
        let mut out = Vec::new();
        for p in &ctx.providers {
            let lower = p.provider_type.to_lowercase();
            let casings = match variants.get(&lower) {
                Some(c) if c.len() > 1 => c,
                _ => continue,
            };
            // Only flag providers whose own casing isn't already lowercase
            // (lowercase IS the canonical form we'll write). And only
            // flag if there's actually a non-lowercase variant in the set
            // (otherwise we'd be flagging "my-canonical-already-lower"
            // entries needlessly).
            if p.provider_type == lower {
                continue;
            }
            out.push(OptimizationFinding {
                id: finding_id(),
                rule_id: self.id().into(),
                severity: Severity::Info,
                title: format!("不一致的 provider_type 大小写: {}", p.provider_type),
                description: format!(
                    "providers 中存在 {} 种大小写({:?})。建议全部 lowercase。",
                    casings.len(),
                    casings.iter().collect::<Vec<_>>()
                ),
                affected_path: format!("providers/{}.json:provider_type", p.id),
                suggested_action: format!("自动改为 \"{}\"(已自动备份)。", lower),
                auto_apply: true,
            });
        }
        out
    }

    fn apply(
        &self,
        finding: &OptimizationFinding,
        ctx: &OptimizerContext,
    ) -> Result<ApplyResult, OptimizerRuleError> {
        // Extract provider id from `affected_path` = "providers/<id>.json:provider_type".
        let id = finding
            .affected_path
            .strip_prefix("providers/")
            .and_then(|s| s.strip_suffix(".json:provider_type"))
            .unwrap_or("");
        if id.is_empty() {
            return Ok(ApplyResult::manual(
                &finding.id,
                "无法解析 provider id(请重新扫描)。",
            ));
        }
        let p = match ctx.providers.iter().find(|p| p.id == id) {
            Some(p) => p,
            None => {
                return Ok(ApplyResult::manual(
                    &finding.id,
                    "Provider 已不存在(可能已被删除)。",
                ));
            }
        };
        let lower = p.provider_type.to_lowercase();
        if p.provider_type == lower {
            return Ok(ApplyResult::manual(
                &finding.id,
                "provider_type 已是 lowercase。",
            ));
        }
        let path = ctx.providers_dir.join(format!("{}.json", id));
        let raw = std::fs::read_to_string(&path)?;
        let mut v: Value = serde_json::from_str(&raw)?;
        if let Some(obj) = v.as_object_mut() {
            obj.insert("provider_type".into(), Value::String(lower));
        }
        let backup = backup_path_for(&path);
        let json = serde_json::to_string_pretty(&v)?;
        fs_atomic::write_with_backup(&path, &json)?;
        Ok(ApplyResult::ok(&finding.id, Some(backup)))
    }
}

// ---------------------------------------------------------------------------
// Backup-path helper (matches fs_atomic naming)
// ---------------------------------------------------------------------------

/// Predicts the .bak.<ts> path that `fs_atomic::write_with_backup` will
/// create. The actual backup filename is timestamped with seconds so we
/// can't predict it exactly — but we return the *base prefix* so the UI
/// can show "files matching this prefix". For the M2.9 contract we
/// return the parent dir + the bak prefix; the UI displays it as "see
/// `<dir>/<file>.bak.*`".
fn backup_path_for(target: &Path) -> String {
    let dir = target.parent().unwrap_or_else(|| Path::new(""));
    let name = target
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("file");
    format!("{}/{}.bak.<ts>", dir.display(), name)
}

// ---------------------------------------------------------------------------
// Rule 14 — ENV001 (auto-applies)
// 禁用 Claude Code 内置 attribution header。
//
// 官方 env:CLAUDE_CODE_ATTRIBUTION_HEADER=0 → 关掉 Claude Code 自动
// 加在响应里的 attribution 文本(纯偏好,无功能影响)。
//
// 见 docs/rules/builtin-rules.md §ENV001。
// ---------------------------------------------------------------------------

pub struct AttributionHeaderEnvRule;

impl AttributionHeaderEnvRule {
    const ENV_KEY: &'static str = "CLAUDE_CODE_ATTRIBUTION_HEADER";
    const EXPECTED: &'static str = "0";
}

impl OptimizerRule for AttributionHeaderEnvRule {
    fn id(&self) -> &'static str {
        "ENV001"
    }

    fn check(&self, ctx: &OptimizerContext) -> Vec<OptimizationFinding> {
        let current = settings_env_str(&ctx.settings_json, Self::ENV_KEY).unwrap_or("");
        if current == Self::EXPECTED {
            return Vec::new();
        }
        vec![OptimizationFinding {
            id: finding_id(),
            rule_id: self.id().into(),
            severity: Severity::Info,
            title: "未设置 CLAUDE_CODE_ATTRIBUTION_HEADER=0".into(),
            description: format!(
                "settings.env.{} 当前为 {:?};推荐设为 \"{}\" 关闭 Claude Code 内置 attribution。",
                Self::ENV_KEY,
                current,
                Self::EXPECTED
            ),
            affected_path: format!("~/.claude/settings.json:env.{}", Self::ENV_KEY),
            suggested_action: format!(
                "自动写入 env.{} = \"{}\"(已自动备份)。",
                Self::ENV_KEY,
                Self::EXPECTED
            ),
            auto_apply: true,
        }]
    }

    fn apply(
        &self,
        finding: &OptimizationFinding,
        ctx: &OptimizerContext,
    ) -> Result<ApplyResult, OptimizerRuleError> {
        write_env_kv(finding, ctx, Self::ENV_KEY, Self::EXPECTED)
    }
}

// ---------------------------------------------------------------------------
// Rule 15 — ENV002 (auto-applies)
// 禁用 Claude Code 非必要流量(telemetry / 错误上报),节省 token。
//
// 官方 env:CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1。
//
// 见 docs/rules/builtin-rules.md §ENV002。
// ---------------------------------------------------------------------------

pub struct DisableNonessentialTrafficEnvRule;

impl DisableNonessentialTrafficEnvRule {
    const ENV_KEY: &'static str = "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC";
    const EXPECTED: &'static str = "1";
}

impl OptimizerRule for DisableNonessentialTrafficEnvRule {
    fn id(&self) -> &'static str {
        "ENV002"
    }

    fn check(&self, ctx: &OptimizerContext) -> Vec<OptimizationFinding> {
        let current = settings_env_str(&ctx.settings_json, Self::ENV_KEY).unwrap_or("");
        if current == Self::EXPECTED {
            return Vec::new();
        }
        vec![OptimizationFinding {
            id: finding_id(),
            rule_id: self.id().into(),
            severity: Severity::Info,
            title: "未设置 CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1".into(),
            description: format!(
                "settings.env.{} 当前为 {:?};推荐设为 \"{}\" 禁用 Claude Code 非必要网络流量以节省 token。",
                Self::ENV_KEY,
                current,
                Self::EXPECTED
            ),
            affected_path: format!("~/.claude/settings.json:env.{}", Self::ENV_KEY),
            suggested_action: format!(
                "自动写入 env.{} = \"{}\"(已自动备份)。",
                Self::ENV_KEY,
                Self::EXPECTED
            ),
            auto_apply: true,
        }]
    }

    fn apply(
        &self,
        finding: &OptimizationFinding,
        ctx: &OptimizerContext,
    ) -> Result<ApplyResult, OptimizerRuleError> {
        write_env_kv(finding, ctx, Self::ENV_KEY, Self::EXPECTED)
    }
}

// ---------------------------------------------------------------------------
// Rule 16 — ENV003 (auto-applies)
// 默认 effort level 调到 max,让 Claude Code 默认做更深推理。
//
// 官方 env:CLAUDE_CODE_EFFORT_LEVEL=max。
//
// 见 docs/rules/builtin-rules.md §ENV003。
// ---------------------------------------------------------------------------

pub struct EffortLevelMaxEnvRule;

impl EffortLevelMaxEnvRule {
    const ENV_KEY: &'static str = "CLAUDE_CODE_EFFORT_LEVEL";
    const EXPECTED: &'static str = "max";
}

impl OptimizerRule for EffortLevelMaxEnvRule {
    fn id(&self) -> &'static str {
        "ENV003"
    }

    fn check(&self, ctx: &OptimizerContext) -> Vec<OptimizationFinding> {
        let current = settings_env_str(&ctx.settings_json, Self::ENV_KEY).unwrap_or("");
        if current == Self::EXPECTED {
            return Vec::new();
        }
        vec![OptimizationFinding {
            id: finding_id(),
            rule_id: self.id().into(),
            severity: Severity::Info,
            title: "未设置 CLAUDE_CODE_EFFORT_LEVEL=max".into(),
            description: format!(
                "settings.env.{} 当前为 {:?};推荐设为 \"{}\" 让 Claude Code 默认做更深推理。",
                Self::ENV_KEY,
                current,
                Self::EXPECTED
            ),
            affected_path: format!("~/.claude/settings.json:env.{}", Self::ENV_KEY),
            suggested_action: format!(
                "自动写入 env.{} = \"{}\"(已自动备份)。",
                Self::ENV_KEY,
                Self::EXPECTED
            ),
            auto_apply: true,
        }]
    }

    fn apply(
        &self,
        finding: &OptimizationFinding,
        ctx: &OptimizerContext,
    ) -> Result<ApplyResult, OptimizerRuleError> {
        write_env_kv(finding, ctx, Self::ENV_KEY, Self::EXPECTED)
    }
}

// ---------------------------------------------------------------------------
// Helper — ENV00x 规则的 apply 共用逻辑(写入 env.K=V,F13 备份原子写盘)。
// ---------------------------------------------------------------------------

/// 通用 "在 settings.env 里写一个 KV" 的 apply 实现。
///
/// 流程:
///  1. 重新读 settings.json(避免 stale ctx),`env` 字段若不存在则新建;
///  2. 写入 KV;若值已经等于 expected,返回 manual(finding_id, "已是 X");
///  3. fs_atomic::write_with_backup 原子写盘,返回 backup_path 供 UI 展示。
fn write_env_kv(
    finding: &OptimizationFinding,
    ctx: &OptimizerContext,
    env_key: &str,
    expected: &str,
) -> Result<ApplyResult, OptimizerRuleError> {
    let mut current: Value = match std::fs::read_to_string(&ctx.settings_path) {
        Ok(s) if !s.trim().is_empty() => serde_json::from_str(&s)?,
        _ => {
            return Ok(ApplyResult::manual(
                &finding.id,
                "settings.json 不存在或为空(无法写 env)。",
            ));
        }
    };
    let root = match current.as_object_mut() {
        Some(o) => o,
        None => {
            return Ok(ApplyResult::manual(
                &finding.id,
                "settings.json 顶层不是对象(无法写 env)。",
            ));
        }
    };
    if !root.contains_key("env") {
        root.insert("env".to_string(), Value::Object(Default::default()));
    }
    let env = root
        .get_mut("env")
        .and_then(|v| v.as_object_mut())
        .ok_or_else(|| {
            OptimizerRuleError::Manual("settings.env 不是对象".into())
        })?;
    let existing = env.get(env_key).and_then(|v| v.as_str()).unwrap_or("");
    if existing == expected {
        return Ok(ApplyResult::manual(
            &finding.id,
            &format!("env.{} 已是 \"{}\"。", env_key, expected),
        ));
    }
    env.insert(env_key.to_string(), Value::String(expected.to_string()));
    let backup = backup_path_for(&ctx.settings_path);
    let json = serde_json::to_string_pretty(&current)?;
    fs_atomic::write_with_backup(&ctx.settings_path, &json)?;
    Ok(ApplyResult::ok(&finding.id, Some(backup)))
}

// ---------------------------------------------------------------------------
// All rules — enumerator helper for the service.
// ---------------------------------------------------------------------------

/// Construct all 16 rules (13 文件规则 + 3 env 规则) in their canonical
/// order. Used by `OptimizerService::new`; tests use it too so the count
/// stays in sync.
///
/// M3.3 增量:在 13 个文件规则之后追加 ENV001/002/003。
pub fn all_rules() -> Vec<Box<dyn OptimizerRule>> {
    vec![
        Box::new(OrphanProviderRule),
        Box::new(UnreferencedProviderRule),
        Box::new(DuplicateMcpRule),
        Box::new(EmptyFieldRule),
        Box::new(DeprecatedFieldRule),
        Box::new(InsecureApiKeyRule),
        Box::new(McpMissingTransportRule),
        Box::new(LongProviderNameRule),
        Box::new(UnusedBackupRule),
        Box::new(LargeSettingsRule),
        Box::new(MissingActiveProviderRule),
        Box::new(DanglingActiveProviderRule),
        Box::new(InconsistentProviderTypeRule),
        // M3.3 — 3 个 env 规则
        Box::new(AttributionHeaderEnvRule),
        Box::new(DisableNonessentialTrafficEnvRule),
        Box::new(EffortLevelMaxEnvRule),
    ]
}

// ---------------------------------------------------------------------------
// Tests — TDD for each rule (≥2 cases each = 26 cases).
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{McpServer, McpTransport, Provider, ProviderModels};
    use std::collections::HashMap;
    use std::fs;
    use tempfile::TempDir;

    fn ctx_with(
        tmp: &TempDir,
        settings: Value,
        providers: Vec<Provider>,
        mcp_servers: Vec<McpServer>,
    ) -> OptimizerContext {
        let claude_dir = tmp.path().join("claude");
        let app_data = tmp.path().join("app_data");
        let providers_dir = app_data.join("providers");
        let backups_dir = app_data.join("backups");
        fs::create_dir_all(&claude_dir).unwrap();
        fs::create_dir_all(&providers_dir).unwrap();
        fs::create_dir_all(&backups_dir).unwrap();
        let settings_path = claude_dir.join("settings.json");
        if !settings.is_null() {
            fs::write(&settings_path, settings.to_string()).unwrap();
        }
        // Persist providers to disk so rules that re-read can find them.
        for p in &providers {
            p.to_json_file(&providers_dir.join(format!("{}.json", p.id)))
                .unwrap();
        }
        OptimizerContext {
            settings_json: settings,
            providers,
            mcp_servers,
            claude_dir,
            app_data_dir: app_data,
            providers_dir,
            backups_dir,
            settings_path,
        }
    }

    fn provider(id: &str, base: &str, key: &str) -> Provider {
        Provider {
            id: id.into(),
            name: format!("Name-{}", id),
            provider_type: "anthropic".into(),
            api_base: base.into(),
            api_key: key.into(),
            models: ProviderModels::default(),
            is_active: false,
            created_at: 1_700_000_000,
            last_used_at: None,
            notes: None,
        }
    }

    fn mcp_stdio(name: &str, command: &str) -> McpServer {
        McpServer {
            id: uuid::Uuid::new_v4().to_string(),
            name: name.into(),
            transport: McpTransport::Stdio,
            command: Some(command.into()),
            args: vec![],
            env: HashMap::new(),
            url: None,
            enabled: true,
            created_at: 1_700_000_000,
        }
    }

    fn mcp_http(name: &str, url: &str) -> McpServer {
        McpServer {
            id: uuid::Uuid::new_v4().to_string(),
            name: name.into(),
            transport: McpTransport::Http,
            command: None,
            args: vec![],
            env: HashMap::new(),
            url: Some(url.into()),
            enabled: true,
            created_at: 1_700_000_000,
        }
    }

    // ----- Rule 1 — ORPHAN_PROVIDER -----

    #[test]
    fn orphan_provider_hits_when_settings_refs_missing() {
        let tmp = TempDir::new().unwrap();
        let settings = serde_json::json!({
            "env": {
                "ANTHROPIC_BASE_URL": "https://nope.example",
                "ANTHROPIC_AUTH_TOKEN": "abc",
            }
        });
        let ctx = ctx_with(
            &tmp,
            settings,
            vec![provider("p1", "https://other.example", "abc-1234567890123456")],
            vec![],
        );
        let f = OrphanProviderRule.check(&ctx);
        assert_eq!(f.len(), 1);
        assert_eq!(f[0].rule_id, "ORPHAN_PROVIDER");
        assert_eq!(f[0].severity, Severity::Warning);
        assert!(!f[0].auto_apply);
    }

    #[test]
    fn orphan_provider_no_hit_when_match_exists() {
        let tmp = TempDir::new().unwrap();
        let settings = serde_json::json!({
            "env": {
                "ANTHROPIC_BASE_URL": "https://x.example",
                "ANTHROPIC_AUTH_TOKEN": "matching-key-1234567890",
            }
        });
        let ctx = ctx_with(
            &tmp,
            settings,
            vec![provider("p1", "https://x.example", "matching-key-1234567890")],
            vec![],
        );
        assert!(OrphanProviderRule.check(&ctx).is_empty());
    }

    // ----- Rule 2 — UNREFERENCED_PROVIDER -----

    #[test]
    fn unreferenced_provider_hits_when_never_used() {
        let tmp = TempDir::new().unwrap();
        let p = provider("p1", "https://x.example", "k-1234567890123456");
        let ctx = ctx_with(&tmp, serde_json::json!({}), vec![p], vec![]);
        let f = UnreferencedProviderRule.check(&ctx);
        assert_eq!(f.len(), 1);
        assert_eq!(f[0].rule_id, "UNREFERENCED_PROVIDER");
        assert_eq!(f[0].severity, Severity::Info);
    }

    #[test]
    fn unreferenced_provider_no_hit_when_used_recently() {
        let tmp = TempDir::new().unwrap();
        let mut p = provider("p1", "https://x.example", "k-1234567890123456");
        p.last_used_at = Some(1_800_000_000);
        let ctx = ctx_with(&tmp, serde_json::json!({}), vec![p], vec![]);
        assert!(UnreferencedProviderRule.check(&ctx).is_empty());
    }

    // ----- Rule 3 — DUPLICATE_MCP -----

    #[test]
    fn duplicate_mcp_hits_when_two_share_command() {
        let tmp = TempDir::new().unwrap();
        let ctx = ctx_with(
            &tmp,
            serde_json::json!({}),
            vec![],
            vec![mcp_stdio("a", "npx"), mcp_stdio("b", "npx")],
        );
        let f = DuplicateMcpRule.check(&ctx);
        assert_eq!(f.len(), 1);
        assert_eq!(f[0].rule_id, "DUPLICATE_MCP");
    }

    #[test]
    fn duplicate_mcp_no_hit_when_distinct() {
        let tmp = TempDir::new().unwrap();
        let ctx = ctx_with(
            &tmp,
            serde_json::json!({}),
            vec![],
            vec![mcp_stdio("a", "npx"), mcp_http("b", "https://x.example")],
        );
        assert!(DuplicateMcpRule.check(&ctx).is_empty());
    }

    // ----- Rule 4 — EMPTY_FIELD -----

    #[test]
    fn empty_field_hits_for_empty_api_key() {
        let tmp = TempDir::new().unwrap();
        let p = provider("p1", "https://x.example", "");
        let ctx = ctx_with(&tmp, serde_json::json!({}), vec![p], vec![]);
        let f = EmptyFieldRule.check(&ctx);
        assert_eq!(f.len(), 1);
        assert!(f[0].title.contains("api_key"));
    }

    #[test]
    fn empty_field_no_hit_when_filled() {
        let tmp = TempDir::new().unwrap();
        let p = provider("p1", "https://x.example", "key-1234567890123456");
        let ctx = ctx_with(&tmp, serde_json::json!({}), vec![p], vec![]);
        assert!(EmptyFieldRule.check(&ctx).is_empty());
    }

    // ----- Rule 5 — DEPRECATED_FIELD (auto) -----

    #[test]
    fn deprecated_field_hits_when_old_keys_present() {
        let tmp = TempDir::new().unwrap();
        let settings = serde_json::json!({
            "claude_api_url": "https://old.example",
            "env": { "ANTHROPIC_BASE_URL": "https://new.example" }
        });
        let ctx = ctx_with(&tmp, settings, vec![], vec![]);
        let f = DeprecatedFieldRule.check(&ctx);
        assert_eq!(f.len(), 1);
        assert!(f[0].auto_apply);
    }

    #[test]
    fn deprecated_field_apply_removes_field_with_backup() {
        let tmp = TempDir::new().unwrap();
        let settings = serde_json::json!({
            "claude_api_url": "https://old.example",
            "env": { "ANTHROPIC_BASE_URL": "https://new.example" }
        });
        let ctx = ctx_with(&tmp, settings, vec![], vec![]);
        let findings = DeprecatedFieldRule.check(&ctx);
        let result = DeprecatedFieldRule.apply(&findings[0], &ctx).unwrap();
        assert!(result.applied);
        assert!(result.backup_path.is_some());
        let raw = fs::read_to_string(&ctx.settings_path).unwrap();
        let v: Value = serde_json::from_str(&raw).unwrap();
        assert!(v.get("claude_api_url").is_none());
        assert!(v.get("env").is_some()); // env preserved
    }

    #[test]
    fn deprecated_field_no_hit_when_clean() {
        let tmp = TempDir::new().unwrap();
        let settings = serde_json::json!({
            "env": { "ANTHROPIC_BASE_URL": "https://x" }
        });
        let ctx = ctx_with(&tmp, settings, vec![], vec![]);
        assert!(DeprecatedFieldRule.check(&ctx).is_empty());
    }

    // ----- Rule 6 — INSECURE_API_KEY -----

    #[test]
    fn insecure_key_hits_for_short_key() {
        let tmp = TempDir::new().unwrap();
        let p = provider("p1", "https://x.example", "short");
        let ctx = ctx_with(&tmp, serde_json::json!({}), vec![p], vec![]);
        let f = InsecureApiKeyRule.check(&ctx);
        assert_eq!(f.len(), 1);
        assert_eq!(f[0].severity, Severity::Error);
    }

    #[test]
    fn insecure_key_no_hit_for_long_key() {
        let tmp = TempDir::new().unwrap();
        let p = provider("p1", "https://x.example", "k-1234567890123456-LONG");
        let ctx = ctx_with(&tmp, serde_json::json!({}), vec![p], vec![]);
        assert!(InsecureApiKeyRule.check(&ctx).is_empty());
    }

    // ----- Rule 7 — MCP_MISSING_TRANSPORT -----

    #[test]
    fn mcp_missing_transport_hits_for_empty_command() {
        let tmp = TempDir::new().unwrap();
        let mut s = mcp_stdio("bad", "npx");
        s.command = Some("".into());
        let ctx = ctx_with(&tmp, serde_json::json!({}), vec![], vec![s]);
        let f = McpMissingTransportRule.check(&ctx);
        assert_eq!(f.len(), 1);
    }

    #[test]
    fn mcp_missing_transport_no_hit_for_valid() {
        let tmp = TempDir::new().unwrap();
        let ctx = ctx_with(
            &tmp,
            serde_json::json!({}),
            vec![],
            vec![mcp_stdio("good", "npx")],
        );
        assert!(McpMissingTransportRule.check(&ctx).is_empty());
    }

    // ----- Rule 8 — LONG_PROVIDER_NAME -----

    #[test]
    fn long_provider_name_hits_above_threshold() {
        let tmp = TempDir::new().unwrap();
        let mut p = provider("p1", "https://x.example", "k-1234567890123456");
        p.name = "A".repeat(60);
        let ctx = ctx_with(&tmp, serde_json::json!({}), vec![p], vec![]);
        let f = LongProviderNameRule.check(&ctx);
        assert_eq!(f.len(), 1);
    }

    #[test]
    fn long_provider_name_no_hit_short() {
        let tmp = TempDir::new().unwrap();
        let p = provider("p1", "https://x.example", "k-1234567890123456");
        let ctx = ctx_with(&tmp, serde_json::json!({}), vec![p], vec![]);
        assert!(LongProviderNameRule.check(&ctx).is_empty());
    }

    // ----- Rule 9 — UNUSED_BACKUP -----

    #[test]
    fn unused_backup_no_hit_when_dir_missing() {
        let tmp = TempDir::new().unwrap();
        let ctx = ctx_with(&tmp, serde_json::json!({}), vec![], vec![]);
        // Empty backups dir -> no hits.
        assert!(UnusedBackupRule.check(&ctx).is_empty());
    }

    #[test]
    fn unused_backup_apply_deletes_old_backup() {
        let tmp = TempDir::new().unwrap();
        let ctx = ctx_with(&tmp, serde_json::json!({}), vec![], vec![]);
        // Create a stale backup (set mtime to 100 days ago).
        let bak = ctx.backups_dir.join("settings.json.bak.20260101-000000");
        fs::write(&bak, "old content").unwrap();
        let stale_time = SystemTime::now() - Duration::from_secs(100 * 86400);
        // Use filetime-free approach: set via std::fs::File::set_modified
        // (stable since 1.75). If unavailable on this toolchain, skip the
        // mtime tweak and just verify apply works on an existing file.
        let f = std::fs::File::options().write(true).open(&bak).unwrap();
        let _ = f.set_modified(stale_time);
        drop(f);

        let findings = UnusedBackupRule.check(&ctx);
        // If filetime tweak landed, this fires; otherwise short-circuit
        // by manually constructing a finding.
        let finding = if findings.is_empty() {
            OptimizationFinding {
                id: finding_id(),
                rule_id: "UNUSED_BACKUP".into(),
                severity: Severity::Info,
                title: "stale".into(),
                description: "".into(),
                affected_path: bak.to_string_lossy().to_string(),
                suggested_action: "".into(),
                auto_apply: true,
            }
        } else {
            findings[0].clone()
        };
        let result = UnusedBackupRule.apply(&finding, &ctx).unwrap();
        assert!(result.applied);
        assert!(!bak.exists());
    }

    #[test]
    fn unused_backup_apply_refuses_non_bak_file() {
        let tmp = TempDir::new().unwrap();
        let ctx = ctx_with(&tmp, serde_json::json!({}), vec![], vec![]);
        let danger = ctx.backups_dir.join("settings.json"); // NOT a .bak.
        fs::write(&danger, "live!").unwrap();
        let finding = OptimizationFinding {
            id: finding_id(),
            rule_id: "UNUSED_BACKUP".into(),
            severity: Severity::Info,
            title: "".into(),
            description: "".into(),
            affected_path: danger.to_string_lossy().to_string(),
            suggested_action: "".into(),
            auto_apply: true,
        };
        let result = UnusedBackupRule.apply(&finding, &ctx).unwrap();
        assert!(!result.applied);
        assert!(danger.exists()); // not deleted
    }

    // ----- Rule 10 — LARGE_SETTINGS -----

    #[test]
    fn large_settings_hits_above_threshold() {
        let tmp = TempDir::new().unwrap();
        let claude_dir = tmp.path().join("claude");
        fs::create_dir_all(&claude_dir).unwrap();
        let settings_path = claude_dir.join("settings.json");
        fs::write(&settings_path, "x".repeat(1024 * 1024 + 100)).unwrap();
        let ctx = OptimizerContext {
            settings_json: serde_json::json!({}),
            providers: vec![],
            mcp_servers: vec![],
            claude_dir: claude_dir.clone(),
            app_data_dir: tmp.path().to_path_buf(),
            providers_dir: tmp.path().join("providers"),
            backups_dir: tmp.path().join("backups"),
            settings_path,
        };
        let f = LargeSettingsRule.check(&ctx);
        assert_eq!(f.len(), 1);
    }

    #[test]
    fn large_settings_no_hit_below_threshold() {
        let tmp = TempDir::new().unwrap();
        let ctx = ctx_with(&tmp, serde_json::json!({"env": {}}), vec![], vec![]);
        assert!(LargeSettingsRule.check(&ctx).is_empty());
    }

    // ----- Rule 11 — MISSING_ACTIVE_PROVIDER -----

    #[test]
    fn missing_active_hits_when_env_missing_and_providers_exist() {
        let tmp = TempDir::new().unwrap();
        let p = provider("p1", "https://x.example", "k-1234567890123456");
        let ctx = ctx_with(&tmp, serde_json::json!({}), vec![p], vec![]);
        let f = MissingActiveProviderRule.check(&ctx);
        assert_eq!(f.len(), 1);
    }

    #[test]
    fn missing_active_no_hit_when_env_set() {
        let tmp = TempDir::new().unwrap();
        let p = provider("p1", "https://x.example", "k-1234567890123456");
        let settings = serde_json::json!({
            "env": { "ANTHROPIC_BASE_URL": "https://x.example" }
        });
        let ctx = ctx_with(&tmp, settings, vec![p], vec![]);
        assert!(MissingActiveProviderRule.check(&ctx).is_empty());
    }

    // ----- Rule 12 — DANGLING_ACTIVE_PROVIDER -----

    #[test]
    fn dangling_active_hits_when_no_match() {
        let tmp = TempDir::new().unwrap();
        let p = provider("p1", "https://other.example", "k-1234567890123456");
        let settings = serde_json::json!({
            "env": { "ANTHROPIC_BASE_URL": "https://nope.example" }
        });
        let ctx = ctx_with(&tmp, settings, vec![p], vec![]);
        let f = DanglingActiveProviderRule.check(&ctx);
        assert_eq!(f.len(), 1);
        assert_eq!(f[0].severity, Severity::Error);
    }

    #[test]
    fn dangling_active_no_hit_when_match() {
        let tmp = TempDir::new().unwrap();
        let p = provider("p1", "https://x.example", "k-1234567890123456");
        let settings = serde_json::json!({
            "env": { "ANTHROPIC_BASE_URL": "https://x.example" }
        });
        let ctx = ctx_with(&tmp, settings, vec![p], vec![]);
        assert!(DanglingActiveProviderRule.check(&ctx).is_empty());
    }

    // ----- Rule 13 — INCONSISTENT_PROVIDER_TYPE -----

    #[test]
    fn inconsistent_type_hits_when_mixed_case() {
        let tmp = TempDir::new().unwrap();
        let mut a = provider("p1", "https://a.example", "k-1234567890123456");
        a.provider_type = "anthropic".into();
        let mut b = provider("p2", "https://b.example", "k-1234567890123456");
        b.provider_type = "Anthropic".into();
        let ctx = ctx_with(&tmp, serde_json::json!({}), vec![a, b], vec![]);
        let f = InconsistentProviderTypeRule.check(&ctx);
        // Only the non-canonical one is flagged.
        assert_eq!(f.len(), 1);
        assert!(f[0].auto_apply);
    }

    #[test]
    fn inconsistent_type_apply_lowercases_with_backup() {
        let tmp = TempDir::new().unwrap();
        let mut a = provider("p1", "https://a.example", "k-1234567890123456");
        a.provider_type = "anthropic".into();
        let mut b = provider("p2", "https://b.example", "k-1234567890123456");
        b.provider_type = "Anthropic".into();
        let ctx = ctx_with(&tmp, serde_json::json!({}), vec![a, b], vec![]);
        let findings = InconsistentProviderTypeRule.check(&ctx);
        let result = InconsistentProviderTypeRule
            .apply(&findings[0], &ctx)
            .unwrap();
        assert!(result.applied, "error = {:?}", result.error);
        assert!(result.backup_path.is_some());
        let raw = fs::read_to_string(ctx.providers_dir.join("p2.json")).unwrap();
        let v: Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(v.get("provider_type").unwrap().as_str(), Some("anthropic"));
    }

    #[test]
    fn inconsistent_type_no_hit_when_all_lowercase() {
        let tmp = TempDir::new().unwrap();
        let a = provider("p1", "https://a.example", "k-1234567890123456");
        let b = provider("p2", "https://b.example", "k-1234567890123456");
        let ctx = ctx_with(&tmp, serde_json::json!({}), vec![a, b], vec![]);
        assert!(InconsistentProviderTypeRule.check(&ctx).is_empty());
    }

    // ----- all_rules() registry sanity -----

    #[test]
    fn all_rules_returns_sixteen_unique_ids() {
        // M3.3 — 13 文件规则 + 3 env 规则 = 16。
        let rules = all_rules();
        assert_eq!(rules.len(), 16);
        let mut ids: Vec<&str> = rules.iter().map(|r| r.id()).collect();
        ids.sort();
        ids.dedup();
        assert_eq!(ids.len(), 16, "rule ids must be unique");
    }

    // ----- Rule 14 — ENV001 (CLAUDE_CODE_ATTRIBUTION_HEADER=0) -----

    #[test]
    fn env001_hits_when_attr_header_missing_or_wrong() {
        let tmp = TempDir::new().unwrap();
        // Case A: env 缺这个 key
        let ctx = ctx_with(&tmp, serde_json::json!({"env": {}}), vec![], vec![]);
        let f = AttributionHeaderEnvRule.check(&ctx);
        assert_eq!(f.len(), 1);
        assert_eq!(f[0].rule_id, "ENV001");
        assert!(f[0].auto_apply);

        // Case B: 值是 "1" 而非 "0"
        let ctx2 = ctx_with(
            &tmp,
            serde_json::json!({"env": {"CLAUDE_CODE_ATTRIBUTION_HEADER": "1"}}),
            vec![],
            vec![],
        );
        let f2 = AttributionHeaderEnvRule.check(&ctx2);
        assert_eq!(f2.len(), 1);

        // Case C: 已经是 "0" → 不触发
        let ctx3 = ctx_with(
            &tmp,
            serde_json::json!({"env": {"CLAUDE_CODE_ATTRIBUTION_HEADER": "0"}}),
            vec![],
            vec![],
        );
        assert!(AttributionHeaderEnvRule.check(&ctx3).is_empty());
    }

    #[test]
    fn env001_apply_writes_zero_with_backup() {
        let tmp = TempDir::new().unwrap();
        let settings = serde_json::json!({"env": {"ANTHROPIC_BASE_URL": "https://x"}});
        let ctx = ctx_with(&tmp, settings, vec![], vec![]);
        let findings = AttributionHeaderEnvRule.check(&ctx);
        assert_eq!(findings.len(), 1);
        let result = AttributionHeaderEnvRule.apply(&findings[0], &ctx).unwrap();
        assert!(result.applied);
        assert!(result.backup_path.is_some());

        let raw = std::fs::read_to_string(&ctx.settings_path).unwrap();
        let v: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(
            v.pointer("/env/CLAUDE_CODE_ATTRIBUTION_HEADER").unwrap().as_str(),
            Some("0")
        );
        // 原有字段不破坏
        assert_eq!(
            v.pointer("/env/ANTHROPIC_BASE_URL").unwrap().as_str(),
            Some("https://x")
        );
    }

    // ----- Rule 15 — ENV002 (CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1) -----

    #[test]
    fn env002_hits_when_traffic_var_missing() {
        let tmp = TempDir::new().unwrap();
        let ctx = ctx_with(&tmp, serde_json::json!({}), vec![], vec![]);
        let f = DisableNonessentialTrafficEnvRule.check(&ctx);
        assert_eq!(f.len(), 1);
        assert_eq!(f[0].rule_id, "ENV002");

        // 已是 "1" → 不触发
        let ctx2 = ctx_with(
            &tmp,
            serde_json::json!({"env": {"CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1"}}),
            vec![],
            vec![],
        );
        assert!(DisableNonessentialTrafficEnvRule.check(&ctx2).is_empty());
    }

    #[test]
    fn env002_apply_creates_env_section_and_writes_one() {
        let tmp = TempDir::new().unwrap();
        // settings.json 完全空对象 → apply 必须先建 env 对象
        let ctx = ctx_with(&tmp, serde_json::json!({}), vec![], vec![]);
        let findings = DisableNonessentialTrafficEnvRule.check(&ctx);
        assert_eq!(findings.len(), 1);
        let result = DisableNonessentialTrafficEnvRule.apply(&findings[0], &ctx).unwrap();
        assert!(result.applied);
        assert!(result.backup_path.is_some());

        let raw = std::fs::read_to_string(&ctx.settings_path).unwrap();
        let v: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(
            v.pointer("/env/CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC")
                .unwrap()
                .as_str(),
            Some("1")
        );
    }

    // ----- Rule 16 — ENV003 (CLAUDE_CODE_EFFORT_LEVEL=max) -----

    #[test]
    fn env003_hits_when_effort_wrong() {
        let tmp = TempDir::new().unwrap();
        let ctx = ctx_with(
            &tmp,
            serde_json::json!({"env": {"CLAUDE_CODE_EFFORT_LEVEL": "low"}}),
            vec![],
            vec![],
        );
        let f = EffortLevelMaxEnvRule.check(&ctx);
        assert_eq!(f.len(), 1);
        assert_eq!(f[0].rule_id, "ENV003");

        // 已是 "max" → 不触发
        let ctx2 = ctx_with(
            &tmp,
            serde_json::json!({"env": {"CLAUDE_CODE_EFFORT_LEVEL": "max"}}),
            vec![],
            vec![],
        );
        assert!(EffortLevelMaxEnvRule.check(&ctx2).is_empty());
    }

    #[test]
    fn env003_apply_writes_max_with_backup() {
        let tmp = TempDir::new().unwrap();
        let ctx = ctx_with(&tmp, serde_json::json!({}), vec![], vec![]);
        let findings = EffortLevelMaxEnvRule.check(&ctx);
        let result = EffortLevelMaxEnvRule.apply(&findings[0], &ctx).unwrap();
        assert!(result.applied);
        assert!(result.backup_path.is_some());

        let raw = std::fs::read_to_string(&ctx.settings_path).unwrap();
        let v: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(
            v.pointer("/env/CLAUDE_CODE_EFFORT_LEVEL").unwrap().as_str(),
            Some("max")
        );
    }

    /// ENV00x 的幂等性:连续 apply 两次,第二次返回 manual 不再写盘。
    #[test]
    fn env_rules_are_idempotent_on_second_apply() {
        let tmp = TempDir::new().unwrap();
        let ctx = ctx_with(&tmp, serde_json::json!({}), vec![], vec![]);
        let findings = AttributionHeaderEnvRule.check(&ctx);
        let first = AttributionHeaderEnvRule.apply(&findings[0], &ctx).unwrap();
        assert!(first.applied);
        let findings2 = AttributionHeaderEnvRule.check(&ctx);
        let second = AttributionHeaderEnvRule.apply(&findings2[0], &ctx).unwrap();
        assert!(!second.applied);
        assert!(second.error.is_some());
    }
}
