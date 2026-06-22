/**
 * M3.1 — splash ready-event timing test.
 *
 * ## What this guards
 *
 * The cold-startup fix moves splash-hide trigger from a fixed 2200ms
 * setTimeout to a Tauri `tauri://ready` event. This test verifies:
 *
 *   1. Splash is visible on App mount (default state).
 *   2. Splash STAYS visible until `tauri://ready` fires.
 *   3. After `tauri://ready` fires, splash hides within the timeout.
 *   4. Failsafe (8s) still hides the splash if ready never fires
 *      (so user is never stuck staring at a loading screen).
 *
 * ## Why synthetic splash + event dispatch
 *
 * jsdom does NOT parse index.html (vitest imports App.tsx directly).
 * We synthesize #ccm-splash in beforeEach. To simulate the Tauri
 * ready event we dispatch a CustomEvent on window — App.tsx's
 * useEffect listens for `tauri://ready` (or window 'ccm:ready'
 * fallback) and triggers the hide path.
 *
 * ## Timing slack
 *
 * Real timing assertions use 50-150ms slack above the declared
 * timeout. jsdom setTimeout is jittery under load.
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

describe('M3.1 splash ready-event timing', () => {
  beforeEach(() => {
    synthesizeSplash();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.getElementById(SPLASH_ID)?.remove();
  });

  it('splash stays visible until tauri://ready fires (M3.1 main fix)', async () => {
    render(
      <ThemeProvider>
        <App />
      </ThemeProvider>,
    );

    // Sanity: splash is present and not hidden initially.
    expect(getSplash()).not.toBeNull();
    expect(getSplash()?.classList.contains(HIDDEN_CLASS)).toBe(false);

    // Advance 1.5s — under the OLD 2200ms timeout, splash should NOT
    // yet be hidden. Under the NEW event-driven flow, splash stays
    // visible until ready event fires.
    vi.advanceTimersByTime(1500);
    expect(getSplash()?.classList.contains(HIDDEN_CLASS)).toBe(false);

    // Now fire the Tauri ready event. Splash should hide.
    window.dispatchEvent(new CustomEvent('tauri://ready'));
    // React effect re-runs synchronously after dispatch in jsdom + fake
    // timers, but flushMicroTasks is safest.
    await Promise.resolve();
    // The event-driven path: ready → hide (no 2200ms wait).
    expect(getSplash()?.classList.contains(HIDDEN_CLASS)).toBe(true);
  });

  it('failsafe still hides splash if ready event never fires (8s timeout)', async () => {
    render(
      <ThemeProvider>
        <App />
      </ThemeProvider>,
    );

    expect(getSplash()?.classList.contains(HIDDEN_CLASS)).toBe(false);

    // Advance past 8s without firing ready.
    vi.advanceTimersByTime(8500);

    // Failsafe path: even without ready, splash is hidden so the
    // user is never stuck staring at a loading screen.
    expect(getSplash()?.classList.contains(HIDDEN_CLASS)).toBe(true);
  });

  it('hides splash on display:none 300ms after class is added', async () => {
    render(
      <ThemeProvider>
        <App />
      </ThemeProvider>,
    );

    window.dispatchEvent(new CustomEvent('tauri://ready'));
    await Promise.resolve();

    // Right after class added: display still has prior value.
    expect(getSplash()?.classList.contains(HIDDEN_CLASS)).toBe(true);

    // After 300ms: display should be none (from the secondary timeout).
    vi.advanceTimersByTime(350);
    expect(getSplash()?.style.display).toBe('none');
  });
});
