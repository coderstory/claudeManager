//! F8 — 单文件部署 (stub). Build-time concern; no routes, no services.

use super::super::traits::*;

pub struct SingleFileDeployPlugin;

impl IPlugin for SingleFileDeployPlugin {
    fn id(&self) -> &'static str {
        "single-file-deploy"
    }
    fn name(&self) -> &'static str {
        "单文件部署"
    }
}
