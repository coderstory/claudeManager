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
import type { UsageSnapshot } from '../../types/usage';

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
  cost_usd: 1.23,
  balance_usd: 98.77,
  timestamp: 1_700_000_000,
  ...overrides,
});

beforeEach(() => {
  mockInvoke.mockReset();
  // Default: 5h snapshot.
  mockInvoke.mockImplementation(async (cmd: string) => {
    if (cmd === 'get_current_usage' || cmd === 'refresh_usage') {
      return sampleSnapshot('5h');
    }
    return null;
  });
});

describe('UsageQueryPage — F7 (M2.7)', () => {
  it('renders the page title, window toggle, and refresh button', async () => {
    render(<UsageQueryPage />);
    expect(screen.getByTestId('usage-query-page')).toBeInTheDocument();
    expect(screen.getByTestId('usage-window-5h')).toBeInTheDocument();
    expect(screen.getByTestId('usage-window-1w')).toBeInTheDocument();
    expect(screen.getByTestId('usage-window-1m')).toBeInTheDocument();
    expect(screen.getByTestId('usage-refresh-btn')).toBeInTheDocument();
  });

  it('fires get_current_usage on mount with window=5h', async () => {
    render(<UsageQueryPage />);
    await waitFor(() => {
      const calls = mockInvoke.mock.calls.filter(
        (c) => c[0] === 'get_current_usage',
      );
      expect(calls.length).toBeGreaterThanOrEqual(1);
      expect(calls[0][1]).toMatchObject({ window: '5h' });
    });
  });

  it('renders snapshot values into the 3 cards', async () => {
    render(<UsageQueryPage />);
    await waitFor(() => {
      expect(screen.getByTestId('usage-tokens-value').textContent).toContain(
        '12,345',
      );
    });
    expect(screen.getByTestId('usage-cost-value').textContent).toContain(
      '$1.23',
    );
    expect(screen.getByTestId('usage-balance-value').textContent).toContain(
      '$98.77',
    );
  });

  it('marks the active window with aria-pressed=true', async () => {
    render(<UsageQueryPage />);
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
    render(<UsageQueryPage />);
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
    render(<UsageQueryPage />);
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
    render(<UsageQueryPage />);
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
          cost_usd: undefined,
          balance_usd: undefined,
        });
      }
      return null;
    });
    render(<UsageQueryPage />);
    await waitFor(() => {
      expect(screen.getByTestId('usage-empty-hint')).toBeInTheDocument();
    });
    expect(screen.getByTestId('usage-empty-hint').textContent).toContain(
      '*.jsonl',
    );
  });

  it('renders the sparkline svg', async () => {
    render(<UsageQueryPage />);
    await waitFor(() => {
      expect(screen.getByTestId('usage-history-chart')).toBeInTheDocument();
    });
  });

  it('renders the last-fetched timestamp after a successful fetch', async () => {
    render(<UsageQueryPage />);
    await waitFor(() => {
      expect(screen.getByTestId('usage-last-fetched')).toBeInTheDocument();
    });
    // 1_700_000_000 → local time string. We don't pin the exact value
    // (locale-dependent) but the prefix is stable.
    const text = screen.getByTestId('usage-last-fetched').textContent ?? '';
    expect(text).toContain('最后更新');
  });
});