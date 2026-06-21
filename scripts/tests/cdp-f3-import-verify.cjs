// CDP 真机验证: F3 import-sql 页端到端 — 上传 .sql → 预览 → 导入
//
// 用法: node scripts/tests/cdp-f3-import-verify.cjs "<exe路径>" "<.sql样本路径>"
//
// 流程:
//   1. 以 --remote-debugging-port=9223 启动 release exe
//   2. CDP 连接 → 点侧栏 import-sql → 验证页面挂载
//   3. DOM.setFileInputFiles 把 .sql 喂给隐藏 <input type="file">
//   4. 轮询预览出现 (14MB 解析 + IPC 较慢，留 60s)
//   5. 读取 3 个统计卡 + provider 行数 + MCP banner → 断言 17 provider + 6 mcp
//   6. 点 [确认导入] → 轮询 done 视图 → 读导入结果
//   7. 检查磁盘 <app_data>/providers/ 文件数
//   8. 杀进程 + 报告 (exit 0 = 全过)
//
// 反事故: 导入只写 <app_data>/providers/<id>.json (不动 ~/.claude/settings.json，
// 那是 switch_provider 的职责)。导入幂等 (已存在 id 跳过)。
const http = require('http');
const WebSocket = require('ws');
const { spawn } = require('child_process');
const fs = require('fs');

const PORT = 9223;

