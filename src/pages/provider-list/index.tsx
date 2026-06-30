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
import {
  listProviders, switchProvider, exportProvider, generateFromCurrentConfig, importSingleProvider,
  getProviderDetails, addProvider, updateProvider, deleteProvider,
} from '../../lib/api/providers';
import type { ProviderInput } from '../../types/provider';
import type { Provider } from '../../types/provider';
import type { GenerateFromCurrentConfigResult } from '../../lib/api/providers';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { ErrorBanner } from '../../components/ErrorBanner';
import { Pagination } from '../../components/Pagination';

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

/**
 * M3.6 (清单 22) — ProviderFormModal 状态机 (add / edit 共用).
 * - `idle` — 无表单打开
 * - `add` — 用户点 [+ Add], 空白表单
 * - `edit` — 用户点 [Edit] (带 prefilled provider), 现有 provider
 * - `submitting` — 用户点 [Save], 后端写盘中
 * - `failure` — 后端返回错 (id 重名 / 字段非空校验失败)
 */
type FormState =
  | { kind: 'idle' }
  | { kind: 'add' }
  | { kind: 'edit'; provider: Provider }
  | { kind: 'submitting' }
  | { kind: 'failure'; message: string };

/**
 * M3.6 — Details modal 状态机.
 * - `idle` — 无
 * - `loading` — 用户点 [View], 后端查 details 中
 * - `loaded` — 后端返回完整 provider
 * - `failure` — NotFound / 其他错
 */
type DetailsState =
  | { kind: 'idle' }
  | { kind: 'loading'; id: string }
  | { kind: 'loaded'; provider: Provider }
  | { kind: 'failure'; id: string; message: string };

/**
 * M3.6 — Delete 确认状态机.
 * - `idle` — 无
 * - `confirming` — 用户点 [Delete], 弹确认
 * - `deleting` — 用户点 [Yes], 后端删中
 * - `failure` — CannotDeleteActive / 其他错
 */
type DeleteState =
  | { kind: 'idle' }
  | { kind: 'confirming'; provider: Provider }
  | { kind: 'deleting'; id: string }
  | { kind: 'failure'; id: string; message: string };

