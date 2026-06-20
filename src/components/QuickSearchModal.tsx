/**
 * QuickSearchModal — M2.10 F11 "快速搜索" modal.
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
 *     corresponding management view). M2.10 keeps it simple: every
 *     non-plugin result also navigates to its management page.
 *
 * ## Why this is a pure component (no router):
 *
 *   - The modal receives `isOpen`, `onClose`, and `onNavigate` from
 *     App.tsx, so it's testable in isolation (render with a fake
 *     `onNavigate` and assert the right callback fires).
 *   - The filter is a small pure function exported alongside the
 *     component (`filterResults`) — tests don't need to drive the
 *     input box to verify the matching algorithm.
 *
 * ## Why we re-fetch on open instead of subscribing globally:
 *
 *   - The data sets (providers, MCP servers) change during normal
 *     use (switching providers, toggling MCP). We want the modal
 *     to reflect the LATEST state when the user opens it.
 *   - Cost is bounded (a few KB JSON over the Tauri IPC). No need
 *     for a global store.
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
import type { Provider } from '../types/provider';
import type { McpServer } from '../types/mcp';

/**
 * The 12 plugin Chinese subtitles — mirrored from AppSidebar's
 * VIEW_META so the search can match against user-facing labels.
 * Kept here as a copy because:
 *   - AppSidebar's VIEW_META holds ReactElement icons that aren't
 *     portable to a pure filter function.
 *   - Search should match "Provider 列表", "用量查询", etc. — the
 *     short Chinese strings, not the kebab-case ids.
 */
export const PLUGIN_LABELS: Record<ViewId, string> = {
  home: '欢迎页',
  'provider-list': 'Provider 列表',
  'provider-switch': 'Provider 切换',
  'import-sql': '.sql 导入',
  'deeplink-import': 'Deeplink 导入',
  'json-editor': 'JSON 编辑器',
  'mcp-management': 'MCP 管理',
  'usage-query': '用量查询',
  'single-file-deploy': '单文件部署',
  'resource-browser': '资源浏览',
  marketplace: '资源市场',
  optimizer: '配置优化',
  'backup-restore': '备份与恢复',
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
 * Pure filter — exposed so unit tests don't need to drive the input.
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

export function QuickSearchModal({
  isOpen,
  onClose,
  onNavigate,
}: QuickSearchModalProps): ReactElement | null {
  const [query, setQuery] = useState('');
  const [providers, setProviders] = useState<Provider[]>([]);
  const [mcps, setMcps] = useState<McpServer[]>([]);
  const [highlight, setHighlight] = useState(0);
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

  const visible = useMemo(
    () => filterResults(allResults, query),
    [allResults, query],
  );

  // Reset highlight when the visible list shrinks / changes.
  useEffect(() => {
    setHighlight(0);
  }, [query, isOpen]);

  // Focus the input on open + bind Esc / arrow keys.
  useEffect(() => {
    if (!isOpen) return;
    // Defer focus until after the modal paints — otherwise jsdom
    // (and React 19's batching) can race the autofocus.
    const id = window.setTimeout(() => inputRef.current?.focus(), 0);

    const onKey = (e: KeyboardEvent): void => {
      // Skip if user is in our own input — the input handlers
      // below cover ArrowUp/Down/Enter/Esc. We DO let plain typing
      // through to the input naturally because we're listening on
      // window with `isTextEntryTarget` exemption in the hook.
      if (
        e.target instanceof HTMLElement &&
        (e.target.tagName === 'INPUT' ||
          e.target.tagName === 'TEXTAREA' ||
          e.target.isContentEditable)
      ) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setHighlight((h) => Math.min(h + 1, Math.max(visible.length - 1, 0)));
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          setHighlight((h) => Math.max(h - 1, 0));
        } else if (e.key === 'Enter') {
          e.preventDefault();
          const r = visible[highlight];
          if (r) {
            onNavigate(r.view);
            onClose();
          }
        } else if (e.key === 'Escape') {
          e.preventDefault();
          onClose();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener('keydown', onKey);
    };
  }, [isOpen, visible, highlight, onNavigate, onClose]);

  // Reset query when the modal closes — keeps the next open clean.
  useEffect(() => {
    if (!isOpen) setQuery('');
  }, [isOpen]);

  const handleSelect = useCallback(
    (r: SearchResult) => {
      onNavigate(r.view);
      onClose();
    },
    [onNavigate, onClose],
  );

  if (!isOpen) return null;

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
            aria-label="关闭"
            data-testid="quick-search-close"
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
                  <span style={{ flex: '1 1 auto', minWidth: 0 }}>{r.label}</span>
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
          <span>↑↓ 选择 · Enter 打开 · Esc 关闭</span>
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