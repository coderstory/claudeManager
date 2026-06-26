// theme.test.mjs — 5 主题 token 完整性 + 隔离性单元测试
// 用 vitest 在 Node 环境跑 (jsdom)
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DEMO_DIR = '/Users/coderstory/CodeSource/winui3/docs/superpowers/specs/2026-06-26-ui-redesign/demo';
const THEMES = ['light', 'liquid-glass', 'dark', 'editorial', 'pixel'];

describe('5 主题架构完整性', () => {
  it('5 主题 css 文件全部存在', () => {
    for (const t of THEMES) {
      const p = join(DEMO_DIR, `theme-${t}.css`);
      expect(existsSync(p), `theme-${t}.css 不存在`).toBe(true);
    }
  });

  it('5 主题都有 [data-theme="x"] 块', () => {
    for (const t of THEMES) {
      const css = readFileSync(join(DEMO_DIR, `theme-${t}.css`), 'utf-8');
      expect(css, `${t} 缺少 [data-theme="${t}"]`).toMatch(new RegExp(`\\[data-theme="${t}"\\]`));
    }
  });

  it('5 主题都定义了核心 L2 token (--accent / --bg-primary / --text-primary)', () => {
    for (const t of THEMES) {
      const css = readFileSync(join(DEMO_DIR, `theme-${t}.css`), 'utf-8');
      expect(css, `${t} 缺 --accent`).toMatch(/--accent:/);
      expect(css, `${t} 缺 --bg-primary`).toMatch(/--bg-primary:/);
      expect(css, `${t} 缺 --text-primary`).toMatch(/--text-primary:/);
      expect(css, `${t} 缺 --font-ui`).toMatch(/--font-ui:/);
    }
  });

  it('5 主题都定义了状态色 4 个 (success/warning/danger/info)', () => {
    for (const t of THEMES) {
      const css = readFileSync(join(DEMO_DIR, `theme-${t}.css`), 'utf-8');
      for (const status of ['success', 'warning', 'danger', 'info']) {
        expect(css, `${t} 缺 --${status}`).toMatch(new RegExp(`--${status}:`));
      }
    }
  });
});

