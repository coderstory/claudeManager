// 清洁验证: glass-clear 主题(不 hack body bg)
// 1. CDP captureScreenshot → webview 真实渲染像素
// 2. PowerShell CopyFromScreen → 屏幕实际显示像素
// 对比两者判断 Mica 是否真的透出壁纸(红色)
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

    // 清除之前 hack 的 inline style
    console.log('[cdp] clearing inline styles...');
    await evalExpr(`(() => {
      document.documentElement.style.cssText = '';
      document.body.style.cssText = '';
      const r = document.querySelector('[data-testid="app-root"]');
      if (r) r.style.cssText = '';
      return document.documentElement.dataset.theme;
    })()`);
    await new Promise(r => setTimeout(r, 800));

    const state = await evalExpr(`(() => {
      const root = document.querySelector('[data-testid="app-root"]');
      return {
        dataTheme: document.documentElement.dataset.theme,
        htmlBg: getComputedStyle(document.documentElement).backgroundColor,
        bodyBg: getComputedStyle(document.body).backgroundColor,
        appRootBg: root ? getComputedStyle(root).backgroundColor : null,
      };
    })()`);
    console.log('[state] glass-clear clean:', JSON.stringify(state));

    // CDP captureScreenshot
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('C:\\Users\\E-YUNF~1.QIA\\AppData\\Local\\Temp\\mica-clean-cdp.png', Buffer.from(shot.data, 'base64'));

    // PowerShell: 同时读 CDP PNG + CopyFromScreen
    const ps = `
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public class W { [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r); [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h); [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left,Top,Right,Bottom; } }
"@
\$proc = Get-Process -Name 'claude-config-manager' -ErrorAction SilentlyContinue | Select-Object -First 1
[W]::SetForegroundWindow(\$proc.MainWindowHandle) | Out-Null
Start-Sleep -Milliseconds 600
\$rect = New-Object W+RECT
[W]::GetWindowRect(\$proc.MainWindowHandle, [ref]\$rect) | Out-Null
\$w = \$rect.Right - \$rect.Left; \$h = \$rect.Bottom - \$rect.Top
Write-Host "=== CDP webview screenshot ==="
\$cdpBmp = [System.Drawing.Image]::FromFile('C:\\Users\\E-YUNF~1.QIA\\AppData\\Local\\Temp\\mica-clean-cdp.png')
Write-Host "size: \$(\$cdpBmp.Width) x \$(\$cdpBmp.Height)"
\$cx=[int](\$cdpBmp.Width/2); \$cy=[int](\$cdpBmp.Height/2)
\$p=\$cdpBmp.GetPixel(\$cx,\$cy); Write-Host "cdp center: R=\$(\$p.R) G=\$(\$p.G) B=\$(\$p.B)"
foreach (\$pt in @(@{x=200;y=200},@{x=\$cdpBmp.Width-200;y=200},@{x=200;y=\$cdpBmp.Height-200},@{x=\$cdpBmp.Width-200;y=\$cdpBmp.Height-200})) {
  \$p=\$cdpBmp.GetPixel(\$pt.x,\$pt.y); Write-Host "cdp (\$(\$pt.x),\$(\$pt.y)): R=\$(\$p.R) G=\$(\$p.G) B=\$(\$p.B)"
}
\$cdpBmp.Dispose()
Write-Host ""
Write-Host "=== CopyFromScreen ==="
Write-Host "window rect: L=\$(\$rect.Left) T=\$(\$rect.Top) \${w}x\${h}"
\$bmp = New-Object System.Drawing.Bitmap(\$w, \$h)
\$g = [System.Drawing.Graphics]::FromImage(\$bmp)
\$g.CopyFromScreen(\$rect.Left, \$rect.Top, 0, 0, \$bmp.Size)
\$g.Dispose()
\$cx=[int](\$w/2); \$cy=[int](\$h/2)
\$p=\$bmp.GetPixel(\$cx,\$cy); Write-Host "screen center: R=\$(\$p.R) G=\$(\$p.G) B=\$(\$p.B)"
foreach (\$pt in @(@{x=200;y=200},@{x=\$w-200;y=200},@{x=200;y=\$h-200},@{x=\$w-200;y=\$h-200})) {
  \$p=\$bmp.GetPixel(\$pt.x,\$pt.y); Write-Host "screen (\$(\$pt.x),\$(\$pt.y)): R=\$(\$p.R) G=\$(\$p.G) B=\$(\$p.B)"
}
\$bmp.Save('C:\\Users\\E-YUNF~1.QIA\\AppData\\Local\\Temp\\mica-clean-screen.png')
\$bmp.Dispose()
`;
    const r = spawnSync('powershell.exe', ['-NoProfile','-Command',ps], { encoding:'utf8', timeout:20000 });
    console.log(r.stdout);
    if (r.stderr) console.error('[stderr]', r.stderr);

    sock.close();
  });
  sock.on('error', (e) => { console.error('ws error', e.message); process.exit(1); });
})().catch(e => { console.error(e); process.exit(1); });
