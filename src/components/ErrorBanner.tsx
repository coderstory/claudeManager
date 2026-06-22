/**
 * ErrorBanner — F15 错误反馈横切 (M2.16)
 *
 * 跨页面共享的"内联红/黄/蓝/绿提示条"组件。SPEC F15:
 *   "切换 / 编辑 / 导入失败时内联红色提示条,不弹模态"
 *
 * 设计要点:
 *   - 4 种 kind: error / warning / info / success。
 *   - error/warning 用 role="alert" (立刻读屏);
 *     info/success 用 role="status" (礼貌延迟读屏)。
 *   - 视觉: 10px 14px padding + 4px 圆角 + 13px 字号 + 8px gap。
 *     背景色用 rgba(对应色,0.08) (与现有 InfoBar 风格保持一致),
 *     前景色用 --danger / --warning / --accent / --success。
 *   - onDismiss 为可选;不传则不渲染 ✕ 按钮(纯展示型 banner)。
 *   - autoDismissMs: 传了则在 N 毫秒后自动调用 onDismiss。
 *     注意:autoDismiss 要求 onDismiss 存在;无 onDismiss 时此 prop 忽略。
 *   - testId / data-banner-kind: 便于 e2e 区分不同 kind 的 banner。
 *   - 留言区 wordBreak: break-word,长路径 / 错误堆栈不溢出。
 *
 * 现有改造点 (M2.16):
 *   - provider-list: ExportInfoBar 内部用 ErrorBanner,
 *     保留对外 testid `provider-export-{kind}-bar`。
 *   - backup-restore: InfoBar 内部用 ErrorBanner,
 *     保留对外 testid `backup-message` + data-message-kind。
 *
 * 后续第二批:
 *   - optimizer 3 个 banner (scan/apply/export)。
 *   - import-sql: 评估 ErrorView (含重试按钮) 是否替换。
 *   - marketplace: 提取已存在的 ErrorBanner 到 components/。
 *
 * ## M3.5 — RevealError 本地化辅助
 *
 * 后端 `RevealFailure` (Rust) 序列化后字段:
 *   { kind: string, message: string, path: string }
 *
 * `kind` 是稳定的 IPC routing key (kebab-case, 不本地化):
 *   - "not_found"         → 路径不存在
 *   - "permission_denied" → 无权限 / 路径校验失败 / 路径为空
 *   - "network_path"      → 不支持网络路径 (UNC / SMB / AFP / NFS)
 *   - "launcher_failed"   → explorer / open 启动失败 (退出码 1 等)
 *
 * `formatRevealError(failure)` 把后端错误转成中文 message + hint,
 * resource-browser 页面在 `catch` 块里调一次,再喂给本组件。
 */
import { useEffect, useRef } from 'react';
import type { ReactElement } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';

export type ErrorBannerKind = 'error' | 'warning' | 'info' | 'success';

// ---------------------------------------------------------------------------
// M3.5 — Reveal error 路由(后端 RevealFailure IPC contract)
// ---------------------------------------------------------------------------

/**
 * 后端 `RevealFailure` 的 TS 镜像。Rust 侧定义在
 * `src-tauri/src/services/resource_service.rs::RevealFailure`。
 *
 * 注:`path` 字段在 `permission_denied` 来自「路径为空」时是
 * 空字符串,UI 应避免显示空路径(见 `formatRevealError`)。
 */
export interface RevealFailure {
  kind: string;
  message: string;
  path: string;
}

/**
 * 已知 `kind` 列表(后端 contract 锁定,前端用 exhaustive
 * check 保证后端新增 kind 时这里会被 TypeScript 报红,提醒
 * 同步加文案)。
 */
export type RevealErrorKind =
  | 'not_found'
  | 'permission_denied'
  | 'network_path'
  | 'launcher_failed';

/**
 * 4 类 reveal 错误的中文文案 + hint。
 *
 * 顺序与 `RevealErrorKind` union 对齐;若后端新增 kind,
 * 这里 switch 会自动报错。
 */
function revealErrorText(
  kind: RevealErrorKind,
  failure: RevealFailure,
): { message: string; hint: string | null } {
  switch (kind) {
    case 'not_found':
      return {
        message: `文件不存在,可能已被删除或移动。`,
        hint: failure.path ? `路径: ${failure.path}` : null,
      };
    case 'permission_denied':
      return {
        message:
          failure.path === ''
            ? '路径为空,请检查资源是否有效。'
            : '无法访问该路径(权限不足或路径被拒绝)。',
        hint: failure.path && failure.path !== '' ? `路径: ${failure.path}` : null,
      };
    case 'network_path':
      return {
        message: '暂不支持显示网络路径。',
        hint: '请将文件复制到本地后重试。',
      };
    case 'launcher_failed':
      return {
        message: '文件管理器启动失败,请重试或重启应用。',
        hint: '若多次失败,请检查系统文件管理器(explorer.exe / Finder)是否可用。',
      };
  }
}

/**
 * 把后端 `RevealFailure` 转成 ErrorBanner 可直接渲染的
 * `(message, kind)` 二元组。`message` 是「主文案 + 路径/
 * 提示」的两行字符串(用 `\n` 分隔)。
 *
 * 未知 `kind` 不抛错,fallback 到「launcher_failed」文案 —
 * 保证新加 kind 时 UI 仍能显示(不阻塞 ship)。
 */
