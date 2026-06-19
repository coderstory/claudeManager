//! F2 — Provider 切换 (stub). Action-only; no routes.

use super::super::traits::*;

pub struct ProviderSwitchPlugin;

impl IPlugin for ProviderSwitchPlugin {
    fn id(&self) -> &'static str {
        "provider-switch"
    }
    fn name(&self) -> &'static str {
        "Provider 切换"
    }
}
