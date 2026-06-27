/**
 * Vitest setup — runs once before any test file.
 *
 * Loads `@testing-library/jest-dom` so we get nice matchers like
 * `toBeInTheDocument()`, `toHaveTextContent()`, etc.
 *
 * Keep this file lean — global mocks belong in dedicated modules so
 * individual tests can opt in via `vi.mock()`.
 */
import '@testing-library/jest-dom/vitest';

// ---------------------------------------------------------------------------
// Tauri runtime mock (M3.7 about-page compat)
//
// App.tsx's useEffect calls `listen('import-sql-file', ...)` and
// `invoke('take_pending_sql_file')` via @tauri-apps/api. jsdom has no
// Tauri runtime, so without this shim the listen() promise rejects
// with "Cannot read properties of undefined (reading 'transformCallback')"
// (an unhandled rejection that surfaces in vitest as a fake failure).
//
// We provide no-op __TAURI_INTERNALS__ + __TAURI_EVENT_PLUGIN_INTERNALS__
// that:
//   - resolves listen() with a teardown fn (so the unlisten() in the
//     App effect's cleanup runs cleanly on unmount)
//   - resolves invoke() with `null` (no pending .sql file in tests)
//   - exposes metadata the SDK reads at module load
//
// Individual tests that need richer behaviour (e.g. dispatching a
// fake `tauri://ready`) can override window.__TAURI_INTERNALS__
// locally — see splash.test.tsx for the pattern.
// ---------------------------------------------------------------------------
if (typeof window !== 'undefined') {
  const w = window as unknown as {
    __TAURI_INTERNALS__?: unknown;
    __TAURI_EVENT_PLUGIN_INTERNALS__?: unknown;
  };
  if (!w.__TAURI_INTERNALS__) {
    w.__TAURI_INTERNALS__ = {
      transformCallback: () => 0,
      invoke: () => Promise.resolve(null),
      metadata: {
        currentWindow: { label: 'main' },
        currentWebview: { label: 'main', windowLabel: 'main' },
      },
      runCallback: () => 0,
    };
  }
  if (!w.__TAURI_EVENT_PLUGIN_INTERNALS__) {
    w.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener: () => Promise.resolve(),
    };
  }
}

// ---------------------------------------------------------------------------
// Phase 29 / BUG-RF-01 — localStorage polyfill.
//
// jsdom 25.0.1 + Node 26 has a regression where the global `localStorage`
// is undefined (verified empirically with the Phase 29 dev box). This
// causes every `localStorage.clear()` in beforeEach to throw
// "Cannot read properties of undefined (reading 'clear')", which blocks
// ALL jsdom tests in the project.
//
// We polyfill with a Map-backed in-memory store. This matches the
// pre-regression behaviour: vitest's per-file localStorage is per-process
// (each `npm test` invocation starts fresh), so the in-memory store
// is correct for the test suite's needs. Tests that rely on
// localStorage persistence across mounts still work because the
// store lives for the duration of the test file.
//
// The polyfill is intentionally minimal: getItem / setItem / removeItem /
// clear. We do NOT need key() or length() — no existing test uses them.
if (typeof window !== 'undefined' && typeof window.localStorage === 'undefined') {
  const store = new Map<string, string>();
  const localStoragePolyfill = {
    getItem(key: string): string | null {
      return store.has(key) ? (store.get(key) as string) : null;
    },
    setItem(key: string, value: string): void {
      store.set(key, String(value));
    },
    removeItem(key: string): void {
      store.delete(key);
    },
    clear(): void {
      store.clear();
    },
    key(index: number): string | null {
      return Array.from(store.keys())[index] ?? null;
    },
    get length(): number {
      return store.size;
    },
  };
  // jsdom exposes `window` AND the global `localStorage` is a separate
  // property on the `window` object. Vitest tests use the bare
  // `localStorage` reference, which resolves to `globalThis.localStorage`
  // — but in jsdom, that IS `window.localStorage`. So patching
  // window.localStorage is enough.
  (window as unknown as { localStorage: typeof localStoragePolyfill }).localStorage =
    localStoragePolyfill;
  // Belt-and-suspenders: also patch globalThis in case any code path
  // bypasses window.
  (globalThis as unknown as { localStorage: typeof localStoragePolyfill }).localStorage =
    localStoragePolyfill;
}
