/**
 * A8 regression — UsageHistoryTable column name + project label resolution.
 *
 * Bug A8 (per `.planning/milestones/v3.4-phases/reverify-bugs-2026-06-29.md`
 * §1 + §2 Round 3): user reported two cosmetic issues on the history page:
 *   1. The "used %" column header was labelled '使用率' (literally "usage
 *      rate"). User wanted it re-labelled 'token 消耗量' (literally "token
 *      consumption") to better describe what the column shows.
 *   2. The "项目" (project) column rendered the raw `active_root`
 *      filesystem path (e.g. `/Users/foo/code/winui3`), which is noisy and
 *      not what users expect from a "project name" column. User wanted the
 *      project display name when available.
 *
 * Original fix: commit `631b7bd fix(history): rename '使用率' to 'token
 * 消耗量' + show project name`. Two source files:
 *   - `src/pages/history/UsageHistoryTable.tsx`: header text changed, new
 *     `resolveProjectLabel` helper for the project cell.
 *   - `src/pages/history/index.tsx`: derives a `projectList` memo and
 *     passes it as the new `projects` prop on `UsageHistoryTable`.
 *
 * These tests pin both behaviours so any future regression that drops the
 * new label or falls back to raw paths is caught at unit-test time.
 *
 * Per CLAUDE.md §16.2 — these tests should PASS on master (post `631b7bd`)
 * and FAIL on the pre-fix state.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import HistoryPage from '../../pages/history';
import type { UsageHistoryRow } from '../../types/history';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

const sampleUsageRow = (
  id: number,
  overrides: Partial<UsageHistoryRow> = {},
): UsageHistoryRow => ({
  id,
  snapshot_id: `snap-${id}`,
  provider_id: 'prov-a',
  provider_name: 'Provider A',
  window: '5h',
  used_pct: 42.5,
  reset_at: null,
  raw_json: '{}',
  recorded_at: 1_700_000_000 + id,
  active_root: null,
  ...overrides,
});

const sampleStats = {
  usage_rows: 2,
  backup_rows: 0,
  db_size_bytes: 4096,
  first_recorded_at: 1_700_000_000,
  last_recorded_at: 1_700_000_500,
};

beforeEach(() => {
  mockInvoke.mockReset();
  window.localStorage.clear();
  // Default mock: minimal stats + empty rows. Individual tests override.
  mockInvoke.mockImplementation(async (cmd: string) => {
    if (cmd === 'get_history_stats') return sampleStats;
    if (cmd === 'get_usage_history_rows') return [];
    if (cmd === 'get_daily_stats_history') return [];
    return null;
  });
});

// ---------------------------------------------------------------------------
// §16 Step 5 — Hard evidence: each scenario asserts the exact A8 contract.
// ---------------------------------------------------------------------------

describe('A8 — UsageHistoryTable 列名 + 项目名解析', () => {
  it('A8-1: 表头列名是 "token 消耗量"(不再是 "使用率")', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'get_history_stats') return sampleStats;
      if (cmd === 'get_usage_history_rows') {
        return [
          sampleUsageRow(1, { used_pct: 25.0 }),
          sampleUsageRow(2, { used_pct: 75.5 }),
        ];
      }
      return null;
    });
    render(<HistoryPage />);
    await waitFor(() => {
      expect(screen.getByTestId('usage-history-table')).toBeInTheDocument();
    });
    // 1. New label MUST be present (the user-requested text).
    expect(screen.getByText('token 消耗量')).toBeInTheDocument();
    // 2. Old label MUST NOT be present anywhere in the table (regression
    //    guard: if someone reverts 631b7bd and goes back to '使用率',
    //    this assertion immediately fails).
    const table = screen.getByTestId('usage-history-table');
    expect(within(table).queryByText('使用率')).not.toBeInTheDocument();
  });

  it('A8-2: 项目列显示项目 name(active_root 命中 project.root_dir)', async () => {
    // 模拟 projects store — localStorage 'ccm.projects' 是 useProjectOptions
    // 的数据源。A8 fix 让 page 把这份数据转成 {id,name,root_dir} 传给 table。
    const projectPath = '/Users/foo/code/winui3';
    const projectName = 'My WinUI3 Project';
    window.localStorage.setItem(
      'ccm.projects',
      JSON.stringify([
        { id: projectPath, name: projectName, root_dir: projectPath },
      ]),
    );
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'get_history_stats') return sampleStats;
      if (cmd === 'get_usage_history_rows') {
        return [
          sampleUsageRow(1, {
            used_pct: 25.0,
            active_root: projectPath,
          }),
        ];
      }
      return null;
    });
    render(<HistoryPage />);
    await waitFor(() => {
      expect(screen.getByTestId('usage-history-table')).toBeInTheDocument();
    });
    const row = screen.getByTestId('usage-history-row');
    const cells = within(row).getAllByRole('cell');
    // 表结构: 时间 / Provider / 窗口 / token消耗量 / 项目 / snapshot_id
    // 项目 cell = index 4。
    expect(cells[4]).toHaveTextContent(projectName);
    // Raw path should NOT leak into the cell.
    expect(cells[4].textContent).not.toContain('/Users/foo/code/winui3');
  });

  it('A8-3: 项目列显示 "全部"(active_root 不命中任何 project)', async () => {
    // 模拟一个 project list,但 active_root 不在 list 中 — 表示用户级
    // snapshot 来自一个已被删除的项目。resolveProjectLabel 应当 fallback
    // 到 '全部' 而不是显示原始路径。
    window.localStorage.setItem(
      'ccm.projects',
      JSON.stringify([
        {
          id: '/Users/other/project',
          name: 'Other Project',
          root_dir: '/Users/other/project',
        },
      ]),
    );
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'get_history_stats') return sampleStats;
      if (cmd === 'get_usage_history_rows') {
        return [
          sampleUsageRow(1, {
            used_pct: 25.0,
            active_root: '/Users/orphaned/project',
          }),
        ];
      }
      return null;
    });
    render(<HistoryPage />);
    await waitFor(() => {
      expect(screen.getByTestId('usage-history-table')).toBeInTheDocument();
    });
    const row = screen.getByTestId('usage-history-row');
    const cells = within(row).getAllByRole('cell');
    expect(cells[4]).toHaveTextContent('全部');
    // Raw path should NOT leak.
    expect(cells[4].textContent).not.toContain('/Users/orphaned/project');
  });

  it('A8-4: 项目列显示 "—" 当 active_root 为 null', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'get_history_stats') return sampleStats;
      if (cmd === 'get_usage_history_rows') {
        return [sampleUsageRow(1, { used_pct: 25.0, active_root: null })];
      }
      return null;
    });
    render(<HistoryPage />);
    await waitFor(() => {
      expect(screen.getByTestId('usage-history-table')).toBeInTheDocument();
    });
    const row = screen.getByTestId('usage-history-row');
    const cells = within(row).getAllByRole('cell');
    expect(cells[4]).toHaveTextContent('—');
  });

  it('A8-5: 项目列回退到 raw active_root 当 projects 列表为空 (legacy)', async () => {
    // 空 project list — 这是 legacy 行为 (projects prop 缺失/空)。这是
    // resolveProjectLabel step 4 的 contract: 没 projects → 显示 raw path。
    // 这个行为是有意的向后兼容,不能误改。
    const rawPath = '/Users/foo/code/legacy-project';
    window.localStorage.clear(); // 没有 ccm.projects → useProjectOptions → []
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'get_history_stats') return sampleStats;
      if (cmd === 'get_usage_history_rows') {
        return [
          sampleUsageRow(1, { used_pct: 25.0, active_root: rawPath }),
        ];
      }
      return null;
    });
    render(<HistoryPage />);
    await waitFor(() => {
      expect(screen.getByTestId('usage-history-table')).toBeInTheDocument();
    });
    const row = screen.getByTestId('usage-history-row');
    const cells = within(row).getAllByRole('cell');
    // Legacy contract: raw path 显示在项目列。
    expect(cells[4]).toHaveTextContent(rawPath);
  });

  it('A8-6: 混合场景 — user 级 + project 级行并存,各走各的 resolution 分支', async () => {
    // 一次 fetch 返回多行,active_root 状态各异 (命中 / 不命中 / null) —
    // 验证 resolveProjectLabel 是 per-row 而非全局。
    const matchedPath = '/Users/foo/matched';
    window.localStorage.setItem(
      'ccm.projects',
      JSON.stringify([
        { id: matchedPath, name: 'Matched Project', root_dir: matchedPath },
      ]),
    );
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'get_history_stats') return sampleStats;
      if (cmd === 'get_usage_history_rows') {
        return [
          // 行 1: active_root 命中 project
          sampleUsageRow(1, {
            used_pct: 25.0,
            active_root: matchedPath,
            recorded_at: 1_700_000_001,
          }),
          // 行 2: active_root 没命中 → '全部'
          sampleUsageRow(2, {
            used_pct: 50.0,
            active_root: '/Users/orphan/path',
            recorded_at: 1_700_000_002,
          }),
          // 行 3: active_root = null → '—'
          sampleUsageRow(3, {
            used_pct: 75.0,
            active_root: null,
            recorded_at: 1_700_000_003,
          }),
        ];
      }
      return null;
    });
    render(<HistoryPage />);
    await waitFor(() => {
      const rows = screen.getAllByTestId('usage-history-row');
      expect(rows.length).toBe(3);
    });
    const rows = screen.getAllByTestId('usage-history-row');
    const cellsPerRow = rows.map((r) => within(r).getAllByRole('cell'));

    // 时间降序 → 行顺序反转: row[0] = row 3 (active_root null)
    expect(cellsPerRow[0][4]).toHaveTextContent('—');
    expect(cellsPerRow[1][4]).toHaveTextContent('全部');
    expect(cellsPerRow[2][4]).toHaveTextContent('Matched Project');
  });

  it('A8-7: 表头包含 "项目" 列(确认整体表结构不被回归破坏)', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'get_history_stats') return sampleStats;
      if (cmd === 'get_usage_history_rows') {
        return [sampleUsageRow(1, { used_pct: 25.0 })];
      }
      return null;
    });
    render(<HistoryPage />);
    await waitFor(() => {
      expect(screen.getByTestId('usage-history-table')).toBeInTheDocument();
    });
    // 锁定全部 6 列的列名顺序,防止有人无意中删除/重命名列。
    const table = screen.getByTestId('usage-history-table');
    const headers = within(table).getAllByRole('columnheader');
    expect(headers.map((h) => h.textContent)).toEqual([
      '时间',
      'Provider',
      '窗口',
      'token 消耗量',
      '项目',
      'snapshot_id',
    ]);
  });
});