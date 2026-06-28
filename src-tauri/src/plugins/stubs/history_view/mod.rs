//! F21 — 历史查询 (plugin).

pub mod commands;

use super::super::traits::*;

pub struct HistoryViewPlugin;

impl IPlugin for HistoryViewPlugin {
    fn id(&self) -> &'static str { "history-view" }
    fn name(&self) -> &'static str { "历史查询" }
    fn routes(&self) -> Vec<PluginRoute> {
        vec![PluginRoute {
            path: "/history".to_string(),
            plugin_id: "history-view",
            display_name: "历史查询".to_string(),
        }]
    }
}