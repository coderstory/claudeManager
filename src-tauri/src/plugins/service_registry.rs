//! Plugin service registry — DI container for [`IPlugin::init`] and beyond.
//!
//! ## Phase 42 contract (D-45-A)
//!
//! This module's public API is **locked** by the v3.4 milestone
//! decision `D-45-A` (see `.planning/milestones/v3.4-DECISIONS.md`).
//! Phase 45 depends on this exact shape — any divergence must go through
//! the CLAUDE.md §2.5 negotiation process.
//!
//! ```text
//! pub fn new() -> Self;
//! pub fn register_arc<T: 'static + Send + Sync>(&self, svc: Arc<T>);
//! pub fn get<T: 'static + Send + Sync>(&self) -> Option<Arc<T>>;
//! pub fn contains<T: 'static>(&self) -> bool;
//! pub fn count(&self) -> usize;
//! ```
//!
//! ## Why Arc path?
//!
//! Nine services may mutually inject each other (A→B→C→A cycle). The
//! borrow checker rejects `&T` cycles; `Arc<T>` provides shared
//! ownership cheaply (nanosecond-scale clones) and matches the Phase 45
//! topological-init flow.
//!
//! ## Phase 42 status
//!
//! The registry is **constructed** in `lib.rs::setup` but stays empty
//! (no `register_arc` calls yet). Phase 45 will populate it during
//! `IPlugin::init`. The tests below pin the Phase 45 contract.

use std::any::{Any, TypeId};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

// ---------------------------------------------------------------------------
// ServiceRegistry
// ---------------------------------------------------------------------------

/// Type-erased service container.
///
/// `Send + Sync` so it can live inside `Arc<ServiceRegistry>` on
/// `AppState` (Tauri commands pull `State<'_, AppState>` and may
/// dispatch on worker threads). Interior mutability is a `Mutex`
/// — `RefCell` would not satisfy `Sync`.
///
/// **Phase 45 init invariant** — all `register_arc` calls happen
/// during the single-threaded `init_all_topological` bootstrap; the
/// `Mutex` is only contended during startup. After init the
/// registry is read-only for the rest of the process.
pub struct ServiceRegistry {
    map: Mutex<HashMap<TypeId, Arc<dyn Any + Send + Sync>>>,
}

impl ServiceRegistry {
    /// Construct an empty registry.
    pub fn new() -> Self {
        Self {
            map: Mutex::new(HashMap::new()),
        }
    }

    /// Register a service by `Arc`. Phase 45 calls this from each
    /// plugin's `init` to publish its owned services for downstream
    /// plugins to consume via `get::<T>()`.
    ///
    /// Re-registering the same `T` **overwrites** — Phase 45 init
    /// order is responsible for ensuring the "last writer wins" is
    /// the correct behavior (no id collision today; future Phase 45
    /// may add a duplicate-detection log).
    ///
    /// # Panics
    /// Panics if the inner mutex is poisoned (a previous holder
    /// panicked while holding it). Startup-time only — `init` is
    /// single-threaded and the panic would already abort the process.
    pub fn register_arc<T: 'static + Send + Sync>(&self, svc: Arc<T>) {
        self.map
            .lock()
            .expect("ServiceRegistry mutex poisoned")
            .insert(TypeId::of::<T>(), svc as Arc<dyn Any + Send + Sync>);
    }

    /// Look up a previously registered service by type. Returns `None`
    /// if no service of type `T` has been registered.
    pub fn get<T: 'static + Send + Sync>(&self) -> Option<Arc<T>> {
        self.map
            .lock()
            .expect("ServiceRegistry mutex poisoned")
            .get(&TypeId::of::<T>())
            .and_then(|a| a.clone().downcast::<T>().ok())
    }

    /// Check whether a service of type `T` is registered.
    pub fn contains<T: 'static>(&self) -> bool {
        self.map
            .lock()
            .expect("ServiceRegistry mutex poisoned")
            .contains_key(&TypeId::of::<T>())
    }

    /// Number of distinct services registered.
    pub fn count(&self) -> usize {
        self.map
            .lock()
            .expect("ServiceRegistry mutex poisoned")
            .len()
    }
}

impl Default for ServiceRegistry {
    fn default() -> Self {
        Self::new()
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    /// Marker service used by the tests. Each marker is a distinct
    /// type so `register_arc::<A>` doesn't collide with
    /// `register_arc::<B>` in the registry.
    struct A(u32);
    struct B(String);

    #[test]
    fn register_arc_then_get() {
        let r = ServiceRegistry::new();
        let svc = Arc::new(A(42));
        r.register_arc::<A>(svc);
        let got = r.get::<A>().expect("A should be registered");
        assert_eq!(got.0, 42);
    }

    #[test]
    fn register_arc_overwrites() {
        let r = ServiceRegistry::new();
        r.register_arc::<A>(Arc::new(A(1)));
        r.register_arc::<A>(Arc::new(A(2)));
        // Phase 45 init-order dependency: last writer wins.
        assert_eq!(r.get::<A>().unwrap().0, 2);
    }

    #[test]
    fn get_missing_returns_none() {
        let r = ServiceRegistry::new();
        assert!(r.get::<A>().is_none());
        assert!(r.get::<B>().is_none());
    }

    #[test]
    fn contains_distinguishes_types() {
        let r = ServiceRegistry::new();
        r.register_arc::<A>(Arc::new(A(0)));
        assert!(r.contains::<A>());
        assert!(!r.contains::<B>());
    }

    #[test]
    fn count_reflects_distinct_types() {
        let r = ServiceRegistry::new();
        assert_eq!(r.count(), 0);
        r.register_arc::<A>(Arc::new(A(0)));
        assert_eq!(r.count(), 1);
        r.register_arc::<B>(Arc::new(B("x".into())));
        assert_eq!(r.count(), 2);
        // Re-registering same type does NOT increase count.
        r.register_arc::<A>(Arc::new(A(99)));
        assert_eq!(r.count(), 2);
    }
}