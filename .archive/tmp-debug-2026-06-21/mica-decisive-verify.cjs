// M2.16-mica-fallback — 决定性验证 (纯红壁纸 + glass-clear + 像素采样)
//
// 流程:
//   1. kill 现有 exe
//   2. 启动 release exe (remote debugging port 9222)
//   3. CDP 切 glass-clear 主题 (localStorage + reload + 等 mount)
//   4. 等 1s 让 Mica 200ms spawn + 渲染
//   5. 调 PowerShell: GetWindowRect + CopyFromScreen + GetPixel 采样
//   6. 输出每个采样点 RGB
//   7. kill exe (不退出脚本)
//
// 判断: 纯红壁纸下,窗口内像素 R>200 & G<50 & B<50 = Mica 真透;
//       否则 = Mica 没透,需要 fallback。

const { spawn, spawnSync } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const ws = require('ws');

const EXE = 'D:\\project\\winui3\\src-tauri\\target\\release\\claude-config-manager.exe';
const PROC_NAMES = ['claude-config-manager'];
const PORT = 9222;

function killExisting() {
  console.log('[launcher] killing any existing instances...');
  const ps = spawnSync('powershell.exe', [
    '-NoProfile', '-Command',
    `foreach (\$n in @('${PROC_NAMES.join("','")}')) { Get-Process -Name \$n -ErrorAction SilentlyContinue | Stop-Process -Force }`,
  ]);
  if (ps.status !== 0) console.log('[launcher] kill-existing returned', ps.status);
}

function fetchJson(url, timeoutMs = 1500) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => { req.destroy(new Error('timeout')); });
  });
}

async function waitForDevtools(maxMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      const v = await fetchJson(`http://127.0.0.1:${PORT}/json/version`, 800);
      return v;
    } catch (e) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error(`DevTools not reachable on port ${PORT} within ${maxMs}ms`);
}

async function getPages() {
  return await fetchJson(`http://127.0.0.1:${PORT}/json`);
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
      const r = await send('Runtime.evaluate', {
        expression: expr,
        returnByValue: true,
        awaitPromise: true,
      });
      if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
      return r.result.value;
    }
    sock.on('open', () => resolve({ sock, send, evalExpr }));
  });
}

async function switchToGlassClear(evalExpr) {
  // 等待 app shell mount
  console.log('[cdp] waiting for app shell mount...');
  for (let i = 0; i < 40; i++) {
    const ready = await evalExpr(`!!document.querySelector('[data-testid="app-root"]') && !!document.querySelector('[data-testid="app-header-theme-toggle"]')`);
    if (ready) break;
    await new Promise((r) => setTimeout(r, 200));
  }

  // 先 localStorage 强制设 glass-clear + reload (确定性,不依赖 toggle 顺序)
  console.log('[cdp] setting localStorage ccm.theme = glass-clear + reload');
  await evalExpr(`window.localStorage.setItem('ccm.theme', 'glass-clear')`);
  await evalExpr(`location.reload()`);

  // reload 后 WS 会断,需要重连 — 但这里 sock 已经发不出去了。
  // 简化:不 reload,改用 click toggle 直到 data-theme = glass-clear。
  // (reload 会让 CDP 连接断,需重新拿 page list。下面改用 click 法。)
  return false; // reload 法不在此函数完成
}

