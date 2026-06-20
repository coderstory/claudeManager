/**
 * F7 — 用量查询 (M2.7 real implementation).
 *
 * User flow (per docs/design/M2.7-dataflow.md):
 *   1. User clicks the sidebar "用量查询" tile.
 *   2. The page mounts and calls `getCurrentUsage` for the default
 *      window (`5h`).
 *   3. The page renders a large number for `tokens_used`, plus
 *      `cost_usd` (if present), `balance_usd` (if present), and a
 *      small "最后刷新" timestamp.
 *   4. A 3-button toggle group lets the user switch between
 *      `5h` / `1w` / `1m` windows. Switching re-invokes the command
 *      (the Rust-side cache may hit if the same window was queried
 *      within 5 minutes — the timestamp updates only on a fresh
 *      read).
 *   5. The "刷新" button calls `refreshUsage`, which bypasses the
 *      cache and re-reads `~/.claude/usage.json`.
 *
 * ## Design choices (CLAUDE.md §5 + SPEC §5.7)
 *
 * - **Window toggle is a 3-button group**, not a dropdown — quota
 *   windows are the page's primary control.
 * - **Sparkline**: M2.7 ships a placeholder sparkline built from
 *   the single current snapshot (constant value, shown as a flat
 *   line). Real trend (last 24 queries) lands in M2.8+. This is
 *   intentionally visible — a single-point sparkline tells the
 *   user "no history yet" without a confusing empty state.
 * - **Error state**: any IPC error surfaces via InfoBar. Missing
 *   `usage.json` or empty snapshot is NOT an error — the page
 *   shows "暂无数据" instead.
 * - **No external libraries**: sparkline is hand-rolled SVG
 *   (~10 lines). State is plain `useState`.
 *
 * ## Security
 *
 * All IPC calls go through Tauri's `invoke`. The backend scopes
 * reads to `~/.claude/usage.json` (via `UsageService` deriving
 * the path from `AppPaths::claude_dir()`). The page cannot ask
 * the backend to read arbitrary paths.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { ReactElement } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

import { getCurrentUsage, refreshUsage } from '../../lib/api/usage';
import type { UsageSnapshot, UsageWindow } from '../../types/usage';
import { WINDOW_LABELS } from '../../types/usage';

// ---------------------------------------------------------------------------
// Page-level state
// ---------------------------------------------------------------------------

const DEFAULT_WINDOW: UsageWindow = '5h';
const WINDOWS: UsageWindow[] = ['5h', '1w', '1m'];

interface PageState {
  window: UsageWindow;
  snapshot: UsageSnapshot | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
}

const INITIAL_STATE: PageState = {
  window: DEFAULT_WINDOW,
  snapshot: null,
  loading: true,
  refreshing: false,
  error: null,
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function UsageQueryPage(): ReactElement {
  const [state, setState] = useState<PageState>(INITIAL_STATE);

  // Initial load (5h).
  useEffect(() => {
    let cancelled = false;
    void loadSnapshot(DEFAULT_WINDOW, false).then((patch) => {
      if (!cancelled) setState((prev) => ({ ...prev, ...patch }));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Re-query when the user toggles the window. Each toggle is its
  // own IPC call — the Rust cache may hit if we re-select the
  // current window within 5 minutes.
  const handleWindowChange = useCallback((next: UsageWindow) => {
    setState((prev) => ({ ...prev, window: next, loading: true, error: null }));
    void loadSnapshot(next, false).then((patch) => {
      setState((prev) => ({ ...prev, ...patch }));
    });
  }, []);

  const handleRefresh = useCallback(() => {
    setState((prev) => ({ ...prev, refreshing: true, error: null }));
    void loadSnapshot(state.window, true).then((patch) => {
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
    return state.snapshot.tokens_used.toLocaleString();
  }, [state.snapshot]);

  const costLabel = useMemo(() => {
    if (!state.snapshot || state.snapshot.cost_usd == null) return null;
    return `$${state.snapshot.cost_usd.toFixed(2)}`;
  }, [state.snapshot]);

  const balanceLabel = useMemo(() => {
    if (!state.snapshot || state.snapshot.balance_usd == null) return null;
    return `$${state.snapshot.balance_usd.toFixed(2)}`;
  }, [state.snapshot]);

  const isEmpty =
    !!state.snapshot && state.snapshot.tokens_used === 0 && !state.error;

  return (
    <div
      className="mx-auto w-full max-w-4xl p-6"
      data-testid="usage-query-page"
    >
      <header className="mb-4">
        <h1 className="text-2xl font-semibold text-text-primary">用量查询</h1>
        <p className="mt-1 text-sm text-text-secondary">
          查看当前 active provider 的 token 用量、费用与余额。5 分钟内存缓存。
        </p>
      </header>

      {/* Window toggle group */}
      <div
        className="mb-4 inline-flex rounded-md border border-border bg-bg-elevated p-1"
        role="group"
        aria-label="时间窗"
        data-testid="usage-window-group"
      >
        {WINDOWS.map((w) => (
          <button
            key={w}
            type="button"
            onClick={() => handleWindowChange(w)}
            aria-pressed={state.window === w}
            className={
              'px-4 py-1.5 text-sm rounded transition-colors ' +
              (state.window === w
                ? 'bg-accent text-white shadow-sm'
                : 'text-text-secondary hover:text-text-primary')
            }
            data-testid={`usage-window-${w}`}
          >
            {WINDOW_LABELS[w]}
          </button>
        ))}
      </div>

      {/* Refresh button + last-fetched label */}
      <div className="mb-6 flex items-center justify-between">
        <button
          type="button"
          onClick={handleRefresh}
          disabled={state.refreshing}
          className="inline-flex items-center gap-1.5 rounded border border-border bg-bg-elevated px-3 py-1.5 text-sm text-text-primary hover:bg-bg-overlay disabled:opacity-60"
          data-testid="usage-refresh-btn"
        >
          <RefreshCw
            className={
              'h-4 w-4 ' + (state.refreshing ? 'animate-spin' : '')
            }
          />
          刷新
        </button>
        {lastFetchedLabel && (
          <span
            className="text-xs text-text-muted"
            data-testid="usage-last-fetched"
          >
            最后更新: {lastFetchedLabel}
          </span>
        )}
      </div>

      {/* Error InfoBar */}
      {state.error && (
        <div
          className="mb-4 flex items-start gap-2 rounded border border-danger/30 bg-danger/5 p-3 text-sm text-danger"
          data-testid="usage-error"
          role="alert"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>{state.error}</span>
        </div>
      )}

      {/* Main cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card
          title="已用 Tokens"
          testId="usage-card-tokens"
          loading={state.loading && !state.snapshot}
        >
          <div
            className="text-3xl font-semibold tabular-nums text-text-primary"
            data-testid="usage-tokens-value"
          >
            {tokensLabel}
          </div>
        </Card>
        <Card
          title="费用 (USD)"
          testId="usage-card-cost"
          loading={state.loading && !state.snapshot}
        >
          <div
            className="text-3xl font-semibold tabular-nums text-text-primary"
            data-testid="usage-cost-value"
          >
            {costLabel ?? '—'}
          </div>
        </Card>
        <Card
          title="余额 (USD)"
          testId="usage-card-balance"
          loading={state.loading && !state.snapshot}
        >
          <div
            className="text-3xl font-semibold tabular-nums text-text-primary"
            data-testid="usage-balance-value"
          >
            {balanceLabel ?? '—'}
          </div>
        </Card>
      </div>

      {/* Sparkline (M2.7 placeholder — single-point; M2.8+ adds history) */}
      <div className="mt-6 rounded-lg border border-border bg-bg-elevated p-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-medium text-text-secondary">
            用量趋势
          </h2>
          <span className="text-xs text-text-muted">
            M2.7 占位 — 历史趋势 M2.8+
          </span>
        </div>
        <Sparkline value={state.snapshot?.tokens_used ?? 0} />
      </div>

      {/* Empty state hint */}
      {isEmpty && (
        <p
          className="mt-4 text-center text-sm text-text-muted"
          data-testid="usage-empty-hint"
        >
          暂无数据 — 等待 Claude Code 写入{' '}
          <code className="rounded bg-bg-overlay px-1 py-0.5 text-xs">
            ~/.claude/usage.json
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
      className="rounded-lg border border-border bg-bg-elevated p-5"
      data-testid={testId}
    >
      <div className="mb-2 text-xs uppercase tracking-wide text-text-muted">
        {title}
      </div>
      {loading ? (
        <div className="h-9 w-24 animate-pulse rounded bg-bg-overlay" />
      ) : (
        children
      )}
    </div>
  );
}

