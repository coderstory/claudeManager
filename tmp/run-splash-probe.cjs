// M2.16 splash probe launcher — starts the release exe with WebView2
// remote debugging enabled, polls the DevTools /json endpoint for the
// page websocket URL, then hands off to ccm-splash-probe.cjs.
//
// Usage: node tmp/run-splash-probe.cjs
//
// Strategy:
//   1. Kill any existing instances of the exe.
//   2. Set WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222
//      in the child process env.
//   3. Start the exe detached.
//   4. Poll http://127.0.0.1:9222/json/version for up to 8s.
//   5. Fetch http://127.0.0.1:9222/json to get the page list.
//   6. Spawn `node tmp/ccm-splash-probe.cjs <wsUrl>` and pipe stdout.
//   7. On exit, kill the exe.
const { spawn, spawnSync } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const EXE = 'C:\\Users\\e-Yunfei.Qian\\Desktop\\ClaudeConfigManager-M2\\ClaudeConfigManager-M2.16-splash-loading.exe';
const PROC_NAMES = ['claude-config-manager', 'ClaudeConfigManager-M2.16-splash-loading'];
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

async function waitForDevtools(maxMs = 8000) {
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
    versionInfo = await waitForDevtools(8000);
    console.log('[launcher] DevTools ready:', versionInfo.Browser || '(unknown browser)');
  } catch (e) {
    console.error('[launcher] FAIL:', e.message);
    killExisting();
    process.exit(1);
  }

  // Slight delay so the page list populates
  await new Promise((r) => setTimeout(r, 500));

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
  console.log('[launcher] launching probe...');

  const probe = spawn('node', [path.join(__dirname, 'ccm-splash-probe.cjs'), page.webSocketDebuggerUrl], {
    stdio: 'inherit',
  });
  probe.on('exit', (code) => {
    console.log('[launcher] probe exited with code', code);
    console.log('[launcher] killing exe...');
    killExisting();
    process.exit(code ?? 0);
  });
})();
