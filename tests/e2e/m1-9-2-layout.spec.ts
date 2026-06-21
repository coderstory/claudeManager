/**
 * M1.9.2 layout diagnostic — Playwright-driven visual + numeric evidence
 * of the 3 reported UI problems on the chrome-and-glass.exe build:
 *
 *   1. main pane scroll behaviour (forced hide vs internal scroll)
 *   2. back button visibility under the OS chrome / drag region
 *   3. theme effects (glass / acrylic / Mica backdrop)
 *
 * Reads / writes ONLY .planning/diagnostics/m1-9-2-layout/*; never
 * touches source files. Connects to vite dev at http://localhost:1420
 * (Tauri release build has CDP disabled, so dev mode is the canonical
 * "what the webview shows" path).
 */
import { test, expect } from '@playwright/test';

const DIAG_DIR = '.planning/diagnostics/m1-9-2-layout';

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

function rect(el: Element | null): Box | null {
  if (!el) return null;
  const r = (el as HTMLElement).getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}

test.describe('M1.9.2 layout diagnostic', () => {
  test('home view @ 1024x640: full layout + chrome positions', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 640 });
    await page.goto('http://localhost:1420/');
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('[data-testid="app-header"]', { timeout: 15000 });

    // Allow framer-motion + AnimatePresence to settle.
    await page.waitForTimeout(500);

    await page.screenshot({
      path: `${DIAG_DIR}/01-home-1024x640.png`,
      fullPage: false,
    });

    const layout = await page.evaluate(() => {
      const root = document.querySelector('[data-testid="app-root"]') as HTMLElement;
      const header = document.querySelector('[data-testid="app-header"]') as HTMLElement;
      const sidebar = document.querySelector('[data-testid="app-sidebar"]') as HTMLElement;
      const main = document.querySelector('[data-testid="app-main"]') as HTMLElement;
      const minBtn = document.querySelector('[data-testid="app-header-minimize"]') as HTMLElement;
      const maxBtn = document.querySelector('[data-testid="app-header-maximize"]') as HTMLElement;
      const closeBtn = document.querySelector('[data-testid="app-header-close"]') as HTMLElement;
      const windowControls = document.querySelector('[data-testid="app-header-window-controls"]') as HTMLElement;
      // M2.16 theme-trim: 主题切换按钮已删(单档 light),此处保留
      // null 采集以维持诊断快照 schema 兼容。
      const themeToggle = null;
      const settings = document.querySelector('[data-testid="app-header-settings"]') as HTMLElement;

      const captureBox = (el: HTMLElement | null) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return {
          x: r.x, y: r.y, width: r.width, height: r.height,
          visible: r.width > 0 && r.height > 0,
          offsetParent: el.offsetParent !== null,
          overflow: cs.overflow,
          overflowY: cs.overflowY,
          backdropFilter: cs.backdropFilter || cs.webkitBackdropFilter || null,
          background: cs.backgroundColor,
          backgroundImage: cs.backgroundImage,
        };
      };

      return {
        window: { innerWidth: window.innerWidth, innerHeight: window.innerHeight },
        docScrollHeight: document.documentElement.scrollHeight,
        docHasVerticalScrollbar: document.documentElement.scrollHeight > window.innerHeight,
        bodyOverflow: getComputedStyle(document.body).overflow,
        bodyBg: getComputedStyle(document.body).backgroundColor,
        root: captureBox(root),
        header: captureBox(header),
        sidebar: captureBox(sidebar),
        main: captureBox(main),
        mainScrollHeight: main?.scrollHeight ?? null,
        mainClientHeight: main?.clientHeight ?? null,
        mainCanScroll: main ? main.scrollHeight > main.clientHeight : false,
        windowControls: captureBox(windowControls),
        minBtn: captureBox(minBtn),
        maxBtn: captureBox(maxBtn),
        closeBtn: captureBox(closeBtn),
        themeToggle: captureBox(themeToggle),
        settings: captureBox(settings),
        // Capture CSS variables actually resolved at :root — this is
        // the only reliable way to know whether the glass tokens
        // ever resolved (vs being referenced but undefined).
        tokens: {
          glassBg: getComputedStyle(document.documentElement).getPropertyValue('--glass-bg').trim(),
          glassBgStrong: getComputedStyle(document.documentElement).getPropertyValue('--glass-bg-strong').trim(),
          glassBorder: getComputedStyle(document.documentElement).getPropertyValue('--glass-border').trim(),
          blurMd: getComputedStyle(document.documentElement).getPropertyValue('--blur-md').trim(),
          blurSm: getComputedStyle(document.documentElement).getPropertyValue('--blur-sm').trim(),
          accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
          bgPrimary: getComputedStyle(document.documentElement).getPropertyValue('--bg-primary').trim(),
        },
        dataTheme: document.documentElement.dataset.theme ?? null,
      };
    });

    console.log('\n=== LAYOUT DIAGNOSTIC (home @ 1024x640) ===');
    console.log(JSON.stringify(layout, null, 2));

    expect(layout).toBeTruthy();
    expect(layout.header).toBeTruthy();
    expect(layout.main).toBeTruthy();
  });

  test('plugin view (mcp-management): back button position + main scroll', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 640 });
    await page.goto('http://localhost:1420/');
    await page.waitForSelector('[data-testid="app-header"]', { timeout: 15000 });
    await page.click('[data-testid="sidebar-item-mcp-management"]');
    // Wait for AnimatePresence fade to finish (150ms + buffer).
    await page.waitForTimeout(500);

    await page.screenshot({
      path: `${DIAG_DIR}/02-mcp-1024x640.png`,
    });

    const mcpLayout = await page.evaluate(() => {
      const main = document.querySelector('[data-testid="app-main"]') as HTMLElement;
      const header = document.querySelector('[data-testid="app-header"]') as HTMLElement;
      const back = document.querySelector('[data-testid="app-header-back"]') as HTMLElement;
      const placeholder = main?.querySelector('h1') as HTMLElement;
      const headerRect = header.getBoundingClientRect();
      const backRect = back?.getBoundingClientRect();
      return {
        headerHeight: headerRect.height,
        backExists: !!back,
        backBox: backRect ? { x: backRect.x, y: backRect.y, width: backRect.width, height: backRect.height } : null,
        backY: backRect?.y ?? null,
        backBelowHeaderTop: backRect ? backRect.y >= headerRect.top - 1 : null,
        backAboveHeaderBottom: backRect ? backRect.bottom <= headerRect.bottom + 1 : null,
        backFullyInsideHeader: backRect
          ? backRect.top >= headerRect.top - 1 && backRect.bottom <= headerRect.bottom + 1
          : null,
        headerOverflow: getComputedStyle(header).overflow,
        headerBackdrop: getComputedStyle(header).backdropFilter,
        mainOverflow: main ? getComputedStyle(main).overflow : null,
        mainOverflowY: main ? getComputedStyle(main).overflowY : null,
        mainScrollHeight: main?.scrollHeight,
        mainClientHeight: main?.clientHeight,
        mainCanScroll: main ? main.scrollHeight > main.clientHeight : false,
        placeholderText: placeholder?.textContent ?? null,
        placeholderInMain: placeholder ? main.contains(placeholder) : false,
        docHasVerticalScrollbar: document.documentElement.scrollHeight > window.innerHeight,
      };
    });

    console.log('\n=== MCP LAYOUT (plugin view) ===');
    console.log(JSON.stringify(mcpLayout, null, 2));

    expect(mcpLayout.backExists).toBe(true);
  });

  test('sidebar overflow @ 720x480', async ({ page }) => {
    await page.setViewportSize({ width: 720, height: 480 });
    await page.goto('http://localhost:1420/');
    await page.waitForSelector('[data-testid="app-header"]', { timeout: 15000 });
    await page.waitForTimeout(300);

    await page.screenshot({
      path: `${DIAG_DIR}/03-home-720x480.png`,
    });

    const sidebarScroll = await page.evaluate(() => {
      const sidebar = document.querySelector('[data-testid="app-sidebar"]') as HTMLElement;
      const items = sidebar?.querySelectorAll('button[data-testid^="sidebar-item-"]') ?? ([] as NodeListOf<HTMLElement>);
      const last = items[items.length - 1];
      const lastRect = last?.getBoundingClientRect();
      const sidebarRect = sidebar.getBoundingClientRect();
      return {
        itemCount: items.length,
        sidebarScrollHeight: sidebar?.scrollHeight,
        sidebarClientHeight: sidebar?.clientHeight,
        sidebarOverflowY: sidebar ? getComputedStyle(sidebar).overflowY : null,
        sidebarCanScroll: sidebar ? sidebar.scrollHeight > sidebar.clientHeight : false,
        lastItemText: last?.textContent ?? null,
        lastItemBottomY: lastRect?.bottom ?? null,
        sidebarBottomY: sidebarRect.bottom,
        lastItemInsideSidebar: lastRect ? lastRect.bottom <= sidebarRect.bottom + 1 : false,
        lastItemVisibleInViewport: lastRect ? lastRect.bottom <= window.innerHeight : false,
      };
    });

    console.log('\n=== SIDEBAR SCROLL @ 720x480 ===');
    console.log(JSON.stringify(sidebarScroll, null, 2));
  });

  test('dark theme: pre-seed + visual', async ({ page }) => {
    // Pre-seed dark theme via localStorage so we don't depend on the
    // click being inside the viewport (the right-zone button can
    // land outside when AppRoot has overflow:hidden + a header that
    // extends past viewport — which is itself a layout finding).
    await page.addInitScript(() => {
      try { window.localStorage.setItem('ccm.theme', 'dark'); } catch {}
    });
    await page.setViewportSize({ width: 1024, height: 640 });
    await page.goto('http://localhost:1420/');
    await page.waitForSelector('[data-testid="app-header"]', { timeout: 15000 });
    // Force re-apply dark theme after navigation in case ThemeProvider
    // already ran once before localStorage was checked (it shouldn't,
    // but be defensive).
    await page.evaluate(() => {
      window.localStorage.setItem('ccm.theme', 'dark');
      document.documentElement.dataset.theme = 'dark';
    });
    await page.waitForTimeout(400);

    await page.screenshot({
      path: `${DIAG_DIR}/04-home-dark-1024x640.png`,
    });

    const darkCheck = await page.evaluate(() => {
      const root = document.documentElement;
      const cs = getComputedStyle(root);
      const bodyBg = getComputedStyle(document.body).backgroundColor;
      const header = document.querySelector('[data-testid="app-header"]') as HTMLElement;
      return {
        dataTheme: root.dataset.theme ?? null,
        bodyBg,
        accent: cs.getPropertyValue('--accent').trim(),
        bgPrimary: cs.getPropertyValue('--bg-primary').trim(),
        bgElevated: cs.getPropertyValue('--bg-elevated').trim(),
        textPrimary: cs.getPropertyValue('--text-primary').trim(),
        textSecondary: cs.getPropertyValue('--text-secondary').trim(),
        glassBg: cs.getPropertyValue('--glass-bg').trim(),
        headerBackdropFilter: getComputedStyle(header).backdropFilter,
        headerBackground: getComputedStyle(header).backgroundColor,
      };
    });

    console.log('\n=== DARK THEME ===');
    console.log(JSON.stringify(darkCheck, null, 2));
  });
});