export function ProviderListPage(): ReactElement {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [switchState, setSwitchState] = useState<SwitchState>({ kind: 'idle' });
  const [exportState, setExportState] = useState<ExportState>({ kind: 'idle' });
  const [generateState, setGenerateState] = useState<GenerateState>({ kind: 'idle' });
  const [formState, setFormState] = useState<FormState>({ kind: 'idle' });
  const [detailsState, setDetailsState] = useState<DetailsState>({ kind: 'idle' });
  const [deleteState, setDeleteState] = useState<DeleteState>({ kind: 'idle' });

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
   *
   * X1 真因修复 (CLAUDE.md §16): 后端在异常边界可能返回
   * `{provider: null, is_new: false}` (例如 settings.json 缺 env 字段
   * 或 IO 错误被吃掉)。原代码 setGenerateState({kind:'preview', result})
   * → GeneratePreviewModal 解构 provider.name 渲染期崩,后 b16b979
   * 加 null guard 静默 return null → 用户体验 = "按钮无反应"。
   *
   * 修复:调用层提前拦截 null,把状态机切到 failure 并显示明确错误
   * (用户能看懂的诊断),不依赖 modal 内部 guard。
   */
  const handleGenerateFromCurrentConfig = useCallback(async () => {
    setGenerateState({ kind: 'generating' });
    try {
      const result = await generateFromCurrentConfig();
      if (!result || !result.provider) {
        setGenerateState({
          kind: 'failure',
          message: '当前 Claude 配置不完整,无法生成 provider。请检查 ~/.claude/settings.json 的 env 字段(ANTHROPIC_BASE_URL + ANTHROPIC_API_KEY 或 ANTHROPIC_AUTH_TOKEN)。',
        });
        return;
      }
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
        // 立刻刷新列表 (修复 b6aa402 漏调 reload 导致的列表不刷新)
        await reload();
        // 自动激活新 provider (保持原设计意图)
        try {
          await switchProvider(provider.id);
        } catch (switchErr) {
          // 激活失败不阻塞导入成功, 记录即可
          console.warn('auto-switch failed after import:', switchErr);
        }
        // 再刷一次拿最新 is_active / last_used_at
        await reload();
        setGenerateState({ kind: 'imported', id: provider.id });
      } catch (e) {
        setGenerateState({ kind: 'failure', message: stringifyError(e) });
      }
    },
    [reload],
  );

  /** 取消预览,回到 idle。 */
  const handleCancelGenerate = useCallback(() => {
    setGenerateState({ kind: 'idle' });
  }, []);

  // -----------------------------------------------------------------------
  // M3.6 (清单 22) — CRUD handlers: View details / Add / Edit / Delete.
  // -----------------------------------------------------------------------

  /** [View] 按钮 → 打开 details modal, 后端查完整 provider (含 api_key). */
  const handleOpenDetails = useCallback(async (id: string) => {
    setDetailsState({ kind: 'loading', id });
    try {
      const provider = await getProviderDetails(id);
      setDetailsState({ kind: 'loaded', provider });
    } catch (e) {
      setDetailsState({ kind: 'failure', id, message: stringifyError(e) });
    }
  }, []);

  /** 关闭 details modal. */
  const handleCloseDetails = useCallback(() => {
    setDetailsState({ kind: 'idle' });
  }, []);

  /** [+ Add] 按钮 → 打开空白 form. */
  const handleOpenAdd = useCallback(() => {
    setFormState({ kind: 'add' });
  }, []);

  /** 行内 [Edit] 按钮 → 打开 form prefilled with current values. */
  const handleOpenEdit = useCallback((provider: Provider) => {
    setFormState({ kind: 'edit', provider });
  }, []);

  /** 关闭 form modal (cancel). */
  const handleCloseForm = useCallback(() => {
    setFormState({ kind: 'idle' });
  }, []);

  /** Form [Save] → 调 addProvider 或 updateProvider. */
  const handleSubmitForm = useCallback(
    async (input: ProviderInput, existingId: string | null) => {
      setFormState({ kind: 'submitting' });
      try {
        if (existingId === null) {
          // Add path: id is in input (M3.6 允许 add 时也传 id, service 验证)
          // Actually ProviderInput doesn't have id, so we use add_provider with id derived from name
          // The Rust add_provider takes ProviderInput which has no id;
          // it generates id from name. We don't need to pass id.
          await addProvider(input);
        } else {
          await updateProvider(existingId, input);
        }
        await reload();
        setFormState({ kind: 'idle' });
      } catch (e) {
        setFormState({ kind: 'failure', message: stringifyError(e) });
      }
    },
    [reload],
  );

  /** 行内 [Delete] → 弹确认. */
  const handleOpenDelete = useCallback((provider: Provider) => {
    setDeleteState({ kind: 'confirming', provider });
  }, []);

  /** 取消 delete. */
  const handleCancelDelete = useCallback(() => {
    setDeleteState({ kind: 'idle' });
  }, []);

  /** 确认 delete → 调 deleteProvider. */
  const handleConfirmDelete = useCallback(async () => {
    if (deleteState.kind !== 'confirming') return;
    const id = deleteState.provider.id;
    setDeleteState({ kind: 'deleting', id });
    try {
      await deleteProvider(id);
      await reload();
      setDeleteState({ kind: 'idle' });
    } catch (e) {
      setDeleteState({ kind: 'failure', id, message: stringifyError(e) });
    }
  }, [deleteState, reload]);

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
        onAdd={handleOpenAdd}
        generateDisabled={generateState.kind === 'generating' || generateState.kind === 'importing'}
        formOpen={formState.kind === 'add' || formState.kind === 'edit' || formState.kind === 'submitting'}
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
      <ProviderFormModal
        formState={formState}
        onSubmit={handleSubmitForm}
        onCancel={handleCloseForm}
      />
      <ProviderDetailsModal
        detailsState={detailsState}
        onClose={handleCloseDetails}
      />
      <DeleteConfirmDialog
        deleteState={deleteState}
        onConfirm={handleConfirmDelete}
        onCancel={handleCancelDelete}
      />
      <Body
        state={state}
        switchState={switchState}
        exportState={exportState}
        onActivate={handleActivate}
        onExport={handleExport}
        onViewDetails={handleOpenDetails}
        onEdit={handleOpenEdit}
        onDelete={handleOpenDelete}
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
  onAdd: () => void;
  generateDisabled: boolean;
  /** When form modal is open, disable Add to avoid double-modal. */
  formOpen: boolean;
}

