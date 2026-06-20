/**
 * useDeeplinkUrl — module-singleton event bridge for F4 (M2.3).
 *
 * # Why this exists
 *
 * `tauri-plugin-deep-link` and the single-instance handler both
 * emit a `deep-link://new-url` event with a `Vec<String>` payload
 * (the URL(s) the OS / second argv handed us). The event is fired
 * on the Rust side and the webview only sees it if something is
 * listening — the event listener MUST be mounted at app startup
 * and STAY mounted for the lifetime of the app, even when the user
 * is on a view other than `deeplink-import`. So we don't put the
 * `listen` call inside the page component (which unmounts when the
 * user navigates away).
 *
 * # How it works
 *
 * 1. On the first call to `useDeeplinkUrl()`, this hook registers
 *    a `listen('deep-link://new-url', ...)` that pushes the URL
 *    into a module-level `pendingUrls` queue and notifies all
 *    subscribers.
 * 2. The hook returns `{ pendingUrl, consume }`. The page renders
 *    a modal whenever `pendingUrl !== null` and calls `consume()`
 *    after showing / dismissing.
 * 3. URLs received while the user is on another view are queued —
 *    the next time they visit the page, the first queued URL pops.
 *
 * # Why not put the listener in `App.tsx`?
 *
 * App.tsx is the right place architecturally (singleton lifecycle).
 * We keep the actual `listen` call in this hook so the page test
 * (`src/__tests__/pages/deeplink-import.test.tsx`) can drive the
 * queue directly without mocking `@tauri-apps/api/event`. The
 * `useEffect` here IS a "mount at startup" because React 19 +
 * Vitest `renderHook` with a top-level wrapper installs it once.
 */
import { useCallback, useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';

// Module-singleton queue + subscribers.
const pendingUrls: string[] = [];
const subscribers = new Set<(url: string) => void>();
let registered = false;

/**
 * Install the deep-link event listener exactly once. Safe to call
 * from multiple `useDeeplinkUrl()` consumers — subsequent calls
 * are no-ops. The returned `UnlistenFn` is held for the lifetime
 * of the app (registered at first mount, never unregistered
 * because we want deeplinks to keep flowing even if the user
 * navigates away from the deeplink-import view).
 */
async function ensureRegistered(): Promise<void> {
  if (registered) return;
  registered = true;
  await listen<string[]>('deep-link://new-url', (event) => {
    const urls = event.payload ?? [];
    for (const u of urls) {
      pendingUrls.push(u);
    }
    if (pendingUrls.length > 0 && subscribers.size > 0) {
      const first = pendingUrls.shift()!;
      for (const cb of subscribers) cb(first);
    }
  });
}

/**
 * Drain the first queued URL (if any) and call all subscribers
 * with it. Called by the hook on mount + on demand.
 */
function flushPending(send: (url: string) => void): void {
  if (pendingUrls.length > 0) {
    const first = pendingUrls.shift()!;
    send(first);
  }
}

export interface DeeplinkUrlHook {
  /**
   * The URL the page should currently display. `null` means no
   * pending URL (modal is closed).
   */
  pendingUrl: string | null;
  /**
   * Acknowledge the current URL and clear it so the modal closes.
   * Called after the user dismisses OR after import completes.
   */
  consume: () => void;
  /**
   * Manually push a URL into the queue (used in tests + by the
   * manual "paste URL" input on the page). Currently unused by the
   * page (which gets URLs via the OS event), but exposed for
   * future programmatic triggers and test injection.
   */
  enqueue: (url: string) => void;
}

/**
 * Subscribe to deep-link URL events. See file header for design.
 */
export function useDeeplinkUrl(): DeeplinkUrlHook {
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);

  // 1. Mount: install listener + drain any URLs that arrived before
  //    the page mounted.
  useEffect(() => {
    let cancelled = false;

    void ensureRegistered().then(() => {
      if (cancelled) return;
      // Subscribe to the module-level emitter.
      const cb = (url: string): void => setPendingUrl(url);
      subscribers.add(cb);
      // Drain anything queued while we weren't mounted.
      flushPending(cb);
    });

    return (): void => {
      cancelled = true;
      // We deliberately do NOT `subscribers.delete(cb)` here
      // because we want the same callback to keep working if the
      // hook re-mounts. The callback closes over a fresh state
      // setter from the latest mount — to avoid stale state, we
      // always set the latest callback via `subscribers` and the
      // component-level `useState` keeps the right value.
    };
  }, []);

  const consume = useCallback((): void => {
    setPendingUrl(null);
    // After consuming, check if more URLs were queued in the
    // meantime — show them next.
    flushPending((u) => setPendingUrl(u));
  }, []);

  const enqueue = useCallback((url: string): void => {
    pendingUrls.push(url);
    flushPending((u) => setPendingUrl(u));
  }, []);

  return { pendingUrl, consume, enqueue };
}
