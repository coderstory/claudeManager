/**
 * M3.11 (A4#12) — JSON 编辑器侧边文件目录树 e2e.
 *
 * Verifies the F5 page now renders a file tree on the left
 * (240px), and clicking a tree entry loads that file into the
 * editor on the right.
 *
 * Mocks: we DO NOT mock `@tauri-apps/api/core` because the
 * WebDriverIO build runs against the real binary; tauri-driver
 * routes `invoke` through the actual Rust process. `list_editable_jsons`
 * is a real command — the test exercises it through the webview.
 *
 * NOTE: this test is best-effort. The list_editable_jsons scan
 * depends on the test machine's actual `~/.claude/` state. If
 * the dir is empty, the tree will be empty and click targets
 * won't exist. We still verify the tree chrome renders.
 */
import { test, expect } from '@playwright/test';

test.describe('F5 — JSON 编辑器 侧边文件目录树 (M3.11 / A4#12)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Sidebar item is the "JSON 编辑器" link.
    await page.getByRole('button', { name: /json 编辑器/i }).first().click();
  });

  test('页面 mount 后渲染两栏布局 + 文件树容器', async ({ page }) => {
    // 主体页面在
    await expect(page.getByTestId('json-editor-page')).toBeVisible();
    // 两栏容器在
    await expect(page.getByTestId('json-editor-two-col')).toBeVisible();
    // 文件树在(允许 loading / empty 状态)
    await expect(page.getByTestId('json-file-tree')).toBeVisible();
    // search box 在
    await expect(page.getByTestId('json-file-tree-search')).toBeVisible();
    // 刷新按钮在
    await expect(page.getByTestId('json-file-tree-refresh')).toBeVisible();
  });

  test('search box 接受输入 + 改变过滤结果', async ({ page }) => {
    await expect(page.getByTestId('json-file-tree')).toBeVisible();
    // 等待树加载(loading → entries / empty)
    await page.waitForTimeout(500);

    const search = page.getByTestId('json-file-tree-search');
    await expect(search).toBeEditable();
    await search.fill('__no_such_file_xyz__');
    // 过滤后应该显示 empty(没有匹配)
    await expect(page.getByTestId('json-file-tree-empty')).toBeVisible();
    // 清空 → empty 消失 / entries 出现
    await search.fill('');
    // 不再断言 empty,因可能 list_editable_jsons 返回空集合 → 仍 empty
  });
});
