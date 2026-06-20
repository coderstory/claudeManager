/**
 * M2.3.2 — UI layout 真业务验证 (DOM-only).
 *
 * 这是结构性回归 spec — 用 Playwright 跑 vite dev 模式下的真实 DOM,
 * 验证 4 个 M2.15 UI 修复在浏览器布局引擎里 (非 jsdom) 真的生效。
 *
 *   1. AppHeader 3 chrome 按钮 (min/max/close) 全部在 viewport 内
 *   2. AppHeader 返回按钮 (切到 plugin 后) 完整 32x32 且在 viewport 内
 *   3. QuickSearchModal X 关闭按钮 aria-label + title 含 "关闭" (含 Esc hint)
 *   4. QuickSearchModal header strip padding-top <= 16px (消除"不明空白")
 *
 * 严禁 page.screenshot (本 subagent 模型 text-only, 不能读 PNG)。
 * 只用 DOM probe (page.evaluate) + getBoundingClientRect。
 */
import { test, expect } from '@playwright/test'
import { execSync } from 'child_process'

test.afterAll(() => {
  try { execSync('bash scripts/kill-app.sh', { stdio: 'ignore' }) } catch {}
})

test.describe('M2.3.2 UI 布局 真业务验证 (text-only)', () => {
  test.use({ viewport: { width: 1024, height: 640 } })

  test('AppHeader 3 chrome 按钮全在 viewport 内', async ({ page }) => {
    await page.goto('http://localhost:1420/')
    await page.waitForSelector('[data-testid="app-header"]', { timeout: 15000 })
    await page.waitForTimeout(300)

    // DOM probe — 不调 page.screenshot (避开 PNG read 风险)
    const state = await page.evaluate(() => {
      const min = document.querySelector('[data-testid="app-header-minimize"]') as HTMLElement
      const max = document.querySelector('[data-testid="app-header-maximize"]') as HTMLElement
      const close = document.querySelector('[data-testid="app-header-close"]') as HTMLElement
      const inViewport = (el: HTMLElement | null) => {
        if (!el) return false
        const r = el.getBoundingClientRect()
        return (
          r.x >= 0 &&
          r.x + r.width <= window.innerWidth &&
          r.y >= 0 &&
          r.y + r.height <= window.innerHeight &&
          r.width > 0 &&
          r.height > 0
        )
      }
      const boxOf = (el: HTMLElement | null) => {
        if (!el) return null
        const r = el.getBoundingClientRect()
        return { x: r.x, y: r.y, width: r.width, height: r.height }
      }
      return {
        viewport: { w: window.innerWidth, h: window.innerHeight },
        minExists: !!min,
        maxExists: !!max,
        closeExists: !!close,
        minInVp: inViewport(min),
        maxInVp: inViewport(max),
        closeInVp: inViewport(close),
        minBox: boxOf(min),
        maxBox: boxOf(max),
        closeBox: boxOf(close),
      }
    })
    console.log('CHROME:', JSON.stringify(state, null, 2))
    expect(state.minExists, 'minimize button missing').toBe(true)
    expect(state.maxExists, 'maximize button missing').toBe(true)
    expect(state.closeExists, 'close button missing').toBe(true)
    expect(state.minInVp, 'minimize not in viewport').toBe(true)
    expect(state.maxInVp, 'maximize not in viewport').toBe(true)
    expect(state.closeInVp, 'close not in viewport').toBe(true)
  })

  test('返回按钮 (切到 plugin 后) 完整 32x32 + 在 viewport 内', async ({ page }) => {
    await page.goto('http://localhost:1420/')
    await page.waitForSelector('[data-testid="app-header"]', { timeout: 15000 })
    // navigate to a plugin view (seed BEFORE reload)
    await page.evaluate(() => {
      localStorage.setItem('ccm.lastView', 'provider-list')
    })
    await page.reload()
    await page.waitForSelector('[data-testid="app-header-back"]', { timeout: 10000 })
    await page.waitForTimeout(500)

    const state = await page.evaluate(() => {
      const back = document.querySelector('[data-testid="app-header-back"]') as HTMLElement
      if (!back) return { backExists: false }
      const r = back.getBoundingClientRect()
      return {
        backExists: true,
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
        inVp:
          r.x >= 0 &&
          r.x + r.width <= window.innerWidth &&
          r.y >= 0 &&
          r.y + r.height <= window.innerHeight,
      }
    })
    console.log('BACK:', JSON.stringify(state, null, 2))
    expect(state.backExists, 'back button missing').toBe(true)
    expect(state.width, 'back button width').toBe(32)
    expect(state.height, 'back button height').toBe(32)
    expect(state.inVp, 'back button not in viewport').toBe(true)
  })

  test('QuickSearchModal X 关闭按钮 aria-label + title + header strip padding', async ({ page }) => {
    await page.goto('http://localhost:1420/')
    await page.waitForSelector('[data-testid="app-header"]', { timeout: 15000 })
    // open modal via Ctrl+/
    await page.keyboard.press('Control+/')
    await page.waitForSelector('[data-testid="quick-search-modal"]', { timeout: 5000 })
    await page.waitForTimeout(300)

    const state = await page.evaluate(() => {
      // find X close button — its aria-label contains 关闭
      const closeBtn = Array.from(document.querySelectorAll('button')).find((b) => {
        const label = b.getAttribute('aria-label') || ''
        return label.includes('关闭')
      }) as HTMLElement | undefined
      // modal element (dialog)
      const modal = document.querySelector('[role="dialog"]') as HTMLElement
      const modalStyles = modal ? getComputedStyle(modal) : null
      // also probe the header strip (first child div of modal)
      const headerStrip = modal?.firstElementChild as HTMLElement | null
      const headerStyles = headerStrip ? getComputedStyle(headerStrip) : null
      return {
        closeBtnExists: !!closeBtn,
        closeBtnLabel: closeBtn?.getAttribute('aria-label') ?? null,
        closeBtnTitle: closeBtn?.getAttribute('title') ?? null,
        modalPaddingTop: modalStyles?.paddingTop ?? null,
        headerStripPaddingTop: headerStyles?.paddingTop ?? null,
      }
    })
    console.log('MODAL:', JSON.stringify(state, null, 2))
    expect(state.closeBtnExists, 'modal X close button missing').toBe(true)
    expect(state.closeBtnLabel ?? '', 'close button aria-label missing 关闭').toContain('关闭')
    expect(state.closeBtnTitle ?? '', 'close button title missing 关闭').toContain('关闭')
    // header strip padding-top must be <= 16px (the user-reported "不明空白" was 24-32px)
    const headerPx = parseInt(state.headerStripPaddingTop ?? '999', 10)
    expect(headerPx, `headerStripPaddingTop=${headerPx} exceeds 16px`).toBeLessThanOrEqual(16)
  })
})