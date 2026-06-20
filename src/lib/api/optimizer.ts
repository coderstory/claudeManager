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
