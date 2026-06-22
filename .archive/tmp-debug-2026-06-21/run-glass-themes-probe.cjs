// M2.16 glass-themes CDP probe — verifies the 3-way
// light → glass-clear → glass-tinted theme cycle produces the
// expected --bg-primary on app-root / app-main / AppHeader on the
// real Tauri release exe.
//
// Usage: node tmp/run-glass-themes-probe.cjs
//
// Strategy (same as run-splash-probe.cjs):
//   1. Kill any existing instances of the exe.
//   2. Set WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222
//      in the child process env.
//   3. Start the exe detached.
//   4. Poll http://127.0.0.1:9222/json/version for up to 8s.
//   5. Fetch http://127.0.0.1:9222/json to get the page list.
//   6. Open a WS to the page, walk the 3 themes via cycleTheme(),
//      and for each theme measure data-theme + computed backgroundColor
//      on #app-root / #app-main / #app-header.
//   7. Kill the exe.
const { spawn, spawnSync } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const ws = require('ws');

const EXE = 'C:\\Users\\e-Yunfei.Qian\\Desktop\\ClaudeConfigManager-M2\\ClaudeConfigManager-M2.16-glass-themes.exe';
const PROC_NAMES = ['claude-config-manager', 'ClaudeConfigManager-M2.16-glass-themes'];
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

// --- CDP probe over WS -----------------------------------------------------
function probeThemes(wsUrl) {
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

    sock.on('open', async () => {
      try {
        // Wait for the app shell to mount.
        for (let i = 0; i < 30; i++) {
          const ready = await evalExpr(`!!document.querySelector('[data-testid="app-root"]') && !!document.querySelector('[data-testid="app-header-theme-toggle"]')`);
          if (ready) break;
          await new Promise((r) => setTimeout(r, 200));
        }

        // First reset to 'light' deterministically by cycling until
        // the aria-label shows "切换到全透玻璃主题" (current = light).
        // We'll cycle at most 3 times to find that state.
        for (let i = 0; i < 3; i++) {
          const label = await evalExpr(`document.querySelector('[data-testid="app-header-theme-toggle"]').getAttribute('aria-label')`);
          if (label && label.includes('全透玻璃')) break;
          await evalExpr(`document.querySelector('[data-testid="app-header-theme-toggle"]').click()`);
          await new Promise((r) => setTimeout(r, 300));
        }

        const results = [];
        // Measure current (light), then click twice for glass-clear + glass-tinted.
        for (const step of ['initial', 'click1', 'click2']) {
          const snapshot = await evalExpr(`(() => {
            const root = document.querySelector('[data-testid="app-root"]');
            const main = document.querySelector('[data-testid="app-main"]');
            const header = document.querySelector('[data-testid="app-header"]');
            const cs = (el) => el ? getComputedStyle(el).backgroundColor : null;
            const btn = document.querySelector('[data-testid="app-header-theme-toggle"]');
            return {
              dataTheme: document.documentElement.dataset.theme,
              ariaLabel: btn ? btn.getAttribute('aria-label') : null,
              appRoot: cs(root),
              appMain: cs(main),
              appHeader: cs(header),
            };
          })()`);
          results.push({ step, ...snapshot });
          if (step !== 'click2') {
            await evalExpr(`document.querySelector('[data-testid="app-header-theme-toggle"]').click()`);
            await new Promise((r) => setTimeout(r, 400));
          }
        }
        sock.close();
        resolve(results);
      } catch (e) {
        sock.close();
        reject(e);
      }
    });
  });
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
  console.log('[launcher] probing 3 themes...');

  let results;
  try {
    results = await probeThemes(page.webSocketDebuggerUrl);
  } catch (e) {
    console.error('[launcher] probe FAILED:', e.message);
    killExisting();
    process.exit(1);
  }

  killExisting();

  // Write Markdown report.
  const REPORT_PATH = path.join(__dirname, 'glass-themes-probe-results.md');
  const lines = [
    '# M2.16 glass-themes CDP probe report',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    'Exe: ClaudeConfigManager-M2.16-glass-themes.exe',
    '',
    'Cycle: light → glass-clear → glass-tinted (via cycleTheme button clicks).',
    '',
    '| step | data-theme | aria-label | app-root bg | app-main bg | app-header bg |',
    '|---|---|---|---|---|---|',
  ];
  for (const r of results) {
    lines.push(`| ${r.step} | ${r.dataTheme} | ${r.ariaLabel} | ${r.appRoot} | ${r.appMain} | ${r.appHeader} |`);
  }
  lines.push('');
  lines.push('## Expected values');
  lines.push('');
  lines.push('- light:        app-root/app-main = `rgb(250, 250, 247)` (opaque cream, Mica covered). app-header = `rgba(255, 255, 255, 0.55)`.');
  lines.push('- glass-clear:   app-root/app-main = `rgba(0, 0, 0, 0)` / transparent (Mica shows through). app-header = `rgba(255, 255, 255, 0.55)`.');
  lines.push('- glass-tinted:  app-root/app-main = `rgba(250, 250, 247, 0.7)` (porcelain glass). app-header = `rgba(255, 255, 255, 0.55)`.');
  lines.push('');
  lines.push('## Verdict');
  lines.push('');
  const light = results[0];
  const clear = results[1];
  const tinted = results[2];
  const checks = [
    ['light data-theme = light', light?.dataTheme === 'light'],
    ['light app-root opaque cream (rgb(250, 250, 247))', light?.appRoot === 'rgb(250, 250, 247)'],
    ['glass-clear data-theme = glass-clear', clear?.dataTheme === 'glass-clear'],
    ['glass-clear app-root transparent', clear?.appRoot === 'rgba(0, 0, 0, 0)'],
    ['glass-tinted data-theme = glass-tinted', tinted?.dataTheme === 'glass-tinted'],
    ['glass-tinted app-root rgba(250, 250, 247, 0.7)', tinted?.appRoot === 'rgba(250, 250, 247, 0.7)'],
  ];
  for (const [name, ok] of checks) {
    lines.push(`- ${ok ? 'PASS' : 'FAIL'} — ${name} (got: ${ok ? 'ok' : (name.includes('app-root') ? (results.find(r => r.step === name.includes('light') ? 'initial' : name.includes('clear') ? 'click1' : 'click2'))?.appRoot : '')})`);
  }
  fs.writeFileSync(REPORT_PATH, lines.join('\n'));
  console.log('[launcher] report →', REPORT_PATH);
  console.log('\n=== RAW RESULTS ===');
  console.log(JSON.stringify(results, null, 2));
  console.log('\n=== VERDICT ===');
  for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}`);
  process.exit(0);
})();
