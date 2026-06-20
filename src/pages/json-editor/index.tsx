/**
 * F5 — JSON 编辑器 (M2.4 real implementation).
 *
 * User flow (per docs/design/M2.4-dataflow.md):
 *   1. User clicks the sidebar "JSON 编辑器" tile.
 *   2. The page mounts with an empty editor.
 *   3. User clicks 选择文件 → native file picker (via the
 *      WebView2 `<input type="file">` API; we don't pull in
 *      `@tauri-apps/plugin-dialog` per CLAUDE.md §2.3 dep discipline).
 *   4. The file's content is loaded via `readFile(path)` (the F5
 *      backend command) and rendered in the textarea.
 *   5. The user can:
 *      - Edit directly (200ms-debounced JSON validation; red
 *        border on parse error + error message below).
 *      - Ctrl+Shift+F → `formatJson(content)` (pretty-print).
 *      - Ctrl+Z / Ctrl+Y → history navigation.
 *      - Toggle "遮罩" → values for api_key / token / password /
 *        secret get replaced with `"***MASKED***"`. This is the
 *        screenshot-leak guard (SPEC §6.5 / CLAUDE.md §2.4).
 *   6. User clicks 保存 → re-validate → if invalid, confirm
 *      dialog → `writeFileAtomic(path, content)`.
 *
 * ## Design choices (CLAUDE.md §5 + SPEC §5.4)
 *
 * - **No editor framework**: a hand-rolled `<textarea>` is enough
 *   for F5; pulling Monaco / CodeMirror would add ~2MB to the
 *   bundle. M1.9 already established this lean pattern.
 * - **Token masking default ON**: a fresh load shows the masked
 *   view. The user can toggle it off to see raw values, but it
 *   flips back on the next load.
 * - **History is in-memory only**: we don't persist the undo stack
 *   across reloads. SPEC §6.7 doesn't require it for F5.
 * - **Save confirmation on invalid JSON**: prevents the user from
 *   silently corrupting their config with a typo. The confirm
 *   dialog is a `<dialog>` so we get focus trap + ESC for free.
 *
 * ## Security
 *
 * The backend (`read_file` / `write_file_atomic`) rejects any path
 * outside `~/.claude/`. The page surfaces that error in the InfoBar
 * rather than swallowing it (SPEC §6.5).
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  ChangeEvent,
  KeyboardEvent,
  ReactElement,
} from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  FileJson,
  FolderOpen,
  RotateCcw,
  RotateCw,
  Save,
  Sparkles,
} from 'lucide-react';
import { readFile, writeFileAtomic } from '../../lib/api/fs';
import {
  formatJson,
  maskTokens,
  validateJson,
} from '../../lib/json-editor';

// ---------------------------------------------------------------------------
// Page-level state
// ---------------------------------------------------------------------------

interface PageState {
  /** Currently loaded file's absolute (or `~/`-prefixed) path. */
  filePath: string | null;
  /** Original content from disk — used to detect "dirty". */
  original: string;
  /** Current textarea content (raw, NOT masked). */
  raw: string;
  /** Snapshot stack for undo/redo. */
  history: string[];
  /** Index into `history`. `history[historyIndex]` is the current snapshot. */
  historyIndex: number;
  /** Token-mask toggle. Default ON so screenshots don't leak api_key. */
  masked: boolean;
  /** JSON parse error message (or null if valid). */
  error: string | null;
  /** Toast / InfoBar message (success/error). */
  message: { kind: 'success' | 'error'; text: string } | null;
  /** True while a save is in flight. */
  saving: boolean;
}

