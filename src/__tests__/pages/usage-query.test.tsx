/**
 * Vitest coverage for the F7 UsageQueryPage (M2.7).
 *
 * What this covers (TDD, CLAUDE.md §5.2):
 *   - Initial render: window toggle + refresh button + 3 cards.
 *   - Default window is `5h` and a `get_current_usage` IPC fires.
 *   - Snapshot data renders into the 3 cards (tokens / cost / balance).
 *   - Window toggle: clicking `1w` re-invokes with the right window.
 *   - Refresh button: invokes `refresh_usage`.
 *   - IPC error: shows the InfoBar with the error message.
 *   - Empty snapshot (zero tokens): shows the "暂无数据" hint.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import UsageQueryPage from '../../pages/usage-query';
import { ViewStateProvider } from '../../hooks/useViewState';
import type { UsageSnapshot } from '../../types/usage';

// Wrap every <Page /> render in <ViewStateProvider> — the hook
// throws if called outside the provider (fail-fast contract, see
// src/hooks/useViewState.tsx). Production code mounts the provider
// in main.tsx; tests have to do it themselves.
function wrap({ children }: { children: React.ReactNode }): React.ReactElement {
  return <ViewStateProvider>{children}</ViewStateProvider>;
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

const sampleSnapshot = (
  window: '5h' | '1w' | '1m',
  overrides: Partial<UsageSnapshot> = {},
): UsageSnapshot => ({
  provider_id: 'active-abcdef',
  window,
  tokens_used: 12345,
  timestamp: 1_700_000_000,
  ...overrides,
});

beforeEach(() => {
  mockInvoke.mockReset();
  // Default: 5h snapshot + a single history bucket so the per-day
  // chart renders the `usage-history-chart` testid wrapper (the
  // sparkline regression test relies on this). The original mock
  // returned null for `get_usage_history`, which made
  // `state.history` null and skipped the chart entirely.
  mockInvoke.mockImplementation(async (cmd: string, args?: { window?: string }) => {
    if (cmd === 'get_current_usage' || cmd === 'refresh_usage') {
      return sampleSnapshot((args?.window as '5h' | '1w' | '1m') ?? '5h');
    }
    if (cmd === 'get_usage_history') {
      return [{ date: '2026-06-25', model: 'claude-sonnet-4', tokens: 1234 }];
    }
    // M5 bug #16 — daily stats mock returns a 7-day window so the
    // trend chart can render.
    if (cmd === 'get_daily_stats_history') {
      const today = new Date();
      const rows: Array<{
        provider_id: string;
        stat_date: string;
        tokens_used: number;
        snapshot_count: number;
        last_aggregated_recorded_at: number;
      }> = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(today.getTime() - i * 86400_000);
        rows.push({
          provider_id: 'active-abcdef',
          stat_date: d.toISOString().slice(0, 10),
          tokens_used: 1000 + i * 100,
          snapshot_count: 1,
          last_aggregated_recorded_at: 1_700_000_000,
        });
      }
      return rows;
    }
    return null;
  });
});

describe('UsageQueryPage — F7 (M2.7)', () => {
  it('renders the page title, window toggle, and refresh button', async () => {
    render(<UsageQueryPage />, { wrapper: wrap });
    expect(screen.getByTestId('usage-query-page')).toBeInTheDocument();
    expect(screen.getByTestId('usage-window-5h')).toBeInTheDocument();
    expect(screen.getByTestId('usage-window-1w')).toBeInTheDocument();
    expect(screen.getByTestId('usage-window-1m')).toBeInTheDocument();
    expect(screen.getByTestId('usage-refresh-btn')).toBeInTheDocument();
  });

  it('fires get_current_usage on mount with window=5h', async () => {
    render(<UsageQueryPage />, { wrapper: wrap });
    await waitFor(() => {
      const calls = mockInvoke.mock.calls.filter(
        (c) => c[0] === 'get_current_usage',
      );
      expect(calls.length).toBeGreaterThanOrEqual(1);
      expect(calls[0][1]).toMatchObject({ window: '5h' });
    });
  });

  it('renders snapshot tokens value', async () => {
    render(<UsageQueryPage />, { wrapper: wrap });
    await waitFor(() => {
      expect(screen.getByTestId('usage-tokens-value').textContent).toContain(
        '12,345',
      );
    });
    // M5 bug #15 — 费用 / 余额卡片已删除。
    expect(screen.queryByTestId('usage-cost-value')).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('usage-balance-value'),
    ).not.toBeInTheDocument();
  });

  // M5 bug #16 — trend chart renders one bar per daily stats row.
  it('renders 7-day trend chart with one bar per day', async () => {
    render(<UsageQueryPage />, { wrapper: wrap });
    await waitFor(() => {
      expect(screen.getByTestId('usage-trend-section')).toBeInTheDocument();
    });
    const today = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today.getTime() - i * 86400_000);
      const dateStr = d.toISOString().slice(0, 10);
      expect(
        screen.getByTestId(`usage-trend-bar-${dateStr}`),
      ).toBeInTheDocument();
    }
  });

  it('trend chart shows empty hint when no daily stats', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'get_current_usage') {
        return sampleSnapshot('5h');
      }
      if (cmd === 'get_usage_history') return [];
      if (cmd === 'get_daily_stats_history') return [];
      return null;
    });
    render(<UsageQueryPage />, { wrapper: wrap });
    await waitFor(() => {
      expect(screen.getByTestId('usage-trend-empty')).toBeInTheDocument();
    });
  });

  it('marks the active window with aria-pressed=true', async () => {
    render(<UsageQueryPage />, { wrapper: wrap });
    await waitFor(() => {
      expect(
        screen.getByTestId('usage-window-5h').getAttribute('aria-pressed'),
      ).toBe('true');
    });
    expect(
      screen.getByTestId('usage-window-1w').getAttribute('aria-pressed'),
    ).toBe('false');
    expect(
      screen.getByTestId('usage-window-1m').getAttribute('aria-pressed'),
    ).toBe('false');
  });

  it('clicking a different window re-invokes get_current_usage with the new window', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'get_current_usage') {
        return sampleSnapshot('1w', { tokens_used: 67890 });
      }
      if (cmd === 'refresh_usage') {
        return sampleSnapshot('1w', { tokens_used: 67890 });
      }
      return null;
    });
    render(<UsageQueryPage />, { wrapper: wrap });
    await waitFor(() => {
      expect(screen.getByTestId('usage-window-5h')).toBeInTheDocument();
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('usage-window-1w'));
    });
    await waitFor(() => {
      expect(
        screen.getByTestId('usage-window-1w').getAttribute('aria-pressed'),
      ).toBe('true');
      expect(screen.getByTestId('usage-tokens-value').textContent).toContain(
        '67,890',
      );
    });
    // The 2nd call must be window='1w'.
    const calls = mockInvoke.mock.calls.filter(
      (c) => c[0] === 'get_current_usage',
    );
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(calls[calls.length - 1][1]).toMatchObject({ window: '1w' });
  });

  it('clicking the refresh button invokes refresh_usage', async () => {
    render(<UsageQueryPage />, { wrapper: wrap });
    await waitFor(() => {
      expect(screen.getByTestId('usage-refresh-btn')).toBeInTheDocument();
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('usage-refresh-btn'));
    });
    await waitFor(() => {
      const calls = mockInvoke.mock.calls.filter(
        (c) => c[0] === 'refresh_usage',
      );
      expect(calls.length).toBeGreaterThanOrEqual(1);
      expect(calls[0][1]).toMatchObject({ window: '5h' });
    });
  });

  it('shows the InfoBar on IPC error', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'get_current_usage') {
        throw new Error('查询失败：未知错误');
      }
      return null;
    });
    render(<UsageQueryPage />, { wrapper: wrap });
    await waitFor(() => {
      expect(screen.getByTestId('usage-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('usage-error').textContent).toContain(
      '查询失败：未知错误',
    );
  });

  it('shows the empty hint when snapshot has zero tokens', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'get_current_usage' || cmd === 'refresh_usage') {
        return sampleSnapshot('5h', {
          tokens_used: 0,
        });
      }
      return null;
    });
    render(<UsageQueryPage />, { wrapper: wrap });
    await waitFor(() => {
      expect(screen.getByTestId('usage-empty-hint')).toBeInTheDocument();
    });
    expect(screen.getByTestId('usage-empty-hint').textContent).toContain(
      '*.jsonl',
    );
  });

  it('renders the sparkline svg', async () => {
    render(<UsageQueryPage />, { wrapper: wrap });
    await waitFor(() => {
      expect(screen.getByTestId('usage-history-chart')).toBeInTheDocument();
    });
  });

  it('renders the last-fetched timestamp after a successful fetch', async () => {
    render(<UsageQueryPage />, { wrapper: wrap });
    await waitFor(() => {
      expect(screen.getByTestId('usage-last-fetched')).toBeInTheDocument();
    });
    // 1_700_000_000 → local time string. We don't pin the exact value
    // (locale-dependent) but the prefix is stable.
    const text = screen.getByTestId('usage-last-fetched').textContent ?? '';
    expect(text).toContain('最后更新');
  });
});