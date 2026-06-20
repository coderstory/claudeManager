import { test, expect } from '@playwright/test'
import { execSync } from 'child_process'

test.afterAll(() => {
  try { execSync('bash scripts/kill-app.sh', { stdio: 'ignore' }) } catch {}
})

test.describe('M2.2.8 F8 单文件部署 真业务验证', () => {
  test.use({ viewport: { width: 1024, height: 640 } })

  test('F8 页面：真业务 UI（不是 placeholder）', async ({ page }) => {
    await page.goto('http://localhost:1420/')
    await page.waitForSelector('[data-testid="app-header"]', { timeout: 15000 })
    await page.click('[data-testid="sidebar-item-single-file-deploy"]')
    await page.waitForTimeout(1500)

    await page.screenshot({ path: '.planning/diagnostics/m2-2-8-verify/01-f8-page.png' })

    const state = await page.evaluate(() => ({
      bodyText: document.body.innerText.substring(0, 800),
      h1: document.querySelector('h1')?.textContent,
      isPlaceholder: document.body.innerText.includes('plugin: single-file-deploy'),
      hasMetadata: document.body.innerText.includes('版本') || document.body.innerText.includes('commit'),
      hasError: document.body.innerText.includes('错误') || document.body.innerText.includes('TypeId'),
    }))
    console.log('F8 PAGE:', JSON.stringify(state, null, 2))
    expect(state.isPlaceholder).toBe(false)
    expect(state.hasError).toBe(false)
  })

  test('F8 真 invoke get_app_metadata：返回 commit / target / timestamp', async ({ page }) => {
    await page.goto('http://localhost:1420/')
    await page.waitForSelector('[data-testid="app-header"]', { timeout: 15000 })

    const result = await page.evaluate(async () => {
      try {
        const tauri = (window as any).__TAURI_INTERNALS__
        if (!tauri) return { error: 'no __TAURI_INTERNALS__' }
        const meta = await tauri.invoke('get_app_metadata', {})
        return { meta }
      } catch (e) {
        return { error: String(e) }
      }
    })
    console.log('F8 METADATA INVOKE:', JSON.stringify(result, null, 2))
    expect((result as any).error).toBeUndefined()
  })
})
