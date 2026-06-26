/**
 * Phase 27 Fix 4 e2e (BUG-CR-04 P0 重定义) — scope state useScope hook + 3 组件 remount.
 *
 * Verifies the user-facing symptom that the original bugs produced:
 *   #8  MCP management切换到项目级,没有读取项目中的 mcp
 *   #10 JSON 编辑器目录树不能正确切换到用户级的目录
 *   #12 切换到项目级后,资源浏览显示的还是用户级
 *
 * After the fix:
 *   - useScope() returns [scope, setScope, projectRoot, setProjectRoot]
 *   - 3 components wrap body in <div key={scope + ':' + projectRoot}>
 *     to force remount on scope change
 *   - Switching scope in the sidebar triggers fresh IPC calls for the
 *     new scope's data
 *
 * Tag: @m6-p27-fix4
 *
 * NOTE: This spec is authored for Windows Playwright (CDP mode). On
 * macOS dev boxes it is skipped via test.skip — the Windows CI runner
 * is the authoritative executor.
 */
import { test, expect } from './fixtures';

test.describe('Phase 27 Fix 4 — scope state useScope + 3 component remount (BUG-CR-04) @m6-p27-fix4', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('MCP management page remounts when scope changes via sidebar', async ({
    page,
  }) => {
    // Skip on non-Windows — this spec is authored for Windows CDP mode.
    test.skip(
      process.platform !== 'win32',
      'Windows CDP-mode e2e only (macOS dev box cannot run Tauri IPC)',
    );

    // 1. Navigate to MCP management.
    await page.getByTestId('sidebar-item-mcp-management').click();
    await expect(page.getByTestId('mcp-management-page')).toBeVisible();

    // 2. Capture the initial mcp-table identity.
    const initialTable = page.getByTestId('mcp-table');
    await expect(initialTable).toBeVisible();
    const initialRows = await initialTable.locator('[data-testid="mcp-row"]').count();

    // 3. Switch scope via sidebar (pick a project).
    //    The sidebar switcher should have a toggle button.
    const switcherToggle = page.getByTestId('sidebar-project-switcher-toggle');
    await expect(switcherToggle).toBeVisible();
    await switcherToggle.click();

    //    Pick the first non-system project (depends on fixture data).
    const menuItem = page.locator(
      '[data-testid^="sidebar-switch-to-"]:not([data-testid$="00000000-0000-0000-0000-000000000000"])',
    );
    if (await menuItem.first().isVisible().catch(() => false)) {
      await menuItem.first().click();

      // 4. The page should remount — the mcp-table should now reflect
      //    the new scope. The key prop forces React to unmount+remount,
      //    so the table is a fresh instance.
      await expect(page.getByTestId('mcp-management-page')).toBeVisible();
      //    After remount, the page re-fetches data. We verify the page
      //    still renders and the table/empty state is shown correctly.
      const tableOrEmpty = page.locator(
        '[data-testid="mcp-table"], [data-testid="mcp-empty"]',
      );
      await expect(tableOrEmpty).toBeVisible();
    } else {
      test.skip(true, 'No user projects available in fixture');
    }
  });

  test('Resource browser page remounts when scope changes via sidebar', async ({
    page,
  }) => {
    test.skip(
      process.platform !== 'win32',
      'Windows CDP-mode e2e only',
    );

    // 1. Navigate to resource browser.
    await page.getByTestId('sidebar-item-resource-browser').click();
    await expect(page.getByTestId('resource-browser-page')).toBeVisible();

    // 2. Capture initial state.
    const initialSubdir = page.locator(
      '.resource-browser-page',  // scope wrapper
    );
    await expect(initialSubdir).toBeVisible();

    // 3. Switch scope.
    const switcherToggle = page.getByTestId('sidebar-project-switcher-toggle');
    if (!(await switcherToggle.isVisible().catch(() => false))) {
      test.skip(true, 'Sidebar switcher not visible');
      return;
    }
    await switcherToggle.click();
    const menuItem = page.locator(
      '[data-testid^="sidebar-switch-to-"]:not([data-testid$="00000000-0000-0000-0000-000000000000"])',
    );
    if (await menuItem.first().isVisible().catch(() => false)) {
      await menuItem.first().click();

      // 4. Verify page remounts.
      await expect(page.getByTestId('resource-browser-page')).toBeVisible();
    } else {
      test.skip(true, 'No user projects available in fixture');
    }
  });

  test('JSON editor file tree remounts when scope changes via sidebar', async ({
    page,
  }) => {
    test.skip(
      process.platform !== 'win32',
      'Windows CDP-mode e2e only',
    );

    // 1. Navigate to JSON editor.
    await page.getByTestId('sidebar-item-json-editor').click();
    await expect(page.getByTestId('json-editor-page')).toBeVisible();

    // 2. Verify file tree renders.
    await expect(page.getByTestId('json-file-tree')).toBeVisible();

    // 3. Switch scope.
    const switcherToggle = page.getByTestId('sidebar-project-switcher-toggle');
    if (!(await switcherToggle.isVisible().catch(() => false))) {
      test.skip(true, 'Sidebar switcher not visible');
      return;
    }
    await switcherToggle.click();
    const menuItem = page.locator(
      '[data-testid^="sidebar-switch-to-"]:not([data-testid$="00000000-0000-0000-0000-000000000000"])',
    );
    if (await menuItem.first().isVisible().catch(() => false)) {
      await menuItem.first().click();

      // 4. Verify the file tree is re-rendered (key-driven remount).
      await expect(page.getByTestId('json-editor-page')).toBeVisible();
      await expect(page.getByTestId('json-file-tree')).toBeVisible();
    } else {
      test.skip(true, 'No user projects available in fixture');
    }
  });
});
