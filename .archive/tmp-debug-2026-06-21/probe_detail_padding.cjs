// Comprehensive probe — measure main first-child top across views.
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
  await evalExpr(`
    (() => {
      const el = document.querySelector('[data-testid="sidebar-item-${view}"]');
      if (!el) throw new Error('no sidebar item for ${view}');
      el.click();
      return true;
    })()
  `);
  // wait for view-transition animation + remount
  await new Promise(r => setTimeout(r, 600));
}

async function probe(view) {
  const result = await evalExpr(`
    (() => {
      const main = document.querySelector('[data-testid="app-main"]');
      if (!main) return { error: 'no main' };
      const viewDiv = document.querySelector('[data-testid="app-view"]');
      const firstChild = viewDiv ? viewDiv.firstElementChild : null;
      const header = document.querySelector('[data-testid="app-header"]');
      const headerRect = header ? header.getBoundingClientRect() : null;
      const mainRect = main.getBoundingClientRect();
      const firstRect = firstChild ? firstChild.getBoundingClientRect() : null;
      const mainCS = getComputedStyle(main);
      const viewCS = viewDiv ? getComputedStyle(viewDiv) : null;
      const firstCS = firstChild ? getComputedStyle(firstChild) : null;
      // Find first *content* element inside viewDiv (skip empty divs)
      let contentEl = null;
      if (viewDiv) {
        for (const c of viewDiv.children) {
          const r = c.getBoundingClientRect();
          if (r.height > 0) { contentEl = c; break; }
        }
      }
      const contentRect = contentEl ? contentEl.getBoundingClientRect() : null;
      return {
        header: headerRect ? { top: headerRect.top, height: headerRect.height } : null,
        main: { top: mainRect.top, left: mainRect.left, height: mainRect.height, width: mainRect.width },
        viewDiv: viewDiv ? { className: viewDiv.className, paddingTop: viewCS.paddingTop, marginTop: viewCS.marginTop } : null,
        firstChild: firstChild ? { tag: firstChild.tagName, className: (firstChild.className || '').slice(0, 80) } : null,
        firstChildRect: firstRect ? { top: firstRect.top, height: firstRect.height } : null,
        firstChildCS: firstChild ? { paddingTop: firstCS.paddingTop, marginTop: firstCS.marginTop, display: firstCS.display } : null,
        contentRect: contentRect ? { top: contentRect.top, height: contentRect.height, tag: contentEl.tagName } : null,
        mainPaddingTop: mainCS.paddingTop,
        mainOverflow: mainCS.overflow,
      };
    })()
  `);
  return result;
}

(async () => {
  sock.on('open', async () => {
    try {
      const views = ['home', 'mcp-management', 'backup-restore', 'resource-browser', 'deeplink-import', 'json-editor'];
      for (const v of views) {
        await clickSidebar(v);
        const data = await probe(v);
        console.log('=== ' + v + ' ===');
        console.log(JSON.stringify(data, null, 2));
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