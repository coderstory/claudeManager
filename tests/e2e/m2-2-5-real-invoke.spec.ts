/**
 * M2.2.5 F6 MCP 真业务验证 spec.
 *
 * Diagnostic spec — written by m2-2-5-verify subagent 2026-06-20.
 *
 * Goal: validate that F6 MCP 管理 page is REAL business UI (not a placeholder)
 * and that the IPC commands (list_mcp_servers, add_mcp_server, toggle_mcp_server,
 * remove_mcp_server) actually roundtrip when invoked via __TAURI_INTERNALS__.
 *
 * ## Dev-mode caveat
 *
 * `tauri dev` + Playwright chromium has NO __TAURI_INTERNALS__ (the WebView2
 * only exists in the Tauri-spawned process, not in bare Chromium). The
 * invoke tests below expect to fail with `error: no __TAURI_INTERNALS__` —
 * which is the documented dev-mode behavior. The real IPC gate is the
 * release exe + tauri-driver CDP probe, plus the Rust `cargo test` calls.
 */

import { test, expect } from '@playwright/test';

const DIAG_DIR = '.planning/diagnostics/m2-2-5-verify';

test.describe('M2.2.5 F6 MCP 真业务验证 (DOM-level)', () => {
  test.use({ viewport: { width: 1024, height: 640 } })

  test('F6 MCP 管理页面：真业务 UI 还是 PluginPlaceholder？', async ({ page }) => {
    const consoleErrors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text())
    })
    page.on('pageerror', (err) => {
      consoleErrors.push(`pageerror: ${err.message}`)
    })

    await page.goto('http://localhost:1420/')
    await page.waitForSelector('[data-testid="app-header"]', { timeout: 15000 })
    await page.waitForTimeout(500)

    // Navigate to F6 via sidebar.
    await page.click('[data-testid="sidebar-item-mcp-management"]')
    await page.waitForTimeout(2500) // wait for list_mcp_servers roundtrip

    await page.screenshot({
      path: `${DIAG_DIR}/01-f6-mcp-page.png`,
      fullPage: false,
    })

    const state = await page.evaluate(() => {
      const mcpPage = document.querySelector(
        '[data-testid="mcp-management-page"]',
      ) as HTMLElement | null
      const placeholder = document.querySelector(
        '[data-testid^="plugin-placeholder"]',
      ) as HTMLElement | null
      const addBtn = document.querySelector(
        '[data-testid="mcp-add-btn"]',
      ) as HTMLButtonElement | null
      const importBtn = document.querySelector(
        '[data-testid="mcp-import-btn"]',
      ) as HTMLButtonElement | null
      const tbody = document.querySelector(
        '[data-testid="mcp-table"] tbody',
      ) as HTMLElement | null
      const rows = document.querySelectorAll('[data-testid^="mcp-row-"]').length
      const body = document.body.innerText
      return {
        mcpPageMounted: !!mcpPage,
        placeholderMounted: !!placeholder,
        addBtnVisible: !!addBtn,
        importBtnVisible: !!importBtn,
        tbodyExists: !!tbody,
        mcpRowCount: rows,
        h1Text: document.querySelector('h1')?.textContent?.trim() ?? null,
        h2Texts: Array.from(document.querySelectorAll('h2')).map(
          (e) => (e as HTMLElement).textContent?.trim() ?? '',
        ),
        bodyText: body.substring(0, 600),
        hasManagedStateBug: body.includes('state not managed') ||
          body.includes('TypeId') ||
          body.includes('manage() before using this command'),
        hasError: body.includes('错误') || body.includes('Error') || body.includes('error'),
        hasAddText: body.includes('新增') || body.includes('Add'),
      }
    })
    console.log('F6 PAGE STATE:', JSON.stringify(state, null, 2))
    console.log('CONSOLE ERRORS:', JSON.stringify(consoleErrors, null, 2))

    // Real business UI checks (DOM-level).
    expect(state.mcpPageMounted).toBe(true)
    expect(state.placeholderMounted).toBe(false)
    expect(state.addBtnVisible).toBe(true)
    expect(state.hasManagedStateBug).toBe(false)
  })

  test('__TAURI_INTERNALS__ 探针：dev mode 不应有', async ({ page }) => {
    await page.goto('http://localhost:1420/')
    await page.waitForSelector('[data-testid="app-header"]', { timeout: 15000 })

    const probe = await page.evaluate(() => {
      const tauri = (window as unknown as { __TAURI_INTERNALS__?: unknown })
        .__TAURI_INTERNALS__
      const tauriObj = (window as unknown as Record<string, unknown>)
      return {
        internalsAvailable: typeof tauri !== 'undefined',
        knownKeys: Object.keys(tauriObj).filter((k) =>
          k.startsWith('__TAURI') || k.startsWith('__TAURI_'),
        ),
      }
    })
    console.log('TAURI PROBE:', JSON.stringify(probe, null, 2))
    expect(probe.internalsAvailable).toBe(false)
  })

  test('真 invoke list_mcp_servers：dev mode 预期不可达', async ({ page }) => {
    await page.goto('http://localhost:1420/')
    await page.waitForSelector('[data-testid="app-header"]', { timeout: 15000 })

    const result = await page.evaluate(async () => {
      try {
        const tauri = (window as unknown as { __TAURI_INTERNALS__?: { invoke: (cmd: string, args?: any) => Promise<any> } }).__TAURI_INTERNALS__
        if (!tauri) return { error: 'no __TAURI_INTERNALS__ (expected for dev mode in browser)' }
        const servers = await tauri.invoke('list_mcp_servers', {})
        return { ok: true, count: Array.isArray(servers) ? servers.length : 'not array', sample: Array.isArray(servers) ? servers.slice(0, 2) : null }
      } catch (e) {
        return { error: String(e) }
      }
    })
    console.log('LIST_MCP_SERVERS:', JSON.stringify(result, null, 2))
  })

  test('真 invoke add/toggle roundtrip：dev mode 预期不可达', async ({ page }) => {
    await page.goto('http://localhost:1420/')
    await page.waitForSelector('[data-testid="app-header"]', { timeout: 15000 })

    const result = await page.evaluate(async () => {
      try {
        const tauri = (window as unknown as { __TAURI_INTERNALS__?: { invoke: (cmd: string, args?: any) => Promise<any> } }).__TAURI_INTERNALS__
        if (!tauri) return { error: 'no __TAURI_INTERNALS__' }
        const testServer = {
          id: 'test-mcp-' + Date.now(),
          name: 'test-mcp-' + Date.now(),
          transport: { type: 'stdio' },
          command: 'echo',
          args: ['hello'],
          env: {},
          enabled: true,
          created_at: Math.floor(Date.now() / 1000),
        }
        await tauri.invoke('add_mcp_server', { server: testServer })
        const list1 = await tauri.invoke('list_mcp_servers', {})
        await tauri.invoke('toggle_mcp_server', { id: testServer.id, enabled: false })
        const list2 = await tauri.invoke('list_mcp_servers', {})
        const after = Array.isArray(list2) ? list2.find((s: any) => s.id === testServer.id) : null
        await tauri.invoke('remove_mcp_server', { id: testServer.id })
        return {
          ok: true,
          beforeCount: Array.isArray(list1) ? list1.length : null,
          afterFound: !!after,
          afterEnabled: after?.enabled ?? null,
        }
      } catch (e) {
        return { error: String(e) }
      }
    })
    console.log('TOGGLE ROUNDTRIP:', JSON.stringify(result, null, 2))
  })

  test('F6+ parse_mcp_deeplink 命令检查：dev mode 预期不可达', async ({ page }) => {
    await page.goto('http://localhost:1420/')
    await page.waitForSelector('[data-testid="app-header"]', { timeout: 15000 })

    const result = await page.evaluate(async () => {
      try {
        const tauri = (window as unknown as { __TAURI_INTERNALS__?: { invoke: (cmd: string, args?: any) => Promise<any> } }).__TAURI_INTERNALS__
        if (!tauri) return { error: 'no __TAURI_INTERNALS__' }
        const parsed = await tauri.invoke('parse_mcp_deeplink', {
          url: 'ccswitch://v1/import?resource=mcp&name=test&command=echo&args=hello',
        })
        return { ok: true, parsed }
      } catch (e) {
        return { error: String(e) }
      }
    })
    console.log('PARSE_MCP_DEEPLINK:', JSON.stringify(result, null, 2))
  })
})