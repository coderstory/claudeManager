/**
 * F3 — 导入 .sql (M2.2 real implementation).
 *
 * Parses a cc-switch-style SQLite dump (.sql), previews the rows that
 * will be imported, and on confirmation bulk-writes provider JSON
 * files into <app-data>/providers/. See SPEC §3.1 F3 +
 * docs/design/M2.2-dataflow.md.
 *
 * ## File-picker choice (CLAUDE.md §2.3 dependency discipline)
 *
 * The Rust side already has `tauri-plugin-dialog = "=2.7.1"`. We do
 * NOT use its JS counterpart (`@tauri-apps/plugin-dialog`) because
 * that would require adding a new npm dep — forbidden by §2.3. The
 * WebView2-hosted `<input type="file">` API works just as well and
 * keeps the JS dep surface unchanged.
 *
 * ## Design choices (CLAUDE.md §5 + SPEC §5.1)
 *
 * - **3-column preview header**: 原始行数 / 可导入数 / 跳过行数 —
 *   mirrors the F3 brief exactly.
 * - **Provider list preview**: shows name + base_url + type + models
 *   count. api_key is NEVER displayed in the UI (would be a token
 *   leak in screenshots). M2.5+ will mask even api_base.
 * - **MCP preview-only section**: parsed but not written. F6 owns
 *   the write-side; for M2.2 we show "已解析 X 个 MCP（待 F6 写入
 *   ~/.claude.json）" so the user knows we saw them.
 * - **Errors panel**: collapsible details — surfaces per-row skip
 *   reasons without overwhelming the main view.
 * - **"确认导入" gating**: disabled until `importable > 0`. Re-enabled
 *   after import so the user can re-import a different file.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent, ReactElement } from 'react';
import { Database, FileWarning, FolderOpen, Upload } from 'lucide-react';
import {
  importProvidersFromSql,
  parseSqlPreview,
} from '../../lib/api/providers';
import { readSqlFile } from '../../lib/api/fs';
import type {
  ImportResult,
  ImportSkip,
  McpServer,
  Provider,
  SkippedLine,
  SqlPreview,
} from '../../types/provider';

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

type PageState =
  | { kind: 'idle' }
  | { kind: 'parsing'; fileName: string }
  | {
      kind: 'preview';
      fileName: string;
      preview: SqlPreview;
      content: string;
    }
  | { kind: 'importing'; preview: SqlPreview }
  | { kind: 'done'; result: ImportResult; fileName: string }
  | { kind: 'error'; message: string };

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export interface ImportSqlPageProps {
  /**
   * F20 文件关联:双击 .sql 启动应用时,App.tsx 从 single-instance /
   * setup 的 `import-sql-file` 事件收到 .sql 绝对路径,传给本页。
   * 页面挂载时自动读取该文件并走 F3 既有 parseSqlPreview 流程。
   * `null` / `undefined` = 无初始文件(用户从侧栏手动进页)。
   */
  initialFilePath?: string | null;
}

