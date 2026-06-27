import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';

describe('字体本地化', () => {
  const fontsDir = 'src/design-system/fonts';

  it('4 个 woff2 文件全部存在', () => {
    for (const f of ['PressStart2P.woff2', 'ZCOOLKuaiLe.woff2', 'Inter-400.woff2', 'JetBrainsMono-400.woff2']) {
      expect(existsSync(`${fontsDir}/${f}`), `${f} 不存在`).toBe(true);
    }
  });

  it('fonts.css 不引用任何外网字体', () => {
    const css = readFileSync('src/design-system/fonts.css', 'utf-8');
    expect(css).not.toMatch(/fonts\.googleapis\.com/);
    expect(css).not.toMatch(/fonts\.gstatic\.com/);
  });

  it('fonts.css 声明 4 个本地字体', () => {
    const css = readFileSync('src/design-system/fonts.css', 'utf-8');
    expect(css).toMatch(/Press Start 2P/);
    expect(css).toMatch(/ZCOOL KuaiLe/);
    expect(css).toMatch(/Inter/);
    expect(css).toMatch(/JetBrains Mono/);
  });

  it('4 个 woff2 文件大小 > 1KB', () => {
    for (const f of ['PressStart2P.woff2', 'ZCOOLKuaiLe.woff2', 'Inter-400.woff2', 'JetBrainsMono-400.woff2']) {
      const stat = require('node:fs').statSync(`${fontsDir}/${f}`);
      expect(stat.size).toBeGreaterThan(1024);
    }
  });
});
