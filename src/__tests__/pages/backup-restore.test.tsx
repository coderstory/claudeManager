/**
 * Vitest coverage for the F13 BackupRestorePage (M2.6).
 *
 * What this covers (TDD, CLAUDE.md §5.2):
 *   - Page mounts, calls listBackups, renders the timeline.
 *   - Empty state: no entries → "未发现任何备份文件".
 *   - Selections: 1 selection → 查看完整内容 shows JSON.
 *   - Selections: 2 selections + 比对 → diff renders.
 *   - Restore: confirm + invoke + message.
 *   - Manual backup: invoke + refresh.
 *   - Error: invoke error → InfoBar.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import BackupRestorePage from '../../pages/backup-restore';
import type { BackupEntry, DiffEntry } from '../../types/backup';

const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

const sampleEntry = (
  path: string,
  ts: number,
  source: 'settings' | 'claude' | 'provider' | 'manual' | 'unknown' = 'settings',
  size = 1024,
): BackupEntry => ({
  path,
  original_path: 'C:\\Users\\test\\.claude\\settings.json',
  original_name: 'settings.json',
  timestamp_unix: ts,
  size_bytes: size,
  source,
});

beforeEach(() => {
  mockInvoke.mockReset();
  mockInvoke.mockImplementation(async (cmd: string) => {
    if (cmd === 'list_backups') return [];
    return null;
  });
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

describe('BackupRestorePage — F13 (M2.6)', () => {
  it('renders the page title and toolbar', async () => {
    render(<BackupRestorePage />);
    expect(screen.getByTestId('backup-restore-page')).toBeInTheDocument();
    expect(screen.getByTestId('backup-now-btn')).toBeInTheDocument();
    expect(screen.getByTestId('backup-compare-btn')).toBeInTheDocument();
    expect(screen.getByTestId('backup-refresh-btn')).toBeInTheDocument();
  });

  it('shows the empty state when there are no backups', async () => {
    render(<BackupRestorePage />);
    await waitFor(() => {
      expect(screen.getByTestId('backup-empty')).toBeInTheDocument();
    });
  });

  it('renders a row per backup with ts + source + size', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_backups') {
        return [
          sampleEntry('C:\\bak1.bak.20260619-142305', 1_781_929_385, 'settings', 2048),
          sampleEntry('C:\\bak2.bak.20260619-120000', 1_781_838_000, 'claude', 1536),
        ];
      }
      return null;
    });
    render(<BackupRestorePage />);
    await waitFor(() => {
      const rows = screen.getAllByTestId('backup-row');
      expect(rows.length).toBe(2);
    });
    expect(screen.getByText('2.0 KB')).toBeInTheDocument();
  });

  it('shows error InfoBar when listBackups throws', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_backups') throw new Error('disk fail');
      return null;
    });
    render(<BackupRestorePage />);
    await waitFor(() => {
      expect(screen.getByTestId('backup-message')).toBeInTheDocument();
    });
    expect(screen.getByText(/加载失败.*disk fail/)).toBeInTheDocument();
  });

  it('view button calls read_backup_content and shows the JSON', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_backups') {
        return [sampleEntry('C:\\bak.bak.20260619-142305', 1_781_929_385)];
      }
      if (cmd === 'read_backup_content') return '{"env":{"URL":"x"}}';
      return null;
    });
    render(<BackupRestorePage />);
    await waitFor(() => {
      expect(screen.getByTestId('backup-row')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('backup-view-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('backup-content-view')).toBeInTheDocument();
    });
    expect(screen.getByTestId('backup-content-pre').textContent).toContain('"URL"');
  });

  it('compare button is disabled until 2 are selected', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_backups') {
        return [
          sampleEntry('C:\\bak1.bak.20260619-142305', 1_781_929_385),
          sampleEntry('C:\\bak2.bak.20260619-120000', 1_781_838_000),
        ];
      }
      return null;
    });
    render(<BackupRestorePage />);
    await waitFor(() => {
      expect(screen.getAllByTestId('backup-row').length).toBe(2);
    });
    const compareBtn = screen.getByTestId('backup-compare-btn') as HTMLButtonElement;
    expect(compareBtn.disabled).toBe(true);

    // Tick both checkboxes
    const checks = screen.getAllByTestId('backup-row-check');
    fireEvent.click(checks[0]);
    fireEvent.click(checks[1]);
    expect(compareBtn.disabled).toBe(false);
  });

  it('compare button triggers diff_backups and renders diff rows', async () => {
    const diffEntries: DiffEntry[] = [
      {
        path: 'env.ANTHROPIC_BASE_URL',
        op: 'change',
        old: 'https://old',
        new: 'https://new',
      },
    ];
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_backups') {
        return [
          sampleEntry('C:\\bak1.bak.20260619-142305', 1_781_929_385),
          sampleEntry('C:\\bak2.bak.20260619-120000', 1_781_838_000),
        ];
      }
      if (cmd === 'diff_backups') return diffEntries;
      return null;
    });
    render(<BackupRestorePage />);
    await waitFor(() => {
      expect(screen.getAllByTestId('backup-row').length).toBe(2);
    });
    const checks = screen.getAllByTestId('backup-row-check');
    fireEvent.click(checks[0]);
    fireEvent.click(checks[1]);
    fireEvent.click(screen.getByTestId('backup-compare-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('backup-diff-view')).toBeInTheDocument();
    });
    const rows = screen.getAllByTestId('backup-diff-row');
    expect(rows.length).toBe(1);
    expect((rows[0] as HTMLElement).getAttribute('data-diff-op')).toBe('change');
  });

  it('restore button calls restore_backup after confirm', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_backups') {
        return [sampleEntry('C:\\bak.bak.20260619-142305', 1_781_929_385)];
      }
      if (cmd === 'restore_backup') return null;
      return null;
    });
    render(<BackupRestorePage />);
    await waitFor(() => {
      expect(screen.getByTestId('backup-row')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('backup-restore-btn'));
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('restore_backup', {
        backupPath: 'C:\\bak.bak.20260619-142305',
      });
    });
  });

  it('restore is skipped when user cancels confirm', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_backups') {
        return [sampleEntry('C:\\bak.bak.20260619-142305', 1_781_929_385)];
      }
      return null;
    });
    render(<BackupRestorePage />);
    await waitFor(() => {
      expect(screen.getByTestId('backup-row')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('backup-restore-btn'));
    // Give the (skipped) promise a tick to resolve.
    await new Promise((r) => setTimeout(r, 10));
    const calls = mockInvoke.mock.calls.map((c) => c[0]);
    expect(calls).not.toContain('restore_backup');
  });

  it('backup now button triggers backup_now and refreshes', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_backups') return [];
      if (cmd === 'backup_now') {
        return {
          path: 'C:\\Users\\test\\.claude\\settings.json.bak.20260620-100000',
          original_path: 'C:\\Users\\test\\.claude\\settings.json',
          size_bytes: 512,
          source: 'manual',
        };
      }
      return null;
    });
    render(<BackupRestorePage />);
    await waitFor(() => {
      expect(screen.getByTestId('backup-empty')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('backup-now-btn'));
    await waitFor(() => {
      const calls = mockInvoke.mock.calls.map((c) => c[0]);
      expect(calls).toContain('backup_now');
    });
  });
});
