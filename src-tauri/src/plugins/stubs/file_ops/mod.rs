//! F2/F6/F13/F18/F19 — 文件操作聚合 (plugin).

pub mod commands;

use super::super::traits::*;

pub struct FileOpsPlugin;

impl IPlugin for FileOpsPlugin {
    fn id(&self) -> &'static str { "file-ops" }
    fn name(&self) -> &'static str { "文件操作" }
    fn routes(&self) -> Vec<PluginRoute> {
        vec![PluginRoute {
            path: "/file-ops".to_string(),
            plugin_id: "file-ops",
            display_name: "文件操作".to_string(),
        }]
    }
}