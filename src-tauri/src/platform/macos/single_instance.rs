//! macOS 占位实现 of [`IPlatformSingleInstance`]。
//!
//! M2.16 — 单实例锁实际由 `tauri-plugin-single-instance` 跨平台负责
//! （`lib.rs` 注册 `.plugin(tauri_plugin_single_instance::init(...))`，
//! Win + Mac 都走 plugin，绕过本 trait）。本 trait 保留为 platform 抽象层
//! 接口占位：`runtime::single_instance()` 工厂仍按 target_os 返回
//! `MacSingleInstance`，但当前无业务代码调用该工厂（lib.rs 直接用 plugin）。
//!
//! `try_acquire` 返回 no-op guard 表示"占位通过"。若未来需要绕过 plugin
//! 自管锁（如 NSAppleEventManager + kAEGetURL 转发 .sql 双击到已运行
//! 实例），在此替换为真实 NSLock / pthread_mutex 实现。

use crate::platform::traits::{
    IPlatformSingleInstance, PlatformError, SingleInstanceGuard,
};

pub struct MacSingleInstance;

impl IPlatformSingleInstance for MacSingleInstance {
    fn try_acquire(&self) -> Result<SingleInstanceGuard, PlatformError> {
        // 单实例语义已由 tauri-plugin-single-instance 负责（见 lib.rs），
        // 此处返回 no-op guard 保留 trait 结构，避免 unimplemented! panic。
        //
        // 平台分支与 traits.rs `from_stub()` 的 cfg gate 对齐：
        // - 非 Windows（macOS）build：返回占位 guard
        // - Windows build：本 impl 不可达（runtime 工厂返回
        //   WindowsSingleInstance，不会构造 MacSingleInstance），但
        //   `platform/mod.rs` 无条件 `pub mod macos`，模块在所有平台都
        //   编译，故需一个能编译通过的分支。
        #[cfg(not(windows))]
        {
            Ok(SingleInstanceGuard::from_stub())
        }
        #[cfg(windows)]
        {
            unreachable!("MacSingleInstance::try_acquire 在 Windows build 不可达")
        }
    }
}
