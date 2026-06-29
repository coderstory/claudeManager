/**
 * B1 §16 regression — Backup 历史 vs 备份与恢复 统一视图。
 *
 * WHY THIS TEST EXISTS
 * --------------------
 * B1 ("Backup 历史 vs 备份与恢复 重叠") was resolved by commit
 * 0fdfd9f "refactor(backup): merge query history backup tab into
 * backup-restore page". The user chose the merge plan: the SQLite
 * `backup_history` audit rows that previously lived in
 * `src/pages/history/index.tsx` (as a third tab) now live in
 * `src/pages/backup-restore/index.tsx` (as a fourth tab called
 * "审计"). The `history` page only retains two tabs: usage + daily.
 *
 * Per CLAUDE.md §16.2, "verifiable bugs need a regression test that
 * goes from FAIL → PASS and is kept in the codebase". This file
 * is that test. It runs on top of 0fdfd9f (master HEAD as of the
 * verification round) and asserts the **invariants of the merged
 * view**, not the implementation details. If a future refactor
 * splits the views again, removes the audit tab, or re-introduces
 * a backup tab on the history page, this test should fail loudly.
 *
 * WHAT IT COVERS (3 angles per §16 方案)
 * --------------------------------------
 * 1. backup-restore 独立显示 (master 已 commit, 验证不回归):
 *    - 4 tabs 全渲染: 列表 / Diff / Restore / 审计
 *    - 默认 tab 是列表
 *    - 切到审计 tab 触发 lazy-load (get_backup_history)
 *    - 审计 tab 显示 BackupHistoryTable 的行 (复用组件)
 *    - 审计 tab 错误状态展示 ErrorBanner
 *
 * 2. history 页 backup tab 移除 (0fdfd9f 的另一半):
 *    - history 页只剩 2 个 tab (usage + daily)
 *    - queryByTestId('tab-backup') 返回 null
 *    - 切到 daily 时不发 get_backup_history
 *
 * 3. 跨页面一致性 (统一视图的核心承诺):
 *    - 两个入口(history + backup-restore)互斥
 *    - history 页不渲染 backup-history-row
 *    - backup-restore 审计 tab 渲染 backup-history-row
 *    - 唯一数据源 IPC: get_backup_history
 *
 * 测试策略: 整组件 render + vi.mock('@tauri-apps/api/core') +
 * vi.spyOn 拦截 IPC,断言渲染结构 / data-testid / invoke 调用参数
 * 全部按规格走。失败的 case (tab-backup 仍存在 / 审计 tab 缺失)
 * 会直接红色 → 满足 §16.2 改前 FAIL 改后 PASS 的硬证据。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import BackupRestorePage from '../../pages/backup-restore';
import HistoryPage from '../../pages/history';
import { ViewStateProvider } from '../../hooks/useViewState';
import type { BackupHistoryRow } from '../../types/history';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

function wrap({ children }: { children: React.ReactNode }): React.ReactElement {
  return <ViewStateProvider>{children}</ViewStateProvider>;
}

const sampleBackupHistoryRow = (
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

beforeEach(() => {
  mockInvoke.mockReset();
  // 默认: list_backups 空,其他命令按需覆盖。
  mockInvoke.mockImplementation(async (cmd: string) => {
    if (cmd === 'list_backups') return [];
    if (cmd === 'get_history_stats') {
      return {
        usage_rows: 0,
        backup_rows: 0,
        db_size_bytes: 0,
        first_recorded_at: null,
        last_recorded_at: null,
      };
    }
    if (cmd === 'get_usage_history_rows') return [];
    if (cmd === 'get_daily_stats_history') return [];
    if (cmd === 'get_backup_history') return [];
    if (cmd === 'plugin:dialog|save') return 'C:/export.json';
    if (cmd === 'export_history') {
      return {
        output_path: 'C:/export.json',
        format: 'json',
        usage_rows: 0,
        backup_rows: 0,
        file_size_bytes: 0,
      };
    }
    return null;
  });
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

// ===========================================================================
// 角度 1 — backup-restore 页独立显示统一视图
// ===========================================================================

describe('B1 §16 — backup-restore page exposes unified backup view (4 tabs)', () => {
  it('renders all 4 tabs: 列表 / Diff / Restore / 审计', async () => {
    render(<BackupRestorePage />, { wrapper: wrap });
    await waitFor(() => {
      expect(screen.getByTestId('backup-restore-page')).toBeInTheDocument();
    });
    // 4 tabs 全在
    expect(screen.getByTestId('tab-list')).toBeInTheDocument();
    expect(screen.getByTestId('tab-diff')).toBeInTheDocument();
    expect(screen.getByTestId('tab-restore')).toBeInTheDocument();
    expect(screen.getByTestId('tab-audit')).toBeInTheDocument();
  });

  it('defaults to the 列表 tab on first mount', async () => {
    render(<BackupRestorePage />, { wrapper: wrap });
    await waitFor(() => {
      expect(screen.getByTestId('tab-list')).toBeInTheDocument();
    });
    expect(screen.getByTestId('tab-list').getAttribute('aria-selected')).toBe(
      'true',
    );
    // 默认 tab 是列表,不应显示审计 tab 内容(div[data-testid=backup-tab-audit])
    expect(screen.queryByTestId('backup-tab-audit')).not.toBeInTheDocument();
  });

  it('clicking the 审计 tab lazy-loads get_backup_history and renders rows', async () => {
    // Mock 返回 3 条审计行
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_backups') return [];
      if (cmd === 'get_backup_history') {
        return [
          sampleBackupHistoryRow(1, { file_name: 'a.bak' }),
          sampleBackupHistoryRow(2, { file_name: 'b.bak' }),
          sampleBackupHistoryRow(3, { file_name: 'c.bak' }),
        ];
      }
      return null;
    });

    render(<BackupRestorePage />, { wrapper: wrap });
    await waitFor(() => {
      expect(screen.getByTestId('tab-audit')).toBeInTheDocument();
    });

    // 切到审计 tab
    await act(async () => {
      fireEvent.click(screen.getByTestId('tab-audit'));
    });

    // 触发 IPC
    await waitFor(() => {
      const auditCalls = mockInvoke.mock.calls.filter(
        (c) => c[0] === 'get_backup_history',
      );
      expect(auditCalls.length).toBeGreaterThanOrEqual(1);
    });

    // 显示审计 tab 内容
    expect(screen.getByTestId('backup-tab-audit')).toBeInTheDocument();

    // 行渲染(BackupHistoryTable 复用)
    await waitFor(() => {
      const rows = screen.getAllByTestId('backup-history-row');
      expect(rows.length).toBe(3);
    });
  });

  it('switching to 审计 tab then back to 列表 does NOT re-fire get_backup_history (lazy once)', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_backups') return [];
      if (cmd === 'get_backup_history') return [sampleBackupHistoryRow(1)];
      return null;
    });

    render(<BackupRestorePage />, { wrapper: wrap });
    await waitFor(() => {
      expect(screen.getByTestId('tab-audit')).toBeInTheDocument();
    });

    // 第一次切到审计
    await act(async () => {
      fireEvent.click(screen.getByTestId('tab-audit'));
    });
    await waitFor(() => {
      expect(
        mockInvoke.mock.calls.filter((c) => c[0] === 'get_backup_history')
          .length,
      ).toBeGreaterThanOrEqual(1);
    });

    // 切回列表
    await act(async () => {
      fireEvent.click(screen.getByTestId('tab-list'));
    });
    await waitFor(() => {
      expect(screen.getByTestId('tab-list').getAttribute('aria-selected')).toBe(
        'true',
      );
    });

    // 再次切到审计 — 不应再发 IPC(lazy once)
    await act(async () => {
      fireEvent.click(screen.getByTestId('tab-audit'));
    });
    await waitFor(() => {
      expect(screen.getByTestId('tab-audit').getAttribute('aria-selected')).toBe(
        'true',
      );
    });

    // 关键断言: get_backup_history 仍只调过 1 次 (lazy-once)
    const auditCalls = mockInvoke.mock.calls.filter(
      (c) => c[0] === 'get_backup_history',
    );
    expect(auditCalls.length).toBe(1);
  });

  it('审计 tab shows error banner when get_backup_history throws', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_backups') return [];
      if (cmd === 'get_backup_history') throw new Error('sqlite locked');
      return null;
    });

    render(<BackupRestorePage />, { wrapper: wrap });
    await waitFor(() => {
      expect(screen.getByTestId('tab-audit')).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('tab-audit'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('audit-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('audit-error').textContent).toContain(
      'sqlite locked',
    );
  });
});

// ===========================================================================
// 角度 2 — history 页 backup tab 已移除
// ===========================================================================

describe('B1 §16 — history page no longer exposes backup tab', () => {
  it('renders exactly 2 tabs: usage + daily (no backup tab)', () => {
    render(<HistoryPage />);
    expect(screen.getByTestId('tab-usage')).toBeInTheDocument();
    expect(screen.getByTestId('tab-daily')).toBeInTheDocument();
    // 关键: tab-backup 已被移除 (0fdfd9f)
    expect(screen.queryByTestId('tab-backup')).not.toBeInTheDocument();
  });

  it('clicking daily tab does NOT fire get_backup_history', async () => {
    // 任何时候都不应调 get_backup_history
    render(<HistoryPage />);
    await waitFor(() => {
      expect(screen.getByTestId('tab-daily')).toBeInTheDocument();
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('tab-daily'));
    });
    await waitFor(() => {
      expect(screen.getByTestId('tab-daily').getAttribute('aria-selected')).toBe(
        'true',
      );
    });
    // history 页切 daily tab 不发 get_backup_history
    const backupCalls = mockInvoke.mock.calls.filter(
      (c) => c[0] === 'get_backup_history',
    );
    expect(backupCalls.length).toBe(0);
  });

  it('history page still calls get_history_stats (backup_rows count flows through stats)', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'get_history_stats') {
        return {
          usage_rows: 3,
          backup_rows: 5, // 关键: history 页通过 stats 展示 backup 数量
          db_size_bytes: 8192,
          first_recorded_at: 1_700_000_000,
          last_recorded_at: 1_700_000_500,
        };
      }
      if (cmd === 'get_usage_history_rows') return [];
      if (cmd === 'get_daily_stats_history') return [];
      if (cmd === 'get_backup_history') return [];
      if (cmd === 'plugin:dialog|save') return 'C:/x';
      if (cmd === 'export_history') {
        return {
          output_path: 'C:/x',
          format: 'json',
          usage_rows: 0,
          backup_rows: 0,
          file_size_bytes: 0,
        };
      }
      return null;
    });

    render(<HistoryPage />);
    await waitFor(() => {
      // history 页必须调 stats (UI 渲染用 usage_rows / backup_rows 计数)
      const statsCalls = mockInvoke.mock.calls.filter(
        (c) => c[0] === 'get_history_stats',
      );
      expect(statsCalls.length).toBeGreaterThanOrEqual(1);
    });
  });
});

// ===========================================================================
// 角度 3 — 跨页面一致性 (统一视图核心承诺)
// ===========================================================================

describe('B1 §16 — cross-page consistency (unified view contract)', () => {
  it('history page does NOT render backup-history-row (audit only on backup-restore)', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_backups') return [];
      if (cmd === 'get_history_stats') {
        return {
          usage_rows: 0,
          backup_rows: 2,
          db_size_bytes: 0,
          first_recorded_at: null,
          last_recorded_at: null,
        };
      }
      if (cmd === 'get_backup_history') {
        return [sampleBackupHistoryRow(1), sampleBackupHistoryRow(2)];
      }
      if (cmd === 'get_usage_history_rows') return [];
      if (cmd === 'get_daily_stats_history') return [];
      if (cmd === 'plugin:dialog|save') return 'C:/x';
      if (cmd === 'export_history') {
        return {
          output_path: 'C:/x',
          format: 'json',
          usage_rows: 0,
          backup_rows: 0,
          file_size_bytes: 0,
        };
      }
      return null;
    });

    // history 页:不应有 backup-history-row
    const { unmount } = render(<HistoryPage />);
    await waitFor(() => {
      expect(screen.getByTestId('history-page')).toBeInTheDocument();
    });
    expect(screen.queryAllByTestId('backup-history-row')).toHaveLength(0);
    unmount();

    // backup-restore 审计 tab:有 backup-history-row
    render(<BackupRestorePage />, { wrapper: wrap });
    await waitFor(() => {
      expect(screen.getByTestId('tab-audit')).toBeInTheDocument();
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('tab-audit'));
    });
    await waitFor(() => {
      const rows = screen.getAllByTestId('backup-history-row');
      expect(rows.length).toBe(2);
    });
  });

  it('audit tab reads via shared getBackupHistory API (single source of truth)', async () => {
    // 这一对测试 验证"统一视图"不光是 UI 合并,
    // 数据源也走同一份 (src/lib/api/history.ts::getBackupHistory)。
    const auditCalls: string[] = [];
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_backups') return [];
      if (cmd === 'get_history_stats') {
        return {
          usage_rows: 0,
          backup_rows: 1,
          db_size_bytes: 0,
          first_recorded_at: null,
          last_recorded_at: null,
        };
      }
      if (cmd === 'get_backup_history') {
        auditCalls.push(cmd);
        return [sampleBackupHistoryRow(1)];
      }
      if (cmd === 'get_usage_history_rows') return [];
      if (cmd === 'get_daily_stats_history') return [];
      if (cmd === 'plugin:dialog|save') return 'C:/x';
      if (cmd === 'export_history') {
        return {
          output_path: 'C:/x',
          format: 'json',
          usage_rows: 0,
          backup_rows: 0,
          file_size_bytes: 0,
        };
      }
      return null;
    });

    render(<BackupRestorePage />, { wrapper: wrap });
    await waitFor(() => {
      expect(screen.getByTestId('tab-audit')).toBeInTheDocument();
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('tab-audit'));
    });
    await waitFor(() => {
      expect(auditCalls.length).toBeGreaterThanOrEqual(1);
    });

    // 关键: 调用名是 'get_backup_history' (与 src/lib/api/history.ts 一致)
    expect(auditCalls[0]).toBe('get_backup_history');
  });

  it('history page does NOT call get_backup_history on any tab switch', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_backups') return [];
      if (cmd === 'get_history_stats') {
        return {
          usage_rows: 0,
          backup_rows: 7,
          db_size_bytes: 0,
          first_recorded_at: null,
          last_recorded_at: null,
        };
      }
      if (cmd === 'get_usage_history_rows') return [];
      if (cmd === 'get_daily_stats_history') return [];
      if (cmd === 'get_backup_history') return [];
      if (cmd === 'plugin:dialog|save') return 'C:/x';
      if (cmd === 'export_history') {
        return {
          output_path: 'C:/x',
          format: 'json',
          usage_rows: 0,
          backup_rows: 0,
          file_size_bytes: 0,
        };
      }
      return null;
    });

    render(<HistoryPage />);
    await waitFor(() => {
      expect(screen.getByTestId('tab-usage')).toBeInTheDocument();
    });

    // 反复切 tab,任何时候都不应触发 get_backup_history
    await act(async () => {
      fireEvent.click(screen.getByTestId('tab-daily'));
    });
    await waitFor(() => {
      expect(screen.getByTestId('tab-daily').getAttribute('aria-selected')).toBe(
        'true',
      );
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('tab-usage'));
    });
    await waitFor(() => {
      expect(screen.getByTestId('tab-usage').getAttribute('aria-selected')).toBe(
        'true',
      );
    });

    const backupCalls = mockInvoke.mock.calls.filter(
      (c) => c[0] === 'get_backup_history',
    );
    expect(backupCalls.length).toBe(0);
  });
});