export function formatRevealError(
  failure: RevealFailure | null | undefined,
): { message: string; kind: ErrorBannerKind } {
  if (!failure) {
    return { message: '未知错误', kind: 'error' };
  }
  const knownKinds: RevealErrorKind[] = [
    'not_found',
    'permission_denied',
    'network_path',
    'launcher_failed',
  ];
  const kind: RevealErrorKind = (knownKinds as string[]).includes(failure.kind)
    ? (failure.kind as RevealErrorKind)
    : 'launcher_failed';
  const { message, hint } = revealErrorText(kind, failure);
  // 两行:主文案 / hint 或 path
  const fullMessage = hint ? `${message}\n${hint}` : message;
  return { message: fullMessage, kind: 'error' };
}

export interface ErrorBannerProps {
  /** 提示条类型,默认 'error' (F15 主用例)。 */
  kind?: ErrorBannerKind;
  /** 主提示文案,必填(空字符串也允许,容器仍渲染)。 */
  message: string;
  /** 关闭回调;不传则不渲染 ✕ 按钮。 */
  onDismiss?: () => void;
  /** 自动关闭延时(毫秒);不传则不自动消失。 */
  autoDismissMs?: number;
  /** 透传 data-testid;默认 `error-banner-{kind}`。 */
  testId?: string;
  /** 容器 className / style 覆盖。 */
  className?: string;
  /** 内联样式覆盖(partial),便于页面微调边距。 */
  style?: React.CSSProperties;
}

// 4 种 kind 的视觉规范集中维护。改一处全站点生效。
const STYLE_BY_KIND: Record<
  ErrorBannerKind,
  { bg: string; fg: string; Icon: typeof AlertCircle; role: 'alert' | 'status' }
> = {
  error: {
    bg: 'rgba(211, 47, 47, 0.08)',
    fg: 'var(--danger)',
    Icon: AlertCircle,
    role: 'alert',
  },
  warning: {
    bg: 'rgba(245, 124, 0, 0.08)',
    fg: 'var(--warning)',
    Icon: AlertTriangle,
    role: 'alert',
  },
  info: {
    bg: 'rgba(9, 105, 218, 0.08)',
    fg: 'var(--accent)',
    Icon: Info,
    role: 'status',
  },
  success: {
    bg: 'rgba(56, 142, 60, 0.08)',
    fg: 'var(--success)',
    Icon: CheckCircle2,
    role: 'status',
  },
};

/**
 * 渲染一个内联提示条。详见文件头注释。
 */
export function ErrorBanner({
  kind = 'error',
  message,
  onDismiss,
  autoDismissMs,
  testId,
  className,
  style,
}: ErrorBannerProps): ReactElement {
  const cfg = STYLE_BY_KIND[kind];
  const Icon = cfg.Icon;
  const hasDismiss = typeof onDismiss === 'function';

  // M2.16 — H4: 把 onDismiss 存到 ref,这样 autoDismiss 的 useEffect
  // deps 可以稳定(只 [autoDismissMs, kind, message])。老代码把
  // onDismiss 放进 deps,父组件 inline 传 `() => setX(null)` 会每次
  // render 生成新引用 → effect 重跑 → clear + 新 timer → autoDismiss
  // 倒计时从父组件最后一次 render 算起,极端情况持续 re-render 时
  // banner 永远不消失。
  //
  // 用 ref 存最新 onDismiss,timer fire 时调 ref.current()(永远拿到
  // 最新值),timer 本身不再因 onDismiss 引用变化而重置。
  const onDismissRef = useRef<(() => void) | undefined>(onDismiss);
  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  // autoDismiss 仅在 onDismiss 存在时生效,避免无人监听时 setState。
  useEffect(() => {
    if (!hasDismiss) return;
    if (typeof autoDismissMs !== 'number' || autoDismissMs <= 0) return;
    const t = window.setTimeout(() => {
      // 通过 ref 调用,拿到最新的 onDismiss(避免 stale closure)。
      onDismissRef.current?.();
    }, autoDismissMs);
    return () => {
      window.clearTimeout(t);
    };
  }, [hasDismiss, autoDismissMs, message, kind]);

  return (
    <div
      data-testid={testId ?? `error-banner-${kind}`}
      data-banner-kind={kind}
      role={cfg.role}
      className={className}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
        padding: '10px 14px',
        borderRadius: 'var(--radius-button)',
        background: cfg.bg,
        color: cfg.fg,
        fontSize: 13,
        lineHeight: 1.5,
        ...style,
      }}
    >
      <Icon size={14} style={{ flexShrink: 0 }} aria-hidden="true" />
      <span style={{ flex: '1 1 auto', minWidth: 0, wordBreak: 'break-word' }}>
        {message}
      </span>
      {hasDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="关闭提示"
          data-testid={testId ? `${testId}-dismiss` : `error-banner-${kind}-dismiss`}
          style={{
            flexShrink: 0,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 20,
            height: 20,
            border: 'none',
            background: 'transparent',
            color: 'inherit',
            cursor: 'pointer',
            borderRadius: 'var(--radius-button)',
            padding: 0,
          }}
        >
          <X size={12} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

export default ErrorBanner;
