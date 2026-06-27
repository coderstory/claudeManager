/**
 * 5 主题 id 常量集中管理 (CLAUDE.md §6.4 强制约束)
 * 组件代码禁止硬编码主题 id 字符串, 必须 import THEME_IDS.
 */
export const THEME_IDS = {
  Light: 'light',
  LiquidGlass: 'liquid-glass',
  Dark: 'dark',
  Editorial: 'editorial',
  Pixel: 'pixel',
} as const;

export type ThemeIdValue = typeof THEME_IDS[keyof typeof THEME_IDS];