export function ImportSqlPage({
  initialFilePath,
}: ImportSqlPageProps = {}): ReactElement {
  const [state, setState] = useState<PageState>({ kind: 'idle' });
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Holds the latest preview payload across the synchronous setState
  // callback so handleConfirm can read it after React's batched update.
  const handleConfirmRef = useRef<{
    content: string;
    fileName: string;
    preview: SqlPreview;
  } | null>(null);

  // F20 — 文件关联自动加载。
  //
  // 当 App.tsx 传入 initialFilePath 时(双击 .sql 启动 / 第二实例转发),
  // 自动读取文件内容并走 parseSqlPreview,等价于用户手动点了"选择 .sql
  // 文件"。依赖项只含 initialFilePath:路径不变时不重复加载(防 StrictMode
  // double-invoke + 防父组件 re-render 误触发)。
  //
  // cleanup 设 cancelled 标志:如果路径在加载中途变了(用户再双击另一个
  // .sql),旧请求的 setState 会被忽略,新请求接管。
  useEffect(() => {
    if (!initialFilePath) return;
    let cancelled = false;
    // 从绝对路径提取文件名(供 UI 显示)。
    const fileName = initialFilePath.split(/[\\/]/).pop() ?? initialFilePath;
    setState({ kind: 'parsing', fileName });
    void (async (): Promise<void> => {
      try {
        const content = await readSqlFile(initialFilePath);
        if (cancelled) return;
        const preview = await parseSqlPreview(content);
        if (cancelled) return;
        handleConfirmRef.current = { content, fileName, preview };
        setState({ kind: 'preview', fileName, preview, content });
      } catch (err) {
        if (cancelled) return;
        handleConfirmRef.current = null;
        setState({ kind: 'error', message: stringifyError(err) });
      }
    })();
    return (): void => {
      cancelled = true;
    };
  }, [initialFilePath]);

  const handlePickFile = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChosen = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      // Reset the input so re-picking the same file fires onChange again.
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (!file) return;
      setState({ kind: 'parsing', fileName: file.name });
      try {
        const content = await file.text();
        const preview = await parseSqlPreview(content);
        // Mirror the preview payload into a ref so handleConfirm can
        // read it without a setState callback (which StrictMode
        // double-invokes). Reset on success too.
        handleConfirmRef.current = {
          content,
          fileName: file.name,
          preview,
        };
        setState({
          kind: 'preview',
          fileName: file.name,
          preview,
          content,
        });
      } catch (err) {
        handleConfirmRef.current = null;
        setState({ kind: 'error', message: stringifyError(err) });
      }
    },
    [],
  );

  const handleConfirm = useCallback(async () => {
    // Snapshot the current preview state synchronously. We avoid
    // setState's callback form because React StrictMode double-invokes
    // it — the second invocation would skip our assignment. Instead we
    // mirror state into a ref on every transition so this handler can
    // read it directly.
    const snap = handleConfirmRef.current;
    if (!snap) return;
    setState({ kind: 'importing', preview: snap.preview });
    try {
      const result = await importProvidersFromSql(snap.content);
      setState({ kind: 'done', result, fileName: snap.fileName });
    } catch (err) {
      setState({ kind: 'error', message: stringifyError(err) });
    }
  }, []);

  const handleReset = useCallback(() => {
    handleConfirmRef.current = null;
    setState({ kind: 'idle' });
  }, []);

  return (
    <div
      data-testid="import-sql-page"
      style={{
        padding: 'var(--space-6)',
        height: '100%',
        boxSizing: 'border-box',
        background: 'var(--bg-primary)',
        color: 'var(--text-primary)',
      }}
    >
      <HeaderBar onReset={handleReset} />
      <input
        ref={fileInputRef}
        type="file"
        accept=".sql,text/plain"
        data-testid="import-sql-file-input"
        style={{ display: 'none' }}
        onChange={handleFileChosen}
      />
      {state.kind === 'idle' && <IdleState onPickFile={handlePickFile} />}
      {state.kind === 'parsing' && (
        <StatusLine icon="parsing" text={`正在解析 ${state.fileName}…`} />
      )}
      {state.kind === 'preview' && (
        <Preview
          preview={state.preview}
          fileName={state.fileName}
          onConfirm={handleConfirm}
          onPickFile={handlePickFile}
        />
      )}
      {state.kind === 'importing' && (
        <StatusLine
          icon="importing"
          text={`正在导入 ${state.preview.importable} 个 provider…`}
        />
      )}
      {state.kind === 'done' && (
        <DoneView
          result={state.result}
          fileName={state.fileName}
          onReset={handleReset}
          onPickFile={handlePickFile}
        />
      )}
      {state.kind === 'error' && (
        <ErrorView message={state.message} onReset={handleReset} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface HeaderBarProps {
  onReset: () => void;
}

function HeaderBar({ onReset }: HeaderBarProps): ReactElement {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 'var(--space-4)',
      }}
    >
      <h1
        style={{
          fontSize: 'var(--fs-heading)',
          fontWeight: 600,
          color: 'var(--text-primary)',
          margin: 0,
        }}
      >
        导入 .sql
      </h1>
      <button
        type="button"
        data-testid="import-sql-reset"
        onClick={onReset}
        style={btnStyle}
        title="清除当前文件，重新选择"
      >
        清空
      </button>
    </div>
  );
}

