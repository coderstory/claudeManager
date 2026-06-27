/**
 * F13 — 备份与恢复 (M2.6 real implementation).
 *
 * User flow (per docs/design/M2.6-dataflow.md):
 *   1. User clicks the sidebar "备份与恢复" tile.
 *   2. The page mounts and calls `listBackups` to fetch every
 *      `*.bak.<ts>` / `*.backup.<ts>` file from both
 *      `<app_data>/backups/` and `~/.claude/`.
 *   3. The page renders a left-rail timeline of backups
 *      (newest first) + a right-side detail panel.
 *   4. Selecting one backup shows its raw content.
 *   5. Selecting two backups + [比对] shows a field-level diff
 *      with Add/Remove/Change highlights.
 *   6. [回滚] asks for confirmation, then calls `restoreBackup`
 *      which takes a `.bak.pre-restore.<ts>` of the current
 *      file first (CLAUDE.md §7).
 *   7. [立刻备份] takes a fresh snapshot of `settings.json` and
 *      appends it to the timeline.
 *
 * ## Design choices (CLAUDE.md §5 + SPEC §5.12)
 *
 * - **No external libs**: timeline is a flex list, diff is
 *   green/red rows with monospace font, no CodeMirror / react-diff
 *   to keep the bundle small.
 * - **Window.confirm for the destructive action**: matches the
 *   M2.5 delete pattern; the restore is destructive so the
 *   double-backup is the safety net, not the UI prompt.
 * - **Token masking OFF by default**: the right panel is a raw
 *   JSON view. The user is going to *compare* the files — masking
 *   would defeat the purpose. (M2.4's JsonEditorPage masks; this
 *   page is a read-only viewer for backups.)
 * - **Diff visual**: green-50 background for Add, red-50 for
 *   Remove, amber-50 for Change — matches the SPEC §5.8 palette.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import {
  Archive,
  ArrowLeftRight,
  FileJson,
  FileWarning,
  History,
  Maximize2,
  Minimize2,
  RotateCcw,
  Save,
  Trash2,
} from 'lucide-react';
import type {
  BackupEntry,
  DiffEntry,
  ManualBackupResult,
} from '../../types/backup';
import {
  backupNow,
  deleteBackup,
  diffBackups,
  listBackups,
  readBackupContent,
  restoreBackup,
} from '../../lib/api/backup';
import {
  formatBackupTimestamp,
  formatSize,
  sourceLabel,
} from '../../types/backup';
import { ErrorBanner } from '../../components/ErrorBanner';
import { useViewState } from '../../hooks/useViewState';
import { Pagination } from '../../components/Pagination';

// ---------------------------------------------------------------------------
// Page state
// ---------------------------------------------------------------------------

interface PageState {
  loading: boolean;
  entries: BackupEntry[];
  selected: string[]; // M5 #29 — any number (was capped at 2 for diff). Diff still needs exactly 2, but multi-select delete works on any count.
  detail: { path: string; content: string } | null;
  diff: DiffEntry[] | null;
  diffing: boolean;
  message: { kind: 'success' | 'error'; text: string } | null;
  /** M3.2 polish — F19 toggle: fullscreen on/off for the right
   *  detail panel. Persists only for the current view (re-renders
   *  reset it). */
  detailFullscreen: boolean;
  /** M5 #29 — pagination state for the timeline. */
  page: number;
}

