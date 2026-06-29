/**
 * F7 — 用量查询 (M3.8 cc-switch JSONL 集成).
 *
 * ## 数据流 (M3.8 重构)
 *
 *   1. 用户点 sidebar "用量查询"。
 *   2. Page mount → 并发 invoke `getCurrentUsage(window)` + `getUsageHistory(window)`
 *      (共享同一 `(provider_id, window)` cache key,后端只扫一次 JSONL)。
 *   3. Snapshot 渲染 3 大数字卡片 (tokens / cost / balance)。
 *   4. Breakdown 表格:每行 = 一个 model,展示 input/output/cache_read +
 *      费用 (内置价格表查不到 → 显示 "—")。
 *   5. History 图表:手绘 SVG,per-day stacked bar (per-model color)。
 *   6. 错误 → 4 类本地化 banner (PermissionDenied / EncodingError / PathUnresolved / IO/JSON)。
 *   7. "刷新" 按钮 → `refreshUsage(window)` → drop cache + 重扫 JSONL。
 *
 * ## 设计取舍 (CLAUDE.md §5 + SPEC §5.7)
 *
 * - **Breakdown 表格 + history chart 替代 sparkline**:sparkline 是单点,
 *   breakdown 是 M3.8 ship 的核心价值(让用户看到哪个 model 在烧钱)。
 * - **4 类错误本地化**:UI 不显示原始 Rust 错误,统一映射成 `USAGE_ERROR_MESSAGES`。
 * - **无外部图表库**:history 仍然手绘 SVG stacked bar (~30 行),保持零依赖。
 * - **breakdown 永远不显示空数组**:空 = 显示 "暂无数据" 占位行,不渲染 0 行。
 *
 * ## M2.x-inline (保留 — 无 Tailwind pipeline)
 *
 * Project 无 Tailwind pipeline,所有 utility class 改成内联 style 或
 * `[data-app-*]` attribute + shared `@keyframes` (utilities.css)。
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { ReactElement } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

import { getCurrentUsage, getDailyStatsHistory, getUsageHistory, refreshUsage, type DailyStatRow } from '../../lib/api/usage';
import {
  classifyUsageError,
  USAGE_ERROR_MESSAGES,
} from '../../types/usage';
import type {
  UsageBreakdownEntry,
  UsageHistoryEntry,
  UsageSnapshot,
  UsageWindow,
} from '../../types/usage';
import { WINDOW_LABELS } from '../../types/usage';
import { useViewState } from '../../hooks/useViewState';
import { formatChineseTokenCount } from '../../lib/format';

// ---------------------------------------------------------------------------
// Page-level state
// ---------------------------------------------------------------------------

const DEFAULT_WINDOW: UsageWindow = '5h';
const WINDOWS: UsageWindow[] = ['5h', '1w', '1m'];

interface PageState {
  window: UsageWindow;
  snapshot: UsageSnapshot | null;
  history: UsageHistoryEntry[];
  /**
   * M5 bug #16 — past 7 days of aggregated usage from SQLite
   * `usage_daily_stats`. Drives the trend chart; falls back to
   * today's `history` when empty.
   */
  trend: DailyStatRow[];
  loading: boolean;
  refreshing: boolean;
  error: { kind: string; message: string } | null;
  /**
   * Phase 27 Fix 2 (BUG-CR-02 / D-09) — last successful refresh's
   * `inserted_rows` count. Surfaces a non-blocking toast banner
   * ("已写入 N 条") so the user can see whether their click on
   * "刷新" actually wrote anything to SQLite (CLAUDE.md §7 —
   * never silently swallow failures).
   */
  refreshToast: { inserted: number; at: number } | null;
}

