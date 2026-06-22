/**
 * JsonFileTree — F5 JSON 编辑器侧边文件目录树 (M3.11 / A4#12).
 *
 * Renders the file tree returned by `list_editable_jsons`, grouped
 * by `scope` (用户级 / 项目级). Click a file → fires `onSelect`.
 *
 * ## Design
 *
 * - **瓷白主题 + shadcn/ui** (CLAUDE.md §4): 白底卡片,1px 边框,
 *   hover 用 `--bg-elevated` 提亮,selected 用 `--accent` 浅底。
 * - **扁平列表 + 缩进**:不用真正的嵌套 DOM,直接用缩进宽度表达
 *   层级,简单稳定。每个 file 行的左侧是缩进色块(替代 tree lines,
 *   减少视觉噪音)。
 * - **顶部 search box**:对 `relative_path` 做 case-insensitive
 *   contains 过滤,空 = 全显示。
 * - **scope 分组**:每个 scope 是一个 group header(不可点击) +
 *   其下的文件行,渲染稳定(scope 顺序由后端排序保证)。
 * - **Loading / empty / error** 三态:前端调 IPC 时区分。
 *
 * ## Security
 *
 * 此组件**不**做路径白名单 — 后端 `list_editable_jsons` 是唯一
 * 的入口,前端只是把后端给的 entry 渲染出来。如果后端返回了越界
 * 路径(理论上不可能,因为 scan_root_for_jsons 严格白名单),我们
 * 也照显示 — 用户点开会被 read_file 拒绝,InfoBar 会显示错误。
 *
 * ## Testing
 *
 * 见 `src/__tests__/components/JsonFileTree.test.tsx` — 用 mock data
 * 覆盖 5 个核心行为:group / filter / select / empty / loading。
 */
