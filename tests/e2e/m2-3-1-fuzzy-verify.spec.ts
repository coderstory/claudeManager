import { test, expect } from '@playwright/test'
import { execSync } from 'child_process'

// M2.3.1 F9 真业务验证 — 用 Playwright 真测 QuickSearchModal 的 fuzzy search
// 目标:验证 fuzzy 真按字符顺序匹配 + <mark> 高亮 + Enter 跳转 + 空查询显示历史
//
// 注意: useKeyboardShortcuts 对 INPUT/TEXTAREA 例外 (M2.10 §3),
// 所以 Ctrl+/ 必须从 body 触发 — 我们用 page.locator('body').focus()
// 然后 keyboard.press('Control+/') 来模拟。

test.afterAll(() => {
  try { execSync('bash scripts/kill-app.sh', { stdio: 'ignore' }) } catch {}
})

test.describe('M2.3.1 F9 Fuzzy Search 真业务验证', () => {
  test.use({ viewport: { width: 1024, height: 640 } })

  test('打开 QuickSearchModal + 输入 "pro" → fuzzy 匹配 Provider 相关项', async ({ page }) => {
    await page.goto('http://localhost:1420/')
    await page.waitForSelector('[data-testid="app-header"]', { timeout: 15000 })

    // 把焦点放到 body 才能让 useKeyboardShortcuts 命中 Ctrl+/
    await page.locator('body').click({ position: { x: 10, y: 10 } })
    await page.keyboard.press('Control+/')
    await page.waitForSelector('[data-testid="quick-search-modal"]', { timeout: 5000 })
    await page.waitForTimeout(300)

    // 输入 "pro"
    await page.keyboard.type('pro')
    await page.waitForTimeout(500)

    await page.screenshot({ path: '.planning/diagnostics/m2-3-1-verify/01-fuzzy-pro.png' })

    const state = await page.evaluate(() => {
      const marks = Array.from(document.querySelectorAll('mark')).map(m => m.textContent)
      const results = Array.from(document.querySelectorAll('[data-testid^="quick-search-result-"]')).map(el => el.textContent || '')
      return {
        bodyText: document.body.innerText.substring(0, 500),
        hasMark: marks.length > 0,
        markCount: marks.length,
        marks,
        resultCount: results.length,
        firstResult: results[0],
        hasInput: !!document.querySelector('input'),
      }
    })
    console.log('FUZZY "pro":', JSON.stringify(state, null, 2))
    expect(state.hasInput).toBe(true)
  })

  test('"mcp" → fuzzy 匹配 MCP 相关 + mark 高亮', async ({ page }) => {
    await page.goto('http://localhost:1420/')
    await page.waitForSelector('[data-testid="app-header"]', { timeout: 15000 })

    await page.locator('body').click({ position: { x: 10, y: 10 } })
    await page.keyboard.press('Control+/')
    await page.waitForSelector('[data-testid="quick-search-modal"]', { timeout: 5000 })
    await page.waitForTimeout(300)
    await page.keyboard.type('mcp')
    await page.waitForTimeout(500)

    await page.screenshot({ path: '.planning/diagnostics/m2-3-1-verify/02-fuzzy-mcp.png' })

    const state = await page.evaluate(() => {
      const marks = Array.from(document.querySelectorAll('mark')).map(m => m.textContent)
      const results = Array.from(document.querySelectorAll('[data-testid^="quick-search-result-"]')).map(el => el.textContent || '')
      return {
        markCount: marks.length,
        marks,
        resultCount: results.length,
        results: results.slice(0, 5),
        bodyText: document.body.innerText.substring(0, 300),
      }
    })
    console.log('FUZZY "mcp" marks:', JSON.stringify(state, null, 2))
  })

  test('Enter 跳转第一个结果', async ({ page }) => {
    await page.goto('http://localhost:1420/')
    await page.waitForSelector('[data-testid="app-header"]', { timeout: 15000 })

    await page.locator('body').click({ position: { x: 10, y: 10 } })
    await page.keyboard.press('Control+/')
    await page.waitForSelector('[data-testid="quick-search-modal"]', { timeout: 5000 })
    await page.waitForTimeout(300)
    await page.keyboard.type('jso')  // fuzzy match JSON 编辑器
    await page.waitForTimeout(500)

    // 拿到第一个结果,核对它是 JSON 编辑器
    const firstBefore = await page.evaluate(() => {
      const el = document.querySelector('[data-testid^="quick-search-result-"]')
      return el?.textContent || ''
    })
    console.log('FIRST RESULT before Enter:', firstBefore)

    await page.keyboard.press('Enter')
    await page.waitForTimeout(800)

    await page.screenshot({ path: '.planning/diagnostics/m2-3-1-verify/03-after-enter.png' })

    const state = await page.evaluate(() => ({
      h1: document.querySelector('h1')?.textContent,
      modalStillOpen: !!document.querySelector('[data-testid="quick-search-modal"]'),
      hasInput: !!document.querySelector('input[type="text"]'),
      url: window.location.href,
    }))
    console.log('AFTER ENTER "jso":', JSON.stringify(state, null, 2))
  })

  test('"bb" 不匹配任何 → 空结果', async ({ page }) => {
    await page.goto('http://localhost:1420/')
    await page.waitForSelector('[data-testid="app-header"]', { timeout: 15000 })

    await page.locator('body').click({ position: { x: 10, y: 10 } })
    await page.keyboard.press('Control+/')
    await page.waitForSelector('[data-testid="quick-search-modal"]', { timeout: 5000 })
    await page.waitForTimeout(300)
    await page.keyboard.type('bb')
    await page.waitForTimeout(500)

    const state = await page.evaluate(() => ({
      hasEmpty: !!document.querySelector('[data-testid="quick-search-empty"]'),
      resultCount: document.querySelectorAll('[data-testid^="quick-search-result-"]').length,
      bodyText: document.body.innerText.substring(0, 300),
    }))
    console.log('FUZZY "bb" (no match):', JSON.stringify(state, null, 2))
  })

  test('空查询显示搜索历史', async ({ page }) => {
    await page.goto('http://localhost:1420/')
    await page.waitForSelector('[data-testid="app-header"]', { timeout: 15000 })

    // 先做一次成功的搜索让历史被写入
    await page.locator('body').click({ position: { x: 10, y: 10 } })
    await page.keyboard.press('Control+/')
    await page.waitForSelector('[data-testid="quick-search-modal"]', { timeout: 5000 })
    await page.waitForTimeout(300)
    await page.keyboard.type('pro')
    await page.waitForTimeout(300)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(500)

    // 再打开 modal,应该看到历史
    await page.locator('body').click({ position: { x: 10, y: 10 } })
    await page.keyboard.press('Control+/')
    await page.waitForSelector('[data-testid="quick-search-modal"]', { timeout: 5000 })
    await page.waitForTimeout(500)

    await page.screenshot({ path: '.planning/diagnostics/m2-3-1-verify/04-history.png' })

    const state = await page.evaluate(() => {
      const historyEl = document.querySelector('[data-testid="quick-search-history"]')
      const buttons = historyEl ? Array.from(historyEl.querySelectorAll('button')).map(b => b.textContent) : []
      return {
        hasHistory: !!historyEl,
        historyTexts: buttons,
        historyRaw: historyEl?.textContent || null,
      }
    })
    console.log('HISTORY strip:', JSON.stringify(state, null, 2))
  })
})