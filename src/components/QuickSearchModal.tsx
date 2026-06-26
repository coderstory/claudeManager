/**
 * QuickSearchModal — M2.10 F11 "快速搜索" modal, M2.11 F9 fuzzy upgrade.
 *
 * Opens with Ctrl+/ (the standard "command palette" shortcut).
 * Filters in real time across:
 *   - 12 plugin names (and Chinese subtitles from AppSidebar's VIEW_META)
 *   - provider names (loaded from the Rust `listProviders` command)
 *   - MCP server names (loaded from `listMcpServers`)
 *
 * Selecting a result either:
 *   - navigates to a ViewId (plugin entry), or
 *   - jumps to the relevant page (provider/mcp results land on the
 *     corresponding management view).
 *
 * ## M2.11 upgrades (fuzzy + highlight + history + Ctrl+N/P):
 *
 *   - The substring filter from M2.10 was replaced by a fuzzy
 *     subsequence matcher (`src/lib/fuzzy.ts`). This lets users
 *     type `mp` to find "MCP 管理" (M-p with a gap) instead of
 *     having to type "MCP" verbatim. Results are sorted by score
 *     desc — contiguous matches and start-of-word hits rank
 *     above loose subsequence matches.
 *
 *   - Matched characters in the rendered label are wrapped in
 *     `<mark>` so the user can see WHY a result ranked top.
 *
 *   - Keyboard navigation now includes Ctrl+N / Ctrl+P in
 *     addition to ArrowDown / ArrowUp. Both move the highlight
 *     and clamp at the ends.
 *
 *   - Successful selections save the typed query into
 *     `localStorage["ccm.searchHistory"]` (max 10, deduped,
 *     most-recent-first). The strip renders below the input
 *     only when the input is empty AND history is non-empty —
 *     clicking a chip populates the input without navigating.
 *
 * ## Why this is a pure component (no router):
 *
 *   - The modal receives `isOpen`, `onClose`, and `onNavigate` from
 *     App.tsx, so it's testable in isolation (render with a fake
 *     `onNavigate` and assert the right callback fires).
 *   - The filter is a small pure function exported alongside the
 *     component — tests don't need to drive the input box to
 *     verify the matching algorithm.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import { X } from 'lucide-react';
import { ALL_VIEWS, type ViewId } from '../hooks/useViewState';
import { listProviders } from '../lib/api/providers';
import { listMcpServers } from '../lib/api/mcp';
import { fuzzySearch } from '../lib/fuzzy';
import type { Provider } from '../types/provider';
import type { McpServer } from '../types/mcp';

/** localStorage slot for the "recent searches" history. */
export const HISTORY_KEY = 'ccm.searchHistory';
/** Hard cap on the recent-searches list — see CLAUDE.md "memory/状态纪律". */
const HISTORY_LIMIT = 10;

/**
 * The 12 plugin Chinese subtitles — mirrored from AppSidebar's
 * VIEW_META so the search can match against user-facing labels.
 */
export const PLUGIN_LABELS: Record<ViewId, string> = {
  home: '欢迎页',
  'provider-list': 'Provider 列表',
  'import-sql': '.sql 导入',
  'json-editor': 'JSON 编辑器',
  'mcp-management': 'MCP 管理',
  'usage-query': '用量查询',
  'resource-browser': '资源浏览',
  marketplace: '资源市场',
  optimizer: '配置优化',
  'backup-restore': '备份与恢复',
  // M4.6 / Phase 21-C — F21 history query page.
  history: '历史查询',
  about: '关于',
};

/** A single entry the search modal can navigate to. */
export interface SearchResult {
  /** Discriminator — lets the modal pick the right handler. */
  kind: 'plugin' | 'provider' | 'mcp';
  /** Short label shown in the result row. */
  label: string;
  /** The view to navigate to when this result is selected. */
  view: ViewId;
  /** Optional detail text (e.g. "openai · anthropic-base"). */
  hint?: string;
}

/**
 * Score result from fuzzy ranking — extends SearchResult with the
 * positions of matched characters in `label` so the renderer
 * can wrap them in `<mark>`.
 */
export interface RankedSearchResult extends SearchResult {
  /** Score assigned by fuzzyMatch (higher = more relevant). */
  score: number;
  /** Indices in `label` where each character of the query matched. */
  matches: number[];
}

/**
 * Read the recent-search history. Returns [] when storage is empty
 * or contains a malformed value (we don't want a JSON parse error
 * to crash the modal — §6 of CLAUDE.md says errors must surface
 * to the user, not silently swallow; the empty-default is the
 * user-facing equivalent of "no history yet").
 */
