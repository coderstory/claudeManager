// Detail page consistency probe — measure wrapper padding, h1 styles, card styles, back button across all 13 views.
const fs = require('fs');
const http = require('http');
const ws = require('ws');

function getJSON(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve(JSON.parse(body)));
    }).on('error', reject);
  });
}

(async () => {
  const targets = await getJSON('http://localhost:9223/json');
  const page = targets.find((t) => t.type === 'page' && t.url.includes('tauri.localhost'));
  if (!page) {
    console.error('no page target');
    process.exit(1);
  }

  const sock = new ws(page.webSocketDebuggerUrl);
  let nextId = 1;
  const pending = new Map();

  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
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

  async function navigate(view) {
    await evalExpr(`localStorage.setItem('ccm.lastView', ${JSON.stringify(view)})`);
    await evalExpr(`document.querySelector('[data-testid="sidebar-item-${view}"]').click()`);
    await new Promise((r) => setTimeout(r, 800));
  }

  async function probe(view) {
    return await evalExpr(`
      (() => {
        const header = document.querySelector('[data-testid="app-header"]');
        const back = document.querySelector('[data-testid="app-header-back"]');
        const main = document.querySelector('[data-testid="app-main"]');
        const mainCS = main ? getComputedStyle(main) : null;
        const mainRect = main ? main.getBoundingClientRect() : null;
        const headerCS = header ? getComputedStyle(header) : null;
        const headerRect = header ? header.getBoundingClientRect() : null;
        // first element inside main = the rendered view's root
        const viewRoot = main ? main.firstElementChild : null;
        const viewRootCS = viewRoot ? getComputedStyle(viewRoot) : null;
        const viewRootRect = viewRoot ? viewRoot.getBoundingClientRect() : null;
        // first child of viewRoot = the page's main content wrapper
        const wrapper = viewRoot ? viewRoot.firstElementChild : null;
        const wrapperCS = wrapper ? getComputedStyle(wrapper) : null;
        const wrapperRect = wrapper ? wrapper.getBoundingClientRect() : null;
        const wrapperStyleAttr = wrapper ? wrapper.getAttribute('style') : null;
        // first H1 within wrapper or any descendant
        const h1 = (() => {
          const search = wrapper || viewRoot;
          if (!search) return null;
          return search.querySelector('h1') || document.querySelector('main h1');
        })();
        const h1CS = h1 ? getComputedStyle(h1) : null;
        const h1Rect = h1 ? h1.getBoundingClientRect() : null;
        const h1Text = h1 ? h1.textContent.trim().slice(0, 40) : null;
        // first .card or [data-testid*=card] within wrapper
        const cardSel = wrapper
          ? wrapper.querySelector('[class*="card"], [data-testid*="card"]') ||
            (wrapper.firstElementChild && wrapper.firstElementChild.firstElementChild)
          : null;
        const cardCS = cardSel ? getComputedStyle(cardSel) : null;
        const cardRect = cardSel ? cardSel.getBoundingClientRect() : null;
        // sidebar current item text
        const activeItem = document.querySelector('[data-testid^="sidebar-item-"][aria-current="page"]');
        const activeText = activeItem ? activeItem.textContent.trim() : null;
        return {
          backPresent: !!back,
          header: { height: headerCS?.height, rect: headerRect ? { top: headerRect.top, height: headerRect.height } : null },
          main: { rect: mainRect ? { top: mainRect.top, left: mainRect.left, width: mainRect.width, height: mainRect.height } : null, paddingTop: mainCS?.paddingTop, paddingLeft: mainCS?.paddingLeft, paddingRight: mainCS?.paddingRight },
          viewRoot: viewRoot ? { tag: viewRoot.tagName, paddingTop: viewRootCS?.paddingTop, paddingLeft: viewRootCS?.paddingLeft, padding: viewRootCS?.padding, rect: viewRootRect ? { top: viewRootRect.top, height: viewRootRect.height } : null } : null,
          wrapper: wrapper ? {
            tag: wrapper.tagName,
            padding: wrapperCS?.padding,
            paddingTop: wrapperCS?.paddingTop,
            paddingLeft: wrapperCS?.paddingLeft,
            paddingRight: wrapperCS?.paddingRight,
            marginTop: wrapperCS?.marginTop,
            marginBottom: wrapperCS?.marginBottom,
            display: wrapperCS?.display,
            maxWidth: wrapperCS?.maxWidth,
            rect: wrapperRect ? { top: wrapperRect.top, left: wrapperRect.left, width: wrapperRect.width, height: wrapperRect.height } : null,
            styleAttr: wrapperStyleAttr ? wrapperStyleAttr.slice(0, 400) : null,
          } : null,
          h1: h1 ? {
            text: h1Text,
            fontSize: h1CS?.fontSize,
            fontWeight: h1CS?.fontWeight,
            color: h1CS?.color,
            marginTop: h1CS?.marginTop,
            marginBottom: h1CS?.marginBottom,
            rect: h1Rect ? { top: h1Rect.top, left: h1Rect.left, width: h1Rect.width, height: h1Rect.height } : null,
          } : null,
          card: cardCS ? {
            padding: cardCS?.padding,
            borderRadius: cardCS?.borderRadius,
            boxShadow: cardCS?.boxShadow,
            background: cardCS?.background,
            border: cardCS?.border,
            rect: cardRect ? { top: cardRect.top, left: cardRect.left, width: cardRect.width, height: cardRect.height } : null,
          } : null,
          sidebarActive: activeText,
        };
      })()
    `);
  }

  sock.on('open', async () => {
    try {
      const views = [
        'home',
        'provider-list',
        'provider-switch',
        'import-sql',
        'deeplink-import',
        'json-editor',
        'mcp-management',
        'usage-query',
        'single-file-deploy',
        'backup-restore',
        'optimizer',
        'resource-browser',
        'marketplace',
      ];
      const results = [];
      for (const v of views) {
        await navigate(v);
        const data = await probe(v);
        results.push({ view: v, ...data });
        console.log('=== ' + v + ' ===');
        console.log('  back: ' + data.backPresent);
        console.log('  sidebar active: ' + data.sidebarActive);
        if (data.wrapper) {
          console.log('  wrapper: padding=' + data.wrapper.padding + ' marginTop=' + data.wrapper.marginTop + ' maxWidth=' + data.wrapper.maxWidth);
        }
        if (data.h1) {
          console.log('  h1: text="' + data.h1.text + '" fontSize=' + data.h1.fontSize + ' fontWeight=' + data.h1.fontWeight + ' marginTop=' + data.h1.marginTop);
        }
        if (data.card) {
          console.log('  card: padding=' + data.card.padding + ' borderRadius=' + data.card.borderRadius + ' boxShadow=' + (data.card.boxShadow || '').slice(0, 40));
        }
      }
      fs.writeFileSync('D:/project/winui3/tmp/detail-page-probe-raw.json', JSON.stringify(results, null, 2));
      console.log('\n--- saved to tmp/detail-page-probe-raw.json ---');
    } catch (e) {
      console.error('PROBE ERROR:', e.message);
    } finally {
      sock.close();
      process.exit(0);
    }
  });

  sock.on('error', (e) => { console.error('WS error:', e.message); process.exit(1); });
  sock.on('message', (msg) => {
    const data = JSON.parse(msg.toString());
    if (data.id && pending.has(data.id)) {
      const { resolve, reject } = pending.get(data.id);
      pending.delete(data.id);
      if (data.error) reject(new Error(JSON.stringify(data.error)));
      else resolve(data.result);
    }
  });
})();