describe('主题隔离性 (约束 4 + 7)', () => {
  it('禁止 :root, [data-theme="x"] 合并选择器', () => {
    for (const t of THEMES) {
      const css = readFileSync(join(DEMO_DIR, `theme-${t}.css`), 'utf-8');
      // light 例外: 它是默认主题, 可以用 :root, [data-theme="light"] 让默认状态下生效
      if (t === 'light') continue;
      expect(css, `${t} 用了 :root, [data-theme="..."] 合并`).not.toMatch(/:root,\s*\[data-theme/);
    }
  });

  it('主题 css 不应跨主题定义 (避免切换时叠加)', () => {
    for (const t of THEMES) {
      const css = readFileSync(join(DEMO_DIR, `theme-${t}.css`), 'utf-8');
      for (const other of THEMES) {
        if (other === t) continue;
        // 不允许出现 [data-theme="other"]
        expect(css, `${t} 引用了 ${other}`).not.toMatch(new RegExp(`\\[data-theme="${other}"\\]`));
      }
    }
  });

  it('5 主题 accent 色值不同 (确保主题差异化)', () => {
    const accents = new Map();
    for (const t of THEMES) {
      const css = readFileSync(join(DEMO_DIR, `theme-${t}.css`), 'utf-8');
      const m = css.match(/--accent:\s*([^;]+);/);
      expect(m, `${t} 缺 --accent`).toBeTruthy();
      accents.set(t, m[1].trim());
    }
    // 至少 3 个不同色值
    expect(new Set(accents.values()).size, `5 主题 accent 应该有差异, 实际: ${JSON.stringify(accents)}`).toBeGreaterThanOrEqual(3);
  });
});

describe('L1 系统基线', () => {
  const tokensCss = readFileSync(join(DEMO_DIR, 'tokens.css'), 'utf-8');

  it('tokens.css 用 :where(:root) 零特异性', () => {
    expect(tokensCss).toMatch(/:where\(:root\)/);
  });

  it('L1 定义了 spacing 4-48 (7 个 token)', () => {
    for (const s of ['--space-1', '--space-2', '--space-3', '--space-4', '--space-6', '--space-8', '--space-12']) {
      expect(tokensCss, `缺 ${s}`).toMatch(new RegExp(`${s}:\\s*\\d+px`));
    }
  });

  it('L1 定义了 radius-sm 和 radius-xs', () => {
    expect(tokensCss).toMatch(/--radius-sm:/);
    expect(tokensCss).toMatch(/--radius-xs:/);
  });
});

describe('macOS 按钮适配', () => {
  it('app.css 定义红黄绿 3 色基础', () => {
    const css = readFileSync(join(DEMO_DIR, 'app.css'), 'utf-8');
    expect(css).toMatch(/\.wc-btn\.close.*#FF5F57/s);
    expect(css).toMatch(/\.wc-btn\.min.*#FEBC2E/s);
    expect(css).toMatch(/\.wc-btn\.max.*#28C840/s);
  });

  it('按钮是圆形 (border-radius: 50%)', () => {
    const css = readFileSync(join(DEMO_DIR, 'app.css'), 'utf-8');
    expect(css).toMatch(/\.wc-btn\s*\{[^}]*border-radius:\s*50%/s);
  });

  it('dark 主题适配: 加发光', () => {
    const css = readFileSync(join(DEMO_DIR, 'theme-dark.css'), 'utf-8');
    expect(css).toMatch(/\.wc-btn.*box-shadow/s);
  });

  it('editorial 主题适配: 黑白灰', () => {
    const css = readFileSync(join(DEMO_DIR, 'theme-editorial.css'), 'utf-8');
    expect(css).toMatch(/\.wc-btn\.close.*#FFFFFF/s);
    expect(css).toMatch(/\.wc-btn\.max.*#000000/s);
  });
});

describe('字体本地化', () => {
  it('fonts.css 定义 4 个本地字体 (无外网依赖)', () => {
    const css = readFileSync(join(DEMO_DIR, 'fonts.css'), 'utf-8');
    for (const f of ['Press Start 2P', 'ZCOOL KuaiLe', 'Inter', 'JetBrains Mono']) {
      expect(css, `缺 ${f}`).toContain(f);
    }
    expect(css).not.toMatch(/fonts\.googleapis\.com/);
    expect(css).not.toMatch(/fonts\.gstatic\.com/);
  });

  it('fonts/ 目录有 4 个 woff2', () => {
    const files = readdirSync(join(DEMO_DIR, 'fonts'));
    const woffs = files.filter(f => f.endsWith('.woff2'));
    expect(woffs.length).toBe(4);
    for (const expected of ['PressStart2P', 'ZCOOLKuaiLe', 'Inter', 'JetBrainsMono']) {
      expect(woffs.some(f => f.startsWith(expected)), `缺 ${expected}`).toBe(true);
    }
  });
});

describe('index.html 5 主题按钮', () => {
  const html = readFileSync(join(DEMO_DIR, 'index.html'), 'utf-8');

  it('5 主题按钮都在 topbar', () => {
    for (const t of THEMES) {
      expect(html, `缺 ${t} 按钮`).toContain(`data-theme="${t}"`);
    }
  });

  it('macOS 窗口按钮 (close/min/max) 在 topbar-left', () => {
    expect(html).toContain('wc-btn close');
    expect(html).toContain('wc-btn min');
    expect(html).toContain('wc-btn max');
  });

  it('没有引用 Google Fonts 外网', () => {
    expect(html).not.toMatch(/fonts\.googleapis\.com/);
    expect(html).not.toMatch(/fonts\.gstatic\.com/);
  });
});

describe('app.js THEME_NAMES 字典与 CSS 一致', () => {
  const appJs = readFileSync(join(DEMO_DIR, 'app.js'), 'utf-8');
  const indexHtml = readFileSync(join(DEMO_DIR, 'index.html'), 'utf-8');

  for (const t of THEMES) {
    it(`${t} 在 app.js 字典中`, () => {
      expect(appJs).toContain(`'${t}'`);
    });
    it(`${t} 在 index.html 按钮中`, () => {
      expect(indexHtml).toContain(`data-theme="${t}"`);
    });
  }
});