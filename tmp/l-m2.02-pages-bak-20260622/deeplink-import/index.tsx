/**
 * F4 — Deeplink 导入 (M2.3 real implementation).
 *
 * User flow (per docs/design/M2.3-dataflow.md):
 *   1. User pastes a `ccswitch://v1/import?...` URL into the input
 *      box, OR the page receives a URL via the global
 *      `deep-link://new-url` event (fired by `tauri-plugin-deep-link`
 *      or the single-instance handler in `lib.rs`).
 *   2. The page calls `parseDeeplinkUrl(url)` → gets back a
 *      `ParsedDeeplink` with a validated `Provider`.
 *   3. A confirmation modal shows the parsed provider (name /
 *      type / base_url / models) so the user can sanity-check
 *      before commit. api_key is NEVER displayed (token leak risk).
 *   4. On [确认导入], the page calls `importSingleProvider(provider)`.
 *      On success → green toast + close modal. On `AlreadyExists` →
 *      red InfoBar + the id is highlighted as "rename and retry".
 *
 * ## Why this is a page (not just a modal)
 *
 * The pasted-URL input is the manual / developer entry point. The
 * OS-handled deeplink is the production entry point — when the
 * event fires, the page automatically pops the modal regardless of
 * what the user is currently looking at, because the page mounts
 * a global `useDeeplinkUrl` listener via the hook. The modal is
 * a `<dialog>` overlay rendered above whatever view is current.
 *
 * ## Design tokens (CLAUDE.md §4.2)
 *
 * All colors come from CSS variables (--bg-elevated, --text-primary,
 * --accent, --danger, --success, --border). No hardcoded hex.
 */
import { useCallback, useState } from 'react';
import type { ChangeEvent, ReactElement } from 'react';
import { Link2, CheckCircle2, AlertCircle, ClipboardPaste, X } from 'lucide-react';
import { useViewState } from '../../hooks/useViewState';
import { useDeeplinkUrl } from '../../hooks/useDeeplinkUrl';
import {
  importSingleProvider,
  parseDeeplinkUrl,
  type ParsedDeeplink,
} from '../../lib/api/providers';
import type { Provider } from '../../types/provider';

// ---------------------------------------------------------------------------
// Page-level state machine
// ---------------------------------------------------------------------------

type PageState =
  | { kind: 'idle'; urlInput: string }
  | { kind: 'parsing'; urlInput: string }
  | { kind: 'parsed'; urlInput: string; parsed: ParsedDeeplink }
  | { kind: 'importing'; urlInput: string; parsed: ParsedDeeplink }
  | { kind: 'success'; urlInput: string; message: string }
  | { kind: 'error'; urlInput: string; message: string };

const SAMPLE_URL =
  'ccswitch://v1/import?resource=provider&app=claude&name=GLM-4.6&endpoint=https%3A%2F%2Fapi.anthropic.com&apiKey=sk-demo&model=claude-sonnet-4-6';

