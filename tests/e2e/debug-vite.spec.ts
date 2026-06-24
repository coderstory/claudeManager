import { test, expect } from '@playwright/test';

test('debug: vite dev 1420 loads without JS errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
  });

  await page.goto('http://localhost:1420/', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);

  // 截图 (如果可以)
  await page.screenshot({ path: 'tmp/vite-dev-debug.png', fullPage: true });

  // 看页面是否白屏 (body 内容是否为空)
  const bodyText = await page.locator('body').innerText();
  const hasSidebar = await page.locator('[data-testid="app-sidebar"]').count();
  const hasHeader = await page.locator('[data-testid="app-header"]').count();
  const hasMain = await page.locator('[data-testid="app-main"]').count();

  console.log('--- DEBUG OUTPUT ---');
  console.log('JS errors:', JSON.stringify(errors, null, 2));
  console.log('body text (first 500 chars):', bodyText.slice(0, 500));
  console.log('sidebar count:', hasSidebar);
  console.log('header count:', hasHeader);
  console.log('main count:', hasMain);

  // 至少不白屏 + 至少有 sidebar
  expect(errors.filter((e) => !e.includes('manifest') && !e.includes('favicon')).length).toBe(0);
  expect(hasSidebar).toBeGreaterThan(0);
});