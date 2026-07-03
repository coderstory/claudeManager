import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const tokensCss = readFileSync('src/design-system/tokens.css', 'utf-8');

describe('L1 系统基线', () => {
  it('用 :where(:root) 零特异性', () => {
    expect(tokensCss).toMatch(/:where\(:root\)/);
  });

  it('定义 spacing 4-48 (7 个 token)', () => {
    for (const s of ['--space-1', '--space-2', '--space-3', '--space-4', '--space-6', '--space-8', '--space-12']) {
      expect(tokensCss, `缺 ${s}`).toMatch(new RegExp(`${s}:\\s*\\d+px`));
    }
  });

  it('定义 radius-sm 和 radius-xs', () => {
    expect(tokensCss).toMatch(/--radius-sm:/);
    expect(tokensCss).toMatch(/--radius-xs:/);
  });
});

describe('L2 3 主题调色板', () => {
  const themes = ['light', 'liquid-glass', 'editorial'];

  for (const t of themes) {
    it(`${t} 主题块存在`, () => {
      expect(tokensCss).toMatch(new RegExp(`\\[data-theme="${t}"\\]`));
    });

    it(`${t} 定义核心 token`, () => {
      const re = new RegExp(`\\[data-theme="${t}"\\]\\s*\\{([^}]+)\\}`);
      const m = tokensCss.match(re);
      expect(m, `${t} 主题块未找到`).toBeTruthy();
      const block = m![1];
      expect(block).toMatch(/--accent:/);
      expect(block).toMatch(/--bg-primary:/);
      expect(block).toMatch(/--text-primary:/);
      expect(block).toMatch(/--font-ui:/);
    });

    it(`${t} 定义 4 个状态色`, () => {
      const re = new RegExp(`\\[data-theme="${t}"\\]\\s*\\{([^}]+)\\}`);
      const m = tokensCss.match(re);
      const block = m![1];
      for (const s of ['success', 'warning', 'danger', 'info']) {
        expect(block, `${t} 缺 --${s}`).toMatch(new RegExp(`--${s}:`));
      }
    });
  }

  it('禁止 :root, [data-theme] 合并 (light 除外用 :where(:root))', () => {
    // 不允许 :root, [data-theme="liquid-glass"] 这种合并
    expect(tokensCss).not.toMatch(/:root,\s*\[data-theme="(liquid-glass|editorial)"\]/);
  });

  it('3 主题 accent 至少 3 种不同色', () => {
    const accents = new Set<string>();
    for (const t of themes) {
      const re = new RegExp(`\\[data-theme="${t}"\\][\\s\\S]*?--accent:\\s*([^;]+);`);
      const m = tokensCss.match(re);
      if (m) accents.add(m[1].trim());
    }
    expect(accents.size).toBeGreaterThanOrEqual(3);
  });
});
