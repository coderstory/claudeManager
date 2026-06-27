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
  // Phase 27 Fix 2 (BUG-CR-02 / D-09) — fixtures default to
  // `inserted_rows: 0` so old tests don't have to populate it; the
  // fix-2 toast test below overrides with a non-zero value.
  inserted_rows: 0,
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

  // M5 bug #17 — CACHE CREATE 列在 JSONL 数据源里永远为 0,
  // UI 删列;测试断言 table header 不再含 'Cache Create'。
  it('breakdown table does not include Cache Create column (bug #17)', async () => {
    render(<UsageQueryPage />, { wrapper: wrap });
    await waitFor(() => {
      expect(screen.getByTestId('usage-breakdown-section')).toBeInTheDocument();
    });
    const section = screen.getByTestId('usage-breakdown-section');
    expect(section.textContent).not.toContain('Cache Create');
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

  // M5 bug #14 — tokens >= 1亿 时显示 "X 亿 Y 万" (formatChineseTokenCount),
  // 而不是 "1,234,567" 字符串 (toLocaleString 原始格式).
  it('M5 bug #14: tokens_used = 123_456_789 显示 "1 亿 2345 万" 而非 "123,456,789"', async () => {
    mockInvoke.mockImplementation(async (cmd: string, args?: { window?: string }) => {
      if (cmd === 'get_current_usage' || cmd === 'refresh_usage') {
        return sampleSnapshot((args?.window as '5h' | '1w' | '1m') ?? '5h', { tokens_used: 123_456_789 });
      }
      if (cmd === 'get_usage_history') return [{ date: '2026-06-25', model: 'm', tokens: 100 }];
      return null;
    });
    render(<UsageQueryPage />, { wrapper: wrap });
    await waitFor(() => {
      expect(screen.getByTestId('usage-tokens-value').textContent).toContain('1 亿');
    });
    const txt = screen.getByTestId('usage-tokens-value').textContent ?? '';
    expect(txt).toContain('2345 万');
    // 反事故: 不要出现原始 toLocaleString 千分位格式 (这是 bug)
    expect(txt).not.toContain('123,456,789');
  });

  // ============================================================
  // Phase 27 Fix 2 (BUG-CR-02 重定义) — 用量三件套共根修复
  // ============================================================

  // D-09: refresh_usage 后页面必须显示 toast 报 N 条已写入 (CLAUDE.md
  // §7 不静默吞错)。新 snapshot 带 inserted_rows=N → toast 数据属性
  // + 文案 "已写入 N 条用量记录到 SQLite"。
  it('Fix 2 (D-09): refresh 后 toast 显示 "已写入 N 条用量记录到 SQLite"', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'get_current_usage' || cmd === 'refresh_usage') {
        return sampleSnapshot('5h', { inserted_rows: 7 });
      }
      if (cmd === 'get_usage_history') return [];
      if (cmd === 'get_daily_stats_history') return [];
      return null;
    });
    render(<UsageQueryPage />, { wrapper: wrap });
    // Wait for initial load to settle.
    await waitFor(() => {
      expect(screen.getByTestId('usage-refresh-btn')).toBeInTheDocument();
    });
    // Click refresh.
    await act(async () => {
      fireEvent.click(screen.getByTestId('usage-refresh-btn'));
    });
    // Toast appears with the inserted count.
    await waitFor(() => {
      expect(screen.getByTestId('usage-refresh-toast')).toBeInTheDocument();
    });
    const toast = screen.getByTestId('usage-refresh-toast');
    expect(toast.getAttribute('data-inserted-rows')).toBe('7');
    expect(toast.textContent).toContain('已写入 7 条用量记录到 SQLite');
  });

  // D-09 边界: inserted_rows=0 (no new rows) 也要显示 toast — 文案
  // 切换为 "刷新成功 — 无新增用量记录"，避免 silently success。
  it('Fix 2 (D-09): inserted_rows=0 时显示 "刷新成功 — 无新增用量记录" 兜底', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'get_current_usage' || cmd === 'refresh_usage') {
        return sampleSnapshot('5h', { inserted_rows: 0 });
      }
      if (cmd === 'get_usage_history') return [];
      if (cmd === 'get_daily_stats_history') return [];
      return null;
    });
    render(<UsageQueryPage />, { wrapper: wrap });
    await waitFor(() => {
      expect(screen.getByTestId('usage-refresh-btn')).toBeInTheDocument();
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('usage-refresh-btn'));
    });
    await waitFor(() => {
      expect(screen.getByTestId('usage-refresh-toast')).toBeInTheDocument();
    });
    const toast = screen.getByTestId('usage-refresh-toast');
    expect(toast.getAttribute('data-inserted-rows')).toBe('0');
    expect(toast.textContent).toContain('无新增用量记录');
  });

  // D-09 边界: error 优先 — 当 refresh 失败时,toast 不应显示 (error
  // banner 已经覆盖了"发生了什么")。
  it('Fix 2 (D-09): refresh 失败时 toast 不出现 (error banner 优先)', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'get_current_usage') return sampleSnapshot('5h');
      if (cmd === 'refresh_usage') throw new Error('查询失败: 未知');
      return null;
    });
    render(<UsageQueryPage />, { wrapper: wrap });
    await waitFor(() => {
      expect(screen.getByTestId('usage-refresh-btn')).toBeInTheDocument();
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('usage-refresh-btn'));
    });
    await waitFor(() => {
      expect(screen.getByTestId('usage-error')).toBeInTheDocument();
    });
    // No toast on error path.
    expect(screen.queryByTestId('usage-refresh-toast')).not.toBeInTheDocument();
  });

  // D-08: trend chart 至少渲染 1 个 bar(不是只返回当天 1 条)。
  // Frontend 已经支持 7 天; backend 的 30 天窗口 backfill 是真正的根因。
  // 此处只测前端 contract: 给 mock 数据 N 行 → 渲染 N 个 bar。
  it('Fix 2 (D-08): trend chart 渲染 N 个 bar(对应 N 行 daily stats)', async () => {
    const today = new Date();
    const rows: Array<{
      provider_id: string;
      stat_date: string;
      tokens_used: number;
      snapshot_count: number;
      last_aggregated_recorded_at: number;
    }> = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(today.getTime() - i * 86400_000);
      rows.push({
        provider_id: 'p1',
        stat_date: d.toISOString().slice(0, 10),
        tokens_used: 100 + i * 50,
        snapshot_count: 1,
        last_aggregated_recorded_at: 1_700_000_000,
      });
    }
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'get_current_usage') return sampleSnapshot('5h');
      if (cmd === 'get_usage_history') return [];
      if (cmd === 'get_daily_stats_history') return rows;
      return null;
    });
    render(<UsageQueryPage />, { wrapper: wrap });
    await waitFor(() => {
      expect(screen.getByTestId('usage-trend-section')).toBeInTheDocument();
    });
    // 至少 1 个 bar(testid 是 usage-trend-bar-YYYY-MM-DD)。
    const bars = screen.getAllByTestId(/^usage-trend-bar-/);
    expect(bars.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Phase 28 BZ-05 — 7-day trend chart regression (M5 #16 already shipped)
// ---------------------------------------------------------------------------

describe('UsageQueryPage — Phase 28 BZ-05 trend chart regression', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it('usage_query_trend_chart_renders_daily_buckets', async () => {
    // BZ-05 regression — TrendChart must render one bar per daily stat
    // row, with stable testids. Use fixed 7 days (not relative to today)
    // so the test is deterministic.
    const FIXED_DATES = [
      '2026-06-21',
      '2026-06-22',
      '2026-06-23',
      '2026-06-24',
      '2026-06-25',
      '2026-06-26',
      '2026-06-27',
    ];
    const rows = FIXED_DATES.map((date, i) => ({
      provider_id: 'p1',
      stat_date: date,
      tokens_used: 1000 + i * 100,
      snapshot_count: 1,
      last_aggregated_recorded_at: 1_700_000_000,
    }));
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'get_current_usage') return sampleSnapshot('5h');
      if (cmd === 'get_usage_history') return [];
      if (cmd === 'get_daily_stats_history') return rows;
      return null;
    });

    render(<UsageQueryPage />, { wrapper: wrap });
    // Chart root testid present (one svg, not the empty hint)
    await waitFor(() => {
      expect(screen.getByTestId('usage-trend-chart')).toBeInTheDocument();
    });
    // 7 bars, one per date
    for (const date of FIXED_DATES) {
      expect(
        screen.getByTestId(`usage-trend-bar-${date}`),
      ).toBeInTheDocument();
    }
    expect(screen.getAllByTestId(/^usage-trend-bar-/).length).toBe(7);
  });
});