function getJson(p) {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:${PORT}${p}`, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForCdp(timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { await getJson('/json/version'); return true; } catch { await sleep(300); }
  }
  return false;
}

async function main() {
  const exe = process.argv[2];
  const sample = process.argv[3];
  if (!exe || !sample) {
    console.error('Usage: cdp-f3-import-verify.cjs <exe> <sample.sql>');
    process.exit(2);
  }

  // ---- 1. 启动 exe (CDP 端口 9223) ----
  console.log('[1] Launching exe with CDP port', PORT);
  const child = spawn(exe, [], {
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}` },
    detached: false,
    windowsHide: false,
  });
  child.on('error', (e) => { console.error('spawn error:', e.message); process.exit(2); });

  let exitCode = 0;
  try {
    if (!(await waitForCdp(25000))) {
      console.error('FAIL: CDP not ready within 25s');
      process.exit(1);
    }
    console.log('[1] CDP ready');

    // ---- 2. 连接 CDP ----
    const targets = await getJson('/json');
    const page = targets.find((t) => t.type === 'page') || targets[0];
    if (!page) { console.error('FAIL: no page target'); process.exit(1); }
    console.log('[2] CDP target:', page.url);

    const ws = new WebSocket(page.webSocketDebuggerUrl);
    let id = 0;
    const pending = new Map();
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.id && pending.has(m.id)) {
        const { resolve, reject } = pending.get(m.id);
        pending.delete(m.id);
        m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
      }
    });
    const send = (method, params = {}) =>
      new Promise((r, j) => { const i = ++id; pending.set(i, { resolve: r, reject: j }); ws.send(JSON.stringify({ id: i, method, params })); });
    const ev = (fn) =>
      send('Runtime.evaluate', { expression: `(()=>{${fn}})()`, awaitPromise: true, returnByValue: true })
        .then((r) => r.exceptionDetails ? (() => { throw new Error(JSON.stringify(r.exceptionDetails)); })() : r.result.value);
    await new Promise((r) => ws.on('open', r));

    // 等应用首屏挂载
    let appReady = false;
    for (let i = 0; i < 40; i++) {
      appReady = await ev(`return !!document.querySelector('[data-testid="app-header"]');`);
      if (appReady) break;
      await sleep(300);
    }
    console.log('[2] app-header mounted:', appReady);
    if (!appReady) { console.error('FAIL: app never mounted'); exitCode = 1; }

    // ---- 3. 导航到 import-sql ----
    await ev(`document.querySelector('[data-testid="sidebar-item-import-sql"]').click();`);
    await sleep(800);
    const pageMounted = await ev(`return !!document.querySelector('[data-testid="import-sql-page"]');`);
    const idleMounted = await ev(`return !!document.querySelector('[data-testid="import-sql-idle"]');`);
    console.log('[3] import-sql page mounted:', pageMounted, '| idle:', idleMounted);
    if (!pageMounted) { console.error('FAIL: import-sql page did not mount'); exitCode = 1; }

    // ---- 4. 喂 .sql 给隐藏 input ----
    await send('DOM.enable');
    const doc = await send('DOM.getDocument', { depth: 0 });
    const qRes = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '[data-testid="import-sql-file-input"]' });
    const inputNodeId = qRes && qRes.nodeId;
    console.log('[4] file input nodeId:', inputNodeId);
    if (!inputNodeId) {
      console.error('FAIL: file input not found in DOM');
      exitCode = 1;
    } else {
      // DOM.setFileInputFiles 会让浏览器进程从磁盘读文件 + 自动派发 change 事件
      await send('DOM.setFileInputFiles', { files: [sample], nodeId: inputNodeId });
      console.log('[4] setFileInputFiles done (sample:', sample, ')');
    }

    // ---- 5. 轮询预览 (14MB 解析慢，留 60s) ----
    let previewMounted = false;
    const pollStart = Date.now();
    for (let i = 0; i < 120; i++) {
      previewMounted = await ev(`return !!document.querySelector('[data-testid="import-sql-preview"]');`);
      if (previewMounted) break;
      await sleep(500);
    }
    const parseDur = ((Date.now() - pollStart) / 1000).toFixed(1);
    console.log(`[5] preview mounted: ${previewMounted} (after ${parseDur}s)`);

    if (!previewMounted) {
      // 预览没出来 — 看是否进了 error 视图
      const errText = await ev(`const el=document.querySelector('[data-testid="import-sql-error"]');return el?el.textContent:null;`);
      console.error('FAIL: preview never appeared. error view:', errText);
      exitCode = 1;
    } else {
      // ---- 6. 读统计 ----
      const importable = await ev(`const el=document.querySelector('[data-testid="import-sql-stat-importable"]');return el?el.querySelectorAll('div')[1]?.textContent:null;`);
      const skipped = await ev(`const el=document.querySelector('[data-testid="import-sql-stat-skipped"]');return el?el.querySelectorAll('div')[1]?.textContent:null;`);
      const totalLines = await ev(`return document.querySelectorAll('[data-testid^="import-sql-row-"]').length;`);
      const mcpText = await ev(`const el=document.querySelector('[data-testid="import-sql-mcp-banner"]');return el?el.textContent:null;`);
      console.log('[6] PREVIEW STATS:');
      console.log('    importable card:', importable);
      console.log('    skipped card:', skipped);
      console.log('    provider rows in DOM:', totalLines);
      console.log('    mcp banner:', mcpText ? mcpText.substring(0, 80) : null);

      const mcpCount = mcpText ? (mcpText.match(/已解析\s+(\d+)\s+个/) || [])[1] : null;
      console.log('[6] ASSERTIONS:');
      console.log('    importable == 17?', String(importable) === '17', `(got ${importable})`);
      console.log('    mcp count == 6?', mcpCount === '6', `(got ${mcpCount})`);

      // ---- 7. 点确认导入 ----
      const confirmEnabled = await ev(`const b=document.querySelector('[data-testid="import-sql-confirm"]');return b?!b.disabled:false;`);
      console.log('[7] confirm button enabled:', confirmEnabled);
      if (confirmEnabled) {
        await ev(`document.querySelector('[data-testid="import-sql-confirm"]').click();`);
        // 轮询 done 视图 (17 个文件原子写，留 30s)
        let doneMounted = false;
        const importStart = Date.now();
        for (let i = 0; i < 60; i++) {
          doneMounted = await ev(`return !!document.querySelector('[data-testid="import-sql-done"]');`);
          if (doneMounted) break;
          await sleep(500);
        }
        const importDur = ((Date.now() - importStart) / 1000).toFixed(1);
        console.log(`[7] done mounted: ${doneMounted} (after ${importDur}s)`);
        if (doneMounted) {
          const summary = await ev(`const el=document.querySelector('[data-testid="import-sql-done-summary"]');return el?el.textContent:null;`);
          console.log('[7] DONE SUMMARY:', summary ? summary.replace(/\s+/g, ' ').trim() : null);
          const importedMatch = summary ? summary.match(/成功导入\s+(\d+)\s+个/) : null;
          console.log('[7] imported count:', importedMatch ? importedMatch[1] : 'not found in summary');
        } else {
          const errText = await ev(`const el=document.querySelector('[data-testid="import-sql-error"]');return el?el.textContent:null;`);
          console.error('FAIL: done never appeared. error:', errText);
          exitCode = 1;
        }
      } else {
        console.error('FAIL: confirm button disabled (importable was 0?)');
        exitCode = 1;
      }
    }

    // ---- 8. 检查磁盘 ----
    // 注意: paths.app_data 用 productName(=ClaudeConfigManager) 不是 identifier。
    const providersDir = 'C:\\Users\\e-Yunfei.Qian\\AppData\\Roaming\\ClaudeConfigManager\\providers';
    let diskCount = -1;
    try {
      diskCount = fs.readdirSync(providersDir).filter((f) => f.endsWith('.json')).length;
    } catch (e) {
      console.log('[8] providers dir not readable:', e.message);
    }
    console.log('[8] disk check: providers dir json count =', diskCount, `(${providersDir})`);

    ws.close();
  } finally {
    // ---- 9. 杀进程 ----
    try { child.kill(); } catch {}
    // 确保杀干净
    try {
      require('child_process').execSync(
        'powershell.exe -NoProfile -Command "Get-Process -Name \'claude-config-manager\' -ErrorAction SilentlyContinue | Stop-Process -Force"',
        { stdio: 'ignore' },
      );
    } catch {}
  }

  console.log('[done] exit', exitCode);
  process.exit(exitCode);
}

main().catch((e) => { console.error('FATAL', e.message); process.exit(2); });
