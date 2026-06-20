/**
 * F16 — 资源浏览 (M2.13 real implementation).
 *
 * User flow (per docs/design/M2.13-dataflow.md):
 *   1. Page mounts → fetches the default kind ('plugin') via
 *      `listResources`.
 *   2. User switches tab → re-fetch for that kind.
 *   3. Each row shows: name + size + enabled badge + reveal button.
 *   4. Click reveal → `revealInFileManager(path)`.
 *      - Success → clear any prior reveal error.
 *      - Failure → non-blocking modal (CLAUDE.md §7).
 *
 * ## Design choices (CLAUDE.md §5 + SPEC §5.5)
 *
 * - **Tab-driven**, not sub-page routing. The 5 kinds share one
 *   page; switching kind re-fetches via `listResources` (the scan is
 *   fast — single read_dir per kind, no network).
 * - **Disabled rows are dimmed** (opacity 0.5) but still rendered —
 *   F17/F18 may add enable/disable actions later; today the disabled
 *   state is only relevant for Mcp servers (mcp.json `disabled`).
 * - **Empty state ≠ error** — no plugins / no commands is fine; we
 *   show a friendly hint pointing at the relevant subdirectory.
 * - **Reveal failure** is a non-blocking alert (top-of-page), never
 *   a `throw` or `alert()` — per CLAUDE.md §7 ("不允许静默吞错"
 *   means show the error, not block the UI).
 */
import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import {
  AlertCircle,
  ExternalLink,
  Eye,
  Folder,
  Loader2,
  PowerOff,
  RefreshCw,
} from 'lucide-react';

import { listResources, revealInFileManager } from '../../lib/api/resources';
import type {
  ResourceItem as TauriResourceItem,
  ResourceKind,
} from '../../types/resource';
import {
  ALL_RESOURCE_KINDS,
  formatSize,
  resourceKindLabel,
  resourceKindSubdir,
} from '../../types/resource';

// ---------------------------------------------------------------------------
// Page-level state
// ---------------------------------------------------------------------------

interface PageState {
  kind: ResourceKind;
  items: TauriResourceItem[];
  loading: boolean;
  listError: string | null;
  revealError: string | null;
  revealErrorItemName: string | null;
}

