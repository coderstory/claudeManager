/**
 * Number / unit formatters (M4.7 增 — F7 用量大数字本地化).
 *
 * 业务需求:
 *   - Claude Code 真实场景:长时间使用的用户,total tokens 经常破亿。
 *   - 原始 `123_456_789.toLocaleString()` 渲染成 "123,456,789" — 一眼看不出量级。
 *   - 用 "X 亿 Y 万 / X 万" 这种中文大数表示更适合国内用户阅读。
 *
 * 设计取舍 (UI-A-03 调整, 2026-06-27):
 *   - < 10,000 → 原生千分位逗号 (e.g. "1,234", "9,999")。
 *   - 10,000 ~ 99,999,999 (1 万 ~ 1 亿 - 1) → "X.Y 万",Y 保留 1 位小数
 *     (e.g. 10000 → "1.0万",12345 → "1.2万",50_000_000 → "5000.0万")。
 *     不再用千分位,中文大数阅读更顺。
 *   - >= 100,000,000 (1 亿) → "X 亿 Y 万",X 整数,Y 保留 1 位小数
 *     (e.g. 100_000_000 → "1 亿 0.0万",234_567_890 → "2 亿 3456.8万")。
 *   - 0 → "0"(不渲染空字符串,避免 UI 空白)。
 *   - 负数 / NaN → 直接回退 `toLocaleString('en-US')`(理论上不会发生,但兜底)。
 *
 *   UI-A-03 修复要点:
 *     1. 之前 10_000_000 → "1000 万",与 SPEC "1.0万" 偏离。改阈值 10,000,
 *        10000 → "1.0万",12345 → "1.2万"(与 SPEC §5.7 用量展示对齐)。
 *     2. 之前 9999 → "9,999"(千分位) 仍保留 < 10,000 用千分位的语义。
 *     3. 边界 case 10000/10001/12345/99999999 等写测试。
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
 *   formatChineseTokenCount(999)                // "999"
 *   formatChineseTokenCount(1_000)              // "1,000"
 *   formatChineseTokenCount(9_999)              // "9,999"
 *   formatChineseTokenCount(10_000)             // "1.0万"
 *   formatChineseTokenCount(12_345)             // "1.2万"
 *   formatChineseTokenCount(50_000_000)         // "5000.0万"
 *   formatChineseTokenCount(100_000_000)        // "1 亿 0.0万"
 *   formatChineseTokenCount(123_000_000)        // "1 亿 2300.0万"
 *   formatChineseTokenCount(1_234_567_890)      // "12 亿 3456.8万"
 */
export function formatChineseTokenCount(n: number): string {
  if (!Number.isFinite(n)) return '0';
  if (n < 0) return n.toLocaleString('en-US');
  // < 10,000: 原生千分位 (e.g. 999 → "999", 1234 → "1,234", 9999 → "9,999")
  if (n < 10_000) {
    return n.toLocaleString('en-US');
  }
  // < 100,000,000 (1 亿): 用 "X.Y 万" 形式。Y 保留 1 位小数。
  if (n < 100_000_000) {
    const wan = n / 10_000;
    // 用 toFixed(1) 强制 1 位小数 (e.g. 10000 / 10000 = 1 → "1.0")
    return `${wan.toFixed(1)}万`;
  }
  // >= 1 亿: "X 亿 Y 万" (Y 保留 1 位小数)
  const yi = Math.floor(n / 100_000_000);
  const remainder = n - yi * 100_000_000;
  const wan = remainder / 10_000;
  return `${yi} 亿 ${wan.toFixed(1)}万`;
}