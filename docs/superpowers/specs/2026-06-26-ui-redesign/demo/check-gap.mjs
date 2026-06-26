// check-gap.mjs — 检查 .card 之间的间距
import { chromium } from '/Users/coderstory/CodeSource/winui3/node_modules/playwright-core/index.mjs';
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto('http://localhost:8765/index.html?bust=' + Date.now(), { waitUntil: 'networkidle' });

for (const theme of ['light', 'liquid-glass', 'dark', 'editorial', 'chinese']) {
  await page.evaluate(t => document.documentElement.dataset.theme = t, theme);
  await page.waitForTimeout(300);
  const data = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('.card'));
    return cards.map((c, i) => {
      const r = c.getBoundingClientRect();
      return { i, top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height), bg: getComputedStyle(c).backgroundColor, border: getComputedStyle(c).border, margin: getComputedStyle(c).margin };
    });
  });
  console.log('\n=== ' + theme + ' ===');
  data.forEach(c => console.log(`card ${c.i}: top=${c.top} bottom=${c.bottom} h=${c.height} bg=${c.bg} margin=${c.margin}`));
  for (let i = 1; i < data.length; i++) {
    const gap = data[i].top - data[i-1].bottom;
    console.log(`  gap[${i-1}→${i}] = ${gap}px`);
  }
}
await browser.close();