//! F3 — SQL导入配置 (stub).

use super::super::traits::*;

pub struct ImportSqlPlugin;

impl IPlugin for ImportSqlPlugin {
    fn id(&self) -> &'static str {
        "import-sql"
    }
    fn name(&self) -> &'static str {
        "SQL导入配置"
    }
    fn routes(&self) -> Vec<PluginRoute> {
        vec![PluginRoute {
            path: "/import".to_string(),
            plugin_id: "import-sql",
            display_name: "SQL导入配置".to_string(),
        }]
    }
}
