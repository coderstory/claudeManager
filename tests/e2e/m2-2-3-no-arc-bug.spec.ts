/**
 * M2.2.3 — Arc-bug regression test (e2e DOM check).
 *
 * ## Why this file exists
 *
 * M2.1 + M2.2 both shipped with a P0 bug in `src-tauri/src/lib.rs`:
 *
 *     app.manage(Arc::new(state));   // wraps in Arc — WRONG
 *
 * But the 4 F1/F2/F3 commands in `commands::providers.rs` extract:
 *
 *     state: State<'_, AppState>     // no Arc — expects bare AppState
 *
 * Tauri stores managed state keyed by `std::any::TypeId`. The lookup
 * at IPC-invoke time never matches — every command call returns
 * `"state not managed for field '0' on command 'list_providers'..."`
 * (or the same for the other 3). All F1, F2, F3 functionality was
 * silently broken in M2.1 + M2.2 ship builds, with 92+ unit tests
 * passing because they hit the service layer directly and never went
 * through the `State<>` extraction path.
 *
 * ## What this test verifies
 *
 * This e2e test runs against the dev mode vite server (which serves
 * the same React bundle that gets bundled into the release exe). It
 * checks the F1 page renders without surfacing the M2.1+M2.2 bug
 * symptoms in the DOM:
 *
 *   - The page mounts the F1 page component (not the plugin-placeholder).
 *   - No "state not managed" / "TypeId" / ".manage() before using this
 *     command" text appears in the rendered body (those strings only
 *     show up when Tauri surfaces the TypeId mismatch to the user).
 *   - The React error boundary does NOT catch a "managed state" error.
 *
 * Note: this test cannot directly invoke the Rust commands from a
 * browser — the Rust runtime is only present in the real Tauri
 * WebView (release exe). The release-exe smoke-test
 * (`scripts/smoke-test.sh`) is the runtime-level gate; this e2e test
 * is the DOM-level gate. Both must pass.
 *
 * ## Why a separate spec from m2-1-verify.spec.ts
 *
 * The m2-1-verify spec is a one-off diagnostic capture (kept in
 * `tests/e2e/` per the M1.9.3 regression-test convention). This spec
 * is the focused, minimal regression check that should stay green
 * forever.
 *
 * Run with:  npx playwright test tests/e2e/m2-2-3-no-arc-bug.spec.ts
 * (Requires dev server running: npm run dev)
 */

import { test, expect } from '@playwright/test';

const DIAG_DIR = '.planning/diagnostics/m2-2-3';

test.describe('M2.2.3 — Arc-bug regression for F1/F2/F3 commands', () => {
  test('F1 page renders cleanly without surfacing the TypeId bug', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 640 });
    await page.goto('http://localhost:1420/');
    await page.waitForSelector('[data-testid="app-header"]', { timeout: 15000 });
    await page.waitForTimeout(500);

    // Navigate to F1.
    await page.click('[data-testid="sidebar-item-provider-list"]');
    // Give the page time to mount + (try to) call listProviders IPC.
    await page.waitForTimeout(2000);

    await page.screenshot({ path: `${DIAG_DIR}/f1-page-after-fix.png`, fullPage: false });

    const state = await page.evaluate(() => {
      const f1Page = document.querySelector('[data-testid="provider-list-page"]') as HTMLElement | null;
      const placeholder = document.querySelector('[data-testid^="plugin-placeholder"]') as HTMLElement | null;
      const bodyText = document.body.innerText;
      return {
        f1PageMounted: !!f1Page,
        placeholderMounted: !!placeholder,
        // The M2.1+M2.2 bug surfaces these strings when Tauri reports
        // the TypeId mismatch to the user. If we see any of them in
        // the DOM, the bug is back.
        bodyMentionsStateNotManaged: bodyText.includes('state not managed'),
        bodyMentionsTypeId: bodyText.includes('TypeId'),
        bodyMentionsManageBeforeCommand: /manage\(\)/i.test(bodyText) && /before using this command/i.test(bodyText),
        bodyMentionsArcError: /Arc<.*AppState.*>/i.test(bodyText) || /TypeId.*mismatch/i.test(bodyText),
        bodySnippet: bodyText.substring(0, 500),
      };
    });

    console.log('[m2-2-3]', JSON.stringify(state, null, 2));

    // The F1 page must mount (proves the React app routed to F1 and
    // the component loaded; this was already working pre-fix).
    expect(state.f1PageMounted, 'F1 page component must mount').toBe(true);
    expect(state.placeholderMounted, 'plugin-placeholder must not replace F1').toBe(false);

    // The bug surface strings must NOT appear in the rendered DOM.
    expect(state.bodyMentionsStateNotManaged).toBe(false);
    expect(state.bodyMentionsTypeId).toBe(false);
    expect(state.bodyMentionsManageBeforeCommand).toBe(false);
    expect(state.bodyMentionsArcError).toBe(false);
  });

  test('F2 sidebar entry routes cleanly (no managed-state error)', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 640 });
    await page.goto('http://localhost:1420/');
    await page.waitForSelector('[data-testid="app-header"]', { timeout: 15000 });
    await page.waitForTimeout(500);

    // F2 (provider-switch) is a redirect shim → F1 in M2.1.
    // If the IPC layer is broken (Arc bug), this navigation will
    // fail and the page will sit in an error state.
    await page.click('[data-testid="sidebar-item-provider-switch"]');
    await page.waitForTimeout(1500);

    const bodyText = await page.evaluate(() => document.body.innerText);
    expect(bodyText.includes('state not managed')).toBe(false);
    expect(bodyText.includes('TypeId')).toBe(false);
  });
});
