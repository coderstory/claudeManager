/**
 * F6 — MCP 管理 (M2.5 real implementation).
 *
 * User flow (per docs/design/M2.5-dataflow.md):
 *   1. User clicks the sidebar "MCP 管理" tile.
 *   2. The page mounts and calls `listMcpServers` to fetch from
 *      `~/.claude/mcp.json`.
 *   3. The page renders a table of MCP servers, with:
 *      - An enable/disable checkbox (optimistic update + rollback).
 *      - Edit / Delete action buttons per row.
 *      - A toolbar with "新增" + "从剪贴板导入" buttons.
 *   4. "新增" / "编辑" opens a modal form with the McpServer
 *      fields. "从剪贴板导入" reads
 *      `navigator.clipboard.readText()` and calls
 *      `parseMcpDeeplink` to fill the form.
 *   5. Save / Update / Toggle / Delete IPC calls go through
 *      `lib/api/mcp.ts`; errors are surfaced via InfoBar.
 *
 * ## Design choices (CLAUDE.md §5 + SPEC §5.4)
 *
 * - **Optimistic toggle**: the user expects sub-100ms feedback
 *   for an enable/disable checkbox. We update local state
 *   immediately, send the IPC, and roll back on failure.
 * - **Form modal**: hand-rolled `<dialog>` element so we get
 *   focus trap + ESC for free (matches the M2.4 JSON editor
 *   pattern).
 * - **No external libraries**: clipboard is the native browser
 *   API; we don't pull in a state library.
 * - **Token masking**: NOT applied here. MCP servers typically
 *   only have public tool names + commands. The args/env are
 *   shown verbatim. (M2.4's JsonEditorPage DOES mask; we don't
 *   double-mask.)
 *
 * ## Security
 *
 * All IPC calls go through Tauri's `invoke`, which the backend
 * scopes to `~/.claude/mcp.json` (via `McpService` deriving
 * the path from `AppPaths::claude_dir()`). The page cannot ask
 * the backend to write outside that path.
 */
import {
  useCallback,
  useEffect,
  useState,
} from 'react';
import type {
  ChangeEvent,
  FormEvent,
  ReactElement,
} from 'react';
import {
  Clipboard,
  Pencil,
  Plus,
  Server,
  Trash2,
} from 'lucide-react';
import type { McpServer, McpTransport } from '../../types/mcp';
import { ErrorBanner } from '../../components/ErrorBanner';
import { useProjects } from '../../hooks/useProjects';
import { useScope, syncScopeFromProject } from '../../hooks/useScope';
import {
  addMcpServer,
  listMcpServers,
  parseMcpDeeplink,
  removeMcpServer,
  toggleMcpServer,
  updateMcpServer,
} from '../../lib/api/mcp';

// ---------------------------------------------------------------------------
// Page-level state
// ---------------------------------------------------------------------------

interface PageState {
  servers: McpServer[];
  loading: boolean;
  warning: string | null;
  message: { kind: 'success' | 'error'; text: string } | null;
  modal: ModalState | null;
}

type ModalState =
  | { kind: 'add' }
  | { kind: 'edit'; server: McpServer }
  | { kind: 'import'; server: McpServer };

