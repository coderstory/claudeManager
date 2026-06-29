//! Provider — domain model (M2.1, F1+F2).
//!
//! SPEC §2.1 is the contract; this module owns the Rust representation.
//! The on-disk shape lives at `<app-data>/providers/<id>.json` (see SPEC §2.2
//! and the F1+F2 dataflow in `docs/design/M2.1-dataflow.md`).
//!
//! Conventions:
//! - Field names use snake_case in Rust; `#[serde(rename_all = "snake_case")]`
//!   keeps the on-disk JSON in the same shape as the TS mirror in
//!   `src/types/provider.ts` (which converts to camelCase per its own rules).
//! - `is_active` is a *cached* flag. The source of truth is
//!   `~/.claude/settings.json`'s `env.ANTHROPIC_BASE_URL` — see SPEC §2.3
//!   and `ProviderService::recompute_active`. This field is set when
//!   `from_json_file` is called and re-set on every `list_providers`.
//! - All I/O goes through [`from_json_file`] / [`to_json_file`], which
//!   return [`ProviderError`]. No code in this module calls `std::fs`
//!   directly — `ProviderService` owns the directory-level operations.

use std::path::Path;

use serde::{de::Error as _, Deserialize, Serialize};
use thiserror::Error;

/// Provider entry in the local library (SPEC §2.1).
///
/// One JSON file per provider at `<app-data>/providers/<id>.json`. The
/// `id` field is the on-disk filename stem.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct Provider {
    /// Unique kebab-case id; matches the filename stem.
    /// SPEC §2.1: `[a-z0-9-_]`. We enforce kebab-case in [`Provider::validate_id`].
    pub id: String,
    /// Display name (e.g. "GLM-4.6 官方").
    pub name: String,
    /// Provider type — drives usage query routing in F7 (M2.3+).
    /// Common values: "anthropic", "openai", "deepseek", "custom".
    pub provider_type: String,
    /// `ANTHROPIC_BASE_URL` — what gets written to settings.json on switch.
    pub api_base: String,
    /// `ANTHROPIC_AUTH_TOKEN`. **Never log this**; UI masks it in M2.5+.
    pub api_key: String,
    /// 4-tier + custom model mapping (ANTHROPIC_MODEL + DEFAULT_HAIKU/SONNET/OPUS + by_tier).
    /// See [`ProviderModels`] for the structured representation.
    #[serde(default)]
    pub models: ProviderModels,
    /// Cached flag — see module docs. Re-computed by [`ProviderService::list_providers`].
    #[serde(default)]
    pub is_active: bool,
    /// Unix seconds (NOT milliseconds — SPEC §2.1 says datetime, Claude Code's
    /// own config files use ISO 8601 strings; we use Unix seconds for the local
    /// library because it's sortable + serialisation-stable across Rust upgrades).
    pub created_at: i64,
    /// Unix seconds of last successful switch. `None` = never used.
    #[serde(default)]
    pub last_used_at: Option<i64>,
    /// Free-text user note.
    #[serde(default)]
    pub notes: Option<String>,
}

