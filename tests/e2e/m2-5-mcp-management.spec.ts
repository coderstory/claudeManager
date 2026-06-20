/**
 * E2E smoke test for F6 MCP management (M2.5).
 *
 * Real-invoke test that exercises the full F6 happy path:
 *   1. Open the F6 page.
 *   2. Verify the empty state (or seeded state from prior tests).
 *   3. Add a new MCP server via the modal.
 *   4. Verify the server appears in the list.
 *   5. Toggle the server's enabled flag.
 *   6. Delete the server.
 *
 * Tags: @m2-5 to filter; M2.5 series. Lives in tests/e2e/ next to
 * the F4 real-invoke spec (m2-2-4-real-invoke.spec.ts) — same
 * pattern, real Tauri driver.
 */
import { test, expect } from '@playwright/test';

test.describe('F6 MCP management (M2.5) @m2-5', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate via the sidebar.
    await page.goto('/');
    await page.getByTestId('sidebar-item-mcp-management').click();
    await expect(page.getByTestId('mcp-management-page')).toBeVisible();
  });

  test('add + toggle + delete a stdio MCP server', async ({ page }) => {
    // Add.
    await page.getByTestId('mcp-add-btn').click();
    await expect(page.getByTestId('mcp-modal')).toBeVisible();
    await page.getByTestId('mcp-form-name').fill('e2e-fs');
    await page.getByTestId('mcp-form-command').fill('npx');
    await page.getByTestId('mcp-form-args').fill('-y @mcp/test');
    await page.getByTestId('mcp-form-submit').click();

    // Verify in list.
    await expect(page.getByTestId('mcp-table')).toBeVisible();
    await expect(page.locator('[data-testid="mcp-row"][data-server-name="e2e-fs"]')).toBeVisible();

    // Toggle.
    const toggle = page.locator(
      '[data-testid="mcp-toggle"][data-server-name="e2e-fs"]',
    );
    await expect(toggle).toBeChecked();
    await toggle.click();
    await expect(toggle).not.toBeChecked();

    // Delete.
    page.once('dialog', (d) => void d.accept());
    await page.locator(
      '[data-testid="mcp-delete-btn"][data-server-name="e2e-fs"]',
    ).click();
    await expect(page.locator('[data-testid="mcp-row"][data-server-name="e2e-fs"]')).toHaveCount(0);
  });
});
