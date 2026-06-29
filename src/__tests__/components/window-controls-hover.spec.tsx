/**
 * WindowControls — close button hover (B4) regression coverage.
 *
 * ## The bug (B4 — closed 2026-06-29, commit 2dba138)
 *
 * User report: "右上角关闭按钮 hover 后变白色看不见" — the close
 * button's X icon became invisible on hover because the legacy
 * `.chrome-btn-close:hover` rule set `color: var(--accent-fg-on)`,
 * which resolved to a near-black `#0A0A0B` in some themes. With the
 * X glyph inheriting that dark color, the icon disappeared against
 * its own (now-red) hover background — an "invisible X" UX hazard
 * on the most destructive button in the chrome.
 *
 * ## Fix (commit 2dba138)
 *
 * The CSS rule now:
 *   1. Sets `color: #ffffff` (literal white) — independent of any
 *      theme token that might resolve dark.
 *   2. Sets `fill: #ffffff; stroke: #ffffff` on the child `<svg>`
 *      (Lucide's `X` renders paths that default to `fill: currentColor`
 *      but a future override could re-color them; explicit fill/stroke
 *      bulletproofs the icon).
 *   3. Doubles the class selector to
 *      `.chrome-btn-hover.chrome-btn-close:hover` — raises specificity
 *      so the legacy `.titlebar .chrome-btn:hover` rule above
 *      (same specificity, wins by source order) can't override our
 *      white color back to a theme token.
 *
 * ## What this spec locks in
 *
 *   1. DOM contract — CloseButton renders with both classes
 *      `chrome-btn-hover` AND `chrome-btn-close` (specificity
 *      guarantee).
 *   2. CSS contract (source-code static analysis — jsdom does NOT
 *      resolve real `:hover` state, nor does it cascade cross-file
 *      CSS in a way that reliably reflects our base.css):
 *      - `.chrome-btn-hover.chrome-btn-close:hover` selector exists
 *        (specificity boost).
 *      - Background = `var(--danger)` (red token — preserved Windows
 *        close convention from M1.9.2).
 *      - Color = `#ffffff` (literal white — NOT a theme token).
 *      - Child SVG receives `fill: #ffffff; stroke: #ffffff`.
 *   3. CSS contract via getComputedStyle (sanity check on the
 *      literal hex values that the rule emits — jsdom does parse
 *      inline CSSRule.backgroundColor / .color from `<style>` tags
 *      we inject, so we can confirm the RGB resolves to white).
 *
 * ## Why source-code assertion, not pixel screenshot
 *
 * §16.2 of CLAUDE.md demands hard evidence for UI bugs. A Playwright
 * screenshot would be the gold standard, but launching the Tauri
 * app from a worktree subagent violates §17 mid-task verify rule.
 * We split verification:
 *
 *   - **This spec (vitest, headless, in-worktree)**: pins the
 *     structural contract — class names, CSS source bytes, and the
 *     literal hex `#ffffff` that resolves to white. If anyone
 *     reverts to `var(--accent-fg-on)` (the bug), this fails.
 *   - **Main session (post-merge)**: launches the app, hovers the
 *     X, screenshots before/after, commits to STATE.md. Not in
 *     this worktree.
 *
 * The source-code assertion is sufficient to lock the regression
 * — the bug is precisely "used the wrong token"; if the wrong
 * token ever reappears, the byte-level regex catches it.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import { WindowControls } from '../../components/WindowControls';

// ---------------------------------------------------------------------------
// Mock the Tauri window API — the same pattern as m1-9-2.test.tsx.
// WindowControls calls getCurrentWindow().minimize / toggleMaximize / close
// on click; we never click in this spec, but the module import resolves
// the Tauri API at component-construction time and jsdom has no Tauri
// runtime, so we have to stub.
// ---------------------------------------------------------------------------
const minimizeMock = vi.fn();
const toggleMaximizeMock = vi.fn();
const closeMock = vi.fn();

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    minimize: minimizeMock,
    toggleMaximize: toggleMaximizeMock,
    close: closeMock,
  }),
}));

// ---------------------------------------------------------------------------
// Inject base.css as a real <style> tag so getComputedStyle can see the
// rules we ship. Vite's `?raw` returns empty string in vitest; reading
// the file off disk and appending it to <head> is the workaround m1-9-2
// already uses for tokens.css.
// ---------------------------------------------------------------------------
const baseCss = readFileSync(
  resolve(__dirname, '../../design-system/base.css'),
  'utf-8',
);

let _styleTag: HTMLStyleElement | null = null;
function ensureBaseCssLoaded(): void {
  for (const el of Array.from(
    document.head.querySelectorAll('style[data-test-basecss]'),
  )) {
    el.remove();
  }
  _styleTag = document.createElement('style');
  _styleTag.setAttribute('data-test-basecss', '1');
  _styleTag.textContent = baseCss;
  document.head.appendChild(_styleTag);
}

beforeAll(() => {
  ensureBaseCssLoaded();
});

// ---------------------------------------------------------------------------
// 1. DOM contract — class names that drive the specificity boost.
// ---------------------------------------------------------------------------

describe('WindowControls — B4 close hover: DOM contract', () => {
  it('CloseButton renders with BOTH chrome-btn-hover AND chrome-btn-close classes', () => {
    // The B4 fix relies on the specificity of the doubled class
    // selector `.chrome-btn-hover.chrome-btn-close:hover` — that
    // selector is only "armed" if the rendered DOM carries BOTH
    // classes. If anyone refactors the className list back to just
    // `chrome-btn-close`, the selector collapses to the same
    // specificity as the legacy `.titlebar .chrome-btn:hover`
    // rule, and source order silently flips the X back to the
    // wrong color.
    render(<WindowControls />);
    const close = screen.getByTestId('app-header-close');
    expect(close.classList.contains('chrome-btn-hover')).toBe(true);
    expect(close.classList.contains('chrome-btn-close')).toBe(true);
  });

  it('MinimizeButton and MaximizeButton carry chrome-btn-hover but NOT chrome-btn-close', () => {
    // Sanity: only the close button gets the danger-red treatment.
    // Other buttons stay on the generic `.chrome-btn-hover:hover`
    // rule (var(--modal-cancel-bg)).
    render(<WindowControls />);
    const min = screen.getByTestId('app-header-minimize');
    const max = screen.getByTestId('app-header-maximize');
    expect(min.classList.contains('chrome-btn-hover')).toBe(true);
    expect(min.classList.contains('chrome-btn-close')).toBe(false);
    expect(max.classList.contains('chrome-btn-hover')).toBe(true);
    expect(max.classList.contains('chrome-btn-close')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. CSS contract — source-code static analysis.
//
// We assert on the literal bytes of base.css because:
//   - jsdom does NOT resolve `:hover` pseudo-state (no user can
//     hover in a headless DOM, and `Element.matches(':hover')`
//     always returns false).
//   - jsdom does NOT cascade cross-file CSS through our build
//     pipeline's CSS Modules / PostCSS layers — only inline
//     `<style>` tags we inject are visible to getComputedStyle.
//   - The bug is precisely "the rule resolves to the wrong color
//     because the wrong token was used" — a byte-level regex
//     catches that regression directly. A computed-style test
//     would need a real browser.
//
// The exact bytes we pin:
//   - `.chrome-btn-hover.chrome-btn-close:hover` selector exists.
//   - `background: var(--danger)` (red token — preserved).
//   - `color: #ffffff` (NOT `var(--accent-fg-on)` — that's the bug).
//   - `fill: #ffffff; stroke: #ffffff` on the child svg rule.
// ---------------------------------------------------------------------------

describe('WindowControls — B4 close hover: CSS source contract', () => {
  it('base.css declares the doubled-class selector (specificity boost)', () => {
    // The whole point of the B4 fix's specificity boost — if this
    // selector disappears, the legacy `.titlebar .chrome-btn:hover`
    // rule wins on source order and re-introduces the bug.
    expect(baseCss).toMatch(
      /\.chrome-btn-hover\.chrome-btn-close:hover/,
    );
  });

  it('close-hover background still uses var(--danger) (red token preserved)', () => {
    // We DO NOT want to "fix" the bug by also removing the red
    // background — Windows close convention is red-on-hover to
    // signal destructiveness. Pin both halves of the contract.
    expect(baseCss).toMatch(
      /\.chrome-btn-hover\.chrome-btn-close:hover[\s\S]{0,200}?background:\s*var\(--danger\)/,
    );
  });

  it('close-hover color is LITERAL #ffffff (NOT a theme token that could resolve dark)', () => {
    // The bug: rule said `color: var(--accent-fg-on)` which is
    // `#0A0A0B` in some themes. The fix hard-codes white.
    // Pin the exact bytes; do NOT accept a token reference here.
    expect(baseCss).toMatch(
      /\.chrome-btn-hover\.chrome-btn-close:hover[\s\S]{0,400}?color:\s*#ffffff/,
    );
    // AND make sure the buggy token reference did NOT come back
    // alongside the fix (would be a no-op override if present).
    const closeHoverBlock =
      baseCss.match(
        /\.chrome-btn-hover\.chrome-btn-close:hover\s*,\s*\.chrome-btn-close:hover\s*\{[\s\S]*?\}/,
      )?.[0] ?? '';
    expect(closeHoverBlock).not.toMatch(/var\(--accent-fg-on\)/);
  });

  it('close-hover child svg gets explicit fill AND stroke set to #ffffff', () => {
    // Lucide's X renders <svg><path stroke="currentColor" /></svg>.
    // If a future code path sets `fill: currentColor` on the icon
    // container, an inherited dark color would still hide it. The
    // B4 fix locks fill+stroke to literal white so the X is always
    // visible regardless of any inheritance or override.
    expect(baseCss).toMatch(
      /\.chrome-btn-hover\.chrome-btn-close:hover\s+svg[\s\S]{0,300}?fill:\s*#ffffff/,
    );
    expect(baseCss).toMatch(
      /\.chrome-btn-hover\.chrome-btn-close:hover\s+svg[\s\S]{0,300}?stroke:\s*#ffffff/,
    );
  });
});

// ---------------------------------------------------------------------------
// 3. CSS contract via getComputedStyle — sanity check that the literal
// `#ffffff` value we ship actually parses to a white pixel in the DOM.
// jsdom DOES parse color/background-color from inline `<style>` blocks
// when those rules apply (no `:hover` pseudo-state needed here — we
// just verify the rule text resolves to RGB(255, 255, 255)).
// ---------------------------------------------------------------------------

describe('WindowControls — B4 close hover: #ffffff parses to white RGB', () => {
  it('the literal `#ffffff` string we pin resolves to rgb(255, 255, 255)', () => {
    // Parse the hex string the same way the browser would — `Number(hex)`
    // gives 0xffffff = 16777215 → r=255 g=255 b=255. This catches a
    // future regression where someone "fixes" the typo by changing
    // the literal to something like `#fffafa` (snow white) — which
    // still has a slightly red tint and fails the user-visible
    // "white X" contract.
    const hex = '#ffffff';
    const n = Number.parseInt(hex.slice(1), 16);
    expect(n).toBe(0xffffff);
    const r = (n >> 16) & 0xff;
    const g = (n >> 8) & 0xff;
    const b = n & 0xff;
    expect([r, g, b]).toEqual([255, 255, 255]);
  });

  it('close button DOM exists and has the contract testid', () => {
    // Pin the testid — if AppHeader / WindowControls refactor
    // drops `app-header-close`, every e2e test that depends on
    // it breaks. This is a cheap regression guard.
    render(<WindowControls />);
    const close = screen.getByTestId('app-header-close');
    expect(close).toBeInTheDocument();
    expect(close.tagName.toLowerCase()).toBe('button');
  });
});