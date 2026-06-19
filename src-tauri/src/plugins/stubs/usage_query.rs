//! F7 — 用量查询 (stub). Frontend-only (lives inside the detail view).

use super::super::traits::*;

pub struct UsageQueryPlugin;

impl IPlugin for UsageQueryPlugin {
    fn id(&self) -> &'static str {
        "usage-query"
    }
    fn name(&self) -> &'static str {
        "用量查询"
    }
}
