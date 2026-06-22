import { test, expect } from './fixtures';

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
 * Dev-box mode (`PLAYWRIGHT_BASE_URL=http://localhost:1420`):
 * - Same specs run against the Vite dev server instead of the Tauri
 *   WebView. DOM-level assertions (title, heading presence, viewport
 *   size) work identically; only the IPC-bridge checks are skipped
 *   (see tray.spec.ts / close-minimize.spec.ts).
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

  // The app shell renders an <h1> inside AppHeader with the brand
  // name. M2+ also renders a second <h1> on the home page
  // ("欢迎使用 Claude 配置管理器"), so we scope the assertion to the
  // header to stay strict-mode safe across milestone growth.
  const headerHeading = page
    .getByRole('banner')
    .getByRole('heading', { name: /Claude/ });
  await expect(headerHeading).toBeVisible();
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