/**
 * F18 — 配置优化 (M2.9 + M3.3 Phase 4 real implementation).
 *
 * User flow (per docs/design/M2.9-dataflow.md, updated for M3.3):
 *   1. User clicks the sidebar "配置优化" tile.
 *   2. Page mounts and calls `scanOptimizations` to fetch findings
 *      from all 16 rules (13 file rules + 3 env rules).
 *   3. UI renders findings grouped by severity (Error → Warning →
 *      Info). Each FindingRow shows: status icon (green-check when
 *      fixed/applied, red-x when failed or manual-only) + rule name
 *      + affected path + an inline Fix button (only for auto-apply
 *      rules). A secondary "Apply All Auto-Fix" button above the
 *      list handles the M2.9 batch pattern for power users.
 *   4. Per-row Fix button → calls `applyRuleFix(ruleId)`. Each
 *      ApplyResult is shown inline with green/red status + backup
 *      path. On success the row's status icon flips to green-check
 *      and the Fix button disables (re-click won't double-apply).
 *   5. After all applies, [重新扫描] re-runs scan to validate the
 *      fix (rules that no longer fire disappear from the list).
 *
 * ## Design choices (CLAUDE.md §5 + SPEC §5.11 + M3.3 §5.11.2)
 *
 * - **No grouping libraries** — plain `Array.filter` per severity.
 * - **Per-row status icon (green-check / red-x)** — replaced the
 *   M2.9 batch checkbox UI. Manual rules get a red-x + "在 JSON
 *   编辑器中打开" action (same M5 #28 path).
 * - **Per-row Fix button (auto rules only)** — calls
 *   `applyRuleFix(ruleId)` (the new SC #3 backend). One click =
 *   one rule. Idempotent: a second click on an already-applied
 *   row is a no-op (button disabled).
 * - **Keep batch "Apply All Auto-Fix"** — power-user escape hatch.
 *   It calls the original `applyOptimizations(findingIds)` with
 *   all auto-apply finding ids.
 * - **Apply results stay visible until next scan** — user can read
 *   "已自动备份至 ~/.claude/settings.json.bak.<ts>".
 * - **Empty state ≠ error**: zero findings is the "all good" state;
 *   the page shows a friendly "未发现需优化的项" instead of a
 *   blank screen.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  ExternalLink,
  Info,
  RefreshCw,
  ShieldAlert,
  Wand2,
  XCircle,
} from 'lucide-react';

import { ErrorBanner } from '../../components/ErrorBanner';
import {
  applyOptimizations,
  applyRuleFix,
  exportOptimizationReport,
  scanOptimizations,
} from '../../lib/api/optimizer';
import { useViewState } from '../../hooks/useViewState';
import type {
  ApplyResult,
  OptimizationFinding,
  Severity,
} from '../../types/optimizer';
import {
  severityColour,
  severityLabel,
} from '../../types/optimizer';

// ---------------------------------------------------------------------------
// Page-level state
// ---------------------------------------------------------------------------

/** M3.3 — per-rule apply tracking (SC #2/#3).
 *  Keyed by `rule_id` (not finding id, since the per-row Fix button
 *  addresses rules). Value is the latest ApplyResult for that rule.
 *  Rules not in the map are in their default state (not yet applied). */
type RuleStatusMap = Record<string, ApplyResult | undefined>;

interface PageState {
  findings: OptimizationFinding[];
  loading: boolean;
  scanError: string | null;
  /** Per-row Fix button results. Cleared on rescan. */
  ruleStatus: RuleStatusMap;
  /** rule_ids currently being fixed (per-row Fix in flight). */
  fixingRuleIds: Set<string>;
  /** Per-row Fix errors (last failed rule_id → message). */
  fixError: { ruleId: string; message: string } | null;
  /** Batch "Apply All Auto-Fix" progress / results. */
  applyingAll: boolean;
  applyAllResults: ApplyResult[] | null;
  applyAllError: string | null;
  lastScanAt: number | null;
  /** F23 导出报告时置 true,禁用导出按钮。 */
  exporting: boolean;
  /** F23 导出失败的错误信息(null = 无错误)。 */
  exportError: string | null;
  /** F23 导出成功的路径提示(null = 未导出 / 已清除)。 */
  exportSuccessPath: string | null;
}