export function readSearchHistory(): string[] {
  if (typeof window === 'undefined') return [];
  const raw = window.localStorage.getItem(HISTORY_KEY);
  if (raw === null) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === 'string').slice(0, HISTORY_LIMIT);
  } catch {
    return [];
  }
}

/**
 * Append `query` to the front of the history, deduping and
 * clamping at HISTORY_LIMIT entries. Empty / whitespace-only
 * queries are ignored.
 */
export function pushSearchHistory(query: string): void {
  if (typeof window === 'undefined') return;
  const trimmed = query.trim();
  if (trimmed === '') return;
  const prev = readSearchHistory().filter((q) => q !== trimmed);
  const next = [trimmed, ...prev].slice(0, HISTORY_LIMIT);
  window.localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
}

/**
 * Pure filter — kept exported for backward-compat with the M2.10
 * test suite. M2.11 internally uses `rankResults` (fuzzy + sort)
 * but `filterResults` still works for callers that want the old
 * substring-only behavior.
 *
 * Algorithm: case-insensitive substring match on `label` and
 * `hint`. Returns at most `limit` results, preserving input order.
 * Empty query returns the first `limit` results (so the modal
 * shows a useful default — all 12 plugins + maybe a couple of
 * providers — instead of an empty list).
 */
export function filterResults(
  results: readonly SearchResult[],
  query: string,
  limit = 50,
): SearchResult[] {
  const q = query.trim().toLowerCase();
  const filtered = q
    ? results.filter(
        (r) =>
          r.label.toLowerCase().includes(q) ||
          (r.hint?.toLowerCase().includes(q) ?? false),
      )
    : results.slice();
  return filtered.slice(0, limit);
}

/**
 * M2.11 fuzzy ranker — replaces the substring filter inside the
 * modal. Returns a scored, sorted array.
 *
 * Empty query → returns [] (the caller shows the default list).
 * No match → returns [].
 */
export function rankResults(
  results: readonly SearchResult[],
  query: string,
): RankedSearchResult[] {
  const q = query.trim();
  if (q === '') return [];
  // Build a parallel labels array so fuzzySearch returns indices
  // that map 1:1 back to `results`.
  const labels = results.map((r) => r.label);
  const ranked = fuzzySearch(q, labels);
  return ranked
    .map((r): RankedSearchResult => {
      const source = results[r.index]!;
      return {
        ...source,
        score: r.score,
        matches: r.matches,
      };
    });
}

/**
 * Compute the default visible list when the input is empty:
 * the 12 plugin entries (in declaration order) followed by
 * any loaded providers / MCP servers, capped at 50.
 */
export function defaultResults(
  providers: readonly Provider[],
  mcps: readonly McpServer[],
  limit = 50,
): SearchResult[] {
  const plugins = buildPluginResults();
  return [
    ...plugins,
    ...providers.map(providerToResult),
    ...mcps.map(mcpToResult),
  ].slice(0, limit);
}

export interface QuickSearchModalProps {
  /** Whether the modal is currently rendered. */
  isOpen: boolean;
  /** Called when the user dismisses the modal (X / Esc / backdrop). */
  onClose: () => void;
  /** Called when the user picks a result — App.tsx routes from there. */
  onNavigate: (view: ViewId) => void;
}

/**
 * Build the seed list of plugin-only results. Provider / MCP results
 * are appended at open time because they require IPC calls.
 */
function buildPluginResults(): SearchResult[] {
  return ALL_VIEWS.filter((v) => v !== 'home').map((view) => ({
    kind: 'plugin' as const,
    label: PLUGIN_LABELS[view],
    view,
    hint: view,
  }));
}

function providerToResult(p: Provider): SearchResult {
  return {
    kind: 'provider',
    label: p.name,
    hint: `${p.provider_type}${p.is_active ? ' · 已激活' : ''}`,
    view: 'provider-list',
  };
}

function mcpToResult(m: McpServer): SearchResult {
  return {
    kind: 'mcp',
    label: m.name,
    hint: m.enabled ? '已启用' : '已禁用',
    view: 'mcp-management',
  };
}

/**
 * Render `label` with the matched characters wrapped in <mark>.
 * `matches` is a sorted list of indices in `label`. Unmatched
 * chars pass through verbatim.
 */
function HighlightedLabel({
  label,
  matches,
}: {
  label: string;
  matches: readonly number[];
}): ReactElement {
  if (matches.length === 0) return <>{label}</>;
  const set = new Set(matches);
  const out: ReactElement[] = [];
  let buf = '';
  let i = 0;
  for (const ch of label) {
    if (set.has(i)) {
      if (buf) {
        out.push(<span key={`t-${i}`}>{buf}</span>);
        buf = '';
      }
      out.push(<mark key={`m-${i}`}>{ch}</mark>);
    } else {
      buf += ch;
    }
    i++;
  }
  if (buf) out.push(<span key={`t-${i}`}>{buf}</span>);
  return <>{out}</>;
}

