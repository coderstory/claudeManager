//! F18 — 配置优化 (stub).

use super::super::traits::*;

pub struct OptimizerPlugin;

impl IPlugin for OptimizerPlugin {
    fn id(&self) -> &'static str {
        "optimizer"
    }
    fn name(&self) -> &'static str {
        "配置优化"
    }
    fn routes(&self) -> Vec<PluginRoute> {
        vec![PluginRoute {
            path: "/optimizer".to_string(),
            plugin_id: "optimizer",
            display_name: "配置优化".to_string(),
        }]
    }
}
