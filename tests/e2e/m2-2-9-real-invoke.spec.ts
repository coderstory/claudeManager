import { test, expect } from '@playwright/test'
import { execSync } from 'child_process'

test.afterAll(() => {
  try { execSync('bash scripts/kill-app.sh', { stdio: 'ignore' }) } catch {}
})

test.describe('M2.2.9 F18 + routing fix 真业务验证', () => {
  test.use({ viewport: { width: 1024, height: 640 } })

  test('F18 配置优化页面：真业务 UI', async ({ page }) => {
    await page.goto('http://localhost:1420/')
    await page.waitForSelector('[data-testid="app-header"]', { timeout: 15000 })
    await page.click('[data-testid="sidebar-item-optimizer"]')
    await page.waitForTimeout(1500)

    await page.screenshot({ path: '.planning/diagnostics/m2-2-9-verify/01-f18-optimizer.png' })

    const state = await page.evaluate(() => ({
      bodyText: document.body.innerText.substring(0, 800),
      h1: document.querySelector('h1')?.textContent,
      isPlaceholder: document.body.innerText.includes('plugin: optimizer'),
      hasScanBtn: document.body.innerText.includes('扫描') || document.body.innerText.includes('优化'),
    }))
    console.log('F18 PAGE:', JSON.stringify(state, null, 2))
    expect(state.isPlaceholder).toBe(false)
  })

  test('F8 路由修复后：真业务 UI', async ({ page }) => {
    await page.goto('http://localhost:1420/')
    await page.waitForSelector('[data-testid="app-header"]', { timeout: 15000 })
    await page.click('[data-testid="sidebar-item-single-file-deploy"]')
    await page.waitForTimeout(1500)

    await page.screenshot({ path: '.planning/diagnostics/m2-2-9-verify/02-f8-after-routing-fix.png' })

    const state = await page.evaluate(() => ({
      isPlaceholder: document.body.innerText.includes('plugin: single-file-deploy'),
      h1: document.querySelector('h1')?.textContent,
    }))
    console.log('F8 AFTER FIX:', JSON.stringify(state, null, 2))
    expect(state.isPlaceholder).toBe(false)
  })

  test('F3 路由修复后：真业务 UI（M2.8.1 顺手发现的另一个 bug）', async ({ page }) => {
    await page.goto('http://localhost:1420/')
    await page.waitForSelector('[data-testid="app-header"]', { timeout: 15000 })
    await page.click('[data-testid="sidebar-item-import-sql"]')
    await page.waitForTimeout(1500)

    await page.screenshot({ path: '.planning/diagnostics/m2-2-9-verify/03-f3-after-routing-fix.png' })

    const state = await page.evaluate(() => ({
      isPlaceholder: document.body.innerText.includes('plugin: import-sql'),
      h1: document.querySelector('h1')?.textContent,
    }))
    console.log('F3 AFTER FIX:', JSON.stringify(state, null, 2))
    expect(state.isPlaceholder).toBe(false)
  })
})