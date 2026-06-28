//! F1 — Provider 列表 (plugin).

pub mod commands;

use super::super::traits::*;

pub struct ProviderListPlugin;

impl IPlugin for ProviderListPlugin {
    fn id(&self) -> &'static str { "provider-list" }
    fn name(&self) -> &'static str { "Provider 列表" }
    fn routes(&self) -> Vec<PluginRoute> {
        vec![PluginRoute {
            path: "/".to_string(),
            plugin_id: "provider-list",
            display_name: "Provider 列表".to_string(),
        }]
    }
}