const INITIAL_STATE: PageState = {
  kind: 'plugin',
  items: [],
  loading: true,
  listError: null,
  revealError: null,
  revealErrorItemName: null,
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ResourceBrowserPage(): ReactElement {
  const [state, setState] = useState<PageState>(INITIAL_STATE);

  const runList = useCallback(async (kind: ResourceKind) => {
    setState((prev) => ({
      ...prev,
      kind,
      loading: true,
      listError: null,
      revealError: null,
      revealErrorItemName: null,
    }));
    try {
      const items = await listResources(kind);
      setState((prev) => ({
        ...prev,
        items,
        loading: false,
        listError: null,
      }));
    } catch (err) {
      setState((prev) => ({
        ...prev,
        items: [],
        loading: false,
        listError: err instanceof Error ? err.message : String(err),
      }));
    }
  }, []);

  // Initial fetch on mount — defaults to the first kind (plugin).
  useEffect(() => {
    void runList(INITIAL_STATE.kind);
  }, [runList]);

  const handleTabClick = useCallback(
    (next: ResourceKind) => {
      if (next === state.kind && state.items.length > 0) return;
      void runList(next);
    },
    [state.kind, state.items.length, runList],
  );

  const handleReveal = useCallback(async (item: TauriResourceItem) => {
    try {
      await revealInFileManager(item.path);
      // Success: clear any prior reveal error.
      setState((prev) => ({
        ...prev,
        revealError: null,
        revealErrorItemName: null,
      }));
    } catch (err) {
      // Failure: surface via non-blocking alert (CLAUDE.md §7).
      setState((prev) => ({
        ...prev,
        revealError: err instanceof Error ? err.message : String(err),
        revealErrorItemName: item.name,
      }));
    }
  }, []);

  const handleDismissRevealError = useCallback(() => {
    setState((prev) => ({
      ...prev,
      revealError: null,
      revealErrorItemName: null,
    }));
  }, []);

  // ---- render ----

  return (
    <div
      data-testid="resource-browser-page"
      style={{
        padding: 24,
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        maxWidth: 1100,
        margin: '0 auto',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <div>
          <h2
            style={{
              fontSize: 18,
              fontWeight: 600,
              color: 'var(--text-primary)',
              margin: 0,
            }}
          >
            资源浏览
          </h2>
          <p
            style={{
              fontSize: 12,
              color: 'var(--text-secondary)',
              marginTop: 4,
              marginBottom: 0,
            }}
          >
            查看 ~/.claude/ 下的 5 类启用资源(Plugins / Skills / Commands /
            LSP / MCP),点击「显示」按钮跳到对应文件。
          </p>
        </div>
        <button
          type="button"
          data-testid="resource-browser-rescan-btn"
          onClick={() => {
            void runList(state.kind);
          }}
          disabled={state.loading}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 14px',
            borderRadius: 4,
            border: '1px solid var(--border)',
            background: 'var(--bg-elevated)',
            color: 'var(--text-primary)',
            fontSize: 13,
            cursor: state.loading ? 'not-allowed' : 'pointer',
            opacity: state.loading ? 0.6 : 1,
          }}
        >
          <RefreshCw size={14} />
          {state.loading ? '扫描中...' : '重新扫描'}
        </button>
      </div>

      {/* Tabs */}
      <div
        data-testid="resource-browser-tabs"
        role="tablist"
        style={{
          display: 'flex',
          gap: 4,
          borderBottom: '1px solid var(--border)',
        }}
      >
        {ALL_RESOURCE_KINDS.map((k) => {
          const active = k === state.kind;
          return (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={active}
              data-testid={`resource-browser-tab-${k}`}
              onClick={() => handleTabClick(k)}
              style={{
                padding: '8px 16px',
                fontSize: 13,
                fontWeight: active ? 600 : 400,
                color: active ? 'var(--accent)' : 'var(--text-secondary)',
                background: 'transparent',
                border: 'none',
                borderBottom: active
                  ? '2px solid var(--accent)'
                  : '2px solid transparent',
                cursor: 'pointer',
                marginBottom: -1,
              }}
            >
              {resourceKindLabel(k)}
            </button>
          );
        })}
      </div>

      {/* Sub-directory hint */}
      <div
        style={{
          fontSize: 12,
          color: 'var(--text-muted)',
          fontFamily: 'var(--font-mono, monospace)',
        }}
      >
        <Folder size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />
        ~/.claude/{resourceKindSubdir(state.kind)}
        {state.kind === 'mcp' ? '' : '/'}
      </div>

      {/* Reveal error — non-blocking alert (CLAUDE.md §7) */}
      {state.revealError && (
        <div
          data-testid="resource-browser-reveal-error"
          role="alert"
          style={{
            padding: '12px 16px',
            background: 'rgba(211, 47, 47, 0.08)',
            border: '1px solid var(--danger)',
            borderRadius: 4,
            color: 'var(--danger)',
            fontSize: 13,
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
          }}
        >
          <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600 }}>
              无法打开{state.revealErrorItemName ? `「${state.revealErrorItemName}」` : ''}
            </div>
            <div style={{ marginTop: 4 }}>{state.revealError}</div>
          </div>
          <button
            type="button"
            data-testid="resource-browser-reveal-error-dismiss"
            onClick={handleDismissRevealError}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--danger)',
              cursor: 'pointer',
              fontSize: 16,
              padding: 0,
              lineHeight: 1,
            }}
            aria-label="关闭错误提示"
          >
            ×
          </button>
        </div>
      )}

      {/* List-level error */}
      {state.listError && (
        <div
          data-testid="resource-browser-list-error"
          style={{
            padding: '12px 16px',
            background: 'rgba(211, 47, 47, 0.08)',
            border: '1px solid var(--danger)',
            borderRadius: 4,
            color: 'var(--danger)',
            fontSize: 13,
          }}
        >
          扫描失败: {state.listError}
        </div>
      )}

      {/* Loading */}
      {state.loading && (
        <div
          data-testid="resource-browser-loading"
          style={{
            padding: 32,
            textAlign: 'center',
            color: 'var(--text-secondary)',
            fontSize: 13,
          }}
        >
          <Loader2
            size={20}
            style={{ marginBottom: 8 }}
          />
          <div>扫描中...</div>
        </div>
      )}

      {/* Empty state */}
      {!state.loading && !state.listError && state.items.length === 0 && (
        <div
          data-testid="resource-browser-empty"
          style={{
            padding: 32,
            textAlign: 'center',
            background: 'var(--bg-elevated)',
            borderRadius: 8,
            border: '1px solid var(--border)',
            color: 'var(--text-secondary)',
          }}
        >
          <Eye
            size={32}
            color="var(--text-muted)"
            style={{ marginBottom: 8 }}
          />
          <div style={{ fontSize: 14, color: 'var(--text-primary)' }}>
            未发现 {resourceKindLabel(state.kind)} 资源
          </div>
          <div style={{ fontSize: 12, marginTop: 4 }}>
            目录 ~/.claude/{resourceKindSubdir(state.kind)} 为空或不存在。
          </div>
        </div>
      )}

      {/* Items list */}
      {!state.loading && state.items.length > 0 && (
        <div
          data-testid="resource-browser-list"
          style={{
            background: 'var(--bg-elevated)',
            borderRadius: 8,
            border: '1px solid var(--border)',
            overflow: 'hidden',
          }}
        >
          {/* Table header */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 100px 80px 80px',
              gap: 12,
              padding: '10px 14px',
              background: 'rgba(0,0,0,0.02)',
              borderBottom: '1px solid var(--border)',
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--text-secondary)',
            }}
          >
            <div>名称</div>
            <div style={{ textAlign: 'right' }}>大小</div>
            <div style={{ textAlign: 'center' }}>状态</div>
            <div style={{ textAlign: 'right' }}>操作</div>
          </div>
          {state.items.map((item) => (
            <ResourceRow
              key={item.id}
              item={item}
              onReveal={handleReveal}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ResourceRow
// ---------------------------------------------------------------------------

function ResourceRow({
  item,
  onReveal,
}: {
  item: TauriResourceItem;
  onReveal: (item: TauriResourceItem) => void;
}): ReactElement {
  return (
    <div
      data-testid={`resource-browser-row-${item.id}`}
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 100px 80px 80px',
        gap: 12,
        padding: '10px 14px',
        borderTop: '1px solid var(--border)',
        fontSize: 13,
        alignItems: 'center',
        opacity: item.enabled ? 1 : 0.5,
      }}
    >
      <div
        style={{
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
        }}
      >
        <span
          style={{
            fontWeight: 500,
            color: 'var(--text-primary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={item.name}
        >
          {item.name}
        </span>
        <span
          style={{
            fontSize: 11,
            color: 'var(--text-muted)',
            fontFamily: 'var(--font-mono, monospace)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={item.path}
        >
          {item.path}
        </span>
      </div>
      <div
        style={{
          textAlign: 'right',
          color: 'var(--text-secondary)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {formatSize(item.size_bytes)}
      </div>
      <div style={{ textAlign: 'center' }}>
        {item.enabled ? (
          <span
            data-testid={`resource-browser-status-${item.id}`}
            style={{
              fontSize: 11,
              padding: '2px 6px',
              borderRadius: 3,
              background: 'rgba(56, 142, 60, 0.12)',
              color: 'var(--success)',
            }}
          >
            启用
          </span>
        ) : (
          <span
            data-testid={`resource-browser-status-${item.id}`}
            style={{
              fontSize: 11,
              padding: '2px 6px',
              borderRadius: 3,
              background: 'rgba(0,0,0,0.05)',
              color: 'var(--text-muted)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <PowerOff size={10} />
            禁用
          </span>
        )}
      </div>
      <div style={{ textAlign: 'right' }}>
        <button
          type="button"
          data-testid={`resource-browser-reveal-${item.id}`}
          onClick={() => onReveal(item)}
          aria-label={`在文件管理器中显示 ${item.name}`}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '4px 10px',
            fontSize: 12,
            border: '1px solid var(--border)',
            borderRadius: 4,
            background: 'var(--bg-elevated)',
            color: 'var(--text-primary)',
            cursor: 'pointer',
          }}
        >
          <ExternalLink size={12} />
          显示
        </button>
      </div>
    </div>
  );
}