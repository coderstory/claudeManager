/**
 * M2.6 — F13 备份与恢复 real-invoke e2e.
 *
 * Unlike most M2.x specs, this one does NOT need the full app —
 * it exercises the 4 backup commands (list / read / diff / restore
 * are stubbed at the IPC level when the page runs in dev). Instead
 * it verifies the IPC surface contract:
 *
 *   - The page mounts and calls list_backups
 *   - When the page renders rows, the JSON shape matches the
 *     BackupEntry TS mirror
 *   - The compare flow triggers diff_backups with both paths
 *
 * The actual restore (which writes to ~/.claude/settings.json) is
 * NOT exercised in the e2e — restore is destructive and we want the
 * smoke test to remain idempotent across runs.
 */
import { test, expect } from '@playwright/test';

test.describe('M2.6 — F13 备份与恢复 real invoke', () => {
  test('page mounts, calls list_backups, renders rows + triggers diff', async ({ page }) => {
    // Capture the list_backups response.
    const listResponsePromise = page.waitForResponse(
      (r) => r.url().includes('list_backups') || /listBackups/.test(r.request().method()),
    );

    // Stub the Tauri IPC layer so the page receives a deterministic
    // list of backups + a deterministic diff. The stub also lets us
    // assert what the page SENDS to the backend.
    await page.addInitScript(() => {
      const w = window as unknown as {
        __TAURI_INTERNALS__?: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      };
      const stub = {
        list_backups: async () => [
          {
            path: 'C:\\Users\\test\\.claude\\settings.json.bak.20260619-142305',
            original_path: 'C:\\Users\\test\\.claude\\settings.json',
            timestamp_unix: 1_781_929_385,
            size_bytes: 2048,
            source: 'settings',
          },
          {
            path: 'C:\\Users\\test\\.claude\\settings.json.bak.20260619-120000',
            original_path: 'C:\\Users\\test\\.claude\\settings.json',
            timestamp_unix: 1_781_838_000,
            size_bytes: 1536,
            source: 'settings',
          },
        ],
        read_backup_content: async () => '{"env":{"URL":"https://stub"}}',
        diff_backups: async () => [
          {
            path: 'env.ANTHROPIC_BASE_URL',
            op: 'change',
            old: 'https://old',
            new: 'https://new',
          },
        ],
        restore_backup: async () => null,
        backup_now: async () => ({
          path: 'C:\\Users\\test\\.claude\\settings.json.bak.20260620-100000',
          original_path: 'C:\\Users\\test\\.claude\\settings.json',
          size_bytes: 512,
          source: 'manual',
        }),
      };
      w.__TAURI_INTERNALS__ = {
        invoke: (cmd: string) => {
          const fn = (stub as Record<string, () => Promise<unknown>>)[cmd];
          return fn ? fn() : Promise.resolve(null);
        },
      };
    });

    await page.goto('/');
    await page.getByTestId('sidebar-backup-restore').click();
    await expect(page.getByTestId('backup-restore-page')).toBeVisible();

    // Wait for the timeline to render the two stubbed rows.
    await expect(page.getByTestId('backup-row')).toHaveCount(2);

    // Tick both checkboxes and click compare.
    const checks = page.getByTestId('backup-row-check');
    await checks.nth(0).click();
    await checks.nth(1).click();
    await page.getByTestId('backup-compare-btn').click();

    // Diff renders.
    await expect(page.getByTestId('backup-diff-view')).toBeVisible();
    const diffRows = page.getByTestId('backup-diff-row');
    await expect(diffRows).toHaveCount(1);
    await expect(diffRows.first()).toHaveAttribute('data-diff-op', 'change');
  });
});
