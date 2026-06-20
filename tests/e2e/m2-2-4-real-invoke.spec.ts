/**
 * M2.2.4 真业务验证 spec.
 *
 * Diagnostic spec — written by m2-2-4-verify subagent 2026-06-20.
 *
 * ## What this tests (and WHY it can't fully run in dev mode)
 *
 * Per M2.2.3 fix commit (13448d7), `app.manage(Arc::new(state))` was
 * changed to `app.manage(state)`. The bug was: Tauri stores managed
 * state keyed by `std::any::TypeId`; every F1/F2/F3 command extracted
 * `State<'_, AppState>` (bare type), so the lookup at IPC-invoke time
 * never matched → `"state not managed for field '0' on command '...'`.
 *
 * M2.2.4 ships F4 deeplink commands. To prove they're *not* regressed
 * by the fix we need to actually invoke them through the IPC layer.
 *
 * ### The dev-mode catch
 *
 * `tauri dev` boots a vite + ViteDevServer on :1420 *and* the Rust
 * process; the WebView attaches to vite. But Playwright's default
 * `chromium` does NOT see `__TAURI_INTERNALS__` because the WebView2
 * is only in the Tauri-launched process, not in a bare Chromium. So
 * a `tauri dev` + Playwright combo CAN probe:
 *   - DOM-level state (F4 page mounts cleanly, testid presence)
 *   - react error-boundary didn't trip on the managed-state code path
 * But it CANNOT do raw `window.__TAURI_INTERNALS__.invoke(...)` and
 * get a real Tauri command response — that requires the release
 * WebView2 + a tauri-driver CDP session.
 *
 * ### Runtime gate is release-exe smoke
 *
 * The real `parse_deeplink_url` invocation gate is the release-exe
 * `scripts/smoke-test.sh` (M2.2.4 ship exe on Desktop) and the
 * in-process `npx vitest run` of the Rust `deeplink_parser::tests`
 * (which call `parse_deeplink_url` directly, no IPC overhead). This
 * spec is the dev-mode DOM check.
 *
 * ## Diagnostic captures
 *
 * All screenshots go to `.planning/diagnostics/m2-2-4-verify/`.
 */

import { test, expect } from '@playwright/test';
// Note: NO afterEach kill-app here — tauri dev is a single long-lived
// process. Killing it between tests would break the next test's
// page.goto. The parent diagnostic script owns process cleanup.

const DIAG_DIR = '.planning/diagnostics/m2-2-4-verify';

test.describe('M2.2.4 F4 deeplink 真业务验证 (DOM-level)', () => {
  test.use({ viewport: { width: 1024, height: 640 } })

  test('F4 deeplink-import 页面：真业务 UI 还是 PluginPlaceholder？', async ({ page }) => {
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

    // Navigate to F4 via sidebar.
    await page.click('[data-testid="sidebar-item-deeplink-import"]')
    await page.waitForTimeout(1500)

    await page.screenshot({
      path: `${DIAG_DIR}/01-f4-deeplink-page.png`,
      fullPage: false,
    })

    const state = await page.evaluate(() => {
      const f4Page = document.querySelector(
        '[data-testid="deeplink-import-page"]',
      ) as HTMLElement | null
      const placeholder = document.querySelector(
        '[data-testid^="plugin-placeholder"]',
      ) as HTMLElement | null
      const urlInput = document.querySelector(
        '[data-testid="deeplink-url-input"]',
      ) as HTMLInputElement | null
      const parseBtn = document.querySelector(
        '[data-testid="deeplink-parse-btn"]',
      ) as HTMLButtonElement | null
      const pasteBtn = document.querySelector(
        '[data-testid="deeplink-paste-btn"]',
      ) as HTMLButtonElement | null
      const body = document.body.innerText
      const tauriInternals = (window as unknown as { __TAURI_INTERNALS__?: unknown })
        .__TAURI_INTERNALS__
      return {
        f4PageMounted: !!f4Page,
        placeholderMounted: !!placeholder,
        urlInputVisible: !!urlInput,
        parseBtnVisible: !!parseBtn,
        pasteBtnVisible: !!pasteBtn,
        h1Text: document.querySelector('h1')?.textContent?.trim() ?? null,
        h2Texts: Array.from(document.querySelectorAll('h2')).map(
          (e) => (e as HTMLElement).textContent?.trim() ?? '',
        ),
        bodyText: body.substring(0, 600),
        hasManagedStateBug: body.includes('state not managed') ||
          body.includes('TypeId') ||
          body.includes('manage() before using this command'),
        tauriInternalsAvailable: typeof tauriInternals !== 'undefined',
      }
    })
    console.log('F4 PAGE STATE:', JSON.stringify(state, null, 2))
    console.log('CONSOLE ERRORS:', JSON.stringify(consoleErrors, null, 2))

    // Real business UI checks.
    expect(state.f4PageMounted).toBe(true)
    expect(state.placeholderMounted).toBe(false)
    expect(state.urlInputVisible).toBe(true)
    expect(state.parseBtnVisible).toBe(true)
    expect(state.pasteBtnVisible).toBe(true)
    expect(state.hasManagedStateBug).toBe(false)
  })

  test('__TAURI_INTERNALS__ 探针：dev mode 不应有，release 才有', async ({ page }) => {
    await page.goto('http://localhost:1420/')
    await page.waitForSelector('[data-testid="app-header"]', { timeout: 15000 })

    const probe = await page.evaluate(() => {
      const tauri = (window as unknown as { __TAURI_INTERNALS__?: unknown })
        .__TAURI_INTERNALS__
      const tauriObj = (window as unknown as Record<string, unknown>)
      return {
        internalsAvailable: typeof tauri !== 'undefined',
        // List known Tauri 2 global keys.
        knownKeys: Object.keys(tauriObj).filter((k) =>
          k.startsWith('__TAURI') || k.startsWith('__TAURI_'),
        ),
      }
    })
    console.log('TAURI PROBE:', JSON.stringify(probe, null, 2))
    // Documented expected: dev mode vite + Playwright chromium has no
    // Tauri's webview, so this is FALSE in dev mode. The real test is
    // the release-exe flow in the parent diagnostic script.
    expect(probe.internalsAvailable).toBe(false)
  })

  test('F1 list_providers DOM 探针：P0 fix 后 F1 页面仍能 mount', async ({ page }) => {
    await page.goto('http://localhost:1420/')
    await page.waitForSelector('[data-testid="app-header"]', { timeout: 15000 })
    await page.click('[data-testid="sidebar-item-provider-list"]')
    await page.waitForTimeout(2500) // wait for IPC roundtrip

    await page.screenshot({
      path: `${DIAG_DIR}/02-f1-list-page.png`,
      fullPage: false,
    })

    const state = await page.evaluate(() => {
      const f1Page = document.querySelector(
        '[data-testid="provider-list-page"]',
      ) as HTMLElement | null
      const placeholder = document.querySelector(
        '[data-testid^="plugin-placeholder"]',
      ) as HTMLElement | null
      const body = document.body.innerText
      return {
        f1PageMounted: !!f1Page,
        placeholderMounted: !!placeholder,
        bodyText: body.substring(0, 400),
        hasManagedStateBug: body.includes('state not managed') ||
          body.includes('TypeId') ||
          body.includes('manage() before using this command'),
      }
    })
    console.log('F1 STATE:', JSON.stringify(state, null, 2))
    expect(state.f1PageMounted).toBe(true)
    expect(state.placeholderMounted).toBe(false)
    expect(state.hasManagedStateBug).toBe(false)
  })
})