/**
 * Tiny SVG sparkline. M2.7 renders a single-point line because the
 * cache only holds the current snapshot. M2.8+ will accept a
 * `points: number[]` prop and render the real history.
 */
function Sparkline({ value }: { value: number }): ReactElement {
  const W = 600;
  const H = 60;
  const y = value === 0 ? H / 2 : H / 2;
  const x1 = 0;
  const x2 = W;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-16 w-full"
      data-testid="usage-sparkline"
      preserveAspectRatio="none"
    >
      <line
        x1={x1}
        y1={y}
        x2={x2}
        y2={y}
        stroke="currentColor"
        className="text-accent"
        strokeWidth={2}
      />
      <text
        x={W / 2}
        y={y - 6}
        textAnchor="middle"
        className="fill-text-muted"
        fontSize={11}
      >
        当前值: {value.toLocaleString()}
      </text>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Async helper
// ---------------------------------------------------------------------------

async function loadSnapshot(
  window: UsageWindow,
  forceRefresh: boolean,
): Promise<Partial<PageState>> {
  try {
    const snap = forceRefresh
      ? await refreshUsage(window)
      : await getCurrentUsage(window);
    return {
      snapshot: snap,
      loading: false,
      refreshing: false,
      error: null,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      loading: false,
      refreshing: false,
      error: `查询失败: ${msg}`,
    };
  }
}