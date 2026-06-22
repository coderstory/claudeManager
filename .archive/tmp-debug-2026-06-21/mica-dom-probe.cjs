// Quick DOM probe — what's in the webview?
const http = require('http');
const ws = require('ws');
const PORT = 9222;
function fetchJson(url) { return new Promise((res, rej) => { http.get(url, r => { let b=''; r.on('data',d=>b+=d); r.on('end',()=>res(JSON.parse(b))); }).on('error', rej); }); }
(async () => {
  const pages = await fetchJson(`http://127.0.0.1:${PORT}/json`);
  const page = pages.find(p => p.type === 'page' && p.webSocketDebuggerUrl);
  const sock = new ws(page.webSocketDebuggerUrl);
  let id=1; const pending=new Map();
  sock.on('message', m => { const d=JSON.parse(m.toString()); if (d.id && pending.has(d.id)) { const {res,rej}=pending.get(d.id); pending.delete(d.id); d.error?rej(new Error(JSON.stringify(d.error))):res(d.result); } });
  sock.on('open', async () => {
    function send(method, params={}) { return new Promise((res,rej) => { const i=id++; pending.set(i,{res,rej}); sock.send(JSON.stringify({id:i,method,params})); }); }
    async function ev(expr) { const r = await send('Runtime.evaluate', {expression:expr, returnByValue:true, awaitPromise:true}); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails)); return r.result.value; }

    for (let i = 0; i < 30; i++) {
      const s = await ev(`(() => ({
        url: location.href,
        title: document.title,
        bodyChildren: document.body ? document.body.children.length : -1,
        bodyHTML: document.body ? document.body.innerHTML.slice(0, 400) : 'NO BODY',
        hasAppRoot: !!document.querySelector('[data-testid="app-root"]'),
        hasToggle: !!document.querySelector('[data-testid="app-header-theme-toggle"]'),
        dataTheme: document.documentElement.dataset.theme || '(none)',
        splash: document.getElementById('ccm-splash') ? getComputedStyle(document.getElementById('ccm-splash')).display : 'no-splash',
      }))()`);
      console.log(`[${i*500}ms]`, JSON.stringify(s));
      if (s.hasAppRoot && s.hasToggle) break;
      await new Promise(r => setTimeout(r, 500));
    }
    sock.close();
  });
  sock.on('error', e => { console.error('ws err', e.message); process.exit(1); });
})().catch(e => { console.error(e); process.exit(1); });
