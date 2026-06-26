// debug.mjs — 抓 .card 真实 outerHTML 和计算样式
import { chromium } from '/Users/coderstory/CodeSource/winui3/node_modules/playwright-core/index.mjs';
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto('http://localhost:8765/index.html?bust=' + Date.now(), { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
const info = await page.evaluate(() => {
  const c = document.querySelector('.card');
  const r = c.getBoundingClientRect();
  const cs = getComputedStyle(c);
  return {
    outerHTML: c.outerHTML.slice(0, 500),
    rect: { top: r.top, height: r.height, width: r.width },
    computed: {
      marginTop: cs.marginTop,
      marginBottom: cs.marginBottom,
      padding: cs.padding,
      display: cs.display,
      height: cs.height,
      borderBottom: cs.borderBottom,
    },
    space3: getComputedStyle(document.documentElement).getPropertyValue('--space-3'),
    space4: getComputedStyle(document.documentElement).getPropertyValue('--space-4'),
  };
});
console.log(JSON.stringify(info, null, 2));
await browser.close();