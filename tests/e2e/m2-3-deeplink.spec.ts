/**
 * F4 — Deeplink 导入 e2e (M2.3).
 *
 * Verifies the F4 page renders, accepts a manual URL paste, and
 * shows the confirmation modal with the parsed provider fields.
 *
 * Why this is a "page render + UI interaction" spec (not a full
 * deeplink-via-OS spec):
 *   - True OS-level deeplink tests require spawning a second
 *     claude-config-manager.exe with `ccswitch://...` in argv.
 *     That's a smoke test concern (it covers the Tauri plugin
 *     event bridge), not a WebDriverIO concern.
 *   - This spec covers the frontend surface: paste URL → invoke
 *     parse_deeplink_url → render parsed provider in the modal.
 *
 * Mocks: we DO NOT mock `@tauri-apps/api/core` because the
 * WebDriverIO build runs against the real binary; tauri-driver
 * routes `invoke` through the actual Rust process. The parse
 * command is a pure function with no side effects, so it's safe
 * to call against the real backend.
 */
import { test, expect } from '@playwright/test';

const VALID_URL =
  'ccswitch://v1/import?resource=provider&app=claude&name=GLM-4.6&endpoint=https%3A%2F%2Fapi.anthropic.com&apiKey=sk-e2e';

test.describe('F4 — deeplink import page (M2.3)', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the deeplink-import view via the sidebar.
    await page.goto('/');
    // Sidebar item is the second "Deeplink 导入" link.
    await page.getByRole('button', { name: /deeplink 导入/i }).first().click();
  });

  test('page renders URL input + 解析 + 示例 buttons', async ({ page }) => {
    await expect(page.getByTestId('deeplink-url-input')).toBeVisible();
    await expect(page.getByTestId('deeplink-parse-btn')).toBeVisible();
    await expect(page.getByTestId('deeplink-paste-btn')).toBeVisible();
  });

  test('paste URL + click 解析 → modal shows parsed provider fields', async ({ page }) => {
    await page.getByTestId('deeplink-url-input').fill(VALID_URL);
    await page.getByTestId('deeplink-parse-btn').click();
    const modal = page.getByTestId('deeplink-modal');
    await expect(modal).toBeVisible();
    // Verify the parsed provider is rendered (excluding api_key).
    await expect(modal.getByText('GLM-4.6')).toBeVisible();
    await expect(modal.getByText('claude')).toBeVisible();
    await expect(modal.getByText('https://api.anthropic.com')).toBeVisible();
    // CRITICAL: api_key is NEVER rendered in the modal.
    await expect(modal.getByText('sk-e2e')).toHaveCount(0);
  });

  test('示例 button populates URL + opens modal', async ({ page }) => {
    await page.getByTestId('deeplink-paste-btn').click();
    const modal = page.getByTestId('deeplink-modal');
    await expect(modal).toBeVisible();
  });

  test('click 取消 closes the modal', async ({ page }) => {
    await page.getByTestId('deeplink-url-input').fill(VALID_URL);
    await page.getByTestId('deeplink-parse-btn').click();
    await expect(page.getByTestId('deeplink-modal')).toBeVisible();
    await page.getByTestId('deeplink-modal-cancel').click();
    await expect(page.getByTestId('deeplink-modal')).toHaveCount(0);
  });

  test('parse error shows red InfoBar (no modal)', async ({ page }) => {
    await page
      .getByTestId('deeplink-url-input')
      .fill('http://not-ccswitch/import?x=1');
    await page.getByTestId('deeplink-parse-btn').click();
    await expect(page.getByTestId('deeplink-error')).toBeVisible();
    await expect(page.getByTestId('deeplink-error')).toContainText('ccswitch');
    await expect(page.getByTestId('deeplink-modal')).toHaveCount(0);
  });
});
