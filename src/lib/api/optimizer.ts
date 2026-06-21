/**
 * Frontend wrapper for the F18 配置优化 Tauri commands (M2.9).
 *
 * Mirrors the M2.5 / M2.6 / M2.7 wrapper pattern — pages must import
 * the helpers from here, NOT call `invoke('scan_optimizations', ...)`
 * directly.
 */
import { invoke } from '@tauri-apps/api/core';
import type { ApplyResult, OptimizationFinding } from '../../types/optimizer';

/** F18 — scan all configured files; returns every finding from every
 *  rule, sorted by severity (Error → Warning → Info). */
export function scanOptimizations(): Promise<OptimizationFinding[]> {
  return invoke<OptimizationFinding[]>('scan_optimizations');
}

/** F18 — apply the rules behind the requested findings, in order.
 *
 *  `findingIds` should come from a recent `scanOptimizations` response.
 *  Stale ids return an `ApplyResult { applied: false, error: "..." }`
 *  rather than failing the whole call. */
export function applyOptimizations(
  findingIds: string[],
): Promise<ApplyResult[]> {
  return invoke<ApplyResult[]>('apply_optimizations', { findingIds });
}

/**
 * F23 — 导出优化建议 markdown 报告（M2.16）。
 *
 * 后端全权处理:生成 markdown → 弹原生保存框 → 原子写盘。前端只发
 * 一个 invoke 拿最终路径（或 null 表示用户取消保存框）。同 F14
 * `exportProvider` 的分层模式——本仓库没装 `@tauri-apps/plugin-dialog`
 * / `@tauri-apps/plugin-fs` 的 JS wrapper（CLAUDE.md §2.3 依赖白名单),
 * 保存对话框必须走 Rust 侧的 `tauri-plugin-dialog`。
 *
 * @param findings     当前 scan 的全部 findings（已在前端 state 里)
 * @param applyResults 可选——若已应用过部分项,传入 ApplyResult 数组,
 *                     报告会加"应用状态"行 + 概览的"应用结果"统计。
 *                     未应用过传 null/省略,报告只列待处理项。
 * @param generatedAt  可选——报告头部的"生成时间"字符串。默认传
 *                     `new Date().toISOString()`;省略时后端用当前时间。
 * @returns 成功写盘 → 绝对路径字符串;用户在保存框取消 → `null`。
 *          失败时 invoke 会 reject,页面用 catch 展示红色 InfoBar。
 */
export function exportOptimizationReport(
  findings: OptimizationFinding[],
  applyResults: ApplyResult[] | null,
  generatedAt: string | null,
): Promise<string | null> {
  return invoke<string | null>('export_optimization_report', {
    findings,
    applyResults,
    generatedAt,
  });
}
