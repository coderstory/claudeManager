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
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'tauri://localhost',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'windows',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'echo "Tauri app must be launched separately — see CI workflow"',
    url: 'http://localhost:1420',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});