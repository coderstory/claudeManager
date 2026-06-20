/**
 * M2.16 splash — integration coverage for the inline loading screen.
 *
 * ## What this guards
 *
 *   1. The splash DOM node (#ccm-splash) exists in the document so
 *      App.tsx's useEffect has something to hide.
 *   2. After App mounts, the splash gets the .ccm-splash-hidden
 *      class within the 2200ms+tick window declared in App.tsx.
 *   3. After the secondary 300ms timeout, splash.style.display === 'none'.
 *
 * ## Why jsdom + a synthetic splash
 *
 *   index.html is not parsed by jsdom (vitest imports App.tsx
 *   directly via the test setup, bypassing the HTML entry). So we
 *   synthesize the #ccm-splash div in beforeEach to mimic what
 *   Tauri's WebView2 would have on the real exe. The class-name
 *   and display contract we assert on is identical to the inline
 *   CSS declared in index.html.
 *
 * ## Timing slack
 *
 *   The App.tsx useEffect fires at 2200ms + 300ms = 2500ms total
 *   (用户要求 splash 至少展示 2s + 进度条动画). We wait 2500ms before
 *   the class assertion and another 400ms before the display assertion
 *   to absorb jsdom timer jitter without flaking. vitest's fake timers
 *   are deliberately NOT used — we want to exercise the real setTimeout
 *   → classList path end-to-end.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import App from '../../App';
import { ThemeProvider } from '../../design-system/ThemeProvider';

describe('M2.16 ccm-splash', () => {
  beforeEach(() => {
    // Synthesize the splash that index.html would have rendered.
    // Clean any previous instance first so the test is idempotent
    // across multiple runs in the same jsdom document.
    document.getElementById('ccm-splash')?.remove();
    const splash = document.createElement('div');
    splash.id = 'ccm-splash';
    document.body.appendChild(splash);
  });

  it('App mount fades out the splash (hidden class + display none)', async () => {
    render(
      <ThemeProvider>
        <App />
      </ThemeProvider>,
    );

    // Pre-hide sanity: the splash exists and is not yet hidden.
    const beforeSplash = document.getElementById('ccm-splash');
    expect(beforeSplash).not.toBeNull();
    expect(beforeSplash?.classList.contains('ccm-splash-hidden')).toBe(false);

    // App.tsx 在 2200ms 后加 hidden class（用户要求 splash 至少 2s）。
    // 等 2500ms 确保超过 2200ms + 吸收 jsdom 定时器抖动。
    await new Promise((r) => setTimeout(r, 2500));
    const midSplash = document.getElementById('ccm-splash');
    expect(midSplash?.classList.contains('ccm-splash-hidden')).toBe(true);

    // display:none 在 hidden class 之后 300ms 触发。再等 400ms 确保触发。
    await new Promise((r) => setTimeout(r, 400));
    const afterSplash = document.getElementById('ccm-splash');
    expect(afterSplash?.style.display).toBe('none');
  });

  it('splash node is left untouched when App never mounts (failsafe path)', () => {
    // No render() call. This documents the contract: App.tsx is
    // responsible for hiding the splash; without App, the splash
    // stays visible (the index.html <script> failsafe is the
    // backstop, but that's an HTML-layer concern and not exercised
    // by jsdom). If this assertion ever flips, it means something
    // else is mutating #ccm-splash globally.
    const splash = document.getElementById('ccm-splash');
    expect(splash).not.toBeNull();
    expect(splash?.classList.contains('ccm-splash-hidden')).toBe(false);
    expect(splash?.style.display).toBe('');
  });
});