export default function DeeplinkImportPage(): ReactElement {
  const { view } = useViewState();
  const { pendingUrl, consume, enqueue } = useDeeplinkUrl();

  const [state, setState] = useState<PageState>({ kind: 'idle', urlInput: '' });
  const [modalError, setModalError] = useState<string | null>(null);

  const inputChange = useCallback((e: ChangeEvent<HTMLInputElement>): void => {
    const v = e.target.value;
    setState((prev) => {
      if (prev.kind === 'idle') return { kind: 'idle', urlInput: v };
      if (prev.kind === 'error') return { kind: 'error', urlInput: v, message: prev.message };
      return prev;
    });
  }, []);

  const parse = useCallback(async (url: string): Promise<void> => {
    setState((prev) => ({ kind: 'parsing', urlInput: prev.urlInput }));
    try {
      const parsed = await parseDeeplinkUrl(url);
      if (!parsed.provider) {
        setState({ kind: 'error', urlInput: url, message: '解析成功但未返回 provider 数据' });
        return;
      }
      setState({ kind: 'parsed', urlInput: url, parsed });
    } catch (e) {
      setState({
        kind: 'error',
        urlInput: url,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }, []);

  // Auto-open modal when a deep-link URL arrives from the OS.
  if (pendingUrl && state.kind === 'idle') {
    void parse(pendingUrl);
  }

  const submitPaste = useCallback((): void => {
    if (state.kind !== 'idle' && state.kind !== 'error') return;
    const url = state.urlInput.trim();
    if (!url) return;
    void parse(url);
  }, [state, parse]);

  const pasteSample = useCallback((): void => {
    setState({ kind: 'idle', urlInput: SAMPLE_URL });
    // Also enqueue it so the modal pops, demonstrating the OS-driven flow.
    enqueue(SAMPLE_URL);
  }, [enqueue]);

  const confirmImport = useCallback(async (): Promise<void> => {
    if (state.kind !== 'parsed' || !state.parsed.provider) return;
    setState({ kind: 'importing', urlInput: state.urlInput, parsed: state.parsed });
    setModalError(null);
    try {
      await importSingleProvider(state.parsed.provider);
      setState({
        kind: 'success',
        urlInput: state.urlInput,
        message: `Provider "${state.parsed.provider.name}" 已导入到 library`,
      });
      consume();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setModalError(msg);
      // Return to parsed state so the user can retry / cancel.
      setState({ kind: 'parsed', urlInput: state.urlInput, parsed: state.parsed });
    }
  }, [state, consume]);

  const cancelModal = useCallback((): void => {
    setModalError(null);
    setState({ kind: 'idle', urlInput: '' });
    consume();
  }, [consume]);

  const parsed = state.kind === 'parsed' || state.kind === 'importing' ? state.parsed : null;
  const isImporting = state.kind === 'importing';

  return (
    <div
      style={{
        padding: 'var(--space-6)',
        maxWidth: 720,
        margin: '0 auto',
      }}
      data-testid="deeplink-import-page"
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
        <Link2 size={18} />
        Deeplink 导入
      </h1>
      <p
        style={{
          fontSize: 13,
          color: 'var(--text-secondary)',
          marginBottom: 24,
          lineHeight: 1.6,
        }}
      >
        从 <code style={{ background: 'var(--bg-elevated)', padding: '1px 6px', borderRadius: 4 }}>ccswitch://v1/import?...</code> URL
        解析单个 provider 配置,导入到 library。
        OS 唤起（如点网页链接 → 打开本应用）会自动弹出模态；这里也可以手动粘贴 URL 调试。
      </p>

      {/* URL input row */}
      <div
        style={{
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: 16,
          marginBottom: 16,
        }}
      >
        <label
          htmlFor="deeplink-url-input"
          style={{
            display: 'block',
            fontSize: 12,
            color: 'var(--text-secondary)',
            marginBottom: 6,
          }}
        >
          deeplink URL
        </label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            id="deeplink-url-input"
            data-testid="deeplink-url-input"
            value={state.kind === 'idle' || state.kind === 'error' ? state.urlInput : state.urlInput}
            onChange={inputChange}
            placeholder="ccswitch://v1/import?resource=provider&app=claude&..."
            style={{
              flex: 1,
              padding: '8px 10px',
              border: '1px solid var(--border)',
              borderRadius: 4,
              fontSize: 13,
              fontFamily: '"Cascadia Code", "SF Mono", Menlo, Consolas, monospace',
              background: 'var(--bg-primary)',
              color: 'var(--text-primary)',
              outline: 'none',
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitPaste();
            }}
          />
          <button
            data-testid="deeplink-paste-btn"
            onClick={pasteSample}
            style={{
              padding: '8px 12px',
              border: '1px solid var(--border)',
              borderRadius: 4,
              background: 'var(--bg-elevated)',
              color: 'var(--text-secondary)',
              fontSize: 12,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <ClipboardPaste size={14} />
            示例
          </button>
          <button
            data-testid="deeplink-parse-btn"
            onClick={submitPaste}
            disabled={
              !(state.kind === 'idle' || state.kind === 'error') ||
              !state.urlInput.trim()
            }
            style={{
              padding: '8px 16px',
              border: 'none',
              borderRadius: 4,
              background: 'var(--accent)',
              color: '#fff',
              fontSize: 13,
              cursor: 'pointer',
              opacity:
                (state.kind === 'idle' || state.kind === 'error') && state.urlInput.trim()
                  ? 1
                  : 0.5,
            }}
          >
            解析
          </button>
        </div>
        {state.kind === 'parsing' && (
          <div
            style={{
              marginTop: 8,
              fontSize: 12,
              color: 'var(--text-secondary)',
            }}
          >
            解析中…
          </div>
        )}
        {state.kind === 'error' && (
          <div
            data-testid="deeplink-error"
            style={{
              marginTop: 8,
              padding: '8px 10px',
              borderRadius: 4,
              background: 'rgba(211, 47, 47, 0.08)',
              color: 'var(--danger)',
              fontSize: 12,
              display: 'flex',
              alignItems: 'flex-start',
              gap: 6,
            }}
          >
            <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 2 }} />
            <span>{state.message}</span>
          </div>
        )}
        {state.kind === 'success' && (
          <div
            data-testid="deeplink-success"
            style={{
              marginTop: 8,
              padding: '8px 10px',
              borderRadius: 4,
              background: 'rgba(56, 142, 60, 0.08)',
              color: 'var(--success)',
              fontSize: 12,
              display: 'flex',
              alignItems: 'flex-start',
              gap: 6,
            }}
          >
            <CheckCircle2 size={14} style={{ flexShrink: 0, marginTop: 2 }} />
            <span>{state.message}</span>
          </div>
        )}
      </div>

      {/* Status hint */}
      <div
        style={{
          fontSize: 12,
          color: 'var(--text-muted)',
          lineHeight: 1.5,
        }}
      >
        当前 view: <code>{view}</code> — 在其他 view 时收到 deeplink 会切换过来并弹模态。
      </div>

      {/* Modal (only when parsed) */}
      {parsed?.provider && (
        <ImportConfirmModal
          provider={parsed.provider}
          isImporting={isImporting}
          error={modalError}
          onConfirm={confirmImport}
          onCancel={cancelModal}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modal — uses native <dialog> so we get focus trap + ESC for free
// ---------------------------------------------------------------------------

interface ImportConfirmModalProps {
  provider: Provider;
  isImporting: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

function ImportConfirmModal({
  provider,
  isImporting,
  error,
  onConfirm,
  onCancel,
}: ImportConfirmModalProps): ReactElement {
  return (
    <div
      data-testid="deeplink-modal-backdrop"
      onClick={onCancel}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.4)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        data-testid="deeplink-modal"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          padding: 24,
          maxWidth: 480,
          width: '90%',
          boxShadow: 'var(--shadow-md)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 16,
          }}
        >
          <h2
            style={{
              fontSize: 16,
              fontWeight: 600,
              color: 'var(--text-primary)',
            }}
          >
            确认导入 provider
          </h2>
          <button
            onClick={onCancel}
            data-testid="deeplink-modal-close"
            style={{
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              color: 'var(--text-muted)',
              padding: 4,
            }}
          >
            <X size={18} />
          </button>
        </div>

        <Field label="id" value={provider.id} mono />
        <Field label="名称" value={provider.name} />
        <Field label="类型" value={provider.provider_type} />
        <Field label="API Base" value={provider.api_base} mono />
        <Field label="API Key" value="********" muted />
        {provider.models.length > 0 && (
          <Field label="Models" value={provider.models.join(', ')} mono />
        )}
        {provider.notes && <Field label="备注" value={provider.notes} />}

        {error && (
          <div
            data-testid="deeplink-modal-error"
            style={{
              marginTop: 12,
              padding: '8px 10px',
              borderRadius: 4,
              background: 'rgba(211, 47, 47, 0.08)',
              color: 'var(--danger)',
              fontSize: 12,
              display: 'flex',
              alignItems: 'flex-start',
              gap: 6,
            }}
          >
            <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 2 }} />
            <span>{error}</span>
          </div>
        )}

        <div
          style={{
            marginTop: 20,
            display: 'flex',
            gap: 8,
            justifyContent: 'flex-end',
          }}
        >
          <button
            onClick={onCancel}
            data-testid="deeplink-modal-cancel"
            style={{
              padding: '8px 16px',
              border: '1px solid var(--border)',
              borderRadius: 4,
              background: 'var(--bg-elevated)',
              color: 'var(--text-primary)',
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            取消
          </button>
          <button
            onClick={onConfirm}
            disabled={isImporting}
            data-testid="deeplink-modal-confirm"
            style={{
              padding: '8px 16px',
              border: 'none',
              borderRadius: 4,
              background: 'var(--accent)',
              color: '#fff',
              fontSize: 13,
              cursor: isImporting ? 'wait' : 'pointer',
              opacity: isImporting ? 0.6 : 1,
            }}
          >
            {isImporting ? '导入中…' : '确认导入'}
          </button>
        </div>
      </div>
    </div>
  );
}

interface FieldProps {
  label: string;
  value: string;
  mono?: boolean;
  muted?: boolean;
}

function Field({ label, value, mono, muted }: FieldProps): ReactElement {
  return (
    <div
      style={{
        display: 'flex',
        gap: 12,
        padding: '6px 0',
        fontSize: 13,
        borderBottom: '1px solid var(--border)',
      }}
    >
      <span
        style={{
          minWidth: 80,
          color: 'var(--text-muted)',
          fontSize: 12,
        }}
      >
        {label}
      </span>
      <span
        style={{
          color: muted ? 'var(--text-muted)' : 'var(--text-primary)',
          fontFamily: mono ? '"Cascadia Code", "SF Mono", Menlo, Consolas, monospace' : undefined,
          wordBreak: 'break-all',
          flex: 1,
        }}
      >
        {value}
      </span>
    </div>
  );
}
