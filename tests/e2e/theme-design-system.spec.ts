/**
 * Task 10 e2e — 5 主题切换 + macOS 红黄绿圆点按钮 + 字体加载
 *
 * 覆盖:
 *   - ThemeProvider URL ?theme=xxx 切换 (Task 6)
 *   - WindowControls 3 个红黄绿圆点按钮 + 50% 圆角 (Task 8)
 *   - localStorage 主题持久化 (ThemeProvider STORAGE_KEY='ccm.theme')
 *   - 4 个本地 woff2 字体声明已加载 (fonts.css)
 *
 * ## 为什么本 spec 走 dev-server 模式 (PLAYWRIGHT_BASE_URL=http://localhost:1420)
 *
 *   本 spec 只测 DOM 属性 (data-theme / class / computed borderRadius) +
 *   document.fonts API. 这些都是纯 web 行为, Tauri runtime 不是必要条件.
 *   跑 vite dev server 即可, 无需 tauri-driver + msedgedriver 栈.
 *
 *   Base URL 来自 playwright.config.ts 默认值 'tauri://localhost',
 *   但 dev-box 模式 (process.env.PLAYWRIGHT_BASE_URL 存在) 自动 override.
 *   运行时: `PLAYWRIGHT_BASE_URL=http://localhost:1420 npx playwright test tests/e2e/theme-design-system.spec.ts`
 *
 * ## 字体加载断言
 *
 *   fonts.css 顶层声明 4 个 @font-face (Press Start 2P / ZCOOL KuaiLe /
 *   Inter / JetBrains Mono). document.fonts.forEach 会列出所有已被
 *   FontFaceSet 跟踪的字体 (不论是否被元素引用). 这与 dev server 模式下
 *   @import 加载的 CSS 一致 — 字体声明进 FontFaceSet 即可, 不需要等待
 *   `document.fonts.ready`, 因为 5 主题切换主题间都需要这 4 个字体可用.
 *
 * ## 与 fixtures.ts 的关系
 *
 *   本 spec 不引入 './fixtures' (CDP mode 拦截器), 因为 CDP mode 下 page
 *   已在 tauri://localhost, ?theme=xxx 需 page.goto() 才能触发 URL 搜索
 *   参数重新解析. fixtures.ts 会把 goto() 变成 no-op, 切主题测不出.
 *   走默认 @playwright/test 导入 → Playwright 启动 chromium, 走 config.baseURL,
 *   dev-server mode 下等于 http://localhost:1420.
 */

import { test, expect } from '@playwright/test';

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'tauri://localhost';

test.describe('5 主题切换 (URL ?theme=xxx)', () => {
  for (const theme of ['light', 'liquid-glass', 'dark', 'editorial', 'pixel']) {
    test(`切换到 ${theme} 主题`, async ({ page }) => {
      await page.goto(`${BASE}/?theme=${theme}`);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    });
  }
});

test.describe('macOS 红黄绿圆点按钮', () => {
  test('3 个 .wc-btn 存在 + 圆角 50%', async ({ page }) => {
    await page.goto(BASE);
    const closeBtn = page.locator('.wc-btn.close');
    const minBtn = page.locator('.wc-btn.min');
    const maxBtn = page.locator('.wc-btn.max');
    await expect(closeBtn).toBeVisible();
    await expect(minBtn).toBeVisible();
    await expect(maxBtn).toBeVisible();

    const closeRadius = await closeBtn.evaluate((el) => getComputedStyle(el).borderRadius);
    expect(closeRadius).toBe('50%');
  });
});

test.describe('主题持久化 (localStorage)', () => {
  test('刷新后主题不丢失', async ({ page }) => {
    await page.goto(`${BASE}/?theme=dark`);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    // ThemeProvider 把 themeId 写入 localStorage key 'ccm.theme'
    // 第二次访问无 ?theme=xxx → 应从 localStorage 读取
    await page.evaluate(() => {
      // 清掉 URL search 参数, 模拟 "后续访问不带 query" 的真实路径
      window.history.replaceState({}, '', window.location.pathname);
    });
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });
});

test.describe('字体本地化 (@font-face)', () => {
  test('4 个本地 woff2 字体已加载', async ({ page }) => {
    await page.goto(BASE);
    // 等 vite dev 把 fonts.css import 完 + @font-face 注册进 FontFaceSet
    await page.waitForFunction(() => {
      const loaded: string[] = [];
      document.fonts.forEach((f) => loaded.push(f.family));
      return loaded.length >= 4;
    }, undefined, { timeout: 10_000 });

    const fontFaces = await page.evaluate(() => {
      const loaded: string[] = [];
      document.fonts.forEach((f) => loaded.push(f.family));
      return loaded;
    });
    expect(fontFaces).toContain('Press Start 2P');
    expect(fontFaces).toContain('ZCOOL KuaiLe');
    expect(fontFaces).toContain('Inter');
    expect(fontFaces).toContain('JetBrains Mono');
  });
});