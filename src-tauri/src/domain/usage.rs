//! UsageSnapshot — domain model for F7 (M2.7 → M3.8).
//!
//! Represents one snapshot of the *active provider's* token usage
//! for a given time window (5h / 1w / 1m). The data source as of
//! M3.8 is `~/.claude/projects/<encoded-path>/*.jsonl` (cc-switch
//! JSONL pattern), aggregated in-memory by the service. Older
//! M2.7 behaviour (read `~/.claude/usage.json`) is gone.
//!
//! ## Field semantics
//!
//! - `provider_id` — the active provider's id (so the UI can
//!   label the snapshot when the user switches providers and
//!   re-queries; not used to identify the cache key).
//! - `window` — the time window the snapshot covers. Switches
//!   between 5h / 1w / 1m invalidate the cache entry for that key.
//! - `tokens_used` — cumulative tokens for the window (u64; if
//!   missing on disk, defaults to 0).
//! - `cost_usd` — optional. Computed from builtin pricing table
//!   against model names found in JSONL.
//! - `balance_usd` — always None in M3.8 (Admin API excluded by D14).
//! - `timestamp` — Unix seconds the snapshot was taken (server clock).
//! - `breakdown` — per-model token breakdown for the window
//!   (M3.8, was a flat number in M2.7).
//!
//! ## Pricing
//!
//! M3.8 ships a hardcoded `builtin_pricing()` table covering the
//! Claude family (Sonnet 4 / Opus 4 / Haiku 4 / Sonnet 3.5 etc).
//! Unknown models → cost_usd=None but tokens_used is still counted.
//! The table is NOT user-editable in M3.8 (deferred to M4+).
//!
//! ## Frontend mirror
//!
//! The TS mirror lives at `src/types/usage.ts`. Field naming is
//! snake_case to match this struct's serde rule
//! (`#[serde(rename_all = "snake_case")`).

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

/// Time window the usage snapshot covers.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum UsageWindow {
    /// 5 hours (Claude Code's default quota window).
    #[serde(alias = "5h")]
    FiveHours,
    /// 7 days (weekly quota).
    #[serde(alias = "1w")]
    OneWeek,
    /// 30 days (monthly quota).
    #[serde(alias = "1m")]
    OneMonth,
}

impl UsageWindow {
    /// Parse a window from its lowercase string form. Strict —
    /// any other value returns `None` so the caller can surface
    /// a clear error (the command layer turns this into a
    /// user-readable "未知的窗口: '...'" message).
    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "5h" | "five_hours" | "fivehours" => Some(UsageWindow::FiveHours),
            "1w" | "one_week" | "oneweek" => Some(UsageWindow::OneWeek),
            "1m" | "one_month" | "onemonth" => Some(UsageWindow::OneMonth),
            _ => None,
        }
    }

    /// Lowercase short label used as the cache key suffix.
    pub fn as_str(&self) -> &'static str {
        match self {
            UsageWindow::FiveHours => "5h",
            UsageWindow::OneWeek => "1w",
            UsageWindow::OneMonth => "1m",
        }
    }

    /// Window length in seconds. Used by the JSONL filter
    /// (M3.8) to decide which parsed lines fall inside.
    pub fn secs(&self) -> i64 {
        match self {
            UsageWindow::FiveHours => 5 * 3600,
            UsageWindow::OneWeek => 7 * 86400,
            UsageWindow::OneMonth => 30 * 86400,
        }
    }
}

/// Pricing for one model, expressed in USD per 1M tokens.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub struct ModelPricing {
    pub input_per_million: f64,
    pub output_per_million: f64,
    pub cache_read_per_million: f64,
    pub cache_creation_per_million: f64,
}

impl ModelPricing {
    /// Cost (USD) for the given token counts under this pricing row.
    pub fn cost(
        &self,
        input: u64,
        output: u64,
        cache_read: u64,
        cache_creation: u64,
    ) -> f64 {
        let m = 1_000_000.0_f64;
        (input as f64 / m) * self.input_per_million
            + (output as f64 / m) * self.output_per_million
            + (cache_read as f64 / m) * self.cache_read_per_million
            + (cache_creation as f64 / m) * self.cache_creation_per_million
    }
}

