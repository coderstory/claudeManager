//! F16 — 资源浏览 (stub).

use super::super::traits::*;

pub struct ResourceBrowserPlugin;

impl IPlugin for ResourceBrowserPlugin {
    fn id(&self) -> &'static str {
        "resource-browser"
    }
    fn name(&self) -> &'static str {
        "资源浏览"
    }
    fn routes(&self) -> Vec<PluginRoute> {
        vec![PluginRoute {
            path: "/resources".to_string(),
            plugin_id: "resource-browser",
            display_name: "资源浏览".to_string(),
        }]
    }
}
