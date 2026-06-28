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

  it('默认无 data-theme 时 accent = 空 (v3.0 L1+L2 重构后 :where(:root) 不再含 --accent,需 data-theme 显式激活)', () => {
    // v3.0 主题重构后 --accent / --bg-* 等主题相关 token 只在 [data-theme="..."]
    // 块里定义,:where(:root) 只放跨主题共享的 token (--blur-*, --modal-*,
    // --space-* 等)。无 data-theme 时 getComputedVar('--accent') 返回空,
    // 因为没有任何 [data-theme="..."] 规则匹配 <html>。App 启动时 ThemeProvider
    // 会注入 data-theme 属性 (默认 light) 让 accent 生效 — 这个测试只锁住
    // L1+L2 重构后的"未注入主题时 token 不应随便回落到具体色"行为。
    injectTokensOnce();
    document.documentElement.removeAttribute('data-theme');
    expect(getComputedVar('--accent')).toBe('');
  });

  it('[data-theme="light"] accent = #0969DA', () => {
    injectTokensOnce();
    document.documentElement.dataset.theme = 'light';
    expect(getComputedVar('--accent')).toBe('#0969DA');
  });

  it('light 主题圆角: 卡片 8px / 按钮 6px / 弹窗 12px (v3.0 L2.1 light 主题)', () => {
    // SPEC §5.8 旧版要求按钮 4px,v3.0 light 主题改为 6px
    // (Linear/Vercel 风卡片 / 按钮区分更明显,见 design-system
    // commit 0742870 5-theme 切换 + 后续 Linear/Vercel 风调整)。
    // light / liquid-glass / dark / editorial / pixel 5 主题各有自己的
    // --card-radius / --button-radius (tokens.css L2.1-L2.5)。
    injectTokensOnce();
    document.documentElement.dataset.theme = 'light';
    expect(getComputedVar('--card-radius')).toBe('8px');
    expect(getComputedVar('--button-radius')).toBe('6px');
    expect(getComputedVar('--radius-modal')).toBe('12px');
  });
});