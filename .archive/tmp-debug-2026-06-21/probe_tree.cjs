// Dump the full layout tree above main.
const ws = require('ws');
const url = 'ws://localhost:9223/devtools/page/68279509E8B58E0902BB201A3E26A54D';
const sock = new ws(url);
let nextId = 1;
const pending = new Map();
function send(method, params = {}) { return new Promise((res, rej) => { const id = nextId++; pending.set(id, { res, rej }); sock.send(JSON.stringify({ id, method, params })); }); }
async function evalExpr(expr) { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails)); return r.result.value; }

(async () => {
  sock.on('open', async () => {
    try {
      const data = await evalExpr(`
        (() => {
          const root = document.getElementById('root');
          const tree = (el, depth) => {
            if (!el || depth > 5) return null;
            const r = el.getBoundingClientRect();
            const cs = getComputedStyle(el);
            return {
              tag: el.tagName,
              cls: (el.className || '').toString().slice(0,60),
              testid: el.getAttribute('data-testid'),
              top: r.top, left: r.left, height: r.height, width: r.width,
              position: cs.position, top$: cs.top, display: cs.display,
              children: [...el.children].slice(0,8).map(c => tree(c, depth+1)),
            };
          };
          return tree(root, 0);
        })()
      `);
      console.log(JSON.stringify(data, null, 2));
    } catch (e) { console.error('ERR:', e.message); }
    finally { sock.close(); process.exit(0); }
  });
  sock.on('error', (e) => { console.error('WS error:', e.message); process.exit(1); });
  sock.on('message', (msg) => {
    const d = JSON.parse(msg.toString());
    if (d.id && pending.has(d.id)) {
      const { res, rej } = pending.get(d.id); pending.delete(d.id);
      if (d.error) rej(new Error(JSON.stringify(d.error))); else res(d.result);
    }
  });
})();