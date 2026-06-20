import { test, expect } from '@playwright/test'
import { execSync } from 'child_process'

test.afterAll(() => {
  try { execSync('bash scripts/kill-app.sh', { stdio: 'ignore' }) } catch {}
})

test.describe('M2.2.7 F7 + F13 路由修复真业务验证', () => {
  test.use({ viewport: { width: 1024, height: 640 } })

  test('F7 用量查询页面：真业务 UI', async ({ page }) => {
    await page.goto('http://localhost:1420/')
    await page.waitForSelector('[data-testid="app-header"]', { timeout: 15000 })
    await page.click('[data-testid="sidebar-item-usage-query"]')
    await page.waitForTimeout(1500)

    await page.screenshot({ path: '.planning/diagnostics/m2-2-7-verify/01-f7-usage-page.png' })

    const state = await page.evaluate(() => ({
      bodyText: document.body.innerText.substring(0, 600),
      hasError: document.body.innerText.includes('错误') || document.body.innerText.includes('TypeId'),
      h1: document.querySelector('h1')?.textContent,
      isPlaceholder: document.body.innerText.includes('plugin: usage-query'),
    }))
    console.log('F7 PAGE STATE:', JSON.stringify(state, null, 2))
    expect(state.hasError).toBe(false)
    expect(state.isPlaceholder).toBe(false)
  })

  test('F13 备份还原页面：路由修复后真 UI (不再是 placeholder)', async ({ page }) => {
    await page.goto('http://localhost:1420/')
    await page.waitForSelector('[data-testid="app-header"]', { timeout: 15000 })
    await page.click('[data-testid="sidebar-item-backup-restore"]')
    await page.waitForTimeout(1500)

    await page.screenshot({ path: '.planning/diagnostics/m2-2-7-verify/02-f13-page-after-routing-fix.png' })

    const state = await page.evaluate(() => ({
      bodyText: document.body.innerText.substring(0, 600),
      hasError: document.body.innerText.includes('错误') || document.body.innerText.includes('TypeId'),
      h1: document.querySelector('h1')?.textContent,
      isPlaceholder: document.body.innerText.includes('plugin: backup-restore'),
      hasTimeline: document.body.innerText.includes('时间线') || document.body.innerText.includes('备份'),
    }))
    console.log('F13 PAGE AFTER FIX:', JSON.stringify(state, null, 2))
    expect(state.isPlaceholder).toBe(false)
    expect(state.hasError).toBe(false)
  })

  test('F1 list_providers + F6 list_mcp_servers 仍工作 (P0 fix 没回归)', async ({ page }) => {
    await page.goto('http://localhost:1420/')
    await page.waitForSelector('[data-testid="app-header"]', { timeout: 15000 })

    const result = await page.evaluate(async () => {
      const out: any = {}
      try {
        const tauri = (window as any).__TAURI_INTERNALS__
        if (!tauri) return { error: 'no __TAURI_INTERNALS__' }
        out.providers = await tauri.invoke('list_providers', {})
        out.mcpServers = await tauri.invoke('list_mcp_servers', {})
        return out
      } catch (e) {
        return { error: String(e) }
      }
    })
    console.log('REGRESSION CHECK:', JSON.stringify(result, null, 2))
    expect((result as any).error).toBeUndefined()
  })
})