const INITIAL_STATE: PageState = {
  loading: true,
  entries: [],
  selected: [],
  detail: null,
  diff: null,
  diffing: false,
  message: null,
  detailFullscreen: false,
  page: 0,
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function BackupRestorePage(): ReactElement {
  const [state, setState] = useState<PageState>(INITIAL_STATE);
  // M4.6 / Phase 21-C — F21 history link-out.
  const { setView } = useViewState();

  // Initial load.
  const refresh = useCallback(async (): Promise<void> => {
    try {
      const list = await listBackups();
      setState((prev) => ({
        ...prev,
        loading: false,
        entries: list,
        // Drop any selections that no longer exist on disk.
        selected: prev.selected.filter((p) => list.some((e) => e.path === p)),
      }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setState((prev) => ({
        ...prev,
        loading: false,
        message: { kind: 'error', text: `加载失败: ${msg}` },
      }));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // ---- selection ----
  //
  // M5 #29 — selection is no longer capped at 2 entries. The diff
  // action (`handleCompare`) still requires exactly 2, but multi-select
  // delete can act on any number. We drop the old "drop oldest" cap
  // so a user can pre-select N backups for batch deletion.

  const toggleSelect = useCallback((path: string): void => {
    setState((prev) => {
      const has = prev.selected.includes(path);
      if (has) {
        // Invalidate diff when removing a participant.
        const nextSelected = prev.selected.filter((p) => p !== path);
        const wasInDiff =
          prev.diff !== null && nextSelected.length !== 2;
        return {
          ...prev,
          selected: nextSelected,
          diff: wasInDiff ? null : prev.diff,
        };
      }
      return {
        ...prev,
        selected: [...prev.selected, path],
        // Adding a 3rd selection invalidates any existing diff
        // (diff only makes sense at exactly 2 participants).
        diff: prev.selected.length === 2 ? null : prev.diff,
      };
    });
  }, []);

  // ---- detail view ----

  const handleShowContent = useCallback(async (path: string): Promise<void> => {
    setState((prev) => ({ ...prev, message: null }));
    try {
      const content = await readBackupContent(path);
      setState((prev) => ({
        ...prev,
        detail: { path, content },
        diff: null,
      }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setState((prev) => ({
        ...prev,
        message: { kind: 'error', text: `读取失败: ${msg}` },
      }));
    }
  }, []);

  // ---- diff ----

  const handleCompare = useCallback(async (): Promise<void> => {
    if (state.selected.length !== 2) return;
    setState((prev) => ({ ...prev, diffing: true, message: null }));
    try {
      const d = await diffBackups(state.selected[0], state.selected[1]);
      setState((prev) => ({
        ...prev,
        diff: d,
        diffing: false,
        detail: null,
      }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setState((prev) => ({
        ...prev,
        diffing: false,
        message: { kind: 'error', text: `比对失败: ${msg}` },
      }));
    }
  }, [state.selected]);

  // ---- restore ----

  const handleRestore = useCallback(
    async (path: string): Promise<void> => {
      const ok = window.confirm(
        '回滚将覆盖当前文件。先会备份当前文件(.bak.pre-restore.<ts>),然后原子写入备份内容。\n\n确认继续?',
      );
      if (!ok) return;
      try {
        await restoreBackup(path);
        setState((prev) => ({
          ...prev,
          message: { kind: 'success', text: '已回滚,刷新列表' },
        }));
        await refresh();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setState((prev) => ({
          ...prev,
          message: { kind: 'error', text: `回滚失败: ${msg}` },
        }));
      }
    },
    [refresh],
  );

  // ---- manual backup ----

  const handleBackupNow = useCallback(async (): Promise<void> => {
    // 默认备份 settings.json —— 由后端 AppPaths.settings_json 解析
    // （IPlatformPaths 按 OS 给路径）。前端 webview 里 `process` 未定义，
    // 不能在这里判断 OS 拼路径（CLAUDE.md §3.2 + 反 ReferenceError）。
    try {
      const result: ManualBackupResult = await backupNow();
      setState((prev) => ({
        ...prev,
        message: { kind: 'success', text: `已备份到 ${result.path}` },
      }));
      await refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setState((prev) => ({
        ...prev,
        message: { kind: 'error', text: `备份失败: ${msg}` },
      }));
    }
  }, [refresh]);

  // ---- delete ----
  //
  // M4.6.13: 用户要求备份页支持删除。两次确认：
  //   1. window.confirm — 防误删（CLAUDE.md §7 destructive ops
  //      必须经用户明确同意）。
  //   2. 后端 trash + rm（保留可恢复性）。
  //
  // 删除后:乐观更新 entries(把已删的 path 过滤掉),也再调一次
  // refresh 确保与磁盘一致(用户可能手动 mv/cp,等等)。

  const handleDelete = useCallback(
    async (path: string): Promise<void> => {
      const ok = window.confirm(
        '删除备份将永久移入回收目录(同目录下的 .trash/)并从列表移除。\n\n此操作无法撤销,确认继续?',
      );
      if (!ok) return;
      try {
        await deleteBackup(path);
        setState((prev) => ({
          ...prev,
          // 乐观更新:立刻把已删的 path 从 entries / selected /
          // detail 里抹掉,UI 不会短暂"看起来还在"。
          entries: prev.entries.filter((e) => e.path !== path),
          selected: prev.selected.filter((p) => p !== path),
          detail:
            prev.detail && prev.detail.path === path ? null : prev.detail,
          message: { kind: 'success', text: '已删除' },
        }));
        // 二次校验:与磁盘对齐(用户若在外部也删了,状态要一致)。
        await refresh();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setState((prev) => ({
          ...prev,
          message: { kind: 'error', text: `删除失败: ${msg}` },
        }));
      }
    },
    [refresh],
  );

  // M5 #29 — batch delete for the multi-selected backups. Iterates
  // the existing single-delete IPC; the backend's allow-list + .trash
  // safety applies per-call, so the user is never at risk of wiping
  // unrelated files even if some deletions fail mid-loop.
  const handleBatchDelete = useCallback(
    async (paths: string[]): Promise<void> => {
      if (paths.length === 0) return;
      const ok = window.confirm(
        `将永久删除选中的 ${paths.length} 个备份(每个会先移入 .trash/,再删除 trash 副本)。\n\n此操作无法撤销,确认继续?`,
      );
      if (!ok) return;
      // Optimistic UI: remove all from entries/selected/detail.
      setState((prev) => ({
        ...prev,
        entries: prev.entries.filter((e) => !paths.includes(e.path)),
        selected: prev.selected.filter((p) => !paths.includes(p)),
        detail:
          prev.detail && paths.includes(prev.detail.path) ? null : prev.detail,
        message: { kind: 'success', text: `已删除 ${paths.length} 个备份` },
      }));
      // Per-path backend delete; surface the first failure.
      let failed: string | null = null;
      for (const p of paths) {
        try {
          await deleteBackup(p);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          failed = msg;
          break;
        }
      }
      if (failed !== null) {
        setState((prev) => ({
          ...prev,
          message: { kind: 'error', text: `部分删除失败: ${failed}` },
        }));
      }
      // Re-sync with disk so any externally removed files disappear.
      await refresh();
    },
    [refresh],
  );

  // ---- M4.6.13 — frontend dedupe safeguard ----
  const dedupedEntries = useMemo<BackupEntry[]>(() => {
    const seen = new Set<string>();
    const out: BackupEntry[] = [];
    for (const e of state.entries) {
      if (seen.has(e.path)) continue;
      seen.add(e.path);
      out.push(e);
    }
    return out;
  }, [state.entries]);

  // M5 #29 — paginate the deduped timeline. Page size 20 matches the
  // history tables (#31) so the UX is consistent across pages.
  const PAGE_SIZE = 20;
  const pageStart = state.page * PAGE_SIZE;
  const pageEntries = dedupedEntries.slice(
    pageStart,
    pageStart + PAGE_SIZE,
  );

  // BUG-RF-04 — tri-state select-all for the visible page items.
  // The page-scoped select-all checkbox has 3 states:
  //   - none:    0 of page items selected → unchecked
  //   - partial: some (but not all) of page items selected → indeterminate (—)
  //   - all:     all page items selected → checked
  //
  // The indeterminate state is set via the `indeterminate` DOM property
  // (NOT the `checked` property — React only supports `checked` as a
  // controlled prop). We use a ref callback to flip the DOM property
  // directly.
  const pageSelectedCount = useMemo<number>(() => {
    const pagePaths = new Set(pageEntries.map((e) => e.path));
    return state.selected.filter((p) => pagePaths.has(p)).length;
  }, [state.selected, pageEntries]);

  const pageSelectAllState: 'none' | 'partial' | 'all' = useMemo(() => {
    if (pageEntries.length === 0) return 'none';
    if (pageSelectedCount === 0) return 'none';
    if (pageSelectedCount === pageEntries.length) return 'all';
    return 'partial';
  }, [pageSelectedCount, pageEntries.length]);

  const toggleSelectAllPage = useCallback((): void => {
    setState((prev) => {
      const pagePaths = pageEntries.map((e) => e.path);
      const pageSet = new Set(pagePaths);
      // 当前页选中的 path 集合
      const currentlySelectedOnPage = prev.selected.filter((p) =>
        pageSet.has(p),
      );
      let nextSelected: string[];
      if (
        currentlySelectedOnPage.length === pageEntries.length &&
        pageEntries.length > 0
      ) {
        // all → none: 取消当前页所有选择
        nextSelected = prev.selected.filter((p) => !pageSet.has(p));
      } else {
        // none / partial → all: 合并当前页 paths
        const merged = new Set(prev.selected);
        for (const p of pagePaths) merged.add(p);
        nextSelected = Array.from(merged);
      }
      return {
        ...prev,
        selected: nextSelected,
        // diff 只在恰好 2 个时有效;切换全选会破坏这个条件
        diff: prev.selected.length === 2 ? null : prev.diff,
      };
    });
  }, [pageEntries]);

  // ---- render ----

  const isEmpty = !state.loading && dedupedEntries.length === 0;

  return (
    <div
      data-testid="backup-restore-page"
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
        <History size={18} />
        备份与恢复
      </h1>
      <p
        style={{
          fontSize: 13,
          color: 'var(--text-secondary)',
          marginBottom: 16,
          lineHeight: 1.6,
        }}
      >
        显示 <code style={{ background: 'var(--bg-elevated)', padding: '1px 6px', borderRadius: 'var(--radius-button)' }}>~/.claude/</code> 和
        应用数据目录下所有
        <code style={{ background: 'var(--bg-elevated)', padding: '1px 6px', borderRadius: 'var(--radius-button)' }}>*.bak.&lt;ts&gt;</code>
        备份时间线。可查看内容、比对两版差异,或一键回滚。
      </p>

      {/* Toolbar */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          marginBottom: 16,
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        <button
          onClick={() => {
            void handleBackupNow();
          }}
          data-testid="backup-now-btn"
          style={primaryBtn()}
        >
          <Save size={14} />
          立刻备份 settings.json
        </button>
        <button
          onClick={() => {
            setState((prev) => ({
              ...prev,
              detailFullscreen: !prev.detailFullscreen,
            }));
          }}
          data-testid="backup-fullscreen-toggle"
          aria-pressed={state.detailFullscreen}
          disabled={!state.detail && !state.diff}
          title={
            state.detailFullscreen ? '退出全屏 (F19)' : '全屏查看 (F19)'
          }
          style={{
            ...toolbarBtn(),
            opacity: state.detail || state.diff ? 1 : 0.5,
            cursor: state.detail || state.diff ? 'pointer' : 'not-allowed',
            // M4.6.13 — active 全屏状态用 accent 边框 + bg 标记,
            // 让用户能看到"当前在全屏模式"而不是按钮变灰。
            borderColor: state.detailFullscreen
              ? 'var(--accent)'
              : undefined,
            background: state.detailFullscreen
              ? 'rgba(9, 105, 218, 0.08)'
              : undefined,
            color: state.detailFullscreen
              ? 'var(--accent)'
              : undefined,
          }}
        >
          {state.detailFullscreen ? (
            <Minimize2 size={14} />
          ) : (
            <Maximize2 size={14} />
          )}
          {state.detailFullscreen ? '退出全屏' : '全屏'}
        </button>
        <button
          onClick={() => {
            void handleCompare();
          }}
          disabled={state.selected.length !== 2 || state.diffing}
          data-testid="backup-compare-btn"
          style={{
            ...toolbarBtn(),
            opacity: state.selected.length === 2 ? 1 : 0.5,
            cursor: state.selected.length === 2 ? 'pointer' : 'not-allowed',
          }}
        >
          <ArrowLeftRight size={14} />
          {state.diffing ? '比对中…' : '比对选中的 2 个'}
        </button>
        {/* M5 #29 — multi-select delete. Works on any number of selected
            backups (≥1). Diff still requires exactly 2 — this button is
            independent of that constraint. */}
        <button
          onClick={() => {
            void handleBatchDelete(state.selected);
          }}
          disabled={state.selected.length === 0}
          data-testid="backup-batch-delete-btn"
          style={{
            ...toolbarBtn(),
            borderColor: 'var(--danger)',
            color: 'var(--danger)',
            opacity: state.selected.length > 0 ? 1 : 0.5,
            cursor: state.selected.length > 0 ? 'pointer' : 'not-allowed',
          }}
          title="删除选中的所有备份（不可撤销）"
        >
          <Trash2 size={14} />
          删除选中 ({state.selected.length})
        </button>
        <button
          onClick={() => {
            void refresh();
          }}
          data-testid="backup-refresh-btn"
          style={toolbarBtn()}
        >
          刷新
        </button>
        {/* BUG-RF-05 — 备份 → JSON 编辑器入口。
          选中 ≥1 个备份后,点 [导出 JSON 编辑] 把该备份的内容写到
          sessionStorage `ccm.openFilePath` 然后跳 json-editor view。
          json-editor 的 useEffect (M5 #28) 会读这个 key + 自动加载
          文件 + 渲染到编辑器。

          单个备份:直接传该 path。
          多个备份:把每条 path 拼成 sessionStorage array (逗号分隔),
          json-editor 暂时只取第一个;后续再迭代 multi-file 工作流。 */}
        <button
          onClick={() => {
            if (state.selected.length === 0) return;
            try {
              window.sessionStorage.setItem(
                'ccm.openFilePath',
                state.selected[0],
              );
            } catch {
              // sessionStorage in private mode may throw — best effort.
            }
            setView('json-editor');
          }}
          disabled={state.selected.length === 0}
          data-testid="backup-export-to-editor-btn"
          style={{
            ...toolbarBtn(),
            opacity: state.selected.length > 0 ? 1 : 0.5,
            cursor: state.selected.length > 0 ? 'pointer' : 'not-allowed',
          }}
          title="将选中备份的内容加载到 JSON 编辑器"
        >
          <FileJson size={14} />
          导出 JSON 编辑 ({state.selected.length})
        </button>
        {/* M4.6 / Phase 21-C — F21 history link: 当前页是 F13 即时
            时间线,跳转 F21 看 SQLite 持久化的历史(可筛选 / 导出). */}
        <button
          onClick={() => {
            setView('history');
          }}
          data-testid="goto-history"
          style={toolbarBtn()}
        >
          查看历史 →
        </button>
        <span
          style={{
            marginLeft: 'auto',
            fontSize: 12,
            color: 'var(--text-muted)',
            cursor: 'help',
          }}
          data-testid="backup-count"
          title={
            // M3.2 polish — tooltip describing where backups live so
            // the user can copy the path and `ls` / open it manually.
            // Two sources are scanned (F13 SPEC §5.12):
            //   1) <APPDATA>/ClaudeConfigManager/backups/  (Windows)
            //   2) %USERPROFILE%/.claude/                  (Windows)
            // On macOS the equivalents are ~/Library/Application
            // Support/ClaudeConfigManager/backups and ~/.claude.
            '备份路径:\n' +
            '  • <APPDATA>/ClaudeConfigManager/backups/\n' +
            '  • ~/.claude/  (settings.json 同目录 .bak.<ts>)'
          }
        >
          {dedupedEntries.length} 个备份 · 已选 {state.selected.length} / 2
        </span>
      </div>

      {/* InfoBar — M2.16 改造 (F15): 内部用共享 ErrorBanner。
          保留对外 testid `backup-message` (测试 + e2e 依赖)。
          不传 onDismiss (原实现也是持久化,直到下次操作覆盖); ErrorBanner 的 ✕ 按钮因此不渲染。 */}
      {state.message && (
        <ErrorBanner
          kind={state.message.kind}
          message={state.message.text}
          testId="backup-message"
          style={{ marginBottom: 12 }}
        />
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(360px, 480px) 1fr',
          gap: 16,
          alignItems: 'start',
        }}
      >
        {/* Timeline */}
        <div
          data-testid="backup-timeline"
          style={{
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-card)',
            background: 'var(--bg-elevated)',
            overflow: 'hidden',
            maxHeight: '70vh',
            overflowY: 'auto',
          }}
        >
          {state.loading ? (
            <div
              data-testid="backup-loading"
              style={{ padding: 32, color: 'var(--text-muted)', fontSize: 13 }}
            >
              加载中…
            </div>
          ) : isEmpty ? (
            <div
              data-testid="backup-empty"
              style={{
                padding: 32,
                color: 'var(--text-muted)',
                textAlign: 'center',
                fontSize: 13,
              }}
            >
              <FileWarning size={24} style={{ marginBottom: 8, opacity: 0.5 }} />
              <div>未发现任何备份文件</div>
              <div style={{ marginTop: 8, fontSize: 12 }}>
                点 [立刻备份] 生成第一个备份,或切换 provider / 编辑 settings.json 后会自动产生备份。
              </div>
            </div>
          ) : (
            <>
              {/* BUG-RF-04 — tri-state select-all header.
                3 states: none / partial / all.
                - `checked` reflects the boolean part (all → true, else false).
                - `indeterminate` is the DOM-only property set via ref callback
                  (React 19 doesn't expose it as a controlled prop). */}
              <div
                data-testid="backup-select-all-header"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 14px',
                  borderBottom: '1px solid var(--border)',
                  background: 'rgba(0, 0, 0, 0.02)',
                  fontSize: 12,
                  color: 'var(--text-secondary)',
                }}
              >
                <input
                  type="checkbox"
                  data-testid="backup-select-all-page"
                  data-select-state={pageSelectAllState}
                  aria-label={`全选当前页 ${pageEntries.length} 个备份(已选 ${pageSelectedCount})`}
                  checked={pageSelectAllState === 'all'}
                  ref={(el) => {
                    if (el) {
                      el.indeterminate = pageSelectAllState === 'partial';
                    }
                  }}
                  onChange={() => {
                    toggleSelectAllPage();
                  }}
                />
                <span>
                  全选当前页 ({pageSelectedCount} / {pageEntries.length})
                </span>
              </div>
              {pageEntries.map((e) => {
              // M4.6.13 — `dedupedEntries` is a useMemo that
              // collapses `state.entries` by `path` (defense in
              // depth on top of the backend's canonical-path
              // dedupe). The first occurrence of each path wins;
              // subsequent duplicates are dropped silently.
              const isSelected = state.selected.includes(e.path);
              return (
                <div
                  key={e.path}
                  data-testid="backup-row"
                  data-backup-path={e.path}
                  onClick={() => {
                    toggleSelect(e.path);
                  }}
                  style={{
                    padding: '10px 14px',
                    borderBottom: '1px solid var(--border)',
                    cursor: 'pointer',
                    background: isSelected
                      ? 'rgba(9, 105, 218, 0.08)'
                      : 'transparent',
                    border: 'var(--card-border-width) solid transparent',
                    borderLeft: 'var(--card-border-width) solid var(--accent)',
                    borderColor: isSelected ? 'var(--accent)' : 'transparent',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => {
                      toggleSelect(e.path);
                    }}
                    onClick={(ev) => {
                      ev.stopPropagation();
                    }}
                    data-testid="backup-row-check"
                    data-backup-path={e.path}
                    style={{ flexShrink: 0 }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 500,
                        color: 'var(--text-primary)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                      title={formatBackupTimestamp(e.timestamp_unix)}
                    >
                      {formatBackupTimestamp(e.timestamp_unix)}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: 'var(--text-secondary)',
                        marginTop: 2,
                        display: 'flex',
                        gap: 8,
                      }}
                    >
                      <span>{sourceLabel(e.source)}</span>
                      <span>·</span>
                      <span>{formatSize(e.size_bytes)}</span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                    <button
                      onClick={(ev) => {
                        ev.stopPropagation();
                        void handleShowContent(e.path);
                      }}
                      data-testid="backup-view-btn"
                      data-backup-path={e.path}
                      style={iconBtn()}
                      title="查看完整内容"
                    >
                      <FileWarning size={12} />
                    </button>
                    <button
                      onClick={(ev) => {
                        ev.stopPropagation();
                        void handleRestore(e.path);
                      }}
                      data-testid="backup-restore-btn"
                      data-backup-path={e.path}
                      style={{ ...iconBtn(), color: 'var(--accent)' }}
                      title="回滚到此版本"
                    >
                      <RotateCcw size={12} />
                    </button>
                    <button
                      onClick={(ev) => {
                        ev.stopPropagation();
                        void handleDelete(e.path);
                      }}
                      data-testid="backup-delete-btn"
                      data-backup-path={e.path}
                      style={{ ...iconBtn(), color: 'var(--danger)' }}
                      title="删除此备份"
                      aria-label="删除此备份"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              );
            })}
            </>
          )}
          {/* M5 #29 — pagination control for the timeline. */}
          <Pagination
            total={dedupedEntries.length}
            page={state.page}
            pageSize={PAGE_SIZE}
            onPageChange={(next) => {
              setState((prev) => ({ ...prev, page: next }));
            }}
            testIdPrefix="backup-timeline-pagination"
          />
        </div>

        {/* Right detail panel */}
        <div
          data-testid="backup-detail-panel"
          style={{
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-card)',
            background: 'var(--bg-elevated)',
            minHeight: 200,
            maxHeight: '70vh',
            overflow: 'auto',
            padding: state.detail || state.diff ? 16 : 0,
          }}
        >
          {state.diff && state.diff.length > 0 ? (
            <DiffView entries={state.diff} />
          ) : state.diff && state.diff.length === 0 ? (
            <div
              data-testid="backup-diff-empty"
              style={{
                color: 'var(--text-muted)',
                fontSize: 13,
                textAlign: 'center',
                padding: 32,
              }}
            >
              <Archive size={24} style={{ marginBottom: 8, opacity: 0.5 }} />
              <div>两个备份完全相同,无差异</div>
            </div>
          ) : state.detail ? (
            <ContentView path={state.detail.path} content={state.detail.content} />
          ) : (
            <div
              data-testid="backup-detail-placeholder"
              style={{
                padding: 32,
                color: 'var(--text-muted)',
                fontSize: 13,
                textAlign: 'center',
              }}
            >
              <div>选 1 个备份 → 点 [查看完整内容]</div>
              <div style={{ marginTop: 6 }}>或选 2 个 → 点 [比对选中的 2 个]</div>
            </div>
          )}
        </div>
      </div>

      {/* M3.2 polish — F19 fullscreen toggle overlay. Renders
          only when `detailFullscreen` is on; covers the entire
          viewport (fixed, top:0) so the user can focus on the
          backup content without distractions. Esc-to-exit is
          handled below. */}
      {state.detailFullscreen && (
        <div
          data-testid="backup-fullscreen-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="备份内容全屏查看"
          onKeyDown={(ev) => {
            if (ev.key === 'Escape') {
              setState((prev) => ({ ...prev, detailFullscreen: false }));
            }
          }}
          tabIndex={-1}
          ref={(el) => {
            // Auto-focus so Escape key handler above fires without
            // a prior click inside the overlay.
            if (el) el.focus();
          }}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'var(--bg-primary)',
            zIndex: 1000,
            padding: 24,
            overflow: 'auto',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              marginBottom: 12,
              gap: 8,
            }}
          >
            <h3
              style={{
                margin: 0,
                fontSize: 14,
                fontWeight: 600,
                color: 'var(--text-primary)',
                flex: 1,
              }}
            >
              全屏查看 · 按 Esc 或点 [退出全屏] 关闭
            </h3>
            <button
              onClick={() => {
                setState((prev) => ({ ...prev, detailFullscreen: false }));
              }}
              data-testid="backup-fullscreen-exit"
              style={toolbarBtn()}
            >
              <Minimize2 size={14} />
              退出全屏
            </button>
          </div>
          <div
            style={{
              flex: 1,
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-card)',
              background: 'var(--bg-elevated)',
              padding: 16,
              overflow: 'auto',
            }}
          >
            {state.diff && state.diff.length > 0 ? (
              <DiffView entries={state.diff} />
            ) : state.diff && state.diff.length === 0 ? (
              <div
                data-testid="backup-diff-empty"
                style={{
                  color: 'var(--text-muted)',
                  fontSize: 13,
                  textAlign: 'center',
                  padding: 32,
                }}
              >
                两个备份完全相同,无差异
              </div>
            ) : state.detail ? (
              <ContentView path={state.detail.path} content={state.detail.content} />
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-views
// ---------------------------------------------------------------------------

function ContentView({
  path,
  content,
}: {
  path: string;
  content: string;
}): ReactElement {
  return (
    <div data-testid="backup-content-view">
      <div
        style={{
          fontSize: 12,
          color: 'var(--text-muted)',
          marginBottom: 8,
          fontFamily: '"Cascadia Code", "SF Mono", Menlo, Consolas, monospace',
        }}
      >
        {path}
      </div>
      <pre
        data-testid="backup-content-pre"
        style={{
          margin: 0,
          fontSize: 12,
          lineHeight: 1.5,
          color: 'var(--text-primary)',
          fontFamily: '"Cascadia Code", "SF Mono", Menlo, Consolas, monospace',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
        }}
      >
        {content}
      </pre>
    </div>
  );
}

function DiffView({ entries }: { entries: DiffEntry[] }): ReactElement {
  return (
    <div data-testid="backup-diff-view">
      <h3
        style={{
          fontSize: 14,
          fontWeight: 600,
          color: 'var(--text-primary)',
          margin: '0 0 12px 0',
        }}
      >
        字段级 diff ({entries.length} 项)
      </h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {entries.map((e, i) => (
          <div
            key={`${e.path}-${i}`}
            data-testid="backup-diff-row"
            data-diff-op={e.op}
            data-diff-path={e.path}
            style={{
              padding: '8px 12px',
              borderRadius: 'var(--radius-button)',
              fontSize: 12,
              background:
                e.op === 'add'
                  ? 'rgba(56, 142, 60, 0.08)'
                  : e.op === 'remove'
                    ? 'rgba(211, 47, 47, 0.08)'
                    : 'rgba(245, 124, 0, 0.06)',
              border: 'var(--card-border-width) solid transparent',
              borderLeft: `var(--card-border-width) solid ${
                e.op === 'add'
                  ? 'var(--success)'
                  : e.op === 'remove'
                    ? 'var(--danger)'
                    : 'var(--warning)'
              }`,
            }}
          >
            <div
              style={{
                fontFamily: '"Cascadia Code", "SF Mono", Menlo, Consolas, monospace',
                color: 'var(--text-primary)',
                fontWeight: 500,
                marginBottom: 4,
              }}
            >
              {e.op === 'add' ? '+ ' : e.op === 'remove' ? '- ' : '~ '}
              {e.path || '(root)'}
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 8,
                fontFamily: '"Cascadia Code", "SF Mono", Menlo, Consolas, monospace',
                color: 'var(--text-secondary)',
                fontSize: 11,
              }}
            >
              <div>
                <span style={{ color: 'var(--text-muted)' }}>旧: </span>
                <span style={{ color: 'var(--danger)' }}>
                  {e.old == null ? '(无)' : JSON.stringify(e.old)}
                </span>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>新: </span>
                <span style={{ color: 'var(--success)' }}>
                  {e.new == null ? '(无)' : JSON.stringify(e.new)}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Style helpers
// ---------------------------------------------------------------------------

function toolbarBtn(): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '6px 12px',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-button)',
    background: 'var(--bg-elevated)',
    color: 'var(--text-primary)',
    fontSize: 12,
    cursor: 'pointer',
  };
}

function primaryBtn(): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '6px 12px',
    border: 'none',
    borderRadius: 'var(--radius-button)',
    background: 'var(--accent)',
    color: '#fff',
    fontSize: 12,
    cursor: 'pointer',
    fontWeight: 500,
  };
}

function iconBtn(): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 24,
    height: 24,
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-button)',
    background: 'var(--bg-elevated)',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
  };
}