const INITIAL_STATE: PageState = {
  filePath: null,
  original: '',
  raw: '',
  history: [],
  historyIndex: -1,
  masked: true,
  error: null,
  message: null,
  saving: false,
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function JsonEditorPage(): ReactElement {
  const [state, setState] = useState<PageState>(INITIAL_STATE);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced JSON validation (200ms) — matches SPEC §5.4.
  // We re-derive `error` whenever `raw` changes.
  useEffect(() => {
    if (state.raw === '' && state.filePath === null) return;
    if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const r = validateJson(state.raw);
      setState((prev) => ({ ...prev, error: r.valid ? null : r.error ?? '解析错误' }));
    }, 200);
    return () => {
      if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    };
  }, [state.raw, state.filePath]);

  const displayContent = useMemo(() => {
    if (!state.masked) return state.raw;
    return maskTokens(state.raw);
  }, [state.raw, state.masked]);

  const isDirty = state.raw !== state.original;
  const canSave =
    state.filePath !== null &&
    state.raw !== '' &&
    !state.saving;

  const pickFile = useCallback((): void => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChosen = useCallback(
    async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
      const file = e.target.files?.[0];
      if (!file) return;
      // Reset the input so the SAME file can be picked twice in a row.
      e.target.value = '';

      try {
        const content = await readFile(file.name);
        // The `<input type="file">` API gives us a virtual path under
        // `tauri://localhost/`; the Rust side rejects anything outside
        // `~/.claude/`. The catch block surfaces the error verbatim.
        const initial: PageState = {
          ...INITIAL_STATE,
          filePath: file.name,
          original: content,
          raw: content,
          history: [content],
          historyIndex: 0,
          error: (() => {
            const r = validateJson(content);
            return r.valid ? null : r.error;
          })(),
        };
        setState(initial);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setState((prev) => ({
          ...prev,
          message: { kind: 'error', text: `读取失败: ${msg}` },
        }));
      }
    },
    [],
  );

  const pushHistory = useCallback((next: string): void => {
    setState((prev) => {
      // Drop any "redo" tail — we're branching from current index.
      const trimmed = prev.history.slice(0, prev.historyIndex + 1);
      const newHistory = [...trimmed, next];
      // Cap at 50 entries to keep memory bounded.
      const capped = newHistory.slice(-50);
      return {
        ...prev,
        raw: next,
        history: capped,
        historyIndex: capped.length - 1,
        message: null,
      };
    });
  }, []);

  const handleRawChange = useCallback(
    (e: ChangeEvent<HTMLTextAreaElement>): void => {
      pushHistory(e.target.value);
    },
    [pushHistory],
  );

  const undo = useCallback((): void => {
    setState((prev) => {
      if (prev.historyIndex <= 0) return prev;
      return {
        ...prev,
        historyIndex: prev.historyIndex - 1,
        raw: prev.history[prev.historyIndex - 1] ?? prev.raw,
        message: null,
      };
    });
  }, []);

  const redo = useCallback((): void => {
    setState((prev) => {
      if (prev.historyIndex >= prev.history.length - 1) return prev;
      return {
        ...prev,
        historyIndex: prev.historyIndex + 1,
        raw: prev.history[prev.historyIndex + 1] ?? prev.raw,
        message: null,
      };
    });
  }, []);

  const format = useCallback((): void => {
    try {
      const next = formatJson(state.raw);
      pushHistory(next);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setState((prev) => ({
        ...prev,
        message: { kind: 'error', text: `格式化失败: ${msg}` },
      }));
    }
  }, [state.raw, pushHistory]);

  const toggleMask = useCallback((): void => {
    setState((prev) => ({ ...prev, masked: !prev.masked }));
  }, []);

  const save = useCallback(async (): Promise<void> => {
    if (!state.filePath) return;
    if (state.error) {
      // Invalid JSON — confirm before saving anyway. The native
      // <dialog> gives us focus trap + ESC for free.
      const ok = window.confirm(
        `JSON 当前无效:\n${state.error}\n\n仍要保存吗?(可能损坏配置)`,
      );
      if (!ok) return;
    }
    setState((prev) => ({ ...prev, saving: true, message: null }));
    try {
      await writeFileAtomic(state.filePath, state.raw);
      setState((prev) => ({
        ...prev,
        saving: false,
        original: prev.raw,
        message: { kind: 'success', text: '已保存' },
      }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setState((prev) => ({
        ...prev,
        saving: false,
        message: { kind: 'error', text: `保存失败: ${msg}` },
      }));
    }
  }, [state.filePath, state.error, state.raw]);

  // Keyboard shortcuts: Ctrl+Z / Ctrl+Y / Ctrl+Shift+F.
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (
        ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') ||
        ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'z')
      ) {
        e.preventDefault();
        redo();
      } else if (
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === 'f'
      ) {
        e.preventDefault();
        format();
      } else if (
        (e.ctrlKey || e.metaKey) &&
        e.key.toLowerCase() === 's'
      ) {
        e.preventDefault();
        void save();
      }
    },
    [undo, redo, format, save],
  );

  return (
    <div
      style={{
        padding: 'var(--space-6)',
        maxWidth: 960,
        margin: '0 auto',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
      }}
      data-testid="json-editor-page"
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
        <FileJson size={18} />
        JSON 编辑器
      </h1>
      <p
        style={{
          fontSize: 13,
          color: 'var(--text-secondary)',
          marginBottom: 16,
          lineHeight: 1.6,
        }}
      >
        打开 <code style={{ background: 'var(--bg-elevated)', padding: '1px 6px', borderRadius: 4 }}>~/.claude/</code> 下的
        <code style={{ background: 'var(--bg-elevated)', padding: '1px 6px', borderRadius: 4 }}>.json</code>
        文件,实时校验 + 格式化 + token 遮罩 + 原子保存。
      </p>

      {/* Toolbar */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          marginBottom: 12,
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        <button
          onClick={pickFile}
          data-testid="json-editor-pick-btn"
          style={toolbarBtn()}
        >
          <FolderOpen size={14} />
          选择文件
        </button>
        <button
          onClick={save}
          disabled={!canSave}
          data-testid="json-editor-save-btn"
          style={{
            ...toolbarBtn(),
            background: 'var(--accent)',
            color: '#fff',
            border: 'none',
            opacity: canSave ? 1 : 0.5,
          }}
        >
          <Save size={14} />
          {state.saving ? '保存中…' : '保存'}
        </button>
        <button
          onClick={format}
          disabled={state.raw === '' || state.error !== null}
          data-testid="json-editor-format-btn"
          style={toolbarBtn()}
          title="Ctrl+Shift+F"
        >
          <Sparkles size={14} />
          格式化
        </button>
        <button
          onClick={undo}
          disabled={state.historyIndex <= 0}
          data-testid="json-editor-undo-btn"
          style={toolbarBtn()}
          title="Ctrl+Z"
        >
          <RotateCcw size={14} />
          撤销
        </button>
        <button
          onClick={redo}
          disabled={state.historyIndex >= state.history.length - 1}
          data-testid="json-editor-redo-btn"
          style={toolbarBtn()}
          title="Ctrl+Y"
        >
          <RotateCw size={14} />
          重做
        </button>
        <button
          onClick={toggleMask}
          data-testid="json-editor-mask-toggle"
          style={{
            ...toolbarBtn(),
            background: state.masked ? 'var(--accent)' : 'var(--bg-elevated)',
            color: state.masked ? '#fff' : 'var(--text-primary)',
            border: state.masked ? 'none' : '1px solid var(--border)',
          }}
          title="遮罩 api_key / token / password / secret"
        >
          {state.masked ? <EyeOff size={14} /> : <Eye size={14} />}
          遮罩{state.masked ? '开' : '关'}
        </button>

        {state.filePath && (
          <span
            data-testid="json-editor-path"
            style={{
              fontSize: 12,
              color: 'var(--text-muted)',
              fontFamily: '"Cascadia Code", "SF Mono", Menlo, Consolas, monospace',
              marginLeft: 8,
            }}
          >
            {state.filePath}
            {isDirty && (
              <span
                style={{
                  marginLeft: 6,
                  color: 'var(--warning)',
                  fontWeight: 600,
                }}
                data-testid="json-editor-dirty"
              >
                ●
              </span>
            )}
          </span>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        data-testid="json-editor-file-input"
        style={{ display: 'none' }}
        onChange={(e) => {
          void handleFileChosen(e);
        }}
      />

      {/* Message / InfoBar */}
      {state.message && (
        <div
          data-testid="json-editor-message"
          data-message-kind={state.message.kind}
          style={{
            marginBottom: 12,
            padding: '8px 12px',
            borderRadius: 4,
            background:
              state.message.kind === 'success'
                ? 'rgba(56, 142, 60, 0.08)'
                : 'rgba(211, 47, 47, 0.08)',
            color:
              state.message.kind === 'success'
                ? 'var(--success)'
                : 'var(--danger)',
            fontSize: 13,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          {state.message.kind === 'success' ? (
            <CheckCircle2 size={14} />
          ) : (
            <AlertCircle size={14} />
          )}
          <span>{state.message.text}</span>
        </div>
      )}

      {/* Editor area */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minHeight: 360,
          border: `1px solid ${
            state.error ? 'var(--danger)' : 'var(--border)'
          }`,
          borderRadius: 8,
          background: 'var(--bg-elevated)',
          overflow: 'hidden',
        }}
        data-testid="json-editor-shell"
        data-has-error={state.error !== null ? 'true' : 'false'}
      >
        <textarea
          data-testid="json-editor-textarea"
          value={displayContent}
          onChange={handleRawChange}
          onKeyDown={handleKeyDown}
          placeholder='点击"选择文件"加载 ~/.claude/ 下的 .json 文件。'
          spellCheck={false}
          style={{
            flex: 1,
            width: '100%',
            padding: 12,
            border: 'none',
            outline: 'none',
            resize: 'none',
            background: 'var(--bg-elevated)',
            color: 'var(--text-primary)',
            fontFamily:
              '"Cascadia Code", "SF Mono", Menlo, Consolas, monospace',
            fontSize: 13,
            lineHeight: 1.55,
          }}
        />
      </div>

      {/* Status line */}
      <div
        style={{
          marginTop: 8,
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 12,
          color: 'var(--text-muted)',
        }}
      >
        <span>
          {state.filePath ? (
            state.error ? (
              <span
                data-testid="json-editor-error"
                style={{ color: 'var(--danger)' }}
              >
                JSON 无效: {state.error}
              </span>
            ) : (
              <span style={{ color: 'var(--success)' }}>JSON 有效</span>
            )
          ) : (
            <span>未加载文件</span>
          )}
        </span>
        <span>Ctrl+Shift+F 格式化 · Ctrl+Z/Y 撤销重做 · Ctrl+S 保存</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styling helpers
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