/**
 * formatChineseTokenCount — TDD coverage (M4.7 增).
 *
 * 业务需求:
 *   - 当 `已用 TOKENS` 超过 1 亿(100,000,000)时,以 "X 亿 Y 万" 形式渲染。
 *   - 1000 万 ~ 1 亿 → "X 万"。
 *   - 小于 1000 万 → 原生千分位逗号。
 *   - 0 → "0"(不渲染空白)。
 *
 * 设计取舍:
 *   - §3.1 of CLAUDE.md 把纯函数放 src/lib/,放 __tests__/lib/ 对位覆盖。
 *   - 不依赖 React/jsdom,直接调函数即可 — 跑得快、定位准。
 */
import { describe, it, expect } from 'vitest';
import { formatChineseTokenCount } from '../../lib/format';

describe('formatChineseTokenCount', () => {
  it('returns "0" for 0', () => {
    expect(formatChineseTokenCount(0)).toBe('0');
  });

  it('uses raw locale string for values under 10,000,000 (1 千万)', () => {
    expect(formatChineseTokenCount(1)).toBe('1');
    expect(formatChineseTokenCount(1_234)).toBe('1,234');
    expect(formatChineseTokenCount(1_000_000)).toBe('1,000,000');
    expect(formatChineseTokenCount(9_999_999)).toBe('9,999,999');
  });

  it('formats values in [10M, 100M) as "X 万"', () => {
    expect(formatChineseTokenCount(10_000_000)).toBe('1000 万');
    expect(formatChineseTokenCount(50_000_000)).toBe('5000 万');
    expect(formatChineseTokenCount(99_999_999)).toBe('9999 万');
  });

  it('formats 100M exactly as "1 亿 0 万"', () => {
    expect(formatChineseTokenCount(100_000_000)).toBe('1 亿 0 万');
  });

  it('formats values >= 100M as "X 亿 Y 万"', () => {
    expect(formatChineseTokenCount(123_000_000)).toBe('1 亿 2300 万');
    expect(formatChineseTokenCount(234_567_890)).toBe('2 亿 3456 万');
    expect(formatChineseTokenCount(1_234_567_890)).toBe('12 亿 3456 万');
  });

  it('handles non-finite and negative inputs as fallback', () => {
    expect(formatChineseTokenCount(Number.NaN)).toBe('0');
    expect(formatChineseTokenCount(Number.POSITIVE_INFINITY)).toBe('0');
    // Negative values are not realistic in usage, but guard against them.
    expect(formatChineseTokenCount(-100)).toBe('-100');
  });
});
