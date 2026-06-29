/**
 * F21 — 历史查询 (M4.6 SQLite history page, Phase 21-C).
 *
 * L1 page that lets the user browse persisted usage + backup history
 * backed by the SQLite store. Two tabs (用量 / 备份), a filter bar,
 * a table, and an export button.
 *
 * ## IPC surface (Plan B)
 *
 * Five Tauri commands are expected (provided by Plan B; until then
 * the page renders an empty table — see §"Graceful degradation"
 * below):
 *   - `get_usage_history(filter?)`     → `UsageHistoryRow[]`
 *   - `get_backup_history(filter?)`    → `BackupHistoryRow[]`
 *   - `get_history_stats()`            → `HistoryStats`
 *   - `export_history(format, target_path)` → `ExportReport`
 *   - `purge_history(older_than_days)` → `PurgeReport`
 *
 * Wrapped in `src/lib/api/history.ts` — pages must import the
 * helpers from there, not call `invoke(...)` directly.
 *
 * ## Layout (L-M2.02 unified — padding 24px, h1 18px, max-width 720px)
 *
 * Per the unified detail-page contract (commit f94e27d):
 *   padding: 'var(--space-6)' (24px)
 *   h1 fontSize: 'var(--fs-heading)' (18px)
 *   h1 marginTop: 0
 *   container maxWidth: 720
 *
 * ## Graceful degradation
 *
 * Plan B may ship after Plan C, so the page must not crash if the
 * commands are missing. Every IPC call is wrapped in try/catch and
 * the page renders an "加载失败" ErrorBanner (F15) — never a blank
 * screen, never a silent failure (CLAUDE.md §7).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { Database } from 'lucide-react';

import { invoke } from '@tauri-apps/api/core';
import { ErrorBanner } from '../../components/ErrorBanner';
import {
  exportHistory,
  getDailyStatsHistory,
  getHistoryStats,
  getUsageHistory,
} from '../../lib/api/history';
import type {
  DailyStatRow,
  ExportFormat,
  HistoryStats,
  UsageHistoryRow,
} from '../../types/history';

import {
  FilterBar,
  type HistoryFilter,
  type HistoryTab,
} from './FilterBar';
import { UsageHistoryTable } from './UsageHistoryTable';
import { DailyStatsTable } from './DailyStatsTable';

// ---------------------------------------------------------------------------
// Trigger kind options — shared between FilterBar dropdowns and tests
// ---------------------------------------------------------------------------

const TRIGGER_KINDS: Array<{ value: string; label: string }> = [
  { value: 'manual', label: '手动' },
  { value: 'auto_before_switch', label: '切换前自动' },
  { value: 'auto_incremental', label: '增量自动' },
];

// ---------------------------------------------------------------------------
// Hooks to derive filter dropdown options
// ---------------------------------------------------------------------------

/**
 * Project list — reads from the F1 Provider list via localStorage.
 *
 * Why not `useProjects`: that hook fires an IPC call on mount
 * (M3.10). For the History page we only need labels, not active
 * project state. We extract project labels from any provider data
 * the page already saw in this session (best effort), falling back
 * to a single "用户级" option.
 *
 * Keeping this dependency-free means the History page doesn't break
 * when `useProjects` API evolves.
 */
