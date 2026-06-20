// M2.16 splash CDP probe — verifies the inline loading screen actually
// shows on the real Tauri release exe during the pre-React mount gap,
// and is then hidden ~200ms after React mounts.
//
// Usage:
//   node tmp/ccm-splash-probe.cjs <wsUrl>
//
// Where <wsUrl> is the WebView2 DevTools websocket URL (look for
// "ws://127.0.0.1:PORT/devtools/page/..." from the remote debugging
// endpoint at http://127.0.0.1:PORT/json).
//
// Probe sequence:
//   T0   — connect as fast as possible (don't wait for full app)
//   T0+a — measure #ccm-splash rect + text + spinner animation state
//           (we expect it to be visible + fullscreen + text correct)
//   wait — React mount + 250ms (App.tsx hide timer)
//   T1   — measure #ccm-splash classList + computed opacity + display
//           (we expect .ccm-splash-hidden + opacity 0 + display none)
//
// Output: writes a Markdown report to tmp/splash-probe-results.md
// AND dumps a JSON blob to stdout for the build script to consume.
const fs = require('fs');
const path = require('path');
const ws = require('ws');

const wsUrl = process.argv[2];
if (!wsUrl) {
  console.error('Usage: node tmp/ccm-splash-probe.cjs <wsUrl>');
  process.exit(1);
}

const REPORT_PATH = path.join(__dirname, 'splash-probe-results.md');

const sock = new ws(wsUrl);
let nextId = 1;
const pending = new Map();

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
  if (r.exceptionDetails) {
    throw new Error(JSON.stringify(r.exceptionDetails));
  }
  return r.result.value;
}

// Probe the splash at T0 (pre-React mount, hopefully).
async function probeSplashAt(label) {
  return await evalExpr(`(() => {
    const s = document.getElementById('ccm-splash');
    if (!s) return { present: false, label: ${JSON.stringify(label)} };
    const r = s.getBoundingClientRect();
    const text = s.querySelector('.ccm-splash-text');
    const spinner = s.querySelector('.ccm-splash-spinner');
    const cs = window.getComputedStyle(s);
    const spinnerCs = spinner ? window.getComputedStyle(spinner) : null;
    return {
      present: true,
      label: ${JSON.stringify(label)},
      rect: { x: r.x, y: r.y, w: r.width, h: r.height },
      viewportW: window.innerWidth,
      viewportH: window.innerHeight,
      isFullscreen: (r.x === 0 && r.y === 0 && r.width === window.innerWidth && r.height === window.innerHeight),
      textContent: text ? text.textContent : null,
      hiddenClass: s.classList.contains('ccm-splash-hidden'),
      opacity: parseFloat(cs.opacity),
      display: cs.display,
      zIndex: cs.zIndex,
      pointerEvents: cs.pointerEvents,
      spinnerAnimationName: spinnerCs ? spinnerCs.animationName : null,
      spinnerAnimationDuration: spinnerCs ? spinnerCs.animationDuration : null,
      appRootPresent: !!document.getElementById('root') && document.getElementById('root').children.length > 0,
    };
  })()`);
}

function fmt(v) {
  return JSON.stringify(v, null, 2);
}

(async () => {
  const results = { t0: null, t1: null, errors: [] };

  sock.on('message', (msg) => {
    const d = JSON.parse(msg.toString());
    if (d.id && pending.has(d.id)) {
      const { res, rej } = pending.get(d.id);
      pending.delete(d.id);
      if (d.error) rej(new Error(JSON.stringify(d.error)));
      else res(d.result);
    }
  });

  sock.on('open', async () => {
    try {
      // T0 — measure as soon as the socket opens. If React has
      // already mounted, the splash should still be visible (200ms
      // delay in App.tsx), so this measurement is valid either way.
      results.t0 = await probeSplashAt('T0 (immediate on connect)');

      // Wait long enough for React to mount + the 200ms hide class
      // + the 250ms display:none drop = ~600ms with buffer.
      await new Promise((r) => setTimeout(r, 800));

      // T1 — measure post-hide.
      results.t1 = await probeSplashAt('T1 (after 800ms wait)');
    } catch (e) {
      results.errors.push(e.message);
    } finally {
      sock.close();
      // Write Markdown report.
      const lines = [];
      lines.push('# M2.16 splash CDP probe report');
      lines.push('');
      lines.push('Generated: ' + new Date().toISOString());
      lines.push('');
      lines.push('## T0 — immediate on CDP connect (pre-React or just-mount)');
      lines.push('');
      if (results.t0) {
        const t = results.t0;
        lines.push('- present: ' + t.present);
        if (t.present) {
          lines.push('- rect: x=' + t.rect.x + ' y=' + t.rect.y + ' w=' + t.rect.w + ' h=' + t.rect.h);
          lines.push('- viewport: ' + t.viewportW + 'x' + t.viewportH);
          lines.push('- isFullscreen: ' + t.isFullscreen);
          lines.push('- text: "' + t.textContent + '"');
          lines.push('- hiddenClass: ' + t.hiddenClass);
          lines.push('- opacity: ' + t.opacity);
          lines.push('- display: ' + t.display);
          lines.push('- zIndex: ' + t.zIndex);
          lines.push('- pointerEvents: ' + t.pointerEvents);
          lines.push('- spinnerAnimation: ' + t.spinnerAnimationName + ' ' + t.spinnerAnimationDuration);
          lines.push('- appRootMounted: ' + t.appRootPresent);
        }
      } else {
        lines.push('- ERROR: no T0 measurement');
      }
      lines.push('');
      lines.push('## T1 — after 800ms wait (post-React mount + hide timer)');
      lines.push('');
      if (results.t1) {
        const t = results.t1;
        lines.push('- present: ' + t.present);
        if (t.present) {
          lines.push('- hiddenClass: ' + t.hiddenClass);
          lines.push('- opacity: ' + t.opacity);
          lines.push('- display: ' + t.display);
          lines.push('- appRootMounted: ' + t.appRootPresent);
        }
      } else {
        lines.push('- ERROR: no T1 measurement');
      }
      lines.push('');
      if (results.errors.length) {
        lines.push('## Errors');
        lines.push('');
        for (const e of results.errors) lines.push('- ' + e);
        lines.push('');
      }
      // Pass/fail verdict
      const t0Ok = results.t0 && results.t0.present && results.t0.isFullscreen && results.t0.textContent === 'Claude 配置管理器加载中…';
      const t1Ok = results.t1 && results.t1.present && results.t1.hiddenClass && results.t1.display === 'none';
      lines.push('## Verdict');
      lines.push('');
      lines.push('- T0 (splash visible fullscreen with correct text): ' + (t0Ok ? 'PASS' : 'FAIL'));
      lines.push('- T1 (splash hidden + display none after mount): ' + (t1Ok ? 'PASS' : 'FAIL'));
      lines.push('');

      fs.writeFileSync(REPORT_PATH, lines.join('\n'), 'utf8');
      console.log('=== splash probe JSON ===');
      console.log(JSON.stringify({ t0: results.t0, t1: results.t1, verdict: { t0Ok, t1Ok } }));
      console.log('=== report written to ' + REPORT_PATH + ' ===');
      process.exit(t0Ok && t1Ok ? 0 : 2);
    }
  });

  sock.on('error', (e) => {
    console.error('WS error:', e.message);
    process.exit(1);
  });
})();
