//! F7 — 用量查询 (plugin).
//!
//! `commands.rs` (sibling) registers 3 `inventory::submit!(CommandSpec)`
//! entries — `get_current_usage`, `get_usage_history`, `refresh_usage` —
//! into the global dispatch table (see `crate::plugins::dispatch`).

pub mod commands;

use super::super::traits::*;

pub struct UsageQueryPlugin;

impl IPlugin for UsageQueryPlugin {
    fn id(&self) -> &'static str {
        "usage-query"
    }
    fn name(&self) -> &'static str {
        "用量查询"
    }
    /// Phase 45 — `usage-service` is the primary backing store
    /// for the 3 commands (`get_current_usage` / `get_usage_history`
    /// / `refresh_usage`). `history-service` is a secondary dep
    /// because `refresh_usage` also touches `HistoryService` for the
    /// "已写入 N 条" verify counter (Phase 27 BUG-CR-02).
    fn depends_on(&self) -> Vec<&'static str> {
        vec!["usage-service", "history-service"]
    }
    fn routes(&self) -> Vec<PluginRoute> {
        vec![PluginRoute {
            path: "/usage".to_string(),
            plugin_id: "usage-query",
            display_name: "用量查询".to_string(),
        }]
    }
}