// audit.mjs — 用 Playwright 扫 5 主题 × 12 页 + 8 弹窗, 找布局瑕疵
import { chromium } from '/Users/coderstory/CodeSource/winui3/node_modules/playwright-core/index.mjs';

const BASE = 'http://localhost:8765/index.html';
const THEMES = ['light', 'liquid-glass', 'dark', 'editorial', 'chinese'];
const PAGES = ['provider-list', 'mcp', 'usage', 'import', 'resource', 'marketplace', 'optimizer', 'backup', 'history', 'json-editor', 'about'];
const MODALS = ['confirm', 'delete', 'quick-search', 'new-provider', 'import-preview', 'error', 'about-modal', 'theme-picker'];

const out = [];
const browser = await chromium.launch({ headless: true });

for (const theme of THEMES) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', e => errs.push('PAGEERR: ' + e.message));

  // 初始化主题
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(t => document.documentElement.dataset.theme = t, theme);

  // 检查每页
  for (const pageId of PAGES) {
    await page.evaluate(p => document.querySelector(`[data-page="${p}"]`).click(), pageId);
    await page.waitForTimeout(150);

    const issues = await page.evaluate(() => {
      const out = [];
      // 1) 检查每张 .card 的右侧元素 (徽章 / 按钮) 是否被遮挡 / 不可见
      document.querySelectorAll('.card').forEach((card, i) => {
        const row = card.querySelector('.card-row');
        if (!row) return;
        const cardRect = card.getBoundingClientRect();
        const rightChildren = Array.from(row.children).slice(1); // 第二个起视为右侧
        rightChildren.forEach((child, j) => {
          const r = child.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) {
            out.push({ type: 'card-right-invisible', page: window.location.href, card: i, child: j, html: child.outerHTML.slice(0, 80) });
          } else if (r.right > cardRect.right - 4) {
            out.push({ type: 'card-right-overflow', page: window.location.href, card: i, child: j, childRight: Math.round(r.right), cardRight: Math.round(cardRect.right) });
          }
        });
      });
      // 2) 检查 .nav-item.active 是否可见
      document.querySelectorAll('.nav-item').forEach((n, i) => {
        const r = n.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) out.push({ type: 'nav-zero', idx: i });
      });
      // 3) 检查 .theme-btn.active 是否可见
      document.querySelectorAll('.theme-btn').forEach((b, i) => {
        const r = b.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) out.push({ type: 'theme-btn-zero', idx: i });
      });
      // 4) 检查 modal-launcher 是否在视口内可见
      const ml = document.querySelector('.modal-launcher');
      if (ml) {
        const r = ml.getBoundingClientRect();
        if (r.width === 0 || r.bottom > window.innerHeight) out.push({ type: 'modal-launcher-offscreen', bottom: Math.round(r.bottom), vh: window.innerHeight });
      }
      // 5) 检查 page-actions (页面右上角按钮) 是否可见
      const pa = document.querySelector('.page-actions');
      if (pa) {
        const r = pa.getBoundingClientRect();
        if (r.width === 0) out.push({ type: 'page-actions-zero' });
      }
      // 6) 检查 window-controls 顶部右上角 ─ □ × 是否可见
      const wc = document.querySelector('.window-controls');
      if (wc) {
        const r = wc.getBoundingClientRect();
        if (r.width === 0) out.push({ type: 'window-controls-zero' });
      }
      // 7) 检查 statusbar 底部状态栏是否显示
      const sb = document.querySelector('.statusbar');
      if (sb) {
        const r = sb.getBoundingClientRect();
        if (r.height < 20) out.push({ type: 'statusbar-too-thin', h: r.height });
      }
      return out;
    });

    issues.forEach(i => { i.theme = theme; i.page = pageId; out.push(i); });
  }

  // 检查每个弹窗
  for (const modalId of MODALS) {
    await page.evaluate(p => document.querySelector(`[data-modal="${p}"]`).click(), modalId);
    await page.waitForTimeout(100);
    const ok = await page.evaluate(() => {
      const m = document.getElementById('modal');
      const r = m.getBoundingClientRect();
      return r.width > 200 && r.height > 100;
    });
    if (!ok) out.push({ theme, page: 'modal:' + modalId, type: 'modal-too-small' });
    await page.evaluate(() => document.getElementById('modalOverlay').classList.remove('open'));
    await page.waitForTimeout(50);
  }

  if (errs.length) out.push({ theme, page: 'all', type: 'console-errors', errs });
  await ctx.close();
}

await browser.close();
console.log(JSON.stringify(out, null, 2));
console.log('\n=== SUMMARY ===');
console.log('Total issues:', out.length);
const byType = {};
out.forEach(i => { const k = `${i.theme} / ${i.type}`; byType[k] = (byType[k] || 0) + 1; });
console.log('By type:');
Object.entries(byType).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log('  ' + v + '  ' + k));