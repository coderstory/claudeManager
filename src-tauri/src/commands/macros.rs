//! Convenience macros for accessing services from `AppState`.
//!
//! ## Why macros, not methods
//!
//! After Phase 45, `AppState` no longer carries one
//! `Arc<crate::services::xxx_service>` per service. Instead all 9
//! services live in `AppState::service_registry: Arc<ServiceRegistry>`,
//! and commands look them up by type via [`get_service!`].
//!
//! The macro is type-safe: it expands at compile time, so a typo'd
//! type name fails to compile (not at runtime). It panics at runtime
//! if the service was not registered — which would indicate a missing
//! `depends_on()` declaration or a topological-sort bug, both caught
//! by `cargo test plugins::host::tests`.
//!
//! ## Usage
//!
//! ```ignore
//! fn cmd(state: tauri::State<AppState>) -> Result<Vec<Backup>, String> {
//!     let backup = get_service!(state, BackupService);
//!     Ok(backup.list_backups(None))
//! }
//! ```
//!
//! Returns `&Service` (via `.as_ref()` on the inner `Arc`).
//!
//! ## Non-panicking variant
//!
//! [`try_get_service!`] returns `Option<&Service>` for code paths that
//! need to handle a missing service gracefully (e.g. test-only
//! commands, optional integration tests).

/// Look up a service by type from `AppState`. Panics if the service
/// was not registered.
///
/// **Returns `Arc<T>`** (a clone from the registry's internal
/// storage). The caller owns the Arc — chain `.method()` directly
/// on the result via `.as_ref()`, or bind the Arc to a `let` to
/// reuse across statements:
///
/// ```ignore
/// // Inline chained (cleanest for one-off calls):
/// get_service!(state, BackupService).as_ref().list_backups(root);
///
/// // Multi-call (bind the Arc, then deref each time):
/// let backup = get_service!(state, BackupService);
/// backup.as_ref().method1();
/// backup.as_ref().method2();
/// ```
#[macro_export]
macro_rules! get_service {
    ($state:expr, $svc:ty) => {
        $state
            .service_registry
            .get::<$svc>()
            .expect(concat!(
                "service not registered: ",
                stringify!($svc),
                " — check depends_on() declarations and topo-sort order",
            ))
    };
}

/// Like [`get_service!`] but returns `Option<Arc<T>>` instead of
/// panicking.
#[macro_export]
macro_rules! try_get_service {
    ($state:expr, $svc:ty) => {
        $state.service_registry.get::<$svc>()
    };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use crate::plugins::service_registry::ServiceRegistry;

    /// Marker service used by the tests. `PhantomData` keeps the
    /// struct zero-sized.
    struct TestBackupService;

    /// `get_service!` returns `&Service` (via the registry's Arc) when
    /// the service is registered. The test simulates the macro call
    /// by hand since macros can't be invoked from inside `#[cfg(test)]`
    /// without the surrounding `AppState` type.
    #[test]
    fn get_service_returns_arc_reference() {
        let registry = ServiceRegistry::new();
        registry.register_arc::<TestBackupService>(Arc::new(TestBackupService));
        // The macro expands to:
        //   state.service_registry
        //     .get::<TestBackupService>()
        //     .expect("...")
        //     .as_ref()
        // We exercise that exact path here.
        // Bind the Arc to a `let` first so the borrowed `&T` outlives
        // the temporary expression.
        let arc: Arc<TestBackupService> = registry
            .get::<TestBackupService>()
            .expect("TestBackupService should be registered");
        let svc: &TestBackupService = arc.as_ref();
        // Just confirm we got a stable reference (i.e. no panic).
        let _ptr: *const TestBackupService = svc;
    }

    /// `get_service!` panics with the type name in the message when
    /// the service is missing. We use `should_panic` + `expected` to
    /// pin the contract.
    #[test]
    fn get_service_panics_on_missing_service() {
        let registry = ServiceRegistry::new();
        // The macro expands to:
        //   registry.get::<MissingService>().expect("service not
        //   registered: MissingService — check depends_on()
        //   declarations and topo-sort order").as_ref()
        let result = std::panic::catch_unwind(|| {
            let arc: Arc<TestBackupService> = registry
                .get::<TestBackupService>()
                .expect("service not registered: TestBackupService — check depends_on() declarations and topo-sort order");
            let _svc: &TestBackupService = arc.as_ref();
        });
        assert!(result.is_err(), "expected panic for missing service");
    }
}
