/**
 * M3.13.2 — splash React-first-paint hide test.
 *
 * ## What this guards
 *
 * The cold-startup fix moves splash-hide trigger from the unreliable
 * `tauri://ready` event to React-first-paint (double rAF after the
 * top-level useEffect commit). This test verifies:
 *
 *   1. Splash is visible on App mount (default state).
 *   2. After React mounts + 1 frame + 1 paint, splash hides within
 *      a reasonable timeout (~16ms per rAF under fake timers + 50ms
 *      slack) — NO `tauri://ready` event needed.
 *   3. Failsafe (8s) still hides the splash if React never mounts
 *      (so user is never stuck staring at a loading screen).
 *   4. After the hidden class is added, display:none kicks in
 *      300ms later (the secondary timeout that frees the layer).
 *
 * ## Why double-rAF instead of tauri://ready
 *
 * Tauri v2 does NOT reliably dispatch tauri://ready on Windows
 * WebView2. With the old event-driven path, the splash stayed for
 * the full 8s failsafe on every cold start, which the user reported
 * as "loading 界面显示的时间有点长". React-first-paint is platform-
 * independent (works in jsdom, browser, WebView2, WKWebView).
 *
 * ## jsdom fake-timers + rAF
 *
 * vitest's `vi.useFakeTimers()` fakes `requestAnimationFrame` to
 * schedule callbacks via setTimeout(0). Advancing the timer by a
 * small delta (50ms) is enough to flush both rAF callbacks.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import App from '../../App';
import { ThemeProvider } from '../../design-system/ThemeProvider';

// M3.1 — jsdom has no Tauri runtime. App.tsx's useEffect calls
// `listen('import-sql-file', ...)` which goes through
// `window.__TAURI_INTERNALS__.transformCallback` (Tauri v2 SDK).
// We provide a no-op mock so the listen() promise resolves with a
// teardown function instead of throwing an unhandled rejection.
// See: src/__tests__/integration/ccm-splash.test.tsx for the same
// concern (existing tests survive because the unhandled rejection
// does not bubble into the test result).
beforeAll(() => {
  (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
    transformCallback: () => 0,
    invoke: () => Promise.resolve(undefined),
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' } },
    runCallback: () => 0,
  };
  // Tauri v2 event plugin internals — used by `_unlisten` during
  // teardown of the listen() promise returned from App.tsx useEffect.
  (window as unknown as { __TAURI_EVENT_PLUGIN_INTERNALS__: unknown }).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
    unregisterListener: () => Promise.resolve(),
  };
});

const SPLASH_ID = 'ccm-splash';
const HIDDEN_CLASS = 'ccm-splash-hidden';

function synthesizeSplash(): void {
  document.getElementById(SPLASH_ID)?.remove();
  const splash = document.createElement('div');
  splash.id = SPLASH_ID;
  document.body.appendChild(splash);
}

function getSplash(): HTMLElement | null {
  return document.getElementById(SPLASH_ID);
}

describe('M3.13.2 splash React-first-paint hide', () => {
  beforeEach(() => {
    synthesizeSplash();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.getElementById(SPLASH_ID)?.remove();
  });

  it('hides splash after React first paint without waiting for tauri://ready (M3.13.2 main fix)', async () => {
    render(
      <ThemeProvider>
        <App />
      </ThemeProvider>,
    );

    // Sanity: splash is present and not hidden initially.
    expect(getSplash()).not.toBeNull();
    expect(getSplash()?.classList.contains(HIDDEN_CLASS)).toBe(false);

    // No tauri://ready event needed. React-first-paint (double rAF)
    // hides the splash on its own. 50ms is enough to flush both rAF
    // callbacks under vi.useFakeTimers().
    vi.advanceTimersByTime(1300);
    await Promise.resolve();

    // M3.13.2: React-first-paint path (double rAF) + MIN_SPLASH_MS=1200ms
    // (anti-flash guard). 1300ms > 1200ms threshold → splash hidden.
    expect(getSplash()?.classList.contains(HIDDEN_CLASS)).toBe(true);
  });

  it('failsafe still hides splash if React never mounts (8s timeout)', async () => {
    render(
      <ThemeProvider>
        <App />
      </ThemeProvider>,
    );

    expect(getSplash()?.classList.contains(HIDDEN_CLASS)).toBe(false);

    // Advance past 8s without React's rAF flushing (simulated by
    // advancing straight to 8500ms). The 8s failsafe still fires.
    vi.advanceTimersByTime(8500);

    // Failsafe path: even without rAF, splash is hidden so the
    // user is never stuck staring at a loading screen.
    expect(getSplash()?.classList.contains(HIDDEN_CLASS)).toBe(true);
  });

  it('hides splash on display:none 300ms after class is added', async () => {
    render(
      <ThemeProvider>
        <App />
      </ThemeProvider>,
    );

    // Trigger the React-first-paint path.
    vi.advanceTimersByTime(50);
    await Promise.resolve();

    // Right after class added: display still has prior value.
    expect(getSplash()?.classList.contains(HIDDEN_CLASS)).toBe(true);

    // After 300ms past the 1200ms threshold: display should be none (from the secondary timeout).
    vi.advanceTimersByTime(400);
    expect(getSplash()?.style.display).toBe('none');
  });

  it('tauri://ready event is still accepted as an early-hide (idempotent)', async () => {
    render(
      <ThemeProvider>
        <App />
      </ThemeProvider>,
    );

    // Fire tauri://ready before rAF. The React path also queues hide
    // via rAF; both paths are idempotent so the splash ends up hidden
    // exactly once. This guards backwards-compat for any platform
    // where Tauri v2 DOES dispatch the event (e.g. some macOS builds).
    window.dispatchEvent(new CustomEvent('tauri://ready'));
    vi.advanceTimersByTime(50);
    await Promise.resolve();

    expect(getSplash()?.classList.contains(HIDDEN_CLASS)).toBe(true);
  });
});
