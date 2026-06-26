// snap.mjs — 单主题单页截图，输出 PNG 看实际效果
import { chromium } from '/Users/coderstory/CodeSource/winui3/node_modules/playwright-core/index.mjs';
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto('http://localhost:8765/index.html?nocache=' + Date.now(), { waitUntil: 'networkidle' });
await page.evaluate(() => document.documentElement.dataset.theme = 'light');
await page.waitForTimeout(300);
await page.screenshot({ path: '/Users/coderstory/CodeSource/winui3/docs/superpowers/specs/2026-06-26-ui-redesign/demo/shot-light.png', fullPage: false });
console.log('light saved');
// 用 evaluate 抓真实计算样式
const info = await page.evaluate(() => {
  const card = document.querySelector('.card.active');
  const row = card.querySelector('.card-row');
  const actions = card.querySelector('.card-actions');
  const btn = card.querySelector('.btn-primary');
  return {
    cardRect: card.getBoundingClientRect(),
    rowRect: row.getBoundingClientRect(),
    rowComputedDisplay: getComputedStyle(row).display,
    rowComputedJustify: getComputedStyle(row).justifyContent,
    actionsRect: actions.getBoundingClientRect(),
    actionsComputedDisplay: getComputedStyle(actions).display,
    btnRect: btn.getBoundingClientRect(),
    btnText: btn.textContent,
    btnVisible: btn.offsetWidth > 0 && btn.offsetHeight > 0,
  };
});
console.log(JSON.stringify(info, null, 2));
await browser.close();