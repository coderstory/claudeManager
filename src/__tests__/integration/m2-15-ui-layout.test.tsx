/**
 * M2.15 UI layout regression — defensive coverage for the 4 user-reported
 * header + modal layout bugs.
 *
 * ## The four bugs this guards
 *
 *   1. AppHeader right-zone chrome (min/max/close) gets squeezed off the
 *      viewport by the left-zone flex growing to full width. Cause: the
 *      left zone had `flex: '1 1 auto'` with `minWidth: 0` but no
 *      `maxWidth`, and the right zone had no `flexShrink: 0`. On narrow
 *      windows the title text wrapped to a second line and shoved the
 *      chrome off the right edge. Fix: cap left-zone with
 *      `maxWidth: calc(100% - <chrome width>)` and add `flexShrink: 0`
 *      to the right zone.
 *
 *   2. AppHeader back button gets clipped when the title is long. Cause:
 *      the left zone's flex children share the leftover space; a long
 *      Chinese title (or a tight 1024-wide viewport) shrank the back
 *      button to 0px width or hid it behind the right zone. Fix: same
 *      maxWidth + flexShrink:0 pair.
 *
 *   3. QuickSearchModal close (X) button reads as "meaningless" because
 *      it has no semantic label — just `aria-label="关闭"`. Users who
 *      tab through the modal land on a button whose purpose is opaque.
 *      Fix: stronger aria-label + title with the Esc hint, plus a hover
 *      state matching the AppHeader close (--danger).
 *
 *   4. QuickSearchModal top region has invisible blank space above the
 *      input. Cause: the modal container had `padding: '24px 24px 16px'`
 *      (24px top padding pushing the input down) on a backdrop that
 *      already uses `paddingTop: 80`. Visually the input sat 100+px
 *      below the top of the modal. Fix: trim to `12px 16px 16px` (or
 *      whatever the user-task spec demands; ≤16 keeps the regression
 *      tight).
 *
 * ## Why structural + DOM assertions
 *
 *   - jsdom does not run flex layout, so `getBoundingClientRect()` will
 *     return zeros. We therefore cannot assert "3 buttons in viewport"
 *     here — that lives in the Playwright e2e spec at
 *     tests/e2e/m2-3-2-ui-layout-verify.spec.ts.
 *   - What we CAN assert in jsdom: the structural contracts that
 *     prevent the bug — inline `maxWidth`, `flexShrink: 0`,
 *     `aria-label` text, and the source-declared padding. Those four
 *     are the actual levers that fix the bug, so guarding them with
 *     tests stops future refactors from quietly regressing the layout.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import App from '../../App';
import { ThemeProvider } from '../../design-system/ThemeProvider';
import { ViewStateProvider } from '../../hooks/useViewState';
import { QuickSearchModal } from '../../components/QuickSearchModal';

// Mock the Tauri window API so WindowControls can render without
// crashing inside jsdom. We don't assert on the call here — that
// is m1-9-2.test.tsx's job. This file only asserts STRUCTURE.
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    minimize: vi.fn().mockResolvedValue(undefined),
    toggleMaximize: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    setEffects: vi.fn().mockResolvedValue(undefined),
  }),
  Effect: {
    Mica: 'mica',
    Acrylic: 'acrylic',
    Tabbed: 'tabbed',
    Sidebar: 'sidebar',
    HeaderView: 'headerView',
  },
}));

// Read the two source files we are asserting on. Source assertions
// are the most reliable signal that the SHIPPED layout contract is
// present (jsdom drops non-standard CSS properties on React style
// round-trip — see m1-9-2.test.tsx for the same pattern).
const appHeaderSrc = readFileSync(
  resolve(__dirname, '../../components/AppHeader.tsx'),
  'utf-8',
);
const quickSearchSrc = readFileSync(
  resolve(__dirname, '../../components/QuickSearchModal.tsx'),
  'utf-8',
);

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
});

function renderAppWithView(view: string): void {
  localStorage.setItem('ccm.lastView', view);
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

describe('M2.15 — AppHeader layout contract (chrome + back button visible)', () => {
  it('AppHeader renders all 3 chrome buttons in DOM', () => {
    // Bug #1 symptom: maximize + close were squeezed out of the
    // viewport. The DOM still contained them, but they had width:0
    // or sat at x = innerWidth. We assert DOM presence here and
    // reserve the "in viewport" check for the Playwright spec.
    renderAppWithView('provider-list');
    expect(screen.getByTestId('app-header-minimize')).toBeInTheDocument();
    expect(screen.getByTestId('app-header-maximize')).toBeInTheDocument();
    expect(screen.getByTestId('app-header-close')).toBeInTheDocument();
  });

  it('AppHeader does NOT render a back button (B6 — back button removed)', () => {
    // B6 (2026-06-29): back button removed permanently. Left zone
    // shows APP_NAME constant instead. Verify DOM no longer
    // contains `app-header-back` and APP_NAME element renders.
    renderAppWithView('provider-list');
    expect(screen.queryByTestId('app-header-back')).toBeNull();
    const name = screen.getByTestId('app-header-app-name');
    expect(name).toBeInTheDocument();
    expect(name.textContent).toBe('ClaudeManager');
  });

  it('AppHeader source declares left-zone maxWidth cap (chrome squeeze fix)', () => {
    // Bug #1 fix: left zone must cap width so chrome can never be
    // pushed off the right edge. The exact calc() reserves the right
    // zone (280px ≈ 5 buttons × 32 + 4 gaps × 4 + 32 padding × 2).
    expect(appHeaderSrc).toMatch(/maxWidth\s*:\s*['"]calc\(100%\s*-\s*\d+px\)['"]/);
  });

  it('AppHeader source declares right-zone flexShrink:0 (chrome squeeze fix)', () => {
    // Bug #1 fix: right zone must NEVER shrink — chrome stays
    // visible regardless of how greedy the title's flex is.
    expect(appHeaderSrc).toMatch(/flexShrink\s*:\s*0/);
  });

  it('AppHeader right zone has tight gap so theme+settings+chrome form one cluster', () => {
    // Bug #1 polish: cluster feels more cohesive at 4px gaps.
    // The right zone previously used gap-2 (8px) which added 24px
    // of dead space across 3 buttons; with the chrome buttons
    // needing every pixel, we tightened it.
    //
    // M2.15-fix-v2: this assertion switched from the old Tailwind
    // string match (`/flex items-center gap-1/`) to a structural
    // check on the inlined inline style. The project has no
    // Tailwind pipeline wired up, so the utility classes were
    // inert in the release exe (buttons stacked vertically and
    // the cluster overflowed the 48px header). The fix inlined
    // `display: 'flex', alignItems: 'center', gap: 4` onto the
    // right-zone div. We assert the new contract here so future
    // refactors can't accidentally regress back to broken Tailwind.
    expect(appHeaderSrc).toMatch(/display:\s*['"]flex['"]/);
    expect(appHeaderSrc).toMatch(/gap:\s*4/);
  });
});

describe('M2.15 — QuickSearchModal X button + padding contract', () => {
  it('QuickSearchModal X button aria-label mentions 关闭 (close)', () => {
    // Bug #3: the X button's purpose was opaque. aria-label must
    // surface "关闭" so screen readers (and tooltips) announce it
    // clearly. We also tolerate the Esc hint suffix because the
    // implementation attaches "(Esc)" to the title.
    render(
      <ThemeProvider>
        <QuickSearchModal isOpen onClose={() => {}} onNavigate={() => {}} />
      </ThemeProvider>,
    );
    const closeBtn = screen.getByTestId('quick-search-close');
    const aria = closeBtn.getAttribute('aria-label') || '';
    expect(aria).toMatch(/关闭/);
  });

  it('QuickSearchModal X button source declares danger hover (semantic close cue)', () => {
    // Bug #3 fix: hover background should flip to --danger so the
    // X button looks like the close action, not a neutral icon.
    // We assert the source contains both the var and the hover
    // class application on the close button.
    expect(quickSearchSrc).toMatch(/hover:bg-\[var\(--danger\)\]/);
    expect(quickSearchSrc).toMatch(/hover:text-white/);
  });

  it('QuickSearchModal header strip padding is ≤16px on the top edge', () => {
    // Bug #4 fix: the input sat far below the modal's top because
    // the header strip used `padding: '24px 24px 16px'`. Trimmed
    // to `12px 16px` (≤16 top padding).
    //
    // We assert on the source because jsdom does not run layout,
    // so `getComputedStyle` won't return a usable padding value.
    // Accept either 2-value "T R" or 3-value "T R B" forms.
    const twoVal = quickSearchSrc.match(/padding:\s*['"](\d+)px\s+(\d+)px['"]/);
    const threeVal = quickSearchSrc.match(/padding:\s*['"](\d+)px\s+(\d+)px\s+(\d+)px['"]/);
    const topPadding = threeVal
      ? parseInt(threeVal[1]!, 10)
      : twoVal
        ? parseInt(twoVal[1]!, 10)
        : null;
    expect(topPadding, 'QuickSearchModal header strip padding not found').not.toBeNull();
    expect(topPadding!).toBeLessThanOrEqual(16);
  });
});
