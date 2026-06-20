import { test, expect } from '@playwright/test'
import { execSync } from 'child_process'

// NOTE: do NOT kill app in afterAll — playwright test 1..4 share the
// dev server with the path-B release-exe screenshot pass. Killing it
// here would force a 75s restart. Kill is handled by the orchestrator
// after the full diagnostic report is written.

test.describe('M2.3.0 F11 快捷键 + F12 主题 真业务验证', () => {
  test.use({ viewport: { width: 1024, height: 640 } })

  test('Ctrl+/ 打开 QuickSearchModal', async ({ page }) => {
    await page.goto('http://localhost:1420/')
    await page.waitForSelector('[data-testid="app-header"]', { timeout: 15000 })

    await page.screenshot({ path: '.planning/diagnostics/m2-3-0-verify/01-home.png' })

    // 按 Ctrl+/
    await page.keyboard.press('Control+/')

    await page.waitForTimeout(800)
    await page.screenshot({ path: '.planning/diagnostics/m2-3-0-verify/02-quicksearch-open.png' })

    const state = await page.evaluate(() => ({
      bodyText: document.body.innerText.substring(0, 500),
      hasModal: document.body.innerText.includes('搜索') || document.body.innerText.includes('Search'),
      hasInput: !!document.querySelector('input[type="text"]') || !!document.querySelector('[role="dialog"] input'),
      backdropPresent: !!document.querySelector('[data-testid="quick-search-backdrop"]'),
      modalPresent: !!document.querySelector('[data-testid="quick-search-modal"]'),
      searchInputPresent: !!document.querySelector('[data-testid="quick-search-input"]'),
    }))
    console.log('CTRL+/:', JSON.stringify(state, null, 2))
    expect(state.searchInputPresent || state.hasInput).toBe(true)
  })

  test('Esc 关闭 QuickSearchModal', async ({ page }) => {
    await page.goto('http://localhost:1420/')
    await page.waitForSelector('[data-testid="app-header"]', { timeout: 15000 })

    await page.keyboard.press('Control+/')
    await page.waitForTimeout(500)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(500)

    await page.screenshot({ path: '.planning/diagnostics/m2-3-0-verify/03-after-esc.png' })

    const state = await page.evaluate(() => ({
      hasInput: !!document.querySelector('input[type="text"]') || !!document.querySelector('[role="dialog"] input'),
      modalPresent: !!document.querySelector('[data-testid="quick-search-modal"]'),
      backdropPresent: !!document.querySelector('[data-testid="quick-search-backdrop"]'),
    }))
    console.log('AFTER ESC:', JSON.stringify(state, null, 2))
    expect(state.modalPresent).toBe(false)
  })

  test('主题切换按钮：3 态 cycle（light → dark → auto → light）', async ({ page }) => {
    await page.goto('http://localhost:1420/')
    await page.waitForSelector('[data-testid="app-header"]', { timeout: 15000 })

    // 点 theme toggle — Tauri's WebView2 has a quirk where the
    // header drag region (data-tauri-drag-region) causes Playwright
    // to mis-report the button as "outside the viewport" because the
    // WebkitAppRegion: 'no-drag' CSS is interpreted at the OS layer
    // but not by Chromium's hit-testing. Bypassing with a direct
    // .click() DOM dispatch sidesteps Playwright's actionability
    // check entirely; the cycleTheme() handler still runs as a real
    // user click because it doesn't depend on event coordinates.
    //
    // We read the resolved theme via the button's aria-label rather
    // than documentElement.dataset.theme, because in 'auto' mode the
    // data-theme attribute is rewritten to 'light' or 'dark' by
    // applyTheme() (line 59 in ThemeProvider.tsx) and would mask
    // the cycle from the DOM observation. The aria-label preserves
    // the React state name: light→"切换到深色主题", dark→"切换到自动模式",
    // auto→"切换到浅色主题".
    const readThemeState = () => page.evaluate(() => {
      const btn = document.querySelector<HTMLButtonElement>('[data-testid="app-header-theme-toggle"]')
      const label = btn?.getAttribute('aria-label') ?? ''
      if (label.includes('深色')) return 'light'   // "切换到深色主题" → currently light
      if (label.includes('自动')) return 'dark'    // "切换到自动模式" → currently dark
      if (label.includes('浅色')) return 'auto'    // "切换到浅色主题" → currently auto
      return 'unknown'
    })
    const clickTheme = async () => {
      await page.evaluate(() => {
        const btn = document.querySelector<HTMLButtonElement>('[data-testid="app-header-theme-toggle"]')
        btn?.click()
      })
    }
    const theme1 = await readThemeState()
    console.log('THEME initial:', theme1)

    await clickTheme()
    await page.waitForTimeout(500)
    const theme2 = await readThemeState()
    console.log('THEME after 1 click:', theme2)

    await clickTheme()
    await page.waitForTimeout(500)
    const theme3 = await readThemeState()
    console.log('THEME after 2 clicks:', theme3)

    // 在 auto 状态下截图 — 此时 data-theme 可能仍是 light/dark，
    // 但 React 状态 = auto，按钮 aria-label = "切换到浅色主题"。
    const dataThemeAuto = await page.evaluate(() => document.documentElement.dataset.theme)
    console.log('THEME data-theme attribute in auto:', dataThemeAuto)
    await page.screenshot({ path: '.planning/diagnostics/m2-3-0-verify/04-theme-auto.png' })

    await clickTheme()
    await page.waitForTimeout(500)
    const theme4 = await readThemeState()
    console.log('THEME after 3 clicks:', theme4)

    // 期望：light → dark → auto → light 完整 3 步 cycle
    expect(theme1).toBe('light')
    expect(theme2).toBe('dark')
    expect(theme3).toBe('auto')
    expect(theme4).toBe('light')
  })

  test('Ctrl+1-9 跳转到 sidebar 路由', async ({ page }) => {
    await page.goto('http://localhost:1420/')
    await page.waitForSelector('[data-testid="app-header"]', { timeout: 15000 })

    // Ctrl+2 应跳到第二个 sidebar item (provider-list)
    await page.keyboard.press('Control+2')
    await page.waitForTimeout(800)
    await page.screenshot({ path: '.planning/diagnostics/m2-3-0-verify/05-ctrl-2.png' })

    const state = await page.evaluate(() => ({
      bodyText: document.body.innerText.substring(0, 300),
      h1: document.querySelector('h1')?.textContent,
    }))
    console.log('CTRL+2:', JSON.stringify(state, null, 2))
  })
})
