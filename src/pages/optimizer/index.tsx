/**
 * F18 — 配置优化 (M2.9 real implementation).
 *
 * User flow (per docs/design/M2.9-dataflow.md):
 *   1. User clicks the sidebar "配置优化" tile.
 *   2. Page mounts and calls `scanOptimizations` to fetch findings
 *      from all 13 rules.
 *   3. UI renders findings grouped by severity (Error → Warning →
 *      Info). Each finding has a checkbox; auto-apply findings are
 *      pre-checked, manual ones are not (but always selectable).
 *   4. User clicks [应用 N 项] → calls `applyOptimizations` with
 *      the checked finding IDs. Each ApplyResult is shown inline
 *      with green/red status + backup path.
 *   5. After apply, [重新扫描] re-runs scan to validate the fix.
 *
 * ## Design choices (CLAUDE.md §5 + SPEC §5.11)
 *
 * - **No grouping libraries** — plain `Array.filter` per severity.
 * - **Auto-apply findings default checked**, manual ones default
 *   unchecked (matches SPEC §6.7: "安全 = 默认勾选, 需确认 = 不勾选").
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
  Info,
  RefreshCw,
  ShieldAlert,
  Wand2,
} from 'lucide-react';

import { ErrorBanner } from '../../components/ErrorBanner';
import {
  applyOptimizations,
  exportOptimizationReport,
  scanOptimizations,
} from '../../lib/api/optimizer';
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

interface PageState {
  findings: OptimizationFinding[];
  selectedIds: Set<string>;
  loading: boolean;
  applying: boolean;
  scanError: string | null;
  applyError: string | null;
  applyResults: ApplyResult[] | null;
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
  selectedIds: new Set(),
  loading: true,
  applying: false,
  scanError: null,
  applyError: null,
  applyResults: null,
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

  const runScan = useCallback(async () => {
    setState((prev) => ({
      ...prev,
      loading: true,
      scanError: null,
      applyResults: null,
    }));
    try {
      const findings = await scanOptimizations();
      // Default-check the auto_apply ones.
      const checked = new Set(
        findings.filter((f) => f.auto_apply).map((f) => f.id),
      );
      setState((prev) => ({
        ...prev,
        findings,
        selectedIds: checked,
        loading: false,
        scanError: null,
        lastScanAt: Date.now(),
      }));
    } catch (err) {
      setState((prev) => ({
        ...prev,
        findings: [],
        selectedIds: new Set(),
        loading: false,
        scanError: err instanceof Error ? err.message : String(err),
      }));
    }
  }, []);

  // Initial scan on mount.
  useEffect(() => {
    void runScan();
  }, [runScan]);

  const handleToggle = useCallback((id: string) => {
    setState((prev) => {
      const next = new Set(prev.selectedIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { ...prev, selectedIds: next };
    });
  }, []);

  const handleApply = useCallback(async () => {
    const ids = Array.from(state.selectedIds);
    if (ids.length === 0) return;
    setState((prev) => ({ ...prev, applying: true, applyError: null }));
    try {
      const results = await applyOptimizations(ids);
      setState((prev) => ({
        ...prev,
        applying: false,
        applyResults: results,
        applyError: null,
      }));
    } catch (err) {
      setState((prev) => ({
        ...prev,
        applying: false,
        applyError: err instanceof Error ? err.message : String(err),
      }));
    }
  }, [state.selectedIds]);

  // F23 — 导出 markdown 报告。后端生成内容 + 弹保存框 + 写盘,
  // 前端只传当前 findings + applyResults（如有),拿回路径展示成功提示。
  // 用户在保存框取消 → 后端返回 null → 静默,不显示任何错误。
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
        state.applyResults,
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
  }, [state.findings, state.applyResults]);

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

  const selectedCount = state.selectedIds.size;
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
            扫描 ~/.claude/ 下的 settings.json + providers/ + mcp.json,识别 13 类常见问题。
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
              borderRadius: 4,
              border: '1px solid var(--border)',
              background: 'var(--bg-elevated)',
              color: 'var(--text-primary)',
              fontSize: 13,
              cursor: state.loading ? 'not-allowed' : 'pointer',
              opacity: state.loading ? 0.6 : 1,
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
              borderRadius: 4,
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
            borderRadius: 8,
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
            配置看起来很好,所有 13 个规则都已通过。
          </div>
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
                selectedIds={state.selectedIds}
                onToggle={handleToggle}
              />
            );
          })}
        </div>
      )}

      {/* Apply bar */}
      {totalCount > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '12px 16px',
            background: 'var(--bg-elevated)',
            borderRadius: 4,
            border: '1px solid var(--border)',
          }}
        >
          <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            已选 {selectedCount} / {totalCount} 项
          </div>
          <button
            type="button"
            data-testid="optimizer-apply-btn"
            onClick={() => {
              void handleApply();
            }}
            disabled={state.applying || selectedCount === 0}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 16px',
              borderRadius: 4,
              border: 'none',
              background:
                selectedCount === 0 ? 'var(--text-muted)' : 'var(--accent)',
              color: '#fff',
              fontSize: 13,
              cursor:
                state.applying || selectedCount === 0
                  ? 'not-allowed'
                  : 'pointer',
              opacity: state.applying ? 0.6 : 1,
            }}
          >
            <Wand2 size={14} />
            {state.applying ? '应用中...' : `应用 ${selectedCount} 项`}
          </button>
        </div>
      )}

      {/* 应用失败提示(F15 ErrorBanner kind=error) */}
      {state.applyError && (
        <ErrorBanner
          kind="error"
          testId="optimizer-apply-error"
          message={`应用失败: ${state.applyError}`}
        />
      )}

      {/* Apply results */}
      {state.applyResults && state.applyResults.length > 0 && (
        <ApplyResultsPanel results={state.applyResults} />
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
  selectedIds,
  onToggle,
}: {
  severity: Severity;
  findings: OptimizationFinding[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
}): ReactElement {
  const Icon = SEVERITY_ICONS[severity];
  const colour = severityColour(severity);
  return (
    <div
      data-testid={`optimizer-group-${severity}`}
      style={{
        background: 'var(--bg-elevated)',
        borderRadius: 8,
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
            selected={selectedIds.has(f.id)}
            onToggle={onToggle}
          />
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FindingRow
// ---------------------------------------------------------------------------

function FindingRow({
  finding,
  selected,
  onToggle,
}: {
  finding: OptimizationFinding;
  selected: boolean;
  onToggle: (id: string) => void;
}): ReactElement {
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
      <input
        type="checkbox"
        checked={selected}
        onChange={() => onToggle(finding.id)}
        style={{ marginTop: 3 }}
        data-testid={`optimizer-checkbox-${finding.id}`}
        aria-label={`选择 ${finding.title}`}
      />
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
                borderRadius: 3,
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
                borderRadius: 3,
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
        borderRadius: 8,
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