/// Errors from Provider (de)serialisation. I/O errors bubble up via
/// `ProviderError::Io` so callers can distinguish "bad JSON" from "disk error".
#[derive(Debug, Error)]
pub enum ProviderError {
    /// `std::fs` error (read, write, metadata).
    #[error("provider I/O error: {0}")]
    Io(#[from] std::io::Error),

    /// `serde_json` error (malformed JSON, wrong types, missing required fields).
    #[error("provider JSON error: {0}")]
    Json(#[from] serde_json::Error),

    /// The id fails SPEC §2.1 validation (`[a-z0-9-_]`).
    #[error("invalid provider id '{0}': must match [a-z0-9-_]+")]
    InvalidId(String),

    /// `import_single_provider` refused because a file with the
    /// requested id already exists. M2.3 ships a "deny" policy;
    /// M2.5+ will offer an overwrite path.
    #[error("provider '{0}' already exists")]
    AlreadyExists(String),

    /// M3.6 (清单 22) — CRUD 操作的"id 不在库中"业务错。
    /// 与 `Io(NotFound)` 区分:后者是磁盘层错(如权限),前者是
    /// 业务层"id 不在库中"——前端可以据此显示"provider X 未找到"。
    #[error("provider '{0}' not found")]
    NotFound(String),

    /// M3.6 — 删除当前激活的 provider 是被拒的(避免下次启动
    /// 找不到对应 base_url);用户必须先切走。
    #[error("cannot delete the currently active provider '{0}'; switch to another first")]
    CannotDeleteActive(String),
}

/// M3.6 (清单 22) — 新增 / 修改 provider 的输入。
///
/// 字段语义对照 SPEC §2.1:
/// - `id`: 唯一, kebab-case, 写盘文件名 stem
/// - `name`: 显示名
/// - `base_url`: ANTHROPIC_BASE_URL
/// - `api_key`: ANTHROPIC_AUTH_TOKEN (本字段值, 写在 settings.json 中)
/// - `model`: 主模型; 空 = 不写 ANTHROPIC_MODEL (跟 F2 switch 一致)
/// - `notes`: 备注
///
/// 不包含 `is_active` / `created_at` / `last_used_at` —— 这 3 个由
/// service 层管理(见 [`crate::services::provider_service`] 的 CRUD method)。
/// M4.6.1 — 4-tier Claude Code model mapping.
///
/// Claude Code `~/.claude/settings.json` env has 5 ANTHROPIC model keys:
///   - `ANTHROPIC_MODEL`                    → default  (required)
///   - `ANTHROPIC_DEFAULT_HAIKU_MODEL`      → haiku
///   - `ANTHROPIC_DEFAULT_SONNET_MODEL`     → sonnet
///   - `ANTHROPIC_DEFAULT_OPUS_MODEL`       → opus
///   - `ANTHROPIC_DEFAULT_<CUSTOM>_MODEL`   → e.g. fable (user-defined, see by_tier)
///
/// `Provider.models` stores the structured mapping. `default` is
/// serialized to `ANTHROPIC_MODEL`; `by_tier` keys (lowercase) are
/// serialized to `ANTHROPIC_DEFAULT_<UPPER>_MODEL`. switch_provider
/// writes all present fields back to settings.json.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
// Eq not derived: by_tier is HashMap which doesn't impl Eq.
// Use PartialEq for == checks; for exact equality use serde_json.
#[serde(rename_all = "snake_case")]
pub struct ProviderModels {
    /// Primary model id (ANTHROPIC_MODEL). Required.
    #[serde(default)]
    pub default: String,
    /// Haiku tier (ANTHROPIC_DEFAULT_HAIKU_MODEL).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub haiku: Option<String>,
    /// Sonnet tier (ANTHROPIC_DEFAULT_SONNET_MODEL).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sonnet: Option<String>,
    /// Opus tier (ANTHROPIC_DEFAULT_OPUS_MODEL).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub opus: Option<String>,
    /// User-defined tiers (lowercase key → model id), serialized to
    /// `ANTHROPIC_DEFAULT_<UPPER>_<KEY>_MODEL`. Used for custom
    /// Claude Code builds with extra model slots (e.g. "fable").
    #[serde(default, skip_serializing_if = "std::collections::HashMap::is_empty")]
    pub by_tier: std::collections::HashMap<String, String>,
}

impl ProviderModels {
    /// Read all 5 ANTHROPIC_*_MODEL env keys from a parsed settings.json
    /// `env` object. `default` is the raw `ANTHROPIC_MODEL`; each tier
    /// key is the lowercase part after `ANTHROPIC_DEFAULT_` and before
    /// `_MODEL` (e.g. "haiku" from `ANTHROPIC_DEFAULT_HAIKU_MODEL`).
    pub fn from_env(env: &serde_json::Map<String, serde_json::Value>) -> Self {
        let default = env
            .get("ANTHROPIC_MODEL")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let mut models = Self {
            default,
            ..Default::default()
        };
        for (k, v) in env {
            if let Some(tier) = k
                .strip_prefix("ANTHROPIC_DEFAULT_")
                .and_then(|s| s.strip_suffix("_MODEL"))
            {
                if let Some(s) = v.as_str() {
                    let tier_lc = tier.to_lowercase();
                    match tier_lc.as_str() {
                        "haiku" => models.haiku = Some(s.to_string()),
                        "sonnet" => models.sonnet = Some(s.to_string()),
                        "opus" => models.opus = Some(s.to_string()),
                        _ => {
                            models.by_tier.insert(tier_lc, s.to_string());
                        }
                    }
                }
            }
        }
        models
    }

    /// Serialize to the same env shape (ANTHROPIC_MODEL + ANTHROPIC_DEFAULT_*_MODEL).
    /// Returns a `serde_json::Value::Object` for merging into settings.json
    /// `env`. Skips empty / None values.
    pub fn to_env_json(&self) -> serde_json::Map<String, serde_json::Value> {
        let mut m = serde_json::Map::new();
        if !self.default.is_empty() {
            m.insert(
                "ANTHROPIC_MODEL".into(),
                serde_json::Value::String(self.default.clone()),
            );
        }
        if let Some(v) = &self.haiku {
            m.insert(
                "ANTHROPIC_DEFAULT_HAIKU_MODEL".into(),
                serde_json::Value::String(v.clone()),
            );
        }
        if let Some(v) = &self.sonnet {
            m.insert(
                "ANTHROPIC_DEFAULT_SONNET_MODEL".into(),
                serde_json::Value::String(v.clone()),
            );
        }
        if let Some(v) = &self.opus {
            m.insert(
                "ANTHROPIC_DEFAULT_OPUS_MODEL".into(),
                serde_json::Value::String(v.clone()),
            );
        }
        for (tier, model) in &self.by_tier {
            if !model.is_empty() {
                m.insert(
                    format!("ANTHROPIC_DEFAULT_{}_MODEL", tier.to_uppercase()),
                    serde_json::Value::String(model.clone()),
                );
            }
        }
        m
    }

    /// Total count of populated model slots.
    pub fn count(&self) -> usize {
        let mut n = if self.default.is_empty() { 0 } else { 1 };
        if self.haiku.is_some() { n += 1; }
        if self.sonnet.is_some() { n += 1; }
        if self.opus.is_some() { n += 1; }
        n + self.by_tier.len()
    }
}

/// M3.6 (清单 22) — 新增 / 修改 provider 的输入。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ProviderInput {
    pub id: String,
    pub name: String,
    pub base_url: String,
    pub api_key: String,
    /// 4-tier + custom model mapping (ANTHROPIC_MODEL + DEFAULT_HAIKU/SONNET/OPUS + by_tier).
    pub models: ProviderModels,
    pub notes: Option<String>,
}

impl Provider {
    /// Construct a new provider with `created_at = now` and `is_active = false`.
    /// Use this when the user adds a provider via M2.3+ (out of M2.1 scope but
    /// included so the type is self-contained).
    pub fn new(
        id: impl Into<String>,
        name: impl Into<String>,
        provider_type: impl Into<String>,
        api_base: impl Into<String>,
        api_key: impl Into<String>,
    ) -> Self {
        Self {
            id: id.into(),
            name: name.into(),
            provider_type: provider_type.into(),
            api_base: api_base.into(),
            api_key: api_key.into(),
            models: ProviderModels::default(),
            is_active: false,
            created_at: now_unix_secs(),
            last_used_at: None,
            notes: None,
        }
    }

