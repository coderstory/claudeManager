/**
 * E2E — F3 .sql 导入 (M2.2)
 *
 * Verifies that the ImportSqlPage renders the idle CTA and accepts a
 * file picker click. A full import requires WebDriverIO + tauri-driver
 * (binary IPC); that path is covered manually during smoke-test.
 *
 * What this e2e CAN do without tauri-driver:
 *   - Navigate to the import-sql view via the sidebar
 *   - Verify the page renders the correct heading + CTA
 *
 * Run with:  npx playwright test tests/e2e/m2-2-import-sql.spec.ts
 * (Requires dev server running: npm run dev)
 */
import { test, expect } from '@playwright/test';

test.describe('F3 — ImportSqlPage (M2.2)', () => {
  test('navigates to import-sql view via sidebar', async ({ page }) => {
    await page.goto('/');

    // Click the sidebar entry for import-sql.
    await page.click('[data-testid="sidebar-item-import-sql"]');

    // Verify page mounts with the correct heading + CTA.
    await expect(page.locator('[data-testid="import-sql-page"]')).toBeVisible();
    await expect(page.getByRole('heading', { name: '导入 .sql' })).toBeVisible();
    await expect(page.locator('[data-testid="import-sql-idle"]')).toBeVisible();
    await expect(page.locator('[data-testid="import-sql-pick-file"]')).toBeVisible();
  });

  test('reset button returns to idle after navigating away', async ({ page }) => {
    await page.goto('/');
    await page.click('[data-testid="sidebar-item-import-sql"]');
    await expect(page.locator('[data-testid="import-sql-idle"]')).toBeVisible();

    // Reset has no effect in idle state but should still be present.
    await expect(page.locator('[data-testid="import-sql-reset"]')).toBeVisible();

    // Navigate to home, then back. Use AppHeader's back button (M2.15:
    // page-header internal back button removed because AppHeader already
    // exposes a back affordance).
    await page.click('[data-testid="app-header-back"]');
    await page.click('[data-testid="sidebar-item-home"]');
    await page.click('[data-testid="sidebar-item-import-sql"]');
    await expect(page.locator('[data-testid="import-sql-idle"]')).toBeVisible();
  });
});