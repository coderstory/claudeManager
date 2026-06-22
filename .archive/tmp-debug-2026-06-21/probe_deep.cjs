// Targeted probe — measure the gap between header and main.
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

async function deep(view) {
  return await evalExpr(`
    (() => {
      const header = document.querySelector('[data-testid="app-header"]');
      const main = document.querySelector('[data-testid="app-main"]');
      // Look at the parent layout to understand positioning
      const parent = main ? main.parentElement : null;
      const parentCS = parent ? getComputedStyle(parent) : null;
      const parentRect = parent ? parent.getBoundingClientRect() : null;
      const headerCS = header ? getComputedStyle(header) : null;
      const headerRect = header ? header.getBoundingClientRect() : null;
      const mainCS = main ? getComputedStyle(main) : null;
      const mainRect = main ? main.getBoundingClientRect() : null;
      // First child of main = viewDiv
      const viewDiv = main ? main.firstElementChild : null;
      const viewCS = viewDiv ? getComputedStyle(viewDiv) : null;
      const viewRect = viewDiv ? viewDiv.getBoundingClientRect() : null;
      // First child of viewDiv = page wrapper div
      const wrapper = viewDiv ? viewDiv.firstElementChild : null;
      const wrapperCS = wrapper ? getComputedStyle(wrapper) : null;
      const wrapperRect = wrapper ? wrapper.getBoundingClientRect() : null;
      // First child of wrapper = real content
      const content = wrapper ? wrapper.firstElementChild : null;
      const contentCS = content ? getComputedStyle(content) : null;
      const contentRect = content ? content.getBoundingClientRect() : null;
      // Inspect the inline style attribute of wrapper if any
      const wrapperStyleAttr = wrapper ? wrapper.getAttribute('style') : null;
      return {
        parent: { tag: parent?.tagName, rect: parentRect, position: parentCS?.position, display: parentCS?.display },
        header: { rect: headerRect, position: headerCS?.position, top: headerCS?.top, height: headerCS?.height },
        main: { rect: mainRect, top: mainCS?.top, paddingTop: mainCS?.paddingTop, marginTop: mainCS?.marginTop, position: mainCS?.position },
        viewDiv: { rect: viewRect, paddingTop: viewCS?.paddingTop, marginTop: viewCS?.marginTop },
        wrapper: {
          rect: wrapperRect,
          tag: wrapper?.tagName,
          styleAttr: wrapperStyleAttr,
          paddingTop: wrapperCS?.paddingTop,
          marginTop: wrapperCS?.marginTop,
          display: wrapperCS?.display,
        },
        content: { rect: contentRect, tag: content?.tagName, paddingTop: contentCS?.paddingTop, marginTop: contentCS?.marginTop },
      };
    })()
  `);
}

(async () => {
  sock.on('open', async () => {
    try {
      const views = ['home', 'mcp-management', 'backup-restore', 'resource-browser'];
      for (const v of views) {
        await clickSidebar(v);
        const data = await deep(v);
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