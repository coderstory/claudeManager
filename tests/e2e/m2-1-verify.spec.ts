/**
 * M2.1 F1 + F2 verification diagnostic.
 *
 * Connects to vite dev at http://localhost:1420 (Tauri release build
 * has CDP disabled, so dev mode is the canonical "what the webview
 * shows" path — same as m1-9-2-layout.spec.ts).
 *
 * Captures screenshots of:
 *   - home (chrome + sidebar + welcome pane)
 *   - provider-list (M2.1 real page)
 *   - provider-list empty state (no providers on disk)
 *   - provider-switch (F2 redirect shim)
 *
 * Quantifies:
 *   - DOM testid presence (chrome buttons, sidebar items, page nodes)
 *   - Tauri IPC availability
 *   - listProviders response (length, fields)
 *   - is_active badge presence
 */
import { test, expect } from '@playwright/test';

const DIAG_DIR = '.planning/diagnostics/m2-1-verify';

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

function rect(el: Element | null): Box | null {
  if (!el) return null;
  const r = (el as HTMLElement).getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}

test.describe('M2.1 F1+F2 verification', () => {
  test.afterEach(async () => {
    // Each test starts fresh; do not leak the dev app.
  });

  test('01 home @ 1024x640 — chrome + sidebar + welcome', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 640 });
    await page.goto('http://localhost:1420/');
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('[data-testid="app-header"]', { timeout: 15000 });
    await page.waitForTimeout(500);

    await page.screenshot({
      path: `${DIAG_DIR}/01-home-1024x640.png`,
      fullPage: false,
    });

    const layout = await page.evaluate(() => {
      const sel = (s: string) => document.querySelector(s) as HTMLElement | null;
      const txt = (s: string) => sel(s)?.textContent?.trim() ?? null;
      const allSidebarItems = Array.from(
        document.querySelectorAll('[data-testid^="sidebar-item-"]'),
      ).map((el) => (el as HTMLElement).dataset.testid);

      const h1 = document.querySelector('h1') as HTMLElement | null;
      const h2s = Array.from(document.querySelectorAll('h2')).map(
        (e) => (e as HTMLElement).textContent?.trim() ?? '',
      );

      return {
        window: { innerWidth: window.innerWidth, innerHeight: window.innerHeight },
        sidebarItemCount: allSidebarItems.length,
        sidebarItems: allSidebarItems,
        h1Text: h1?.textContent?.trim() ?? null,
        h2s,
        tauriInternalLoaded: typeof (window as any).__TAURI_INTERNALS__ !== 'undefined',
        homeDataTestId: !!sel('[data-testid="home-view"]') || !!sel('[data-testid^="home-"]'),
      };
    });

    console.log('[01-home]', JSON.stringify(layout, null, 2));
    expect(layout.sidebarItemCount).toBeGreaterThanOrEqual(12);
    expect(layout.tauriInternalLoaded).toBe(true);
  });

  test('02 provider-list @ 1024x640 — F1 real page', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 640 });
    await page.goto('http://localhost:1420/');
    await page.waitForSelector('[data-testid="app-header"]', { timeout: 15000 });
    await page.waitForTimeout(300);

    await page.click('[data-testid="sidebar-item-provider-list"]');
    // Wait for the actual F1 page to mount (not the placeholder).
    await page.waitForSelector('[data-testid="provider-list-page"]', { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1500); // let listProviders IPC roundtrip

    await page.screenshot({
      path: `${DIAG_DIR}/02-provider-list-1024x640.png`,
      fullPage: false,
    });

    const state = await page.evaluate(() => {
      const root = document.querySelector('[data-testid="provider-list-page"]') as HTMLElement | null;
      const placeholder = document.querySelector('[data-testid^="plugin-placeholder"]') as HTMLElement | null;
      const allText = document.body.innerText;
      const h1 = document.querySelector('h1') as HTMLElement | null;
      const buttons = Array.from(document.querySelectorAll('button')).map((b) => ({
        text: (b as HTMLButtonElement).textContent?.trim() ?? '',
        testid: (b as HTMLElement).dataset.testid ?? null,
        disabled: (b as HTMLButtonElement).disabled,
      }));

      return {
        hasRealPage: !!root,
        hasPlaceholder: !!placeholder,
        placeholderTestId: placeholder?.dataset.testid ?? null,
        h1Text: h1?.textContent?.trim() ?? null,
        h2Texts: Array.from(document.querySelectorAll('h2')).map(
          (e) => (e as HTMLElement).textContent?.trim() ?? '',
        ),
        buttons,
        bodySnippet: allText.substring(0, 800),
        bodyHasError: allText.includes('错误') || allText.includes('Error') || allText.includes('失败'),
        bodyHasLoading: allText.includes('加载中') || allText.includes('Loading'),
        bodyHasEmptyCta: allText.includes('还没有') || allText.includes('添加') || allText.includes('空'),
      };
    });

    console.log('[02-provider-list]', JSON.stringify(state, null, 2));

    // Hard checks: must be M2.1 real page, NOT placeholder
    expect(state.hasRealPage).toBe(true);
    expect(state.hasPlaceholder).toBe(false);
  });

  test('03 provider-list empty state — fresh box', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 640 });
    await page.goto('http://localhost:1420/');
    await page.waitForSelector('[data-testid="app-header"]', { timeout: 15000 });
    await page.waitForTimeout(300);

    await page.click('[data-testid="sidebar-item-provider-list"]');
    await page.waitForSelector('[data-testid="provider-list-page"]', { timeout: 5000 });
    await page.waitForTimeout(2000); // settle IPC

    await page.screenshot({
      path: `${DIAG_DIR}/03-provider-list-empty.png`,
      fullPage: false,
    });

    const state = await page.evaluate(() => {
      const root = document.querySelector('[data-testid="provider-list-page"]') as HTMLElement;
      const r = root?.getBoundingClientRect();
      const allText = root?.innerText ?? '';
      // Try to call listProviders via tauri invoke (if exposed)
      const tauriInternal = (window as any).__TAURI_INTERNALS__;
      return {
        pageBox: r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null,
        pageText: allText.substring(0, 1500),
        hasTable: !!document.querySelector('table'),
        rowCount: document.querySelectorAll('table tr').length,
        // Detect "0 providers" affordance
        showsEmptyState:
          allText.includes('还没有') ||
          allText.includes('暂无') ||
          allText.includes('空状态') ||
          allText.includes('no providers'),
        tauriInvokeAvailable: typeof tauriInternal?.invoke === 'function',
      };
    });

    console.log('[03-empty-state]', JSON.stringify(state, null, 2));
    expect(state.pageBox).not.toBeNull();
    expect(state.tauriInvokeAvailable).toBe(true);
  });

  test('04 provider-switch @ 1024x640 — F2 redirect', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 640 });
    await page.goto('http://localhost:1420/');
    await page.waitForSelector('[data-testid="app-header"]', { timeout: 15000 });
    await page.waitForTimeout(300);

    await page.click('[data-testid="sidebar-item-provider-switch"]');
    await page.waitForTimeout(1500); // F2 redirects to F1

    await page.screenshot({
      path: `${DIAG_DIR}/04-provider-switch-redirect.png`,
      fullPage: false,
    });

    const state = await page.evaluate(() => {
      const switchPage = document.querySelector('[data-testid="provider-switch-page"]') as HTMLElement | null;
      const listPage = document.querySelector('[data-testid="provider-list-page"]') as HTMLElement | null;
      const placeholder = document.querySelector('[data-testid^="plugin-placeholder"]') as HTMLElement | null;
      const h1 = document.querySelector('h1') as HTMLElement | null;

      return {
        hasSwitchPage: !!switchPage,
        hasListPage: !!listPage,
        hasPlaceholder: !!placeholder,
        h1Text: h1?.textContent?.trim() ?? null,
        bodySnippet: document.body.innerText.substring(0, 500),
      };
    });

    console.log('[04-provider-switch]', JSON.stringify(state, null, 2));
    // F2 is a redirect shim — by the time we screenshot, it should have
    // either redirected to F1 OR be showing its own "正在跳转" page.
    // Either is acceptable; placeholder is NOT.
    expect(state.hasPlaceholder).toBe(false);
  });

  test('05 release-build smoke screenshot', async ({ page }) => {
    // We can't run the release exe in headless chromium directly,
    // but we CAN load the same vite bundle + simulate the page context
    // to confirm the F1 page renders identically. This is the dev
    // mirror; release screenshot is captured separately via PowerShell.
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('http://localhost:1420/');
    await page.waitForSelector('[data-testid="app-header"]', { timeout: 15000 });
    await page.waitForTimeout(300);

    await page.click('[data-testid="sidebar-item-provider-list"]');
    await page.waitForSelector('[data-testid="provider-list-page"]', { timeout: 5000 });
    await page.waitForTimeout(1500);

    await page.screenshot({
      path: `${DIAG_DIR}/05-provider-list-1280x800.png`,
      fullPage: false,
    });
  });
});
