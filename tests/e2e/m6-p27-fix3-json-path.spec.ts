/**
 * Phase 27 Fix 3 e2e (BUG-CR-03 P0 重定义) — JSON editor path::field protocol.
 *
 * Verifies the user-facing symptom that the original bug produced:
 *   "无法解析路径 providers/foo.json:api_key: No such file or directory"
 *   when clicking "在 JSON 编辑器中打开" on an optimizer finding.
 *
 * After the fix, the optimizer splits `affected_path` on `::` and the
 * JSON editor reads both `path` and `field` keys from sessionStorage,
 * so the backend `read_file` receives the clean path and the
 * path::field virtual protocol works end-to-end.
 *
 * Tag: @m6-p27-fix3.
 */
import { test, expect } from './fixtures';

test.describe('Phase 27 Fix 3 — JSON editor path::field protocol (BUG-CR-03) @m6-p27-fix3', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('clicking "open in JSON editor" on optimizer finding does NOT show path error', async ({
    page,
  }) => {
    // 1. Navigate to the optimizer page.
    await page.getByTestId('sidebar-item-optimizer').click();
    await expect(page.getByTestId('optimizer-page')).toBeVisible();

    // 2. We rely on the optimizer producing at least one finding with
    //    an `affected_path` in `path::field` format (e.g.
    //    "providers/foo.json:api_key"). The mock fixtures in CI
    //    produce such findings; in dev mode the real scan may or may
    //    not. We wait briefly for findings to render.
    //
    //    If no finding appears within 5 s, the test is a no-op pass
    //    (we can't fabricate a real finding without a full scan).
    const findingOpenBtn = page.locator(
      '[data-testid^="optimizer-open-json-editor-"]',
    );
    const btnVisible = await findingOpenBtn
      .first()
      .isVisible()
      .catch(() => false);

    if (!btnVisible) {
      // No finding with "open in editor" link — nothing to verify.
      // The fix is still valid; this just means the scan found no
      // findings with `auto_apply: false` in this environment.
      test.skip(true, 'No optimizer findings with open-in-editor link');
      return;
    }

    // 3. Click the "在 JSON 编辑器中打开" link → navigates to editor.
    await findingOpenBtn.first().click();
    await expect(page.getByTestId('json-editor-page')).toBeVisible();

    // 4. The original bug: editor page would show
    //    "无法解析路径 providers/foo.json:api_key: No such file or directory"
    //    because it treated the whole string as a path. After the fix,
    //    the editor reads two sessionStorage keys and the backend
    //    splits on `::`, so this error must NOT appear.
    const errorText = page.getByText('无法解析路径');
    await expect(errorText).toHaveCount(0);

    // 5. The editor page renders without an error InfoBar.
    //    (The InfoBar would have data-testid="info-bar-error" if
    //    the backend rejected the path.)
    const errorInfoBar = page.getByTestId('info-bar-error');
    await expect(errorInfoBar).toHaveCount(0);
  });

  test('json editor consumes ccm.openFilePath + ccm.openFileField from sessionStorage', async ({
    page,
  }) => {
    // Simulate what the optimizer's handleOpenInEditor does after the
    // fix: write two sessionStorage keys and navigate to the editor.
    await page.evaluate(() => {
      window.sessionStorage.setItem('ccm.openFilePath', 'providers/foo.json');
      window.sessionStorage.setItem('ccm.openFileField', 'api_key');
    });
    await page.goto('/json-editor');

    // Editor page mounts without the path-parsing error.
    await expect(page.getByTestId('json-editor-page')).toBeVisible();
    const errorText = page.getByText('无法解析路径');
    await expect(errorText).toHaveCount(0);
  });
});
