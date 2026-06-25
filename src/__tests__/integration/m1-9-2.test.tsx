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

  it('clicking close opens a confirm dialog (M3.0.2) and confirming calls getCurrentWindow().close()', () => {
    renderApp();
    fireEvent.click(screen.getByTestId('app-header-close'));
    // M3.0.2 — close now goes through a themed ConfirmDialog (CLAUDE.md §7).
    // The dialog must appear before the OS-level close() is called.
    const confirmBtn = screen.getByTestId('confirm-dialog-confirm');
    expect(confirmBtn).toBeInTheDocument();
    // Clicking the dialog's confirm button fires the real close().
    fireEvent.click(confirmBtn);
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

  it('AppHeader source declares backdrop-filter + glass-bg', () => {
    // jsdom does NOT serialise non-standard CSS properties
    // (backdrop-filter, -webkit-backdrop-filter) into the
    // element.style.cssText — they get silently dropped on
    // round-trip through React's style-to-attr conversion.
    // Asserting on the rendered DOM is therefore unreliable.
    // Instead we read the component source off disk and verify
    // the glass declaration is present — which is what really
    // matters (the shipped CSS is what reaches WebView2).
    const headerSrc = readFileSync(
      resolve(__dirname, '../../components/AppHeader.tsx'),
      'utf-8',
    );
    expect(headerSrc).toMatch(/WebkitAppRegion\s*:/);
    expect(headerSrc).toMatch(/WebkitBackdropFilter\s*:/);
    expect(headerSrc).toMatch(/var\(--glass-bg\)/);
    expect(headerSrc).toMatch(/var\(--blur-md\)/);
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

describe('M1.9.2 — effects bootstrap', () => {
  // M2.16-theme-fix: 原生窗口 backdrop（Win11 Mica / macOS vibrancy）的
  // 应用已从 JS applyWindowEffects()（走 Tauri setEffects → tao
  // set_effects）迁移到 Rust setup hook（window_vibrancy::apply_mica /
  // apply_vibrancy）。JS 入口不再触达 applyEffects —— Rust apply_mica
  // 在 setup 同步执行（早于 WebView2 首帧），是唯一的 backdrop 来源。
  // 此前 main.tsx 同时调 JS setEffects，晚到的 JS 调用可能重置 DWM
  // 合成状态，遮住已设好的 Mica。详见 main.tsx 注释 + lib.rs setup。
  it('Rust setup hook applies window-vibrancy backdrop (apply_mica / apply_vibrancy)', () => {
    // 读 lib.rs 源码, 断言 setup hook 通过 IPlatformWindowChrome trait
    // 派发 backdrop 应用 (M4.6 架构统一 — lib.rs 不再直接调
    // window_vibrancy::apply_*, 而是通过 trait 派发, 实现在
    // platform/{windows,macos}/window_chrome.rs)。
    //
    // 这是 backdrop 应用的唯一入口 — 如果 trait dispatch 被删,
    // Mica / vibrancy 会静默失效。
    const libRs = readFileSync(
      resolve(__dirname, '../../../src-tauri/src/lib.rs'),
      'utf-8',
    );
    // M4.6+: lib.rs uses trait dispatch (`window_chrome(...).apply(...)`)
    // instead of direct `window_vibrancy::apply_*` calls. The actual
    // apply_mica / apply_vibrancy implementations live in the
    // platform/macos/window_chrome.rs and platform/windows/window_chrome.rs
    // modules. We accept either the new trait-dispatch form OR the
    // legacy direct-call form (still accepted so older macOS impls
    // keep working during the cross-platform migration).
    const usesTraitDispatch =
      /window_chrome\s*\(/.test(libRs) && /\.apply\s*\(\s*&?opts\s*\)/.test(libRs);
    const usesLegacyDirectCall =
      /(window_vibrancy::apply_(?:mica|vibrancy))|(apply_vibrancy\(.*?\))|(use window_vibrancy)/.test(
        libRs,
      );
    expect(
      usesTraitDispatch || usesLegacyDirectCall,
      'lib.rs must apply window-vibrancy backdrop via either ' +
        'IPlatformWindowChrome trait dispatch (M4.6+) or direct ' +
        'window_vibrancy::apply_* call (legacy)',
    ).toBe(true);
    // NSVisualEffectMaterial is a macOS-side constant used by the
    // macOS vibrancy path — it's in platform/macos/window_chrome.rs
    // after M4.6, so we look there for it (lib.rs no longer references
    // it directly after the trait-dispatch refactor).
    const macosChrome = readFileSync(
      resolve(
        __dirname,
        '../../../src-tauri/src/platform/macos/window_chrome.rs',
      ),
      'utf-8',
    );
    expect(
      macosChrome,
      'NSVisualEffectMaterial must be referenced in the macOS vibrancy impl',
    ).toMatch(/NSVisualEffectMaterial/);
  });

  it('main.tsx no longer calls JS applyWindowEffects (Rust is single source)', () => {
    // M2.16-theme-fix: main.tsx 必须不再 import / 调用 applyWindowEffects。
    // Rust apply_mica 是唯一的 backdrop 来源；JS setEffects 与之冲突。
    // M2.16-cleanup: applyEffects.ts 已删除，此断言作为"前端不再触达
    // 窗口效果 API"的回归守卫保留——任何复活 JS setEffects 路径的改动
    // 都会违反 Rust 单一来源契约。注意：注释里会提到历史函数名，所以
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
