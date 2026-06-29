/**
 * UsageHistoryTable — F7 history rows displayed in a table.
 *
 * Pure presentational component — receives an array of
 * `UsageHistoryRow` and renders each one with timestamp ordering
 * (newest first). No IPC, no state — the parent owns the data.
 *
 * Empty state: shows a friendly placeholder so users understand
 * "0 rows" doesn't mean the page is broken (vs a crash).
 *
 * 0% rows: hidden (post cda8b8a bug fix, but legacy DB rows may
 * still carry used_pct = 0 from the buggy insert path — those
 * rows are not meaningful to display).
 */
import { useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import type { UsageHistoryRow } from '../../types/history';
import { Pagination } from '../../components/Pagination';
import { formatDateTime } from '../../lib/formatTime';

export interface UsageHistoryTableProps {
  rows: UsageHistoryRow[];
  loading?: boolean;
  /**
   * Project list — `[{id, name, root_dir}]`. Used to resolve
   * `row.active_root` (raw filesystem path) into a human-readable
   * project name. Optional: when omitted the table falls back to
   * showing the raw path (legacy behavior).
   */
  projects?: ReadonlyArray<{ id: string; name: string; root_dir: string }>;
}

function formatTs(ts: number): string {
  const d = new Date(ts * 1000);
  if (Number.isNaN(d.getTime())) return '—';
  return formatDateTime(ts);
}

function formatPct(pct: number): string {
  return `${pct.toFixed(1)}%`;
}

/**
 * resolveProjectLabel — A8 fix.
 *
 * Maps a row's `active_root` (raw filesystem path) to the project
 * name from the supplied `projects` list. Resolution order:
 *   1. If `active_root` is null/empty → "—" (no project recorded)
 *   2. Look up `projects.find(p => p.root_dir === active_root)` →
 *      return that project's `name`
 *   3. If active_root is set but no project matches → "全部"
 *      (user-level snapshot: the path may have been a project dir
 *      that was since removed; treat as the global row)
 *   4. If no `projects` list provided → fall back to showing the
 *      raw `active_root` path (legacy display)
 */
function resolveProjectLabel(
  activeRoot: string | null,
  projects?: ReadonlyArray<{ id: string; name: string; root_dir: string }>,
): string {
  if (!activeRoot) return '—';
  if (!projects || projects.length === 0) return activeRoot;
  const match = projects.find((p) => p.root_dir === activeRoot);
  if (match) return match.name;
  return '全部';
}

const cellStyle: React.CSSProperties = {
  padding: '8px 10px',
  fontSize: 12,
  fontFamily: 'var(--font-mono)',
  color: 'var(--text-primary)',
  whiteSpace: 'nowrap',
};

const headerStyle: React.CSSProperties = {
  padding: '8px 10px',
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: 'var(--text-muted)',
  fontWeight: 500,
  textAlign: 'left',
  borderBottom: '1px solid var(--border)',
  background: 'var(--bg-primary)',
};

export function UsageHistoryTable({
  rows,
  loading,
  projects,
}: UsageHistoryTableProps): ReactElement {
  // M5 #31 — pagination state for the rendered slice. Reset to 0
  // when the row set changes (filter applied / new fetch).
  const [page, setPage] = useState(0);
  // Filter out rows with used_pct === 0 (legacy DB artifact from
  // pre-cda8b8a `record_usage` hardcoded-zero bug). 0.0001 is kept
  // visible since it represents a real (tiny) snapshot. Memoized so
  // the filter doesn't re-run on every parent re-render.
  // NOTE: hooks must run unconditionally, so this stays above any
  // early-return below.
  const visibleRows = useMemo(
    () => rows.filter((r) => r.used_pct > 0),
    [rows],
  );

  if (loading) {
    return (
      <div
        data-testid="usage-history-loading"
        style={{
          padding: 32,
          color: 'var(--text-muted)',
          fontSize: 13,
          textAlign: 'center',
        }}
      >
        加载中…
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div
        data-testid="usage-history-empty"
        style={{
          padding: 32,
          color: 'var(--text-muted)',
          fontSize: 13,
          textAlign: 'center',
          borderRadius: 'var(--radius-card)',
          border: '1px dashed var(--border)',
          background: 'var(--bg-elevated)',
        }}
      >
        暂无用量历史 — 切换 / 刷新 F7 用量页面后会自动记录。
      </div>
    );
  }

  // All rows were 0% → nothing meaningful to show.
  if (visibleRows.length === 0) {
    return (
      <div
        data-testid="usage-history-filtered-empty"
        style={{
          padding: 32,
          color: 'var(--text-muted)',
          fontSize: 13,
          textAlign: 'center',
          borderRadius: 'var(--radius-card)',
          border: '1px dashed var(--border)',
          background: 'var(--bg-elevated)',
        }}
      >
        暂无可见用量记录(全部为 0%)。
      </div>
    );
  }

  // Defensive sort: timestamp descending (newest first). Backend
  // already returns in this order but we re-sort in case a future
  // refactor changes the ORDER BY.
  const sorted = [...visibleRows].sort(
    (a, b) => b.recorded_at - a.recorded_at,
  );

  // M5 #31 — slice the sorted list to the current page.
  const PAGE_SIZE = 20;
  const pageStart = page * PAGE_SIZE;
  const pageRows = sorted.slice(pageStart, pageStart + PAGE_SIZE);

  return (
    <div
      data-testid="usage-history-table-wrap"
      style={{
        borderRadius: 'var(--radius-card)',
        border: '1px solid var(--border)',
        background: 'var(--bg-elevated)',
        overflow: 'hidden',
        maxHeight: '60vh',
        overflowY: 'auto',
      }}
    >
      <table
        data-testid="usage-history-table"
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontFamily: 'var(--font-mono)',
        }}
      >
        <thead>
          <tr>
            <th style={headerStyle}>时间</th>
            <th style={headerStyle}>Provider</th>
            <th style={headerStyle}>窗口</th>
            <th style={{ ...headerStyle, textAlign: 'right' }}>token 消耗量</th>
            <th style={headerStyle}>项目</th>
            <th style={headerStyle}>snapshot_id</th>
          </tr>
        </thead>
        <tbody>
          {pageRows.map((row) => (
            <tr
              key={row.id}
              data-testid="usage-history-row"
              data-usage-id={row.id}
              style={{ borderBottom: '1px solid var(--border)' }}
            >
              <td style={cellStyle}>{formatTs(row.recorded_at)}</td>
              <td style={cellStyle}>{row.provider_name || row.provider_id}</td>
              <td style={cellStyle}>{row.window}</td>
              <td style={{ ...cellStyle, textAlign: 'right' }}>
                {formatPct(row.used_pct)}
              </td>
              <td style={{ ...cellStyle, color: 'var(--text-muted)' }}>
                {resolveProjectLabel(row.active_root, projects)}
              </td>
              <td
                style={{
                  ...cellStyle,
                  color: 'var(--text-muted)',
                  fontSize: 11,
                  maxWidth: 120,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
                title={row.snapshot_id}
              >
                {row.snapshot_id.slice(0, 12)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Pagination
        total={sorted.length}
        page={page}
        pageSize={PAGE_SIZE}
        onPageChange={setPage}
        testIdPrefix="usage-history-pagination"
      />
    </div>
  );
}