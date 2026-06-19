//! F6 — MCP 管理 (stub).

use super::super::traits::*;

pub struct McpManagementPlugin;

impl IPlugin for McpManagementPlugin {
    fn id(&self) -> &'static str {
        "mcp-management"
    }
    fn name(&self) -> &'static str {
        "MCP 管理"
    }
    fn routes(&self) -> Vec<PluginRoute> {
        vec![PluginRoute {
            path: "/mcp".to_string(),
            plugin_id: "mcp-management",
            display_name: "MCP 管理".to_string(),
        }]
    }
}