    /// Read a provider from a JSON file on disk.
    ///
    /// `path` should be the full file path (typically
    /// `<app-data>/providers/<id>.json`). The `id` field inside the file
    /// is *not* required to match the filename — we trust the file
    /// contents (a rename of the file would invalidate the link, but the
    /// file still contains the canonical id).
    pub fn from_json_file(path: &Path) -> Result<Self, ProviderError> {
        let bytes = std::fs::read(path)?;
        let p: Provider = serde_json::from_slice(&bytes)?;
        p.validate()?;
        Ok(p)
    }

    /// Write a provider to a JSON file on disk (pretty-printed, 2-space indent —
    /// matches SPEC §2.2 "human-readable").
    ///
    /// **NOT atomic on its own.** For atomic write + backup use
    /// [`crate::infrastructure::fs_atomic::write_with_backup`]. This method
    /// exists so the `ProviderService` can write per-provider files with a
    /// single call (small files, low blast radius) — settings.json, which
    /// is shared with Claude Code, MUST go through `fs_atomic`.
    ///
    /// **Caller responsibility** (M6 audit H1 / phase 32-02): production
    /// code paths in `provider_service.rs` already wrap provider-file
    /// writes in `fs_atomic::write_with_backup` — see
    /// `import_single_provider`, `add_provider`, `update_provider`, and
    /// `import_providers_from_sql*`, all of which call
    /// `fs_atomic::write_with_backup(&target, &json)` directly (NOT this
    /// method). This `to_json_file` only does a plain `std::fs::write` and
    /// is preserved for test fixtures that write directly to disk without
    /// the backup ceremony. The two `switch_provider*` paths DO call this
    /// method to stamp `last_used_at` — that step-5 write is the subject
    /// of P1-04 (rollback on failure), not this fix.
    pub fn to_json_file(&self, path: &Path) -> Result<(), ProviderError> {
        let json = serde_json::to_string_pretty(self)?;
        std::fs::write(path, json)?;
        Ok(())
    }

