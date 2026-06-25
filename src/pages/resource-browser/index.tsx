/**
 * F16 — 资源浏览 (M2.13 real implementation).
 * F21 — 资源搜索 (M2.16, commit f927895).
 * F22 — 资源详情预览 (M2.16, manifest + 文件列表 M2.16-f22-manifest).
 * M3.4 — 清单 17: scanner 层已过滤 cache / node_modules / .git 等污染目录,
 *         前端无需 UI 改动 (后端 `scan_resources` 已屏蔽)。
 *
 * User flow (per docs/design/M2.13-dataflow.md):
 *   1. Page mounts → fetches the default kind ('plugin') via
 *      `listResources`.
 *   2. User switches tab → re-fetch for that kind.
 *   3. Each row shows: name + size + enabled badge + reveal button.
 *   4. Click reveal → `revealInFileManager(path)`.
 *      - Success → clear any prior reveal error.
 *      - Failure → non-blocking modal (CLAUDE.md §7).
 *   5. (F21) Type in the search box → rows filter by fuzzy name match.
 *   6. (F22) Click a row body → inline accordion detail panel shows
 *      name / kind / source / path / size / shape / enabled state
 *      (同步,从 ResourceItem 直接取) + description / 文件列表
 *      (异步,调 get_resource_detail 读 manifest + list_dir)。
 *      Re-click collapses. Multiple rows may be expanded at once.
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
 * - **F22 detail panel** 同步字段(name/path/size/enabled)立即渲染,
 *   异步字段(description/files)在面板挂载时调 get_resource_detail
 *   读取,加载中显示 spinner,失败显示非阻塞错误。manifest 读取是
 *   best-effort(缺失 → "暂无描述")。不改 F16 的 ResourceItem 模型
 *   (detail 用独立 ResourceDetail 结构)—— anti-事故。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Eye,
  Folder,
  Loader2,
  PowerOff,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';

import { listResources, getResourceDetail, revealInFileManager } from '../../lib/api/resources';
import { fuzzyMatch } from '../../lib/fuzzy';
import type {
  ResourceDetail as TauriResourceDetail,
  ResourceItem as TauriResourceItem,
  ResourceKind,
} from '../../types/resource';
import {
  ALL_RESOURCE_KINDS,
  formatSize,
  resourceKindLabel,
  resourceKindSubdir,
} from '../../types/resource';
import { ErrorBanner, formatRevealError } from '../../components/ErrorBanner';
import type { RevealFailure } from '../../components/ErrorBanner';

// ---------------------------------------------------------------------------
// Page-level state
// ---------------------------------------------------------------------------

interface PageState {
  kind: ResourceKind;
  items: TauriResourceItem[];
  loading: boolean;
  listError: string | null;
  /**
   * M3.5 — reveal 错误改为结构化 `RevealFailure`,前端按 `kind` 路由中文文案。
   * `revealError` 字符串字段保留作为后备 / log 用途,UI 展示走 `formatRevealError`。
   */
  revealFailure: RevealFailure | null;
  revealErrorItemName: string | null;
}

const INITIAL_STATE: PageState = {
  kind: 'plugin',
  items: [],
  loading: true,
  listError: null,
  revealFailure: null,
  revealErrorItemName: null,
};

// ---------------------------------------------------------------------------
// F22 — 详情面板 helpers
// ---------------------------------------------------------------------------

/**
 * F21 (M2.16) — 来源下拉的"无来源"哨兵值。
 *
 * 对应 Rust `ResourceItem.source_repo: Option<String>` 的 `None`
 * 情形(command / lsp / mcp 资源无仓库归属)。下拉里显示为
 * "(无来源)",选中后只过滤 source_repo === null 的项。
 */
const NONE_SOURCE_LABEL = '(无来源)';

/**
 * 资源形态 — ResourceItem.path 在磁盘上的实际形状。
 *
 * ResourceItem 模型本身没有标明 path 是文件还是目录（F16 领域层故意省略，
 * 避免前端依赖 is_dir 判断）。这里基于 kind 推断：
 *   - plugin → 总是目录（scanner 只接 directory）
 *   - skill → 文件或目录皆可（scanner 两者都收），无法静态判定
 *   - command → 总是 .md 文件
 *   - lsp → 总是 .json 文件
 *   - mcp → path 指向 mcp.json（聚合文件，每个 mcp 条目共享同一 path）
 */
