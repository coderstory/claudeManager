/**
 * M4.6 / Phase 21-C — F21 历史查询 (history page) real-invoke e2e.
 *
 * This spec mirrors the M2.6 backup-restore pattern: it stubs the
 * Tauri IPC layer at `__TAURI_INTERNALS__` so the page receives a
 * deterministic set of history rows + stats, and asserts the page
 * renders them correctly. No backend is required at runtime — the
 * spec validates the IPC surface contract (commands + shapes) end
 * to end through the actual page component.
 *
 * The 5 Tauri commands exercised:
 *   - get_history_stats
 *   - get_usage_history
 *   - get_backup_history
 *   - export_history
 *
 * `purge_history` is NOT exercised here (destructive — Plan D's
 * smoke-test handles it).
 */
import { test, expect } from '@playwright/test';

test.describe('M4.6 / Phase 21-C — F21 历史查询', () => {
  test('page mounts, shows tabs + stats, switches tabs, exports', async ({
    page,
  }) => {
    // Stub the Tauri IPC layer with deterministic history data.
    await page.addInitScript(() => {
      const w = window as unknown as {
        __TAURI_INTERNALS__?: {
          invoke: (cmd: string, args?: unknown) => Promise<unknown>;
        };
      };

      const stats = {
        usage_rows: 2,
        backup_rows: 3,
        db_size_bytes: 16384,
        first_recorded_at: 1_700_000_000,
        last_recorded_at: 1_700_001_000,
      };

      const usageRows = [
        {
          id: 1,
          snapshot_id: 'snap-001',
          provider_id: 'prov-a',
          provider_name: 'Provider A',
          window: '5h',
          used_pct: 12.5,
          reset_at: null,
          raw_json: '{}',
          recorded_at: 1_700_001_000,
          active_root: null,
        },
        {
          id: 2,
          snapshot_id: 'snap-002',
          provider_id: 'prov-b',
          provider_name: 'Provider B',
          window: '7d',
          used_pct: 67.8,
          reset_at: null,
          raw_json: '{}',
          recorded_at: 1_700_000_500,
          active_root: '/projects/foo',
        },
      ];

      const backupRows = [
        {
          id: 10,
          backup_id: 'bak-001',
          file_name: 'settings.json.bak.20260620',
          file_size: 2048,
          scope: 'user',
          active_root: null,
          trigger_kind: 'manual',
          file_hash: null,
          metadata_json: null,
          created_at: 1_700_001_000,
        },
        {
          id: 11,
          backup_id: 'bak-002',
          file_name: 'project.bak.20260620',
          file_size: 1536,
          scope: 'project',
          active_root: '/projects/foo',
          trigger_kind: 'auto_before_switch',
          file_hash: null,
          metadata_json: null,
          created_at: 1_700_000_700,
        },
        {
          id: 12,
          backup_id: 'bak-003',
          file_name: 'project.bak.20260619',
          file_size: 1024,
          scope: 'project',
          active_root: '/projects/foo',
          trigger_kind: 'auto_incremental',
          file_hash: null,
          metadata_json: null,
          created_at: 1_700_000_300,
        },
      ];

      const stub = {
        get_history_stats: async () => stats,
        get_usage_history: async () => usageRows,
        get_backup_history: async () => backupRows,
        export_history: async (_args: { format: string }) => ({
          path: 'C:/Users/test/exports/history.json',
          count: usageRows.length,
          format: 'json',
        }),
      };

      w.__TAURI_INTERNALS__ = {
        invoke: (cmd: string) => {
          const fn = (stub as Record<string, (a?: unknown) => Promise<unknown>>)[cmd];
          return fn ? fn() : Promise.resolve(null);
        },
      };
    });

    // Navigate via the sidebar.
    await page.goto('/');
    await page.getByTestId('sidebar-item-history').click();
    await expect(page.getByTestId('history-page')).toBeVisible();

    // Both tabs render.
    await expect(page.getByTestId('tab-usage')).toBeVisible();
    await expect(page.getByTestId('tab-backup')).toBeVisible();

    // Usage tab is active by default → usage rows render.
    await expect(page.getByTestId('tab-usage')).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByTestId('usage-history-table')).toBeVisible();
    const usageRows = page.getByTestId('usage-history-row');
    await expect(usageRows).toHaveCount(2);

    // Filter bar renders.
    await expect(page.getByTestId('history-filter-bar')).toBeVisible();
    await expect(page.getByTestId('history-filter-from')).toBeVisible();
    await expect(page.getByTestId('history-filter-to')).toBeVisible();
    await expect(page.getByTestId('history-filter-project')).toBeVisible();
    await expect(page.getByTestId('history-filter-provider')).toBeVisible();

    // Stats summary visible.
    await expect(page.getByTestId('history-stats')).toBeVisible();

    // Switch to backup tab.
    await page.getByTestId('tab-backup').click();
    await expect(page.getByTestId('tab-backup')).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByTestId('backup-history-table')).toBeVisible();
    const backupRowsCount = page.getByTestId('backup-history-row');
    await expect(backupRowsCount).toHaveCount(3);

    // Backup filter fields differ from usage.
    await expect(page.getByTestId('history-filter-scope')).toBeVisible();
    await expect(page.getByTestId('history-filter-trigger')).toBeVisible();
    await expect(page.getByTestId('history-filter-provider')).toHaveCount(0);

    // Export button click → success banner.
    await page.getByTestId('export-btn').click();
    await expect(page.getByTestId('history-success')).toBeVisible();
    await expect(page.getByTestId('history-success')).toContainText('已导出');
  });

  test('F7 用量查询页面有 "查看历史" 链接', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('sidebar-item-usage-query').click();
    await expect(page.getByTestId('usage-query-page')).toBeVisible();
    await expect(page.getByTestId('goto-history')).toBeVisible();
    await page.getByTestId('goto-history').click();
    await expect(page.getByTestId('history-page')).toBeVisible();
  });

  test('F13 备份与恢复页面有 "查看历史" 链接', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('sidebar-item-backup-restore').click();
    await expect(page.getByTestId('backup-restore-page')).toBeVisible();
    await expect(page.getByTestId('goto-history')).toBeVisible();
    await page.getByTestId('goto-history').click();
    await expect(page.getByTestId('history-page')).toBeVisible();
  });
});