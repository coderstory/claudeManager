/**
 * Vitest regression test for AppHeader APP_NAME visual visibility (B6-P2).
 *
 * ## Bug context (B6-P2 / 2026-06-30)
 *
 *   B6 shipped: AppHeader shows APP_NAME constant ('ClaudeManager') in
 *   the left drag zone (replacing the removed back button). DOM-level
 *   verification confirmed `data-testid="app-header-app-name"` renders
 *   the text, and AppleScript accessibility tree reports AXStaticText
 *   `name=ClaudeManager`. However, four screenshots from
 *   `.planning/milestones/v3.4-phases/screenshots/b6-verify-20260629-235059/`
 *   show the text is INVISIBLE in the rendered webview.
 *
 * ## Root cause (file:line evidence)
 *
 *   Nested flex layout collision between AppHeader.tsx:144-153
 *   (`.titlebar-title-wrap` outer div) and src/design-system/base.css:204-211
 *   (`.titlebar-title` inner div):
 *
 *   - `.titlebar-title-wrap` has inline `flex: '0 1 auto'`, so its
 *     content-driven intrinsic width equals its children (~100px for
 *     "ClaudeManager" at 13px semibold).
 *   - `.titlebar-title` CSS has `min-width: 0` AND
 *     `max-width: calc(100% - 200px)`. When the parent is ~100px wide,
 *     `calc(100% - 200px)` evaluates to -100px -> clamped to 0.
 *   - With both `min-width: 0` and `max-width: 0` on a flex item,
 *     the resolved width is 0px regardless of intrinsic content width.
 *   - The `<span data-testid="app-header-app-name">` inside has
 *     `overflow: 'hidden'` + `textOverflow: 'ellipsis'`. On a 0-width
 *     container, ellipsis shows nothing -> text is invisible.
 *
 *   Result: DOM has the node, accessibility tree enumerates it, but
 *   the rendered output has zero painted pixels for the text.
 *
 * ## What this test locks in
 *
 *   1. **DOM assertion**: span with data-testid="app-header-app-name"
 *      exists and its textContent === 'ClaudeManager'.
 *   2. **Inline-style assertion**: span has fontSize >= 12, color is
 *      non-transparent, whiteSpace nowrap, fontWeight >= 500.
 *   3. **CSS regression guard (THE FIX)**: src/design-system/base.css
 *      must NOT contain a rule that simultaneously applies
 *      `min-width: 0` AND `max-width: calc(100% - Npx)` where N >= 100
 *      to `.titlebar .titlebar-title`. The combination collapses the
 *      flex item to 0 width when the parent is content-sized.
 *   4. **RGB sanity**: light theme --text-primary must NOT equal
 *      #FFFFFF (would make text invisible on white --bg-elevated).
 *
 * ## Verification scope
 *
 *   - jsdom does not perform real layout, so we cannot measure
 *     rendered width directly. Instead we statically check the CSS
 *     rule chain that would cause 0-width collapse (test #3) and
 *     assert the inline styles are sane (tests #1, #2, #4).
 *   - Visual confirmation (real browser / tauri webview) is performed
 *     by the main session via Playwright + tauri-driver per
 *     CLAUDE.md §17.4. This test prevents regression of the CSS
 *     rule that caused the bug.
 *
 * ## Related
 *
 *   - B6 verify:  `.planning/milestones/v3.4-phases/VERIFICATION-B6.md` §5.A
 *   - B6-P2 fix:  src/design-system/base.css (this test guards it)
 *   - B6-P2 fix:  src/components/AppHeader.tsx (no change; outer wrap OK)
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import { AppHeader } from '../../components/AppHeader';
import { ThemeProvider } from '../../design-system/ThemeProvider';

vi.mock('../../design-system/ThemeRegistry', () => ({
  listThemes: () => [
    { id: 'light', name: '极简卡片', icon: 'sun', isDefault: true },
    { id: 'dark', name: '暗夜', icon: 'moon' },
  ],
  getTheme: (id: string) => {
    if (id === 'light') return { id: 'light', name: '极简', icon: 'sun' };
    if (id === 'dark') return { id: 'dark', name: '暗夜', icon: 'moon' };
    return null;
  },
  getDefaultTheme: () => ({ id: 'light', name: '极简卡片', icon: 'sun', isDefault: true }),
  getNextTheme: (id: string) => (id === 'light'
    ? { id: 'dark', name: '暗夜', icon: 'moon' }
    : { id: 'light', name: '极简卡片', icon: 'sun' }),
  isRegisteredTheme: (id: string) => id === 'light' || id === 'dark',
}));

const noop = (): void => undefined;

function wrap(ui: React.ReactElement): React.ReactElement {
  return <ThemeProvider>{ui}</ThemeProvider>;
}

function parseColor(input: string): [number, number, number] | null {
  const s = input.trim();
  const rgbMatch = s.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (rgbMatch) {
    return [Number(rgbMatch[1]), Number(rgbMatch[2]), Number(rgbMatch[3])];
  }
  if (s.startsWith('#')) {
    const hex = s.slice(1);
    if (hex.length === 3) {
      return [
        parseInt(hex[0] + hex[0], 16),
        parseInt(hex[1] + hex[1], 16),
        parseInt(hex[2] + hex[2], 16),
      ];
    }
    if (hex.length === 6 || hex.length === 8) {
      return [
        parseInt(hex.slice(0, 2), 16),
        parseInt(hex.slice(2, 4), 16),
        parseInt(hex.slice(4, 6), 16),
      ];
    }
  }
  return null;
}

describe('AppHeader - B6-P2 APP_NAME visual visibility regression', () => {
  it('renders APP_NAME span (DOM layer unchanged from B6)', () => {
    render(wrap(<AppHeader onNavigate={noop} />));
    const span = screen.getByTestId('app-header-app-name');
    expect(span).toBeInTheDocument();
    expect(span.textContent).toBe('ClaudeManager');
  });

  it('span has inline styles that paint a visible glyph (fontSize + color + nowrap)', () => {
    render(wrap(<AppHeader onNavigate={noop} />));
    const span = screen.getByTestId('app-header-app-name') as HTMLElement;
    const style = (span.style as unknown as Record<string, string>);

    const fontSizePx = Number.parseInt(style.fontSize ?? '', 10);
    expect(Number.isFinite(fontSizePx)).toBe(true);
    expect(fontSizePx).toBeGreaterThanOrEqual(12);

    const fontWeight = Number.parseInt(style.fontWeight ?? '', 10);
    expect(fontWeight).toBeGreaterThanOrEqual(500);

    expect(style.whiteSpace).toBe('nowrap');
    expect(style.overflow).toBe('hidden');

    const color = style.color ?? '';
    expect(color.length).toBeGreaterThan(0);
    expect(color).not.toBe('transparent');
    expect(color).not.toBe('inherit');
  });

  it('CSS rule for .titlebar-title does NOT collapse flex item to 0 width (THE FIX)', () => {
    const cssPath = resolve(
      __dirname,
      '..',
      '..',
      'design-system',
      'base.css',
    );
    const css = readFileSync(cssPath, 'utf-8');

    const ruleRe = /(?:\.titlebar\s+)?\.titlebar-title\s*\{([^}]*)\}/g;
    const matches = [...css.matchAll(ruleRe)];

    expect(matches.length).toBeGreaterThan(0);

    for (const m of matches) {
      const body = m[1];
      const hasMinWidthZero = /min-width\s*:\s*0(?:\s*[!;]|$)/m.test(body);
      const hasCollapsingMaxWidth =
        /max-width\s*:\s*calc\(\s*100%\s*-\s*(\d+)px\s*\)/m.test(body);
      if (hasMinWidthZero && hasCollapsingMaxWidth) {
        throw new Error(
          'B6-P2 regression: .titlebar-title rule has BOTH ' +
          "'min-width: 0' AND 'max-width: calc(100% - Npx)'. This " +
          'collapses the flex item to 0 width when the parent is ' +
          'content-sized, making APP_NAME invisible in the rendered ' +
          `webview. Rule body:\n${body}`,
        );
      }
    }
  });

  it('RGB sanity: light-theme --text-primary is NOT white (text != background)', () => {
    const tokensPath = resolve(
      __dirname,
      '..',
      '..',
      'design-system',
      'tokens.css',
    );
    const tokens = readFileSync(tokensPath, 'utf-8');
    const lightBlock = tokens.match(/\[data-theme="light"\]\s*\{([^}]*)\}/);
    expect(lightBlock).not.toBeNull();
    const textPrimaryMatch = lightBlock![1].match(
      /--text-primary\s*:\s*([^;]+);/,
    );
    expect(textPrimaryMatch).not.toBeNull();
    const textPrimaryHex = textPrimaryMatch![1].trim();
    const textPrimaryRgb = parseColor(textPrimaryHex);
    expect(textPrimaryRgb).not.toBeNull();
    expect(textPrimaryRgb).not.toEqual([255, 255, 255]);
  });

  it('span inline color references --text-primary custom property', () => {
    render(wrap(<AppHeader onNavigate={noop} />));
    const span = screen.getByTestId('app-header-app-name') as HTMLElement;
    const style = (span.style as unknown as Record<string, string>);
    expect(style.color).toMatch(/^var\(--text-primary\)$/);
  });
});