type ResourceShape = 'directory' | 'file' | 'aggregate';

/**
 * M3.5 — 探测 `unknown` 是否是结构化 `RevealFailure`(后端 IPC
 * 直接抛这个对象)。如果 IPC contract 还停留在旧版(Error /
 * string),用 `false` 路径降级到 `launcher_failed` 兜底。
 */
function isRevealFailure(err: unknown): err is RevealFailure {
  return (
    typeof err === 'object' &&
    err !== null &&
    'kind' in err &&
    'message' in err &&
    'path' in err &&
    typeof (err as { kind: unknown }).kind === 'string'
  );
}

function inferResourceShape(kind: ResourceKind): ResourceShape {
  switch (kind) {
    case 'plugin':
      return 'directory';
    case 'command':
    case 'lsp':
      return 'file';
    case 'mcp':
      return 'aggregate';
    case 'skill':
      // skill 既可能是单文件也可能是目录,scanner 对两者都收。
      // 不依赖 fs 判断(避免引入 plugin-fs 依赖),统一标 'file'——
      // 详情面板会显示 path,用户自己能看出是不是目录。
      return 'file';
  }
}

/**
 * 每个 kind 在详情面板里"来源"字段的语义说明。
 *
 * SPEC F22 要求展示"来源",但 ResourceItem 没有专门的来源字段。
 * 这里把 path 字段的语义解释给用户看(它就是该资源的磁盘来源)。
 */