/// Built-in pricing table (M3.8).
///
/// Values are USD per 1M tokens, derived from Claude's published
/// 2025-05 pricing. Used by the JSONL aggregator to compute
/// `cost_usd`; unknown models → cost=None, tokens still counted.
///
/// **NOT user-editable in M3.8.** Locked as `const` so M3 ship is
/// deterministic. M4+ may add a `PricingConfigPanel` (cc-switch
/// parity).
pub fn builtin_pricing() -> HashMap<&'static str, ModelPricing> {
    let mut m = HashMap::new();
    // Claude 4 family
    m.insert(
        "claude-sonnet-4-20250514",
        ModelPricing {
            input_per_million: 3.0,
            output_per_million: 15.0,
            cache_read_per_million: 0.30,
            cache_creation_per_million: 3.75,
        },
    );
    m.insert(
        "claude-opus-4-20250514",
        ModelPricing {
            input_per_million: 15.0,
            output_per_million: 75.0,
            cache_read_per_million: 1.50,
            cache_creation_per_million: 18.75,
        },
    );
    m.insert(
        "claude-haiku-4-20250514",
        ModelPricing {
            input_per_million: 1.0,
            output_per_million: 5.0,
            cache_read_per_million: 0.10,
            cache_creation_per_million: 1.25,
        },
    );
    // Claude 3.5
    m.insert(
        "claude-3-5-sonnet-20241022",
        ModelPricing {
            input_per_million: 3.0,
            output_per_million: 15.0,
            cache_read_per_million: 0.30,
            cache_creation_per_million: 3.75,
        },
    );
    m.insert(
        "claude-3-5-haiku-20241022",
        ModelPricing {
            input_per_million: 0.80,
            output_per_million: 4.0,
            cache_read_per_million: 0.08,
            cache_creation_per_million: 1.0,
        },
    );
    // DeepSeek family (per cc-switch usage data, accessed via Anthropic-compatible)
    m.insert(
        "deepseek-v4-pro",
        ModelPricing {
            input_per_million: 0.27,
            output_per_million: 1.10,
            cache_read_per_million: 0.07,
            cache_creation_per_million: 0.27,
        },
    );
    m
}

/// Lookup pricing for a model name. Returns `None` for unknown
/// models — the caller should set `cost_usd=None` but still
/// display `tokens_used`.
pub fn lookup_pricing(model: &str) -> Option<ModelPricing> {
    builtin_pricing().get(model).copied()
}

/// One usage snapshot for the *active* provider.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub struct UsageSnapshot {
    /// Active provider id (for UI labeling on switch).
    pub provider_id: String,
    /// Time window the snapshot covers.
    pub window: UsageWindow,
    /// Cumulative tokens used in this window.
    pub tokens_used: u64,
    /// Unix seconds when the snapshot was taken.
    pub timestamp: i64,
    /// Per-model token breakdown (M3.8). Sorted by tokens desc
    /// in the wire payload so the UI can render a stable table
    /// without re-sorting.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub breakdown: Vec<UsageBreakdownEntry>,
    /// M3.8 — distinct models that contributed to the snapshot.
    #[serde(default, skip_serializing_if = "is_zero")]
    pub model_count: u32,
    /// Phase 27 Fix 2 (BUG-CR-02 / D-09) — number of rows written
    /// to `usage_history` by this refresh cycle. Surfaced in the UI
    /// so the user sees "已写入 N 条" instead of an opaque
    /// "imported 0" / silent no-op (CLAUDE.md §7 — never silently
    /// swallow failures). Default = 0 so older callers / mock
    /// fixtures don't need to populate the field.
    #[serde(default, skip_serializing_if = "is_zero_usize")]
    pub inserted_rows: usize,
}

fn is_zero(v: &u32) -> bool {
    *v == 0
}

fn is_zero_usize(v: &usize) -> bool {
    *v == 0
}

