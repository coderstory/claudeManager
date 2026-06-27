import { describe, it, expect } from 'vitest';
import { THEME_IDS, type ThemeIdValue } from '../../design-system/themes/themeIds';

describe('THEME_IDS 常量', () => {
  it('导出 5 个主题 id', () => {
    expect(Object.keys(THEME_IDS)).toHaveLength(5);
    expect(THEME_IDS.Light).toBe('light');
    expect(THEME_IDS.LiquidGlass).toBe('liquid-glass');
    expect(THEME_IDS.Dark).toBe('dark');
    expect(THEME_IDS.Editorial).toBe('editorial');
    expect(THEME_IDS.Pixel).toBe('pixel');
  });

  it('ThemeIdValue 类型覆盖 5 个值', () => {
    const ids: ThemeIdValue[] = ['light', 'liquid-glass', 'dark', 'editorial', 'pixel'];
    expect(ids).toHaveLength(5);
  });

  it('id 字符串无空格无大写', () => {
    for (const id of Object.values(THEME_IDS)) {
      expect(id).toMatch(/^[a-z-]+$/);
    }
  });
});
