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

  test('主题切换按钮已移除（M2.16 theme-trim — 单档 light 无需切换）', async ({ page }) => {
    await page.goto('http://localhost:1420/')
    await page.waitForSelector('[data-testid="app-header"]', { timeout: 15000 })

    // M2.16 theme-trim: 主题从 3 档 (light / glass-clear / glass-tinted)
    // 砍到单档 light (瓷白),切换按钮已删。此 e2e 是回归 guard —
    // 防止后期误把按钮加回。如后期重新加多档主题,先恢复
    // cycleTheme + 按钮,再把本测试换回 3 态 cycle 断言。
    //
    // 原 3 态 cycle 测试已失效(按钮 DOM 不存在),改为断言按钮
    // 不在 DOM 中 + <html data-theme> 恒为 'light'。
    const state = await page.evaluate(() => {
      const btn = document.querySelector<HTMLButtonElement>('[data-testid="app-header-theme-toggle"]')
      const dataTheme = document.documentElement.dataset.theme
      return {
        togglePresent: btn !== null,
        dataTheme,
      }
    })
    console.log('THEME trim state:', JSON.stringify(state, null, 2))

    expect(state.togglePresent).toBe(false)
    expect(state.dataTheme).toBe('light')

    await page.screenshot({ path: '.planning/diagnostics/m2-3-0-verify/04-theme-trim-light.png' })
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
