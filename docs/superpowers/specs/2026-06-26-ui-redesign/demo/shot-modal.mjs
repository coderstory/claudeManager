// shot-modal.mjs — 拍 liquid-glass 主题下 confirm 弹窗
import { chromium } from '/Users/coderstory/CodeSource/winui3/node_modules/playwright-core/index.mjs';
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto('http://localhost:8765/index.html?bust=' + Date.now(), { waitUntil: 'networkidle' });
await page.evaluate(() => document.documentElement.dataset.theme = 'liquid-glass');
await page.waitForTimeout(400);
await page.evaluate(() => openModal('confirm'));
await page.waitForTimeout(400);
await page.screenshot({ path: '/Users/coderstory/CodeSource/winui3/docs/superpowers/specs/2026-06-26-ui-redesign/demo/shot-liquid-modal.png', fullPage: false });
const info = await page.evaluate(() => {
  const o = document.getElementById('modalOverlay');
  const m = document.getElementById('modal');
  return {
    overlay: { bg: getComputedStyle(o).backgroundColor, blur: getComputedStyle(o).backdropFilter },
    modal: { bg: getComputedStyle(m).backgroundColor, blur: getComputedStyle(m).backdropFilter, border: getComputedStyle(m).border, shadow: getComputedStyle(m).boxShadow.slice(0, 100) },
  };
});
console.log(JSON.stringify(info, null, 2));
await browser.close();