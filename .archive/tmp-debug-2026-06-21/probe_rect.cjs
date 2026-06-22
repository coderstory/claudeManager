// Precise rect probe — explicitly serialize DOMRects.
const ws = require('ws');
const url = 'ws://localhost:9223/devtools/page/68279509E8B58E0902BB201A3E26A54D';
const sock = new ws(url);
let nextId = 1;
const pending = new Map();

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    sock.send(JSON.stringify({ id, method, params }));
  });
}

async function evalExpr(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
}

async function clickSidebar(view) {
  await evalExpr(`document.querySelector('[data-testid="sidebar-item-${view}"]').click()`);
  await new Promise(r => setTimeout(r, 600));
}

async function measure(view) {
  return await evalExpr(`
    (() => {
      const r = (el) => el ? { top: el.getBoundingClientRect().top, left: el.getBoundingClientRect().left, height: el.getBoundingClientRect().height } : null;
      const cs = (el, props) => { if (!el) return null; const s = getComputedStyle(el); const o = {}; for (const p of props) o[p] = s[p]; return o; };
      const header = document.querySelector('[data-testid="app-header"]');
      const main = document.querySelector('[data-testid="app-main"]');
      const viewDiv = main.firstElementChild;
      const wrapper = viewDiv.firstElementChild;
      const content = wrapper.firstElementChild;
      return {
        headerRect: r(header),
        mainRect: r(main),
        viewRect: r(viewDiv),
        wrapperRect: r(wrapper),
        contentRect: r(content),
        wrapperStyle: wrapper.getAttribute('style'),
        wrapperPadTop: cs(wrapper, ['paddingTop','paddingBottom','paddingLeft','paddingRight']),
        contentTag: content.tagName,
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
        const data = await measure(v);
        const gap = data.headerRect && data.contentRect ? (data.contentRect.top - (data.headerRect.top + data.headerRect.height)) : null;
        console.log('=== ' + v + ' ===');
        console.log('  header bottom:', data.headerRect.top + data.headerRect.height);
        console.log('  main top:', data.mainRect.top);
        console.log('  wrapper top:', data.wrapperRect.top, 'wrapper padTop:', data.wrapperPadTop.paddingTop);
        console.log('  content top:', data.contentRect.top, '(tag=' + data.contentTag + ')');
        console.log('  GAP header-bottom -> content-top:', gap);
        console.log('  wrapper style:', data.wrapperStyle);
      }
    } catch (e) {
      console.error('PROBE ERROR:', e.message);
    } finally {
      sock.close();
      process.exit(0);
    }
  });
  sock.on('error', (e) => { console.error('WS error:', e.message); process.exit(1); });
  sock.on('message', (msg) => {
    const data = JSON.parse(msg.toString());
    if (data.id && pending.has(data.id)) {
      const { resolve, reject } = pending.get(data.id);
      pending.delete(data.id);
      if (data.error) reject(new Error(JSON.stringify(data.error)));
      else resolve(data.result);
    }
  });
})();