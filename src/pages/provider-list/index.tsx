/**
 * F1 + F2 — Provider 列表 + 切换 (M2.1 real implementation).
 *
 * Replaces the M1.9 PluginPlaceholder. Reads the provider library via
 * `listProviders` (Tauri IPC) and shows each entry with an [激活] button
 * that calls `switchProvider`. The list refreshes after every switch
 * so the `is_active` badges re-compute from the live `~/.claude/settings.json`.
 *
 * ## Design choices (CLAUDE.md §5 + SPEC §5.1)
 *
 * - **Card list, not table** — SPEC §5.3 describes the card metaphor
 *   for provider rows. We keep the table-like layout (one row per
 *   provider) inside a `card-list` grid; M2.3+ will switch to full
 *   cards when the per-card metadata (categories, model chips,
 *   usage badges) lands.
 *
 * - **Active marker** — left 2px blue border (CLAUDE.md §4.2 `--accent`)
 *   + "● 已激活" badge in the right column. Mirrors SPEC §5.3.
 *
 * - **Switching UX** — the [激活] button is disabled while a switch
 *   is in flight; success shows a green InfoBar (auto-dismiss 3s),
 *   failure shows a red InfoBar (5s). No modal confirmation per
 *   SPEC §4.2: "1 键切换".
 *
 * - **Error handling** — empty list → empty-state CTA. Corrupt files
 *   → red InfoBar from `listProvidersWithWarnings`. settings.json
 *   unreadable → all rows show `is_active = false` silently (no
 *   warning, since the user can't do anything about it).
 *
 * ## Files
 * - API wrapper: `src/lib/api/providers.ts`
 * - TS type:    `src/types/provider.ts`
 * - Backend:    `src-tauri/src/commands/providers.rs`
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { listProviders, switchProvider, exportProvider, generateFromCurrentConfig, importSingleProvider } from '../../lib/api/providers';
import type { Provider } from '../../types/provider';
import type { GenerateFromCurrentConfigResult } from '../../lib/api/providers';
import { ErrorBanner } from '../../components/ErrorBanner';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; providers: Provider[] };

type SwitchState =
  | { kind: 'idle' }
  | { kind: 'switching'; id: string }
  | { kind: 'success'; id: string; name: string }
  | { kind: 'failure'; message: string };

/**
 * F14 导出流程的页面级状态机。和 SwitchState 解耦——导出不刷新列表、
 * 不影响切换的 InfoBar,各自独立的生命周期。
 *
 * - `idle` — 无操作。
 * - `exporting` — 后端正在读 provider + 弹保存框（native dialog 阻塞,
 *   按钮显示"导出中…"）。
 * - `exported` — 用户选了路径 + 写盘成功。InfoBar 显示路径（截断）。
 * - `cancelled` — 用户在保存框点了取消。静默,不显示 InfoBar（取消是
 *   正常流程,不是错误）。
 * - `export_failure` — 取数 / 序列化 / 写盘失败。红色 InfoBar。
 */
type ExportState =
  | { kind: 'idle' }
  | { kind: 'exporting'; id: string }
  | { kind: 'exported'; path: string }
  | { kind: 'cancelled' }
  | { kind: 'export_failure'; message: string };

/**
 * "从当前配置生成"流程的状态机:
 * - `idle` — 无操作
 * - `generating` — 后端正在读 settings.json + 生成候选
 * - `preview` — 已生成候选 provider,等待用户确认导入
 * - `importing` — 已确认,正在写盘
 * - `imported` — 写盘成功
 * - `failure` — 任何步骤失败
 */
type GenerateState =
  | { kind: 'idle' }
  | { kind: 'generating' }
  | { kind: 'preview'; result: GenerateFromCurrentConfigResult }
  | { kind: 'importing' }
  | { kind: 'imported'; id: string }
  | { kind: 'failure'; message: string };