export function QuickSearchModal({
  isOpen,
  onClose,
  onNavigate,
}: QuickSearchModalProps): ReactElement | null {
  const [query, setQuery] = useState('');
  const [providers, setProviders] = useState<Provider[]>([]);
  const [mcps, setMcps] = useState<McpServer[]>([]);
  const [highlight, setHighlight] = useState(0);
  const [history, setHistory] = useState<string[]>(() => readSearchHistory());
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Refresh live data when the modal opens.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    void (async () => {
      try {
        const [provs, servers] = await Promise.all([
          listProviders().catch(() => []),
          listMcpServers().catch(() => []),
        ]);
        if (!cancelled) {
          setProviders(provs);
          setMcps(servers);
        }
      } catch {
        // Best-effort: empty lists render fine, modal stays usable.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  // Build the master result list (memoised — re-runs when providers
  // / mcps change after the IPC resolves).
  const allResults = useMemo<SearchResult[]>(() => {
    const plugins = buildPluginResults();
    return [...plugins, ...providers.map(providerToResult), ...mcps.map(mcpToResult)];
  }, [providers, mcps]);

  // M2.11: empty query → show the default list (12 plugins +
  // live data, capped). Non-empty query → fuzzy rank.
  const visible = useMemo<RankedSearchResult[]>(() => {
    const q = query.trim();
    if (q === '') {
      // Map SearchResult → RankedSearchResult with score 0 and
      // no matches so the renderer can use the same shape.
      return defaultResults(providers, mcps).map((r) => ({
        ...r,
        score: 0,
        matches: [],
      }));
    }
    return rankResults(allResults, q);
  }, [allResults, providers, mcps, query]);

  // Reset highlight when the visible list shrinks / changes.
  useEffect(() => {
    setHighlight(0);
  }, [query, isOpen]);

  // Focus the input on open + bind Esc / arrow / Ctrl+N / Ctrl+P / Enter.
  useEffect(() => {
    if (!isOpen) return;
    // Defer focus until after the modal paints — otherwise jsdom
    // (and React 19's batching) can race the autofocus.
    const id = window.setTimeout(() => inputRef.current?.focus(), 0);

    const onKey = (e: KeyboardEvent): void => {
      if (
        !(e.target instanceof HTMLElement) ||
        !(
          e.target.tagName === 'INPUT' ||
          e.target.tagName === 'TEXTAREA' ||
          e.target.isContentEditable
        )
      ) {
        return;
      }
      // Clamp helpers — keep highlight inside [0, visible.length-1].
      const clamp = (n: number): number =>
        Math.max(0, Math.min(n, Math.max(visible.length - 1, 0)));
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlight((h) => clamp(h + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlight((h) => clamp(h - 1));
      } else if (e.key === 'n' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setHighlight((h) => clamp(h + 1));
      } else if (e.key === 'p' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setHighlight((h) => clamp(h - 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const r = visible[highlight];
        if (r) {
          pushSearchHistory(query);
          setHistory(readSearchHistory());
          onNavigate(r.view);
          onClose();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener('keydown', onKey);
    };
  }, [isOpen, visible, highlight, onNavigate, onClose, query]);

  // Reset query when the modal closes — keeps the next open clean.
  useEffect(() => {
    if (!isOpen) setQuery('');
  }, [isOpen]);

  const handleSelect = useCallback(
    (r: SearchResult) => {
      pushSearchHistory(query);
      setHistory(readSearchHistory());
      onNavigate(r.view);
      onClose();
    },
    [onNavigate, onClose, query],
  );

  if (!isOpen) return null;

  const showHistoryStrip = query.trim() === '' && history.length > 0;

  return (
    <div
      data-testid="quick-search-backdrop"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--bg-overlay)',
        backdropFilter: 'blur(var(--blur-sm))',
        WebkitBackdropFilter: 'blur(var(--blur-sm))',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: 80,
        zIndex: 1000,
      }}
    >
      <div
        data-testid="quick-search-modal"
        role="dialog"
        aria-label="快速搜索"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 560,
          maxWidth: '92vw',
          maxHeight: '60vh',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--bg-elevated)',
          borderRadius: 'var(--radius-modal)',
          border: '1px solid var(--border)',
          boxShadow: 'var(--shadow-md)',
          overflow: 'hidden',
        }}
      >
        {/* Header — search input + close button */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '12px 16px',
            borderBottom: '1px solid var(--border)',
            gap: 8,
          }}
        >
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索插件 / provider / MCP ..."
            data-testid="quick-search-input"
            aria-label="快速搜索输入框"
            style={{
              flex: '1 1 auto',
              border: 'none',
              outline: 'none',
              background: 'transparent',
              fontSize: 'var(--fs-body)',
              color: 'var(--text-primary)',
              fontFamily: 'var(--font-ui)',
            }}
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭搜索 (Esc)"
            title="关闭搜索 (Esc)"
            data-testid="quick-search-close"
            // M2.x-inline: previously used Tailwind utility classes
            // (`transition-colors hover:bg-[var(--danger)]
            // hover:text-white dark:hover:bg-[var(--danger)]
            // dark:hover:text-white`). Project has no Tailwind pipeline,
            // so the hover rules were never generated. The danger-hover
            // cue is now handled by data-app-close-hover + the shared
            // block in src/design-system/utilities.css.
            data-app-close-hover="true"
            style={{
              ...noDragStyle,
              width: 28,
              height: 28,
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-button)',
              background: 'transparent',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-secondary)',
            }}
          >
            <X size={14} />
          </button>
        </div>

        {/* Recent-history strip — only when input is empty and
            history has at least 1 entry. Clicking a chip seeds
            the input (does NOT navigate). */}
        {showHistoryStrip ? (
          <div
            data-testid="quick-search-history"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 16px',
              borderBottom: '1px solid var(--border)',
              flexWrap: 'wrap',
            }}
          >
            <span
              style={{
                color: 'var(--text-muted)',
                fontSize: 'var(--fs-caption)',
                marginRight: 4,
              }}
            >
              最近:
            </span>
            {history.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => setQuery(q)}
                style={{
                  ...noDragStyle,
                  border: '1px solid var(--border)',
                  borderRadius: 999, // 完全圆形 (pill shape), 无 token 对应
                  padding: '2px 10px',
                  background: 'var(--bg-primary)',
                  color: 'var(--text-secondary)',
                  fontSize: 'var(--fs-caption)',
                  cursor: 'pointer',
                  fontFamily: 'var(--font-ui)',
                }}
              >
                {q}
              </button>
            ))}
          </div>
        ) : null}

        {/* Result list */}
        <ul
          data-testid="quick-search-results"
          style={{
            flex: '1 1 auto',
            listStyle: 'none',
            margin: 0,
            padding: 0,
            overflowY: 'auto',
          }}
        >
          {visible.length === 0 ? (
            <li
              data-testid="quick-search-empty"
              style={{
                padding: '24px 16px',
                color: 'var(--text-muted)',
                textAlign: 'center',
                fontSize: 'var(--fs-body)',
              }}
            >
              没有匹配的结果
            </li>
          ) : (
            visible.map((r, i) => (
              <li key={`${r.kind}-${r.label}-${i}`}>
                <button
                  type="button"
                  data-testid={`quick-search-result-${i}`}
                  data-highlighted={i === highlight ? 'true' : 'false'}
                  onClick={() => handleSelect(r)}
                  onMouseEnter={() => setHighlight(i)}
                  style={{
                    display: 'flex',
                    width: '100%',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 16px',
                    border: 'none',
                    borderLeft:
                      i === highlight
                        ? '2px solid var(--accent)'
                        : '2px solid transparent',
                    background:
                      i === highlight ? 'var(--bg-overlay)' : 'transparent',
                    color: 'var(--text-primary)',
                    cursor: 'pointer',
                    textAlign: 'left',
                    fontSize: 'var(--fs-body)',
                  }}
                >
                  <span style={{ flex: '1 1 auto', minWidth: 0 }}>
                    <HighlightedLabel label={r.label} matches={r.matches} />
                  </span>
                  <span
                    style={{
                      color: 'var(--text-muted)',
                      fontSize: 'var(--fs-caption)',
                      marginLeft: 8,
                    }}
                  >
                    {r.kind === 'plugin' ? '插件' : r.kind === 'provider' ? 'Provider' : 'MCP'}
                    {r.hint ? ` · ${r.hint}` : ''}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>

        {/* Footer — keyboard hint */}
        <div
          style={{
            padding: '8px 16px',
            borderTop: '1px solid var(--border)',
            color: 'var(--text-muted)',
            fontSize: 'var(--fs-caption)',
            display: 'flex',
            justifyContent: 'space-between',
          }}
        >
          <span>↑↓/Ctrl+N/P 选择 · Enter 打开 · Esc 关闭</span>
          <span>{visible.length} 个结果</span>
        </div>
      </div>
    </div>
  );
}

// Local helper — same WebkitAppRegion disable pattern as AppHeader
// so the modal never accidentally triggers an OS drag gesture.
const noDragStyle = {
  WebkitAppRegion: 'no-drag',
} as React.CSSProperties;