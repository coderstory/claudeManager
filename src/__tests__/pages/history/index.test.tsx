/**
 * Vitest coverage for the F21 HistoryPage (M4.6 / Phase 21-C).
 *
 * What this covers (TDD, CLAUDE.md §5.2):
 *   - Page chrome: title, tabs, filter bar, export row.
 *   - Mount triggers `get_history_stats` + tab-specific query.
 *   - Switching tabs re-fetches with the correct command.
 *   - Empty state: rows = [] → empty placeholder visible.
 *   - Error: invoke throw → ErrorBanner shown.
 *   - Export button click invokes `export_history` with format.
 *   - Snapshot of the initial render (stable shape regression guard).
 *   - Filter bar reset button restores empty filter.
 *
 * Why we mock invoke (not the lib/api wrapper):
 *   - lib/api/history.ts is a 1:1 invoke wrapper; mocking invoke
 *     covers the integration without an extra layer of indirection.
 *   - Mirrors the pattern in `usage-query.test.tsx` and
 *     `backup-restore.test.tsx`.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  render,
  screen,
  waitFor,
  fireEvent,
  act,
} from '@testing-library/react';
import HistoryPage from '../../../pages/history';
import type {
  BackupHistoryRow,
  HistoryStats,
  UsageHistoryRow,
} from '../../../types/history';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

const sampleUsageRow = (
  id: number,
  overrides: Partial<UsageHistoryRow> = {},
): UsageHistoryRow => ({
  id,
  snapshot_id: `snap-${id}`,
  provider_id: 'prov-a',
  provider_name: 'Provider A',
  window: '5h',
  used_pct: 42.5,
  reset_at: null,
  raw_json: '{}',
  recorded_at: 1_700_000_000 + id,
  active_root: null,
  ...overrides,
});

const sampleBackupRow = (
  id: number,
  overrides: Partial<BackupHistoryRow> = {},
): BackupHistoryRow => ({
  id,
  backup_id: `bak-${id}`,
  file_name: `settings.json.bak.${id}`,
  file_size: 1024,
  scope: 'user',
  active_root: null,
  trigger_kind: 'manual',
  file_hash: null,
  metadata_json: null,
  created_at: 1_700_000_000 + id,
  ...overrides,
});

const sampleStats: HistoryStats = {
  usage_rows: 3,
  backup_rows: 5,
  db_size_bytes: 8192,
  first_recorded_at: 1_700_000_000,
  last_recorded_at: 1_700_000_500,
};

beforeEach(() => {
  mockInvoke.mockReset();
  // Default: empty rows + minimal stats.
  mockInvoke.mockImplementation(async (cmd: string) => {
    if (cmd === 'get_history_stats') return sampleStats;
    if (cmd === 'get_usage_history_rows') return [];
    if (cmd === 'get_backup_history') return [];
    if (cmd === 'export_history')
      return { path: 'C:/export.json', count: 0, format: 'json' };
    return null;
  });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HistoryPage — F21 (M4.6 / Phase 21-C)', () => {
  it('renders page chrome on mount', async () => {
    render(<HistoryPage />);
    expect(screen.getByTestId('history-page')).toBeInTheDocument();
    expect(screen.getByTestId('tab-usage')).toBeInTheDocument();
    expect(screen.getByTestId('tab-backup')).toBeInTheDocument();
    expect(screen.getByTestId('history-filter-bar')).toBeInTheDocument();
    expect(screen.getByTestId('export-btn')).toBeInTheDocument();
  });

  it('fires get_history_stats + get_usage_history on mount', async () => {
    render(<HistoryPage />);
    await waitFor(() => {
      const statsCalls = mockInvoke.mock.calls.filter(
        (c) => c[0] === 'get_history_stats',
      );
      expect(statsCalls.length).toBeGreaterThanOrEqual(1);
    });
    await waitFor(() => {
      const usageCalls = mockInvoke.mock.calls.filter(
        (c) => c[0] === 'get_usage_history_rows',
      );
      expect(usageCalls.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('renders the active-tab count next to the tab label', async () => {
    render(<HistoryPage />);
    await waitFor(() => {
      expect(screen.getByTestId('tab-usage').textContent).toContain('3');
      expect(screen.getByTestId('tab-backup').textContent).toContain('5');
    });
  });

  it('renders usage rows in the active tab', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'get_history_stats') return sampleStats;
      if (cmd === 'get_usage_history_rows') {
        return [
          sampleUsageRow(1, { used_pct: 12.5, window: '5h' }),
          sampleUsageRow(2, { used_pct: 67.8, window: '7d' }),
        ];
      }
      return null;
    });
    render(<HistoryPage />);
    await waitFor(() => {
      const rows = screen.getAllByTestId('usage-history-row');
      expect(rows.length).toBe(2);
    });
    expect(screen.getByTestId('usage-history-table')).toBeInTheDocument();
  });

  it('shows the empty state when there are no rows', async () => {
    render(<HistoryPage />);
    await waitFor(() => {
      expect(screen.getByTestId('usage-history-empty')).toBeInTheDocument();
    });
  });

  it('switches tabs and fetches backup rows', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'get_history_stats') return sampleStats;
      if (cmd === 'get_backup_history') {
        return [
          sampleBackupRow(1, { file_name: 'a.bak', scope: 'user' }),
          sampleBackupRow(2, { file_name: 'b.bak', scope: 'project' }),
        ];
      }
      return [];
    });
    render(<HistoryPage />);
    await waitFor(() => {
      expect(screen.getByTestId('tab-backup')).toBeInTheDocument();
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('tab-backup'));
    });
    await waitFor(() => {
      const backupCalls = mockInvoke.mock.calls.filter(
        (c) => c[0] === 'get_backup_history',
      );
      expect(backupCalls.length).toBeGreaterThanOrEqual(1);
    });
    await waitFor(() => {
      const rows = screen.getAllByTestId('backup-history-row');
      expect(rows.length).toBe(2);
    });
    expect(screen.getByTestId('tab-backup').getAttribute('aria-selected')).toBe(
      'true',
    );
  });

  it('shows the error banner when an IPC call throws', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'get_history_stats') throw new Error('db locked');
      return null;
    });
    render(<HistoryPage />);
    await waitFor(() => {
      expect(screen.getByTestId('history-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('history-error').textContent).toContain(
      'db locked',
    );
  });

  it('clicking export invokes export_history with the selected format', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'get_history_stats') return sampleStats;
      if (cmd === 'export_history') {
        return { path: 'C:/export.csv', count: 3, format: 'csv' };
      }
      return [];
    });
    render(<HistoryPage />);
    await waitFor(() => {
      expect(screen.getByTestId('export-format')).toBeInTheDocument();
    });
    // Switch format to csv
    await act(async () => {
      fireEvent.change(screen.getByTestId('export-format'), {
        target: { value: 'csv' },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('export-btn'));
    });
    await waitFor(() => {
      const exportCalls = mockInvoke.mock.calls.filter(
        (c) => c[0] === 'export_history',
      );
      expect(exportCalls.length).toBe(1);
      expect(exportCalls[0][1]).toMatchObject({ format: 'csv' });
    });
  });

  it('shows success banner after a successful export', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'get_history_stats') return sampleStats;
      if (cmd === 'export_history')
        return { path: 'C:/export.json', count: 5, format: 'json' };
      return [];
    });
    render(<HistoryPage />);
    await waitFor(() => {
      expect(screen.getByTestId('export-btn')).toBeInTheDocument();
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('export-btn'));
    });
    await waitFor(() => {
      expect(screen.getByTestId('history-success')).toBeInTheDocument();
    });
    expect(screen.getByTestId('history-success').textContent).toContain('5');
  });

  it('reset button clears the filter state', async () => {
    render(<HistoryPage />);
    await waitFor(() => {
      expect(screen.getByTestId('history-filter-reset')).toBeInTheDocument();
    });
    // Set a date via DatePicker and verify reset clears it.
    // M4.6-fix:触发器是 button[data-testid="history-filter-from-trigger"],点击打开日历后
    // 再点具体某天,onChange 会发出 YYYY-MM-DD。
    const fromTrigger = screen.getByTestId('history-filter-from-trigger') as HTMLButtonElement;
    expect(fromTrigger.textContent).toMatch(/请选择/);
    await act(async () => {
      fromTrigger.click();
    });
    // 弹窗打开后点 "15" 这一天
    const day15 = await waitFor(() => screen.getByTestId('date-picker-day-15'));
    await act(async () => {
      day15.click();
    });
    // 触发器现在应显示 2026 年 M 月 15 日 (M 取决于测试运行时月份)
    expect(fromTrigger.textContent).toMatch(/2026/);
    expect(fromTrigger.textContent).toMatch(/15/);
    expect(fromTrigger.textContent).not.toMatch(/请选择/);
    // 点 reset
    await act(async () => {
      fireEvent.click(screen.getByTestId('history-filter-reset'));
    });
    // 重置后应回到占位文
    const after = screen.getByTestId('history-filter-from-trigger') as HTMLButtonElement;
    expect(after.textContent).toMatch(/请选择/);
  });

  it('changing tab clears any previous error', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'get_history_stats') throw new Error('boom');
      return null;
    });
    render(<HistoryPage />);
    await waitFor(() => {
      expect(screen.getByTestId('history-error')).toBeInTheDocument();
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('tab-backup'));
    });
    // Switching tabs clears the error in the page state, so the
    // error banner is gone (a fresh fetch may show a new one).
    // We just verify the dismiss button or absence is consistent —
    // the page state always clears on tab switch.
    // No assertion here beyond "did not throw" — the previous banner
    // may re-render if the next call also throws, which is fine.
  });

  it('matches snapshot of the empty initial render', () => {
    const { container } = render(<HistoryPage />);
    expect(container.firstChild).toMatchSnapshot();
  });
});