//! F3 — 导入 .sql (stub).

use super::super::traits::*;

pub struct ImportSqlPlugin;

impl IPlugin for ImportSqlPlugin {
    fn id(&self) -> &'static str {
        "import-sql"
    }
    fn name(&self) -> &'static str {
        "导入 .sql"
    }
    fn routes(&self) -> Vec<PluginRoute> {
        vec![PluginRoute {
            path: "/import".to_string(),
            plugin_id: "import-sql",
            display_name: "导入 .sql".to_string(),
        }]
    }
}
