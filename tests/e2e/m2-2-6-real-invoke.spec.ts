/**
 * M2.2.6 F13 备份与恢复 — 真业务验证 spec.
 *
 * Diagnostic spec — written by m2-2-6-verify subagent 2026-06-20.
 *
 * Goal: validate that the F13 备份与恢复 page is REAL business UI
 * (not a PluginPlaceholder) and that the page's IPC calls match the
 * actual Tauri command signatures in `src-tauri/src/commands/backup.rs`.
 *
 * ## Dev-mode caveat
 *
 * `tauri dev` + Playwright chromium has NO `__TAURI_INTERNALS__`
 * (the WebView2 only exists in the Tauri-spawned process, not in
 * bare Chromium against the Vite dev server). So we:
 *   1. Check the DOM-level signals (page mounts, real UI, no error).
 *   2. Stub `__TAURI_INTERNALS__` via addInitScript with the
 *      REAL command names + correct arg shapes, and verify the
 *      page's render pipeline populates the timeline + diff view.
 *   3. Probe the actual release exe via a PrintWindow screenshot
 *      (separate task — see `release-printwindow` in the run log).
 *
 * ## Command signature audit (vs `src-tauri/src/commands/backup.rs`)
 *
 *   list_backups()                  — no args
 *   read_backup_content(path)
 *   diff_backups(path1, path2)
 *   restore_backup(backup_path)
 *   backup_now(target)
 *
 * NOT `list_backups(kind: 'settings')` (no `kind` arg).
 * NOT `backup_now(sourcePath, label)` (single `target` arg).
 */
import { test, expect } from '@playwright/test';
import { execSync } from 'child_process';

const DIAG_DIR = '.planning/diagnostics/m2-2-6-verify';

// No global afterEach kill — the dev server is shared across the 3 tests in
// this file. Each test opens a fresh page; tauri dev's vite child stays
// alive even when claude-config-manager.exe is killed.
test.afterAll(() => {
  try {
    execSync('bash scripts/kill-app.sh --force', { stdio: 'ignore' });
  } catch {
    /* ignore */
  }
});

