/**
 * UsageHistoryTable — F7 history rows displayed in a table.
 *
 * Pure presentational component — receives an array of
 * `UsageHistoryRow` and renders each one with timestamp ordering
 * (newest first). No IPC, no state — the parent owns the data.
 *
 * Empty state: shows a friendly placeholder so users understand
 * "0 rows" doesn't mean the page is broken (vs a crash).
 */
import type { ReactElement } from 'react';
import type { UsageHistoryRow } from '../../types/history';

export interface UsageHistoryTableProps {
  rows: UsageHistoryRow[];
  loading?: boolean;
}

function formatTs(ts: number): string {
  const d = new Date(ts * 1000);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString();
}

function formatPct(pct: number): string {
  return `${pct.toFixed(1)}%`;
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
}: UsageHistoryTableProps): ReactElement {
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
          borderRadius: 8,
          border: '1px dashed var(--border)',
          background: 'var(--bg-elevated)',
        }}
      >
        暂无用量历史 — 切换 / 刷新 F7 用量页面后会自动记录。
      </div>
    );
  }

  // Defensive sort: timestamp descending (newest first). Backend
  // already returns in this order but we re-sort in case a future
  // refactor changes the ORDER BY.
  const sorted = [...rows].sort((a, b) => b.recorded_at - a.recorded_at);

  return (
    <div
      data-testid="usage-history-table-wrap"
      style={{
        borderRadius: 8,
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
            <th style={{ ...headerStyle, textAlign: 'right' }}>使用率</th>
            <th style={headerStyle}>项目</th>
            <th style={headerStyle}>snapshot_id</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
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
                {row.active_root ?? '—'}
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
    </div>
  );
}