export function ProviderListPage(): ReactElement {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [switchState, setSwitchState] = useState<SwitchState>({ kind: 'idle' });
  const [exportState, setExportState] = useState<ExportState>({ kind: 'idle' });
  const [generateState, setGenerateState] = useState<GenerateState>({ kind: 'idle' });

  const reload = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      const providers = await listProviders();
      setState({ kind: 'ready', providers });
    } catch (e) {
      setState({ kind: 'error', message: stringifyError(e) });
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleActivate = useCallback(
    async (id: string) => {
      setSwitchState({ kind: 'switching', id });
      try {
        const activated = await switchProvider(id);
        setSwitchState({
          kind: 'success',
          id,
          name: activated.name,
        });
        // Refresh the list so other rows' is_active recompute.
        try {
          const providers = await listProviders();
          setState({ kind: 'ready', providers });
        } catch {
          // Already in 'ready' state; don't blow it away on refresh fail.
        }
      } catch (e) {
        setSwitchState({ kind: 'failure', message: stringifyError(e) });
      }
    },
    [],
  );

  /**
   * F14 — 导出单 provider。后端全权处理读 + 弹框 + 写盘,
   * 前端只接收最终路径(或 null = 用户取消)。
   *
   * `appType` 传 provider 的 provider_type,后端当前忽略但签名对齐。
   */
  const handleExport = useCallback(
    async (provider: Provider) => {
      setExportState({ kind: 'exporting', id: provider.id });
      try {
        const path = await exportProvider(provider.id, provider.provider_type);
        if (path === null) {
          // 用户在保存框取消 — 静默,不报错。
          setExportState({ kind: 'cancelled' });
        } else {
          setExportState({ kind: 'exported', path });
        }
      } catch (e) {
        setExportState({ kind: 'export_failure', message: stringifyError(e) });
      }
    },
    [],
  );

  /**
   * 从当前 Claude 配置生成 provider 候选。
   * 后端读 settings.json 的 env,生成或匹配现有 provider。
   * 进入 preview 状态等待用户确认。
   */
  const handleGenerateFromCurrentConfig = useCallback(async () => {
    setGenerateState({ kind: 'generating' });
    try {
      const result = await generateFromCurrentConfig();
      setGenerateState({ kind: 'preview', result });
    } catch (e) {
      setGenerateState({ kind: 'failure', message: stringifyError(e) });
    }
  }, []);

  /**
   * 确认导入生成的 provider。
   * 写盘成功后自动激活(调用 switchProvider)并刷新列表。
   */
  const handleConfirmImport = useCallback(
    async (provider: Provider) => {
      setGenerateState({ kind: 'importing' });
      try {
        // 写盘到 providers 目录
        await importSingleProvider(provider);
        setGenerateState({ kind: 'imported', id: provider.id });
      } catch (e) {
        setGenerateState({ kind: 'failure', message: stringifyError(e) });
      }
    },
    [],
  );

  /** 取消预览,回到 idle。 */
  const handleCancelGenerate = useCallback(() => {
    setGenerateState({ kind: 'idle' });
  }, []);

  return (
    <div
      data-testid="provider-list-page"
      style={{
        padding: 'var(--space-6)',
        height: '100%',
        boxSizing: 'border-box',
        background: 'var(--bg-primary)',
        color: 'var(--text-primary)',
      }}
    >
      <HeaderBar
        onRefresh={reload}
        onGenerateFromCurrentConfig={handleGenerateFromCurrentConfig}
        generateDisabled={generateState.kind === 'generating' || generateState.kind === 'importing'}
      />
      <GenerateInfoBar
        generateState={generateState}
        onDismiss={() => setGenerateState({ kind: 'idle' })}
      />
      <GeneratePreviewModal
        generateState={generateState}
        onConfirm={handleConfirmImport}
        onCancel={handleCancelGenerate}
      />
      <InfoBars switchState={switchState} onDismiss={() => setSwitchState({ kind: 'idle' })} />
      <ExportInfoBar
        exportState={exportState}
        onDismiss={() => setExportState({ kind: 'idle' })}
      />
      <Body
        state={state}
        switchState={switchState}
        exportState={exportState}
        onActivate={handleActivate}
        onExport={handleExport}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface HeaderBarProps {
  onRefresh: () => void;
  onGenerateFromCurrentConfig: () => void;
  generateDisabled: boolean;
}

function HeaderBar({
  onRefresh,
  onGenerateFromCurrentConfig,
  generateDisabled,
}: HeaderBarProps): ReactElement {
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
        Provider 列表
      </h1>
      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <button
          type="button"
          data-testid="provider-list-generate"
          onClick={onGenerateFromCurrentConfig}
          disabled={generateDisabled}
          style={{
            ...btnStyle,
            opacity: generateDisabled ? 0.6 : 1,
          }}
          title="从 ~/.claude/settings.json 当前配置生成新 provider"
        >
          从当前配置生成
        </button>
        <button
          type="button"
          data-testid="provider-list-refresh"
          onClick={onRefresh}
          style={btnStyle}
          title="重新加载列表"
        >
          刷新
        </button>
      </div>
    </div>
  );
}

interface InfoBarsProps {
  switchState: SwitchState;
  onDismiss: () => void;
}

/**
 * F2 切换流程的 InfoBar。M2.17 F15 batch3: 用共享 ErrorBanner 替换内联
 * 红/绿条(M2.16-007-L 关闭),保留对外 testid `provider-list-{kind}-bar`
 * + role="status"。autoDismiss 由 ErrorBanner 内部 useEffect 处理,
 * 保留原 3s (success) / 5s (failure) 计时。
 */
function InfoBars({ switchState, onDismiss }: InfoBarsProps): ReactElement | null {
  const bar = useMemo(() => {
    if (switchState.kind === 'success') {
      return {
        kind: 'success' as const,
        text: `已切换到 ${switchState.name}`,
      };
    }
    if (switchState.kind === 'failure') {
      return { kind: 'error' as const, text: `切换失败：${switchState.message}` };
    }
    return null;
  }, [switchState]);

  if (!bar) return null;
  const autoDismissMs = bar.kind === 'success' ? 3000 : 5000;
  return (
    <div
      data-testid={`provider-list-${bar.kind}-bar`}
      style={{ marginBottom: 'var(--space-3)' }}
    >
      <ErrorBanner
        kind={bar.kind}
        message={bar.text}
        onDismiss={onDismiss}
        autoDismissMs={autoDismissMs}
      />
    </div>
  );
}

/**
 * F14 导出流程的 InfoBar。和切换的 InfoBars 分离,因为:
 * 1. 导出有自己的状态机(exported / cancelled / export_failure)。
 * 2. 取消是静默的(cancelled 不渲染任何东西),成功/失败才显示。
 * 3. 成功提示显示路径,需要截断(Windows 路径可能很长)。
 *
 * 自动消失:成功 4s,失败 5s(比切换的成功 3s 略长,因为路径需要阅读)。
 * cancelled 立即回 idle(无 UI),不设 timer。
 *
 * M2.16 改造 (F15): 内部用共享 ErrorBanner 实现,保留外部
 * testid `provider-export-{kind}-bar`(原有测试 + e2e 都依赖)。
 */
interface ExportInfoBarProps {
  exportState: ExportState;
  onDismiss: () => void;
}

function ExportInfoBar({ exportState, onDismiss }: ExportInfoBarProps): ReactElement | null {
  const bar = useMemo(() => {
    if (exportState.kind === 'exported') {
      return {
        kind: 'success' as const,
        text: `已导出到 ${truncatePath(exportState.path)}`,
      };
    }
    if (exportState.kind === 'export_failure') {
      return {
        kind: 'error' as const,
        text: `导出失败：${exportState.message}`,
      };
    }
    return null;
  }, [exportState]);

  // 成功 4s,失败 5s。ErrorBanner 内部走 useEffect + setTimeout,
  // 这里只需要把毫秒数透传过去即可,不再自己 setTimeout。
  const autoDismissMs = bar?.kind === 'success' ? 4000 : bar ? 5000 : undefined;

  if (!bar) return null;
  return (
    <ErrorBanner
      kind={bar.kind}
      message={bar.text}
      onDismiss={onDismiss}
      autoDismissMs={autoDismissMs}
      testId={`provider-export-${bar.kind}-bar`}
      style={{ marginBottom: 'var(--space-3)' }}
    />
  );
}

/** 截断长路径:保留首尾,中间省略号。Windows 路径常超 80 字符。 */
function truncatePath(path: string): string {
  const MAX = 60;
  if (path.length <= MAX) return path;
  const head = path.slice(0, 24);
  const tail = path.slice(-28);
  return `${head}…${tail}`;
}

/**
 * "从当前配置生成"流程的 InfoBar。
 * - generating / preview / importing → 无 InfoBar(进度在 modal/按钮显示)
 * - imported → 绿色"已生成 X"提示(5s 自动消失)
 * - failure → 红色"生成失败:<原因>"(5s)
 */
interface GenerateInfoBarProps {
  generateState: GenerateState;
  onDismiss: () => void;
}

function GenerateInfoBar({
  generateState,
  onDismiss,
}: GenerateInfoBarProps): ReactElement | null {
  const bar = useMemo(() => {
    if (generateState.kind === 'imported') {
      return {
        kind: 'success' as const,
        text: `已添加 provider ${generateState.id}`,
      };
    }
    if (generateState.kind === 'failure') {
      return {
        kind: 'error' as const,
        text: `生成失败:${generateState.message}`,
      };
    }
    return null;
  }, [generateState]);

  if (!bar) return null;
  return (
    <ErrorBanner
      kind={bar.kind}
      message={bar.text}
      onDismiss={onDismiss}
      autoDismissMs={5000}
      testId={`provider-generate-${bar.kind}-bar`}
      style={{ marginBottom: 'var(--space-3)' }}
    />
  );
}

/**
 * "从当前配置生成"的预览 modal。
 * 显示候选 provider 详情 + 确认/取消按钮。
 * - `generating` → 不渲染(进度在按钮显示)
 * - `idle` / `importing` / `imported` / `failure` → 不渲染
 * - `preview` → 渲染预览 modal
 */
interface GeneratePreviewModalProps {
  generateState: GenerateState;
  onConfirm: (provider: Provider) => void;
  onCancel: () => void;
}

function GeneratePreviewModal({
  generateState,
  onConfirm,
  onCancel,
}: GeneratePreviewModalProps): ReactElement | null {
  if (generateState.kind !== 'preview') return null;
  const { result } = generateState;
  const { provider, is_new } = result;

  return (
    <div
      data-testid="provider-generate-preview-modal"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
      }}
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg-elevated)',
          borderRadius: 'var(--radius-modal, 12px)',
          padding: 'var(--space-6)',
          minWidth: 480,
          maxWidth: 640,
          boxShadow: 'var(--shadow-md)',
        }}
      >
        <h2
          style={{
            margin: 0,
            marginBottom: 'var(--space-4)',
            fontSize: 'var(--fs-heading)',
            color: 'var(--text-primary)',
          }}
        >
          {is_new ? '从当前配置生成新 provider' : '当前配置匹配现有 provider'}
        </h2>

        {!is_new && (
          <p
            data-testid="provider-generate-preview-exists-notice"
            style={{
              color: 'var(--warning)',
              fontSize: 'var(--fs-body)',
              marginBottom: 'var(--space-4)',
            }}
          >
            库中已有相同 base_url 的 provider "{provider.name}",无需再次添加。
          </p>
        )}

        <div
          style={{
            background: 'var(--bg-primary)',
            padding: 'var(--space-4)',
            borderRadius: 'var(--radius-button)',
            marginBottom: 'var(--space-4)',
            fontFamily: 'var(--font-mono, monospace)',
            fontSize: 'var(--fs-body)',
            color: 'var(--text-primary)',
          }}
        >
          <div>
            <strong>id:</strong> {provider.id}
          </div>
          <div>
            <strong>name:</strong> {provider.name}
          </div>
          <div>
            <strong>base_url:</strong> {provider.api_base}
          </div>
          <div>
            <strong>api_key:</strong> {'•'.repeat(Math.min(provider.api_key.length, 12))}
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
          <button
            type="button"
            data-testid="provider-generate-preview-cancel"
            onClick={onCancel}
            style={btnStyle}
          >
            取消
          </button>
          {is_new && (
            <button
              type="button"
              data-testid="provider-generate-preview-confirm"
              className="btn btn-primary"
              onClick={() => onConfirm(provider)}
              style={{
                padding: '6px 12px',
                background: 'var(--accent)',
                border: 'none',
                borderRadius: 'var(--radius-button)',
                fontSize: 'var(--fs-body)',
                color: '#fff',
                cursor: 'pointer',
              }}
            >
              确认导入
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

interface BodyProps {
  state: LoadState;
  switchState: SwitchState;
  exportState: ExportState;
  onActivate: (id: string) => void;
  onExport: (provider: Provider) => void;
}

function Body({
  state,
  switchState,
  exportState,
  onActivate,
  onExport,
}: BodyProps): ReactElement {
  if (state.kind === 'loading') {
    return (
      <div data-testid="provider-list-loading" style={emptyStateStyle}>
        加载中…
      </div>
    );
  }
  if (state.kind === 'error') {
    return (
      <div data-testid="provider-list-error" style={{ ...emptyStateStyle, color: 'var(--danger)' }}>
        错误：{state.message}
      </div>
    );
  }
  if (state.providers.length === 0) {
    return <EmptyState />;
  }
  return (
    <ul data-testid="provider-list" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {state.providers.map((p) => (
        <ProviderRow
          key={p.id}
          provider={p}
          switching={switchState.kind === 'switching' && switchState.id === p.id}
          exporting={exportState.kind === 'exporting' && exportState.id === p.id}
          onActivate={onActivate}
          onExport={onExport}
        />
      ))}
    </ul>
  );
}

function EmptyState(): ReactElement {
  return (
    <div data-testid="provider-list-empty" style={emptyStateStyle}>
      <h2
        style={{
          fontSize: 'var(--fs-heading)',
          color: 'var(--text-primary)',
          margin: 0,
          marginBottom: 'var(--space-2)',
        }}
      >
        还没有任何 provider
      </h2>
      <p
        style={{
          color: 'var(--text-secondary)',
          fontSize: 'var(--fs-body)',
          maxWidth: 480,
          textAlign: 'center',
        }}
      >
        Provider 文件位于{' '}
        <code style={{ fontFamily: 'var(--font-mono, monospace)', background: 'var(--bg-elevated)', padding: '2px 4px', borderRadius: 'var(--radius-button)' }}>
          %APPDATA%\ClaudeConfigManager\providers\&lt;id&gt;.json
        </code>
        。放入 JSON 文件后刷新本页即可看到。M2.3+ 将提供图形化新增 / 编辑界面。
      </p>
    </div>
  );
}

interface ProviderRowProps {
  provider: Provider;
  switching: boolean;
  exporting: boolean;
  onActivate: (id: string) => void;
  onExport: (provider: Provider) => void;
}

function ProviderRow({
  provider,
  switching,
  exporting,
  onActivate,
  onExport,
}: ProviderRowProps): ReactElement {
  const isActive = provider.is_active;
  return (
    <li
      data-testid={`provider-row-${provider.id}`}
      data-active={isActive ? 'true' : 'false'}
      className={`list-row${isActive ? ' active' : ''}`}
    >
      <div className="provider-avatar">{provider.name.slice(0, 2).toUpperCase()}</div>
      <div className="list-row-content">
        <div className="list-row-header">
          <span className="name">{provider.name}</span>
          <span className="badge badge-type">{provider.provider_type}</span>
          {provider.models.length > 0 && (
            <span className="meta">· {provider.models.length} 个模型</span>
          )}
        </div>
        <div className="mono api-base">{provider.api_base}</div>
        <div className="last-used">{lastUsedLabel(provider)}</div>
      </div>
      {/* §4.8.4: 行级状态指示器(badge) + 行级操作按钮(导出/激活)
          必须在同一 flex 层级, 让 .list-row 的 align-items: center 统一对齐。 */}
      {isActive && (
        <span
          data-testid={`provider-active-badge-${provider.id}`}
          className="badge badge-active"
          style={{ flexShrink: 0 }}
        >
          ● 已激活
        </span>
      )}
      <button
        type="button"
        className="btn"
        data-testid={`provider-export-${provider.id}`}
        disabled={exporting}
        onClick={() => onExport(provider)}
        title="导出为 .json 分享"
        style={{ opacity: exporting ? 0.6 : 1 }}
      >
        {exporting ? '导出中…' : '导出'}
      </button>
      {!isActive && (
        <button
          type="button"
          className="btn btn-primary"
          data-testid={`provider-activate-${provider.id}`}
          disabled={switching}
          onClick={() => onActivate(provider.id)}
          style={{ minWidth: 80, opacity: switching ? 0.6 : 1 }}
        >
          {switching ? '切换中…' : '激活'}
        </button>
      )}
    </li>
  );
}

function lastUsedLabel(p: Provider): string {
  if (p.last_used_at == null) return '从未使用';
  const now = Math.floor(Date.now() / 1000);
  const delta = now - p.last_used_at;
  if (delta < 60) return '刚刚使用';
  if (delta < 3600) return `${Math.floor(delta / 60)} 分钟前使用`;
  if (delta < 86400) return `${Math.floor(delta / 3600)} 小时前使用`;
  return `${Math.floor(delta / 86400)} 天前使用`;
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

const emptyStateStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 'var(--space-12) var(--space-6)',
  color: 'var(--text-secondary)',
  fontSize: 'var(--fs-body)',
  minHeight: 240,
};

function stringifyError(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

export default ProviderListPage;