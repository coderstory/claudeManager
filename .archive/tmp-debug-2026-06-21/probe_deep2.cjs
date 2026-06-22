// Quick re-probe for views that showed no H1 — scan deeper + check sidebar item labels
const fs = require('fs');
const http = require('http');
const ws = require('ws');

function getJSON(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve(JSON.parse(body)));
    }).on('error', reject);
  });
}

(async () => {
  const targets = await getJSON('http://localhost:9223/json');
  const page = targets.find((t) => t.type === 'page' && t.url.includes('tauri.localhost'));
  const sock = new ws(page.webSocketDebuggerUrl);
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
  async function navigate(view) {
    await evalExpr(`localStorage.setItem('ccm.lastView', ${JSON.stringify(view)})`);
    await evalExpr(`document.querySelector('[data-testid="sidebar-item-${view}"]').click()`);
    await new Promise((r) => setTimeout(r, 800));
  }
  async function deep(view) {
    return await evalExpr(`
      (() => {
        const main = document.querySelector('[data-testid="app-main"]');
        const allH1 = main ? main.querySelectorAll('h1, h2, h3') : [];
        const h1List = Array.from(allH1).map(h => ({
          tag: h.tagName, text: h.textContent.trim().slice(0, 40),
          fontSize: getComputedStyle(h).fontSize,
          fontWeight: getComputedStyle(h).fontWeight,
          marginTop: getComputedStyle(h).marginTop,
          marginBottom: getComputedStyle(h).marginBottom,
        }));
        // Walk view tree
        const tree = [];
        function walk(node, depth) {
          if (depth > 5) return;
          if (node.nodeType === 1) {
            const cs = getComputedStyle(node);
            tree.push({
              tag: node.tagName,
              depth,
              padding: cs.padding,
              paddingTop: cs.paddingTop,
              paddingLeft: cs.paddingLeft,
              maxWidth: cs.maxWidth,
              styleAttr: (node.getAttribute('style') || '').slice(0, 200),
            });
            for (const c of node.children) walk(c, depth + 1);
          }
        }
        const viewRoot = main ? main.firstElementChild : null;
        if (viewRoot) walk(viewRoot, 0);
        return { h1List, tree: tree.slice(0, 40) };
      })()
    `);
  }
  sock.on('open', async () => {
    try {
      const views = ['provider-switch', 'optimizer', 'resource-browser'];
      const out = {};
      for (const v of views) {
        await navigate(v);
        out[v] = await deep(v);
      }
      fs.writeFileSync('D:/project/winui3/tmp/detail-page-probe-deep.json', JSON.stringify(out, null, 2));
      console.log('saved');
    } catch (e) { console.error(e.message); } finally { sock.close(); process.exit(0); }
  });
  sock.on('error', (e) => { console.error(e.message); process.exit(1); });
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
