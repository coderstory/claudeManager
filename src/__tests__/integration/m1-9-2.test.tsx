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
 *      - main.tsx must import + invoke applyWindowEffects() so the
 *        Mica / vibrancy effect is requested at app start. The
 *        actual call is fire-and-forget; we assert the import
 *        path is wired.
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

  it('clicking close calls getCurrentWindow().close()', () => {
    renderApp();
    fireEvent.click(screen.getByTestId('app-header-close'));
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
    expect(headerSrc).toMatch(/backdropFilter\s*:/);
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
  it('main.tsx imports applyEffects and calls it on startup', () => {
    // We assert the import + call are wired into the entry point
    // by reading main.tsx source. This catches a future refactor
    // that drops the call (which would silently lose Mica on
    // Windows + vibrancy on macOS).
    const mainTsx = readFileSync(
      resolve(__dirname, '../../main.tsx'),
      'utf-8',
    );
    expect(mainTsx).toMatch(/applyEffects|applyWindowEffects/);
    expect(mainTsx).toMatch(/from\s+["'].*applyEffects/);
  });

  it('applyEffects module exports a function that invokes setEffects', async () => {
    // Dynamic import so the test still works if the file is
    // renamed later (it just resolves via the path we wrote).
    const mod = await import('../../design-system/applyEffects');
    expect(typeof mod.applyWindowEffects).toBe('function');
    await mod.applyWindowEffects();
    // The Tauri mock was set up above; setEffects must have been
    // called with an Effects-shaped payload.
    expect(setEffectsMock).toHaveBeenCalled();
    const arg = setEffectsMock.mock.calls[0][0];
    expect(arg).toBeDefined();
    expect(Array.isArray(arg.effects)).toBe(true);
    expect(arg.effects.length).toBeGreaterThan(0);
  });
});
