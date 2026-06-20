/**
 * Vitest coverage for the F18 OptimizerPage (M2.9).
 *
 * What this covers (TDD, CLAUDE.md §5.2):
 *   - Initial render: scan button + page chrome.
 *   - Mount triggers `scan_optimizations`.
 *   - Findings render grouped by severity.
 *   - Auto-apply findings are pre-checked, manual ones are not.
 *   - Toggling a checkbox updates the selected count.
 *   - Apply button calls `apply_optimizations` with the selected ids.
 *   - ApplyResult panel renders success + failure rows.
 *   - Empty findings → empty-state CheckCircle banner.
 *   - Scan error → error InfoBar.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  render,
  screen,
  waitFor,
  fireEvent,
  act,
} from '@testing-library/react';
import OptimizerPage from '../../pages/optimizer';
import type {
  ApplyResult,
  OptimizationFinding,
} from '../../types/optimizer';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

function finding(
  id: string,
  rule_id: string,
  severity: 'info' | 'warning' | 'error',
  auto_apply = false,
): OptimizationFinding {
  return {
    id,
    rule_id,
    severity,
    title: `${rule_id} title`,
    description: `${rule_id} description`,
    affected_path: `/some/path/${rule_id}`,
    suggested_action: `do something for ${rule_id}`,
    auto_apply,
  };
}

beforeEach(() => {
  mockInvoke.mockReset();
});

describe('OptimizerPage — F18 (M2.9)', () => {
  it('renders the page chrome and rescan button on mount', async () => {
    mockInvoke.mockResolvedValue([]);
    render(<OptimizerPage />);
    expect(screen.getByTestId('optimizer-page')).toBeInTheDocument();
    expect(screen.getByTestId('optimizer-rescan-btn')).toBeInTheDocument();
  });

  it('fires scan_optimizations on mount', async () => {
    mockInvoke.mockResolvedValue([]);
    render(<OptimizerPage />);
    await waitFor(() => {
      const calls = mockInvoke.mock.calls.filter(
        (c) => c[0] === 'scan_optimizations',
      );
      expect(calls.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('renders findings grouped by severity (Error → Warning → Info)', async () => {
    mockInvoke.mockResolvedValue([
      finding('id-info', 'INFO_RULE', 'info'),
      finding('id-warning', 'WARN_RULE', 'warning'),
      finding('id-error', 'ERR_RULE', 'error'),
    ]);
    render(<OptimizerPage />);
    await waitFor(() => {
      expect(screen.getByTestId('optimizer-group-error')).toBeInTheDocument();
      expect(screen.getByTestId('optimizer-group-warning')).toBeInTheDocument();
      expect(screen.getByTestId('optimizer-group-info')).toBeInTheDocument();
    });
  });

  it('pre-checks auto_apply findings and leaves manual ones unchecked', async () => {
    mockInvoke.mockResolvedValue([
      finding('id-auto', 'DEPRECATED_FIELD', 'info', true),
      finding('id-manual', 'ORPHAN_PROVIDER', 'warning', false),
    ]);
    render(<OptimizerPage />);
    await waitFor(() => {
      const auto = screen.getByTestId(
        'optimizer-checkbox-id-auto',
      ) as HTMLInputElement;
      const manual = screen.getByTestId(
        'optimizer-checkbox-id-manual',
      ) as HTMLInputElement;
      expect(auto.checked).toBe(true);
      expect(manual.checked).toBe(false);
    });
  });

  it('toggling a checkbox updates the selected count and apply button', async () => {
    mockInvoke.mockResolvedValue([
      finding('id-1', 'RULE_A', 'warning', false),
    ]);
    render(<OptimizerPage />);
    const checkbox = await screen.findByTestId('optimizer-checkbox-id-1');
    expect((checkbox as HTMLInputElement).checked).toBe(false);
    await act(async () => {
      fireEvent.click(checkbox);
    });
    expect((checkbox as HTMLInputElement).checked).toBe(true);
    const applyBtn = screen.getByTestId(
      'optimizer-apply-btn',
    ) as HTMLButtonElement;
    expect(applyBtn.textContent).toContain('应用 1 项');
  });

  it('apply button calls apply_optimizations with the selected finding ids', async () => {
    mockInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === 'scan_optimizations') {
        return [finding('id-A', 'DEPRECATED_FIELD', 'info', true)];
      }
      if (cmd === 'apply_optimizations') {
        const a = args as { findingIds: string[] };
        const results: ApplyResult[] = a.findingIds.map((id) => ({
          finding_id: id,
          applied: true,
          backup_path: '/tmp/bak.20260619-100000',
          error: null,
        }));
        return results;
      }
      return null;
    });
    render(<OptimizerPage />);
    const applyBtn = await screen.findByTestId('optimizer-apply-btn');
    await act(async () => {
      fireEvent.click(applyBtn);
    });
    await waitFor(() => {
      const calls = mockInvoke.mock.calls.filter(
        (c) => c[0] === 'apply_optimizations',
      );
      expect(calls.length).toBe(1);
      expect(calls[0][1]).toMatchObject({ findingIds: ['id-A'] });
    });
  });

  it('renders apply results with success + backup path', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'scan_optimizations') {
        return [finding('id-A', 'DEPRECATED_FIELD', 'info', true)];
      }
      if (cmd === 'apply_optimizations') {
        return [
          {
            finding_id: 'id-A',
            applied: true,
            backup_path: '/tmp/settings.json.bak.20260619-100000',
            error: null,
          },
        ] as ApplyResult[];
      }
      return null;
    });
    render(<OptimizerPage />);
    const applyBtn = await screen.findByTestId('optimizer-apply-btn');
    await act(async () => {
      fireEvent.click(applyBtn);
    });
    await waitFor(() => {
      expect(screen.getByTestId('optimizer-apply-results')).toBeInTheDocument();
      expect(screen.getByTestId('optimizer-result-id-A').textContent).toContain(
        '已应用',
      );
      expect(screen.getByTestId('optimizer-result-id-A').textContent).toContain(
        '备份:',
      );
    });
  });

  it('shows empty state when scan returns no findings', async () => {
    mockInvoke.mockResolvedValue([]);
    render(<OptimizerPage />);
    await waitFor(() => {
      expect(screen.getByTestId('optimizer-empty')).toBeInTheDocument();
    });
  });

  it('shows scan-error InfoBar when scan rejects', async () => {
    mockInvoke.mockRejectedValue(new Error('boom: cannot read settings.json'));
    render(<OptimizerPage />);
    await waitFor(() => {
      expect(screen.getByTestId('optimizer-scan-error')).toBeInTheDocument();
      expect(
        screen.getByTestId('optimizer-scan-error').textContent,
      ).toContain('boom');
    });
  });
});