    /// Validate the provider's invariants. Currently checks:
    /// - `id` matches `[a-z0-9-_]+` (SPEC §2.1)
    /// - `api_base` is non-empty
    /// - `name` is non-empty
    fn validate(&self) -> Result<(), ProviderError> {
        if !is_valid_id(&self.id) {
            return Err(ProviderError::InvalidId(self.id.clone()));
        }
        if self.name.is_empty() {
            return Err(ProviderError::Json(serde_json::Error::custom(
                "provider name must not be empty",
            )));
        }
        if self.api_base.is_empty() {
            return Err(ProviderError::Json(serde_json::Error::custom(
                "provider api_base must not be empty",
            )));
        }
        Ok(())
    }
}

/// SPEC §2.1: provider id is `[a-z0-9-_]+` (lowercase, digits, dash, underscore).
pub fn is_valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_')
}

/// Unix seconds — same as `chrono::Utc::now().timestamp()` but without
/// pulling chrono as a dependency for one call. M1.6 already locks all
/// dependency versions; adding chrono just for this isn't justified
/// (CLAUDE.md §2.3: "禁止依赖不行就换版本").
fn now_unix_secs() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

// ---------------------------------------------------------------------------
// Tests — TDD coverage for the domain model.
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    /// Build a sample provider that round-trips cleanly.
    fn sample() -> Provider {
        Provider {
            id: "glm-46-official".into(),
            name: "GLM-4.6 官方".into(),
            provider_type: "anthropic".into(),
            api_base: "https://api.anthropic.com".into(),
            api_key: "sk-ant-test-token".into(),
            models: ProviderModels {
                default: "claude-opus-4".into(),
                sonnet: Some("claude-sonnet-4-6".into()),
                ..Default::default()
            },
            is_active: false,
            created_at: 1_700_000_000,
            last_used_at: None,
            notes: Some("官方默认".into()),
        }
    }

    #[test]
    fn from_json_file_valid_returns_provider() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("glm-46-official.json");
        let p = sample();
        p.to_json_file(&path).unwrap();

        let loaded = Provider::from_json_file(&path).unwrap();
        assert_eq!(loaded.id, "glm-46-official");
        assert_eq!(loaded.name, "GLM-4.6 官方");
        assert_eq!(loaded.provider_type, "anthropic");
        assert_eq!(loaded.api_base, "https://api.anthropic.com");
        assert_eq!(loaded.api_key, "sk-ant-test-token");
        assert_eq!(loaded.models.default, "claude-opus-4");
        assert_eq!(loaded.models.sonnet.as_deref(), Some("claude-sonnet-4-6"));
        assert_eq!(loaded.created_at, 1_700_000_000);
        assert_eq!(loaded.notes.as_deref(), Some("官方默认"));
    }

    #[test]
    fn from_json_file_invalid_id_errors() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("bad.json");
        // Uppercase + space — both fail SPEC §2.1 validation.
        let json = r#"{
            "id": "GLM 4.6",
            "name": "test",
            "provider_type": "anthropic",
            "api_base": "https://x",
            "api_key": "k",
            "created_at": 1
        }"#;
        std::fs::write(&path, json).unwrap();
        let err = Provider::from_json_file(&path).unwrap_err();
        assert!(matches!(err, ProviderError::InvalidId(_)));
    }

    #[test]
    fn from_json_file_missing_required_field_errors() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("missing.json");
        // `name` missing.
        let json = r#"{
            "id": "test",
            "provider_type": "anthropic",
            "api_base": "https://x",
            "api_key": "k",
            "created_at": 1
        }"#;
        std::fs::write(&path, json).unwrap();
        let err = Provider::from_json_file(&path).unwrap_err();
        assert!(matches!(err, ProviderError::Json(_)));
    }

    #[test]
    fn roundtrip_preserves_all_fields() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("rt.json");
        let original = sample();
        original.to_json_file(&path).unwrap();
        let restored = Provider::from_json_file(&path).unwrap();
        assert_eq!(restored, original);
    }

    #[test]
    fn roundtrip_with_minimal_fields() {
        // Only the required fields populated; defaults fill the rest.
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("min.json");
        let json = r#"{
            "id": "minimal",
            "name": "Min",
            "provider_type": "custom",
            "api_base": "https://x.example",
            "api_key": "k",
            "created_at": 42
        }"#;
        std::fs::write(&path, json).unwrap();
        let p = Provider::from_json_file(&path).unwrap();
        assert_eq!(p.id, "minimal");
        assert_eq!(p.created_at, 42);
        assert_eq!(p.models, ProviderModels::default());
        assert_eq!(p.is_active, false);
        assert_eq!(p.last_used_at, None);
        assert_eq!(p.notes, None);
    }

    #[test]
    fn is_valid_id_accepts_kebab_case_and_underscore() {
        for id in ["a", "abc", "a-b-c", "a_b_c", "deepseek-v3", "x1_y2-z3"] {
            assert!(is_valid_id(id), "should accept: {id}");
        }
    }

    #[test]
    fn is_valid_id_rejects_uppercase_space_and_punctuation() {
        for id in ["", "ABC", "abc def", "abc.def", "abc/def", "中文id"] {
            assert!(!is_valid_id(id), "should reject: {id}");
        }
    }

    #[test]
    fn new_provider_populates_created_at_and_default_flags() {
        use std::time::{SystemTime, UNIX_EPOCH};
        let before: i64 = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;
        let p = Provider::new("new-id", "name", "anthropic", "https://x", "k");
        assert_eq!(p.id, "new-id");
        assert_eq!(p.is_active, false);
        assert_eq!(p.last_used_at, None);
        assert_eq!(p.notes, None);
        assert_eq!(p.models, ProviderModels::default());
        // created_at must be (a) at or after `before`,
        // (b) within a few seconds of `before` (call latency).
        let after: i64 = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;
        assert!(p.created_at >= before);
        assert!(p.created_at <= after + 5);
    }

    #[test]
    fn validate_rejects_empty_name_or_api_base() {
        let mut p = sample();
        p.name = "".into();
        let err = p.validate().unwrap_err();
        assert!(matches!(err, ProviderError::Json(_)));

        let mut p = sample();
        p.api_base = "".into();
        let err = p.validate().unwrap_err();
        assert!(matches!(err, ProviderError::Json(_)));
    }

    #[test]
    fn to_json_file_uses_2_space_indent_and_is_human_readable() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("pretty.json");
        let p = sample();
        p.to_json_file(&path).unwrap();
        let raw = std::fs::read_to_string(&path).unwrap();
        // SPEC §2.2: "2 空格缩进,人类可读"
        assert!(raw.contains("  \"id\":"), "expected 2-space indent, got:\n{raw}");
        // snake_case field names on disk
        assert!(raw.contains("\"api_base\":"));
        assert!(raw.contains("\"provider_type\":"));
        assert!(raw.contains("\"is_active\":"));
    }

    #[test]
    fn from_json_file_handles_nonexistent_path() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("does-not-exist.json");
        let err = Provider::from_json_file(&path).unwrap_err();
        assert!(matches!(err, ProviderError::Io(_)));
    }
}