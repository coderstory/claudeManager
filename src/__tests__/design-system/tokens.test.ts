import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// ---------------------------------------------------------------------------
// v3.0 Task 5 — tokens.css 主题切换单元测试
//
// 测的不是"被 import 的 CSS"而是"作为字符串注入到 DOM 后的 CSS"——
// vitest 默认不内置 CSS transform,而 jsdom 又不解析 <link rel=stylesheet>,
// 所以最可靠的姿势是把 tokens.css 读出来塞进 <style>,这样 getComputedStyle
// 在 jsdom 里就能正确返回自定义属性的值。
//
// 注入只在第一个 test 之前做一次;之后通过切换 document.documentElement 的
// data-theme 属性验证每个主题档下的关键 token 值。
// ---------------------------------------------------------------------------

const TOKENS_CSS_PATH = resolve(__dirname, '../../design-system/tokens.css');

function injectTokensOnce(): void {
  if (document.getElementById('__tokens_css_injected__')) return;
  const css = readFileSync(TOKENS_CSS_PATH, 'utf-8');
  const style = document.createElement('style');
  style.id = '__tokens_css_injected__';
  style.textContent = css;
  document.head.appendChild(style);
}

function getComputedVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

describe('tokens.css theme switching (v3.0 Task 5)', () => {
  afterEach(() => {
    // 清掉 data-theme,避免污染后续 test
    document.documentElement.removeAttribute('data-theme');
  });

  it('默认无 data-theme 时 accent = #0969DA (light 继承自 :root)', () => {
    injectTokensOnce();
    document.documentElement.removeAttribute('data-theme');
    expect(getComputedVar('--accent')).toBe('#0969DA');
  });

  it('[data-theme="light"] accent = #0969DA', () => {
    injectTokensOnce();
    document.documentElement.dataset.theme = 'light';
    expect(getComputedVar('--accent')).toBe('#0969DA');
  });

  it('[data-theme="anime"] accent = #06B6D4', () => {
    injectTokensOnce();
    document.documentElement.dataset.theme = 'anime';
    expect(getComputedVar('--accent')).toBe('#06B6D4');
  });

  it('[data-theme="anime"] card-border-width = 3px (spec §4.8 厚描边)', () => {
    injectTokensOnce();
    document.documentElement.dataset.theme = 'anime';
    expect(getComputedVar('--card-border-width')).toBe('3px');
  });

  it('light 主题圆角: 卡片 8px / 按钮 4px / 弹窗 12px (SPEC §5.8)', () => {
    injectTokensOnce();
    document.documentElement.dataset.theme = 'light';
    expect(getComputedVar('--card-radius')).toBe('8px');
    expect(getComputedVar('--button-radius')).toBe('4px');
    expect(getComputedVar('--radius-modal')).toBe('12px');
  });
});