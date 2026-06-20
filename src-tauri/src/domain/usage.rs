//! UsageSnapshot — domain model for F7 (M2.7).
//!
//! Represents one snapshot of the *active provider's* token usage
//! for a given time window (5h / 1w / 1m). The data source today
//! (M2.7) is local-only: `~/.claude/usage.json` written by Claude
//! Code itself. External provider APIs (Anthropic / OpenAI / etc)
//! are M2.8+.
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
//! - `cost_usd` — optional. Not all providers report cost.
//! - `balance_usd` — optional. Only paid providers report a balance.
//! - `timestamp` — Unix seconds the snapshot was taken (server clock,
//!   not provider clock).
//!
//! ## Frontend mirror
//!
//! The TS mirror lives at `src/types/usage.ts`. Field naming is
//! snake_case to match this struct's serde rule
//! (`#[serde(rename_all = "snake_case")]`).

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
    /// Optional cost in USD. Providers without cost reporting
    /// (e.g. local Ollama) leave this as `None`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cost_usd: Option<f64>,
    /// Optional remaining balance in USD. Paid providers only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub balance_usd: Option<f64>,
    /// Unix seconds when the snapshot was taken.
    pub timestamp: i64,
}

impl UsageSnapshot {
    /// Default empty snapshot for the given provider + window.
    /// Used when `~/.claude/usage.json` is missing or the active
    /// window field is absent — the UI still renders with zeros.
    pub fn empty(provider_id: impl Into<String>, window: UsageWindow) -> Self {
        Self {
            provider_id: provider_id.into(),
            window,
            tokens_used: 0,
            cost_usd: None,
            balance_usd: None,
            timestamp: now_unix_secs(),
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
// Tests — pin the serde shape + window parser.
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

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
            cost_usd: Some(12.34),
            balance_usd: Some(987.66),
            timestamp: 1_700_000_000,
        };
        let json = serde_json::to_string(&snap).unwrap();
        let back: UsageSnapshot = serde_json::from_str(&json).unwrap();
        assert_eq!(back, snap);
    }

    #[test]
    fn roundtrip_usage_snapshot_omits_none_fields() {
        // The skip_serializing_if on cost_usd/balance_usd keeps
        // the wire payload small when those fields are absent.
        let snap = UsageSnapshot {
            provider_id: "x".into(),
            window: UsageWindow::FiveHours,
            tokens_used: 0,
            cost_usd: None,
            balance_usd: None,
            timestamp: 1,
        };
        let v = serde_json::to_value(&snap).unwrap();
        assert!(v.get("cost_usd").is_none());
        assert!(v.get("balance_usd").is_none());
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
            cost_usd: None,
            balance_usd: None,
            timestamp: 1,
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
        assert!(snap.cost_usd.is_none());
        assert!(snap.balance_usd.is_none());
        // timestamp is now-ish (within the last few seconds).
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;
        assert!(snap.timestamp <= now && snap.timestamp > now - 5);
    }
}