function describeSourceField(kind: ResourceKind): string {
  switch (kind) {
    case 'plugin':
      return '插件目录(来源: ~/.claude/plugins/)';
    case 'skill':
      return '技能文件/目录(来源: ~/.claude/skills/)';
    case 'command':
      return '命令文件(来源: ~/.claude/commands/)';
    case 'lsp':
      return 'LSP 配置文件(来源: ~/.claude/lsp/)';
    case 'mcp':
      return 'MCP 服务器配置(来源: ~/.claude/mcp.json)';
  }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ResourceBrowserPage(): ReactElement {
  const [state, setState] = useState<PageState>(INITIAL_STATE);
  // F21 — search box query. Kept separate from PageState so re-typing
  // does NOT clobber the loaded items / loading flag. Switching tabs
  // (runList) clears the query so the new kind starts unfiltered.
  const [searchQuery, setSearchQuery] = useState('');

  // F21 (M2.16) — 来源仓库过滤。`null` = 全部;string = 选中某个
  // source_repo。来源下拉的选项由当前 tab 资源的 unique source_repo
  // 派生(可能含 `(无来源)` 兜底,对应 Rust 端 None)。切 tab 时清空,
  // 见 runList。
  const [sourceFilter, setSourceFilter] = useState<string | null>(null);

  // F22 — 详情面板展开状态。
  //
  // 用 Set<ResourceItem.id> 而不是单个 selectedId,允许同时展开多行
  // (accordion 风格但非互斥)。切 tab 时 runList 会清空它,避免跨 kind
  // 残留展开态。
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const runList = useCallback(async (kind: ResourceKind) => {
    // F21 — reset the query whenever we re-scan / switch kind, so
    // the new list starts unfiltered. (If we kept the old query it
    // would hide everything in a kind that doesn't share the name.)
    setSearchQuery('');
    // F21 (M2.16) — 切 tab / 重新扫描时同步清空来源过滤,避免跨
    // kind 残留一个在当前 tab 不存在的 source_repo 过滤。
    setSourceFilter(null);
    // F22 — 切 tab / 重新扫描时清空展开态,避免跨 kind 残留详情面板。
    setExpandedIds(new Set());
    setState((prev) => ({
      ...prev,
      kind,
      loading: true,
      listError: null,
      revealFailure: null,
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
        revealFailure: null,
        revealErrorItemName: null,
      }));
    } catch (err) {
      // M3.5 — 后端现在返回结构化 `RevealFailure` (kind/message/path);
      // 兼容旧 IPC(可能仍抛 Error 字符串)用 duck-typing 探测。
      const failure: RevealFailure = isRevealFailure(err)
        ? err
        : {
            kind: 'launcher_failed',
            message: err instanceof Error ? err.message : String(err),
            path: item.path,
          };
      setState((prev) => ({
        ...prev,
        revealFailure: failure,
        revealErrorItemName: item.name,
      }));
    }
  }, []);

  const handleDismissRevealError = useCallback(() => {
    setState((prev) => ({
      ...prev,
      revealFailure: null,
      revealErrorItemName: null,
    }));
  }, []);

  // F21 — 实时按 name 模糊过滤当前 tab 的列表.
  //
  // 复用 F9 的 `fuzzyMatch`（src/lib/fuzzy.ts，M2.11 已 ship）。
  // 空查询 → 返回全部（渲染层会自己处理空列表态）。
  // 非空查询 → 子序列匹配 name 字段，按 score 降序排列，
  //   连续命中 / 词首命中排前面（fuzzyMatch 内部已加权）。
  //
  // F21 (M2.16) — 在 fuzzyMatch 之后再叠一层 source_repo 过滤。
  // sourceFilter === null → 全部;否则只留 source_repo 匹配(或
  // sourceFilter === NONE_LABEL 兜底 → 只留 source_repo 为 null 的)。
  // 顺序是 fuzzy → source:先按相关性排序再按仓库分组,这样
  // "doc" + "anthropic-tools" 仍会先命中相关性高的 doc-writer。
  //
  // 这里用 useMemo 而不是 useEffect——过滤是纯派生状态，
  // 不需要副作用，render 期间计算即可。
  const filteredItems = useMemo<TauriResourceItem[]>(() => {
    // 先按 name fuzzy 过滤
    const q = searchQuery.trim();
    const afterName: TauriResourceItem[] = [];
    if (q === '') {
      afterName.push(...state.items);
    } else {
      for (const item of state.items) {
        const r = fuzzyMatch(q, item.name);
        if (r !== null) {
          afterName.push(item);
        }
      }
    }
    // 再按 source_repo 过滤
    if (sourceFilter === null) return afterName;
    return afterName.filter((i) =>
      sourceFilter === NONE_SOURCE_LABEL
        ? i.source_repo === null
        : i.source_repo === sourceFilter,
    );
  }, [state.items, searchQuery, sourceFilter]);

  // F21 (M2.16) — 来源下拉的选项列表。
  //
  // 从当前 tab 的 items 派生 unique source_repo,按字母序排列。
  // null 兜底成 `NONE_SOURCE_LABEL`(显示为 "(无来源)"),允许用户
  // 单独看 command/lsp/mcp 这些无仓库归属的项。
  // 空列表时返回空数组,下拉组件不渲染。
  const availableSources = useMemo<string[]>(() => {
    const set = new Set<string>();
    let hasNull = false;
    for (const i of state.items) {
      if (i.source_repo === null) {
        hasNull = true;
      } else {
        set.add(i.source_repo);
      }
    }
    const out = Array.from(set).sort((a, b) => a.localeCompare(b));
    if (hasNull) out.push(NONE_SOURCE_LABEL);
    return out;
  }, [state.items]);

  // F21 (M2.16) — 当前 source 过滤是否生效的标志。
  // 用于决定下拉右侧是否高亮"激活"角标。
  const sourceFilterActive = sourceFilter !== null;

  const handleClearSearch = useCallback(() => {
    setSearchQuery('');
  }, []);

  // F22 — 切换某行详情面板展开/收起。
  //
  // 点击行体(非操作按钮区)展开;再点收起。允许多行同时展开。
  // 用 Set 不可变更新避免直接 mutate。
  const handleToggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
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
        maxWidth: 720,
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
            borderRadius: 'var(--radius-button)',
            border: '1px solid var(--border)',
            background: 'var(--bg-elevated)',
            color: 'var(--text-primary)',
            fontSize: 13,
            cursor: state.loading ? 'not-allowed' : 'pointer',
            opacity: state.loading ? 0.6 : 1,
            // M5 bug #20 — 重新扫描按钮宽度不够导致 "重新扫描" 文字换行.
            // 加 min-width + white-space: nowrap, 文字始终单行.
            minWidth: 110,
            whiteSpace: 'nowrap',
            flexShrink: 0,
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

      {/* F21 — 搜索 + 来源过滤区(name 模糊 + source_repo 下拉) */}
      {!state.loading && !state.listError && state.items.length > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          {/* 名称模糊搜索框 */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 12px',
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-button)',
              flex: '1 1 280px',
              minWidth: 240,
            }}
          >
            <Search
              size={14}
              style={{ flexShrink: 0, color: 'var(--text-muted)' }}
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={`搜索 ${resourceKindLabel(state.kind)} 名称...`}
              data-testid="resource-browser-search-input"
              aria-label={`搜索${resourceKindLabel(state.kind)}名称`}
              style={{
                flex: '1 1 auto',
                border: 'none',
                outline: 'none',
                background: 'transparent',
                fontSize: 13,
                color: 'var(--text-primary)',
                fontFamily: 'var(--font-ui)',
                padding: '2px 0',
              }}
            />
            {searchQuery !== '' && (
              <button
                type="button"
                data-testid="resource-browser-search-clear"
                onClick={handleClearSearch}
                aria-label="清空搜索"
                title="清空搜索"
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  padding: 0,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  lineHeight: 1,
                }}
              >
                <X size={14} />
              </button>
            )}
            {/* 结果计数 — 帮用户判断过滤是否生效 */}
            {(searchQuery.trim() !== '' || sourceFilterActive) && (
              <span
                style={{
                  fontSize: 11,
                  color: 'var(--text-muted)',
                  whiteSpace: 'nowrap',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {filteredItems.length}/{state.items.length}
              </span>
            )}
          </div>

          {/* F21 (M2.16) — 来源仓库下拉过滤 */}
          {availableSources.length > 0 && (
            <div
              data-testid="resource-browser-source-filter"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 10px 4px 12px',
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-button)',
              }}
            >
              <label
                htmlFor="resource-browser-source-select"
                style={{
                  fontSize: 12,
                  color: 'var(--text-secondary)',
                  whiteSpace: 'nowrap',
                }}
              >
                来源:
              </label>
              <select
                id="resource-browser-source-select"
                data-testid="resource-browser-source-select"
                value={sourceFilter ?? ''}
                onChange={(e) => {
                  const v = e.target.value;
                  setSourceFilter(v === '' ? null : v);
                }}
                style={{
                  border: 'none',
                  outline: 'none',
                  background: 'transparent',
                  fontSize: 13,
                  color: sourceFilterActive
                    ? 'var(--accent)'
                    : 'var(--text-primary)',
                  fontFamily: 'var(--font-ui)',
                  padding: '2px 4px',
                  cursor: 'pointer',
                }}
                aria-label="按来源仓库过滤"
              >
                <option value="">全部</option>
                {availableSources.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              {sourceFilterActive && (
                <button
                  type="button"
                  data-testid="resource-browser-source-clear"
                  onClick={() => setSourceFilter(null)}
                  aria-label="清空来源过滤"
                  title="清空来源过滤"
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                    padding: 0,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    lineHeight: 1,
                  }}
                >
                  <X size={12} />
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Reveal error — non-blocking alert (CLAUDE.md §7) + M3.5 本地化文案 */}
      {state.revealFailure && (() => {
        const { message, kind } = formatRevealError(state.revealFailure);
        return (
          <div
            data-testid="resource-browser-reveal-error"
            style={{ display: 'flex', flexDirection: 'column', gap: 4 }}
          >
            <div
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: 'var(--danger)',
              }}
            >
              无法打开
              {state.revealErrorItemName
                ? `「${state.revealErrorItemName}」`
                : ''}
              <span
                style={{ marginLeft: 8, opacity: 0.7, fontWeight: 400 }}
                data-testid="resource-browser-reveal-error-kind"
              >
                (类型: {state.revealFailure.kind})
              </span>
            </div>
            <ErrorBanner
              kind={kind}
              message={message}
              testId="resource-browser-reveal-error-banner"
              onDismiss={handleDismissRevealError}
            />
          </div>
        );
      })()}

      {/* List-level error */}
      {state.listError && (
        <div
          data-testid="resource-browser-list-error"
          style={{
            padding: '12px 16px',
            background: 'rgba(211, 47, 47, 0.08)',
            border: '1px solid var(--danger)',
            borderRadius: 'var(--radius-button)',
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

      {/* Empty state — 区分"目录本身为空"和"搜索无匹配"两种情况 */}
      {!state.loading && !state.listError && filteredItems.length === 0 && (
        <div
          data-testid="resource-browser-empty"
          style={{
            padding: 32,
            textAlign: 'center',
            background: 'var(--bg-elevated)',
            borderRadius: 'var(--radius-card)',
            border: '1px solid var(--border)',
            color: 'var(--text-secondary)',
          }}
        >
          {searchQuery.trim() !== '' ? (
            <>
              <Search
                size={32}
                color="var(--text-muted)"
                style={{ marginBottom: 8 }}
              />
              <div style={{ fontSize: 14, color: 'var(--text-primary)' }}>
                没有匹配「{searchQuery}」的 {resourceKindLabel(state.kind)} 资源
              </div>
              <div style={{ fontSize: 12, marginTop: 4 }}>
                共 {state.items.length} 项,0 项命中。修改关键词或
                <button
                  type="button"
                  onClick={handleClearSearch}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--accent)',
                    cursor: 'pointer',
                    padding: 0,
                    fontSize: 12,
                    textDecoration: 'underline',
                  }}
                >
                  清空搜索
                </button>
                。
              </div>
            </>
          ) : (
            <>
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
            </>
          )}
        </div>
      )}

      {/* Items list */}
      {!state.loading && filteredItems.length > 0 && (
        <div
          data-testid="resource-browser-list"
          style={{
            background: 'var(--bg-elevated)',
            borderRadius: 'var(--radius-card)',
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
          {filteredItems.map((item) => (
            <ResourceRow
              key={item.id}
              item={item}
              onReveal={handleReveal}
              expanded={expandedIds.has(item.id)}
              onToggleExpand={handleToggleExpand}
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
  expanded,
  onToggleExpand,
}: {
  item: TauriResourceItem;
  onReveal: (item: TauriResourceItem) => void;
  expanded: boolean;
  onToggleExpand: (id: string) => void;
}): ReactElement {
  return (
    <div
      data-testid={`resource-browser-row-${item.id}`}
      style={{
        borderTop: '1px solid var(--border)',
        fontSize: 13,
      }}
    >
      <div
        data-testid={`resource-browser-row-body-${item.id}`}
        onClick={(e) => {
          // 避免点"显示"按钮误触发行展开。
          if ((e.target as HTMLElement).closest('button')) return;
          onToggleExpand(item.id);
        }}
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        aria-label={expanded ? `收起 ${item.name} 详情` : `展开 ${item.name} 详情`}
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 100px 80px 80px',
          gap: 12,
          padding: '10px 14px',
          alignItems: 'center',
          opacity: item.enabled ? 1 : 0.5,
          cursor: 'pointer',
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggleExpand(item.id);
          }
        }}
      >
        <div
          style={{
            minWidth: 0,
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
          }}
        >
          {/* F22 — 展开指示符 chevron */}
          {expanded ? (
            <ChevronDown
              size={14}
              style={{ flexShrink: 0, color: 'var(--text-muted)' }}
            />
          ) : (
            <ChevronRight
              size={14}
              style={{ flexShrink: 0, color: 'var(--text-muted)' }}
            />
          )}
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
                borderRadius: 'var(--radius-sm)',
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
                borderRadius: 'var(--radius-sm)',
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
            onClick={(e) => {
              e.stopPropagation();
              onReveal(item);
            }}
            aria-label={`在文件管理器中显示 ${item.name}`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '4px 10px',
              fontSize: 12,
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-button)',
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
      {/* F22 — 详情面板(inline accordion) */}
      {expanded && (
        <ResourceDetailPanel item={item} onReveal={onReveal} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ResourceDetailPanel — F22 详情预览
// ---------------------------------------------------------------------------

/**
 * 一行资源的详情面板。
 *
 * 展示内容(SPEC F22 "来源 / 描述 / 文件列表 / 启用状态"):
 *   - 名称 / 类型 / 来源(path) / 大小 / 启用状态 ✓(全部从 ResourceItem 直接取,同步渲染)
 *   - 描述 ✓(调 get_resource_detail 读取 manifest,异步)
 *   - 文件列表 ✓(调 get_resource_detail 列目录,异步)
 *
 * 同步字段(name/path/size/enabled)立即渲染,异步字段(description/
 * files)在 useEffect 触发的 fetch 完成后填充。加载中显示 spinner,
 * 失败显示非阻塞错误提示(CLAUDE.md §7)。
 *
 * 不改 domain、不改 F16 扫描逻辑——纯增量(反事故)。
 */
function ResourceDetailPanel({
  item,
  onReveal,
}: {
  item: TauriResourceItem;
  onReveal: (item: TauriResourceItem) => void;
}): ReactElement {
  const shape = inferResourceShape(item.kind);
  const sourceLabel = describeSourceField(item.kind);

  // F22 — 异步读取 manifest + 文件列表。
  //
  // 面板只在 expanded=true 时挂载,所以这里直接在 mount 时 fetch。
  // 卸载时通过 ignore flag 避免设置 state 到已卸载组件。
  const [detail, setDetail] = useState<TauriResourceDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(true);
  const [detailError, setDetailError] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;
    setDetailLoading(true);
    setDetailError(null);
    setDetail(null);
    getResourceDetail(item.path, item.kind)
      .then((d) => {
        if (!ignore) {
          setDetail(d);
          setDetailLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!ignore) {
          setDetailError(err instanceof Error ? err.message : String(err));
          setDetailLoading(false);
        }
      });
    return () => {
      ignore = true;
    };
  }, [item.path, item.kind]);

  return (
    <div
      data-testid={`resource-browser-detail-${item.id}`}
      style={{
        padding: '12px 14px 14px 34px',
        background: 'rgba(9, 105, 218, 0.03)',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      {/* 标题行 */}
      <div
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: 'var(--text-secondary)',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <Eye size={13} />
        资源详情
      </div>

      {/* 字段网格 */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '80px 1fr',
          gap: '6px 12px',
          fontSize: 12,
          lineHeight: 1.5,
        }}
      >
        <DetailField label="名称" value={item.name} mono />
        <DetailField
          label="类型"
          value={`${resourceKindLabel(item.kind)} (${item.kind})`}
        />
        <DetailField
          label="来源"
          value={sourceLabel}
        />
        {/* F21 (M2.16) — 来源仓库分组名。Rust 从 path 推断,
            plugin/skill 非空,command/lsp/mcp 显示 "(无来源)"。 */}
        <DetailField
          label="来源仓库"
          value={item.source_repo ?? NONE_SOURCE_LABEL}
          mono
          muted={item.source_repo === null}
        />
        <DetailField label="路径" value={item.path} mono />
        <DetailField
          label="大小"
          value={`${formatSize(item.size_bytes)} (${item.size_bytes.toLocaleString()} 字节)`}
        />
        <DetailField
          label="形态"
          value={
            shape === 'directory'
              ? '目录'
              : shape === 'file'
                ? '文件'
                : '聚合条目(mcp.json)'
          }
        />
        <DetailField
          label="启用状态"
          value={item.enabled ? '启用' : '禁用'}
          valueColor={item.enabled ? 'var(--success)' : 'var(--text-muted)'}
        />
        {/* 描述 — 异步从 manifest 读取 */}
        <DetailField
          label="描述"
          value={
            detailLoading
              ? '加载中...'
              : detailError
                ? '读取失败'
                : detail?.description ?? '暂无描述'
          }
          muted={
            !detailLoading &&
            !detailError &&
            (detail?.description ?? null) === null
          }
          valueColor={
            detailError ? 'var(--danger)' : undefined
          }
        />
      </div>

      {/* manifest 元信息(非空时展示,帮用户判断来源) */}
      {detail?.manifest && (
        <div
          data-testid={`resource-browser-detail-manifest-${item.id}`}
          style={{
            fontSize: 11,
            color: 'var(--text-muted)',
            fontFamily: 'var(--font-mono, monospace)',
            background: 'rgba(0,0,0,0.02)',
            padding: '6px 8px',
            borderRadius: 'var(--radius-button)',
            border: '1px solid var(--border)',
            wordBreak: 'break-all',
            maxHeight: 120,
            overflow: 'auto',
          }}
        >
          manifest: {JSON.stringify(detail.manifest).slice(0, 500)}
          {JSON.stringify(detail.manifest).length > 500 ? '...' : ''}
        </div>
      )}

      {/* 详情读取错误 — 非阻塞提示 */}
      {detailError && (
        <div
          data-testid={`resource-browser-detail-error-${item.id}`}
          style={{
            fontSize: 11,
            color: 'var(--danger)',
            padding: '6px 8px',
            background: 'rgba(211, 47, 47, 0.06)',
            borderRadius: 'var(--radius-button)',
          }}
        >
          详情读取失败: {detailError}
        </div>
      )}

      {/* 文件列表 — 异步列目录(仅目录形态有) */}
      <div
        style={{
          borderTop: '1px dashed var(--border)',
          paddingTop: 8,
        }}
      >
        <div
          style={{
            fontSize: 12,
            fontWeight: 500,
            color: 'var(--text-secondary)',
            marginBottom: 4,
          }}
        >
          文件列表
          {detail?.files && detail.files.length > 0 && (
            <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>
              {' '}
              ({detail.files.length} 项)
            </span>
          )}
        </div>
        {detailLoading ? (
          <div
            data-testid={`resource-browser-detail-files-loading-${item.id}`}
            style={{ fontSize: 12, color: 'var(--text-muted)' }}
          >
            加载中...
          </div>
        ) : detail?.files && detail.files.length > 0 ? (
          <ul
            data-testid={`resource-browser-detail-files-${item.id}`}
            style={{
              margin: 0,
              paddingLeft: 18,
              fontSize: 11,
              color: 'var(--text-secondary)',
              fontFamily: 'var(--font-mono, monospace)',
              lineHeight: 1.6,
              maxHeight: 160,
              overflow: 'auto',
            }}
          >
            {detail.files.map((f) => (
              <li key={f} title={f}>
                {f}
              </li>
            ))}
          </ul>
        ) : shape === 'directory' ? (
          <div
            style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}
          >
            空目录
          </div>
        ) : (
          <div
            style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}
          >
            单文件资源(path 即文件本身)
          </div>
        )}
      </div>

      {/* 快捷操作 */}
      <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
        <button
          type="button"
          data-testid={`resource-browser-detail-reveal-${item.id}`}
          onClick={(e) => {
            e.stopPropagation();
            onReveal(item);
          }}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '4px 10px',
            fontSize: 12,
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-button)',
            background: 'var(--bg-elevated)',
            color: 'var(--text-primary)',
            cursor: 'pointer',
          }}
        >
          <ExternalLink size={12} />
          在文件管理器中显示
        </button>
      </div>
    </div>
  );
}

/** 详情字段行 — label + value 两列布局。 */
function DetailField({
  label,
  value,
  mono = false,
  muted = false,
  valueColor,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
  muted?: boolean;
  valueColor?: string;
}): ReactElement {
  return (
    <>
      <div
        style={{
          color: 'var(--text-muted)',
          fontWeight: 500,
        }}
      >
        {label}
      </div>
      <div
        style={{
          color: valueColor ?? (muted ? 'var(--text-muted)' : 'var(--text-primary)'),
          fontFamily: mono ? 'var(--font-mono, monospace)' : 'var(--font-ui)',
          wordBreak: 'break-all',
        }}
      >
        {value}
      </div>
    </>
  );
}