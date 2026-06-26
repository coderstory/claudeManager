/**
 * Phase 27 Fix 6 e2e (BUG-CR-04 子件 + 业务重构) — MCP 合并到 ResourceBrowser.
 *
 * Verifies the user-facing behavior after the merge:
 *   - 侧边栏不再有 "MCP 管理" 入口 (D-10/D-12)
 *   - 资源浏览页保留 mcp tab (D-11)
 *   - 访问 /resource-browser?tab=mcp 打开时默认 mcp tab
 *   - 老 localStorage 值 'mcp-management' 自动 remap 到
 *     /resource-browser?tab=mcp (D-13)
 *
 * Tag: @m6-p27-fix6
 *
 * NOTE: This spec is authored for Windows Playwright (CDP mode). On
 * macOS dev boxes it is skipped via test.skip — the Windows CI runner
 * is the authoritative executor.
 */
import { test, expect } from './fixtures';

test.describe('Phase 27 Fix 6 — MCP merged into ResourceBrowser (BUG-CR-04 子件) @m6-p27-fix6', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('侧边栏无 MCP 管理入口 (D-10/D-12)', async ({ page }) => {
    test.skip(
      process.platform !== 'win32',
      'Windows CDP-mode e2e only (macOS dev box cannot run Tauri IPC)',
    );

    // 1. 验证侧边栏不渲染 sidebar-item-mcp-management。
    const mcpTile = page.getByTestId('sidebar-item-mcp-management');
    await expect(mcpTile).toHaveCount(0);

    // 2. 验证 sidebar-item-resource-browser 仍在(合并的目标页)。
    await expect(
      page.getByTestId('sidebar-item-resource-browser'),
    ).toBeVisible();
  });

  test('资源浏览页 mcp tab 可达 (D-11)', async ({ page }) => {
    test.skip(
      process.platform !== 'win32',
      'Windows CDP-mode e2e only',
    );

    // 1. 导航到资源浏览。
    await page.getByTestId('sidebar-item-resource-browser').click();
    await expect(page.getByTestId('resource-browser-page')).toBeVisible();

    // 2. 5 个 tab 含 mcp (含 plugin / skill / command / lsp / mcp)。
    await expect(
      page.getByTestId('resource-browser-tab-mcp'),
    ).toBeVisible();
  });

  test('localStorage 存 stale "mcp-management" → App.tsx redirect 到 /resource-browser?tab=mcp (D-13)', async ({
    page,
  }) => {
    test.skip(
      process.platform !== 'win32',
      'Windows CDP-mode e2e only',
    );

    // 1. 模拟老用户:在 localStorage 写 ccm.lastView = 'mcp-management'。
    await page.evaluate(() => {
      window.localStorage.setItem('ccm.lastView', 'mcp-management');
    });
    await page.reload();

    // 2. App.tsx 的 legacy remap useEffect 应该把 view 设回 'home'
    //    并在 ?tab=mcp 路由到 ResourceBrowser(用 useSearchParams 触发
    //    默认 mcp tab — 完整实现由 commands/frontend wiring 串联)。
    //    这里断言最后落在资源浏览页 + mcp tab active。
    await expect(
      page.getByTestId('resource-browser-page'),
    ).toBeVisible({ timeout: 5000 });
    await expect(
      page.getByTestId('resource-browser-tab-mcp'),
    ).toHaveAttribute('aria-selected', 'true');
  });
});
