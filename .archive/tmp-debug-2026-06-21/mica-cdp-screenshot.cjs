// CDP captureScreenshot — 拿到 webview 真实渲染的像素,排除窗口 z-order / 截屏位置问题
const http = require('http');
const fs = require('fs');
const ws = require('ws');
const { spawnSync } = require('child_process');

const PORT = 9222;
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => { let b=''; res.on('data',d=>b+=d); res.on('end',()=>resolve(JSON.parse(b))); }).on('error', reject);
  });
}

(async () => {
  const pages = await fetchJson(`http://127.0.0.1:${PORT}/json`);
  const page = pages.find(p => p.type === 'page' && p.webSocketDebuggerUrl);
  if (!page) { console.error('no page'); process.exit(1); }

  const sock = new ws(page.webSocketDebuggerUrl);
  let nextId = 1;
  const pending = new Map();
  sock.on('message', (msg) => {
    const d = JSON.parse(msg.toString());
    if (d.id && pending.has(d.id)) {
      const { res, rej } = pending.get(d.id);
      pending.delete(d.id);
      if (d.error) rej(new Error(JSON.stringify(d.error))); else res(d.result);
    }
  });
  sock.on('open', async () => {
    function send(method, params={}) {
      return new Promise((res, rej) => {
        const id = nextId++;
        pending.set(id, { res, rej });
        sock.send(JSON.stringify({ id, method, params }));
      });
    }
    async function evalExpr(expr) {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
      return r.result.value;
    }

    // 当前主题 + 关键 computed style
    const state = await evalExpr(`(() => {
      const root = document.querySelector('[data-testid="app-root"]');
      const main = document.querySelector('[data-testid="app-main"]');
      const body = document.body;
      const html = document.documentElement;
      const cs = (el) => { const c = getComputedStyle(el); return { bg: c.backgroundColor, bgImg: c.backgroundImage, opacity: c.opacity }; };
      return {
        dataTheme: html.dataset.theme,
        html: cs(html),
        body: cs(body),
        appRoot: root ? { ...cs(root), rect: root.getBoundingClientRect().toJSON() } : null,
        appMain: main ? { ...cs(main), rect: main.getBoundingClientRect().toJSON() } : null,
        splashPresent: !!document.getElementById('ccm-splash'),
        splashDisplay: document.getElementById('ccm-splash') ? getComputedStyle(document.getElementById('ccm-splash')).display : null,
        viewportW: window.innerWidth,
        viewportH: window.innerHeight,
      };
    })()`);
    console.log('[state]', JSON.stringify(state, null, 2));

    // CDP captureScreenshot (webview 真实渲染)
    console.log('[cdp] capturing webview screenshot...');
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('C:\\Users\\E-YUNF~1.QIA\\AppData\\Local\\Temp\\mica-cdp-screenshot.png', Buffer.from(shot.data, 'base64'));
    console.log('[cdp] saved webview screenshot');

    // 现在 PowerShell 读这个 PNG 中心像素
    const ps = `
Add-Type -AssemblyName System.Drawing
\$bmp = [System.Drawing.Image]::FromFile('C:\\Users\\E-YUNF~1.QIA\\AppData\\Local\\Temp\\mica-cdp-screenshot.png')
\$w = \$bmp.Width; \$h = \$bmp.Height
Write-Host "webview screenshot size: \$w x \$h"
\$cx = [int](\$w/2); \$cy = [int](\$h/2)
\$px = \$bmp.GetPixel(\$cx, \$cy)
Write-Host "webview center (\$cx,\$cy): R=\$(\$px.R) G=\$(\$px.G) B=\$(\$px.B)"
# 多采样
foreach (\$p in @(@{x=100;y=100},@{x=\$w-100;y=100},@{x=100;y=\$h-100},@{x=\$w-100;y=\$h-100},@{x=\$cx;y=\$cy})) {
  \$pp = \$bmp.GetPixel(\$p.x, \$p.y)
  Write-Host "(\$(\$p.x),\$(\$p.y)): R=\$(\$pp.R) G=\$(\$pp.G) B=\$(\$pp.B)"
}
\$bmp.Dispose()
`;
    const r = spawnSync('powershell.exe', ['-NoProfile','-Command',ps], { encoding:'utf8', timeout:10000 });
    console.log(r.stdout);
    if (r.stderr) console.error('[stderr]', r.stderr);

    sock.close();
  });
  sock.on('error', (e) => { console.error('ws error', e.message); process.exit(1); });
})().catch(e => { console.error(e); process.exit(1); });
