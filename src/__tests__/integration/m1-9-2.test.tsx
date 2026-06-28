/**
 * M1.9.2 — chrome + glass regression coverage.
 *
 * Covers the three deliverables of M1.9.2:
 *
 *   1. Scroll contract regression
 *      - <main> data-testid="app-main" must be `overflow: auto` so
 *        page content scrolls inside the pane, not by clipping
 *        silently. This is the M1.9.1 fix's contract — it was
 *        `hidden` (clip) in M1.9.0 and was supposed to move to
 *        `auto` (scroll). M1.9.2 enforces the `auto` half.
 *      - <nav data-testid="app-sidebar"> keeps `overflow-y: auto`.
 *
 *   2. Window control buttons
 *      - AppHeader must render 3 chrome buttons
 *        (minimize / maximize / close) in the right zone.
 *      - Each button must call the matching Tauri command.
 *
 *   3. Liquid glass tokens
 *      - tokens.css must define a backdrop-filter blur token family
 *        + a glass background token family per CLAUDE.md §4.1
 *        "M1 阶段用 CSS backdrop-filter: blur() 模拟 Liquid Glass".
 *
 *   4. Effects bootstrap call
 *      - M2.16-theme-fix: backdrop 应用已迁移到 Rust setup hook
 *        (window_vibrancy::apply_mica / apply_vibrancy)。main.tsx 不再
 *        调 JS applyWindowEffects —— Rust apply_mica 是唯一来源，
 *        早于 WebView2 首帧执行，避免晚到的 JS setEffects 重置 DWM
 *        合成状态遮住 Mica。M2.16-cleanup: applyEffects.ts 已删除，
 *        测试断言 lib.rs 调用 + main.tsx 不触达 JS。
 *
 * These tests assert SHIPPED behaviour, not implementation details:
 * they should fail BEFORE the M1.9.2 implementation lands and pass
 * after. TDD discipline per CLAUDE.md §5.2.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, fireEvent } from '@testing-library/react';
import App from '../../App';
import { ThemeProvider } from '../../design-system/ThemeProvider';
import { ViewStateProvider } from '../../hooks/useViewState';

// Mock the Tauri window API BEFORE the component imports it. The
// mock surface matches @tauri-apps/api/window — we only stub the
// methods M1.9.2's WindowControls component calls.
const minimizeMock = vi.fn();
const toggleMaximizeMock = vi.fn();
const closeMock = vi.fn();
const setEffectsMock = vi.fn().mockResolvedValue(undefined);

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    minimize: minimizeMock,
    toggleMaximize: toggleMaximizeMock,
    close: closeMock,
    setEffects: setEffectsMock,
  }),
  Effect: {
    Mica: 'mica',
    Acrylic: 'acrylic',
    Tabbed: 'tabbed',
    Sidebar: 'sidebar',
    HeaderView: 'headerView',
  },
}));

// Vite's `?raw` returns an empty string in vitest, so read
// tokens.css off disk and inject as a <style> tag so
// getComputedStyle can see the real rules we ship.
const tokensCss = readFileSync(
  resolve(__dirname, '../../design-system/tokens.css'),
  'utf-8',
);

let _styleTag: HTMLStyleElement | null = null;
function ensureTokensLoaded(): void {
  for (const el of Array.from(
    document.head.querySelectorAll('style[data-test-tokens]'),
  )) {
    el.remove();
  }
  _styleTag = document.createElement('style');
  _styleTag.setAttribute('data-test-tokens', '1');
  _styleTag.textContent = tokensCss;
  document.head.appendChild(_styleTag);
}

beforeAll(() => {
  ensureTokensLoaded();
});

beforeEach(() => {
  localStorage.clear();
  ensureTokensLoaded();
  minimizeMock.mockClear();
  toggleMaximizeMock.mockClear();
  closeMock.mockClear();
  setEffectsMock.mockClear();
});

function renderApp(): void {
  render(
    <ThemeProvider>
      <App />
    </ThemeProvider>,
    // useViewState throws if called outside <ViewStateProvider>
    // (fail-fast contract). Production mounts the provider in
    // main.tsx; tests have to do it themselves.
    { wrapper: ViewStateProvider },
  );
}

describe('M1.9.2 — scroll contract', () => {
  it('<main> pane uses overflow:auto (not hidden) so page content scrolls', () => {
    renderApp();
    const main = screen.getByTestId('app-main');
    const cs = getComputedStyle(main);
    // M1.9.1 left the pane at `hidden` (clip). M1.9.2 flips it to
    // `auto` so the page-level <motion.div> + HomeView's overflow-auto
    // + PluginPlaceholder's flex content all scroll inside this pane
    // rather than the window.
    expect(cs.overflow).toBe('auto');
    // The M1.9.1 min-height:0 fix is still required (flex parent
    // must allow the pane to shrink below content height for the
    // `auto` overflow to actually engage).
    expect(['0', '0px']).toContain(cs.minHeight);
  });

  it('Sidebar nav still self-scrolls (overflow-y:auto preserved)', () => {
    renderApp();
    const nav = screen.getByTestId('app-sidebar');
    expect(getComputedStyle(nav).overflowY).toBe('auto');
  });

  it('App root remains overflow:hidden (no window-level scrollbar)', () => {
    renderApp();
    const root = screen.getByTestId('app-root');
    // The outer shell MUST stay hidden so the desktop window
    // (WebView2) never paints its own native scrollbar. The
    // inner <main> handles the scroll instead.
    expect(getComputedStyle(root).overflow).toBe('hidden');
  });
});

describe('M1.9.2 — window control buttons (custom chrome)', () => {
  it('AppHeader renders all 3 chrome buttons (minimize / maximize / close)', () => {
    renderApp();
    expect(
      screen.getByTestId('app-header-minimize'),
      'minimize button missing',
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('app-header-maximize'),
      'maximize button missing',
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('app-header-close'),
      'close button missing',
    ).toBeInTheDocument();
  });

  it('clicking minimize calls getCurrentWindow().minimize()', () => {
    renderApp();
    fireEvent.click(screen.getByTestId('app-header-minimize'));
    expect(minimizeMock).toHaveBeenCalledTimes(1);
  });

  it('clicking maximize calls getCurrentWindow().toggleMaximize()', () => {
    renderApp();
    fireEvent.click(screen.getByTestId('app-header-maximize'));
    expect(toggleMaximizeMock).toHaveBeenCalledTimes(1);
  });

  it('clicking close calls getCurrentWindow().close() directly (M3.0.2 confirm dialog withdrawn)', () => {
    // M3.0.2 originally added a themed ConfirmDialog before the OS-level
    // close. That intermediate dialog has been WITHDRAWN (commit log:
    // user feedback — confirm-then-close is jarring for a custom-chrome
    // minimize/maximize/close row, users expect the X to just close).
    // The current behavior is: click X → safeCall(close()). The test
    // pins that regression directly so a future "add back confirm
    // dialog" change must update this assertion deliberately.
    renderApp();
    fireEvent.click(screen.getByTestId('app-header-close'));
    // No intermediate dialog should appear.
    expect(screen.queryByTestId('confirm-dialog-confirm')).toBeNull();
    // close() fires synchronously after click.
    expect(closeMock).toHaveBeenCalledTimes(1);
  });

  it('chrome buttons sit in the no-drag region (not the drag zone)', () => {
    renderApp();
    // The whole <header> is the Tauri drag zone (data-tauri-drag-region).
    // Chrome buttons must opt out so clicks register as clicks, not
    // drag gestures. We assert that no chrome button sits on the
    // drag region node itself.
    const min = screen.getByTestId('app-header-minimize');
    const max = screen.getByTestId('app-header-maximize');
    const cls = screen.getByTestId('app-header-close');
    for (const btn of [min, max, cls]) {
      // The button must NOT have the drag-region attribute (it sits
      // inside a child of the drag region instead, with no-drag style).
      expect(btn.getAttribute('data-tauri-drag-region')).toBeNull();
    }
  });
});

describe('M1.9.2 — liquid glass tokens', () => {
  it('tokens.css defines a backdrop blur token family (--blur-sm/md/lg)', () => {
    // CLAUDE.md §4.1 mandates CSS backdrop-filter: blur() in M1
    // and a future v1.1 system API. We can't easily assert that
    // backdrop-filter is USED on a specific element from jsdom
    // (CSS.supports isn't reliable in this env), so we assert the
    // token family is defined — that is the architectural contract.
    expect(tokensCss).toMatch(/--blur-(sm|md|lg)\s*:/);
    // And the glass background token used to colour the surfaces
    // behind the blur.
    expect(tokensCss).toMatch(/--glass-bg\s*:/);
  });

  it('AppHeader source declares WebkitAppRegion (no-drag for buttons) but no backdrop-filter (M1.9.2 glass withdrawn)', () => {
    // jsdom does NOT serialise non-standard CSS properties
    // (backdrop-filter, -webkit-backdrop-filter) into the
    // element.style.cssText — they get silently dropped on
    // round-trip through React's style-to-attr conversion.
    // Asserting on the rendered DOM is therefore unreliable.
    // Instead we read the component source off disk and verify
    // the contract that's actually shipped (M1.9.2-era glass
    // backdrop was WITHDRAWN during the v3.4 5-theme redesign —
    // design-system commit 0742870 / liquid-glass theme now lives
    // in CSS via [data-theme="liquid-glass"] background, not in
    // inline backdrop-filter on AppHeader).
    const headerSrc = readFileSync(
      resolve(__dirname, '../../components/AppHeader.tsx'),
      'utf-8',
    );
    expect(headerSrc).toMatch(/WebkitAppRegion\s*:/);
    // Glass tokens moved to the theme-driven CSS layer (see tokens.css
    // [data-theme="liquid-glass"]). AppHeader no longer declares them
    // inline — the test pins that withdrawal.
    expect(headerSrc).not.toMatch(/WebkitBackdropFilter\s*:/);
    expect(headerSrc).not.toMatch(/var\(--glass-bg\)/);
    expect(headerSrc).not.toMatch(/var\(--blur-md\)/);
  });

  it('AppSidebar source declares backdrop-filter + glass-bg', () => {
    const sidebarSrc = readFileSync(
      resolve(__dirname, '../../components/AppSidebar.tsx'),
      'utf-8',
    );
    expect(sidebarSrc).toMatch(/backdropFilter\s*:/);
    expect(sidebarSrc).toMatch(/WebkitBackdropFilter\s*:/);
    expect(sidebarSrc).toMatch(/var\(--glass-bg\)/);
    expect(sidebarSrc).toMatch(/var\(--blur-md\)/);
  });

  it('PluginPlaceholder source declares backdrop-filter + glass-bg-strong', () => {
    const placeholderSrc = readFileSync(
      resolve(__dirname, '../../components/PluginPlaceholder.tsx'),
      'utf-8',
    );
    expect(placeholderSrc).toMatch(/backdropFilter\s*:/);
    // Placeholder uses the stronger glass tier (alpha 0.75 vs 0.55)
    // so the card reads as a distinct surface against the
    // also-glass header / sidebar.
    expect(placeholderSrc).toMatch(/var\(--glass-bg-strong\)/);
  });
});

describe('M1.9.2 — effects bootstrap (M31 vibrancy withdrawn — pure CSS path)', () => {
  // M31 / M2.16-M4.8 vibrancy 撤回 (4 轮失败后用户决定"纯 CSS 模拟"
  // 方案) — lib.rs 不再调任何 OS 原生 backdrop API (window_vibrancy::
  // apply_mica / apply_vibrancy / IPlatformWindowChrome::apply 都已
  // 删除),platform/macos/window_chrome.rs / platform/windows/
  // window_chrome.rs 不存在。backdrop 视觉由 tokens.css / base.css
  // + 组件 CSS 保留,启动路径不再触达 OS API。
  //
  // 这些测试作为"撤回回归守卫"留下 — 任何复活 OS 原生 backdrop 调用
  // 的改动 (例如重新引入 window_vibrancy crate / platform window_chrome
  // 模块) 都会让下面的 toBe(false) 失败,作为"想清楚再改"的提醒。

  it('lib.rs does NOT call window_vibrancy / window_chrome (M31 withdrawn)', () => {
    const libRs = readFileSync(
      resolve(__dirname, '../../../src-tauri/src/lib.rs'),
      'utf-8',
    );
    // OS 原生 backdrop 路径全部已删 — lib.rs 应不引用这些符号。
    expect(libRs).not.toMatch(/window_vibrancy/);
    expect(libRs).not.toMatch(/window_chrome/);
    expect(libRs).not.toMatch(/apply_mica|apply_vibrancy/);
    expect(libRs).not.toMatch(/NSVisualEffectMaterial/);
  });

  it('platform/macos/window_chrome.rs does NOT exist (M31 withdrawn)', () => {
    const { existsSync } = require('node:fs');
    expect(
      existsSync(
        resolve(
          __dirname,
          '../../../src-tauri/src/platform/macos/window_chrome.rs',
        ),
      ),
      'M31 vibrancy 撤回 — window_chrome.rs 应已删除。',
    ).toBe(false);
  });

  it('main.tsx no longer calls JS applyWindowEffects (Rust is single source — both withdrawn)', () => {
    // M2.16-theme-fix: main.tsx 必须不再 import / 调用 applyWindowEffects。
    // Rust apply_mica 是唯一的 backdrop 来源；JS setEffects 与之冲突。
    // M2.16-cleanup: applyEffects.ts 已删除，此断言作为"前端不再触达
    // 窗口效果 API"的回归守卫保留——任何复活 JS setEffects 路径的改动
    // 都会违反"纯 CSS 模拟"契约。注意：注释里会提到历史函数名，所以
    // 只看非注释代码行。
    const mainTsx = readFileSync(
      resolve(__dirname, '../../main.tsx'),
      'utf-8',
    );
    // 只保留非注释、非空行（去掉 // 开头的行 + 行内 // 尾注）
    const codeOnly = mainTsx
      .split('\n')
      .map((l) => l.replace(/\r$/, ''))
      .filter((l) => l.trim().length > 0 && !l.trim().startsWith('//'))
      .map((l) => l.replace(/\/\/.*$/, ''))
      .join('\n');
    // 不应再 import applyEffects 模块
    expect(codeOnly).not.toMatch(/from\s+["'].*applyEffects/);
    // 不应再调用 applyWindowEffects（匹配函数调用）
    expect(codeOnly).not.toMatch(/applyWindowEffects\s*\(/);
  });
});