const INITIAL_STATE: PageState = {
  window: DEFAULT_WINDOW,
  snapshot: null,
  history: [],
  trend: [],
  loading: true,
  refreshing: false,
  error: null,
  refreshToast: null,
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function UsageQueryPage(): ReactElement {
  const [state, setState] = useState<PageState>(INITIAL_STATE);
  // M4.6 / Phase 21-C — F21 history link-out (jump to history tab).
  const { setView } = useViewState();

  // Initial load (5h) — snapshot + history in parallel.
  useEffect(() => {
    let cancelled = false;
    void loadAll(DEFAULT_WINDOW, false).then((patch) => {
      if (!cancelled) setState((prev) => ({ ...prev, ...patch }));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleWindowChange = useCallback((next: UsageWindow) => {
    setState((prev) => ({ ...prev, window: next, loading: true, error: null }));
    void loadAll(next, false).then((patch) => {
      setState((prev) => ({ ...prev, ...patch }));
    });
  }, []);

  const handleRefresh = useCallback(() => {
    setState((prev) => ({
      ...prev,
      refreshing: true,
      error: null,
      // Phase 27 Fix 2 (BUG-CR-02 / D-09) — clear any stale toast
      // before kicking off the new refresh so the user sees a
      // single "fresh" toast (vs the previous one lingering).
      refreshToast: null,
    }));
    void loadAll(state.window, true).then((patch) => {
      setState((prev) => ({ ...prev, ...patch }));
    });
  }, [state.window]);

  // ---- derived display strings ----

  const lastFetchedLabel = useMemo(() => {
    if (!state.snapshot) return null;
    const d = new Date(state.snapshot.timestamp * 1000);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleTimeString();
  }, [state.snapshot]);

  const tokensLabel = useMemo(() => {
    if (!state.snapshot) return '—';
    return formatChineseTokenCount(state.snapshot.tokens_used);
  }, [state.snapshot]);

  const breakdown: UsageBreakdownEntry[] = state.snapshot?.breakdown ?? [];
  const isEmpty =
    !!state.snapshot && state.snapshot.tokens_used === 0 && !state.error;

  return (
    <div
      style={{
        marginLeft: 'auto',
        marginRight: 'auto',
        width: '100%',
        maxWidth: 720,
        padding: 24,
      }}
      data-testid="usage-query-page"
    >
      <header style={{ marginBottom: 'var(--space-4)' }}>
        <h1
          style={{
            color: 'var(--text-primary)',
            fontSize: 'var(--fs-heading)',
            fontWeight: 600,
            margin: 0,
          }}
        >
          用量查询
        </h1>
        <p
          style={{
            color: 'var(--text-secondary)',
            fontSize: 14,
            marginTop: 4,
          }}
        >
          读取 ~/.claude/projects/&lt;encoded-path&gt;/*.jsonl,聚合 token 用量与费用。
          5 分钟内存缓存。
        </p>
      </header>

      {/* Window toggle group */}
      <div
        role="group"
        aria-label="时间窗"
        data-testid="usage-window-group"
        style={{
          marginBottom: 16,
          display: 'inline-flex',
          borderRadius: 'var(--radius-button)',
          border: '1px solid var(--border)',
          background: 'var(--bg-elevated)',
          padding: 4,
        }}
      >
        {WINDOWS.map((w) => {
          const active = state.window === w;
          return (
            <button
              key={w}
              type="button"
              onClick={() => handleWindowChange(w)}
              aria-pressed={active}
              data-testid={`usage-window-${w}`}
              data-app-toggle="true"
              data-app-toggle-active={active ? 'true' : 'false'}
              style={{
                paddingLeft: 16,
                paddingRight: 16,
                paddingTop: 6,
                paddingBottom: 6,
                fontSize: 14,
                borderRadius: 'var(--radius-button)',
                border: 'none',
                cursor: 'pointer',
                background: active ? 'var(--accent)' : 'transparent',
                color: active ? '#fff' : 'var(--text-secondary)',
                boxShadow: active ? 'var(--shadow-sm)' : 'none',
                fontFamily: 'inherit',
              }}
            >
              {WINDOW_LABELS[w]}
            </button>
          );
        })}
      </div>

      {/* Refresh button + last-fetched label */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          marginBottom: 24,
        }}
      >
        <button
          type="button"
          onClick={handleRefresh}
          disabled={state.refreshing}
          data-app-refresh-btn="true"
          data-testid="usage-refresh-btn"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            borderRadius: 'var(--radius-button)',
            border: '1px solid var(--border)',
            background: 'var(--bg-elevated)',
            paddingLeft: 12,
            paddingRight: 12,
            paddingTop: 6,
            paddingBottom: 6,
            fontSize: 14,
            color: 'var(--text-primary)',
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          <RefreshCw
            data-app-spin={state.refreshing ? 'true' : undefined}
            style={{ height: 16, width: 16 }}
          />
          刷新
        </button>
        {lastFetchedLabel && (
          <span
            style={{
              color: 'var(--text-muted)',
              fontSize: 12,
            }}
            data-testid="usage-last-fetched"
          >
            最后更新: {lastFetchedLabel}
          </span>
        )}
        {/* M4.6 / Phase 21-C — F21 link: jump to history page
            (用量 tab 自动激活). 保持 F7 主流程独立,只是 "长期记录"
            入口, 不替换 F7 自己的 5 分钟内存缓存 chart. */}
        <button
          type="button"
          onClick={() => setView('history')}
          data-testid="goto-history"
          aria-label="查看用量历史"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            borderRadius: 'var(--radius-button)',
            border: '1px solid var(--border)',
            background: 'var(--bg-elevated)',
            paddingLeft: 12,
            paddingRight: 12,
            paddingTop: 6,
            paddingBottom: 6,
            fontSize: 13,
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            fontFamily: 'inherit',
            marginLeft: 'auto',
          }}
        >
          查看用量历史 →
        </button>
      </div>

      {/* Localised error banner */}
      {state.error && (
        <div
          data-testid="usage-error"
          role="alert"
          data-usage-error-kind={state.error.kind}
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 8,
            borderRadius: 'var(--radius-button)',
            border: '1px solid rgba(211, 47, 47, 0.3)',
            background: 'rgba(211, 47, 47, 0.05)',
            padding: 12,
            fontSize: 14,
            color: 'var(--danger)',
            marginBottom: 16,
          }}
        >
          <AlertCircle
            aria-hidden="true"
            style={{
              marginTop: 2,
              height: 16,
              width: 16,
              flexShrink: 0,
            }}
          />
          <span>{state.error.message}</span>
        </div>
      )}

      {/* Phase 27 Fix 2 (BUG-CR-02 / D-09) — refresh-success toast.
          Shows "已写入 N 条用量记录到 SQLite" (or "刷新成功 — 无新增" when
          0 rows were inserted — better than silent success). Lives
          below the error banner; does not stack over the chart. */}
      {state.refreshToast && !state.error && (
        <div
          data-testid="usage-refresh-toast"
          role="status"
          data-inserted-rows={state.refreshToast.inserted}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            borderRadius: 'var(--radius-button)',
            border: '1px solid rgba(56, 142, 60, 0.3)',
            background: 'rgba(56, 142, 60, 0.05)',
            padding: '8px 12px',
            fontSize: 13,
            color: 'var(--success)',
            marginBottom: 16,
          }}
        >
          <span>
            {state.refreshToast.inserted > 0
              ? `刷新成功 — 已写入 ${state.refreshToast.inserted} 条用量记录到 SQLite`
              : '刷新成功 — 无新增用量记录'}
          </span>
        </div>
      )}

      {/* Main cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(1, minmax(0, 1fr))',
          gap: 16,
        }}
      >
        <Card
          title="总 Token"
          testId="usage-card-tokens"
          loading={state.loading && !state.snapshot}
        >
          <div
            style={{
              color: 'var(--text-primary)',
              fontSize: 30,
              fontWeight: 600,
              fontVariantNumeric: 'tabular-nums',
            }}
            data-testid="usage-tokens-value"
          >
            {tokensLabel}
          </div>
        </Card>
      </div>

      {/* Per-model breakdown table */}
      <section
        style={{
          marginTop: 24,
          borderRadius: 'var(--radius-card)',
          border: '1px solid var(--border)',
          background: 'var(--bg-elevated)',
          padding: 16,
        }}
        data-testid="usage-breakdown-section"
      >
        <h2
          style={{
            color: 'var(--text-secondary)',
            fontSize: 14,
            fontWeight: 500,
            margin: 0,
            marginBottom: 12,
          }}
        >
          按 Model 拆分
        </h2>
        {breakdown.length === 0 ? (
          <p
            style={{
              color: 'var(--text-muted)',
              fontSize: 13,
              textAlign: 'center',
              padding: 16,
              margin: 0,
            }}
            data-testid="usage-breakdown-empty"
          >
            暂无数据
          </p>
        ) : (
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: 13,
              fontFamily: 'var(--font-mono)',
            }}
            data-testid="usage-breakdown-table"
          >
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <Th>Model</Th>
                <Th align="right">Input</Th>
                <Th align="right">Output</Th>
                <Th align="right">Cache Read</Th>
                <Th align="right">Total</Th>
                <Th align="right"># Msgs</Th>
              </tr>
            </thead>
            <tbody>
              {breakdown.map((row) => (
                <tr
                  key={row.model}
                  style={{ borderBottom: '1px solid var(--border)' }}
                  data-testid={`usage-breakdown-row-${row.model}`}
                >
                  <Td>
                    <span style={{ fontFamily: 'var(--font-mono)' }}>
                      {row.model}
                    </span>
                  </Td>
                  <Td align="right">{row.input_tokens.toLocaleString()}</Td>
                  <Td align="right">{row.output_tokens.toLocaleString()}</Td>
                  <Td align="right">{row.cache_read_tokens.toLocaleString()}</Td>
                  <Td align="right">
                    <strong>{row.total_tokens.toLocaleString()}</strong>
                  </Td>
                  <Td align="right">{row.message_count}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* M5 bug #16 — 近 7 天趋势 (SQLite-backed daily stats). Renders
          one bar per day (oldest → newest) so users see trends across
          days instead of just "today's bucket". Falls back gracefully
          when the SQLite table is empty (new install / no snapshots yet). */}
      <section
        data-testid="usage-trend-section"
        style={{
          marginTop: 24,
          borderRadius: 'var(--radius-card)',
          border: '1px solid var(--border)',
          background: 'var(--bg-elevated)',
          padding: 16,
        }}
      >
        <h2
          style={{
            color: 'var(--text-secondary)',
            fontSize: 14,
            fontWeight: 500,
            margin: 0,
            marginBottom: 12,
          }}
        >
          近 7 天趋势
        </h2>
        <TrendChart trend={state.trend} />
      </section>

      {/* Empty state hint */}
      {isEmpty && (
        <p
          style={{
            color: 'var(--text-muted)',
            fontSize: 14,
            textAlign: 'center',
            marginTop: 16,
          }}
          data-testid="usage-empty-hint"
        >
          暂无数据 — 等待 Claude Code 写入{' '}
          <code
            style={{
              borderRadius: 'var(--radius-button)',
              background: 'var(--bg-overlay)',
              paddingLeft: 4,
              paddingRight: 4,
              paddingTop: 2,
              paddingBottom: 2,
              fontSize: 12,
              fontFamily: 'var(--font-mono)',
            }}
          >
            ~/.claude/projects/&lt;encoded&gt;/*.jsonl
          </code>
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface CardProps {
  title: string;
  testId: string;
  loading: boolean;
  children: ReactElement;
}

function Card({ title, testId, loading, children }: CardProps): ReactElement {
  return (
    <div
      style={{
        borderRadius: 'var(--radius-card)',
        border: '1px solid var(--border)',
        background: 'var(--bg-elevated)',
        padding: 20,
      }}
      data-testid={testId}
    >
      <div
        style={{
          color: 'var(--text-muted)',
          fontSize: 12,
          textTransform: 'uppercase',
          letterSpacing: '0.025em',
          marginBottom: 8,
        }}
      >
        {title}
      </div>
      {loading ? (
        <div
          data-app-pulse="true"
          style={{
            height: 36,
            width: 96,
            borderRadius: 'var(--radius-button)',
            background: 'var(--bg-overlay)',
          }}
        />
      ) : (
        children
      )}
    </div>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: 'left' | 'right' }): ReactElement {
  return (
    <th
      style={{
        textAlign: align ?? 'left',
        color: 'var(--text-muted)',
        fontWeight: 500,
        padding: '6px 8px',
        fontSize: 12,
        textTransform: 'uppercase',
        letterSpacing: '0.025em',
      }}
    >
      {children}
    </th>
  );
}

function Td({ children, align }: { children: React.ReactNode; align?: 'left' | 'right' }): ReactElement {
  return (
    <td
      style={{
        textAlign: align ?? 'left',
        padding: '8px 8px',
        color: 'var(--text-primary)',
      }}
    >
      {children}
    </td>
  );
}

/**
 * Per-day stacked bar chart. One column per day, stacked by model.
 * Hand-rolled SVG (~50 lines) — no chart lib.
 */
/**
 * M5 bug #16 — 7-day trend bar chart (one bar per day, oldest →
 * newest). Hand-rolled SVG, ~30 lines. Shows dates on x-axis and
 * tokens on y-axis. Falls back to a "暂无趋势" hint when the daily
 * stats table is empty (e.g. fresh install before first refresh).
 */
function TrendChart({ trend }: { trend: DailyStatRow[] | null }): ReactElement {
  const W = 600;
  const H = 160;
  const PAD = 24;

  if (!trend || trend.length === 0) {
    return (
      <div
        data-testid="usage-trend-empty"
        style={{
          color: 'var(--text-muted)',
          fontSize: 12,
          padding: '24px 0',
          textAlign: 'center',
        }}
      >
        暂无 7 天趋势数据 — 刷新用量后会写入 SQLite
      </div>
    );
  }

  // Rows come back sorted DESC by stat_date (newest first); reverse
  // for left-to-right chronological display.
  const ordered = [...trend].sort((a, b) =>
    a.stat_date < b.stat_date ? -1 : a.stat_date > b.stat_date ? 1 : 0,
  );
  const maxTokens = Math.max(1, ...ordered.map((r) => r.tokens_used));
  const barW = (W - PAD * 2) / ordered.length;

  return (
    <svg
      data-testid="usage-trend-chart"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      style={{ width: '100%', height: 160, display: 'block' }}
    >
      {ordered.map((r, i) => {
        const h = (r.tokens_used / maxTokens) * (H - PAD * 2);
        const x = PAD + i * barW + barW * 0.15;
        const y = H - PAD - h;
        return (
          <g key={r.stat_date}>
            <rect
              data-testid={`usage-trend-bar-${r.stat_date}`}
              x={x}
              y={y}
              width={barW * 0.7}
              height={h}
              rx={2}
              fill="var(--accent)"
              opacity={0.85}
            />
            <text
              x={x + barW * 0.35}
              y={H - 8}
              textAnchor="middle"
              fontSize={10}
              fill="var(--text-muted)"
            >
              {r.stat_date.slice(5)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}


// ---------------------------------------------------------------------------
// Async helper
// ---------------------------------------------------------------------------

async function loadAll(
  window: UsageWindow,
  forceRefresh: boolean,
): Promise<Partial<PageState>> {
  try {
    if (forceRefresh) {
      // Refresh drops the snapshot cache; history shares the same
      // key so we re-fetch it too.
      const snap = await refreshUsage(window);
      const history = await getUsageHistory(window);
      const trend = await fetchSevenDayTrend(snap.provider_id);
      // Phase 27 Fix 2 (BUG-CR-02 / D-09) — capture the inserted
      // row count for the toast banner. Always show the toast on a
      // successful refresh (even when 0 rows were inserted) so the
      // user gets explicit "刷新成功 — 已写入 N 条" feedback instead
      // of a silent no-op. CLAUDE.md §7 — never silently swallow.
      const inserted = snap.inserted_rows ?? 0;
      return {
        snapshot: snap,
        history,
        trend,
        loading: false,
        refreshing: false,
        error: null,
        refreshToast: { inserted, at: Date.now() },
      };
    }
    // Concurrent — they hit the same (provider_id, window) cache
    // key on the Rust side; only one JSONL scan happens.
    const [snap, history] = await Promise.all([
      getCurrentUsage(window),
      getUsageHistory(window),
    ]);
    const trend = await fetchSevenDayTrend(snap.provider_id);
    return {
      snapshot: snap,
      history,
      trend,
      loading: false,
      refreshing: false,
      error: null,
    };
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    const kind = classifyUsageError(raw);
    const message = USAGE_ERROR_MESSAGES[kind] ?? `查询失败: ${raw}`;
    return { loading: false, refreshing: false, error: { kind, message } };
  }
}

/**
 * M5 bug #16 — fetch the past 7 days of aggregated usage from the
 * SQLite-backed `usage_daily_stats` table. Returns one row per day
 * (oldest → newest) so the chart can render the trend without gaps.
 * Failure is non-fatal — we fall back to an empty array and let the
 * chart show only the in-memory history (today's data).
 */
async function fetchSevenDayTrend(
  providerId: string,
): Promise<DailyStatRow[]> {
  const today = new Date();
  const from = new Date(today.getTime() - 6 * 86400_000); // inclusive 7 days
  const fmt = (d: Date): string => d.toISOString().slice(0, 10);
  try {
    return await getDailyStatsHistory({
      provider_id: providerId,
      from_date: fmt(from),
      to_date: fmt(today),
      limit: 7,
    });
  } catch {
    return [];
  }
}
