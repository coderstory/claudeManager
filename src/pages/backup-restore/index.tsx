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
import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import {
  Archive,
  ArrowLeftRight,
  FileWarning,
  History,
  Maximize2,
  Minimize2,
  RotateCcw,
  Save,
} from 'lucide-react';
import type {
  BackupEntry,
  DiffEntry,
  ManualBackupResult,
} from '../../types/backup';
import {
  backupNow,
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

// ---------------------------------------------------------------------------
// Page state
// ---------------------------------------------------------------------------

interface PageState {
  loading: boolean;
  entries: BackupEntry[];
  selected: string[]; // up to 2 selected paths
  detail: { path: string; content: string } | null;
  diff: DiffEntry[] | null;
  diffing: boolean;
  message: { kind: 'success' | 'error'; text: string } | null;
  /** M3.2 polish — F19 toggle: fullscreen on/off for the right
   *  detail panel. Persists only for the current view (re-renders
   *  reset it). */
  detailFullscreen: boolean;
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
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function BackupRestorePage(): ReactElement {
  const [state, setState] = useState<PageState>(INITIAL_STATE);

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

  const toggleSelect = useCallback((path: string): void => {
    setState((prev) => {
      const has = prev.selected.includes(path);
      if (has) {
        return { ...prev, selected: prev.selected.filter((p) => p !== path) };
      }
      // Cap at 2 — newest selection wins the second slot.
      if (prev.selected.length >= 2) {
        return {
          ...prev,
          selected: [prev.selected[1], path],
          diff: null, // selection changed → invalidate diff
        };
      }
      return {
        ...prev,
        selected: [...prev.selected, path],
        diff: prev.selected.length === 1 ? null : prev.diff,
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

  // ---- render ----

  const isEmpty = !state.loading && state.entries.length === 0;

  return (
    <div
      data-testid="backup-restore-page"
      style={{
        padding: 'var(--space-6)',
        maxWidth: 1280,
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
        显示 <code style={{ background: 'var(--bg-elevated)', padding: '1px 6px', borderRadius: 4 }}>~/.claude/</code> 和
        应用数据目录下所有
        <code style={{ background: 'var(--bg-elevated)', padding: '1px 6px', borderRadius: 4 }}>*.bak.&lt;ts&gt;</code>
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
        <button
          onClick={() => {
            void refresh();
          }}
          data-testid="backup-refresh-btn"
          style={toolbarBtn()}
        >
          刷新
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
          {state.entries.length} 个备份 · 已选 {state.selected.length} / 2
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
            borderRadius: 8,
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
            state.entries.map((e) => {
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
                    borderLeft: isSelected
                      ? '3px solid var(--accent)'
                      : '3px solid transparent',
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
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Right detail panel */}
        <div
          data-testid="backup-detail-panel"
          style={{
            border: '1px solid var(--border)',
            borderRadius: 8,
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
              borderRadius: 8,
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
              borderRadius: 4,
              fontSize: 12,
              background:
                e.op === 'add'
                  ? 'rgba(56, 142, 60, 0.08)'
                  : e.op === 'remove'
                    ? 'rgba(211, 47, 47, 0.08)'
                    : 'rgba(245, 124, 0, 0.06)',
              borderLeft: `3px solid ${
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
    borderRadius: 4,
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
    borderRadius: 4,
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
    borderRadius: 4,
    background: 'var(--bg-elevated)',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
  };
}
