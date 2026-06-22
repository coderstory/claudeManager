/**
 * Custom Playwright fixtures for the Tauri WebView2 CDP path.
 *
 * Background:
 *   Tauri's official WebDriver path is tauri-driver + WebDriverIO. This
 *   project uses Playwright, which speaks CDP (not WebDriver). The two
 *   are bridged by the fact that tauri-driver's session response
 *   includes `debuggerAddress` — the WebView2 CDP endpoint. We extract
 *   that endpoint in `scripts/run-e2e.sh` and set the `CDP_ENDPOINT`
 *   env var (e.g. `http://127.0.0.1:9222`).
 *
 * This fixtures file:
 *   1. Reads `CDP_ENDPOINT` env var.
 *   2. If set: connects Playwright to that WebView2 CDP endpoint via
 *      `chromium.connectOverCDP()`, grabs the first page from the
 *      context, and serves it as the `page` fixture. Specs using this
 *      path exercise the REAL Tauri WebView (with __TAURI_INTERNALS__
 *      IPC bridge, tray icon, window-close interception).
 *   3. If not set: falls back to the default Playwright `page` fixture
 *      (standard Chromium browser launch). Specs run against
 *      `baseURL` from playwright.config.ts.
 *
 * Usage in spec files:
 *   ```
 *   import { test, expect } from './fixtures';
 *   test('...', async ({ page }) => { ... });
 *   ```
 *
 * Only the 6 M1 core specs (launch / tray / close-minimize /
 * m1-9-2-layout / m2-3-0-shortcuts-theme / m2-3-2-ui-layout-verify)
 * import from this file. All other M2+ specs continue to import from
 * `@playwright/test` directly and use the dev-server path
 * (PLAYWRIGHT_BASE_URL=http://localhost:1420).
 */

import { test as base, chromium, Page } from '@playwright/test';

export const test = base.extend<{ page: Page }>({
  page: async ({ page: basePage }, use) => {
    const cdpEndpoint = process.env.CDP_ENDPOINT;

    if (cdpEndpoint) {
      // ── CDP mode: connect to the live Tauri WebView2 ──────────
      // tauri-driver already launched the app and the WebView2 is
      // listening at the CDP endpoint. We connect Playwright to it
      // directly — no local browser launch needed.
      const browser = await chromium.connectOverCDP(cdpEndpoint);

      // Tauri WebView2 has exactly one browser context and one page.
      const context = browser.contexts()[0];
      const page: Page = context.pages()[0] || (await context.newPage());

      // The WebView2 is already on the Tauri app's URL (tauri://localhost)
      // when tauri-driver finishes the session handshake. We must NOT call
      // page.goto() here — WebView2's custom-protocol handler aborts any
      // in-flight navigation request that didn't originate from user
      // interaction, and CDP-driven goto is treated as such (ERR_ABORTED).
      // The page is already loaded (title + heading visible).
      //
      // To keep specs portable across CDP / dev-server modes, we wrap the
      // page in a Proxy that intercepts `goto` and turns it into a no-op
      // in CDP mode. Specs that call `page.goto('/')` see "page is already
      // at the right URL" without actually triggering a navigation. All
      // other Page methods pass through unchanged.
      const proxiedPage = new Proxy(page, {
        get(target, prop, receiver) {
          if (prop === 'goto') {
            return async () => {
              // No-op in CDP mode — page is already on tauri://localhost.
            };
          }
          const value = Reflect.get(target, prop, receiver);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      }) as Page;

      await use(proxiedPage);

      // Do NOT close browser/context — tauri-driver owns the
      // WebView2 process lifetime. Disconnect cleanly instead.
      await context.close();
      // (browser disconnect is implicit after context close)
    } else if (process.env.PLAYWRIGHT_BASE_URL) {
      // ── Dev-server mode: basePage already launched by Playwright ─
      await use(basePage);
    } else {
      // ── Default mode: basePage resolves `goto('/')` via config.baseURL ─
      await use(basePage);
    }
  },
});

// Re-export expect so specs only need ONE import.
export { expect } from '@playwright/test';
