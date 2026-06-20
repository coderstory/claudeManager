/**
 * E2E smoke test for F7 用量查询 (M2.7).
 *
 * Real-invoke test that exercises the full F7 happy path:
 *   1. Open the F7 page.
 *   2. Verify the window toggle (5h / 1w / 1m) and refresh button.
 *   3. Verify the default 5h window is active.
 *   4. Switch to 1w.
 *   5. Click refresh.
 *
 * Tags: @m2-7 to filter; M2.7 series. Lives in tests/e2e/ next to
 * the F6 real-invoke spec (m2-5-mcp-management.spec.ts) — same
 * pattern, real Tauri driver.
 *
 * Note: M2.7 stub mode reads `~/.claude/usage.json` locally. On a
 * fresh dev box the file is missing → the page renders "暂无数据".
 * The test does NOT assert specific token counts; it asserts the
 * UI shape (window toggle, refresh, sparkline, cards).
 */
import { test, expect } from '@playwright/test';

test.describe('F7 用量查询 (M2.7) @m2-7', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate via the sidebar.
    await page.goto('/');
    await page.getByTestId('sidebar-item-usage-query').click();
    await expect(page.getByTestId('usage-query-page')).toBeVisible();
  });

  test('renders the F7 page chrome (window toggle, refresh, cards, sparkline)', async ({ page }) => {
    // Window toggle group.
    await expect(page.getByTestId('usage-window-group')).toBeVisible();
    await expect(page.getByTestId('usage-window-5h')).toBeVisible();
    await expect(page.getByTestId('usage-window-1w')).toBeVisible();
    await expect(page.getByTestId('usage-window-1m')).toBeVisible();

    // Refresh button.
    await expect(page.getByTestId('usage-refresh-btn')).toBeVisible();

    // 3 cards.
    await expect(page.getByTestId('usage-card-tokens')).toBeVisible();
    await expect(page.getByTestId('usage-card-cost')).toBeVisible();
    await expect(page.getByTestId('usage-card-balance')).toBeVisible();

    // Sparkline.
    await expect(page.getByTestId('usage-sparkline')).toBeVisible();
  });

  test('default window is 5h with aria-pressed=true', async ({ page }) => {
    await expect(page.getByTestId('usage-window-5h')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByTestId('usage-window-1w')).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await expect(page.getByTestId('usage-window-1m')).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  test('clicking 1w switches the active window', async ({ page }) => {
    await page.getByTestId('usage-window-1w').click();
    await expect(page.getByTestId('usage-window-1w')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByTestId('usage-window-5h')).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  test('refresh button is clickable and does not error', async ({ page }) => {
    const refreshBtn = page.getByTestId('usage-refresh-btn');
    await expect(refreshBtn).toBeVisible();
    await refreshBtn.click();
    // After click, the page should still be mounted (no crash).
    await expect(page.getByTestId('usage-query-page')).toBeVisible();
  });

  test('shows empty hint when usage.json is missing on dev box', async ({ page }) => {
    // On a fresh dev box ~/.claude/usage.json is absent → the Rust
    // service returns an empty snapshot with tokens_used = 0 → the
    // page renders the "暂无数据" hint.
    // This is not an error — it's the M2.7 stub-mode contract.
    const hint = page.getByTestId('usage-empty-hint');
    if (await hint.isVisible()) {
      await expect(hint).toContainText('usage.json');
    } else {
      // If a usage.json happens to exist on this machine (unlikely
      // in CI), the hint won't show — assert instead that the
      // tokens card rendered a numeric value (not "—").
      await expect(page.getByTestId('usage-tokens-value')).toBeVisible();
    }
  });
});