/**
 * Vitest coverage for the F18 OptimizerPage (M2.9 + M3.3 Phase 4).
 *
 * What this covers (TDD, CLAUDE.md §5.2):
 *   - Initial render: scan button + page chrome.
 *   - Mount triggers `scan_optimizations`.
 *   - Findings render grouped by severity.
 *   - Per-row status icon (M3.3 SC #2): green-check / red-x / pending / manual.
 *   - Per-row Fix button (M3.3 SC #2/#3): invokes `apply_rule_fix(ruleId)`,
 *     flips status icon to "applied" on success, disables button.
 *   - Batch "Apply All Auto-Fix" button calls `apply_optimizations` with
 *     the auto-apply finding ids only.
 *   - ApplyResult panel renders success + failure rows after batch apply.
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
import { ViewStateProvider } from '../../hooks/useViewState';
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
  sessionStorage.clear();
});

// Wrap every <Page /> render in <ViewStateProvider> — the hook throws
// if called outside the provider. M5 #28 introduced useViewState() in
// OptimizerPage for the "open in JSON editor" action, so every test
// that mounts the page needs the provider.
function wrap({ children }: { children: React.ReactNode }): React.ReactElement {
  return <ViewStateProvider>{children}</ViewStateProvider>;
}

describe('OptimizerPage — F18 (M2.9)', () => {
  it('renders the page chrome and rescan button on mount', async () => {
    mockInvoke.mockResolvedValue([]);
    render(<OptimizerPage />, { wrapper: wrap });
    expect(screen.getByTestId('optimizer-page')).toBeInTheDocument();
    expect(screen.getByTestId('optimizer-rescan-btn')).toBeInTheDocument();
  });

  it('fires scan_optimizations on mount', async () => {
    mockInvoke.mockResolvedValue([]);
    render(<OptimizerPage />, { wrapper: wrap });
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
    render(<OptimizerPage />, { wrapper: wrap });
    await waitFor(() => {
      expect(screen.getByTestId('optimizer-group-error')).toBeInTheDocument();
      expect(screen.getByTestId('optimizer-group-warning')).toBeInTheDocument();
      expect(screen.getByTestId('optimizer-group-info')).toBeInTheDocument();
    });
  });

  // M3.3 — auto_apply findings get a Fix button + status icon "pending",
  // manual findings get the "在 JSON 编辑器中打开" link instead.
  it('auto_apply findings render a Fix button + status icon pending', async () => {
    mockInvoke.mockResolvedValue([
      finding('id-auto', 'DEPRECATED_FIELD', 'info', true),
      finding('id-manual', 'ORPHAN_PROVIDER', 'warning', false),
    ]);
    render(<OptimizerPage />, { wrapper: wrap });
    await waitFor(() => {
      const autoFixBtn = screen.getByTestId('optimizer-fix-btn-id-auto');
      expect(autoFixBtn).toBeInTheDocument();
      expect((autoFixBtn as HTMLButtonElement).disabled).toBe(false);
      // 状态图标 = pending(尚未处理)
      const autoStatus = screen.getByTestId('optimizer-status-id-auto');
      expect(autoStatus.querySelector('[data-status="pending"]')).toBeTruthy();
    });
  });

  it('manual findings render an "open in JSON editor" link + status icon manual', async () => {
    mockInvoke.mockResolvedValue([
      finding('id-manual', 'ORPHAN_PROVIDER', 'warning', false),
    ]);
    render(<OptimizerPage />, { wrapper: wrap });
    const openBtn = await screen.findByTestId(
      'optimizer-open-json-editor-id-manual',
    );
    expect(openBtn).toBeInTheDocument();
    // 手动规则的 status = manual
    const status = screen.getByTestId('optimizer-status-id-manual');
    expect(status.querySelector('[data-status="manual"]')).toBeTruthy();
  });

  // M3.3 SC #2/#3 — per-row Fix button 点击后调用 apply_rule_fix,
  // 成功后状态翻成 "applied" + 按钮禁用。
  it('per-row Fix button invokes apply_rule_fix and flips status to applied', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'scan_optimizations') {
        return [finding('id-A', 'DEPRECATED_FIELD', 'info', true)];
      }
      if (cmd === 'apply_rule_fix') {
        return [
          {
            finding_id: 'id-A',
            applied: true,
            backup_path: '/tmp/settings.json.bak.20260626-100000',
            error: null,
          },
        ] as ApplyResult[];
      }
      return null;
    });
    render(<OptimizerPage />, { wrapper: wrap });
    const fixBtn = await screen.findByTestId('optimizer-fix-btn-id-A');
    expect((fixBtn as HTMLButtonElement).disabled).toBe(false);
    await act(async () => {
      fireEvent.click(fixBtn);
    });
    // 验证 invoke('apply_rule_fix', { ruleId: 'DEPRECATED_FIELD' })
    await waitFor(() => {
      const calls = mockInvoke.mock.calls.filter(
        (c) => c[0] === 'apply_rule_fix',
      );
      expect(calls.length).toBeGreaterThanOrEqual(1);
      expect(calls[0][1]).toMatchObject({ ruleId: 'DEPRECATED_FIELD' });
    });
    // 状态翻到 applied + 按钮禁用
    await waitFor(() => {
      const status = screen.getByTestId('optimizer-status-id-A');
      expect(status.querySelector('[data-status="applied"]')).toBeTruthy();
      const btn = screen.getByTestId('optimizer-fix-btn-id-A') as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
    });
  });

  // 旧 M2.9 行为 — 验证 batch "Apply All Auto-Fix" 按钮的"显示文案 + 数量"。
  it('renders "Apply All Auto-Fix" batch button with auto-fix count', async () => {
    mockInvoke.mockResolvedValue([
      finding('id-A', 'DEPRECATED_FIELD', 'info', true),
      finding('id-B', 'ORPHAN_PROVIDER', 'warning', false),
    ]);
    render(<OptimizerPage />, { wrapper: wrap });
    const btn = await screen.findByTestId('optimizer-apply-all-btn');
    expect(btn.textContent).toContain('1'); // auto-fix count
  });

  // M5 #28 — manual-handling findings must expose a "open in JSON
  // editor" action. Clicking the action must:
  //   1. Write the finding's affected_path into sessionStorage under
  //      the documented key (so the JSON editor can pick it up).
  //   2. Trigger a navigation to the json-editor view via the
  //      ViewStateContext.
  it('manual findings expose a [在 JSON 编辑器中打开] action that navigates', async () => {
    mockInvoke.mockResolvedValue([
      finding('id-manual', 'ORPHAN_PROVIDER', 'warning', false),
    ]);
    sessionStorage.clear();
    render(<OptimizerPage />, { wrapper: wrap });
    const openBtn = await screen.findByTestId(
      'optimizer-open-json-editor-id-manual',
    );
    await act(async () => {
      fireEvent.click(openBtn);
    });
    // Path written to sessionStorage for the editor to consume.
    expect(sessionStorage.getItem('ccm.openFilePath')).toBe(
      '/some/path/ORPHAN_PROVIDER',
    );
  });

  // M3.3 — batch "Apply All Auto-Fix" 按钮调用 apply_optimizations,
  // 把所有 auto_apply finding 的 id 传过去。
  it('Apply All Auto-Fix button calls apply_optimizations with auto finding ids', async () => {
    mockInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === 'scan_optimizations') {
        return [
          finding('id-A', 'DEPRECATED_FIELD', 'info', true),
          finding('id-B', 'ORPHAN_PROVIDER', 'warning', false),
        ];
      }
      if (cmd === 'apply_optimizations') {
        const a = args as { findingIds: string[] };
        const results: ApplyResult[] = a.findingIds.map((id) => ({
          finding_id: id,
          applied: true,
          backup_path: '/tmp/bak.20260626-100000',
          error: null,
        }));
        return results;
      }
      return null;
    });
    render(<OptimizerPage />, { wrapper: wrap });
    const applyBtn = await screen.findByTestId('optimizer-apply-all-btn');
    await act(async () => {
      fireEvent.click(applyBtn);
    });
    await waitFor(() => {
      const calls = mockInvoke.mock.calls.filter(
        (c) => c[0] === 'apply_optimizations',
      );
      expect(calls.length).toBe(1);
      // 只传 auto_apply 的 id — manual ORPHAN_PROVIDER 应被排除
      expect(calls[0][1]).toMatchObject({ findingIds: ['id-A'] });
    });
  });

  // M3.3 — 批量 apply 成功后,ApplyResultsPanel 渲染。
  it('renders apply results panel with success + backup path after batch apply', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'scan_optimizations') {
        return [finding('id-A', 'DEPRECATED_FIELD', 'info', true)];
      }
      if (cmd === 'apply_optimizations') {
        return [
          {
            finding_id: 'id-A',
            applied: true,
            backup_path: '/tmp/settings.json.bak.20260626-100000',
            error: null,
          },
        ] as ApplyResult[];
      }
      return null;
    });
    render(<OptimizerPage />, { wrapper: wrap });
    const applyBtn = await screen.findByTestId('optimizer-apply-all-btn');
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
    render(<OptimizerPage />, { wrapper: wrap });
    await waitFor(() => {
      expect(screen.getByTestId('optimizer-empty')).toBeInTheDocument();
    });
  });

  it('shows scan-error InfoBar when scan rejects', async () => {
    mockInvoke.mockRejectedValue(new Error('boom: cannot read settings.json'));
    render(<OptimizerPage />, { wrapper: wrap });
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
    render(<OptimizerPage />, { wrapper: wrap });
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
    render(<OptimizerPage />, { wrapper: wrap });
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
    render(<OptimizerPage />, { wrapper: wrap });
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
    render(<OptimizerPage />, { wrapper: wrap });
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
    render(<OptimizerPage />, { wrapper: wrap });
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
    render(<OptimizerPage />, { wrapper: wrap });
    // 先 batch apply (M3.3 "Apply All Auto-Fix" 按钮),让 applyAllResults 进 state。
    const applyBtn = await screen.findByTestId('optimizer-apply-all-btn');
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
    render(<OptimizerPage />, { wrapper: wrap });
    await waitFor(() => {
      const btn = screen.getByTestId(
        'optimizer-export-btn',
      ) as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
    });
  });

  // M5 bug #20 — 重新扫描按钮文字 "重新扫描" 不能换行.
  // 验证 inline style 含 white-space: nowrap + min-width.
  it('M5 bug #20: 重新扫描按钮有 nowrap + min-width 防止文字换行', () => {
    mockInvoke.mockResolvedValue([]);
    render(<OptimizerPage />, { wrapper: wrap });
    const btn = screen.getByTestId('optimizer-rescan-btn') as HTMLButtonElement;
    expect(btn.style.whiteSpace).toBe('nowrap');
    // min-width: 110px (vs 之前 0/auto, 装不下 "重新扫描" 4 字)
    expect(btn.style.minWidth).toBe('110px');
    // flexShrink: 0 防止在窄容器被压缩
    expect(btn.style.flexShrink).toBe('0');
  });
});
