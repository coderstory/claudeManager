import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config — drives the Tauri app via tauri-driver + WebDriverIO.
 *
 * The Tauri app is single-instance, so we MUST run with one worker and no
 * parallelism. Each spec gets its own app launch (tauri-driver starts a
 * fresh process per WebDriver session), so the order of specs doesn't
 * share state.
 *
 * Notes:
 * - `baseURL` points at the Tauri custom-protocol URL the WebView uses.
 * - `webServer.command` echoes a placeholder because the Tauri app is NOT
 *   a Node server — it's a native process started by tauri-driver. CI
 *   launches the app explicitly before running Playwright (see
 *   .github/workflows/ci.yml).
 *
 * ## Dev-box mode (PLAYWRIGHT_BASE_URL env var)
 *
 * Tauri's official WebDriver path needs tauri-driver + msedgedriver +
 * WebDriverIO (Playwright cannot natively speak WebDriver — only CDP).
 * On a dev box without that full stack, the e2e specs can still run
 * against the Vite dev server (`npm run dev` at http://localhost:1420)
 * by setting `PLAYWRIGHT_BASE_URL=http://localhost:1420`. This covers
 * the DOM/layout/React-mount dimensions of every spec; specs that poke
 * `window.__TAURI_INTERNALS__.invoke(...)` will skip themselves with a
 * clear message because the IPC bridge is only present in the Tauri
 * WebView, not in a bare Chromium.
 *
 * The tauri://localhost default is preserved so the CI path stays
 * unchanged when the env var is absent.
 */
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'tauri://localhost';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'windows',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // webServer is only needed in dev-server mode (PLAYWRIGHT_BASE_URL set).
  // In real WebView2 mode (CDP_ENDPOINT set by run-e2e.sh), tauri-driver
  // already launched the app and Playwright connects to it via CDP, so
  // there is no Node-managed dev server to start. Skipping the block
  // prevents Playwright from failing on the placeholder `echo` command
  // exiting immediately when localhost:1420 is not listening.
  ...(process.env.PLAYWRIGHT_BASE_URL
    ? {
        webServer: {
          command: 'echo "Tauri app must be launched separately — see CI workflow"',
          url: 'http://localhost:1420',
          reuseExistingServer: true,
          timeout: 120_000,
        },
      }
    : {}),
});