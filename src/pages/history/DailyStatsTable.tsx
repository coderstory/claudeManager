/**
 * DailyStatsTable — "按天汇总" view for the F21 history page.
 *
 * Presentational component — receives pre-aggregated
 * `DailyStatRow[]` (one row per (provider, date)) and renders a
 * compact table: 日期 | Provider | Tokens | 快照数.
 *
 * Data is pre-sorted by `stat_date DESC` from the backend; we
 * re-sort defensively in case a future refactor changes ORDER BY.
 */
import { useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import type { DailyStatRow } from '../../types/history';
import { formatChineseTokenCount } from '../../lib/format';
import { Pagination } from '../../components/Pagination';

export interface DailyStatsTableProps {
  rows: DailyStatRow[];
  loading?: boolean;
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

function formatDate(iso: string): string {
  // Render "MM-DD" for compactness, but keep the full ISO in the
  // title attribute so users can still see the year when needed.
  return iso.length >= 10 ? iso.slice(5) : iso;
}

function formatFullDate(iso: string): string {
  return iso.length >= 10 ? iso : iso;
}

export function DailyStatsTable({
  rows,
  loading,
}: DailyStatsTableProps): ReactElement {
  // Defensive sort: stat_date DESC (most recent first). Backend
  // already does this, but we re-sort so the UI is correct even if
  // a future refactor changes the SQL ORDER BY.
  const sorted = useMemo(
    () => [...rows].sort((a, b) => b.stat_date.localeCompare(a.stat_date)),
    [rows],
  );

  // M5 #31 — pagination state for the rendered slice.
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 20;
  const pageStart = page * PAGE_SIZE;
  const pageRows = sorted.slice(pageStart, pageStart + PAGE_SIZE);

  if (loading) {
    return (
      <div
        data-testid="daily-stats-loading"
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
        data-testid="daily-stats-empty"
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
        暂无按天汇总数据 — 切换到「用量历史」标签后会自动聚合。
      </div>
    );
  }

  return (
    <div
      data-testid="daily-stats-table-wrap"
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
        data-testid="daily-stats-table"
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontFamily: 'var(--font-mono)',
        }}
      >
        <thead>
          <tr>
            <th style={headerStyle}>日期</th>
            <th style={headerStyle}>Provider</th>
            <th style={{ ...headerStyle, textAlign: 'right' }}>Tokens</th>
            <th style={{ ...headerStyle, textAlign: 'right' }}>快照数</th>
          </tr>
        </thead>
        <tbody>
          {pageRows.map((row) => (
            <tr
              key={`${row.provider_id}-${row.stat_date}`}
              data-testid="daily-stats-row"
              data-date={row.stat_date}
              style={{ borderBottom: '1px solid var(--border)' }}
            >
              <td style={cellStyle} title={formatFullDate(row.stat_date)}>
                {formatDate(row.stat_date)}
              </td>
              <td style={cellStyle}>{row.provider_id}</td>
              <td style={{ ...cellStyle, textAlign: 'right' }}>
                {formatChineseTokenCount(row.tokens_used)}
              </td>
              <td style={{ ...cellStyle, textAlign: 'right' }}>
                {row.snapshot_count}
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
        testIdPrefix="daily-stats-pagination"
      />
    </div>
  );
}
