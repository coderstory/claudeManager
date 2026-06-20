/**
 * M2.2.3 真业务验证 spec.
 *
 * Path A (vite dev, no Tauri runtime) — DOM-level + IPC probe:
 *   1. F1 page mounts cleanly without "state not managed" / TypeId errors
 *   2. F3 page mounts cleanly
 *   3. __TAURI_INTERNALS__ probe (expected: undefined in bare vite)
 *
 * Path B (release exe) — separate flow:
 *   handled by smoke-test screenshots in .planning/diagnostics/m2-2-3-verify/
 *
 * This file is the **DOM-level + IPC-availability** check. The Rust
 * runtime layer (real `list_providers` return) is NOT directly callable
 * from a bare vite + Chromium Playwright session — that requires the
 * Tauri webview (release exe). DOM checks confirm:
 *   - the React tree didn't blow up (no error boundary triggered)
 *   - the IPC calls don't throw "state not managed" / TypeId strings
 *     into the DOM (those only appear if the Tauri runtime is present
 *     AND the AppState TypeId lookup fails).
 *
 * Because the Tauri runtime is NOT loaded in plain vite, the
 * `window.__TAURI_INTERNALS__` probe will report "undefined" — that
 * is the expected, correct behavior for the dev-mode DOM check. The
 * release-exe smoke test is the runtime-level gate.
 */

import { test, expect } from '@playwright/test';

const DIAG_DIR = '.planning/diagnostics/m2-2-3-verify';

