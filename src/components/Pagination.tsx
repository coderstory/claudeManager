/**
 * Pagination — shared pagination control for tables (M5 #31).
 *
 * Generic, presentational component: takes a total count + page
 * size + current page + onPageChange callback, and renders the
 * "上一页 / 下一页" + page indicator chrome.
 *
 * Pure UI — no IPC, no data fetching. The parent owns the slicing
 * (e.g. `rows.slice(page * size, (page + 1) * size)`).
 *
 * ## Why a dedicated component (vs inlining in each table)
 *
 * Three history tables (UsageHistoryTable, DailyStatsTable,
 * BackupHistoryTable) all needed pagination. The patterns are
 * identical (prev/next + page indicator), so this avoids the
 * triple copy-paste the M5-PLAN §3 dependency analysis warned
 * about.
 *
 * ## Why not a virtualized table
 *
 * Spec asked for plain pagination, not virtualization. Most users
 * have <100 history rows after the 0%-filter; for the rest, the
 * default `pageSize = 20` keeps DOM nodes bounded without forcing
 * an intersection-observer dep into the bundle (CLAUDE.md §2.3
 * dep lock).
 */
import type { ReactElement } from 'react';

export interface PaginationProps {
  /** Total number of items across all pages. */
  total: number;
  /** Current 0-indexed page. */
  page: number;
  /** Items per page. Defaults to 20. */
  pageSize?: number;
  /** Called when the user changes page. */
  onPageChange: (page: number) => void;
  /** Optional test-id prefix so multiple paginations can co-exist. */
  testIdPrefix?: string;
}

export function Pagination({
  total,
  page,
  pageSize = 20,
  onPageChange,
  testIdPrefix = 'pagination',
}: PaginationProps): ReactElement | null {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  // Hide pagination when there is only one page (or zero rows).
  if (pageCount <= 1) return null;
  const prevDisabled = page <= 0;
  const nextDisabled = page >= pageCount - 1;
  return (
    <div
      data-testid={testIdPrefix}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: 8,
        padding: '8px 12px',
        fontSize: 12,
        color: 'var(--text-secondary)',
      }}
    >
      <button
        type="button"
        data-testid={`${testIdPrefix}-prev`}
        onClick={() => onPageChange(Math.max(0, page - 1))}
        disabled={prevDisabled}
        style={{
          padding: '4px 10px',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-button)',
          background: 'var(--bg-elevated)',
          color: 'var(--text-primary)',
          cursor: prevDisabled ? 'not-allowed' : 'pointer',
          opacity: prevDisabled ? 0.5 : 1,
          fontFamily: 'inherit',
          fontSize: 12,
        }}
      >
        上一页
      </button>
      <span data-testid={`${testIdPrefix}-indicator`}>
        第 {page + 1} / {pageCount} 页 · 共 {total} 条
      </span>
      <button
        type="button"
        data-testid={`${testIdPrefix}-next`}
        onClick={() => onPageChange(Math.min(pageCount - 1, page + 1))}
        disabled={nextDisabled}
        style={{
          padding: '4px 10px',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-button)',
          background: 'var(--bg-elevated)',
          color: 'var(--text-primary)',
          cursor: nextDisabled ? 'not-allowed' : 'pointer',
          opacity: nextDisabled ? 0.5 : 1,
          fontFamily: 'inherit',
          fontSize: 12,
        }}
      >
        下一页
      </button>
    </div>
  );
}