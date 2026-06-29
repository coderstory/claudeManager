/**
 * B2 regression — 按天汇总 tab 选日期不查询.
 *
 * Bug B2 (per `.planning/milestones/v3.4-phases/reverify-bugs-2026-06-29.md`
 * §1 + §2 Round 3): user reported that selecting a date range on the
 * "按天汇总" (daily aggregation) tab in the history page did not
 * re-query the data — the list stayed on the unfiltered view no
 * matter what dates were picked.
 *
 * Root cause (file:line evidence — `src/pages/history/index.tsx:132-167`
 * for the new helpers, `:249-256` for the `refresh` daily branch, and
 * `:287-304` for the `loadMore` daily branch):
 *
 *   The `HistoryFilter` shared with `FilterBar` uses `from_ts` /
 *   `to_ts` (unix seconds, matching `usage_history.recorded_at` and
 *   `backup_history.created_at`), but `DailyStatsFilter` (Rust
 *   `services::history::DailyStatsFilter`) expects `from_date` /
 *   `to_date` (the `'YYYY-MM-DD'` string type that
 *   `usage_daily_stats.stat_date` is stored as — TEXT column).
 *
 *   Before commit `34d4bb4`, the page was passing
 *   `{...filter, limit}` straight through to `getDailyStatsHistory`,
 *   so the daily tab sent `from_ts` / `to_ts` over the wire; the
 *   Rust serde layer silently dropped the unknown fields, the
 *   `WHERE stat_date >= ... AND stat_date <= ...` clause never
 *   fired, and the backend returned the entire daily table on
 *   every query. Visually, "选了日期后不刷新" was a no-op.
 *
 * Fix (`34d4bb4 fix(history): convert from_ts/to_ts to
 * from_date/to_date for daily tab`): new pure helpers
 * `tsToIsoDate()` and `toDailyFilter()` in
 * `src/pages/history/index.tsx`. The daily branches in `refresh`
 * and `loadMore` now call `toDailyFilter(filter)` to remap the
 * shared `HistoryFilter` into a `DailyStatsFilter` shape
 * (provider_id + from_date + to_date) before invoking
 * `get_daily_stats_history`.
 *
 * These tests pin the B2 contract so a future regression that
 * (a) leaks `from_ts/to_ts` into the daily payload, (b) drops the
 * date-to-`YYYY-MM-DD` conversion, (c) breaks the `loadMore`
 * cursor merge, or (d) leaks non-DailyStatsFilter fields
 * (`active_root` / `scope` / `trigger_kind` / `after_id`) that
 * would explode under a future `deny_unknown_fields` schema, is
 * caught at unit-test time.
 *
 * Per CLAUDE.md §16.2 — these tests should PASS on master
 * (post `34d4bb4`) and FAIL on the pre-fix state (before
 * `toDailyFilter` existed).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import HistoryPage from '../../pages/history';
import type { DailyStatRow, HistoryStats } from '../../types/history';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

const sampleDailyRow = (
  daysAgo: number,
  overrides: Partial<DailyStatRow> = {},
): DailyStatRow => ({
  provider_id: 'prov-a',
  // 2026-06-30 minus `daysAgo` days, 0-padded.
  stat_date: `2026-06-${(30 - daysAgo).toString().padStart(2, '0')}`,
  tokens_used: 1000 * (daysAgo + 1),
  snapshot_count: 2,
  last_aggregated_recorded_at: 1_715_000_000 - daysAgo * 86_400,
  ...overrides,
});

const sampleStats: HistoryStats = {
  usage_rows: 0,
  backup_rows: 0,
  db_size_bytes: 4096,
  first_recorded_at: 1_715_000_000,
  last_recorded_at: 1_715_000_500,
};

const countDailyCalls = (): number =>
  mockInvoke.mock.calls.filter((c) => c[0] === 'get_daily_stats_history').length;

const lastDailyPayload = (): Record<string, unknown> | undefined => {
  const calls = mockInvoke.mock.calls.filter((c) => c[0] === 'get_daily_stats_history');
  if (calls.length === 0) return undefined;
  return calls[calls.length - 1][1] as Record<string, unknown> | undefined;
};

beforeEach(() => {
  mockInvoke.mockReset();
  window.localStorage.clear();
  // Default: empty daily rows + minimal stats. The page initial-mount
  // fires `get_history_stats` + `get_daily_stats_history` once. Tests
  // that exercise a date change override this and append additional
  // fetch results.
  mockInvoke.mockImplementation(async (cmd: string) => {
    if (cmd === 'get_history_stats') return sampleStats;
    if (cmd === 'get_usage_history_rows') return [];
    if (cmd === 'get_daily_stats_history') return [];
    if (cmd === 'plugin:dialog|save') return null;
    if (cmd === 'export_history')
      return {
        output_path: '',
        format: 'json',
        usage_rows: 0,
        backup_rows: 0,
        file_size_bytes: 0,
      };
    return null;
  });
});

// ---------------------------------------------------------------------------
// §16 Step 5 — Hard evidence: each scenario asserts the exact B2 contract.
// ---------------------------------------------------------------------------

describe('B2 — 按天汇总 tab 选日期不查询', () => {
  it('B2-1: 切到按天汇总 tab → IPC payload 用 from_date/to_date (YYYY-MM-DD 字符串),不是 from_ts/to_ts', async () => {
    render(<HistoryPage />);
    // Switch to daily tab.
    await waitFor(() => {
      expect(screen.getByTestId('tab-daily')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('tab-daily'));
    // Wait for the first daily fetch to land.
    await waitFor(() => {
      expect(countDailyCalls()).toBeGreaterThanOrEqual(1);
    });

    const payload = lastDailyPayload();
    expect(payload).toBeDefined();
    // The shared HistoryFilter is sent as `{ filter: {...} }`.
    const filter = (payload?.filter ?? payload) as Record<string, unknown>;
    // B2 contract: the daily payload MUST use `from_date` / `to_date`,
    // never `from_ts` / `to_ts`. If `from_ts` / `to_ts` leak into the
    // payload the backend will silently drop them and the date range
    // won't apply — that's the bug.
    expect(filter).not.toHaveProperty('from_ts');
    expect(filter).not.toHaveProperty('to_ts');
  });

  it('B2-2: 选起始日期 → list 重新查询,IPC payload 含 from_date 为 YYYY-MM-DD 字符串', async () => {
    render(<HistoryPage />);
    fireEvent.click(screen.getByTestId('tab-daily'));
    await waitFor(() => {
      expect(countDailyCalls()).toBeGreaterThanOrEqual(1);
    });
    const callsBefore = countDailyCalls();

    // Open the "起始日期" DatePicker and pick a specific day.
    const fromLabel = screen.getByTestId('history-filter-from');
    const fromTrigger = within(fromLabel).getByTestId(
      'history-filter-from-trigger',
    );
    fireEvent.click(fromTrigger);
    // The DatePicker calendar shows day buttons; pick day 15. The
    // calendar grid may render the same `date-picker-day-N` for
    // the current month and the trailing days of the previous
    // month — pick the first in-month match (text-content == '15').
    const day15Buttons = await screen.findAllByTestId('date-picker-day-15');
    const day15 = day15Buttons.find((b) => b.textContent === '15') ?? day15Buttons[0];
    fireEvent.click(day15);

    // Picking a date → setFilter({from_ts: ...}) → useEffect[refresh]
    // → another `get_daily_stats_history` call. We must see ≥1
    // additional call after the date pick.
    await waitFor(() => {
      expect(countDailyCalls()).toBeGreaterThan(callsBefore);
    });

    const payload = lastDailyPayload();
    expect(payload).toBeDefined();
    const filter = (payload?.filter ?? payload) as Record<string, unknown>;

    // The critical B2 fix assertion: the wire payload MUST contain
    // `from_date` as a `'YYYY-MM-DD'` string. Pre-fix this would be
    // `from_ts` (a unix-seconds number) which the backend silently
    // dropped.
    expect(typeof filter.from_date).toBe('string');
    expect(filter.from_date as string).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Defensive: no `from_ts` leak.
    expect(filter).not.toHaveProperty('from_ts');
  });

  it('B2-3: 选结束日期 → payload 含 to_date 为 YYYY-MM-DD 字符串', async () => {
    render(<HistoryPage />);
    fireEvent.click(screen.getByTestId('tab-daily'));
    await waitFor(() => {
      expect(countDailyCalls()).toBeGreaterThanOrEqual(1);
    });
    const callsBefore = countDailyCalls();

    const toLabel = screen.getByTestId('history-filter-to');
    const toTrigger = within(toLabel).getByTestId('history-filter-to-trigger');
    fireEvent.click(toTrigger);
    const day20Buttons = await screen.findAllByTestId('date-picker-day-20');
    const day20 = day20Buttons.find((b) => b.textContent === '20') ?? day20Buttons[0];
    fireEvent.click(day20);

    await waitFor(() => {
      expect(countDailyCalls()).toBeGreaterThan(callsBefore);
    });

    const payload = lastDailyPayload();
    expect(payload).toBeDefined();
    const filter = (payload?.filter ?? payload) as Record<string, unknown>;

    expect(typeof filter.to_date).toBe('string');
    expect(filter.to_date as string).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(filter).not.toHaveProperty('to_ts');
  });

  it('B2-4: daily IPC payload 不泄漏 UsageHistoryFilter 独有字段 (active_root / scope / trigger_kind / after_id)', async () => {
    // Pre-`34d4bb4` the page spread the entire `HistoryFilter` into the
    // daily payload, which leaked `active_root` / `scope` /
    // `trigger_kind` / `after_id`. These don't exist on
    // `DailyStatsFilter` and would explode under a future
    // `deny_unknown_fields` schema. Pin that they're stripped.
    render(<HistoryPage />);
    fireEvent.click(screen.getByTestId('tab-daily'));
    await waitFor(() => {
      expect(countDailyCalls()).toBeGreaterThanOrEqual(1);
    });

    const payload = lastDailyPayload();
    expect(payload).toBeDefined();
    const filter = (payload?.filter ?? payload) as Record<string, unknown>;
    expect(filter).not.toHaveProperty('active_root');
    expect(filter).not.toHaveProperty('scope');
    expect(filter).not.toHaveProperty('trigger_kind');
    expect(filter).not.toHaveProperty('after_id');
  });

  it('B2-5: loadMore 走 daily 分支时 cursor 用 from_date (YYYY-MM-DD) 而不是 from_ts', async () => {
    // Mock returns a full page so hasMoreDaily is true and the
    // "加载更多" button appears.
    const PAGE_SIZE = 50;
    const fullPageRows: DailyStatRow[] = Array.from({ length: PAGE_SIZE }, (_, i) =>
      sampleDailyRow(i % 28, { last_aggregated_recorded_at: 1_715_000_000 - i * 86_400 }),
    );
    let callIdx = 0;
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'get_history_stats') return sampleStats;
      // usage tab fires `get_usage_history_rows` on first mount
      // (the page's default tab is 'usage'). Return [] so
      // setUsageRows gets an iterable; returning null would
      // crash the `providerOptions` useMemo on line 216.
      if (cmd === 'get_usage_history_rows') return [];
      if (cmd === 'get_daily_stats_history') {
        callIdx += 1;
        // First call returns a full page; subsequent calls return
        // a partial page so the cursor terminates cleanly.
        return callIdx === 1 ? fullPageRows : [];
      }
      if (cmd === 'plugin:dialog|save') return null;
      if (cmd === 'export_history')
        return { output_path: '', format: 'json', usage_rows: 0, backup_rows: 0, file_size_bytes: 0 };
      return null;
    });

    render(<HistoryPage />);
    fireEvent.click(screen.getByTestId('tab-daily'));
    await waitFor(() => {
      expect(screen.getByTestId('history-load-more')).toBeInTheDocument();
    });
    const callsBefore = countDailyCalls();

    fireEvent.click(screen.getByTestId('history-load-more'));

    await waitFor(() => {
      expect(countDailyCalls()).toBeGreaterThan(callsBefore);
    });

    // The loadMore call's payload must contain `from_date` (cursor
    // in YYYY-MM-DD form), not `from_ts`. Pre-`34d4bb4` this branch
    // did:
    //   from_date: new Date(dailyCursor).toISOString().slice(0, 10)
    // which is ISO date but on a unix-ms number (Date.now() based)
    // — that "worked" only because both numbers happened to be
    // divisible-by-86,400,000. Post-`34d4bb4` we go through
    // `tsToIsoDate(dailyCursor)` which explicitly uses UTC and
    // multiplies seconds by 1000.
    const payload = lastDailyPayload();
    expect(payload).toBeDefined();
    const filter = (payload?.filter ?? payload) as Record<string, unknown>;
    expect(filter).toHaveProperty('from_date');
    expect(typeof filter.from_date).toBe('string');
    expect(filter.from_date as string).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(filter).not.toHaveProperty('from_ts');
  });

  it('B2-6: 连续选不同日期 → 每次都触发新查询 (effect deps 稳定触发 refresh)', async () => {
    // Regression guard: a future "memoization gone wrong" change
    // could make the useEffect deps stabilize on the same filter
    // reference and skip the re-query. Pin that the second date pick
    // does fire a fresh fetch.
    render(<HistoryPage />);
    fireEvent.click(screen.getByTestId('tab-daily'));
    await waitFor(() => {
      expect(countDailyCalls()).toBeGreaterThanOrEqual(1);
    });
    const callsAfterTabSwitch = countDailyCalls();

    // First date pick: open from, pick day 5. The calendar
    // grid is 6 weeks (42 cells) with spillover from previous
    // month — same `date-picker-day-N` testid may appear twice
    // (e.g. May 5 + June 5). Pick the in-month match by text.
    const fromLabel = screen.getByTestId('history-filter-from');
    fireEvent.click(within(fromLabel).getByTestId('history-filter-from-trigger'));
    const day5Buttons = await screen.findAllByTestId('date-picker-day-5');
    const day5 = day5Buttons.find((b) => b.textContent === '5') ?? day5Buttons[0];
    fireEvent.click(day5);
    await waitFor(() => {
      expect(countDailyCalls()).toBeGreaterThan(callsAfterTabSwitch);
    });
    const callsAfterFirstPick = countDailyCalls();

    // Second date pick: change to day 10. The filter object
    // identity changes → useEffect[refresh] re-fires → another
    // IPC call. If the effect's deps array accidentally captures
    // a stable reference (e.g. an empty `{}` from a no-op
    // setState), the count stays the same — and this assertion
    // fails.
    fireEvent.click(within(fromLabel).getByTestId('history-filter-from-trigger'));
    const day10Buttons = await screen.findAllByTestId('date-picker-day-10');
    const day10 = day10Buttons.find((b) => b.textContent === '10') ?? day10Buttons[0];
    fireEvent.click(day10);
    await waitFor(() => {
      expect(countDailyCalls()).toBeGreaterThan(callsAfterFirstPick);
    });

    // Spot-check: latest payload has the latest date.
    const payload = lastDailyPayload();
    const filter = (payload?.filter ?? payload) as Record<string, unknown>;
    expect(filter.from_date as string).toMatch(/^\d{4}-\d{2}-10$/);
  });
});
