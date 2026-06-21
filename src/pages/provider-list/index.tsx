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
import { listProviders, switchProvider, exportProvider } from '../../lib/api/providers';
import type { Provider } from '../../types/provider';
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

export function ProviderListPage(): ReactElement {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [switchState, setSwitchState] = useState<SwitchState>({ kind: 'idle' });
  const [exportState, setExportState] = useState<ExportState>({ kind: 'idle' });

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
      <HeaderBar onRefresh={reload} />
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
}

function HeaderBar({ onRefresh }: HeaderBarProps): ReactElement {
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
      <div style={{ fontSize: '48px', marginBottom: 'var(--space-3)' }}>📭</div>
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
        <code style={{ fontFamily: 'monospace', background: 'var(--bg-elevated)', padding: '2px 4px', borderRadius: 4 }}>
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
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-3)',
        padding: 'var(--space-3) var(--space-4)',
        marginBottom: 'var(--space-2)',
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border)',
        borderLeft: isActive ? '2px solid var(--accent)' : '2px solid transparent',
        borderRadius: 'var(--radius-card)',
        boxShadow: 'var(--shadow-sm)',
      }}
    >
      <div style={{ flex: '1 1 auto', minWidth: 0 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
            marginBottom: 4,
          }}
        >
          <span
            style={{
              fontSize: 'var(--fs-body)',
              fontWeight: 600,
              color: 'var(--text-primary)',
            }}
          >
            {provider.name}
          </span>
          <code
            style={{
              fontFamily: 'monospace',
              fontSize: 'var(--fs-caption)',
              color: 'var(--text-muted)',
              background: 'var(--bg-overlay)',
              padding: '1px 6px',
              borderRadius: 'var(--radius-button)',
            }}
          >
            {provider.provider_type}
          </code>
          {provider.models.length > 0 && (
            <span
              style={{
                fontSize: 'var(--fs-caption)',
                color: 'var(--text-secondary)',
              }}
            >
              · {provider.models.length} 个模型
            </span>
          )}
        </div>
        <div
          style={{
            fontFamily: 'monospace',
            fontSize: 'var(--fs-caption)',
            color: 'var(--text-secondary)',
            wordBreak: 'break-all',
          }}
        >
          {provider.api_base}
        </div>
        <div
          style={{
            fontSize: 'var(--fs-caption)',
            color: 'var(--text-muted)',
            marginTop: 2,
          }}
        >
          {lastUsedLabel(provider)}
        </div>
      </div>
      {/* 右侧操作区:导出按钮 + 激活按钮/徽章。
          导出按钮对 active / inactive 行都可用(F14 是分享配置,不要求激活)。
          exporting 时禁用 + 显示"导出中…"。 */}
      <div
        style={{
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
        }}
      >
        <button
          type="button"
          data-testid={`provider-export-${provider.id}`}
          disabled={exporting}
          onClick={() => onExport(provider)}
          title="导出为 .json 分享"
          style={{
            ...btnStyle,
            opacity: exporting ? 0.6 : 1,
            cursor: exporting ? 'not-allowed' : 'pointer',
          }}
        >
          {exporting ? '导出中…' : '导出'}
        </button>
        {isActive ? (
          <span
            data-testid={`provider-active-badge-${provider.id}`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '4px 10px',
              background: 'var(--accent)',
              color: '#fff',
              fontSize: 'var(--fs-caption)',
              borderRadius: 'var(--radius-button)',
              fontWeight: 600,
            }}
          >
            ● 已激活
          </span>
        ) : (
          <button
            type="button"
            data-testid={`provider-activate-${provider.id}`}
            disabled={switching}
            onClick={() => onActivate(provider.id)}
            style={{
              ...btnStyle,
              background: switching ? 'var(--bg-overlay)' : 'var(--accent)',
              color: switching ? 'var(--text-muted)' : '#fff',
              border: 'none',
              fontWeight: 600,
              minWidth: 80,
            }}
          >
            {switching ? '切换中…' : '激活'}
          </button>
        )}
      </div>
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