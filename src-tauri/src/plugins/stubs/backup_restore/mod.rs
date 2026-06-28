//! F19 — 备份与恢复 (plugin).
//!
//! See [`commands`] for the dispatch fns and `inventory::submit!`
//! registrations. The plugin's own lifecycle (init / shutdown / routes)
//! is owned by this module.

pub mod commands;

use super::super::traits::*;

pub struct BackupRestorePlugin;

impl IPlugin for BackupRestorePlugin {
    fn id(&self) -> &'static str {
        "backup-restore"
    }
    fn name(&self) -> &'static str {
        "备份与恢复"
    }
    fn routes(&self) -> Vec<PluginRoute> {
        vec![PluginRoute {
            path: "/backup".to_string(),
            plugin_id: "backup-restore",
            display_name: "备份与恢复".to_string(),
        }]
    }
}