function IdleState({ onPickFile }: { onPickFile: () => void }): ReactElement {
  return (
    <div
      data-testid="import-sql-idle"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'var(--space-12) var(--space-6)',
        color: 'var(--text-secondary)',
        minHeight: 280,
      }}
    >
      <Database
        size={56}
        color="var(--text-muted)"
        aria-hidden="true"
        style={{ marginBottom: 'var(--space-3)' }}
      />
      <h2
        style={{
          fontSize: 'var(--fs-heading)',
          color: 'var(--text-primary)',
          margin: 0,
          marginBottom: 'var(--space-2)',
        }}
      >
        选择一个 .sql 文件
      </h2>
      <p
        style={{
          color: 'var(--text-secondary)',
          fontSize: 'var(--fs-body)',
          maxWidth: 520,
          textAlign: 'center',
          marginBottom: 'var(--space-4)',
        }}
      >
        支持 cc-switch 导出的 SQLite dump 文件（含
        <code style={codeStyle}>INSERT INTO providers</code>
        、
        <code style={codeStyle}>INSERT INTO mcp_servers</code>
        语句）。其它语句（CREATE TABLE / PRAGMA 等）会被忽略。
      </p>
      <button
        type="button"
        data-testid="import-sql-pick-file"
        onClick={onPickFile}
        style={{
          ...btnStyle,
          background: 'var(--accent)',
          color: '#fff',
          border: 'none',
          fontWeight: 600,
          padding: '10px 20px',
          fontSize: 'var(--fs-body)',
        }}
      >
        <FolderOpen
          size={16}
          aria-hidden="true"
          style={{ verticalAlign: 'middle', marginRight: 6 }}
        />
        选择 .sql 文件
      </button>
    </div>
  );
}

interface PreviewProps {
  preview: SqlPreview;
  fileName: string;
  onConfirm: () => void;
  onPickFile: () => void;
}

function Preview({
  preview,
  fileName,
  onConfirm,
  onPickFile,
}: PreviewProps): ReactElement {
  const importable = preview.importable;
  const skipped = preview.skipped;
  const mcp = preview.preview_mcp.length;
  return (
    <div data-testid="import-sql-preview" style={{ marginTop: 'var(--space-3)' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 'var(--space-3)',
        }}
      >
        <div style={{ fontSize: 'var(--fs-body)', color: 'var(--text-secondary)' }}>
          文件: <code style={codeStyle}>{fileName}</code>
        </div>
        <button
          type="button"
          data-testid="import-sql-repick"
          onClick={onPickFile}
          style={btnStyle}
        >
          换一个文件
        </button>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          gap: 'var(--space-3)',
          marginBottom: 'var(--space-4)',
        }}
      >
        <SummaryCard label="原始行数" value={preview.total_lines} tone="default" />
        <SummaryCard
          label="可导入"
          value={importable}
          tone={importable > 0 ? 'success' : 'muted'}
          testId="import-sql-stat-importable"
        />
        <SummaryCard
          label="跳过"
          value={skipped}
          tone={skipped > 0 ? 'warning' : 'muted'}
          testId="import-sql-stat-skipped"
        />
      </div>

      {importable > 0 && <PreviewList providers={preview.preview_providers} />}

      {mcp > 0 && <McpPreviewBanner count={mcp} mcp={preview.preview_mcp} />}

      {skipped > 0 && (
        <SkippedDetails samples={preview.skipped_samples} total={skipped} />
      )}

      {importable === 0 && (
        <div
          data-testid="import-sql-empty"
          style={{
            padding: 'var(--space-4)',
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-card)',
            color: 'var(--text-secondary)',
            textAlign: 'center',
          }}
        >
          当前文件中没有可导入的 provider。可检查文件格式或跳过错误后再试。
        </div>
      )}

      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 'var(--space-2)',
          marginTop: 'var(--space-4)',
        }}
      >
        <button
          type="button"
          data-testid="import-sql-confirm"
          onClick={onConfirm}
          disabled={importable === 0}
          style={{
            ...btnStyle,
            background: importable === 0 ? 'var(--bg-overlay)' : 'var(--accent)',
            color: importable === 0 ? 'var(--text-muted)' : '#fff',
            border: 'none',
            fontWeight: 600,
            padding: '10px 20px',
            opacity: importable === 0 ? 0.6 : 1,
            cursor: importable === 0 ? 'not-allowed' : 'pointer',
          }}
        >
          <Upload
            size={16}
            aria-hidden="true"
            style={{ verticalAlign: 'middle', marginRight: 6 }}
          />
          确认导入 {importable > 0 ? `(${importable} 个 provider)` : ''}
        </button>
      </div>
    </div>
  );
}

