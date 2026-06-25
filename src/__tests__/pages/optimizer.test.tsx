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

  // M5 #26 — manual-handling findings (auto_apply=false) must NOT be
  // selectable via the checkbox. The user wants to "click into details"
  // (covered by #28) instead of mistakenly including manual items in
  // the apply batch.
  it('manual handling findings have a disabled checkbox', async () => {
    mockInvoke.mockResolvedValue([
      finding('id-manual', 'ORPHAN_PROVIDER', 'warning', false),
      finding('id-auto', 'DEPRECATED_FIELD', 'info', true),
    ]);
    render(<OptimizerPage />);
    const manual = await screen.findByTestId(
      'optimizer-checkbox-id-manual',
    );
    expect((manual as HTMLInputElement).disabled).toBe(true);
    // Auto-apply findings remain enabled (regression guard).
    const auto = await screen.findByTestId('optimizer-checkbox-id-auto');
    expect((auto as HTMLInputElement).disabled).toBe(false);
  });

  it('auto_apply findings keep an enabled checkbox', async () => {
    mockInvoke.mockResolvedValue([
      finding('id-auto', 'DEPRECATED_FIELD', 'info', true),
    ]);
    render(<OptimizerPage />);
    const checkbox = await screen.findByTestId('optimizer-checkbox-id-auto');
    expect((checkbox as HTMLInputElement).disabled).toBe(false);
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

  // -------------------------------------------------------------------------
  // F23 — 导出 markdown 报告 (M2.16)
  // -------------------------------------------------------------------------

  it('renders the export button after scan completes', async () => {
    mockInvoke.mockResolvedValue([]);
    render(<OptimizerPage />);
    await waitFor(() => {
      expect(screen.getByTestId('optimizer-export-btn')).toBeInTheDocument();
    });
  });

  it('export button calls export_optimization_report with findings', async () => {
    const sample = finding('id-A', 'DEPRECATED_FIELD', 'info', true);
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'scan_optimizations') return [sample];
      if (cmd === 'export_optimization_report') return '/tmp/report.md';
      return null;
    });
    render(<OptimizerPage />);
    const exportBtn = await screen.findByTestId('optimizer-export-btn');
    await act(async () => {
      fireEvent.click(exportBtn);
    });
    await waitFor(() => {
      const calls = mockInvoke.mock.calls.filter(
        (c) => c[0] === 'export_optimization_report',
      );
      expect(calls.length).toBe(1);
      const args = calls[0][1] as {
        findings: OptimizationFinding[];
        applyResults: unknown;
        generatedAt: string;
      };
      expect(args.findings).toHaveLength(1);
      expect(args.findings[0].id).toBe('id-A');
      expect(args.applyResults).toBeNull();
      expect(typeof args.generatedAt).toBe('string');
    });
  });

  it('shows success banner with path when export returns a path', async () => {
    const sample = finding('id-A', 'DEPRECATED_FIELD', 'info', true);
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'scan_optimizations') return [sample];
      if (cmd === 'export_optimization_report')
        return 'C:\\Users\\test\\report.md';
      return null;
    });
    render(<OptimizerPage />);
    const exportBtn = await screen.findByTestId('optimizer-export-btn');
    await act(async () => {
      fireEvent.click(exportBtn);
    });
    await waitFor(() => {
      expect(screen.getByTestId('optimizer-export-success')).toBeInTheDocument();
      expect(
        screen.getByTestId('optimizer-export-success').textContent,
      ).toContain('C:\\Users\\test\\report.md');
    });
  });

  it('shows error banner when export rejects', async () => {
    const sample = finding('id-A', 'DEPRECATED_FIELD', 'info', true);
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'scan_optimizations') return [sample];
      if (cmd === 'export_optimization_report')
        throw new Error('disk full');
      return null;
    });
    render(<OptimizerPage />);
    const exportBtn = await screen.findByTestId('optimizer-export-btn');
    await act(async () => {
      fireEvent.click(exportBtn);
    });
    await waitFor(() => {
      expect(screen.getByTestId('optimizer-export-error')).toBeInTheDocument();
      expect(
        screen.getByTestId('optimizer-export-error').textContent,
      ).toContain('disk full');
    });
  });

  it('stays silent when user cancels save dialog (export returns null)', async () => {
    const sample = finding('id-A', 'DEPRECATED_FIELD', 'info', true);
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'scan_optimizations') return [sample];
      if (cmd === 'export_optimization_report') return null;
      return null;
    });
    render(<OptimizerPage />);
    const exportBtn = await screen.findByTestId('optimizer-export-btn');
    await act(async () => {
      fireEvent.click(exportBtn);
    });
    // 取消保存框 → 既不显示成功也不显示错误。
    await waitFor(() => {
      expect(mockInvoke.mock.calls).toContainEqual([
        'export_optimization_report',
        expect.anything(),
      ]);
    });
    expect(screen.queryByTestId('optimizer-export-success')).toBeNull();
    expect(screen.queryByTestId('optimizer-export-error')).toBeNull();
  });

  it('passes applyResults to export when present', async () => {
    const sample = finding('id-A', 'DEPRECATED_FIELD', 'info', true);
    mockInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === 'scan_optimizations') return [sample];
      if (cmd === 'apply_optimizations') {
        const a = args as { findingIds: string[] };
        return a.findingIds.map((id) => ({
          finding_id: id,
          applied: true,
          backup_path: '/tmp/bak',
          error: null,
        })) as ApplyResult[];
      }
      if (cmd === 'export_optimization_report') return '/tmp/report.md';
      return null;
    });
    render(<OptimizerPage />);
    // 先 apply,让 applyResults 进 state。
    const applyBtn = await screen.findByTestId('optimizer-apply-btn');
    await act(async () => {
      fireEvent.click(applyBtn);
    });
    await waitFor(() => {
      expect(screen.getByTestId('optimizer-apply-results')).toBeInTheDocument();
    });
    // 再导出——applyResults 应被传入。
    const exportBtn = screen.getByTestId('optimizer-export-btn');
    await act(async () => {
      fireEvent.click(exportBtn);
    });
    await waitFor(() => {
      const calls = mockInvoke.mock.calls.filter(
        (c) => c[0] === 'export_optimization_report',
      );
      expect(calls.length).toBe(1);
      const args = calls[0][1] as { applyResults: ApplyResult[] };
      expect(Array.isArray(args.applyResults)).toBe(true);
      expect(args.applyResults).toHaveLength(1);
      expect(args.applyResults[0].applied).toBe(true);
    });
  });

  it('export button disabled while loading', async () => {
    // scan 永不 resolve,保持 loading=true。
    mockInvoke.mockImplementation(
      () => new Promise(() => {}),
    );
    render(<OptimizerPage />);
    await waitFor(() => {
      const btn = screen.getByTestId(
        'optimizer-export-btn',
      ) as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
    });
  });
});