/// One row in the per-model breakdown table (M3.8).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub struct UsageBreakdownEntry {
    /// Model name as written in the JSONL `message.model` field
    /// (e.g. `claude-sonnet-4-20250514`).
    pub model: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read_tokens: u64,
    pub cache_creation_tokens: u64,
    pub total_tokens: u64,
    /// Number of distinct message IDs aggregated into this row.
    pub message_count: u32,
}

/// History entry — one row per JSONL file (M3.8 ship simplification).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub struct UsageHistoryEntry {
    /// ISO date (YYYY-MM-DD) the file's last assistant message
    /// was timestamped. Used for the per-day bucket in the chart.
    pub date: String,
    pub model: String,
    pub tokens: u64,
}

impl UsageSnapshot {
    /// Default empty snapshot for the given provider + window.
    /// Used when no JSONL data exists or no usage in window.
    pub fn empty(provider_id: impl Into<String>, window: UsageWindow) -> Self {
        Self {
            provider_id: provider_id.into(),
            window,
            tokens_used: 0,
            timestamp: now_unix_secs(),
            breakdown: Vec::new(),
            model_count: 0,
            // Phase 27 Fix 2 (BUG-CR-02 / D-09) — empty snapshot has
            // no rows to count. `refresh_usage` overrides this with
            // the actual inserted count from `HistoryService`.
            inserted_rows: 0,
        }
    }
}

/// Cheap Unix-seconds-now. Pulled out so the unit tests can
/// substitute a fake clock without `std::time::SystemTime` mocking.
fn now_unix_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

