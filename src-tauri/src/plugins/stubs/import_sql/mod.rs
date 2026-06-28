//! F3 — SQL 导入配置 (plugin).

pub mod commands;

use super::super::traits::*;

pub struct ImportSqlPlugin;

impl IPlugin for ImportSqlPlugin {
    fn id(&self) -> &'static str { "import-sql" }
    fn name(&self) -> &'static str { "SQL 导入配置" }
    fn routes(&self) -> Vec<PluginRoute> {
        vec![PluginRoute {
            path: "/import".to_string(),
            plugin_id: "import-sql",
            display_name: "SQL 导入配置".to_string(),
        }]
    }
}