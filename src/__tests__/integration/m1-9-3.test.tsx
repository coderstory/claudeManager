/**
 * M1.9.3 — main pane absolute-position fix + framer-motion removal.
 *
 * Covers the two P0/P1 bugs reported against the chrome-and-glass
 * release build:
 *
 *   Bug P0 — <main> height collapses to 0 in Tauri WebView2 release
 *            mode. Root cause: the flex chain
 *            `flex: 1 + minHeight: 0 + position: relative` gets
 *            miscalculated by the WebView2 layout engine when the
 *            window does not run through Vite dev (release builds
 *            bundle CSS differently + apply the parent `flex: 1`
 *            after a measure tick that returns 0 in release mode).
 *            Fix: replace flex-1 with position:absolute + 4-edge
 *            inset relative to a `position: relative` parent div.
 *
 *   Bug P1 — framer-motion 12.23.25 + React 19 + Tauri release
 *            crashes the WebView2 renderer process (only the
 *            gpu + network service processes survive). Fix: remove
 *            framer-motion, replace AnimatePresence + motion.div
 *            with a CSS @keyframes fadeIn on a `.view-transition`
 *            wrapper. Animation was M1.9.1-only (150ms opacity
 *            fade) so 8 lines of CSS is a lossless replacement.
 *
 * These tests are SHIPPED-behaviour assertions per CLAUDE.md §5.2
 * TDD discipline: they should fail before the fix lands and pass
 * after. All other M1.9.x suites (scroll-layout, m1-9-2) must
 * continue to pass — the M1.9.3 changes preserve their contracts.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import App from '../../App';
import { ThemeProvider } from '../../design-system/ThemeProvider';

// Mock the Tauri window API the same way m1-9-2 does so React
// imports of WindowControls resolve. The M1.9.3 changes do not
// touch chrome behaviour, but the mock keeps the import graph
// healthy for any future test that exercises a header button.
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

// Read tokens.css off disk and inject into jsdom so
// getComputedStyle can see the real shipping rules.
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

describe('M1.9.3 — main pane absolute positioning (P0 fix)', () => {
  it('tokens.css declares --header-height and --sidebar-width tokens', () => {
    // P0 fix requires the chrome dimensions to be tokenised so
    // <main> can insets itself from them via var(). Hardcoded
    // 48 / 220 in component files would split the source of truth
    // (CLAUDE.md §4 — design tokens live in tokens.css).
    expect(tokensCss).toMatch(/--header-height\s*:\s*48px/);
    expect(tokensCss).toMatch(/--sidebar-width\s*:\s*220px/);
  });

  it('<main> uses position:absolute (not flex:1) so WebView2 cannot miscalculate', () => {
    renderApp();
    const main = screen.getByTestId('app-main');
    const cs = getComputedStyle(main);
    // The fix replaces `flex: 1 + minHeight: 0` with
    // `position: absolute` + 4-edge insets. jsdom reports inline
    // styles verbatim for `position`.
    expect(cs.position).toBe('absolute');
    // The flex shorthand no longer drives main's geometry.
    // jsdom reports flexGrow: 0 when flex: 1 is absent.
    expect(cs.flexGrow).not.toBe('1');
  });

  it('<main> insets match the header / sidebar token dimensions', () => {
    renderApp();
    const main = screen.getByTestId('app-main');
    // jsdom does NOT resolve CSS var() in computed style, so
    // getComputedStyle().top returns the literal "var(...)" string.
    // The reliable assertion is therefore on the inline style,
    // which is what the Tauri webview ships verbatim. CSS var()
    // resolution happens in the production engine (Chromium /
    // WebView2 / WKWebView) and is what actually puts the pane
    // at the right pixel offset.
    const inlineTop = (main as HTMLElement).style.top;
    const inlineLeft = (main as HTMLElement).style.left;
    expect(inlineTop).toBe('var(--header-height)');
    expect(inlineLeft).toBe('var(--sidebar-width)');
    // right + bottom pin to 0 (the standard inset trick) —
    // these ARE resolved in computed style because they're bare
    // pixel values, not var() expressions.
    const cs = getComputedStyle(main);
    expect(cs.right).toBe('0px');
    expect(cs.bottom).toBe('0px');
  });

  it('<main> still self-scrolls (overflow:auto preserved across the fix)', () => {
    renderApp();
    const main = screen.getByTestId('app-main');
    const cs = getComputedStyle(main);
    // M1.9.2 contract: the pane flips from `hidden` (clip) to
    // `auto` (scroll). M1.9.3 only changes HOW the pane is
    // positioned, not its overflow contract.
    expect(cs.overflow).toBe('auto');
  });

  it('the <main> parent (content row) is the absolute positioning context', () => {
    renderApp();
    // App.tsx wraps <AppSidebar> + <main> in a flex row whose
    // position is `relative` — this is what makes the <main>'s
    // `position: absolute` resolve relative to it (not to the
    // viewport, which would cover the header / sidebar). The
    // closest positioned ancestor of <main> must therefore be
    // the content row, not the app-root.
    const main = screen.getByTestId('app-main');
    const parent = main.parentElement;
    expect(parent).not.toBeNull();
    if (parent) {
      const cs = getComputedStyle(parent);
      expect(cs.position).toBe('relative');
    }
  });
});

describe('M1.9.3 — view transition (P1 fix: framer-motion removed)', () => {
  it('App.tsx no longer imports or uses framer-motion (P1 root cause removed)', () => {
    // Reading the source is the reliable way to assert "we are
    // not shipping a 12.23.25 import path that crashes the
    // WebView2 renderer". A rendered-DOM test could pass on
    // jsdom but still fail in release-WebView2.
    const appSrc = readFileSync(
      resolve(__dirname, '../../App.tsx'),
      'utf-8',
    );
    // 1. No import line — the only place `framer-motion` should
    //    appear in a TS file is `from "framer-motion"`.
    expect(appSrc).not.toMatch(/from\s+["']framer-motion["']/);
    // 2. No JSX usage of the AnimatePresence / motion components.
    //    We anchor on the JSX-style usage (`<AnimatePresence` or
    //    `motion.div`/`motion.span`/`motion.main`) so that prose
    //    mentions in a comment are NOT flagged — only real code.
    expect(appSrc).not.toMatch(/<AnimatePresence\b/);
    expect(appSrc).not.toMatch(/<motion\.(div|span|main|section|article)\b/);
  });

  it('package.json no longer declares framer-motion as a dependency', () => {
    // P1 fix = total removal, not downgrade. Bumping the version
    // (per CLAUDE.md §2.3) is NOT an option we want to leave in
    // the lock file: a future `npm install` would pull a newer
    // 12.x and reintroduce the release-mode crash.
    const pkgJson = readFileSync(
      resolve(__dirname, '../../../package.json'),
      'utf-8',
    );
    const parsed = JSON.parse(pkgJson) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const allDeps = {
      ...(parsed.dependencies ?? {}),
      ...(parsed.devDependencies ?? {}),
    };
    expect(allDeps['framer-motion']).toBeUndefined();
  });

  it('tokens.css declares a view-transition keyframe + class (CSS replacement)', () => {
    // The CSS replacement must exist on disk so the Tauri webview
    // picks it up. We assert the keyframe + class are both there.
    expect(tokensCss).toMatch(/@keyframes\s+fadeIn/);
    expect(tokensCss).toMatch(/\.view-transition\s*\{/);
  });

  it('the active view is wrapped in a .view-transition element', () => {
    renderApp();
    // App.tsx puts `className="view-transition"` + `data-testid="app-view"`
    // on the <div> that replaces <motion.div>. Both must exist so
    // CSS animation + tests can target it.
    const view = screen.getByTestId('app-view');
    expect(view.className).toContain('view-transition');
  });

  it('the view-transition class declares the fadeIn animation in the loaded CSS', () => {
    // jsdom does NOT process @keyframes rules nor does it
    // resolve shorthand `animation:` declarations from a
    // CSSRule onto a matched element's getComputedStyle.
    // We assert the contract at the source level: the
    // .view-transition rule must exist on the loaded
    // stylesheet and its body must include the fadeIn
    // animation with the M1.9.1 150ms duration.
    //
    // This is what the Tauri webview will receive at runtime
    // (Chromium / WebView2 / WKWebView all parse the
    // <style> tag injected from main.tsx → tokens.css).
    const sheets = Array.from(document.styleSheets);
    let viewTransitionRule: CSSStyleRule | null = null;
    for (const sheet of sheets) {
      let rules: CSSRuleList | null = null;
      try {
        rules = sheet.cssRules;
      } catch {
        continue;
      }
      if (!rules) continue;
      for (const rule of Array.from(rules)) {
        // jsdom does NOT expose `instanceof CSSStyleRule` for
        // STYLE_RULE typed rules (the typed constructors are
        // not in the jsdom global). We use the `selectorText`
        // property as a duck-type instead — only CSSStyleRule
        // (and CSSStyleDeclaration children) carry that field.
        const maybeStyleRule = rule as CSSStyleRule;
        if (
          typeof maybeStyleRule.selectorText === 'string' &&
          maybeStyleRule.selectorText === '.view-transition'
        ) {
          viewTransitionRule = maybeStyleRule;
          break;
        }
      }
      if (viewTransitionRule) break;
    }
    expect(viewTransitionRule).not.toBeNull();
    // The animation shorthand on the rule must reference
    // `fadeIn` (the keyframe) and a duration token — we
    // ship the duration as the var(--view-transition-duration)
    // token so the value lives in tokens.css (CLAUDE.md §4
    // token discipline). jsdom does NOT resolve the var(),
    // so the literal value is what we assert against.
    const animationDecl = viewTransitionRule!.style.animation;
    expect(animationDecl).toMatch(/fadeIn/);
    // Duration reference (either the token or a literal ms/s
    // form is acceptable — the token is the canonical ship).
    expect(animationDecl).toMatch(
      /var\(--view-transition-duration\)|0\.15s|150ms/,
    );
    // Easing keyword (any standard easing is fine; the
    // important thing is that the shorthand is syntactically
    // complete — animation-name, duration, timing-function).
    expect(animationDecl).toMatch(/ease/);
  });

  it('the fadeIn @keyframes rule itself is reachable via the loaded stylesheet', () => {
    // Defence-in-depth: even if the .view-transition rule
    // was renamed, the @keyframes rule must exist so the
    // webview can resolve the animation name. jsdom
    // exposes keyframe rules as CSSKeyframesRule instances
    // (in modern jsdom versions), but the global constructor
    // is not always defined — so we use a duck-type on
    // `name` + `cssRules` properties.
    const sheets = Array.from(document.styleSheets);
    let foundName: string | null = null;
    for (const sheet of sheets) {
      let rules: CSSRuleList | null = null;
      try {
        rules = sheet.cssRules;
      } catch {
        continue;
      }
      if (!rules) continue;
      for (const rule of Array.from(rules)) {
        const maybe = rule as { name?: string; cssRules?: { length: number } | null };
        if (
          typeof maybe.name === 'string' &&
          maybe.name === 'fadeIn'
        ) {
          foundName = maybe.name;
          // Sanity-check the keyframe has both `from` and `to`
          // stops, which is the minimum the @keyframes spec
          // requires for the animation to render.
          expect(maybe.cssRules?.length).toBe(2);
          break;
        }
      }
      if (foundName) break;
    }
    expect(foundName).toBe('fadeIn');
  });
});

describe('M1.9.3 — regression: dark theme still works after P0/P1 changes', () => {
  it('swapping the theme keeps <main> positioned absolute (fix did not regress dark mode)', () => {
    // Render once, flip to dark via the storage key, re-render.
    // The pane must STILL be position:absolute (the fix is
    // independent of the theme system) and the data-theme
    // attribute on <html> must reflect the switch.
    //
    // The storage key is `ccm.theme` (per ThemeProvider.tsx
    // STORAGE_KEY) — not the platform-default key. The provider
    // reads from this key on initial mount; clearing it would
    // default to 'light'.
    localStorage.setItem('ccm.theme', 'dark');
    renderApp();
    const main = screen.getByTestId('app-main');
    const cs = getComputedStyle(main);
    expect(cs.position).toBe('absolute');
    // Theme is applied at the documentElement level; the [data-theme]
    // attribute is the same selector tokens.css uses to swap tokens.
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });
});