interface SummaryCardProps {
  label: string;
  value: number;
  tone: 'default' | 'success' | 'warning' | 'muted';
  testId?: string;
}

function SummaryCard({
  label,
  value,
  tone,
  testId,
}: SummaryCardProps): ReactElement {
  const color =
    tone === 'success'
      ? 'var(--success)'
      : tone === 'warning'
        ? 'var(--warning)'
        : tone === 'muted'
          ? 'var(--text-muted)'
          : 'var(--text-primary)';
  return (
    <div
      data-testid={testId}
      style={{
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border)',
        borderLeft: `3px solid ${color}`,
        borderRadius: 'var(--radius-card)',
        padding: 'var(--space-3) var(--space-4)',
        boxShadow: 'var(--shadow-sm)',
      }}
    >
      <div
        style={{
          fontSize: 'var(--fs-caption)',
          color: 'var(--text-secondary)',
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: '24px',
          fontWeight: 600,
          color,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </div>
    </div>
  );
}

function PreviewList({ providers }: { providers: Provider[] }): ReactElement {
  return (
    <div
      data-testid="import-sql-provider-list"
      style={{
        marginBottom: 'var(--space-3)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-card)',
        background: 'var(--bg-elevated)',
        maxHeight: 280,
        overflowY: 'auto',
      }}
    >
      <div
        style={{
          padding: '8px 16px',
          fontSize: 'var(--fs-caption)',
          color: 'var(--text-secondary)',
          borderBottom: '1px solid var(--border)',
          fontWeight: 600,
        }}
      >
        待导入 provider 预览
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {providers.map((p) => (
          <li
            key={p.id}
            data-testid={`import-sql-row-${p.id}`}
            style={{
              padding: '8px 16px',
              borderBottom: '1px solid var(--border)',
              fontSize: 'var(--fs-body)',
              color: 'var(--text-primary)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontWeight: 600 }}>{p.name}</span>
              <code style={codeStyle}>{p.id}</code>
              <span
                style={{
                  fontSize: 'var(--fs-caption)',
                  color: 'var(--text-muted)',
                }}
              >
                · {p.provider_type}
              </span>
            </div>
            <div
              style={{
                fontFamily: 'monospace',
                fontSize: 'var(--fs-caption)',
                color: 'var(--text-secondary)',
                marginTop: 2,
                wordBreak: 'break-all',
              }}
            >
              {p.api_base}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function McpPreviewBanner({
  count,
  mcp,
}: {
  count: number;
  mcp: McpServer[];
}): ReactElement {
  return (
    <div
      data-testid="import-sql-mcp-banner"
      style={{
        background: 'var(--bg-overlay)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-card)',
        padding: 'var(--space-3) var(--space-4)',
        marginBottom: 'var(--space-3)',
        fontSize: 'var(--fs-body)',
        color: 'var(--text-secondary)',
      }}
    >
      <strong style={{ color: 'var(--text-primary)' }}>
        已解析 {count} 个 MCP server
      </strong>
      <span style={{ marginLeft: 6 }}>
        （M2.2 仅预览；写盘由 F6 在 M2.3+ 提供）
      </span>
      <ul
        style={{
          listStyle: 'none',
          margin: '8px 0 0 0',
          padding: 0,
          fontSize: 'var(--fs-caption)',
          color: 'var(--text-muted)',
        }}
      >
        {mcp.slice(0, 5).map((m) => (
          <li key={m.id} style={{ fontFamily: 'monospace' }}>
            · {m.name} ({m.id}) — {m.command || '无 command'}
          </li>
        ))}
        {mcp.length > 5 && <li>…等 {mcp.length - 5} 个</li>}
      </ul>
    </div>
  );
}

function SkippedDetails({
  samples,
  total,
}: {
  samples: SkippedLine[];
  total: number;
}): ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <details
      data-testid="import-sql-skipped-details"
      style={{
        marginBottom: 'var(--space-3)',
        border: '1px solid var(--warning)',
        borderRadius: 'var(--radius-card)',
        background: 'var(--bg-elevated)',
        padding: 'var(--space-2) var(--space-3)',
      }}
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary
        style={{
          cursor: 'pointer',
          fontSize: 'var(--fs-body)',
          color: 'var(--warning)',
          fontWeight: 600,
        }}
      >
        <FileWarning
          size={14}
          aria-hidden="true"
          style={{ verticalAlign: 'middle', marginRight: 6 }}
        />
        跳过 {total} 行（点击查看详情）
      </summary>
      <ul
        style={{
          listStyle: 'none',
          margin: '8px 0 0 0',
          padding: 0,
          fontSize: 'var(--fs-caption)',
          color: 'var(--text-secondary)',
        }}
      >
        {samples.map((s, i) => (
          <li
            key={i}
            data-testid={`import-sql-skip-${i}`}
            style={{ fontFamily: 'monospace', marginBottom: 2 }}
          >
            行 {s.line}: {s.reason}
          </li>
        ))}
        {total > samples.length && (
          <li style={{ color: 'var(--text-muted)' }}>
            …等 {total - samples.length} 行（仅显示前 {samples.length} 条）
          </li>
        )}
      </ul>
    </details>
  );
}

interface DoneViewProps {
  result: ImportResult;
  fileName: string;
  onReset: () => void;
  onPickFile: () => void;
}

function DoneView({
  result,
  fileName,
  onReset,
  onPickFile,
}: DoneViewProps): ReactElement {
  const success = result.errors.length === 0;
  const tone: 'success' | 'warning' =
    success && result.imported > 0 ? 'success' : 'warning';
  const summary =
    result.imported === 0 && result.skipped === 0 && result.errors.length > 0
      ? `导入失败：${result.errors.length} 个错误`
      : result.imported > 0
        ? `成功导入 ${result.imported} 个 provider${
            result.skipped > 0 ? `，跳过 ${result.skipped} 个重复` : ''
          }`
        : `没有可导入的内容${
            result.skipped > 0 ? `（跳过 ${result.skipped} 个重复）` : ''
          }`;
  return (
    <div
      data-testid="import-sql-done"
      style={{
        background: 'var(--bg-elevated)',
        border: `1px solid ${tone === 'success' ? 'var(--success)' : 'var(--warning)'}`,
        borderRadius: 'var(--radius-card)',
        padding: 'var(--space-4)',
        boxShadow: 'var(--shadow-sm)',
      }}
    >
      <h2
        style={{
          margin: 0,
          marginBottom: 'var(--space-2)',
          fontSize: 'var(--fs-heading)',
          color: tone === 'success' ? 'var(--success)' : 'var(--warning)',
        }}
      >
        {tone === 'success' ? '✓ 导入完成' : '⚠ 部分导入'}
      </h2>
      <div
        data-testid="import-sql-done-summary"
        style={{
          fontSize: 'var(--fs-body)',
          color: 'var(--text-primary)',
          marginBottom: 'var(--space-3)',
        }}
      >
        {summary}
        {result.mcp_count > 0 && (
          <div
            style={{
              marginTop: 4,
              color: 'var(--text-secondary)',
              fontSize: 'var(--fs-caption)',
            }}
          >
            + 解析了 {result.mcp_count} 个 MCP server（仅预览，未写盘）
          </div>
        )}
        <div
          style={{
            marginTop: 4,
            color: 'var(--text-muted)',
            fontSize: 'var(--fs-caption)',
          }}
        >
          文件: <code style={codeStyle}>{fileName}</code>
        </div>
      </div>
      {result.errors.length > 0 && (
        <SkippedDetails
          samples={result.errors.map((e) => ({
            line: e.line,
            reason: formatErrorEntry(e),
          }))}
          total={result.errors.length}
        />
      )}
      <div
        style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}
      >
        <button
          type="button"
          data-testid="import-sql-done-pick"
          onClick={onPickFile}
          style={btnStyle}
        >
          导入另一个文件
        </button>
        <button
          type="button"
          data-testid="import-sql-done-home"
          onClick={onReset}
          style={btnStyle}
        >
          完成
        </button>
      </div>
    </div>
  );
}

function StatusLine({
  icon,
  text,
}: {
  icon: 'parsing' | 'importing';
  text: string;
}): ReactElement {
  return (
    <div
      data-testid={`import-sql-status-${icon}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
        padding: 'var(--space-4)',
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-card)',
        color: 'var(--text-secondary)',
        fontSize: 'var(--fs-body)',
      }}
    >
      <div
        aria-label="loading"
        style={{
          width: 16,
          height: 16,
          border: '2px solid var(--text-muted)',
          borderTopColor: 'var(--accent)',
          borderRadius: '50%',
          animation: 'import-sql-spin 0.8s linear infinite',
        }}
      />
      {text}
      <style>{`@keyframes import-sql-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function ErrorView({
  message,
  onReset,
}: {
  message: string;
  onReset: () => void;
}): ReactElement {
  return (
    <div
      data-testid="import-sql-error"
      style={{
        background: 'var(--bg-elevated)',
        border: '1px solid var(--danger)',
        borderRadius: 'var(--radius-card)',
        padding: 'var(--space-4)',
        color: 'var(--danger)',
      }}
    >
      <h2
        style={{
          margin: 0,
          marginBottom: 'var(--space-2)',
          fontSize: 'var(--fs-heading)',
        }}
      >
        导入失败
      </h2>
      <div
        style={{
          fontSize: 'var(--fs-body)',
          marginBottom: 'var(--space-3)',
          color: 'var(--text-primary)',
        }}
      >
        {message}
      </div>
      <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
        <button
          type="button"
          data-testid="import-sql-error-retry"
          onClick={onReset}
          style={btnStyle}
        >
          重试
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatErrorEntry(e: ImportSkip): string {
  const idPart = e.id ? ` (id=${e.id})` : '';
  const linePart = e.line > 0 ? `行 ${e.line}: ` : '';
  return `${e.kind}: ${linePart}${e.reason}${idPart}`;
}

function stringifyError(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

const btnStyle: React.CSSProperties = {
  padding: '6px 12px',
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-button)',
  fontSize: 'var(--fs-body)',
  color: 'var(--text-primary)',
  cursor: 'pointer',
};

const codeStyle: React.CSSProperties = {
  fontFamily: 'monospace',
  fontSize: 'var(--fs-caption)',
  background: 'var(--bg-overlay)',
  padding: '1px 6px',
  borderRadius: 'var(--radius-button)',
};

export default ImportSqlPage;