function useProjectOptions(): Array<{ id: string; label: string }> {
  return useMemo(() => {
    // M3.10 — projects live in localStorage under 'ccm.projects' via
    // useProjects' reducer. We attempt a best-effort read for
    // dropdown labels; if the storage key is missing or unparseable
    // we fall back to a single user-level option.
    if (typeof window === 'undefined') return [];
    try {
      const raw = window.localStorage.getItem('ccm.projects');
      if (!raw) return [];
      const parsed = JSON.parse(raw) as unknown;
      // Accept either an array of {id,name} or {state:{projects:[...]}}.
      const list = Array.isArray(parsed)
        ? parsed
        : Array.isArray((parsed as { state?: { projects?: unknown[] } })?.state?.projects)
          ? (parsed as { state: { projects: Array<{ id: string; name: string }> } }).state.projects
          : [];
      return list
        .filter(
          (p): p is { id: string; name?: string; root_dir?: string } =>
            typeof p === 'object' && p !== null && 'id' in p,
        )
        .map((p) => ({
          id: (p as { root_dir?: string }).root_dir ?? p.id,
          label: (p as { name?: string }).name ?? p.id,
        }));
    } catch {
      return [];
    }
  }, []);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert a unix-seconds number to a `'YYYY-MM-DD'` UTC string.
 * Returns `null` for nullish / non-finite input. Mirrors the
 * inverse of `FilterBar::dateToTs` so the date filter round-trips
 * correctly when the user picks the same day in the date picker.
 */
function tsToIsoDate(ts: number | null | undefined): string | null {
  if (ts == null) return null;
  const d = new Date(ts * 1000);
  if (Number.isNaN(d.getTime())) return null;
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * B2 fix — the HistoryFilter shared with FilterBar uses
 * `from_ts` / `to_ts` (unix seconds, fits usage_history & backup
 * tables), but `DailyStatsFilter` expects `from_date` / `to_date`
 * (`'YYYY-MM-DD'` strings, since usage_daily_stats.stat_date is
 * a TEXT column). Spread + remap so the daily tab actually
 * receives the picked date range; without this conversion the
 * backend silently drops the unknown fields and returns the
 * unfiltered daily table, making "选日期后不刷新" a no-op.
 *
 * Also strips `after_id` / `active_root` / `scope` / `trigger_kind`
 * (those don't exist on DailyStatsFilter) so the IPC payload is
 * clean and any future serde `deny_unknown_fields` won't reject it.
 */
function toDailyFilter(
  filter: HistoryFilter,
): Parameters<typeof getDailyStatsHistory>[0] {
  const out: Parameters<typeof getDailyStatsHistory>[0] = {};
  if (filter.provider_id) out.provider_id = filter.provider_id;
  const fromDate = tsToIsoDate(filter.from_ts);
  if (fromDate) out.from_date = fromDate;
  const toDate = tsToIsoDate(filter.to_ts);
  if (toDate) out.to_date = toDate;
  return out;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function HistoryPage(): ReactElement {
  const [tab, setTab] = useState<HistoryTab>('usage');
  const [filter, setFilter] = useState<HistoryFilter>({});
  const [usageRows, setUsageRows] = useState<UsageHistoryRow[]>([]);
  const [dailyRows, setDailyRows] = useState<DailyStatRow[]>([]);
  // [B1] — backupRows 状态已移除 (合并到「备份与恢复」页审计 tab)。
  const [stats, setStats] = useState<HistoryStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [exportFormat, setExportFormat] = useState<ExportFormat>('json');

  // BUG-RF-08 — cursor-based pagination state.
  // We append-loaded history rows so the table doesn't render
  // the full SQLite table on initial mount. The cursor is the last
  // row's id (or recorded_at for time-based fallback). Each
  // [加载更多] click fetches the next batch using `cursor` (last
  // id) + `limit` so the server can issue a fast indexed query.
  //
  // We intentionally use the existing `getUsageHistory` filter
  // (which accepts a `cursor` extension) — no new IPC commands,
  // no new capabilities (CLAUDE.md §2.3).
  const [pageSize] = useState<number>(50);
  const [usageCursor, setUsageCursor] = useState<number | null>(null);
  const [dailyCursor, setDailyCursor] = useState<number | null>(null);
  // [B1] — backup cursor / hasMoreBackup 已移除 (合并到「备份与恢复」页)。
  const [hasMoreUsage, setHasMoreUsage] = useState<boolean>(false);
  const [hasMoreDaily, setHasMoreDaily] = useState<boolean>(false);
  const [loadingMore, setLoadingMore] = useState<boolean>(false);

  const projectOptions = useProjectOptions();
  // A8 fix — pass the full project list (id/name/root_dir) to
  // UsageHistoryTable so it can resolve `active_root` (filesystem
  // path) → project name. Reuse the localStorage-backed list that
  // the filter dropdown already uses; the labels and the resolution
  // set share the same source.
  const projectList = useMemo(
    () => projectOptions.map((p) => ({ id: p.id, name: p.label, root_dir: p.id })),
    [projectOptions],
  );

  /** Provider options — derived from already-loaded usage rows. */
  const providerOptions = useMemo(() => {
    const seen = new Set<string>();
    for (const row of usageRows) {
      if (row.provider_id) seen.add(row.provider_id);
    }
    return Array.from(seen).sort();
  }, [usageRows]);

  // ---- data loading ----
  //
  // BUG-RF-08 — initial fetch is bounded to `pageSize` rows. Subsequent
  // loads happen via `loadMore` (manual "load more" button at the
  // bottom of the table). The backend filter is augmented with
  // `{ limit: pageSize, after_id: cursor }` so the SQL is a fast
  // indexed query instead of a full table scan.
  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      // Stats first (small, shared between tabs).
      const s = await getHistoryStats();
      setStats(s);

      // Tab-specific rows.
      if (tab === 'usage') {
        const rows = await getUsageHistory({
          ...(filter as Parameters<typeof getUsageHistory>[0]),
          limit: pageSize,
        });
        setUsageRows(rows);
        // Use the last row's `recorded_at` as the cursor. The backend
        // filter accepts `from_ts` (>= cursor) and `limit` for cheap
        // indexed pagination. No new IPC / no new Rust struct needed.
        setUsageCursor(rows.length > 0 ? rows[rows.length - 1].recorded_at : null);
        setHasMoreUsage(rows.length === pageSize);
      } else if (tab === 'daily') {
        const rows = await getDailyStatsHistory({
          ...toDailyFilter(filter),
          limit: pageSize,
        });
        setDailyRows(rows);
        setDailyCursor(rows.length > 0 ? rows[rows.length - 1].last_aggregated_recorded_at : null);
        setHasMoreDaily(rows.length === pageSize);
      }
      // [B1] — backup tab 已移除,刷新仅处理 usage / daily。
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [tab, filter, pageSize]);

  // BUG-RF-08 — load more rows for the active tab using the cursor
  // (last row's recorded_at / created_at / last_aggregated_recorded_at).
  // The backend filter applies `from_ts >= cursor` for cheap indexed
  // pagination. When result size < `pageSize`, no more data exists.
  const loadMore = useCallback(async (): Promise<void> => {
    if (loadingMore) return;
    setLoadingMore(true);
    setError(null);
    try {
      if (tab === 'usage' && usageCursor !== null) {
        const rows = await getUsageHistory({
          ...(filter as Parameters<typeof getUsageHistory>[0]),
          limit: pageSize,
          from_ts: usageCursor,
        });
        setUsageRows((prev) => [...prev, ...rows]);
        setUsageCursor(
          rows.length > 0 ? rows[rows.length - 1].recorded_at : null,
        );
        setHasMoreUsage(rows.length === pageSize);
      } else if (tab === 'daily' && dailyCursor !== null) {
        // B2 — merge toDailyFilter with cursor. toDailyFilter only
        // emits from_date/to_date when explicitly set in the UI;
        // the load-more cursor lives in dailyCursor so we always
        // need to emit a from_date here for the WHERE clause.
        const cursorDate = tsToIsoDate(dailyCursor);
        const base = toDailyFilter(filter);
        const rows = await getDailyStatsHistory({
          ...base,
          ...(cursorDate ? { from_date: cursorDate } : {}),
          limit: pageSize,
        });
        setDailyRows((prev) => [...prev, ...rows]);
        setDailyCursor(
          rows.length > 0 ? rows[rows.length - 1].last_aggregated_recorded_at : null,
        );
        setHasMoreDaily(rows.length === pageSize);
      }
      // [B1] — backup tab 已移除 (合并到「备份与恢复」页),无需分支。
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setLoadingMore(false);
    }
  }, [
    tab,
    filter,
    pageSize,
    loadingMore,
    usageCursor,
    dailyCursor,
  ]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // ---- export ----
  //
  // Phase 32-01 (P1-02): the Rust `export_history` command requires a
  // `target_path: String` — it does NOT pop a save dialog itself (see
  // `src/lib/api/history.ts::exportHistory` doc). We pop the native
  // save dialog via the Tauri v2 dialog plugin's IPC command
  // (`plugin:dialog|save`), which the `dialog:allow-save` capability
  // already permits (`src-tauri/capabilities/default.json:27`).
  //
  // We use `invoke('plugin:dialog|save', ...)` directly instead of the
  // `@tauri-apps/plugin-dialog` JS wrapper because that wrapper is
  // intentionally not installed (CLAUDE.md §2.3; same discipline as
  // F14/F23, though those two pop the dialog Rust-side). The
  // `plugin:dialog|save` command resolves to `null` when the user
  // cancels — we treat that as a no-op (no error banner, no toast),
  // matching the F14/F23 UX.
  const handleExport = useCallback(async (): Promise<void> => {
    setError(null);
    setSuccessMsg(null);
    try {
      const targetPath = await invoke<string | null>('plugin:dialog|save', {
        title: '导出历史',
        defaultPath: `history-export-${Date.now()}.${exportFormat}`,
        filters: [
          {
            name: exportFormat.toUpperCase(),
            extensions: [exportFormat],
          },
        ],
      });
      // User cancelled the save dialog — silent no-op (CLAUDE.md §7:
      // never silent on *errors*, but a cancel is not an error).
      if (!targetPath) return;

      const report = await exportHistory(exportFormat, targetPath);
      setSuccessMsg(
        `已导出 ${report.usage_rows} 条用量 + ${report.backup_rows} 条备份到 ${report.output_path}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`导出失败: ${msg}`);
    }
  }, [exportFormat]);

  // ---- tab change: clear error + reset loading ----
  const handleTabChange = useCallback((next: HistoryTab): void => {
    setTab(next);
    setError(null);
  }, []);

  return (
    <div
      data-testid="history-page"
      style={{
        padding: 'var(--space-6)',
        maxWidth: 720,
        margin: '0 auto',
      }}
    >
      <h1
        style={{
          fontSize: 'var(--fs-heading)',
          fontWeight: 600,
          color: 'var(--text-primary)',
          margin: 0,
          marginBottom: 'var(--space-3)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <Database size={18} />
        历史查询
      </h1>
      <p
        style={{
          fontSize: 13,
          color: 'var(--text-secondary)',
          marginBottom: 16,
          lineHeight: 1.6,
        }}
      >
        浏览用量快照 + 备份的 SQLite 持久化历史。
        切换 / 备份 / 编辑 settings.json 时自动写入,可按项目、时间、类型筛选后导出。
      </p>

      {/* Tabs — accent underline for active */}
      <div
        role="tablist"
        aria-label="历史类型"
        data-testid="history-tabs"
        style={{
          display: 'flex',
          gap: 0,
          marginBottom: 16,
          borderBottom: '1px solid var(--border)',
        }}
      >
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'usage'}
          onClick={() => handleTabChange('usage')}
          data-testid="tab-usage"
          style={tabButtonStyle(tab === 'usage')}
        >
          用量历史 ({stats?.usage_rows ?? 0})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'daily'}
          onClick={() => handleTabChange('daily')}
          data-testid="tab-daily"
          style={tabButtonStyle(tab === 'daily')}
        >
          按天汇总
        </button>
        {/* [B1] — 备份历史 tab 已合并到「备份与恢复」页 (审计 tab)。
            数据源虽不同 (audit log vs 磁盘文件) 但展示重叠,合并后
            UX 更清晰,sidebar 单入口。 */}
      </div>

      {/* Errors / success */}
      {error && (
        <div style={{ marginBottom: 12 }}>
          <ErrorBanner
            kind="error"
            message={`加载失败: ${error}`}
            onDismiss={() => setError(null)}
            testId="history-error"
          />
        </div>
      )}
      {successMsg && (
        <div style={{ marginBottom: 12 }}>
          <ErrorBanner
            kind="success"
            message={successMsg}
            onDismiss={() => setSuccessMsg(null)}
            autoDismissMs={5000}
            testId="history-success"
          />
        </div>
      )}

      {/* Filter bar */}
      <FilterBar
        tab={tab}
        filter={filter}
        onChange={setFilter}
        projectOptions={projectOptions}
        providerOptions={providerOptions}
        triggerKinds={TRIGGER_KINDS}
      />

      {/* Active tab table — [B1] backup tab 已移除,合并到「备份与恢复」页。 */}
      {tab === 'usage' ? (
        <UsageHistoryTable
          rows={usageRows}
          loading={loading}
          projects={projectList}
        />
      ) : (
        <DailyStatsTable rows={dailyRows} loading={loading} />
      )}

      {/* BUG-RF-08 — cursor-based pagination: "Load more" button.
        Click → loadMore() → fetches next pageSize rows using
        cursor (last id). hasMoreX is computed by the server-side
        result size < pageSize (i.e. the last page had fewer than
        `pageSize` rows, no more data). */}
      {((tab === 'usage' && hasMoreUsage) ||
        (tab === 'daily' && hasMoreDaily)) && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            marginTop: 16,
            marginBottom: 8,
          }}
        >
          <button
            type="button"
            data-testid="history-load-more"
            disabled={loadingMore}
            onClick={() => {
              void loadMore();
            }}
            style={{
              padding: '8px 20px',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-button)',
              background: 'var(--bg-elevated)',
              color: 'var(--text-primary)',
              fontSize: 13,
              cursor: loadingMore ? 'not-allowed' : 'pointer',
              opacity: loadingMore ? 0.6 : 1,
            }}
          >
            {loadingMore ? '加载中…' : `加载更多 (${pageSize} 条/页)`}
          </button>
        </div>
      )}

      {/* Export row */}
      <div
        style={{
          marginTop: 16,
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        <label
          style={{
            color: 'var(--text-muted)',
            fontSize: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          导出格式:
          <select
            value={exportFormat}
            onChange={(e) => setExportFormat(e.target.value as ExportFormat)}
            data-testid="export-format"
            style={{
              padding: '4px 8px',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-button)',
              background: 'var(--bg-elevated)',
              color: 'var(--text-primary)',
              fontSize: 12,
              fontFamily: 'inherit',
            }}
          >
            <option value="json">JSON</option>
            <option value="csv">CSV</option>
          </select>
        </label>
        <button
          type="button"
          onClick={() => {
            void handleExport();
          }}
          data-testid="export-btn"
          style={{
            padding: '6px 14px',
            border: 'none',
            borderRadius: 'var(--radius-button)',
            background: 'var(--accent)',
            color: '#fff',
            fontSize: 13,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          导出当前视图
        </button>
        <span
          style={{
            marginLeft: 'auto',
            color: 'var(--text-muted)',
            fontSize: 11,
          }}
          data-testid="history-stats"
          title={
            stats
              ? `db size: ${stats.db_size_bytes} bytes\n` +
                `first: ${stats.first_recorded_at ?? '—'}\n` +
                `last: ${stats.last_recorded_at ?? '—'}`
              : ''
          }
        >
          {stats
            ? `${stats.usage_rows} 用量 · ${stats.backup_rows} 备份`
            : '加载中…'}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tabButtonStyle(active: boolean): React.CSSProperties {
  return {
    padding: '10px 16px',
    border: 'none',
    borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
    marginBottom: '-1px',
    background: 'transparent',
    color: active ? 'var(--accent)' : 'var(--text-secondary)',
    fontSize: 14,
    fontWeight: active ? 600 : 400,
    cursor: 'pointer',
    fontFamily: 'inherit',
  };
}