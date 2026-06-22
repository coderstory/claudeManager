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
