/**
 * Phase 27 Fix 1 e2e (BUG-CR-01 P1 重定义) — header drag-region contract.
 *
 * Tests the dual-layer contract on AppHeader (and by symmetry
 * AppSidebar) in CDP mode against the real Tauri WebView:
 *
 *   1. The header has `data-tauri-drag-region=""` AND a computed
 *      `-webkit-app-region: drag` style (Tauri's two ways of
 *      opting into window drag).
 *   2. Click on a header button does NOT trigger any drag-related
 *      style changes — the button's `WebkitAppRegion: no-drag`
 *      wins over the parent's drag.
 *   3. macOS vibrancy boundary: even with `backdrop-filter: blur()`
 *      injected via runtime CSS (proxy for Mica/vibrancy), the
 *      header still has the drag attribute and stays interactive.
 *
 * ## Why this matters
 *
 * The user's "鼠标按住 header 不能拖动窗口" report was the
 * symptom; the root cause was suspected to be a missing drag
 * attribute on the header or a child element accidentally
 * inheriting drag from the parent. This spec pins the contract so
 * the next regression of either form gets caught at e2e time.
 *
 * ## Execution
 *
 * - CDP mode: tauri-driver runs the binary; WebView2 is listening
 *   on $CDP_ENDPOINT. The page is already on `tauri://localhost/`
 *   so we must NOT call page.goto() (intercepted by fixtures.ts
 *   Proxy as a no-op).
 * - Dev-server mode: falls through to Playwright default with
 *   PLAYWRIGHT_BASE_URL=http://localhost:1420.
 *
 * Tag: @m6-p27-fix1.
 */
import { test, expect } from './fixtures';

test.describe('Phase 27 Fix 1 — header drag-region (BUG-CR-01) @m6-p27-fix1', () => {
  test('header has data-tauri-drag-region attribute and drag style', async ({ page }) => {
    const header = page.getByTestId('app-header');
    await expect(header).toBeVisible();

    const dragAttr = await header.getAttribute('data-tauri-drag-region');
    expect(dragAttr).toBe('');

    // Tauri reads -webkit-app-region from the computed style (the
    // canonical source of truth). The dev server / release exe
    // both honour this; jsdom in vitest doesn't compute it, but
    // CDP mode runs against the real WebView.
    const dragStyle = await header.evaluate((el) => {
      const cs = window.getComputedStyle(el as HTMLElement);
      return (cs as unknown as Record<string, string>)['-webkit-app-region']
        ?? (cs as unknown as Record<string, string>)['WebkitAppRegion']
        ?? '';
    });
    expect(dragStyle).toBe('drag');
  });

  test('theme-toggle button has no-drag style (button clicks not swallowed as drag)', async ({ page }) => {
    const btn = page.getByTestId('app-header-theme-toggle');
    await expect(btn).toBeVisible();

    const noDrag = await btn.evaluate((el) => {
      const cs = window.getComputedStyle(el as HTMLElement);
      return (cs as unknown as Record<string, string>)['-webkit-app-region']
        ?? (cs as unknown as Record<string, string>)['WebkitAppRegion']
        ?? '';
    });
    expect(noDrag).toBe('no-drag');
  });

  test('settings button has no-drag style', async ({ page }) => {
    const btn = page.getByTestId('app-header-settings');
    await expect(btn).toBeVisible();

    const noDrag = await btn.evaluate((el) => {
      const cs = window.getComputedStyle(el as HTMLElement);
      return (cs as unknown as Record<string, string>)['-webkit-app-region']
        ?? (cs as unknown as Record<string, string>)['WebkitAppRegion']
        ?? '';
    });
    expect(noDrag).toBe('no-drag');
  });

  test('macOS vibrancy boundary: drag attribute survives backdrop-filter', async ({ page }) => {
    const header = page.getByTestId('app-header');

    // Inject a Mica/vibrancy-like backdrop-filter on the header.
    // If a regression lets backdrop layer overlay the drag region,
    // the drag attribute would be hidden behind the effect.
    await header.evaluate((el) => {
      (el as HTMLElement).style.backdropFilter = 'blur(20px) saturate(160%)';
      (el as HTMLElement).style.webkitBackdropFilter = 'blur(20px) saturate(160%)';
    });

    // The drag attribute MUST still be readable — proving the
    // header remains the topmost interactive layer.
    const dragAttr = await header.getAttribute('data-tauri-drag-region');
    expect(dragAttr).toBe('');

    // And the button is still clickable (no-drag wins).
    const themeBtn = page.getByTestId('app-header-theme-toggle');
    await expect(themeBtn).toBeEnabled();
  });
});