// ---------------------------------------------------------------------------
// Tests — pin the serde shape + window parser + pricing helpers.
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn window_secs_matches_documented_values() {
        assert_eq!(UsageWindow::FiveHours.secs(), 5 * 3600);
        assert_eq!(UsageWindow::OneWeek.secs(), 7 * 86400);
        assert_eq!(UsageWindow::OneMonth.secs(), 30 * 86400);
    }

    #[test]
    fn builtin_pricing_covers_documented_models() {
        let p = builtin_pricing();
        assert!(p.contains_key("claude-sonnet-4-20250514"));
        assert!(p.contains_key("claude-opus-4-20250514"));
        assert!(p.contains_key("claude-haiku-4-20250514"));
        assert!(p.contains_key("claude-3-5-sonnet-20241022"));
        assert!(p.contains_key("claude-3-5-haiku-20241022"));
        assert!(p.contains_key("deepseek-v4-pro"));
    }

    #[test]
    fn lookup_pricing_returns_some_for_known_model() {
        let p = lookup_pricing("claude-sonnet-4-20250514").unwrap();
        assert_eq!(p.input_per_million, 3.0);
        assert_eq!(p.output_per_million, 15.0);
    }

    #[test]
    fn lookup_pricing_returns_none_for_unknown_model() {
        assert!(lookup_pricing("some-future-model-2099").is_none());
        assert!(lookup_pricing("").is_none());
    }

    #[test]
    fn model_pricing_cost_uses_per_million_divisor() {
        let p = ModelPricing {
            input_per_million: 3.0,
            output_per_million: 15.0,
            cache_read_per_million: 0.30,
            cache_creation_per_million: 3.75,
        };
        // 1M input tokens @ $3 / M = $3.00
        // 1M output tokens @ $15 / M = $15.00
        // 1M cache_read @ $0.30 / M = $0.30
        // 1M cache_creation @ $3.75 / M = $3.75
        let cost = p.cost(1_000_000, 1_000_000, 1_000_000, 1_000_000);
        assert!((cost - 22.05).abs() < 1e-6);
    }

    #[test]
    fn serialize_window_lowercase() {
        // The window tag itself uses rename_all = "lowercase".
        // On the wire we use the *short* label (5h/1w/1m) — see
        // UsageWindow::as_str. So when serialising a Snapshot via
        // `#[serde(rename_all = "snake_case")]` on the outer
        // struct, the `window` field serialises the variant
        // *name* (lowercased: "five_hours"). That's fine — both
        // shapes parse back via the from_str helper + aliases.
        let v = serde_json::to_value(UsageWindow::FiveHours).unwrap();
        assert_eq!(v, serde_json::Value::String("five_hours".into()));

        let v = serde_json::to_value(UsageWindow::OneWeek).unwrap();
        assert_eq!(v, serde_json::Value::String("one_week".into()));

        let v = serde_json::to_value(UsageWindow::OneMonth).unwrap();
        assert_eq!(v, serde_json::Value::String("one_month".into()));
    }

    #[test]
    fn from_str_accepts_short_and_long_forms() {
        assert_eq!(UsageWindow::from_str("5h"), Some(UsageWindow::FiveHours));
        assert_eq!(UsageWindow::from_str("1w"), Some(UsageWindow::OneWeek));
        assert_eq!(UsageWindow::from_str("1m"), Some(UsageWindow::OneMonth));
        assert_eq!(
            UsageWindow::from_str("five_hours"),
            Some(UsageWindow::FiveHours)
        );
        assert_eq!(UsageWindow::from_str("one_week"), Some(UsageWindow::OneWeek));
        assert_eq!(
            UsageWindow::from_str("one_month"),
            Some(UsageWindow::OneMonth)
        );
        assert_eq!(UsageWindow::from_str(""), None);
        assert_eq!(UsageWindow::from_str("garbage"), None);
    }

    #[test]
    fn roundtrip_usage_snapshot() {
        let snap = UsageSnapshot {
            provider_id: "anthropic-prod".into(),
            window: UsageWindow::OneWeek,
            tokens_used: 123_456,
            timestamp: 1_700_000_000,
            breakdown: vec![UsageBreakdownEntry {
                model: "claude-sonnet-4-20250514".into(),
                input_tokens: 100_000,
                output_tokens: 23_456,
                cache_read_tokens: 0,
                cache_creation_tokens: 0,
                total_tokens: 123_456,
                message_count: 17,
            }],
            model_count: 1,
            inserted_rows: 3,
        };
        let json = serde_json::to_string(&snap).unwrap();
        let back: UsageSnapshot = serde_json::from_str(&json).unwrap();
        assert_eq!(back, snap);
    }

    #[test]
    fn roundtrip_usage_snapshot_omits_none_fields() {
        let snap = UsageSnapshot {
            provider_id: "x".into(),
            window: UsageWindow::FiveHours,
            tokens_used: 0,
            timestamp: 1,
            breakdown: Vec::new(),
            model_count: 0,
            inserted_rows: 0,
        };
        let v = serde_json::to_value(&snap).unwrap();
        assert!(v.get("breakdown").is_some());
        assert!(v.get("breakdown").is_none());
        assert!(v.get("model_count").is_none());
        assert_eq!(v["tokens_used"], 0);
        assert_eq!(v["timestamp"], 1);
    }

    #[test]
    fn partial_eq_for_testing() {
        // Two snapshots that differ only in provider_id are NOT equal.
        let a = UsageSnapshot {
            provider_id: "a".into(),
            window: UsageWindow::FiveHours,
            tokens_used: 1,
            timestamp: 1,
            breakdown: Vec::new(),
            model_count: 0,
            inserted_rows: 0,
        };
        let b = UsageSnapshot {
            provider_id: "b".into(),
            ..a.clone()
        };
        assert_ne!(a, b);
        let c = a.clone();
        assert_eq!(a, c);
    }

    #[test]
    fn empty_helper_returns_zero_tokens_with_timestamp_now() {
        let snap = UsageSnapshot::empty("p", UsageWindow::FiveHours);
        assert_eq!(snap.provider_id, "p");
        assert_eq!(snap.window, UsageWindow::FiveHours);
        assert_eq!(snap.tokens_used, 0);
        assert!(snap.breakdown.is_empty());
        assert_eq!(snap.model_count, 0);
        // timestamp is now-ish (within the last few seconds).
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;
        assert!(snap.timestamp <= now && snap.timestamp > now - 5);
    }
}