function HeaderBar({
  onRefresh,
  onGenerateFromCurrentConfig,
  onAdd,
  generateDisabled,
  formOpen,
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
        <button
          type="button"
          data-testid="provider-list-add"
          onClick={onAdd}
          disabled={formOpen}
          style={{
            ...btnStyle,
            background: 'var(--accent)',
            color: 'white',
            opacity: formOpen ? 0.6 : 1,
          }}
          title="手动添加新 provider"
        >
          + Add
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
  if (!provider) return null;

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
  onViewDetails: (id: string) => void;
  onEdit: (provider: Provider) => void;
  onDelete: (provider: Provider) => void;
}

function Body({
  state,
  switchState,
  exportState,
  onActivate,
  onExport,
  onViewDetails,
  onEdit,
  onDelete,
}: BodyProps): ReactElement {
  // M5 #31 — pagination state for the rendered slice. Reset to 0 when
  // the row set changes (filter / fresh fetch) so we don't end up
  // showing an empty page after a reload shrinks the list.
  const [page, setPage] = useState(0);

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
  // M5 #31 — slice the provider list to the current page. The parent
  // owns the data; we only own the slice index.
  const PAGE_SIZE = 20;
  const pageStart = page * PAGE_SIZE;
  const pageProviders = state.providers.slice(pageStart, pageStart + PAGE_SIZE);
  return (
    <ul data-testid="provider-list" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {pageProviders.map((p) => (
        <ProviderRow
          key={p.id}
          provider={p}
          switching={switchState.kind === 'switching' && switchState.id === p.id}
          exporting={exportState.kind === 'exporting' && exportState.id === p.id}
          onActivate={onActivate}
          onExport={onExport}
          onViewDetails={onViewDetails}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      ))}
      <Pagination
        total={state.providers.length}
        page={page}
        pageSize={PAGE_SIZE}
        onPageChange={setPage}
        testIdPrefix="provider-list-pagination"
      />
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
  onViewDetails: (id: string) => void;
  onEdit: (provider: Provider) => void;
  onDelete: (provider: Provider) => void;
}

function ProviderRow({
  provider,
  switching,
  exporting,
  onActivate,
  onExport,
  onViewDetails,
  onEdit,
  onDelete,
}: ProviderRowProps): ReactElement {
  const isActive = provider.is_active;
  // M3.0.4 — `ProviderModels.by_tier` uses `#[serde(skip_serializing_if =
  // "HashMap::is_empty")]` on the Rust side (provider.rs:141), so when a
  // provider has no custom tiers the JSON payload omits `by_tier` entirely.
  // `Object.keys(undefined)` throws and breaks the entire row render,
  // which is why 编辑/删除/查看/导出/激活 按钮会"集体消失"。Read defensively.
  const byTier: Record<string, string> = provider.models.by_tier ?? {};
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
          {((provider.models.default ? 1 : 0) + (provider.models.haiku ? 1 : 0) + (provider.models.sonnet ? 1 : 0) + (provider.models.opus ? 1 : 0) + Object.keys(byTier).length) > 0 && (
            <span className="meta">· {((provider.models.default ? 1 : 0) + (provider.models.haiku ? 1 : 0) + (provider.models.sonnet ? 1 : 0) + (provider.models.opus ? 1 : 0) + Object.keys(byTier).length)} 个模型</span>
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
        data-testid={`provider-view-${provider.id}`}
        onClick={() => onViewDetails(provider.id)}
        title="查看完整详情 (含 api_key)"
        style={{ opacity: exporting ? 0.6 : 1 }}
      >
        查看
      </button>
      <button
        type="button"
        className="btn"
        data-testid={`provider-edit-${provider.id}`}
        onClick={() => onEdit(provider)}
        title="编辑 provider 配置"
        style={{ opacity: exporting ? 0.6 : 1 }}
      >
        编辑
      </button>
      <button
        type="button"
        className="btn"
        data-testid={`provider-delete-${provider.id}`}
        disabled={isActive}
        onClick={() => onDelete(provider)}
        title={isActive ? '无法删除当前激活的 provider' : '删除此 provider'}
        style={{ opacity: isActive ? 0.4 : (exporting ? 0.6 : 1) }}
      >
        删除
      </button>
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

// ---------------------------------------------------------------------------
// M3.6 (清单 22) — ProviderFormModal (add + edit 共用)
// ---------------------------------------------------------------------------

interface ProviderFormModalProps {
  formState: FormState;
  onSubmit: (input: ProviderInput, existingId: string | null) => void | Promise<void>;
  onCancel: () => void;
}

function ProviderFormModal({
  formState,
  onSubmit,
  onCancel,
}: ProviderFormModalProps): ReactElement | null {
  const isOpen = formState.kind === 'add' || formState.kind === 'edit' || formState.kind === 'submitting' || formState.kind === 'failure';
  if (!isOpen) return null;
  const isEdit = formState.kind === 'edit';
  const isSubmitting = formState.kind === 'submitting';
  const failure = formState.kind === 'failure' ? formState.message : null;
  const existing = isEdit ? formState.provider : null;

  // Form state — 4-tier model mapping (default + haiku + sonnet + opus)
  const [name, setName] = useState(existing?.name ?? '');
  const [baseUrl, setBaseUrl] = useState(existing?.api_base ?? '');
  const [apiKey, setApiKey] = useState(existing?.api_key ?? '');
  const [modelDefault, setModelDefault] = useState(existing?.models.default ?? '');
  const [modelHaiku, setModelHaiku] = useState(existing?.models.haiku ?? '');
  const [modelSonnet, setModelSonnet] = useState(existing?.models.sonnet ?? '');
  const [modelOpus, setModelOpus] = useState(existing?.models.opus ?? '');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  // Reset form when modal reopens with a different provider
  useEffect(() => {
    if (formState.kind === 'add') {
      setName(''); setBaseUrl(''); setApiKey('');
      setModelDefault(''); setModelHaiku(''); setModelSonnet(''); setModelOpus('');
      setNotes('');
    } else if (formState.kind === 'edit') {
      setName(formState.provider.name);
      setBaseUrl(formState.provider.api_base);
      setApiKey(formState.provider.api_key);
      setModelDefault(formState.provider.models.default);
      setModelHaiku(formState.provider.models.haiku ?? '');
      setModelSonnet(formState.provider.models.sonnet ?? '');
      setModelOpus(formState.provider.models.opus ?? '');
      setNotes(formState.provider.notes ?? '');
    }
  }, [formState]);

  const handleSubmit = () => {
    // M5 bug #6 fix: include `id` in the ProviderInput payload — Rust's
    // ProviderInput struct requires it (serde fails with "missing field `id`"
    // otherwise). For add, we generate id from the name (kebab-case) so the
    // user doesn't see an id field in the UI; for edit, we re-use the existing id.
    const idForInput = existing?.id ?? generateIdFromName(name.trim());
    const input: ProviderInput = {
      id: idForInput,
      name: name.trim(),
      base_url: baseUrl.trim(),
      api_key: apiKey.trim(),
      models: {
        default: modelDefault.trim(),
        haiku: modelHaiku.trim() || null,
        sonnet: modelSonnet.trim() || null,
        opus: modelOpus.trim() || null,
        by_tier: {},  // Custom tiers UI (TODO: 后续支持动态添加)
      },
      notes: notes.trim() || null,
    };
    void onSubmit(input, existing?.id ?? null);
  };

  // M5 bug #6 fix: derive a kebab-case id from the user-typed name for the
  // add path. The Rust side validates this against `is_valid_id`.
  function generateIdFromName(raw: string): string {
    return raw
      .toLowerCase()
      .replace(/[^a-z0-9-_]+/g, '-')
      .replace(/^-+|-+$/g, '')
      || 'new-provider';
  }

  return (
    <div
      data-testid="provider-form-modal"
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg-elevated)', borderRadius: 'var(--radius-card)',
          padding: 'var(--space-6)', minWidth: 480, maxWidth: 600,
          border: '1px solid var(--border)',
        }}
      >
        <h2 style={{ margin: 0, marginBottom: 'var(--space-4)', fontSize: 'var(--fs-heading)' }}>
          {isEdit ? '编辑 Provider' : '添加 Provider'}
        </h2>
        {failure && (
          <div data-testid="provider-form-error" style={{ color: 'var(--danger)', marginBottom: 'var(--space-2)' }}>
            {failure}
          </div>
        )}
        <Field label="Name">
          <input data-testid="provider-form-name" value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} disabled={isSubmitting} />
        </Field>
        <Field label="Base URL">
          <input data-testid="provider-form-base-url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} style={inputStyle} disabled={isSubmitting} />
        </Field>
        <Field label="API Key">
          <input data-testid="provider-form-api-key" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} style={inputStyle} disabled={isSubmitting} />
        </Field>
        <Field label="Default Model">
          <input data-testid="provider-form-model-default" value={modelDefault} onChange={(e) => setModelDefault(e.target.value)} style={inputStyle} disabled={isSubmitting} placeholder="claude-sonnet-4-6" />
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--space-2)' }}>
          <Field label="Haiku Tier">
            <input data-testid="provider-form-model-haiku" value={modelHaiku} onChange={(e) => setModelHaiku(e.target.value)} style={inputStyle} disabled={isSubmitting} placeholder="claude-haiku-4-5 (可选)" />
          </Field>
          <Field label="Sonnet Tier">
            <input data-testid="provider-form-model-sonnet" value={modelSonnet} onChange={(e) => setModelSonnet(e.target.value)} style={inputStyle} disabled={isSubmitting} placeholder="claude-sonnet-4-6 (可选)" />
          </Field>
          <Field label="Opus Tier">
            <input data-testid="provider-form-model-opus" value={modelOpus} onChange={(e) => setModelOpus(e.target.value)} style={inputStyle} disabled={isSubmitting} placeholder="claude-opus-4 (可选)" />
          </Field>
        </div>
        <Field label="Notes (可选)">
          <textarea data-testid="provider-form-notes" value={notes} onChange={(e) => setNotes(e.target.value)} style={{ ...inputStyle, minHeight: 60 }} disabled={isSubmitting} />
        </Field>
        <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end', marginTop: 'var(--space-4)' }}>
          <button type="button" data-testid="provider-form-cancel" onClick={onCancel} style={btnStyle} disabled={isSubmitting}>
            取消
          </button>
          <button type="button" data-testid="provider-form-save" onClick={handleSubmit} style={{ ...btnStyle, background: 'var(--accent)', color: 'white' }} disabled={isSubmitting}>
            {isSubmitting ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactElement }): ReactElement {
  return (
    <div style={{ marginBottom: 'var(--space-3)' }}>
      <label style={{ display: 'block', fontSize: 'var(--fs-caption)', color: 'var(--text-secondary)', marginBottom: 4 }}>
        {label}
      </label>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '6px 8px', border: '1px solid var(--border)',
  borderRadius: 'var(--radius-button)', fontSize: 'var(--fs-body)',
  fontFamily: 'inherit', background: 'var(--bg-primary)', color: 'var(--text-primary)',
};



// ---------------------------------------------------------------------------
// M3.6 — ProviderDetailsModal
// ---------------------------------------------------------------------------

interface ProviderDetailsModalProps {
  detailsState: DetailsState;
  onClose: () => void;
}

function ProviderDetailsModal({ detailsState, onClose }: ProviderDetailsModalProps): ReactElement | null {
  if (detailsState.kind === 'idle') return null;
  return (
    <div
      data-testid="provider-details-modal"
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
      onClick={onClose}
    >
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--bg-elevated)', borderRadius: 'var(--radius-card)', padding: 'var(--space-6)', minWidth: 480, maxWidth: 600, border: '1px solid var(--border)' }}>
        <h2 style={{ margin: 0, marginBottom: 'var(--space-4)', fontSize: 'var(--fs-heading)' }}>
          Provider 详情
        </h2>
        {detailsState.kind === 'loading' && <div data-testid="provider-details-loading">加载中…</div>}
        {detailsState.kind === 'failure' && (
          <div data-testid="provider-details-error" style={{ color: 'var(--danger)' }}>
            {detailsState.message}
          </div>
        )}
        {detailsState.kind === 'loaded' && (
          <div data-testid="provider-details-content">
            <DetailRow label="ID" value={detailsState.provider.id} />
            <DetailRow label="Name" value={detailsState.provider.name} />
            <DetailRow label="Type" value={detailsState.provider.provider_type} />
            <DetailRow label="Base URL" value={detailsState.provider.api_base} />
            <DetailRow label="API Key" value={detailsState.provider.api_key} mono />
            <DetailRow
              label="Default Model"
              value={detailsState.provider.models.default || '(server default)'}
              mono
            />
            {detailsState.provider.models.haiku && (
              <DetailRow label="Haiku Tier" value={detailsState.provider.models.haiku} mono />
            )}
            {detailsState.provider.models.sonnet && (
              <DetailRow label="Sonnet Tier" value={detailsState.provider.models.sonnet} mono />
            )}
            {detailsState.provider.models.opus && (
              <DetailRow label="Opus Tier" value={detailsState.provider.models.opus} mono />
            )}
            {Object.entries(detailsState.provider.models.by_tier ?? {}).map(([tier, model]) => (
              <DetailRow key={tier} label={`${tier} Tier`} value={model} mono />
            ))}
            <DetailRow label="Created" value={new Date(detailsState.provider.created_at * 1000).toISOString()} />
            <DetailRow label="Last Used" value={detailsState.provider.last_used_at ? new Date(detailsState.provider.last_used_at * 1000).toISOString() : '从未'} />
            <DetailRow label="Notes" value={detailsState.provider.notes || '(无)'} />
            <DetailRow label="Active" value={detailsState.provider.is_active ? '✓ 当前激活' : '否'} />
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--space-4)' }}>
          <button type="button" data-testid="provider-details-close" onClick={onClose} style={btnStyle}>关闭</button>
        </div>
      </div>
    </div>
  );
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }): ReactElement {
  return (
    <div style={{ display: 'flex', marginBottom: 6, fontSize: 'var(--fs-body)' }}>
      <span style={{ minWidth: 100, color: 'var(--text-secondary)' }}>{label}:</span>
      <span style={{ fontFamily: mono ? 'var(--font-mono)' : 'inherit', color: 'var(--text-primary)', wordBreak: 'break-all' }}>{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// M3.6 — DeleteConfirmDialog (uses existing ConfirmDialog component)
// ---------------------------------------------------------------------------

interface DeleteConfirmDialogProps {
  deleteState: DeleteState;
  onConfirm: () => void;
  onCancel: () => void;
}

function DeleteConfirmDialog({ deleteState, onConfirm, onCancel }: DeleteConfirmDialogProps): ReactElement | null {
  if (deleteState.kind === 'idle') return null;
  const provider = deleteState.kind === 'confirming' ? deleteState.provider :
                   deleteState.kind === 'failure' ? { id: deleteState.id, name: deleteState.id } as Provider : null;
  const failure = deleteState.kind === 'failure' ? deleteState.message : null;
  return (
    <>
      {deleteState.kind === 'confirming' && (
        <ConfirmDialog
          open
          danger
          title="删除 Provider"
          message={`确认删除 provider "${provider?.name}" (${provider?.id})? 此操作不可撤销 (系统会先做备份).`}
          confirmLabel="删除"
          cancelLabel="取消"
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      )}
      {deleteState.kind === 'deleting' && (
        <div data-testid="provider-deleting" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: 'var(--bg-elevated)', padding: 'var(--space-6)', borderRadius: 'var(--radius-card)' }}>
            正在删除 {provider?.name}…
          </div>
        </div>
      )}
      {deleteState.kind === 'failure' && (
        <div data-testid="provider-delete-error" style={{ position: 'fixed', bottom: 20, right: 20, background: 'var(--danger)', color: 'white', padding: 'var(--space-3) var(--space-4)', borderRadius: 'var(--radius-card)', zIndex: 1000 }}>
          删除失败: {failure}
        </div>
      )}
    </>
  );
}

export default ProviderListPage;