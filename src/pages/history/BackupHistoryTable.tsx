/**
 * BackupHistoryTable — F13 history rows displayed in a table.
 *
 * Pure presentational component — receives an array of
 * `BackupHistoryRow` and renders each one with timestamp ordering
 * (newest first). No IPC, no state — the parent owns the data.
 *
 * Empty state: shows a friendly placeholder so users understand
 * "0 rows" doesn't mean the page is broken (vs a crash).
 */
import { useState } from 'react';
import type { ReactElement } from 'react';
import type { BackupHistoryRow } from '../../types/history';
import { Pagination } from '../../components/Pagination';

export interface BackupHistoryTableProps {
  rows: BackupHistoryRow[];
  loading?: boolean;
}

function formatTs(ts: number): string {
  const d = new Date(ts * 1000);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString();
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/** Map snake_case trigger to Chinese label. */
const TRIGGER_LABEL: Record<string, string> = {
  manual: '手动',
  auto_before_switch: '切换前自动',
  auto_incremental: '增量自动',
};

const SCOPE_LABEL: Record<string, string> = {
  user: '用户级',
  project: '项目级',
};

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

export function BackupHistoryTable({
  rows,
  loading,
}: BackupHistoryTableProps): ReactElement {
  if (loading) {
    return (
      <div
        data-testid="backup-history-loading"
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
        data-testid="backup-history-empty"
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
        暂无备份历史 — 切换 provider 或 [立刻备份] 后会自动记录。
      </div>
    );
  }

  // Defensive sort: timestamp descending (newest first). Backend
  // already returns in this order but we re-sort in case a future
  // refactor changes the ORDER BY.
  const sorted = [...rows].sort((a, b) => b.created_at - a.created_at);

  // M5 #31 — pagination state for the rendered slice.
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 20;
  const pageStart = page * PAGE_SIZE;
  const pageRows = sorted.slice(pageStart, pageStart + PAGE_SIZE);

  return (
    <div
      data-testid="backup-history-table-wrap"
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
        data-testid="backup-history-table"
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontFamily: 'var(--font-mono)',
        }}
      >
        <thead>
          <tr>
            <th style={headerStyle}>时间</th>
            <th style={headerStyle}>文件名</th>
            <th style={{ ...headerStyle, textAlign: 'right' }}>大小</th>
            <th style={headerStyle}>范围</th>
            <th style={headerStyle}>触发</th>
            <th style={headerStyle}>项目</th>
          </tr>
        </thead>
        <tbody>
          {pageRows.map((row) => (
            <tr
              key={row.id}
              data-testid="backup-history-row"
              data-backup-id={row.backup_id}
              style={{ borderBottom: '1px solid var(--border)' }}
            >
              <td style={cellStyle}>{formatTs(row.created_at)}</td>
              <td
                style={{
                  ...cellStyle,
                  maxWidth: 200,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
                title={row.file_name}
              >
                {row.file_name}
              </td>
              <td style={{ ...cellStyle, textAlign: 'right' }}>
                {formatSize(row.file_size)}
              </td>
              <td style={cellStyle}>
                {SCOPE_LABEL[row.scope] ?? row.scope}
              </td>
              <td style={cellStyle}>
                {TRIGGER_LABEL[row.trigger_kind] ?? row.trigger_kind}
              </td>
              <td
                style={{
                  ...cellStyle,
                  color: 'var(--text-muted)',
                  maxWidth: 120,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
                title={row.active_root ?? ''}
              >
                {row.active_root ?? '—'}
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
        testIdPrefix="backup-history-pagination"
      />
    </div>
  );
}