/**
 * Scroll-layout integration coverage (M1.9.1-fix).
 *
 * Regression test for the bug where the entire app window showed a
 * browser-level scrollbar instead of letting the sidebar + main
 * content scroll internally. Two root causes were stacked:
 *
 *   Bug A — html/body/#root reset lost (tokens.css didn't carry the
 *           M1.3-fix `overflow: hidden; height: 100%` rules).
 *   Bug B — App.tsx + AppSidebar.tsx rely on Tailwind utility classes
 *           (`flex flex-1 overflow-hidden min-h-0`) for the flex
 *           chain, but Tailwind is not compiled in this project, so
 *           those classes never produced CSS. The flex chain
 *           collapsed and the sidebar was silently clipped.
 *
 * These tests assert the SHIPPED behaviour by reading the inline
 * styles + loaded tokens.css that actually runs in jsdom. They are
 * intentionally narrow — they should fail before the fix and pass
 * after it.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import App from '../../App';
import { ThemeProvider } from '../../design-system/ThemeProvider';
import { ViewStateProvider } from '../../hooks/useViewState';

// Vite's `?raw` query returns an empty string inside vitest, so we
// read tokens.css off disk instead. The path is computed at module
// load via __dirname (vitest's CJS-ish wrapper for .test.tsx).
const tokensCss = readFileSync(
  resolve(__dirname, '../../design-system/tokens.css'),
  'utf-8',
);

// jsdom doesn't auto-apply CSS module imports — inject the shipping
// stylesheet into a fresh <style> tag so getComputedStyle can see
// the rules our Tauri webview actually delivers at runtime.
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

describe('App shell — scroll layout regression (M1.9.1-fix)', () => {
  it('tokens.css carries the html/body/#root viewport reset (Bug A guard)', () => {
    // The reset block MUST exist in tokens.css so that main.tsx
    // (which only imports tokens.css) ships it. M1.3-fix originally
    // wrote this in src/index.css which is now dead code.
    expect(tokensCss).toMatch(/html\s*,\s*body\s*,\s*#root/);
    expect(tokensCss).toMatch(/overflow\s*:\s*hidden/);
    expect(tokensCss).toMatch(/height\s*:\s*100%/);
  });

  it('html element renders with overflow:hidden and full height (Bug A live)', () => {
    renderApp();
    const html = document.documentElement;
    expect(getComputedStyle(html).overflow).toBe('hidden');
    expect(getComputedStyle(html).height).toBe('100%');
  });

  it('body element renders with overflow:hidden and full height (Bug A live)', () => {
    renderApp();
    const body = document.body;
    expect(getComputedStyle(body).overflow).toBe('hidden');
    expect(getComputedStyle(body).height).toBe('100%');
  });

  it('App root is a vertical flex column that fills the viewport (Bug B guard)', () => {
    renderApp();
    const root = screen.getByTestId('app-root');
    const cs = getComputedStyle(root);
    // These four properties together make the shell a vertical flex
    // container that is exactly the height of the viewport. Without
    // them the flex chain leaks out into the document.
    expect(cs.display).toBe('flex');
    expect(cs.flexDirection).toBe('column');
    expect(cs.height).toBe('100vh');
    expect(cs.overflow).toBe('hidden');
  });

  it('Sidebar nav scrolls internally (overflow-y:auto, flex-min-height:0) — Bug B guard', () => {
    renderApp();
    const nav = screen.getByTestId('app-sidebar');
    const cs = getComputedStyle(nav);
    // Sidebar must self-scroll when its 12 items overflow the
    // available height. Two-part contract:
    //   1. overflow-y is `auto` (already in inline style)
    //   2. min-height is 0 so the flex parent actually constrains it
    expect(cs.overflowY).toBe('auto');
    // jsdom may normalise; both `0` and `0px` are acceptable.
    expect(['0', '0px']).toContain(cs.minHeight);
  });

  it('Main pane is the flex sibling of the sidebar with min-height:0 (Bug B guard)', () => {
    renderApp();
    const main = screen.getByTestId('app-main');
    const cs = getComputedStyle(main);
    // The main pane must be able to shrink below its intrinsic
    // content height so that its own internal scroller (rendered by
    // HomeView / PluginPlaceholder) actually engages. Without
    // min-height:0 the pane is silently clipped — same symptom as
    // the sidebar.
    //
    // M1.9.2 (scroll regression guard): the pane flipped from
    // `overflow: hidden` (M1.9.1 clip) to `overflow: auto` so the
    // page content scrolls INSIDE the pane. The Bug B contract
    // here is the min-height:0 half; the overflow is now 'auto'
    // and is asserted in the M1.9.2 integration suite.
    expect(['auto', 'scroll']).toContain(cs.overflow);
    expect(['0', '0px']).toContain(cs.minHeight);
  });

  it('Document does not introduce a window-level scrollbar (smoke)', () => {
    renderApp();
    // The HTML reset sets `html, body { overflow: hidden }` so the
    // document element reports its visible overflow as `hidden`,
    // meaning the browser will never paint a window-level scrollbar
    // even if a child momentarily overflows.
    expect(getComputedStyle(document.documentElement).overflow).toBe('hidden');
    expect(getComputedStyle(document.body).overflow).toBe('hidden');
  });
});