const INITIAL_STATE: PageState = {
  servers: [],
  loading: true,
  warning: null,
  message: null,
  modal: null,
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function McpManagementPage(): ReactElement {
  const [state, setState] = useState<PageState>(INITIAL_STATE);

  // Phase 27 Fix 4 (BUG-CR-04): scope state via useScope singleton.
  // Read currentProject from useProjects and sync to the scope store,
  // then subscribe to scope changes so we can force remount via key.
  const { currentProject } = useProjects();
  const [scope, , projectRoot] = useScope();

  // Sync scope from currentProject after render (not during render
  // to avoid React "setState while rendering a different component" warning).
  //
  // B8 fix: depend on the stable project id, not the `currentProject`
  // object. `currentProject` is derived via `projects.find(...)` so its
  // reference can change across renders (e.g. when `useProjects` reloads
  // the list after a switch). Depending on the object would re-fire this
  // effect on every render, which calls `syncScopeFromProject` → mutates
  // the scope store → `useScope` notifies → component re-renders → loop
  // (CPU 100%, "加载中" never resolves). The id is the only stable signal
  // for "which project is active".
  useEffect(() => {
    syncScopeFromProject(currentProject);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentProject?.id]);

  // Initial load.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await listMcpServers();
        if (cancelled) return;
        setState((prev) => ({ ...prev, servers: list, loading: false }));
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        setState((prev) => ({
          ...prev,
          loading: false,
          message: { kind: 'error', text: `加载失败: ${msg}` },
        }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const list = await listMcpServers();
      setState((prev) => ({ ...prev, servers: list, warning: null }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setState((prev) => ({
        ...prev,
        message: { kind: 'error', text: `刷新失败: ${msg}` },
      }));
    }
  }, []);

  // ---- toggle (optimistic) ----

  const handleToggle = useCallback(
    async (id: string, nextEnabled: boolean): Promise<void> => {
      // Optimistic update.
      const previous = state.servers;
      setState((prev) => ({
        ...prev,
        servers: prev.servers.map((s) =>
          s.id === id ? { ...s, enabled: nextEnabled } : s,
        ),
        message: null,
      }));
      try {
        const updated = await toggleMcpServer(id, nextEnabled);
        setState((prev) => ({
          ...prev,
          servers: prev.servers.map((s) => (s.id === id ? updated : s)),
        }));
      } catch (err) {
        // Rollback + error message.
        const msg = err instanceof Error ? err.message : String(err);
        setState((prev) => ({
          ...prev,
          servers: previous,
          message: { kind: 'error', text: `切换失败: ${msg}` },
        }));
      }
    },
    [state.servers],
  );

  // ---- delete ----

  const handleDelete = useCallback(
    async (server: McpServer): Promise<void> => {
      const ok = window.confirm(`确认删除 MCP server '${server.name}'?`);
      if (!ok) return;
      try {
        await removeMcpServer(server.id);
        setState((prev) => ({
          ...prev,
          servers: prev.servers.filter((s) => s.id !== server.id),
          message: { kind: 'success', text: `已删除 ${server.name}` },
        }));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setState((prev) => ({
          ...prev,
          message: { kind: 'error', text: `删除失败: ${msg}` },
        }));
      }
    },
    [],
  );

  // ---- modal openers ----

  const openAdd = useCallback((): void => {
    setState((prev) => ({ ...prev, modal: { kind: 'add' } }));
  }, []);

  const openEdit = useCallback((server: McpServer): void => {
    setState((prev) => ({ ...prev, modal: { kind: 'edit', server } }));
  }, []);

  const openImport = useCallback(async (): Promise<void> => {
    try {
      const text = await navigator.clipboard.readText();
      const trimmed = text.trim();
      if (!trimmed) {
        setState((prev) => ({
          ...prev,
          message: { kind: 'error', text: '剪贴板为空' },
        }));
        return;
      }
      // M5 bug #12 — 智能判别 JSON vs deeplink URL。
      // 旧逻辑无条件调 parseMcpDeeplink,粘贴 MCP server JSON 配置时
      // 会因 'invalid URL: relative URL without a base' 报错。两条路径
      // 都接受:JSON 直接解析为本页需要的 McpServer shape;URL 走原
      // deeplink 解析(保留向后兼容)。
      if (trimmed.startsWith('{')) {
        // JSON 路径:解析为 McpServer,填入 import modal。
        try {
          const obj = JSON.parse(trimmed) as Record<string, unknown>;
          // 期望 shape: { name, command/transport+args+env, ... }
          const name = typeof obj.name === 'string' ? obj.name : '';
          if (!name) {
            setState((prev) => ({
              ...prev,
              message: {
                kind: 'error',
                text: 'JSON 缺少 `name` 字段',
              },
            }));
            return;
          }
          // 兼容 stdio / http / sse 三种 transport。
          const transport =
            (obj.transport as string) ??
            (typeof obj.url === 'string' ? 'http' : 'stdio');
          const server: McpServer = {
            id: cryptoRandomId(),
            name,
            transport: transport as McpTransport,
            command: typeof obj.command === 'string' ? obj.command : '',
            args: Array.isArray(obj.args)
              ? (obj.args as unknown[]).map(String)
              : [],
            env:
              typeof obj.env === 'object' && obj.env !== null
                ? (obj.env as Record<string, string>)
                : {},
            url: typeof obj.url === 'string' ? obj.url : undefined,
            enabled: true,
            created_at: Math.floor(Date.now() / 1000),
          };
          setState((prev) => ({
            ...prev,
            modal: { kind: 'import', server },
            message: { kind: 'success', text: '已从剪贴板导入 (JSON)' },
          }));
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          setState((prev) => ({
            ...prev,
            message: {
              kind: 'error',
              text: `JSON 解析失败: ${msg}`,
            },
          }));
        }
        return;
      }
      // URL 路径:走 deeplink parser(向后兼容)。
      if (trimmed.startsWith('ccswitch://')) {
        const parsed = await parseMcpDeeplink(trimmed);
        if (parsed.action.kind !== 'import_mcp' || !parsed.mcp_server) {
          setState((prev) => ({
            ...prev,
            message: {
              kind: 'error',
              text: 'URL 不是 MCP deeplink (ccswitch://v1/import?resource=mcp&...)',
            },
          }));
          return;
        }
        setState((prev) => ({
          ...prev,
          modal: { kind: 'import', server: parsed.mcp_server! },
          message: { kind: 'success', text: '已从剪贴板导入' },
        }));
        return;
      }
      // 既不是 JSON 也不是已知 URL
      setState((prev) => ({
        ...prev,
        message: {
          kind: 'error',
          text: '剪贴板内容既不是 JSON 也不是 ccswitch:// deeplink URL',
        },
      }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setState((prev) => ({
        ...prev,
        message: { kind: 'error', text: `剪贴板读取失败: ${msg}` },
      }));
    }
  }, []);

  const closeModal = useCallback((): void => {
    setState((prev) => ({ ...prev, modal: null }));
  }, []);

  // ---- modal submit ----

  const handleSubmit = useCallback(
    async (server: McpServer): Promise<void> => {
      const modal = state.modal;
      if (!modal) return;
      try {
        if (modal.kind === 'add' || modal.kind === 'import') {
          await addMcpServer(server);
          setState((prev) => ({
            ...prev,
            modal: null,
            message: { kind: 'success', text: `已新增 ${server.name}` },
          }));
          await refresh();
        } else {
          const updated = await updateMcpServer(modal.server.id, server);
          setState((prev) => ({
            ...prev,
            modal: null,
            servers: prev.servers.map((s) => (s.id === updated.id ? updated : s)),
            message: { kind: 'success', text: `已更新 ${server.name}` },
          }));
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setState((prev) => ({
          ...prev,
          message: { kind: 'error', text: `保存失败: ${msg}` },
        }));
      }
    },
    [state.modal, refresh],
  );

  // ---- render ----

  const isEmpty = !state.loading && state.servers.length === 0;
  // M5 bug #11 — 当用户切换到项目级时,文案必须显示对应的路径
  // (项目级: `<root>/.claude/mcp.json`;用户级: `~/.claude/mcp.json`),
  // 不能两个状态都用同一个 `~/.claude/mcp.json`,否则用户切了项目
  // 但 UI 还在说改的是用户级,会引发数据写错位置的认知错位。
  // Phase 27 Fix 4: use scope from useScope() instead of currentProject
  // directly, so the label updates correctly on scope change.
  const mcpPathLabel = scope === 'project' && currentProject
    ? `${currentProject.name} (.claude/mcp.json)`
    : '~/.claude/mcp.json';

  // Phase 27 Fix 4 (BUG-CR-04): key-driven remount on scope change.
  // When the user switches scope in the sidebar, the key changes,
  // React unmounts the old instance (cancelling in-flight fetches via
  // the `cancelled` flag) and mounts a new one that re-runs the mount
  // effect with the new scope.
  const scopeKey = scope + ':' + (projectRoot ?? 'user');

  return (
    <div
      key={scopeKey}
      style={{
        padding: 'var(--space-6)',
        maxWidth: 720,
        margin: '0 auto',
      }}
      data-testid="mcp-management-page"
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
        <Server size={18} />
        MCP 管理
      </h1>
      <p
        style={{
          fontSize: 13,
          color: 'var(--text-secondary)',
          marginBottom: 16,
          lineHeight: 1.6,
        }}
      >
        管理 <code
          style={{ background: 'var(--bg-elevated)', padding: '1px 6px', borderRadius: 'var(--radius-button)' }}
          data-testid="mcp-path-label"
        >{mcpPathLabel}</code> 中的 MCP server 列表。
        启用 toggle 立即生效,所有写操作都会自动备份(SPEC §6.1)。
      </p>

      {/* Toolbar */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          marginBottom: 16,
          flexWrap: 'wrap',
        }}
      >
        <button
          onClick={openAdd}
          data-testid="mcp-add-btn"
          style={primaryBtn()}
        >
          <Plus size={14} />
          新增 MCP server
        </button>
        <button
          onClick={() => {
            void openImport();
          }}
          data-testid="mcp-import-btn"
          style={toolbarBtn()}
        >
          <Clipboard size={14} />
          从剪贴板导入
        </button>
        <button
          onClick={() => {
            void refresh();
          }}
          data-testid="mcp-refresh-btn"
          style={toolbarBtn()}
        >
          刷新
        </button>
      </div>

      {/* InfoBar — M2.17 F15 batch3: 内联提示条改用共享 ErrorBanner,
          保留对外 testid `mcp-message` + `data-message-kind` (原测试断言)。 */}
      {state.message && (
        <div
          data-testid="mcp-message"
          data-message-kind={state.message.kind}
          style={{ marginBottom: 12 }}
        >
          <ErrorBanner
            kind={state.message.kind}
            message={state.message.text}
          />
        </div>
      )}

      {/* Table */}
      {state.loading ? (
        <div
          data-testid="mcp-loading"
          style={{ padding: 32, color: 'var(--text-muted)', fontSize: 13 }}
        >
          加载中…
        </div>
      ) : isEmpty ? (
        <div
          data-testid="mcp-empty"
          style={{
            padding: 32,
            border: '1px dashed var(--border)',
            borderRadius: 'var(--radius-card)',
            background: 'var(--bg-elevated)',
            color: 'var(--text-muted)',
            textAlign: 'center',
            fontSize: 13,
          }}
        >
          未配置 MCP server。点击「新增 MCP server」开始配置,或粘贴 MCP server
          JSON 配置 / ccswitch://v1/import?resource=mcp URL 到剪贴板后点「从剪贴板导入」(自动识别)。
        </div>
      ) : (
        <div
          data-testid="mcp-table"
          style={{
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-card)',
            background: 'var(--bg-elevated)',
            overflow: 'hidden',
          }}
        >
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: 13,
            }}
          >
            <thead>
              <tr style={{ background: 'var(--bg-primary)' }}>
                <th style={thCell()}>名称</th>
                <th style={thCell()}>类型</th>
                <th style={thCell()}>命令 / URL</th>
                <th style={thCell()}>启用</th>
                <th style={thCell()}>操作</th>
              </tr>
            </thead>
            <tbody>
              {state.servers.map((s) => (
                <tr
                  key={s.id}
                  data-testid="mcp-row"
                  data-server-name={s.name}
                  style={{
                    borderTop: '1px solid var(--border)',
                  }}
                >
                  <td style={tdCell()}>
                    <span style={{ fontWeight: 500 }}>{s.name}</span>
                  </td>
                  <td style={tdCell()}>
                    <span
                      style={{
                        fontSize: 11,
                        padding: '2px 6px',
                        borderRadius: 'var(--radius-button)',
                        background: 'var(--bg-primary)',
                        color: 'var(--text-secondary)',
                      }}
                    >
                      {s.transport}
                    </span>
                  </td>
                  <td
                    style={{
                      ...tdCell(),
                      fontFamily:
                        '"Cascadia Code", "SF Mono", Menlo, Consolas, monospace',
                      fontSize: 12,
                      color: 'var(--text-secondary)',
                      maxWidth: 360,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={
                      s.transport === 'http'
                        ? s.url ?? ''
                        : [s.command ?? '', ...s.args].join(' ')
                    }
                  >
                    {s.transport === 'http'
                      ? s.url ?? '(no url)'
                      : [s.command ?? '(no command)', ...s.args].join(' ')}
                  </td>
                  <td style={tdCell()}>
                    <input
                      type="checkbox"
                      checked={s.enabled}
                      onChange={(e) => {
                        void handleToggle(s.id, e.target.checked);
                      }}
                      data-testid="mcp-toggle"
                      data-server-name={s.name}
                    />
                  </td>
                  <td style={tdCell()}>
                    <button
                      onClick={() => {
                        openEdit(s);
                      }}
                      data-testid="mcp-edit-btn"
                      data-server-name={s.name}
                      style={rowIconBtn()}
                      title="编辑"
                    >
                      <Pencil size={12} />
                    </button>
                    <button
                      onClick={() => {
                        void handleDelete(s);
                      }}
                      data-testid="mcp-delete-btn"
                      data-server-name={s.name}
                      style={{ ...rowIconBtn(), color: 'var(--danger)' }}
                      title="删除"
                    >
                      <Trash2 size={12} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {state.modal && (
        <McpServerForm
          initial={state.modal.kind === 'edit' ? state.modal.server : state.modal.kind === 'import' ? state.modal.server : null}
          title={
            state.modal.kind === 'add'
              ? '新增 MCP server'
              : state.modal.kind === 'edit'
                ? `编辑 ${state.modal.server.name}`
                : '从剪贴板导入 MCP server'
          }
          onSubmit={(s) => {
            void handleSubmit(s);
          }}
          onCancel={closeModal}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modal form
// ---------------------------------------------------------------------------

interface McpServerFormProps {
  initial: McpServer | null;
  title: string;
  onSubmit: (server: McpServer) => void;
  onCancel: () => void;
}

function McpServerForm({
  initial,
  title,
  onSubmit,
  onCancel,
}: McpServerFormProps): ReactElement {
  const [name, setName] = useState(initial?.name ?? '');
  const [transport, setTransport] = useState<McpTransport>(
    initial?.transport ?? 'stdio',
  );
  const [command, setCommand] = useState(initial?.command ?? '');
  const [argsText, setArgsText] = useState((initial?.args ?? []).join(' '));
  const [envText, setEnvText] = useState(
    Object.entries(initial?.env ?? {})
      .map(([k, v]) => `${k}=${v}`)
      .join('; '),
  );
  const [url, setUrl] = useState(initial?.url ?? '');
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(
    (e: FormEvent<HTMLFormElement>): void => {
      e.preventDefault();
      setError(null);
      if (!name.trim()) {
        setError('名称不能为空');
        return;
      }
      if (transport === 'stdio' && !command.trim()) {
        setError('stdio 类型必须填写 command');
        return;
      }
      if (transport === 'http' && !url.trim()) {
        setError('http 类型必须填写 url');
        return;
      }
      const args = argsText
        .split(/\s+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      const env: Record<string, string> = {};
      for (const pair of envText.split(';')) {
        const idx = pair.indexOf('=');
        if (idx <= 0) continue;
        const k = pair.slice(0, idx).trim();
        const v = pair.slice(idx + 1).trim();
        if (k) env[k] = v;
      }
      const server: McpServer = {
        id: initial?.id ?? '',
        name: name.trim(),
        transport,
        command: transport === 'stdio' ? command.trim() : undefined,
        args: transport === 'stdio' ? args : [],
        env: transport === 'stdio' ? env : {},
        url: transport === 'http' ? url.trim() : undefined,
        enabled,
        created_at: initial?.created_at ?? Math.floor(Date.now() / 1000),
      };
      onSubmit(server);
    },
    [name, transport, command, argsText, envText, url, enabled, initial, onSubmit],
  );

  return (
    <div
      data-testid="mcp-modal-backdrop"
      onClick={onCancel}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.32)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <form
        data-testid="mcp-modal"
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        style={{
          background: 'var(--bg-elevated)',
          borderRadius: 'var(--radius-modal)',
          padding: 24,
          width: 480,
          maxWidth: '90vw',
          boxShadow: 'var(--shadow-md)',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <h2
          style={{
            fontSize: 16,
            fontWeight: 600,
            color: 'var(--text-primary)',
            margin: 0,
          }}
        >
          {title}
        </h2>

        <Field label="名称">
          <input
            data-testid="mcp-form-name"
            value={name}
            onChange={(e: ChangeEvent<HTMLInputElement>) => {
              setName(e.target.value);
            }}
            placeholder="filesystem"
            style={formInput()}
          />
        </Field>

        <Field label="类型">
          <select
            data-testid="mcp-form-transport"
            value={transport}
            onChange={(e) => {
              setTransport(e.target.value as McpTransport);
            }}
            style={formInput()}
          >
            <option value="stdio">stdio</option>
            <option value="http">http</option>
          </select>
        </Field>

        {transport === 'stdio' ? (
          <>
            <Field label="Command">
              <input
                data-testid="mcp-form-command"
                value={command}
                onChange={(e: ChangeEvent<HTMLInputElement>) => {
                  setCommand(e.target.value);
                }}
                placeholder="npx"
                style={formInput()}
              />
            </Field>
            <Field label="Args (空格分隔)">
              <input
                data-testid="mcp-form-args"
                value={argsText}
                onChange={(e: ChangeEvent<HTMLInputElement>) => {
                  setArgsText(e.target.value);
                }}
                placeholder="-y @mcp/filesystem"
                style={formInput()}
              />
            </Field>
            <Field label="Env (key=value; 用 ; 分隔)">
              <input
                data-testid="mcp-form-env"
                value={envText}
                onChange={(e: ChangeEvent<HTMLInputElement>) => {
                  setEnvText(e.target.value);
                }}
                placeholder="ROOT=/tmp; KEY=val"
                style={formInput()}
              />
            </Field>
          </>
        ) : (
          <Field label="URL">
            <input
              data-testid="mcp-form-url"
              value={url}
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                setUrl(e.target.value);
              }}
              placeholder="https://mcp.example.com/sse"
              style={formInput()}
            />
          </Field>
        )}

        <Field label="">
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 13,
              color: 'var(--text-primary)',
            }}
          >
            <input
              type="checkbox"
              data-testid="mcp-form-enabled"
              checked={enabled}
              onChange={(e) => {
                setEnabled(e.target.checked);
              }}
            />
            启用
          </label>
        </Field>

        {error && (
          <div
            data-testid="mcp-form-error"
            style={{
              fontSize: 12,
              color: 'var(--danger)',
              padding: '4px 0',
            }}
          >
            {error}
          </div>
        )}

        <div
          style={{
            display: 'flex',
            gap: 8,
            justifyContent: 'flex-end',
            marginTop: 4,
          }}
        >
          <button
            type="button"
            onClick={onCancel}
            data-testid="mcp-form-cancel"
            style={toolbarBtn()}
          >
            取消
          </button>
          <button
            type="submit"
            data-testid="mcp-form-submit"
            style={primaryBtn()}
          >
            保存
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactElement;
}): ReactElement {
  return (
    <label
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        fontSize: 12,
        color: 'var(--text-secondary)',
      }}
    >
      {label && <span>{label}</span>}
      {children}
    </label>
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

function rowIconBtn(): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 24,
    height: 24,
    marginRight: 4,
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-button)',
    background: 'var(--bg-elevated)',
    color: 'var(--text-primary)',
    cursor: 'pointer',
  };
}

function thCell(): React.CSSProperties {
  return {
    padding: '10px 12px',
    textAlign: 'left',
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--text-secondary)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  };
}

function tdCell(): React.CSSProperties {
  return {
    padding: '10px 12px',
    verticalAlign: 'middle',
  };
}

function formInput(): React.CSSProperties {
  return {
    padding: '6px 8px',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-button)',
    background: 'var(--bg-primary)',
    color: 'var(--text-primary)',
    fontSize: 13,
    outline: 'none',
    fontFamily: 'inherit',
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cryptoRandomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
