/**
 * Number / unit formatters (M4.7 增 — F7 用量大数字本地化).
 *
 * 业务需求:
 *   - Claude Code 真实场景:长时间使用的用户,total tokens 经常破亿。
 *   - 原始 `123_456_789.toLocaleString()` 渲染成 "123,456,789" — 一眼看不出量级。
 *   - 用 "X 亿 Y 千万 / X 万" 这种中文大数表示更适合国内用户阅读。
 *
 * 设计取舍:
 *   - 选用 万 / 亿 两档(国内通用)。再细分 千万 / 百万 / 千 不增加信息密度,反而割裂阅读。
 *   - < 1000 万 → 保持 `toLocaleString('en-US')` (千分位逗号),例如 "1,234,567"。
 *   - 1000 万 ~ 1 亿 → "X 万",X 不加千分位(读起来更顺;万级数字最多 5 位,千分位
 *     反而割裂阅读)。
 *   - >= 1 亿 → "X 亿 Y 万",X 和 Y 都不加千分位(保持紧凑可读;万位最多 4 位,
 *     千分位对中文大数阅读没有帮助)。
 *   - 0 → "0"(不渲染空字符串,避免 UI 空白)。
 *   - 负数 / NaN → 直接回退 `toLocaleString('en-US')`(理论上不会发生,但兜底)。
 *
 * 后续扩展:
 *   - 体积/字节(`formatSize`)目前放在 `resource-browser/index.tsx` 局部 — 不在此处重复定义,
 *     避免 import 循环。
 */

/**
 * 把 token 数(整数)格式化为中文大数表示。
 *
 * @example
 *   formatChineseTokenCount(0)                  // "0"
 *   formatChineseTokenCount(1_000_000)          // "1,000,000"
 *   formatChineseTokenCount(50_000_000)         // "5000 万"
 *   formatChineseTokenCount(99_999_999)         // "9999 万"
 *   formatChineseTokenCount(100_000_000)        // "1 亿 0 万"
 *   formatChineseTokenCount(123_000_000)        // "1 亿 2300 万"
 *   formatChineseTokenCount(1_234_567_890)      // "12 亿 3456 万"
 */
export function formatChineseTokenCount(n: number): string {
  if (!Number.isFinite(n)) return '0';
  if (n < 0) return n.toLocaleString('en-US');
  if (n < 10_000_000) {
    return n.toLocaleString('en-US');
  }
  if (n < 100_000_000) {
    const wan = Math.floor(n / 10_000);
    return `${wan} 万`;
  }
  const yi = Math.floor(n / 100_000_000);
  const remainder = n - yi * 100_000_000;
  const wan = Math.floor(remainder / 10_000);
  return `${yi} 亿 ${wan} 万`;
}
