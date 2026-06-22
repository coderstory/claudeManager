/**
 * F7 — 用量查询 (M3.8 cc-switch JSONL 集成).
 *
 * ## 数据流 (M3.8 重构)
 *
 *   1. 用户点 sidebar "用量查询"。
 *   2. Page mount → 并发 invoke `getCurrentUsage(window)` + `getUsageHistory(window)`
 *      (共享同一 `(provider_id, window)` cache key,后端只扫一次 JSONL)。
 *   3. Snapshot 渲染 3 大数字卡片 (tokens / cost / balance)。
 *   4. Breakdown 表格:每行 = 一个 model,展示 input/output/cache_read/cache_creation +
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

import { getCurrentUsage, getUsageHistory, refreshUsage } from '../../lib/api/usage';
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

// ---------------------------------------------------------------------------
// Page-level state
// ---------------------------------------------------------------------------

const DEFAULT_WINDOW: UsageWindow = '5h';
const WINDOWS: UsageWindow[] = ['5h', '1w', '1m'];

interface PageState {
  window: UsageWindow;
  snapshot: UsageSnapshot | null;
  history: UsageHistoryEntry[];
  loading: boolean;
  refreshing: boolean;
  error: { kind: string; message: string } | null;
}

const INITIAL_STATE: PageState = {
  window: DEFAULT_WINDOW,
  snapshot: null,
  history: [],
  loading: true,
  refreshing: false,
  error: null,
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
    setState((prev) => ({ ...prev, refreshing: true, error: null }));
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
            borderRadius: 4,
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
            borderRadius: 6,
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

      {/* Main cards */}
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

      {/* Per-model breakdown table */}
      <section
        style={{
          marginTop: 24,
          borderRadius: 8,
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
                <Th align="right">Cache Create</Th>
                <Th align="right">Total</Th>
                <Th align="right">Cost (USD)</Th>
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
                  <Td align="right">{row.cache_creation_tokens.toLocaleString()}</Td>
                  <Td align="right">
                    <strong>{row.total_tokens.toLocaleString()}</strong>
                  </Td>
                  <Td align="right">
                    {row.cost_usd != null ? `$${row.cost_usd.toFixed(4)}` : '—'}
                  </Td>
                  <Td align="right">{row.message_count}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* History chart */}
      <section
        style={{
          marginTop: 24,
          borderRadius: 8,
          border: '1px solid var(--border)',
          background: 'var(--bg-elevated)',
          padding: 16,
        }}
        data-testid="usage-history-section"
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 12,
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
            用量趋势 (按天)
          </h2>
          <span
            style={{
              color: 'var(--text-muted)',
              fontSize: 12,
            }}
          >
            {state.history.length} 条记录
          </span>
        </div>
        <HistoryChart history={state.history} loading={state.loading && state.history.length === 0} />
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
function HistoryChart({ history, loading }: { history: UsageHistoryEntry[]; loading: boolean }): ReactElement {
  const W = 800;
  const H = 200;
  const PAD = 24;

  // Aggregate by date — one bar per date, stacked per model.
  const buckets = useMemo(() => {
    const byDate = new Map<string, Map<string, number>>();
    const models = new Set<string>();
    for (const h of history) {
      let m = byDate.get(h.date);
      if (!m) {
        m = new Map();
        byDate.set(h.date, m);
      }
      m.set(h.model, (m.get(h.model) ?? 0) + h.tokens);
      models.add(h.model);
    }
    const sortedDates = Array.from(byDate.keys()).sort();
    const sortedModels = Array.from(models).sort();
    return { byDate, sortedDates, sortedModels };
  }, [history]);

  const maxTotal = useMemo(() => {
    let max = 0;
    for (const [, m] of buckets.byDate) {
      let sum = 0;
      for (const v of m.values()) sum += v;
      if (sum > max) max = sum;
    }
    return Math.max(max, 1);
  }, [buckets]);

  if (loading) {
    return (
      <div
        data-app-pulse="true"
        style={{
          height: H,
          borderRadius: 4,
          background: 'var(--bg-overlay)',
        }}
      />
    );
  }
  if (history.length === 0) {
    return (
      <p
        style={{
          color: 'var(--text-muted)',
          fontSize: 13,
          textAlign: 'center',
          padding: 16,
          margin: 0,
        }}
        data-testid="usage-history-empty"
      >
        暂无趋势数据
      </p>
    );
  }

  const colCount = buckets.sortedDates.length;
  const colWidth = colCount > 0 ? (W - PAD * 2) / colCount : 0;
  const innerH = H - PAD * 2;

  // Color palette per model (deterministic hash → hue).
  function colorFor(model: string): string {
    let h = 0;
    for (let i = 0; i < model.length; i++) h = (h * 31 + model.charCodeAt(i)) | 0;
    const hue = Math.abs(h) % 360;
    return `hsl(${hue}, 65%, 55%)`;
  }

  return (
    <div data-testid="usage-history-chart">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ height: H, width: '100%', display: 'block' }}
        preserveAspectRatio="none"
      >
        {buckets.sortedDates.map((date, i) => {
          const m = buckets.byDate.get(date)!;
          const x = PAD + i * colWidth;
          let yCursor = PAD;
          const total = Array.from(m.values()).reduce((a, b) => a + b, 0);
          return (
            <g key={date}>
              {buckets.sortedModels.map((model) => {
                const v = m.get(model) ?? 0;
                if (v === 0) return null;
                const segH = (v / maxTotal) * innerH;
                const segY = PAD + innerH - (yCursor - PAD + segH);
                yCursor += segH;
                return (
                  <rect
                    key={model}
                    x={x}
                    y={segY}
                    width={Math.max(colWidth - 2, 1)}
                    height={segH}
                    fill={colorFor(model)}
                    opacity={0.85}
                  />
                );
              })}
              {/* X-axis label */}
              <text
                x={x + colWidth / 2}
                y={H - 4}
                textAnchor="middle"
                style={{
                  fill: 'var(--text-muted)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 9,
                }}
              >
                {date.slice(5)}
              </text>
              {/* Total above bar */}
              {total > 0 && (
                <text
                  x={x + colWidth / 2}
                  y={PAD - 4}
                  textAnchor="middle"
                  style={{
                    fill: 'var(--text-muted)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 9,
                  }}
                >
                  {total.toLocaleString()}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {/* Legend */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 12,
          marginTop: 8,
          fontSize: 11,
          color: 'var(--text-muted)',
          fontFamily: 'var(--font-mono)',
        }}
        data-testid="usage-history-legend"
      >
        {buckets.sortedModels.map((model) => (
          <span key={model} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span
              style={{
                width: 10,
                height: 10,
                background: colorFor(model),
                borderRadius: 2,
                display: 'inline-block',
              }}
            />
            {model}
          </span>
        ))}
      </div>
    </div>
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
      return { snapshot: snap, history, loading: false, refreshing: false, error: null };
    }
    // Concurrent — they hit the same (provider_id, window) cache
    // key on the Rust side; only one JSONL scan happens.
    const [snap, history] = await Promise.all([
      getCurrentUsage(window),
      getUsageHistory(window),
    ]);
    return { snapshot: snap, history, loading: false, refreshing: false, error: null };
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    const kind = classifyUsageError(raw);
    const message = USAGE_ERROR_MESSAGES[kind] ?? `查询失败: ${raw}`;
    return { loading: false, refreshing: false, error: { kind, message } };
  }
}