import { useCallback, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { ChevronDown, ChevronRight, FileJson, Folder, RefreshCw, Search } from 'lucide-react';
import type { JsonFileEntry } from '../types/json';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface JsonFileTreeProps {
  /** 从 `list_editable_jsons` 拿到的 entries(已按 scope → relative_path 排序)。 */
  entries: JsonFileEntry[];
  /** 当前编辑中的文件绝对路径(用于高亮),null = 没有选中任何文件。 */
  selectedPath: string | null;
  /** 点击一个文件时触发,参数 = 该 entry 的 path。 */
  onSelect: (entry: JsonFileEntry) => void;
  /** 重新加载按钮触发(父组件应重新调 IPC)。 */
  onRefresh?: () => void;
  /** 是否处于加载中(显示 skeleton / 禁用交互)。 */
  loading?: boolean;
  /** 加载失败的错误信息(顶部红色 banner)。 */
  errorMessage?: string | null;
}

// ---------------------------------------------------------------------------
// Internal: 把 flat entries 按 scope 分组 + 按相对目录前缀做缩进
// ---------------------------------------------------------------------------

interface TreeRow {
  /** 该行的 stable key,React 用它做列表 diff。 */
  key: string;
  /** 缩进层级(0 = 顶层 / scope group 头)。 */
  indent: number;
  /** 显示文本。group header 用 scope_label,file 用 relative_path。 */
  label: string;
  /** 显示副文本(group header 是 scope,file 是 path 尾段)。 */
  secondary?: string;
  /** 是否是 group header(不可点击)。 */
  isGroup?: boolean;
  /** 该行所属的 scope(只对 group 头有意义;file 行也带值便于渲染)。 */
  scope?: string;
  /** 是否是文件(非 group header)。 */
  entry?: JsonFileEntry;
  /** 是否被选中(只对 file 有效)。 */
  selected?: boolean;
}

/**
 * Compute the indent level from a `relative_path` like
 * "commands/sub/foo.json" — split by `/`, depth = parts.length - 1
 * (file 行),或 0 (group header)。
 *
 * 例: "settings.json"           → indent 0
 *     "commands/a.json"          → indent 1
 *     "commands/sub/b.json"      → indent 2
 */
function indentFromRelative(rel: string): number {
  const parts = rel.split('/').filter(Boolean);
  return Math.max(0, parts.length - 1);
}

/**
 * 把 entries 转成渲染行 — 每个 scope 一组,组内 file 行按
 * relative_path 排序(后端已排过,这里兜底)。
 */
function buildRows(entries: JsonFileEntry[], selectedPath: string | null): TreeRow[] {
  const rows: TreeRow[] = [];
  // 防御:严格空值保护(mock 测试可能传 undefined / null)。
  if (!Array.isArray(entries)) {
    return rows;
  }

  // 按 scope 分组,scope 顺序 = 第一次出现的顺序(后端 sort by
  // scope 后,这就是字典序:project < user)。
  const groupOrder: string[] = [];
  const grouped = new Map<string, { label: string; entries: JsonFileEntry[] }>();
  for (const e of entries) {
    if (!grouped.has(e.scope)) {
      groupOrder.push(e.scope);
      grouped.set(e.scope, { label: e.scope_label, entries: [] });
    }
    grouped.get(e.scope)!.entries.push(e);
  }

  for (const scope of groupOrder) {
    const g = grouped.get(scope)!;
    rows.push({
      key: `scope:${scope}`,
      indent: 0,
      label: g.label,
      secondary: `${g.entries.length} 个文件`,
      isGroup: true,
      scope,
    });
    for (const entry of g.entries) {
      rows.push({
        key: `file:${entry.path}`,
        indent: 1 + indentFromRelative(entry.relative_path),
        label: entry.relative_path.split('/').pop() ?? entry.relative_path,
        secondary: entry.relative_path,
        scope,
        entry,
        selected: entry.path === selectedPath,
      });
    }
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function JsonFileTree(props: JsonFileTreeProps): ReactElement {
  const {
    entries,
    selectedPath,
    onSelect,
    onRefresh,
    loading = false,
    errorMessage = null,
  } = props;

  const [query, setQuery] = useState('');
  const [collapsedScopes, setCollapsedScopes] = useState<Set<string>>(new Set());

  // 过滤:query 对 relative_path 做 case-insensitive contains。
  // 空 query = 不过滤。
  const filteredEntries = useMemo<JsonFileEntry[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) => e.relative_path.toLowerCase().includes(q));
  }, [entries, query]);

  const rows = useMemo(
    () => buildRows(filteredEntries, selectedPath),
    [filteredEntries, selectedPath],
  );

  const toggleScope = useCallback((scope: string) => {
    setCollapsedScopes((prev) => {
      const next = new Set(prev);
      if (next.has(scope)) {
        next.delete(scope);
      } else {
        next.add(scope);
      }
      return next;
    });
  }, []);

  const isScopeCollapsed = useCallback(
    (scope: string): boolean => collapsedScopes.has(scope),
    [collapsedScopes],
  );

  return (
    <div
      data-testid="json-file-tree"
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        background: 'var(--bg-primary)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        overflow: 'hidden',
      }}
    >
      {/* Header: 标题 + 刷新按钮 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 10px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg-elevated)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--text-primary)',
          }}
        >
          <Folder size={14} />
          <span>文件目录</span>
        </div>
        <button
          type="button"
          data-testid="json-file-tree-refresh"
          onClick={onRefresh}
          disabled={loading}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '4px 8px',
            fontSize: 11,
            border: '1px solid var(--border)',
            borderRadius: 4,
            background: 'var(--bg-primary)',
            color: 'var(--text-secondary)',
            cursor: loading ? 'default' : 'pointer',
            opacity: loading ? 0.5 : 1,
          }}
          title="重新扫描"
        >
          <RefreshCw size={11} />
          刷新
        </button>
      </div>

      {/* Search box */}
      <div
        style={{
          padding: '6px 8px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg-elevated)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '4px 8px',
            border: '1px solid var(--border)',
            borderRadius: 4,
            background: 'var(--bg-primary)',
          }}
        >
          <Search size={12} color="var(--text-muted)" />
          <input
            type="text"
            data-testid="json-file-tree-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="过滤文件名…"
            style={{
              flex: 1,
              border: 'none',
              outline: 'none',
              background: 'transparent',
              fontSize: 12,
              color: 'var(--text-primary)',
            }}
          />
        </div>
      </div>

      {/* Error banner */}
      {errorMessage && (
        <div
          data-testid="json-file-tree-error"
          style={{
            padding: '6px 10px',
            background: 'rgba(211, 47, 47, 0.08)',
            color: 'var(--danger)',
            fontSize: 11,
            borderBottom: '1px solid var(--border)',
          }}
        >
          {errorMessage}
        </div>
      )}

      {/* Body: file rows */}
      <div
        data-testid="json-file-tree-body"
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '4px 0',
        }}
      >
        {loading && entries.length === 0 ? (
          <div
            data-testid="json-file-tree-loading"
            style={{
              padding: '20px 12px',
              fontSize: 12,
              color: 'var(--text-muted)',
              textAlign: 'center',
            }}
          >
            扫描中…
          </div>
        ) : rows.length === 0 ? (
          <div
            data-testid="json-file-tree-empty"
            style={{
              padding: '20px 12px',
              fontSize: 12,
              color: 'var(--text-muted)',
              textAlign: 'center',
            }}
          >
            {query ? '没有匹配的文件' : '范围内没有可编辑的 .json 文件'}
          </div>
        ) : (
          renderRows(rows, isScopeCollapsed, toggleScope, onSelect)
        )}
      </div>

      {/* Footer: 统计 */}
      <div
        data-testid="json-file-tree-footer"
        style={{
          padding: '6px 10px',
          borderTop: '1px solid var(--border)',
          background: 'var(--bg-elevated)',
          fontSize: 11,
          color: 'var(--text-muted)',
          display: 'flex',
          justifyContent: 'space-between',
        }}
      >
        <span>共 {filteredEntries.length} 个文件</span>
        {query && entries.length !== filteredEntries.length && (
          <span>(已过滤 {entries.length - filteredEntries.length})</span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Row renderer — split out to keep the JSX above readable
// ---------------------------------------------------------------------------

function renderRows(
  rows: TreeRow[],
  isScopeCollapsed: (scope: string) => boolean,
  toggleScope: (scope: string) => void,
  onSelect: (entry: JsonFileEntry) => void,
): ReactElement {
  const out: ReactElement[] = [];
  let currentScopeCollapsed = false;

  for (const row of rows) {
    if (row.isGroup) {
      const scope = row.scope ?? '';
      currentScopeCollapsed = scope ? isScopeCollapsed(scope) : false;
      out.push(
        <button
          type="button"
          key={row.key}
          data-testid={scope ? `json-file-tree-scope-${scope}` : 'json-file-tree-scope-unknown'}
          data-scope={scope}
          onClick={scope ? () => toggleScope(scope) : undefined}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            width: '100%',
            padding: '6px 8px',
            paddingLeft: 8 + row.indent * 16,
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--text-secondary)',
            background: 'transparent',
            border: 'none',
            cursor: scope ? 'pointer' : 'default',
            textAlign: 'left',
            textTransform: 'uppercase',
            letterSpacing: 0.5,
          }}
        >
          {scope ? (
            currentScopeCollapsed ? (
              <ChevronRight size={11} />
            ) : (
              <ChevronDown size={11} />
            )
          ) : null}
          <span>{row.label}</span>
          {row.secondary && (
            <span
              style={{
                marginLeft: 6,
                color: 'var(--text-muted)',
                fontWeight: 400,
                textTransform: 'none',
                letterSpacing: 0,
              }}
            >
              {row.secondary}
            </span>
          )}
        </button>,
      );
      continue;
    }

    if (currentScopeCollapsed) {
      // 该 scope 已折叠,跳过 file 行
      continue;
    }

    const entry = row.entry!;
    out.push(
      <button
        type="button"
        key={row.key}
        data-testid={`json-file-tree-entry`}
        data-path={entry.path}
        data-selected={row.selected ? 'true' : 'false'}
        onClick={() => onSelect(entry)}
        title={entry.path}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          width: '100%',
          padding: '5px 8px',
          paddingLeft: 8 + row.indent * 16,
          fontSize: 12,
          color: row.selected ? 'var(--accent)' : 'var(--text-primary)',
          background: row.selected ? 'rgba(9, 105, 218, 0.08)' : 'transparent',
          border: 'none',
          borderLeft: row.selected
            ? '3px solid var(--accent)'
            : '3px solid transparent',
          cursor: 'pointer',
          textAlign: 'left',
          overflow: 'hidden',
        }}
      >
        <FileJson size={12} color={row.selected ? 'var(--accent)' : 'var(--text-secondary)'} />
        <span
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontFamily: '"Cascadia Code", "SF Mono", Menlo, Consolas, monospace',
          }}
        >
          {row.label}
        </span>
      </button>,
    );
  }

  return <div data-testid="json-file-tree-rows">{out}</div>;
}

export default JsonFileTree;
