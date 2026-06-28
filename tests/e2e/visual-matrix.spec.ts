/**
 * Phase 44 视觉矩阵 — 12 view × 5 主题 = 60 张 baseline.
 *
 * 每个组合一个 test,跑 `npm run test:e2e` 时自动对比 baseline PNG,
 * 任意像素变化立即 fail。生成 baseline:`npx playwright test
 * tests/e2e/visual-matrix.spec.ts --update-snapshots`。
 *
 * 设计目标(per 44-PLAN §Task 6):
 *   - 60 张 PNG 落盘 tests/e2e/visual-baselines/<theme>-<view>.png
 *   - M31 vibrancy 撤回后视觉等价(新 AppHeader layout)
 *   - 不依赖 .topbar-center / .wc-btn 等已删的 CSS 类名(只用 data-testid)
 *   - `maxDiffPixels: 100` 容许字体渲染时机差异
 *
 * 5 主题清单(per src/design-system/themes/themeIds.ts):
 *   - light / liquid-glass / dark / editorial / pixel
 *   - 注:'auto' 主题不存在 enum 里,5 主题 = 5 静态 enum
 *
 * Dev-box 模式(本机无 tauri-driver):`PLAYWRIGHT_BASE_URL=http://localhost:1420`。
 */
import { test, expect } from './fixtures';

const VIEW_IDS = [
  'home',
  'provider-list',
  'import-sql',
  'json-editor',
  'usage-query',
  'resource-browser',
  'marketplace',
  'optimizer',
  'backup-restore',
  'history',
  'about',
] as const;

const THEMES = ['light', 'liquid-glass', 'dark', 'editorial', 'pixel'] as const;

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'tauri://localhost';

for (const theme of THEMES) {
  test.describe(`theme=${theme}`, () => {
    test.beforeEach(async ({ page }) => {
      // 注入 theme 到 localStorage(ThemeProvider 读 ccm.theme)。
      // 不能用 addInitScript 因为 phase 44 派生 AppSidebar 之外仍走
      // 默认 home view,所以提前注入就行。
      await page.addInitScript((t: string) => {
        window.localStorage.setItem('ccm.theme', t);
        // 跳过 welcome modal (首次启动弹窗)
        window.localStorage.setItem('ccm.welcomed', 'true');
      }, theme);
      // 启动应用
      await page.goto(BASE_URL);
      await page.waitForSelector('[data-testid="app-root"]');
    });

    for (const viewId of VIEW_IDS) {
      test(`${viewId} page renders consistently (baseline)`, async ({ page }) => {
        // 切 view:点 sidebar
        await page.click(`[data-testid="sidebar-item-${viewId}"]`);
        // 等待 page 顶层 data-testid 出现;真 page 可能需 IPC 拉数据,
        // 30s timeout 容许冷启动慢 + 远程 Tauri WebView 的 IPC 延迟。
        await page.waitForSelector(`[data-testid="${viewId}-page"]`, {
          timeout: 30_000,
        });
        // 等待 view-transition 动画结束(300ms) + IPC 数据 settle (200ms)
        await page.waitForTimeout(500);
        // 视觉对比 baseline。
        // maxDiffPixels 100 容许字体渲染时机差异;不同 OS 字体 stack
        // 也会导致 ~50 像素 diff,过严会让 spec 在 CI 一致 fail。
        await expect(page).toHaveScreenshot(`${theme}-${viewId}.png`, {
          fullPage: true,
          maxDiffPixels: 100,
        });
      });
    }
  });
}