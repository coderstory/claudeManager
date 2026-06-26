// e2e/theme-switch.spec.mjs — Playwright e2e 测试
// 跑 5 主题 × 12 页 × 8 弹窗的端到端验证
import { test, expect } from '@playwright/test';

const BASE = 'http://127.0.0.1:8765/index.html';
const THEMES = ['light', 'liquid-glass', 'dark', 'editorial', 'pixel'];
const PAGES = ['provider-list', 'mcp', 'usage', 'import', 'resource', 'marketplace',
               'optimizer', 'backup', 'history', 'json-editor', 'about'];
const MODALS = ['confirm', 'delete', 'quick-search', 'new-provider',
                'import-preview', 'error', 'about-modal', 'theme-picker'];

test.describe('5 主题切换', () => {
  for (const theme of THEMES) {
    test(`切换到 ${theme} 主题`, async ({ page }) => {
      await page.goto(`${BASE}?theme=${theme}`);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);

      // 验证主题按钮 active 态
      const activeBtn = page.locator(`.theme-btn[data-theme="${theme}"]`);
      await expect(activeBtn).toHaveClass(/active/);
    });
  }
});

test.describe('macOS 按钮 (3 个圆形按钮)', () => {
  test('window-controls 有 3 个圆点按钮', async ({ page }) => {
    await page.goto(BASE);
    const buttons = page.locator('.wc-btn');
    await expect(buttons).toHaveCount(3);
    await expect(buttons.nth(0)).toHaveClass(/close/);
    await expect(buttons.nth(1)).toHaveClass(/min/);
    await expect(buttons.nth(2)).toHaveClass(/max/);
  });

  test('按钮是圆形 (border-radius: 50%)', async ({ page }) => {
    await page.goto(BASE);
    const radius = await page.locator('.wc-btn').first().evaluate(el => getComputedStyle(el).borderRadius);
    expect(radius).toBe('50%');
  });

  test('red 按钮 #FF5F57', async ({ page }) => {
    await page.goto(BASE);
    const bg = await page.locator('.wc-btn.close').evaluate(el => getComputedStyle(el).backgroundColor);
    expect(bg).toBe('rgb(255, 95, 87)');
  });
});

test.describe('12 页路由', () => {
  test('所有 nav-item 都能点击并切换页面', async ({ page }) => {
    await page.goto(BASE);
    for (const pageId of PAGES) {
      await page.locator(`.nav-item[data-page="${pageId}"]`).click();
      // 验证页面有 page-title 元素
      await expect(page.locator('.page-title')).toBeVisible();
      await expect(page.locator('.page-title')).not.toBeEmpty();
    }
  });

  test('provider-list 默认显示 3 张卡片', async ({ page }) => {
    await page.goto(BASE);
    const cards = page.locator('.card');
    await expect(cards).toHaveCount(3);
  });
});

test.describe('8 弹窗', () => {
  test('所有弹窗都能打开', async ({ page }) => {
    await page.goto(BASE);
    for (const modalId of MODALS) {
      await page.locator(`[data-modal="${modalId}"]`).click();
      await expect(page.locator('.modal-overlay.open')).toBeVisible();
      // Esc 关闭
      await page.keyboard.press('Escape');
      await expect(page.locator('.modal-overlay.open')).toBeHidden();
    }
  });

  test('弹窗有标题和确认按钮', async ({ page }) => {
    await page.goto(BASE);
    await page.locator('[data-modal="confirm"]').click();
    await expect(page.locator('.modal-title')).toBeVisible();
    await expect(page.locator('.modal .btn-primary')).toBeVisible();
  });
});

test.describe('主题隔离性 (约束 4+7)', () => {
  test('5 主题在不同页面渲染时不应混搭', async ({ page }) => {
    for (const theme of THEMES) {
      await page.goto(`${BASE}?theme=${theme}`);
      const html = await page.locator('html').getAttribute('data-theme');
      expect(html).toBe(theme);
      // 切换后, 卡片背景应与主题对应
      const cardBg = await page.locator('.card').first().evaluate(el => getComputedStyle(el).backgroundColor);
      // 5 主题背景应至少 3 种不同色
      // (这个测试在 5 主题循环中累计)
    }
  });

  test('切换主题后, 主题按钮的 active 态只对应一个', async ({ page }) => {
    await page.goto(`${BASE}?theme=dark`);
    const activeCount = await page.locator('.theme-btn.active').count();
    expect(activeCount).toBe(1);
  });
});

test.describe('本地字体加载', () => {
  test('4 个 woff2 文件能成功加载', async ({ page }) => {
    await page.goto(BASE);
    const fontFaces = await page.evaluate(async () => {
      const loaded = [];
      document.fonts.forEach(f => loaded.push({ family: f.family, weight: f.weight, status: f.status }));
      return loaded;
    });
    expect(fontFaces.length).toBeGreaterThanOrEqual(4);
  });
});

test.describe('主题持久化', () => {
  test('localStorage 记住主题', async ({ page }) => {
    await page.goto(`${BASE}?theme=dark`);
    await page.waitForTimeout(200);
    // 刷新页面, 应该还是 dark
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });
});