const INITIAL_STATE: PageState = {
  findings: [],
  loading: true,
  scanError: null,
  ruleStatus: {},
  fixingRuleIds: new Set(),
  fixError: null,
  applyingAll: false,
  applyAllResults: null,
  applyAllError: null,
  lastScanAt: null,
  exporting: false,
  exportError: null,
  exportSuccessPath: null,
};

const SEVERITY_ORDER: Severity[] = ['error', 'warning', 'info'];

const SEVERITY_ICONS: Record<Severity, typeof Info> = {
  info: Info,
  warning: ShieldAlert,
  error: AlertCircle,
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function OptimizerPage(): ReactElement {
  const [state, setState] = useState<PageState>(INITIAL_STATE);
  // M5 #28 — manual-handling findings navigate to json-editor with
  // the affected file pre-loaded. We pass the path through
  // sessionStorage (key `ccm.openFilePath`) so the editor's loadFileByPath
  // can pick it up on mount without coupling through props.
  const { setView } = useViewState();

  const runScan = useCallback(async () => {
    setState((prev) => ({
      ...prev,
      loading: true,
      scanError: null,
      // Clear per-row apply state — fresh scan invalidates prior
      // statuses (findings may have disappeared; re-scanning is the
      // "tell me truth again" trigger).
      ruleStatus: {},
      fixingRuleIds: new Set(),
      fixError: null,
      applyAllResults: null,
      applyAllError: null,
    }));
    try {
      const findings = await scanOptimizations();
      setState((prev) => ({
        ...prev,
        findings,
        loading: false,
        scanError: null,
        lastScanAt: Date.now(),
      }));
    } catch (err) {
      setState((prev) => ({
        ...prev,
        findings: [],
        loading: false,
        scanError: err instanceof Error ? err.message : String(err),
      }));
    }
  }, []);

  // Initial scan on mount.
  useEffect(() => {
    void runScan();
  }, [runScan]);

  // M5 #28 — jump to JSON editor with `finding.affected_path` pre-loaded.
  // Writes to sessionStorage so the editor's mount effect can pick it up
  // (cross-view handoff without prop drilling).
  const handleOpenInEditor = useCallback((path: string) => {
    try {
      sessionStorage.setItem('ccm.openFilePath', path);
    } catch {
      // sessionStorage may be unavailable (private mode / disabled);
      // fall through to navigation anyway — editor will open to its
      // last-loaded file.
    }
    setView('json-editor');
  }, [setView]);

  // M3.3 — per-row Fix button handler (SC #2/#3). One click → one
  // rule's apply. After success, the row's status icon flips to
  // green-check + the Fix button disables (avoid double-apply).
  const handleFixOne = useCallback(async (ruleId: string) => {
    setState((prev) => {
      const next = new Set(prev.fixingRuleIds);
      next.add(ruleId);
      return { ...prev, fixingRuleIds: next, fixError: null };
    });
    try {
      const results = await applyRuleFix(ruleId);
      setState((prev) => {
        const next = new Set(prev.fixingRuleIds);
        next.delete(ruleId);
        // Use the first result as the "status icon" source; if
        // multiple findings fired for this rule, the first one's
        // outcome represents the batch (subsequent ones are rare
        // and would surface in the ApplyResultsPanel).
        const result = results[0];
        return {
          ...prev,
          fixingRuleIds: next,
          ruleStatus: result
            ? { ...prev.ruleStatus, [ruleId]: result }
            : prev.ruleStatus,
        };
      });
    } catch (err) {
      setState((prev) => {
        const next = new Set(prev.fixingRuleIds);
        next.delete(ruleId);
        return {
          ...prev,
          fixingRuleIds: next,
          fixError: {
            ruleId,
            message: err instanceof Error ? err.message : String(err),
          },
        };
      });
    }
  }, []);

  // M3.3 — batch "Apply All Auto-Fix" (kept as power-user escape
  // hatch, see design comment at top of file). Gathers every
  // auto-apply finding's id and sends them all in one batch.
  const handleApplyAll = useCallback(async () => {
    const ids = state.findings
      .filter((f) => f.auto_apply)
      .map((f) => f.id);
    if (ids.length === 0) return;
    setState((prev) => ({ ...prev, applyingAll: true, applyAllError: null }));
    try {
      const results = await applyOptimizations(ids);
      setState((prev) => {
        // Map each apply result back to its finding's rule_id so
        // per-row status icons update.
        const idToRule = new Map(
          prev.findings.map((f) => [f.id, f.rule_id] as const),
        );
        const nextStatus: RuleStatusMap = { ...prev.ruleStatus };
        for (const r of results) {
          const rid = idToRule.get(r.finding_id);
          if (rid) nextStatus[rid] = r;
        }
        return {
          ...prev,
          applyingAll: false,
          applyAllResults: results,
          applyAllError: null,
          ruleStatus: nextStatus,
        };
      });
    } catch (err) {
      setState((prev) => ({
        ...prev,
        applyingAll: false,
        applyAllError: err instanceof Error ? err.message : String(err),
      }));
    }
  }, [state.findings]);

  // F23 — 导出 markdown 报告。后端生成内容 + 弹保存框 + 写盘,
  // 前端只传当前 findings + applyResults（如有),拿回路径展示成功提示。
  // 用户在保存框取消 → 后端返回 null → 静默,不显示任何错误。
  //
  // M3.3: 用 `applyAllResults`（批量 apply 的结果)作为报告里的
  // "应用状态"数据源,跟 batch apply 路径对齐。
  const handleExport = useCallback(async () => {
    setState((prev) => ({
      ...prev,
      exporting: true,
      exportError: null,
      exportSuccessPath: null,
    }));
    try {
      const path = await exportOptimizationReport(
        state.findings,
        state.applyAllResults,
        new Date().toISOString(),
      );
      if (path === null) {
        // 用户取消保存框——静默,清 exporting 但不置错误/成功。
        setState((prev) => ({
          ...prev,
          exporting: false,
          exportError: null,
          exportSuccessPath: null,
        }));
        return;
      }
      setState((prev) => ({
        ...prev,
        exporting: false,
        exportError: null,
        exportSuccessPath: path,
      }));
    } catch (err) {
      setState((prev) => ({
        ...prev,
        exporting: false,
        exportError: err instanceof Error ? err.message : String(err),
        exportSuccessPath: null,
      }));
    }
  }, [state.findings, state.applyAllResults]);

  const grouped = useMemo(() => {
    const m: Record<Severity, OptimizationFinding[]> = {
      error: [],
      warning: [],
      info: [],
    };
    for (const f of state.findings) {
      m[f.severity].push(f);
    }
    return m;
  }, [state.findings]);

  // auto-apply finding 数(M3.3 batch 按钮 "Apply All Auto-Fix" 用)
  const autoFixCount = useMemo(
    () => state.findings.filter((f) => f.auto_apply).length,
    [state.findings],
  );
  const totalCount = state.findings.length;

  // ---- render ----

  return (
    <div
      data-testid="optimizer-page"
      style={{
        padding: 24,
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        maxWidth: 720,
        margin: '0 auto',
      }}
    >
      {/* Header bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div>
          <h2
            style={{
              fontSize: 18,
              fontWeight: 600,
              color: 'var(--text-primary)',
              margin: 0,
            }}
          >
            配置优化检查
          </h2>
          <p
            style={{
              fontSize: 12,
              color: 'var(--text-secondary)',
              marginTop: 4,
              marginBottom: 0,
            }}
          >
            扫描 ~/.claude/ 下的 settings.json + providers/ + mcp.json,识别 16 类常见问题。
            {state.lastScanAt && (
              <span style={{ marginLeft: 8 }}>
                · 上次扫描: {new Date(state.lastScanAt).toLocaleTimeString()}
              </span>
            )}
          </p>
        </div>
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          <button
            type="button"
            data-testid="optimizer-rescan-btn"
            onClick={() => {
              void runScan();
            }}
            disabled={state.loading}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 14px',
              borderRadius: 'var(--radius-button)',
              border: '1px solid var(--border)',
              background: 'var(--bg-elevated)',
              color: 'var(--text-primary)',
              fontSize: 13,
              cursor: state.loading ? 'not-allowed' : 'pointer',
              opacity: state.loading ? 0.6 : 1,
              // M5 bug #20 — 重新扫描按钮宽度不够导致 "重新扫描" 文字换行.
              // 加 min-width + white-space: nowrap, 文字始终单行.
              minWidth: 110,
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            <RefreshCw size={14} />
            {state.loading ? '扫描中...' : '重新扫描'}
          </button>
          {/* F23 — 导出 markdown 报告。扫描完成（findings 有值,无论 0 还是 N）
              即可导出;扫描中 / 导出中禁用。用户取消保存框静默处理。 */}
          <button
            type="button"
            data-testid="optimizer-export-btn"
            onClick={() => {
              void handleExport();
            }}
            disabled={state.loading || state.exporting}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 14px',
              borderRadius: 'var(--radius-button)',
              border: '1px solid var(--border)',
              background: 'var(--bg-elevated)',
              color: 'var(--text-primary)',
              fontSize: 13,
              cursor:
                state.loading || state.exporting ? 'not-allowed' : 'pointer',
              opacity: state.loading || state.exporting ? 0.6 : 1,
            }}
          >
            <Download size={14} />
            {state.exporting ? '导出中...' : '导出报告'}
          </button>
        </div>
      </div>

      {/* 扫描失败提示(F15 ErrorBanner 统一横切,kind=error) */}
      {state.scanError && (
        <ErrorBanner
          kind="error"
          testId="optimizer-scan-error"
          message={`扫描失败: ${state.scanError}`}
        />
      )}

      {/* F23 — 导出成功提示(F15 ErrorBanner kind=success,带 dismiss ✕) */}
      {state.exportSuccessPath && (
        <ErrorBanner
          kind="success"
          testId="optimizer-export-success"
          message={`报告已导出: ${state.exportSuccessPath}`}
          onDismiss={() => {
            setState((prev) => ({ ...prev, exportSuccessPath: null }));
          }}
        />
      )}

      {/* F23 — 导出失败提示(F15 ErrorBanner kind=error,带 dismiss ✕) */}
      {state.exportError && (
        <ErrorBanner
          kind="error"
          testId="optimizer-export-error"
          message={`导出失败: ${state.exportError}`}
          onDismiss={() => {
            setState((prev) => ({ ...prev, exportError: null }));
          }}
        />
      )}

      {/* Empty state */}
      {!state.loading && !state.scanError && totalCount === 0 && (
        <div
          data-testid="optimizer-empty"
          style={{
            padding: 32,
            textAlign: 'center',
            background: 'var(--bg-elevated)',
            borderRadius: 'var(--radius-card)',
            border: '1px solid var(--border)',
            color: 'var(--text-secondary)',
          }}
        >
          <CheckCircle2
            size={32}
            color="var(--success)"
            style={{ marginBottom: 8 }}
          />
          <div style={{ fontSize: 14, color: 'var(--text-primary)' }}>
            未发现需优化的项
          </div>
          <div style={{ fontSize: 12, marginTop: 4 }}>
            配置看起来很好,所有 16 个规则都已通过。
          </div>
        </div>
      )}

      {/* M3.3 — 批量 "Apply All Auto-Fix" 按钮(放在列表上方,作为
          power-user 快速通道;主交互仍是 per-row Fix 按钮)。 */}
      {autoFixCount > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '12px 16px',
            background: 'var(--bg-elevated)',
            borderRadius: 'var(--radius-button)',
            border: '1px solid var(--border)',
          }}
        >
          <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            {autoFixCount} 项可自动修复
          </div>
          <button
            type="button"
            data-testid="optimizer-apply-all-btn"
            onClick={() => {
              void handleApplyAll();
            }}
            disabled={state.applyingAll || autoFixCount === 0}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 16px',
              borderRadius: 'var(--radius-button)',
              border: 'none',
              background:
                autoFixCount === 0 ? 'var(--text-muted)' : 'var(--accent)',
              color: '#fff',
              fontSize: 13,
              cursor:
                state.applyingAll || autoFixCount === 0
                  ? 'not-allowed'
                  : 'pointer',
              opacity: state.applyingAll ? 0.6 : 1,
            }}
          >
            <Wand2 size={14} />
            {state.applyingAll ? '应用中...' : `应用全部 ${autoFixCount} 项自动修复`}
          </button>
        </div>
      )}

      {/* Grouped finding list */}
      {!state.loading && totalCount > 0 && (
        <div
          data-testid="optimizer-findings"
          style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
        >
          {SEVERITY_ORDER.map((sev) => {
            const list = grouped[sev];
            if (list.length === 0) return null;
            return (
              <SeverityGroup
                key={sev}
                severity={sev}
                findings={list}
                ruleStatus={state.ruleStatus}
                fixingRuleIds={state.fixingRuleIds}
                onFixOne={handleFixOne}
                onOpenInEditor={handleOpenInEditor}
              />
            );
          })}
        </div>
      )}

      {/* Per-row Fix 失败提示(F15 ErrorBanner kind=error) */}
      {state.fixError && (
        <ErrorBanner
          kind="error"
          testId="optimizer-fix-error"
          message={`修复失败: ${state.fixError.message}`}
          onDismiss={() => {
            setState((prev) => ({ ...prev, fixError: null }));
          }}
        />
      )}

      {/* Apply All 失败提示 */}
      {state.applyAllError && (
        <ErrorBanner
          kind="error"
          testId="optimizer-apply-all-error"
          message={`批量应用失败: ${state.applyAllError}`}
          onDismiss={() => {
            setState((prev) => ({ ...prev, applyAllError: null }));
          }}
        />
      )}

      {/* Apply results — batch apply 的整体结果汇总 */}
      {state.applyAllResults && state.applyAllResults.length > 0 && (
        <ApplyResultsPanel results={state.applyAllResults} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SeverityGroup — one severity-bucket of findings.
// ---------------------------------------------------------------------------

function SeverityGroup({
  severity,
  findings,
  ruleStatus,
  fixingRuleIds,
  onFixOne,
  onOpenInEditor,
}: {
  severity: Severity;
  findings: OptimizationFinding[];
  ruleStatus: RuleStatusMap;
  fixingRuleIds: Set<string>;
  onFixOne: (ruleId: string) => void;
  onOpenInEditor: (path: string) => void;
}): ReactElement {
  const Icon = SEVERITY_ICONS[severity];
  const colour = severityColour(severity);
  return (
    <div
      data-testid={`optimizer-group-${severity}`}
      style={{
        background: 'var(--bg-elevated)',
        borderRadius: 'var(--radius-card)',
        border: '1px solid var(--border)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 14px',
          background: 'rgba(0,0,0,0.02)',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <Icon size={14} color={colour} />
        <span
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--text-primary)',
          }}
        >
          {severityLabel(severity)} ({findings.length})
        </span>
      </div>
      <ul
        style={{
          listStyle: 'none',
          margin: 0,
          padding: 0,
        }}
      >
        {findings.map((f) => (
          <FindingRow
            key={f.id}
            finding={f}
            status={ruleStatus[f.rule_id]}
            fixing={fixingRuleIds.has(f.rule_id)}
            onFixOne={onFixOne}
            onOpenInEditor={onOpenInEditor}
          />
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FindingRow — M3.3 重构:绿勾/红 x 状态图标 + 单条 Fix 按钮
//
// 状态机:
//   - 无 status 时:    显示空心圆 (尚未处理)
//   - status.applied:   绿勾 CheckCircle,Fix 按钮禁用
//   - status.error / status.applied=false: 红 x XCircle,Fix 按钮可重试
//   - manual rule:     永久红 x + "在 JSON 编辑器中打开" 链接(无 Fix 按钮)
//
// Fix 按钮只在 auto_apply rules 显示,且仅在 fixingRuleIds 包含 rule_id
// 时显示 "修复中..." 状态。
// ---------------------------------------------------------------------------

function FindingRow({
  finding,
  status,
  fixing,
  onFixOne,
  onOpenInEditor,
}: {
  finding: OptimizationFinding;
  status: ApplyResult | undefined;
  fixing: boolean;
  onFixOne: (ruleId: string) => void;
  onOpenInEditor: (path: string) => void;
}): ReactElement {
  // 状态判定
  const isApplied = status?.applied === true;
  const hasError = status !== undefined && !status.applied;
  // 一次性规则:successful apply 之后按钮永久禁用(re-scan 会清空)
  const isFixed = isApplied;
  const fixButtonDisabled = !finding.auto_apply || fixing || isFixed;

  return (
    <li
      data-testid={`optimizer-finding-${finding.id}`}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        padding: '10px 14px',
        borderTop: '1px solid var(--border)',
      }}
    >
      {/* M3.3 状态图标:绿勾 / 红 x / 空心圆 */}
      <div
        data-testid={`optimizer-status-${finding.id}`}
        style={{
          marginTop: 2,
          width: 18,
          height: 18,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        {isApplied ? (
          <CheckCircle2
            size={16}
            color="var(--success)"
            aria-label="已修复"
            data-status="applied"
          />
        ) : hasError ? (
          <XCircle
            size={16}
            color="var(--danger)"
            aria-label="修复失败"
            data-status="error"
          />
        ) : !finding.auto_apply ? (
          <XCircle
            size={16}
            color="var(--text-muted)"
            aria-label="需手动处理"
            data-status="manual"
          />
        ) : (
          <AlertCircle
            size={16}
            color="var(--text-muted)"
            aria-label="待修复"
            data-status="pending"
          />
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--text-primary)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          <span>{finding.title}</span>
          {finding.auto_apply ? (
            <span
              style={{
                fontSize: 11,
                padding: '1px 6px',
                borderRadius: 'var(--radius-sm)',
                background: 'rgba(56, 142, 60, 0.12)',
                color: 'var(--success)',
              }}
            >
              可自动修复
            </span>
          ) : (
            <span
              style={{
                fontSize: 11,
                padding: '1px 6px',
                borderRadius: 'var(--radius-sm)',
                background: 'rgba(0,0,0,0.05)',
                color: 'var(--text-muted)',
              }}
            >
              需手动处理
            </span>
          )}
        </div>
        <div
          style={{
            fontSize: 12,
            color: 'var(--text-secondary)',
            marginTop: 4,
            wordBreak: 'break-word',
          }}
        >
          {finding.description}
        </div>
        <div
          style={{
            fontSize: 11,
            color: 'var(--text-muted)',
            marginTop: 4,
            fontFamily: 'var(--font-mono, monospace)',
          }}
        >
          {finding.affected_path}
        </div>
        {finding.suggested_action && (
          <div
            style={{
              fontSize: 12,
              color: 'var(--text-secondary)',
              marginTop: 4,
              fontStyle: 'italic',
            }}
          >
            建议: {finding.suggested_action}
          </div>
        )}
        {/* 错误信息(从 ApplyResult.error 透出) */}
        {hasError && status?.error && (
          <div
            data-testid={`optimizer-error-msg-${finding.id}`}
            style={{
              fontSize: 12,
              color: 'var(--danger)',
              marginTop: 6,
            }}
          >
            {status.error}
          </div>
        )}
        {/* 备份路径(成功时展示) */}
        {isApplied && status?.backup_path && (
          <div
            data-testid={`optimizer-backup-${finding.id}`}
            style={{
              fontSize: 11,
              color: 'var(--text-muted)',
              marginTop: 4,
              fontFamily: 'var(--font-mono, monospace)',
              wordBreak: 'break-all',
            }}
          >
            备份: {status.backup_path}
          </div>
        )}
        {/* 操作行:Fix 按钮(auto rule) 或 在 JSON 编辑器中打开(manual rule) */}
        <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          {finding.auto_apply && (
            <button
              type="button"
              data-testid={`optimizer-fix-btn-${finding.id}`}
              onClick={() => onFixOne(finding.rule_id)}
              disabled={fixButtonDisabled}
              aria-label={
                isFixed ? `${finding.title} 已修复` : `修复 ${finding.title}`
              }
              style={{
                padding: '4px 12px',
                fontSize: 12,
                border: '1px solid var(--accent)',
                borderRadius: 'var(--radius-button)',
                background: isFixed ? 'rgba(0,0,0,0.04)' : 'var(--accent)',
                color: isFixed ? 'var(--text-muted)' : '#fff',
                cursor: fixButtonDisabled ? 'not-allowed' : 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                fontFamily: 'inherit',
                opacity: fixing ? 0.6 : 1,
              }}
            >
              {fixing ? (
                <>
                  <RefreshCw size={12} aria-hidden="true" />
                  修复中...
                </>
              ) : isFixed ? (
                <>
                  <CheckCircle2 size={12} aria-hidden="true" />
                  已修复
                </>
              ) : (
                <>
                  <Wand2 size={12} aria-hidden="true" />
                  Fix
                </>
              )}
            </button>
          )}
          {/* M5 #28 — manual rule 跳转 JSON editor */}
          {!finding.auto_apply && (
            <button
              type="button"
              data-testid={`optimizer-open-json-editor-${finding.id}`}
              style={{
                padding: '4px 10px',
                fontSize: 12,
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-button)',
                background: 'var(--bg-elevated)',
                color: 'var(--accent)',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                fontFamily: 'inherit',
              }}
              onClick={() => onOpenInEditor(finding.affected_path)}
            >
              <ExternalLink size={12} aria-hidden="true" />
              在 JSON 编辑器中打开
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// ApplyResultsPanel
// ---------------------------------------------------------------------------

function ApplyResultsPanel({
  results,
}: {
  results: ApplyResult[];
}): ReactElement {
  const ok = results.filter((r) => r.applied).length;
  const fail = results.length - ok;
  return (
    <div
      data-testid="optimizer-apply-results"
      style={{
        background: 'var(--bg-elevated)',
        borderRadius: 'var(--radius-card)',
        border: '1px solid var(--border)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '10px 14px',
          background: 'rgba(0,0,0,0.02)',
          borderBottom: '1px solid var(--border)',
          fontSize: 13,
          fontWeight: 600,
          color: 'var(--text-primary)',
        }}
      >
        应用结果: 成功 {ok} / 失败 {fail}
      </div>
      <ul
        style={{
          listStyle: 'none',
          margin: 0,
          padding: 0,
        }}
      >
        {results.map((r) => (
          <li
            key={r.finding_id}
            data-testid={`optimizer-result-${r.finding_id}`}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
              padding: '8px 14px',
              borderTop: '1px solid var(--border)',
              fontSize: 12,
            }}
          >
            {r.applied ? (
              <CheckCircle2
                size={14}
                color="var(--success)"
                style={{ flexShrink: 0, marginTop: 2 }}
              />
            ) : (
              <AlertCircle
                size={14}
                color="var(--danger)"
                style={{ flexShrink: 0, marginTop: 2 }}
              />
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  color: r.applied ? 'var(--success)' : 'var(--danger)',
                  fontWeight: 600,
                }}
              >
                {r.applied ? '已应用' : '未应用'}: {r.finding_id.slice(0, 8)}
              </div>
              {r.error && (
                <div style={{ color: 'var(--text-secondary)', marginTop: 2 }}>
                  {r.error}
                </div>
              )}
              {r.backup_path && (
                <div
                  style={{
                    color: 'var(--text-muted)',
                    marginTop: 2,
                    fontFamily: 'var(--font-mono, monospace)',
                    wordBreak: 'break-all',
                  }}
                >
                  备份: {r.backup_path}
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
