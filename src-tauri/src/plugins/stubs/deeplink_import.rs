//! F4 — Deeplink 导入 (stub). Action-only; no routes.

use super::super::traits::*;

pub struct DeeplinkImportPlugin;

impl IPlugin for DeeplinkImportPlugin {
    fn id(&self) -> &'static str {
        "deeplink-import"
    }
    fn name(&self) -> &'static str {
        "Deeplink 导入"
    }
}