async function clickToGlassClear(evalExpr) {
  console.log('[cdp] waiting for app shell mount...');
  for (let i = 0; i < 60; i++) {  // 12s timeout
    const ready = await evalExpr(`!!document.querySelector('[data-testid="app-root"]') && !!document.querySelector('[data-testid="app-header-theme-toggle"]')`);
    if (ready) {
      console.log('[cdp] app shell mounted after', i * 200, 'ms');
      break;
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  // 当前主题
  let dataTheme = await evalExpr(`document.documentElement.dataset.theme || '(none)'`);
  console.log('[cdp] initial data-theme =', dataTheme);

  // 循环: light → glass-clear → glass-tinted → light
  // 最多点 3 次直到 data-theme = glass-clear
  for (let i = 0; i < 4; i++) {
    if (dataTheme === 'glass-clear') {
      console.log('[cdp] reached glass-clear after', i, 'clicks');
      return;
    }
    await evalExpr(`document.querySelector('[data-testid="app-header-theme-toggle"]').click()`);
    await new Promise((r) => setTimeout(r, 400));
    dataTheme = await evalExpr(`document.documentElement.dataset.theme || '(none)'`);
    console.log('[cdp] after click', i + 1, 'data-theme =', dataTheme);
  }
  throw new Error('failed to reach glass-clear theme after 4 clicks');
}

// PowerShell 截图 + 读像素
function screenshotAndSample(procName) {
  const psScript = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class Win {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left,Top,Right,Bottom; }
}
"@
\$proc = Get-Process -Name '${procName}' -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not \$proc) { Write-Host 'ERR: process not found'; exit 1 }
\$hwnd = \$proc.MainWindowHandle
Write-Host "hwnd=\$hwnd title=\$(\$proc.MainWindowTitle)"

# 确保窗口前台 + 最大化可见
[Win]::ShowWindow(\$hwnd, 9) | Out-Null  # SW_RESTORE
Start-Sleep -Milliseconds 200
[Win]::SetForegroundWindow(\$hwnd) | Out-Null
Start-Sleep -Milliseconds 500

\$rect = New-Object Win+RECT
[Win]::GetWindowRect(\$hwnd, [ref]\$rect) | Out-Null
\$w = \$rect.Right - \$rect.Left
\$h = \$rect.Bottom - \$rect.Top
Write-Host "window rect: L=\$(\$rect.Left) T=\$(\$rect.Top) R=\$(\$rect.Right) B=\$(\$rect.Bottom) w=\$w h=\$h"

\$bmp = New-Object System.Drawing.Bitmap(\$w, \$h)
\$g = [System.Drawing.Graphics]::FromImage(\$bmp)
\$g.CopyFromScreen(\$rect.Left, \$rect.Top, 0, 0, \$bmp.Size)
\$g.Dispose()

\$shotPath = "\$env:TEMP\\mica-window-screenshot.png"
\$bmp.Save(\$shotPath, [System.Drawing.Imaging.ImageFormat]::Png)
Write-Host "screenshot saved: \$shotPath"

# 采样:中心 + 网格点 (避开标题栏 top 40px + 边缘 20px)
\$centerX = [int](\$w / 2)
\$centerY = [int](\$h / 2)
\$points = @(
  @{x=\$centerX; y=\$centerY; label='center'},
  @{x=200; y=200; label='top-left-content'},
  @{x=\$w - 200; y=200; label='top-right-content'},
  @{x=200; y=\$h - 200; label='bottom-left'},
  @{x=\$w - 200; y=\$h - 200; label='bottom-right'},
  @{x=\$centerX; y=150; label='header-area'},
  @{x=\$centerX; y=\$h - 100; label='footer-area'},
  @{x=100; y=\$centerY; label='left-edge'},
  @{x=\$w - 100; y=\$centerY; label='right-edge'}
)
foreach (\$p in \$points) {
  if (\$p.x -lt 0 -or \$p.x -ge \$w -or \$p.y -lt 0 -or \$p.y -ge \$h) { continue }
  \$px = \$bmp.GetPixel(\$p.x, \$p.y)
  Write-Host ("{0} ({1},{2}): R={3} G={4} B={5} A={6}" -f \$p.label, \$p.x, \$p.y, \$px.R, \$px.G, \$px.B, \$px.A)
}

# 额外:扫描整个内容区,统计"红色像素"(R>200 & G<60 & B<60)占比
\$redCount = 0
\$totalCount = 0
\$step = 20
for (\$y = 60; \$y -lt \$h - 20; \$y += \$step) {
  for (\$x = 20; \$x -lt \$w - 20; \$x += \$step) {
    \$px = \$bmp.GetPixel(\$x, \$y)
    \$totalCount++
    if (\$px.R -gt 200 -and \$px.G -lt 60 -and \$px.B -lt 60) { \$redCount++ }
  }
}
\$pct = if (\$totalCount -gt 0) { [math]::Round(\$redCount * 100.0 / \$totalCount, 1) } else { 0 }
Write-Host "RED_PIXEL_RATIO: \$redCount / \$totalCount = \$pct %"

\$bmp.Dispose()
`;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', psScript], {
    encoding: 'utf8',
    timeout: 30000,
  });
  console.log(result.stdout);
  if (result.stderr) console.error('[ps stderr]', result.stderr);
  if (result.status !== 0) console.log('[ps exit]', result.status);
  return result.status;
}

(async () => {
  killExisting();
  await new Promise((r) => setTimeout(r, 800));

  console.log('[launcher] starting exe with remote debugging on port', PORT);
  const env = Object.assign({}, process.env, {
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}`,
  });
  const child = spawn(EXE, [], { detached: true, stdio: 'ignore', env });
  child.unref();

  let versionInfo;
  try {
    versionInfo = await waitForDevtools(10000);
    console.log('[launcher] DevTools ready:', versionInfo.Browser || '(unknown browser)');
  } catch (e) {
    console.error('[launcher] FAIL:', e.message);
    killExisting();
    process.exit(1);
  }

  await new Promise((r) => setTimeout(r, 600));

  let pages;
  try {
    pages = await getPages();
  } catch (e) {
    console.error('[launcher] could not fetch page list:', e.message);
    killExisting();
    process.exit(1);
  }

  const page = pages.find((p) => p.type === 'page' && p.webSocketDebuggerUrl);
  if (!page) {
    console.error('[launcher] no page entry in /json; got:', JSON.stringify(pages).slice(0, 300));
    killExisting();
    process.exit(1);
  }

  console.log('[launcher] page wsUrl:', page.webSocketDebuggerUrl);

  let session;
  try {
    session = await cdpSession(page.webSocketDebuggerUrl);
  } catch (e) {
    console.error('[launcher] CDP connect failed:', e.message);
    killExisting();
    process.exit(1);
  }

  try {
    await clickToGlassClear(session.evalExpr);
  } catch (e) {
    console.error('[cdp] theme switch failed:', e.message);
    session.sock.close();
    killExisting();
    process.exit(1);
  }

  // 确认主题 + computed bg
  const confirm = await session.evalExpr(`(() => {
    const root = document.querySelector('[data-testid="app-root"]');
    const main = document.querySelector('[data-testid="app-main"]');
    return {
      dataTheme: document.documentElement.dataset.theme,
      appRootBg: root ? getComputedStyle(root).backgroundColor : null,
      appMainBg: main ? getComputedStyle(main).backgroundColor : null,
    };
  })()`);
  console.log('[cdp] confirm theme state:', JSON.stringify(confirm));

  session.sock.close();

  // 等 Mica 200ms spawn + 渲染稳定
  console.log('[launcher] waiting 1500ms for Mica to settle...');
  await new Promise((r) => setTimeout(r, 1500));

  // 截图 + 读像素
  console.log('[launcher] screenshot + pixel sampling...');
  screenshotAndSample('claude-config-manager');

  // 不 kill — 让用户/后续步骤决定
  console.log('[launcher] DONE — exe still running for visual inspection');
})().catch((e) => {
  console.error('[fatal]', e);
  killExisting();
  process.exit(1);
});
