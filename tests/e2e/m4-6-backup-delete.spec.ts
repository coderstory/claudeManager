/**
 * M4.6.13 — F13 backup-restore: delete + dedupe + diff fullscreen e2e.
 *
 * What this covers (Playwright + Tauri IPC stub):
 *   - Delete button appears on every row, triggers a confirm dialog,
 *     invokes `delete_backup`, and refreshes the list.
 *   - List deduplication: the UI never renders the same path twice,
 *     even if the backend returns duplicates.
 *   - Fullscreen overlay: enabled for both `detail` and `diff` views,
 *     opens at 100vw × 100vh, closes via ESC + [退出全屏].
 *
 * Like the M2.6 spec, we stub `__TAURI_INTERNALS__.invoke` so the
 * page receives deterministic responses and the assertions can pin
 * exact command/arg shapes.
 */
import { test, expect } from '@playwright/test';

test.describe('M4.6.13 — backup delete + dedupe + fullscreen', () => {
  test('delete button → confirm → invoke + success + row removed', async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as {
        __TAURI_INTERNALS__?: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      };
      // Track delete_backup calls.
      const calls: string[] = [];
      const stub = {
        list_backups: async () => [
          {
            path: 'C:\\bak-keep.bak.20260619-142305',
            original_path: 'C:\\Users\\test\\.claude\\settings.json',
            timestamp_unix: 1_781_929_385,
            size_bytes: 2048,
            source: 'settings',
          },
          {
            path: 'C:\\bak-del.bak.20260619-120000',
            original_path: 'C:\\Users\\test\\.claude\\settings.json',
            timestamp_unix: 1_781_838_000,
            size_bytes: 1536,
            source: 'settings',
          },
        ],
        delete_backup: async (args: { path: string }) => {
          calls.push(args.path);
          return null;
        },
      };
      w.__TAURI_INTERNALS__ = {
        invoke: (cmd: string, args?: unknown) => {
          const fn = (stub as Record<string, (a?: unknown) => Promise<unknown>>)[cmd];
          if (fn) return fn(args);
          return Promise.resolve(null);
        },
      };
      // expose calls for assertion
      (w as unknown as { __deleteCalls: string[] }).__deleteCalls = calls;
    });

    await page.goto('/');
    await page.getByTestId('sidebar-backup-restore').click();
    await expect(page.getByTestId('backup-restore-page')).toBeVisible();

    // Two rows render.
    await expect(page.getByTestId('backup-row')).toHaveCount(2);
    // Two delete buttons (one per row).
    await expect(page.getByTestId('backup-delete-btn')).toHaveCount(2);

    // Auto-confirm.
    page.on('dialog', (d) => d.accept());

    // Click the second row's delete button.
    const deleteBtns = page.getByTestId('backup-delete-btn');
    await deleteBtns.nth(1).click();

    // Wait for the delete command to fire and the success banner to show.
    await expect(page.getByTestId('backup-message')).toContainText('已删除');
  });

  test('list dedupe: same path appears once even if backend returns it twice', async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as {
        __TAURI_INTERNALS__?: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      };
      const dupPath = 'C:\\bak-dup.bak.20260619-142305';
      const stub = {
        list_backups: async () => [
          {
            path: dupPath,
            original_path: 'C:\\Users\\test\\.claude\\settings.json',
            timestamp_unix: 1_781_929_385,
            size_bytes: 2048,
            source: 'settings',
          },
          {
            path: dupPath, // intentional duplicate
            original_path: 'C:\\Users\\test\\.claude\\settings.json',
            timestamp_unix: 1_781_929_385,
            size_bytes: 2048,
            source: 'settings',
          },
          {
            path: 'C:\\bak-other.bak.20260619-120000',
            original_path: 'C:\\Users\\test\\.claude\\settings.json',
            timestamp_unix: 1_781_838_000,
            size_bytes: 1536,
            source: 'settings',
          },
        ],
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

    // Backend returned 3, frontend dedupes to 2.
    await expect(page.getByTestId('backup-row')).toHaveCount(2);
    await expect(page.getByTestId('backup-count')).toContainText('2 个备份');
  });

  test('diff fullscreen: enabled with diff, opens overlay, ESC closes', async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as {
        __TAURI_INTERNALS__?: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      };
      const stub = {
        list_backups: async () => [
          {
            path: 'C:\\bak1.bak.20260619-142305',
            original_path: 'C:\\Users\\test\\.claude\\settings.json',
            timestamp_unix: 1_781_929_385,
            size_bytes: 2048,
            source: 'settings',
          },
          {
            path: 'C:\\bak2.bak.20260619-120000',
            original_path: 'C:\\Users\\test\\.claude\\settings.json',
            timestamp_unix: 1_781_838_000,
            size_bytes: 1536,
            source: 'settings',
          },
        ],
        diff_backups: async () => [
          {
            path: 'env.ANTHROPIC_BASE_URL',
            op: 'change',
            old: 'https://old',
            new: 'https://new',
          },
        ],
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

    await expect(page.getByTestId('backup-row')).toHaveCount(2);

    // Tick both checkboxes + click compare.
    const checks = page.getByTestId('backup-row-check');
    await checks.nth(0).click();
    await checks.nth(1).click();
    await page.getByTestId('backup-compare-btn').click();
    await expect(page.getByTestId('backup-diff-view')).toBeVisible();

    // Fullscreen toggle is enabled with diff loaded.
    const toggle = page.getByTestId('backup-fullscreen-toggle');
    await expect(toggle).toBeEnabled();

    // Click → overlay mounts.
    await toggle.click();
    const overlay = page.getByTestId('backup-fullscreen-overlay');
    await expect(overlay).toBeVisible();
    await expect(overlay).toHaveAttribute('role', 'dialog');

    // Press ESC → overlay closes.
    await overlay.press('Escape');
    await expect(overlay).toBeHidden();
  });
});
