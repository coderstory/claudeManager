// 诊断:webview 是否真的透明?
// 1. 连 CDP
// 2. 设 body bg = rgba(255,0,0,0.5) (半透明红)
// 3. 截图 + 读像素
//    - 如果窗口内 = 红色/粉红 → webview 透明,能看到 body
//    - 如果窗口内 = 白色 → webview 白底盖住 body (不可能,因为 body 在 webview 内)
// 更准确的诊断:
//    - 设 body bg = rgba(255,0,0,0.5)
//    - 如果窗口内 = 粉红(R~255,G~127,B~127) → webview 透明 + 下层白
//    - 如果窗口内 = 纯红(R~255,G~0,B~0) → webview 透明 + 下层透明(壁纸红)
//    - 如果窗口内 = 白 → webview 不透明

const { spawnSync } = require('child_process');
const http = require('http');
const ws = require('ws');

const PORT = 9222;

function fetchJson(url, timeoutMs = 1500) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => { req.destroy(new Error('timeout')); });
  });
}

function cdpSession(wsUrl) {
  return new Promise((resolve, reject) => {
    const sock = new ws(wsUrl);
    let nextId = 1;
    const pending = new Map();
    sock.on('message', (msg) => {
      const d = JSON.parse(msg.toString());
      if (d.id && pending.has(d.id)) {
        const { res, rej } = pending.get(d.id);
        pending.delete(d.id);
        if (d.error) rej(new Error(JSON.stringify(d.error)));
        else res(d.result);
      }
    });
    sock.on('error', reject);
    function send(method, params = {}) {
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
    sock.on('open', () => resolve({ sock, evalExpr }));
  });
}

function screenshotSample() {
  const psScript = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class Win {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left,Top,Right,Bottom; }
}
"@
\$proc = Get-Process -Name 'claude-config-manager' -ErrorAction SilentlyContinue | Select-Object -First 1
\$hwnd = \$proc.MainWindowHandle
[Win]::SetForegroundWindow(\$hwnd) | Out-Null
Start-Sleep -Milliseconds 500
\$rect = New-Object Win+RECT
[Win]::GetWindowRect(\$hwnd, [ref]\$rect) | Out-Null
\$w = \$rect.Right - \$rect.Left
\$h = \$rect.Bottom - \$rect.Top
\$bmp = New-Object System.Drawing.Bitmap(\$w, \$h)
\$g = [System.Drawing.Graphics]::FromImage(\$bmp)
\$g.CopyFromScreen(\$rect.Left, \$rect.Top, 0, 0, \$bmp.Size)
\$g.Dispose()
\$centerX = [int](\$w / 2)
\$centerY = [int](\$h / 2)
\$px = \$bmp.GetPixel(\$centerX, \$centerY)
Write-Host "center (\$centerX,\$centerY): R=\$(\$px.R) G=\$(\$px.G) B=\$(\$px.B)"
\$bmp.Save("\$env:TEMP\\mica-diag-screenshot.png")
\$bmp.Dispose()
`;
  const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', psScript], { encoding: 'utf8', timeout: 15000 });
  console.log(r.stdout);
  if (r.stderr) console.error('[stderr]', r.stderr);
}

(async () => {
  const pages = await fetchJson(`http://127.0.0.1:${PORT}/json`);
  const page = pages.find((p) => p.type === 'page' && p.webSocketDebuggerUrl);
  if (!page) { console.error('no page'); process.exit(1); }
  const { sock, evalExpr } = await cdpSession(page.webSocketDebuggerUrl);

  // 确认当前主题
  const dt = await evalExpr(`document.documentElement.dataset.theme`);
  console.log('[diag] data-theme =', dt);

  // 实验 1:设 body 半透明红
  console.log('[diag] setting body bg = rgba(255,0,0,0.5)');
  await evalExpr(`document.body.style.background = 'rgba(255,0,0,0.5)'`);
  await evalExpr(`document.documentElement.style.background = 'rgba(255,0,0,0.5)'`);
  // 也设 app-root
  await evalExpr(`(() => { const r = document.querySelector('[data-testid="app-root"]'); if (r) r.style.background = 'rgba(255,0,0,0.5)'; return true; })()`);
  await new Promise((r) => setTimeout(r, 800));
  screenshotSample();

  // 实验 2:设 body 纯红不透明
  console.log('[diag] setting body bg = rgba(255,0,0,1) (opaque red)');
  await evalExpr(`document.body.style.background = 'rgba(255,0,0,1)'`);
  await evalExpr(`document.documentElement.style.background = 'rgba(255,0,0,1)'`);
  await evalExpr(`(() => { const r = document.querySelector('[data-testid="app-root"]'); if (r) r.style.background = 'rgba(255,0,0,1)'; return true; })()`);
  await new Promise((r) => setTimeout(r, 800));
  screenshotSample();

  sock.close();
})().catch((e) => { console.error(e); process.exit(1); });
