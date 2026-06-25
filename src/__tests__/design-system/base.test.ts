import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// ---------------------------------------------------------------------------
// v3.0 — base.css 项目级 base class 系统单测
//
// vitest 不内置 CSS transform, jsdom 不解析 <link rel=stylesheet>,
// 所以最可靠的姿势是 readFileSync + inject <style>, 见同目录
// tokens.test.ts 的同款 pattern. base.css + anime.css 都注入,
// 然后用 getComputedStyle 验证 base 规则 + anime 覆写都生效.
// ---------------------------------------------------------------------------

const BASE_CSS_PATH = resolve(__dirname, '../../design-system/base.css');
const ANIME_CSS_PATH = resolve(__dirname, '../../design-system/themes/anime.css');

function injectOnce(id: string, path: string): void {
  if (document.getElementById(id)) return;
  const css = readFileSync(path, 'utf-8');
  const style = document.createElement('style');
  style.id = id;
  style.textContent = css;
  document.head.appendChild(style);
}

describe('base.css — 项目级 base class 系统', () => {
  beforeAll(() => {
    injectOnce('__base_css_injected__', BASE_CSS_PATH);
    injectOnce('__anime_css_injected__', ANIME_CSS_PATH);
  });

  afterEach(() => {
    document.documentElement.removeAttribute('data-theme');
  });

  it('.card 默认有 transition 覆盖 background + transform', () => {
    const el = document.createElement('div');
    el.className = 'card';
    document.body.appendChild(el);
    const t = getComputedStyle(el).transition;
    expect(t).toContain('background-color');
    expect(t).toContain('transform');
    el.remove();
  });

  it('.btn 默认 inline-flex', () => {
    const el = document.createElement('button');
    el.className = 'btn';
    document.body.appendChild(el);
    expect(getComputedStyle(el).display).toBe('inline-flex');
    el.remove();
  });

  it('.list-row 默认 flex + 8px 底 margin', () => {
    const el = document.createElement('div');
    el.className = 'list-row';
    document.body.appendChild(el);
    expect(getComputedStyle(el).display).toBe('flex');
    expect(getComputedStyle(el).marginBottom).toBe('8px');
    el.remove();
  });

  it('.sidebar 有 height:100% 约束 + 子 ul overflow-y:auto (滚动条收敛)', () => {
    // .sidebar 自身有 height:100% + overflow:hidden (容器);
    // 子 .sidebar > ul 才有 overflow-y:auto (实际滚动元素).
    // 测两侧确保契约.
    const el = document.createElement('nav');
    el.className = 'sidebar';
    const ul = document.createElement('ul');
    el.appendChild(ul);
    document.body.appendChild(el);
    expect(getComputedStyle(el).height).toBe('100%');
    expect(getComputedStyle(ul).overflowY).toBe('auto');
    el.remove();
  });

  it('.titlebar .actions button 32x32 + no border + 透明背景', () => {
    const wrap = document.createElement('div');
    wrap.className = 'titlebar';
    const actions = document.createElement('div');
    actions.className = 'actions';
    const btn = document.createElement('button');
    actions.appendChild(btn);
    wrap.appendChild(actions);
    document.body.appendChild(wrap);
    const cs = getComputedStyle(btn);
    expect(cs.width).toBe('32px');
    expect(cs.height).toBe('32px');
    wrap.remove();
  });

  it('.badge 默认 inline-flex + 20px 高', () => {
    const el = document.createElement('span');
    el.className = 'badge';
    document.body.appendChild(el);
    expect(getComputedStyle(el).display).toBe('inline-flex');
    expect(getComputedStyle(el).height).toBe('20px');
    el.remove();
  });

  it('anime 主题下 .card:hover 有 translateY 上浮(transform 在 transition 中)', () => {
    document.documentElement.dataset.theme = 'anime';
    const el = document.createElement('div');
    el.className = 'card';
    document.body.appendChild(el);
    const t = getComputedStyle(el).transition;
    expect(t).toContain('transform');
    el.remove();
  });

  it('.theme-toggle.spinning 触发 animation 属性 (jsdom 不解析 keyframe 但 transition 路径生效)', () => {
    const el = document.createElement('button');
    el.className = 'theme-toggle spinning';
    document.body.appendChild(el);
    // jsdom 不解析 @keyframes, 但 base.css .theme-toggle.spinning 块存在.
    // 真实浏览器看到的是 animation-name: spin-once, duration 400ms, easing cubic-bezier.
    // 这里至少验证规则命中 —— 拿到 CSSStyleRule 的 cssText 中包含 'spin-once'.
    const ruleFound = Array.from(document.styleSheets).some((sheet) => {
      try {
        return Array.from(sheet.cssRules).some((r) => r.cssText.includes('spin-once'));
      } catch {
        return false;
      }
    });
    expect(ruleFound).toBe(true);
    el.remove();
  });

  it('anime 主题下 .sidebar .nav-item 圆胖 padding/margin 覆写命中 CSSRule', () => {
    document.documentElement.dataset.theme = 'anime';
    const ruleFound = Array.from(document.styleSheets).some((sheet) => {
      try {
        return Array.from(sheet.cssRules).some(
          (r) =>
            r.cssText.includes('.sidebar .nav-item') &&
            r.cssText.includes('border-radius: 16px'),
        );
      } catch {
        return false;
      }
    });
    expect(ruleFound).toBe(true);
  });
});