test.describe('M2.2.6 F13 备份与恢复 真业务验证', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test('F13 备份与恢复 页面：真业务 UI 还是 PluginPlaceholder？', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => {
      consoleErrors.push(`pageerror: ${err.message}`);
    });

    await page.goto('http://localhost:1420/');
    await page.waitForSelector('[data-testid="app-header"]', { timeout: 15000 });
    await page.waitForTimeout(500);

    // Navigate to F13 via sidebar.
    await page.click('[data-testid="sidebar-item-backup-restore"]');
    await page.waitForTimeout(2000); // wait for list_backups roundtrip + render

    await page.screenshot({
      path: `${DIAG_DIR}/01-f13-page.png`,
      fullPage: false,
    });

    const state = await page.evaluate(() => {
      const f13Page = document.querySelector(
        '[data-testid="backup-restore-page"]',
      ) as HTMLElement | null;
      const placeholder = document.querySelector(
        '[data-testid^="plugin-placeholder"]',
      ) as HTMLElement | null;
      const timeline = document.querySelector(
        '[data-testid="backup-timeline"]',
      ) as HTMLElement | null;
      const loading = document.querySelector(
        '[data-testid="backup-loading"]',
      ) as HTMLElement | null;
      const emptyState = document.querySelector(
        '[data-testid="backup-empty"]',
      ) as HTMLElement | null;
      const backupNowBtn = document.querySelector(
        '[data-testid="backup-now-btn"]',
      ) as HTMLButtonElement | null;
      const compareBtn = document.querySelector(
        '[data-testid="backup-compare-btn"]',
      ) as HTMLButtonElement | null;
      const refreshBtn = document.querySelector(
        '[data-testid="backup-refresh-btn"]',
      ) as HTMLButtonElement | null;
      const detailPanel = document.querySelector(
        '[data-testid="backup-detail-panel"]',
      ) as HTMLElement | null;
      const body = document.body.innerText;
      return {
        f13PageMounted: !!f13Page,
        placeholderMounted: !!placeholder,
        timelineMounted: !!timeline,
        loadingVisible: !!loading,
        emptyVisible: !!emptyState,
        backupNowBtnVisible: !!backupNowBtn,
        compareBtnVisible: !!compareBtn,
        refreshBtnVisible: !!refreshBtn,
        detailPanelMounted: !!detailPanel,
        h1Text: document.querySelector('h1')?.textContent?.trim() ?? null,
        h2Texts: Array.from(document.querySelectorAll('h2')).map(
          (e) => (e as HTMLElement).textContent?.trim() ?? '',
        ),
        bodyTextSnippet: body.substring(0, 500),
        hasBug: body.includes('TypeId') ||
          body.includes('state not managed') ||
          body.includes('PluginPlaceholder') ||
          body.includes('即将推出'),
      };
    });
    console.log('F13 PAGE STATE:', JSON.stringify(state, null, 2));
    console.log('CONSOLE ERRORS:', JSON.stringify(consoleErrors, null, 2));

    // Real business UI assertions.
    expect(state.f13PageMounted).toBe(true);
    expect(state.placeholderMounted).toBe(false);
    expect(state.timelineMounted).toBe(true);
    expect(state.backupNowBtnVisible).toBe(true);
    expect(state.compareBtnVisible).toBe(true);
    expect(state.refreshBtnVisible).toBe(true);
    expect(state.detailPanelMounted).toBe(true);
    expect(state.hasBug).toBe(false);
  });

  test('__TAURI_INTERNALS__ 探针：dev mode 预期不可达', async ({ page }) => {
    await page.goto('http://localhost:1420/');
    await page.waitForSelector('[data-testid="app-header"]', { timeout: 15000 });

    const probe = await page.evaluate(() => {
      const tauri = (window as unknown as { __TAURI_INTERNALS__?: unknown })
        .__TAURI_INTERNALS__;
      const tauriObj = (window as unknown as Record<string, unknown>);
      return {
        internalsAvailable: typeof tauri !== 'undefined',
        knownKeys: Object.keys(tauriObj).filter(
          (k) => k.startsWith('__TAURI') || k.startsWith('__TAURI_'),
        ),
      };
    });
    console.log('TAURI PROBE:', JSON.stringify(probe, null, 2));
    // In dev mode (Vite at :1420, no Tauri runtime), this is expected to be false.
    expect(probe.internalsAvailable).toBe(false);
  });

  test('真 invoke pipeline：addInitScript stub 走通 list → diff → content', async ({
    page,
  }) => {
    // Track every invoke call so we can assert the command + arg SHAPES.
    const invokeCalls: Array<{ cmd: string; args: unknown }> = [];

    await page.addInitScript(() => {
      const w = window as unknown as {
        __TAURI_INTERNALS__?: {
          invoke: (cmd: string, args?: unknown) => Promise<unknown>;
        };
      };

      // Deterministic, real-shape mock data.
      const now = Math.floor(Date.now() / 1000);
      const entries = [
        {
          path: 'C:\\Users\\e-Yunfei.Qian\\.claude\\settings.json.bak.20260620-100000',
          original_path: 'C:\\Users\\e-Yunfei.Qian\\.claude\\settings.json',
          timestamp_unix: now - 60,
          size_bytes: 512,
          source: 'settings',
        },
        {
          path: 'C:\\Users\\e-Yunfei.Qian\\.claude\\settings.json.bak.20260620-090000',
          original_path: 'C:\\Users\\e-Yunfei.Qian\\.claude\\settings.json',
          timestamp_unix: now - 3600,
          size_bytes: 256,
          source: 'settings',
        },
      ];

      const stub: Record<string, (args: any) => Promise<unknown>> = {
        list_backups: async () => entries,
        read_backup_content: async (args: any) => {
          return JSON.stringify(
            { stub: true, path: args?.path ?? null, ts: now },
            null,
            2,
          );
        },
        diff_backups: async (args: any) => {
          // Args shape check: must be { path1, path2 }.
          if (!args || typeof args.path1 !== 'string' || typeof args.path2 !== 'string') {
            throw new Error(
              `diff_backups expected {path1, path2} but got ${JSON.stringify(args)}`,
            );
          }
          return [
            {
              path: 'env.ANTHROPIC_BASE_URL',
              op: 'change',
              old: 'https://old.example',
              new: 'https://new.example',
            },
            {
              path: 'mcpServers.test',
              op: 'add',
              old: null,
              new: { command: 'echo', args: ['hi'] },
            },
          ];
        },
        restore_backup: async (args: any) => {
          if (!args || typeof args.backup_path !== 'string') {
            throw new Error(
              `restore_backup expected {backup_path} but got ${JSON.stringify(args)}`,
            );
          }
          return null;
        },
        backup_now: async (args: any) => {
          if (!args || typeof args.target !== 'string') {
            throw new Error(
              `backup_now expected {target} but got ${JSON.stringify(args)}`,
            );
          }
          return {
            path: `${args.target}.bak.${now}`,
            original_path: args.target,
            size_bytes: 768,
            source: 'manual',
          };
        },
      };

      w.__TAURI_INTERNALS__ = {
        invoke: async (cmd: string, args: unknown) => {
          // Record every call — we assert shapes after the test.
          (window as unknown as { __invokeCalls: unknown[] }).__invokeCalls =
            ((window as unknown as { __invokeCalls: unknown[] }).__invokeCalls ?? [])
              .concat([{ cmd, args }]);
          const fn = stub[cmd];
          if (!fn) {
            throw new Error(`unmocked command: ${cmd}`);
          }
          return fn(args);
        },
      };
    });

    await page.goto('http://localhost:1420/');
    await page.waitForSelector('[data-testid="app-header"]', { timeout: 15000 });
    await page.click('[data-testid="sidebar-item-backup-restore"]');

    // Wait for timeline to render 2 rows.
    await page.waitForSelector('[data-testid="backup-row"]', { timeout: 10000 });
    await expect(page.getByTestId('backup-row')).toHaveCount(2);

    await page.screenshot({
      path: `${DIAG_DIR}/02-f13-timeline.png`,
      fullPage: false,
    });

    // Tick both checkboxes → click compare → diff view mounts.
    const checks = page.getByTestId('backup-row-check');
    await checks.nth(0).click();
    await checks.nth(1).click();
    await page.getByTestId('backup-compare-btn').click();
    await page.waitForSelector('[data-testid="backup-diff-view"]', {
      timeout: 5000,
    });
    const diffRows = page.getByTestId('backup-diff-row');
    await expect(diffRows).toHaveCount(2);
    await page.screenshot({
      path: `${DIAG_DIR}/03-f13-diff.png`,
      fullPage: false,
    });

    // [查看完整内容] → ContentView renders.
    const viewBtn = page.getByTestId('backup-view-btn').first();
    await viewBtn.click();
    await page.waitForSelector('[data-testid="backup-content-view"]', {
      timeout: 5000,
    });
    await page.screenshot({
      path: `${DIAG_DIR}/04-f13-content.png`,
      fullPage: false,
    });

    // [立刻备份] — auto-confirm dialog.
    page.once('dialog', (d) => void d.accept());
    await page.getByTestId('backup-now-btn').click();
    await page.waitForTimeout(800);
    await page.screenshot({
      path: `${DIAG_DIR}/05-f13-backup-now.png`,
      fullPage: false,
    });

    // Pull the recorded invoke calls and assert each command's arg shape.
    const calls = await page.evaluate(
      () =>
        ((window as unknown as { __invokeCalls: unknown[] }).__invokeCalls ?? []),
    );
    invokeCalls.push(
      ...(calls as Array<{ cmd: string; args: unknown }>),
    );
    console.log('INVOKE CALLS:', JSON.stringify(invokeCalls, null, 2));

    // ----- ASSERTIONS -----
    const listCall = invokeCalls.find((c) => c.cmd === 'list_backups');
    expect(listCall, 'list_backups was called').toBeDefined();
    expect(listCall!.args ?? null, 'list_backups takes NO args').toBeFalsy();

    const diffCall = invokeCalls.find((c) => c.cmd === 'diff_backups');
    expect(diffCall, 'diff_backups was called').toBeDefined();
    const dArgs = diffCall!.args as { path1: string; path2: string };
    expect(typeof dArgs.path1).toBe('string');
    expect(typeof dArgs.path2).toBe('string');

    const contentCall = invokeCalls.find((c) => c.cmd === 'read_backup_content');
    expect(contentCall, 'read_backup_content was called').toBeDefined();
    expect(typeof (contentCall!.args as { path: string }).path).toBe('string');

    const backupCall = invokeCalls.find(
      (c) => c.cmd === 'backup_now',
    );
    expect(backupCall, 'backup_now was called').toBeDefined();
    const bArgs = backupCall!.args as { target: string };
    expect(typeof bArgs.target).toBe('string');
    expect(bArgs.target).toMatch(/\.claude[\\/]settings\.json$/);

    // No call should use the user's spec's wrong keys.
    for (const c of invokeCalls) {
      if (c.cmd === 'backup_now') {
        const a = c.args as Record<string, unknown>;
        expect(a.sourcePath, 'backup_now should not use sourcePath').toBeUndefined();
        expect(a.label, 'backup_now should not use label').toBeUndefined();
      }
      if (c.cmd === 'list_backups') {
        const a = c.args as Record<string, unknown>;
        expect(a.kind, 'list_backups should not use kind').toBeUndefined();
      }
    }
  });
});
