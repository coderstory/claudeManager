import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// ---------------------------------------------------------------------------
// v3.0 主题重构 bug fix — 向后兼容别名测试
//
// 复用 tokens.test.ts 的注入姿势 (readFileSync + <style>) , 因为
// vitest 默认不内置 CSS transform 而 jsdom 不解析 <link rel=stylesheet>。
//
// ⚠️ JSDOM 限制: jsdom 的 getComputedStyle 不递归解析 var() 引用, 只会
// 返回字面量 "var(--xxx)". 真实浏览器 (WebView2) 会递归解析到最终值.
// 本测试因此断言"别名指向正确的源 token 名字", 而非最终像素值.
// 这仍能捕获原 bug (--radius-card 缺失会返回空字符串) + 抓出指向错误的别名.
// ---------------------------------------------------------------------------

const TOKENS_CSS_PATH = resolve(__dirname, '../../design-system/tokens.css');

function injectTokensOnce(): void {
  if (document.getElementById('__tokens_css_injected_aliases__')) return;
  const css = readFileSync(TOKENS_CSS_PATH, 'utf-8');
  const style = document.createElement('style');
  style.id = '__tokens_css_injected_aliases__';
  style.textContent = css;
  document.head.appendChild(style);
}

function getComputedVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

describe('CSS variable aliases (backward compat — v3.0 bug fix)', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('data-theme');
  });

  it('light 主题: --radius-card 别名指向 --card-radius', () => {
    injectTokensOnce();
    document.documentElement.dataset.theme = 'light';
    expect(getComputedVar('--radius-card')).toBe('var(--card-radius)');
    // 源 token 必须存在并是 8px (用 JSDOM 间接验证: --card-radius 自身就是字面量)
    expect(getComputedVar('--card-radius')).toBe('8px');
  });

  it('light 主题: --radius-button 别名指向 --button-radius', () => {
    injectTokensOnce();
    document.documentElement.dataset.theme = 'light';
    expect(getComputedVar('--radius-button')).toBe('var(--button-radius)');
    expect(getComputedVar('--button-radius')).toBe('4px');
  });

  it('light 主题: --radius-modal = 12px (字面量, 非 var 别名)', () => {
    injectTokensOnce();
    document.documentElement.dataset.theme = 'light';
    expect(getComputedVar('--radius-modal')).toBe('12px');
  });

  it('anime 主题: --radius-card 别名指向 --card-radius', () => {
    injectTokensOnce();
    document.documentElement.dataset.theme = 'anime';
    expect(getComputedVar('--radius-card')).toBe('var(--card-radius)');
    expect(getComputedVar('--card-radius')).toBe('20px');
  });

  it('anime 主题: --radius-button 别名指向 --button-radius', () => {
    injectTokensOnce();
    document.documentElement.dataset.theme = 'anime';
    expect(getComputedVar('--radius-button')).toBe('var(--button-radius)');
    expect(getComputedVar('--button-radius')).toBe('14px');
  });
});
