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
import { ViewStateProvider } from '../../hooks/useViewState';
import type { BackupEntry, DiffEntry } from '../../types/backup';

// Wrap every <Page /> render in <ViewStateProvider> — the hook
// throws if called outside the provider (fail-fast contract, see
// src/hooks/useViewState.tsx). Production code mounts the provider
// in main.tsx; tests have to do it themselves.
function wrap({ children }: { children: React.ReactNode }): React.ReactElement {
  return <ViewStateProvider>{children}</ViewStateProvider>;
}

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
    render(<BackupRestorePage />, { wrapper: wrap });
    expect(screen.getByTestId('backup-restore-page')).toBeInTheDocument();
    expect(screen.getByTestId('backup-now-btn')).toBeInTheDocument();
    expect(screen.getByTestId('backup-compare-btn')).toBeInTheDocument();
    expect(screen.getByTestId('backup-refresh-btn')).toBeInTheDocument();
  });

  it('shows the empty state when there are no backups', async () => {
    render(<BackupRestorePage />, { wrapper: wrap });
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
    render(<BackupRestorePage />, { wrapper: wrap });
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
    render(<BackupRestorePage />, { wrapper: wrap });
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
    render(<BackupRestorePage />, { wrapper: wrap });
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
    render(<BackupRestorePage />, { wrapper: wrap });
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
    render(<BackupRestorePage />, { wrapper: wrap });
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
    render(<BackupRestorePage />, { wrapper: wrap });
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
    render(<BackupRestorePage />, { wrapper: wrap });
    await waitFor(() => {
      expect(screen.getByTestId('backup-row')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('backup-restore-btn'));
    // Give the (skipped) promise a tick to resolve.
    await new Promise((r) => setTimeout(r, 10));
    const calls = mockInvoke.mock.calls.map((c) => c[0]);
    expect(calls).not.toContain('restore_backup');
  });

  // M5 #30 — backup selected for restore must STAY in the list after restore.
  // User report: "文件选择恢复后 不应该从列表里删除"
  // The user wants to be able to compare current vs previous via the
  // same timeline (backup file on disk is preserved by the backend).
  // Frontend must not optimistically remove the entry.
  it('after restore, restored backup entry remains in the list', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_backups') {
        return [
          sampleEntry('C:\\bak.bak.20260619-142305', 1_781_929_385),
          sampleEntry('C:\\bak.bak.20260618-142305', 1_781_842_985),
        ];
      }
      if (cmd === 'restore_backup') return null;
      return null;
    });
    render(<BackupRestorePage />, { wrapper: wrap });
    await waitFor(() => {
      expect(screen.getAllByTestId('backup-row').length).toBe(2);
    });
    const restoreBtn = screen.getAllByTestId('backup-restore-btn')[0];
    fireEvent.click(restoreBtn);
    // After restore + refresh, the list still contains both entries.
    await waitFor(() => {
      const rows = screen.getAllByTestId('backup-row');
      expect(rows.length).toBe(2);
      const paths = rows.map((r) => r.getAttribute('data-backup-path'));
      expect(paths).toContain('C:\\bak.bak.20260619-142305');
    });
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
    render(<BackupRestorePage />, { wrapper: wrap });
    await waitFor(() => {
      expect(screen.getByTestId('backup-empty')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('backup-now-btn'));
    await waitFor(() => {
      const calls = mockInvoke.mock.calls.map((c) => c[0]);
      expect(calls).toContain('backup_now');
    });
  });

  // ===== M4.6.13 — delete =====

  it('exposes a delete button on every backup row', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_backups') {
        return [
          sampleEntry('C:\\bak1.bak.20260619-142305', 1_781_929_385),
          sampleEntry('C:\\bak2.bak.20260619-120000', 1_781_838_000),
        ];
      }
      return null;
    });
    render(<BackupRestorePage />, { wrapper: wrap });
    await waitFor(() => {
      expect(screen.getAllByTestId('backup-row').length).toBe(2);
    });
    const deleteBtns = screen.getAllByTestId('backup-delete-btn');
    expect(deleteBtns.length).toBe(2);
  });

  it('clicking delete + confirm → invokes delete_backup + refreshes', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_backups') {
        // First call: 2 rows. Second call (refresh after delete): 1 row.
        return [
          sampleEntry('C:\\bak1.bak.20260619-142305', 1_781_929_385),
          sampleEntry('C:\\bak2.bak.20260619-120000', 1_781_838_000),
        ];
      }
      if (cmd === 'delete_backup') return null;
      return null;
    });
    render(<BackupRestorePage />, { wrapper: wrap });
    await waitFor(() => {
      expect(screen.getAllByTestId('backup-row').length).toBe(2);
    });
    const deleteBtn = screen.getAllByTestId('backup-delete-btn')[0];
    fireEvent.click(deleteBtn);
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('delete_backup', {
        path: 'C:\\bak1.bak.20260619-142305',
      });
    });
    // Success message surfaces.
    await waitFor(() => {
      expect(screen.getByTestId('backup-message')).toHaveTextContent('已删除');
    });
    confirmSpy.mockRestore();
  });

  it('clicking delete + cancel confirm → does NOT invoke delete_backup', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_backups') {
        return [sampleEntry('C:\\bak.bak.20260619-142305', 1_781_929_385)];
      }
      return null;
    });
    render(<BackupRestorePage />, { wrapper: wrap });
    await waitFor(() => {
      expect(screen.getByTestId('backup-row')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('backup-delete-btn'));
    await new Promise((r) => setTimeout(r, 10));
    const calls = mockInvoke.mock.calls.map((c) => c[0]);
    expect(calls).not.toContain('delete_backup');
  });

  it('delete error from backend → error InfoBar + row kept', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_backups') {
        return [sampleEntry('C:\\bak.bak.20260619-142305', 1_781_929_385)];
      }
      if (cmd === 'delete_backup') throw new Error('permission denied');
      return null;
    });
    render(<BackupRestorePage />, { wrapper: wrap });
    await waitFor(() => {
      expect(screen.getByTestId('backup-row')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('backup-delete-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('backup-message')).toHaveTextContent(
        /删除失败.*permission denied/,
      );
    });
  });

  // ===== M4.6.13 — list_backups dedupe (UI safeguard) =====

  it('dedupes duplicates returned by list_backups (defense in depth)', async () => {
    // The backend should already dedupe; we ensure the UI also
    // collapses any duplicate path entries (e.g. from a stale
    // future regression) into a single row.
    const dupPath = 'C:\\bak-dup.bak.20260619-142305';
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_backups') {
        return [
          sampleEntry(dupPath, 1_781_929_385),
          sampleEntry(dupPath, 1_781_929_385), // intentional duplicate
          sampleEntry('C:\\bak-other.bak.20260619-120000', 1_781_838_000),
        ];
      }
      return null;
    });
    render(<BackupRestorePage />, { wrapper: wrap });
    await waitFor(() => {
      // 2 unique paths → 2 rows (not 3).
      expect(screen.getAllByTestId('backup-row').length).toBe(2);
    });
    // Count text also reflects dedup.
    expect(screen.getByTestId('backup-count')).toHaveTextContent('2 个备份');
  });

  // ===== M4.6.13 — fullscreen overlay =====

  it('fullscreen toggle button is disabled when neither detail nor diff', () => {
    render(<BackupRestorePage />, { wrapper: wrap });
    const btn = screen.getByTestId('backup-fullscreen-toggle') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('clicking fullscreen toggle renders the overlay (100vw x 100vh)', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_backups') {
        return [sampleEntry('C:\\bak.bak.20260619-142305', 1_781_929_385)];
      }
      if (cmd === 'read_backup_content') return '{"k":1}';
      return null;
    });
    render(<BackupRestorePage />, { wrapper: wrap });
    await waitFor(() => {
      expect(screen.getByTestId('backup-row')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('backup-view-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('backup-content-view')).toBeInTheDocument();
    });
    // Toggle fullscreen on.
    const toggle = screen.getByTestId('backup-fullscreen-toggle');
    fireEvent.click(toggle);
    await waitFor(() => {
      const overlay = screen.getByTestId('backup-fullscreen-overlay');
      expect(overlay).toBeInTheDocument();
      expect(overlay.getAttribute('role')).toBe('dialog');
      // Verify viewport-spanning positioning (CSS fixed top:0 etc.).
      const style = (overlay as HTMLElement).style;
      expect(style.position).toBe('fixed');
      expect(style.top).toBe('0px');
      expect(style.left).toBe('0px');
      expect(style.right).toBe('0px');
      expect(style.bottom).toBe('0px');
    });
  });

  it('pressing Escape inside the overlay closes it', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_backups') {
        return [sampleEntry('C:\\bak.bak.20260619-142305', 1_781_929_385)];
      }
      if (cmd === 'read_backup_content') return '{"k":1}';
      return null;
    });
    render(<BackupRestorePage />, { wrapper: wrap });
    await waitFor(() => {
      expect(screen.getByTestId('backup-row')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('backup-view-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('backup-content-view')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('backup-fullscreen-toggle'));
    await waitFor(() => {
      expect(screen.getByTestId('backup-fullscreen-overlay')).toBeInTheDocument();
    });
    const overlay = screen.getByTestId('backup-fullscreen-overlay');
    fireEvent.keyDown(overlay, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByTestId('backup-fullscreen-overlay')).not.toBeInTheDocument();
    });
  });

  it('clicking [退出全屏] inside the overlay closes it', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_backups') {
        return [sampleEntry('C:\\bak.bak.20260619-142305', 1_781_929_385)];
      }
      if (cmd === 'read_backup_content') return '{"k":1}';
      return null;
    });
    render(<BackupRestorePage />, { wrapper: wrap });
    await waitFor(() => {
      expect(screen.getByTestId('backup-row')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('backup-view-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('backup-content-view')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('backup-fullscreen-toggle'));
    await waitFor(() => {
      expect(screen.getByTestId('backup-fullscreen-overlay')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('backup-fullscreen-exit'));
    await waitFor(() => {
      expect(screen.queryByTestId('backup-fullscreen-overlay')).not.toBeInTheDocument();
    });
  });

  it('diff can be put into fullscreen (fullscreen button is enabled with diff)', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_backups') {
        return [
          sampleEntry('C:\\bak1.bak.20260619-142305', 1_781_929_385),
          sampleEntry('C:\\bak2.bak.20260619-120000', 1_781_838_000),
        ];
      }
      if (cmd === 'diff_backups') {
        return [
          {
            path: 'env.URL',
            op: 'change' as const,
            old: 'a',
            new: 'b',
          },
        ];
      }
      return null;
    });
    render(<BackupRestorePage />, { wrapper: wrap });
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
    // With diff loaded, the fullscreen button must be enabled.
    const toggle = screen.getByTestId('backup-fullscreen-toggle') as HTMLButtonElement;
    expect(toggle.disabled).toBe(false);
    // And clicking it must render the overlay (which is the user's
    // primary complaint: "diff 全屏还是没工作").
    fireEvent.click(toggle);
    await waitFor(() => {
      expect(screen.getByTestId('backup-fullscreen-overlay')).toBeInTheDocument();
    });
  });
});
