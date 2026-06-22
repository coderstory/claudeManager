/**
 * FilterBar — sub-component of the History page (M4.6 / Phase 21).
 *
 * Renders a row of filter controls whose values feed into the
 * `UsageHistoryFilter` / `BackupHistoryFilter` object passed to the
 * IPC commands.
 *
 * ## Design choices (CLAUDE.md §4 + SPEC §5.14)
 *
 * - **Single shared component**: both tabs use the same FilterBar,
 *   just with different field sets (usage has `provider_id`,
 *   backup has `scope` + `trigger_kind`). The `tab` prop selects
 *   the visible fields so we don't ship two near-duplicate files.
 * - **Date inputs use native `<input type="date">`**: it round-trips
 *   via ISO `YYYY-MM-DD` strings which we convert to unix seconds
 *   on the way out. No date-picker library — keeps the bundle
 *   small and matches the project's "no extra deps" rule.
 * - **"Apply" is implicit**: the parent's `useEffect` re-runs on
 *   `filter` change, so every keystroke is a refetch. To avoid
 *   hammering IPC we debounce via a local "pending" state — but
 *   for the initial ship, parent re-fetches on every render. If
 *   the API becomes heavy we can add debouncing later without
 *   breaking the contract.
 */
import type { ReactElement } from 'react';
import type {
  BackupHistoryFilter,
  UsageHistoryFilter,
} from '../../types/history';

export type HistoryTab = 'usage' | 'backup';
export type HistoryFilter = UsageHistoryFilter & BackupHistoryFilter;

export interface FilterBarProps {
  tab: HistoryTab;
  filter: HistoryFilter;
  onChange: (next: HistoryFilter) => void;
  /** Active projects for the project selector (from `useProjects`). */
  projectOptions: Array<{ id: string; label: string }>;
  /** Known provider IDs (from the F7 usage data). */
  providerOptions: string[];
  /** Trigger kinds (F13). */
  triggerKinds: Array<{ value: string; label: string }>;
}

/**
 * Convert a YYYY-MM-DD string to a unix-seconds number at midnight UTC.
 * Returns `null` for empty input.
 */
function dateToTs(s: string): number | null {
  if (!s) return null;
  const t = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(t) ? Math.floor(t / 1000) : null;
}

/** Inverse — unix seconds → YYYY-MM-DD (UTC). */
function tsToDate(ts: number | null | undefined): string {
  if (ts == null) return '';
  const d = new Date(ts * 1000);
  if (Number.isNaN(d.getTime())) return '';
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/** Shared input style — matches the rest of the design system. */
const inputBaseStyle: React.CSSProperties = {
  padding: '6px 10px',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-button)',
  background: 'var(--bg-elevated)',
  color: 'var(--text-primary)',
  fontSize: 13,
  fontFamily: 'inherit',
};

const labelBaseStyle: React.CSSProperties = {
  color: 'var(--text-muted)',
  fontSize: 12,
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
};

export function FilterBar({
  tab,
  filter,
  onChange,
  projectOptions,
  providerOptions,
  triggerKinds,
}: FilterBarProps): ReactElement {
  const update = (patch: Partial<HistoryFilter>): void => {
    onChange({ ...filter, ...patch });
  };

  const reset = (): void => {
    onChange({});
  };

  return (
    <div
      data-testid="history-filter-bar"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 12,
        alignItems: 'flex-end',
        marginBottom: 16,
        padding: 12,
        borderRadius: 8,
        border: '1px solid var(--border)',
        background: 'var(--bg-elevated)',
      }}
    >
      {/* Time range — from / to */}
      <label style={labelBaseStyle} data-testid="history-filter-from">
        <span>起始日期</span>
        <input
          type="date"
          value={tsToDate(filter.from_ts ?? null)}
          onChange={(e) => update({ from_ts: dateToTs(e.target.value) })}
          style={inputBaseStyle}
        />
      </label>
      <label style={labelBaseStyle} data-testid="history-filter-to">
        <span>结束日期</span>
        <input
          type="date"
          value={tsToDate(filter.to_ts ?? null)}
          onChange={(e) => update({ to_ts: dateToTs(e.target.value) })}
          style={inputBaseStyle}
        />
      </label>

      {/* Project selector */}
      <label style={labelBaseStyle} data-testid="history-filter-project">
        <span>项目</span>
        <select
          value={filter.active_root ?? ''}
          onChange={(e) =>
            update({ active_root: e.target.value === '' ? null : e.target.value })
          }
          style={inputBaseStyle}
        >
          <option value="">全部</option>
          {projectOptions.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </label>

      {/* Tab-specific fields */}
      {tab === 'usage' ? (
        <label style={labelBaseStyle} data-testid="history-filter-provider">
          <span>Provider</span>
          <select
            value={filter.provider_id ?? ''}
            onChange={(e) =>
              update({
                provider_id: e.target.value === '' ? null : e.target.value,
              })
            }
            style={inputBaseStyle}
          >
            <option value="">全部</option>
            {providerOptions.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <>
          <label style={labelBaseStyle} data-testid="history-filter-scope">
            <span>范围</span>
            <select
              value={filter.scope ?? ''}
              onChange={(e) =>
                update({
                  scope: e.target.value === '' ? null : e.target.value,
                })
              }
              style={inputBaseStyle}
            >
              <option value="">全部</option>
              <option value="user">用户级</option>
              <option value="project">项目级</option>
            </select>
          </label>
          <label style={labelBaseStyle} data-testid="history-filter-trigger">
            <span>触发方式</span>
            <select
              value={filter.trigger_kind ?? ''}
              onChange={(e) =>
                update({
                  trigger_kind:
                    e.target.value === '' ? null : e.target.value,
                })
              }
              style={inputBaseStyle}
            >
              <option value="">全部</option>
              {triggerKinds.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
          </label>
        </>
      )}

      <button
        type="button"
        onClick={reset}
        data-testid="history-filter-reset"
        style={{
          ...inputBaseStyle,
          cursor: 'pointer',
          padding: '6px 14px',
          color: 'var(--text-secondary)',
        }}
      >
        重置
      </button>
    </div>
  );
}