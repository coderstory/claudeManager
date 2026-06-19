//! F17 — 资源市场 (stub).

use super::super::traits::*;

pub struct MarketplacePlugin;

impl IPlugin for MarketplacePlugin {
    fn id(&self) -> &'static str {
        "marketplace"
    }
    fn name(&self) -> &'static str {
        "资源市场"
    }
    fn routes(&self) -> Vec<PluginRoute> {
        vec![PluginRoute {
            path: "/marketplace".to_string(),
            plugin_id: "marketplace",
            display_name: "资源市场".to_string(),
        }]
    }
}
