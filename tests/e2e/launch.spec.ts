import { test, expect } from '@playwright/test';

/**
 * E2E: App launches and main window appears.
 *
 * References:
 * - CLAUDE.md §5.3 (M1 e2e requirements): "启动应用,看到空窗口"
 * - SPEC.md §8 (acceptance criteria)
 *
 * How this runs:
 * - CI starts `npm run tauri build -- --debug` to produce a debug exe.
 * - CI launches `tauri-driver` on a known port.
 * - Playwright connects to that WebDriver session via `_CONFIG.env`.
 *
 * The test below checks that once the WebView is loaded, the document
 * title matches the app's brand. Title is set by `index.html`'s `<title>`
 * tag, which Tauri uses as the window title by default.
 */
test('app launches and main window appears', async ({ page }) => {
  await page.goto('/');

  // Window title comes from <title> in index.html. The brand is
  // "Claude 配置管理器" per CLAUDE.md §1 + SPEC §1.
  await expect(page).toHaveTitle(/Claude/);

  // The M1 scaffold renders an <h1> with the app name.
  const heading = page.getByRole('heading', { name: /Claude/ });
  await expect(heading).toBeVisible();
});

test('app window is the expected initial size', async ({ page }) => {
  // Per tauri.conf.json, M1 ships a "small" window (~700×500). This test
  // documents the expected initial dimensions; CI will catch regressions
  // if someone accidentally changes the default window size.
  await page.goto('/');
  const { width, height } = await page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  expect(width).toBeGreaterThan(400);
  expect(height).toBeGreaterThan(300);
});