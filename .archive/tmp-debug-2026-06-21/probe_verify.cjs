// Verify probe — measure main first-child top across views after fix.
const ws = require('ws');
const url = process.argv[2];
const sock = new ws(url);
let nextId = 1;
const pending = new Map();
function send(method, params = {}) { return new Promise((res, rej) => { const id = nextId++; pending.set(id, { res, rej }); sock.send(JSON.stringify({ id, method, params })); }); }
async function evalExpr(expr) { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails)); return r.result.value; }
async function clickSidebar(view) { await evalExpr(`document.querySelector('[data-testid="sidebar-item-${view}"]').click()`); await new Promise(r => setTimeout(r, 600)); }
async function measure(view) {
  return await evalExpr(`
    (() => {
      const r = (el) => el ? { top: el.getBoundingClientRect().top, left: el.getBoundingClientRect().left, height: el.getBoundingClientRect().height } : null;
      const header = document.querySelector('[data-testid="app-header"]');
      const main = document.querySelector('[data-testid="app-main"]');
      const viewDiv = main.firstElementChild;
      const wrapper = viewDiv.firstElementChild;
      const content = wrapper.firstElementChild;
      return {
        headerBottom: header.getBoundingClientRect().top + header.getBoundingClientRect().height,
        mainTop: main.getBoundingClientRect().top,
        wrapperTop: wrapper.getBoundingClientRect().top,
        contentTop: content.getBoundingClientRect().top,
        contentTag: content.tagName,
        mainInlineTop: main.style.top,
        wrapperStyle: wrapper.getAttribute('style'),
      };
    })()
  `);
}
(async () => {
  sock.on('open', async () => {
    try {
      const views = ['home', 'mcp-management', 'backup-restore', 'resource-browser', 'deeplink-import', 'json-editor'];
      for (const v of views) {
        await clickSidebar(v);
        const d = await measure(v);
        const gap = d.headerBottom && d.contentTop ? (d.contentTop - d.headerBottom) : null;
        console.log('=== ' + v + ' ===');
        console.log('  main inline top:', d.mainInlineTop);
        console.log('  header bottom:', d.headerBottom);
        console.log('  main top:', d.mainTop, 'wrapper top:', d.wrapperTop);
        console.log('  content top:', d.contentTop, '(tag=' + d.contentTag + ')');
        console.log('  GAP header-bottom -> content-top:', gap);
      }
    } catch (e) { console.error('ERR:', e.message); }
    finally { sock.close(); process.exit(0); }
  });
  sock.on('error', (e) => { console.error('WS error:', e.message); process.exit(1); });
  sock.on('message', (msg) => { const d = JSON.parse(msg.toString()); if (d.id && pending.has(d.id)) { const { res, rej } = pending.get(d.id); pending.delete(d.id); if (d.error) rej(new Error(JSON.stringify(d.error))); else res(d.result); } });
})();