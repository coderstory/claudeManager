//! F6 — MCP 管理 (stub).

pub mod commands;

use super::super::traits::*;

pub struct McpManagementPlugin;

impl IPlugin for McpManagementPlugin {
    fn id(&self) -> &'static str {
        "mcp-management"
    }
    fn name(&self) -> &'static str {
        "MCP 管理"
    }
    /// Phase 45 — all 7 mcp commands go through `McpService::with_root(...)`.
    /// Note: this plugin is scheduled for deletion in Phase 46
    /// (D-44-A — direct command surface, no need for plugin wrapping).
    fn depends_on(&self) -> Vec<&'static str> {
        vec!["mcp-service"]
    }
    fn routes(&self) -> Vec<PluginRoute> {
        vec![PluginRoute {
            path: "/mcp".to_string(),
            plugin_id: "mcp-management",
            display_name: "MCP 管理".to_string(),
        }]
    }
}
