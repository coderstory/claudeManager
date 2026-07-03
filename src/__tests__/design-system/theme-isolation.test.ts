import { describe, it, expect } from 'vitest';
import { THEME_IDS, type ThemeIdValue } from '../../design-system/themes/themeIds';

describe('THEME_IDS 常量', () => {
  it('导出 3 个主题 id', () => {
    expect(Object.keys(THEME_IDS)).toHaveLength(3);
    expect(THEME_IDS.Light).toBe('light');
    expect(THEME_IDS.LiquidGlass).toBe('liquid-glass');
    expect(THEME_IDS.Editorial).toBe('editorial');
  });

  it('ThemeIdValue 类型覆盖 3 个值', () => {
    const ids: ThemeIdValue[] = ['light', 'liquid-glass', 'editorial'];
    expect(ids).toHaveLength(3);
  });

  it('id 字符串无空格无大写', () => {
    for (const id of Object.values(THEME_IDS)) {
      expect(id).toMatch(/^[a-z-]+$/);
    }
  });
});
