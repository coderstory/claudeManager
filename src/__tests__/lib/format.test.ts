/**
 * formatChineseTokenCount — TDD coverage (M4.7 增; UI-A-03 调整 2026-06-27).
 *
 * 业务需求 (UI-A-03):
 *   - 当 `已用 TOKENS` < 10,000 时,保持原生千分位逗号 (e.g. "1,234")。
 *   - 10,000 ~ 99,999,999 (1 万 ~ 1 亿 - 1) → "X.Y 万",Y 保留 1 位小数
 *     (e.g. 10000 → "1.0万",12345 → "1.2万")。
 *   - >= 100,000,000 → "X 亿 Y 万",Y 同样保留 1 位小数。
 *   - 0 → "0"(不渲染空白)。
 *
 * 关键修复 (UI-A-03):
 *   - 旧: 10000 → "9,999"(千分位) ❌ 与 SPEC §5.7 用量展示 "1.0万" 偏离。
 *   - 新: 10000 → "1.0万" ✅,12345 → "1.2万" ✅,9999 → "9,999" (千分位仍保留 < 10,000)。
 *
 * 设计取舍:
 *   - §3.1 of CLAUDE.md 把纯函数放 src/lib/,放 __tests__/lib/ 对位覆盖。
 *   - 不依赖 React/jsdom,直接调函数即可 — 跑得快、定位准。
 */
import { describe, it, expect } from 'vitest';
import { formatChineseTokenCount } from '../../lib/format';

describe('formatChineseTokenCount — UI-A-03 边界', () => {
  it('returns "0" for 0', () => {
    expect(formatChineseTokenCount(0)).toBe('0');
  });

  it('returns raw value for small integers (< 1000)', () => {
    expect(formatChineseTokenCount(1)).toBe('1');
    expect(formatChineseTokenCount(999)).toBe('999');
  });

  it('uses locale string for values in [1000, 9999] (千分位)', () => {
    expect(formatChineseTokenCount(1_000)).toBe('1,000');
    expect(formatChineseTokenCount(1_234)).toBe('1,234');
    expect(formatChineseTokenCount(9_999)).toBe('9,999');
  });

  // UI-A-03 修复要点: 之前 10000 → "10,000",现在 → "1.0万"
  it('formats 10000 exactly as "1.0万" (UI-A-03)', () => {
    expect(formatChineseTokenCount(10_000)).toBe('1.0万');
  });

  // UI-A-03 修复要点: 之前 12345 → "12,345",现在 → "1.2万"
  it('formats 12345 as "1.2万" (UI-A-03)', () => {
    expect(formatChineseTokenCount(12_345)).toBe('1.2万');
  });

  it('formats values in [10,000, 100,000,000) as "X.Y 万" with 1 decimal', () => {
    expect(formatChineseTokenCount(10_001)).toBe('1.0万');
    expect(formatChineseTokenCount(15_000)).toBe('1.5万');
    expect(formatChineseTokenCount(99_999)).toBe('10.0万');
    expect(formatChineseTokenCount(1_000_000)).toBe('100.0万');
    expect(formatChineseTokenCount(9_999_999)).toBe('1000.0万');
    expect(formatChineseTokenCount(50_000_000)).toBe('5000.0万');
    expect(formatChineseTokenCount(99_999_999)).toBe('10000.0万');
  });

  it('formats 100,000,000 exactly as "1 亿 0.0万"', () => {
    expect(formatChineseTokenCount(100_000_000)).toBe('1 亿 0.0万');
  });

  it('formats values >= 100M as "X 亿 Y.Y万"', () => {
    expect(formatChineseTokenCount(123_000_000)).toBe('1 亿 2300.0万');
    expect(formatChineseTokenCount(234_567_890)).toBe('2 亿 3456.8万');
    expect(formatChineseTokenCount(1_234_567_890)).toBe('12 亿 3456.8万');
  });

  it('handles non-finite and negative inputs as fallback', () => {
    expect(formatChineseTokenCount(Number.NaN)).toBe('0');
    expect(formatChineseTokenCount(Number.POSITIVE_INFINITY)).toBe('0');
    // Negative values are not realistic in usage, but guard against them.
    expect(formatChineseTokenCount(-100)).toBe('-100');
  });
});