test.describe('M2.2.3 真业务验证', () => {
  test.use({ viewport: { width: 1024, height: 640 } });

  test('01 F1 page: DOM clean (no managed-state error strings)', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => {
      consoleErrors.push(`pageerror: ${err.message}`);
    });

    await page.goto('http://localhost:1420/');
    await page.waitForSelector('[data-testid="app-header"]', { timeout: 15000 });
    await page.waitForTimeout(500);

    await page.click('[data-testid="sidebar-item-provider-list"]');
    await page.waitForTimeout(2500); // wait for IPC roundtrip

    await page.screenshot({
      path: `${DIAG_DIR}/01-f1-list.png`,
      fullPage: false,
    });

    const state = await page.evaluate(() => {
      const f1Page = document.querySelector(
        '[data-testid="provider-list-page"]',
      ) as HTMLElement | null;
      const placeholder = document.querySelector(
        '[data-testid^="plugin-placeholder"]',
      ) as HTMLElement | null;
      const table = document.querySelector('table');
      const body = document.body.innerText;
      const h1 = document.querySelector('h1');
      const buttons = Array.from(document.querySelectorAll('button')).map(
        (b) => ({
          text: (b as HTMLButtonElement).textContent?.trim() ?? '',
          testid: (b as HTMLElement).dataset.testid ?? null,
          disabled: (b as HTMLButtonElement).disabled,
        }),
      );

      return {
        f1PageMounted: !!f1Page,
        placeholderMounted: !!placeholder,
        h1Text: h1?.textContent?.trim() ?? null,
        h2Texts: Array.from(document.querySelectorAll('h2')).map(
          (e) => (e as HTMLElement).textContent?.trim() ?? '',
        ),
        buttons,
        bodySnippet: body.substring(0, 1500),
        hasTable: !!table,
        tableRowCount: table?.querySelectorAll('tbody tr').length || 0,
        hasError: body.includes('错误') || body.includes('TypeId') || body.includes('state not managed'),
        hasLoading: body.includes('加载中') || body.includes('Loading'),
        hasEmpty: body.includes('还没有') || body.includes('空') || body.includes('暂'),
        tauriInternalPresent:
          typeof (window as any).__TAURI_INTERNALS__ !== 'undefined',
      };
    });

    console.log('[01 F1 STATE]', JSON.stringify(state, null, 2));
    console.log('[01 console errors]', JSON.stringify(consoleErrors, null, 2));

    // DOM-level assertions — these are the M2.2.3 fix regression gates.
    expect(state.f1PageMounted, 'F1 page must mount').toBe(true);
    expect(state.hasError, 'DOM must not show TypeId/state-not-managed errors').toBe(false);
    expect(state.placeholderMounted, 'plugin-placeholder must NOT replace F1').toBe(false);
  });

  test('02 F3 page: DOM clean (no managed-state error strings)', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => {
      consoleErrors.push(`pageerror: ${err.message}`);
    });

    await page.goto('http://localhost:1420/');
    await page.waitForSelector('[data-testid="app-header"]', { timeout: 15000 });
    await page.waitForTimeout(500);

    await page.click('[data-testid="sidebar-item-import-sql"]');
    await page.waitForTimeout(1500);

    await page.screenshot({
      path: `${DIAG_DIR}/02-f3-page.png`,
      fullPage: false,
    });

    const state = await page.evaluate(() => {
      const f3Page = document.querySelector(
        '[data-testid="import-sql-page"]',
      ) as HTMLElement | null;
      const placeholder = document.querySelector(
        '[data-testid^="plugin-placeholder"]',
      ) as HTMLElement | null;
      const body = document.body.innerText;
      const h1 = document.querySelector('h1');
      const buttons = Array.from(document.querySelectorAll('button')).map(
        (b) => ({
          text: (b as HTMLButtonElement).textContent?.trim() ?? '',
          testid: (b as HTMLElement).dataset.testid ?? null,
        }),
      );
      const fileInputs = document.querySelectorAll('input[type="file"]').length;

      return {
        f3PageMounted: !!f3Page,
        placeholderMounted: !!placeholder,
        h1Text: h1?.textContent?.trim() ?? null,
        h2Texts: Array.from(document.querySelectorAll('h2')).map(
          (e) => (e as HTMLElement).textContent?.trim() ?? '',
        ),
        buttons,
        fileInputs,
        bodySnippet: body.substring(0, 1500),
        hasError:
          body.includes('错误') ||
          body.includes('TypeId') ||
          body.includes('state not managed'),
        hasUploadCta:
          body.includes('选择') ||
          body.includes('导入') ||
          body.includes('点此'),
        tauriInternalPresent:
          typeof (window as any).__TAURI_INTERNALS__ !== 'undefined',
      };
    });

    console.log('[02 F3 STATE]', JSON.stringify(state, null, 2));
    console.log('[02 console errors]', JSON.stringify(consoleErrors, null, 2));

    expect(state.f3PageMounted, 'F3 page must mount').toBe(true);
    expect(state.hasError, 'DOM must not show TypeId/state-not-managed errors').toBe(false);
    expect(state.placeholderMounted, 'plugin-placeholder must NOT replace F3').toBe(false);
  });

  test('03 IPC availability probe (expected: no __TAURI_INTERNALS__ in bare vite)', async ({ page }) => {
    await page.goto('http://localhost:1420/');
    await page.waitForSelector('[data-testid="app-header"]', { timeout: 15000 });
    await page.waitForTimeout(500);

    const probe = await page.evaluate(() => {
      const tauri = (window as any).__TAURI_INTERNALS__;
      return {
        tauriInternalPresent: typeof tauri !== 'undefined',
        hasInvoke: typeof tauri?.invoke === 'function',
        // Browser context — no Tauri runtime, so invoke is not callable.
        contextNote: 'vite dev without Tauri runtime → __TAURI_INTERNALS__ expected undefined',
      };
    });

    console.log('[03 IPC PROBE]', JSON.stringify(probe, null, 2));

    // IMPORTANT: in pure vite dev (no `npm run tauri dev`), the Tauri
    // runtime is NOT injected into the WebView. So __TAURI_INTERNALS__
    // is undefined. The Rust IPC roundtrip test for F1/F3 must be
    // done in the actual Tauri webview (release exe via smoke test).
    //
    // We record the probe result but DO NOT fail on tauriInternalPresent=false.
    // The DOM checks in 01/02 are the primary regression gate.
    expect(typeof probe.tauriInternalPresent).toBe('boolean');
  });

  test('04 sidebar navigation: home + provider-list + import-sql + provider-switch', async ({ page }) => {
    await page.goto('http://localhost:1420/');
    await page.waitForSelector('[data-testid="app-header"]', { timeout: 15000 });
    await page.waitForTimeout(500);

    // Visit each sidebar entry and screenshot.
    const views: { id: string; file: string }[] = [
      { id: 'home', file: '04a-home.png' },
      { id: 'provider-list', file: '04b-provider-list.png' },
      { id: 'import-sql', file: '04c-import-sql.png' },
      { id: 'provider-switch', file: '04d-provider-switch.png' },
    ];

    for (const v of views) {
      await page.click(`[data-testid="sidebar-item-${v.id}"]`);
      await page.waitForTimeout(1200);
      await page.screenshot({
        path: `${DIAG_DIR}/${v.file}`,
        fullPage: false,
      });
    }

    const state = await page.evaluate(() => {
      const allText = document.body.innerText;
      return {
        sidebarItems: Array.from(
          document.querySelectorAll('[data-testid^="sidebar-item-"]'),
        ).length,
        bodySnippet: allText.substring(0, 800),
        hasTypeIdError: allText.includes('TypeId') || allText.includes('state not managed'),
      };
    });

    console.log('[04 SIDEBAR NAV]', JSON.stringify(state, null, 2));
    expect(state.sidebarItems).toBeGreaterThanOrEqual(12);
    expect(state.hasTypeIdError, 'no TypeId error must appear in any navigated view').toBe(false);
  });
});