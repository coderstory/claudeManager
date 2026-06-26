// snap5.mjs — Playwright 截图 5 主题 + 保存到 demo/screenshots/
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const OUT = '/Users/coderstory/CodeSource/winui3/docs/superpowers/specs/2026-06-26-ui-redesign/demo/screenshots';
mkdirSync(OUT, { recursive: true });

const THEMES = ['light', 'liquid-glass', 'dark', 'editorial', 'pixel'];

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 720 } });
const page = await ctx.newPage();

for (const theme of THEMES) {
  await page.goto(`http://127.0.0.1:8765/index.html?theme=${theme}&bust=${Date.now()}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/${theme}.png`, fullPage: false });
  console.log(`✓ ${theme}.png`);
}
await browser.close();