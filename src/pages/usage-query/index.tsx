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
 *
 * ## M2.x-inline
 *
 * Previously this page composed ~25 Tailwind utility classes
 * (`mx-auto w-full max-w-4xl p-6`, `mb-4 inline-flex rounded-md
 * border border-border bg-bg-elevated p-1`, `inline-flex items-center
 * gap-1.5 ... hover:bg-bg-overlay disabled:opacity-60`,
 * `animate-spin`, `grid grid-cols-1 gap-4 md:grid-cols-3`,
 * `text-3xl font-semibold tabular-nums text-text-primary`,
 * `h-9 w-24 animate-pulse rounded bg-bg-overlay`, etc). The
 * project has no Tailwind pipeline, so all those classes silently
 * noop'd on the real Tauri WebView2 release exe. Every utility
 * class is now inlined as `style={{}}` properties; hover/active/
 * animation rules live in src/design-system/utilities.css under
 * `[data-app-toggle]` / `[data-app-refresh-btn]` / `[data-app-spin]`
 * / `[data-app-pulse]`.
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
      style={{
        marginLeft: 'auto',
        marginRight: 'auto',
        width: '100%',
        maxWidth: 896,
        padding: 24,
      }}
      data-testid="usage-query-page"
    >
      <header style={{ marginBottom: 16 }}>
        <h1
          style={{
            color: 'var(--text-primary)',
            fontSize: 24,
            fontWeight: 600,
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
          查看当前 active provider 的 token 用量、费用与余额。5 分钟内存缓存。
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
          borderRadius: 6,
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
              // M2.x-inline: hover/active rule lives in
              // src/design-system/utilities.css under [data-app-toggle].
              data-app-toggle="true"
              data-app-toggle-active={active ? 'true' : 'false'}
              style={{
                paddingLeft: 16,
                paddingRight: 16,
                paddingTop: 6,
                paddingBottom: 6,
                fontSize: 14,
                borderRadius: 4,
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
          marginBottom: 24,
        }}
      >
        <button
          type="button"
          onClick={handleRefresh}
          disabled={state.refreshing}
          // M2.x-inline: hover/disabled rules live in
          // src/design-system/utilities.css under [data-app-refresh-btn].
          data-app-refresh-btn="true"
          data-testid="usage-refresh-btn"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            borderRadius: 4,
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
            // M2.x-inline: animate-spin → data-app-spin attribute +
            // shared @keyframes ccm-spin in utilities.css.
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
      </div>

      {/* Error InfoBar */}
      {state.error && (
        <div
          data-testid="usage-error"
          role="alert"
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 8,
            borderRadius: 6,
            // --danger at 30% alpha (was `border-danger/30`).
            border: '1px solid rgba(211, 47, 47, 0.3)',
            // --danger at 5% alpha (was `bg-danger/5`).
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
          <span>{state.error}</span>
        </div>
      )}

      {/* Main cards — was `grid grid-cols-1 gap-4 md:grid-cols-3`. Project has
          no Tailwind pipeline, so md: breakpoint was a silent noop on real
          exe (cards always rendered as 1 column). We pick a sensible
          3-column layout directly here — on narrow viewports the parent
          <main> overflow:auto lets the user scroll horizontally. */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          gap: 16,
        }}
      >
        <Card
          title="已用 Tokens"
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
        <Card
          title="费用 (USD)"
          testId="usage-card-cost"
          loading={state.loading && !state.snapshot}
        >
          <div
            style={{
              color: 'var(--text-primary)',
              fontSize: 30,
              fontWeight: 600,
              fontVariantNumeric: 'tabular-nums',
            }}
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
            style={{
              color: 'var(--text-primary)',
              fontSize: 30,
              fontWeight: 600,
              fontVariantNumeric: 'tabular-nums',
            }}
            data-testid="usage-balance-value"
          >
            {balanceLabel ?? '—'}
          </div>
        </Card>
      </div>

      {/* Sparkline (M2.7 placeholder — single-point; M2.8+ adds history) */}
      <div
        style={{
          marginTop: 24,
          borderRadius: 8,
          border: '1px solid var(--border)',
          background: 'var(--bg-elevated)',
          padding: 16,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 8,
          }}
        >
          <h2
            style={{
              color: 'var(--text-secondary)',
              fontSize: 14,
              fontWeight: 500,
              margin: 0,
            }}
          >
            用量趋势
          </h2>
          <span
            style={{
              color: 'var(--text-muted)',
              fontSize: 12,
            }}
          >
            M2.7 占位 — 历史趋势 M2.8+
          </span>
        </div>
        <Sparkline value={state.snapshot?.tokens_used ?? 0} />
      </div>

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
              borderRadius: 4,
              background: 'var(--bg-overlay)',
              paddingLeft: 4,
              paddingRight: 4,
              paddingTop: 2,
              paddingBottom: 2,
              fontSize: 12,
              fontFamily: 'var(--font-mono)',
            }}
          >
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
      style={{
        borderRadius: 8,
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
        // M2.x-inline: animate-pulse → data-app-pulse attribute +
        // shared @keyframes ccm-pulse in utilities.css.
        <div
          data-app-pulse="true"
          style={{
            height: 36,
            width: 96,
            borderRadius: 4,
            background: 'var(--bg-overlay)',
          }}
        />
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
      style={{ height: 64, width: '100%', display: 'block' }}
      data-testid="usage-sparkline"
      preserveAspectRatio="none"
    >
      <line
        x1={x1}
        y1={y}
        x2={x2}
        y2={y}
        stroke="currentColor"
        style={{ color: 'var(--accent)' }}
        strokeWidth={2}
      />
      <text
        x={W / 2}
        y={y - 6}
        textAnchor="middle"
        style={{ fill: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
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