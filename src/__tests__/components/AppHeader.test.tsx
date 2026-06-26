/**
 * Vitest coverage for AppHeader — Phase 27 Fix 1 (BUG-CR-01 P1 重定义).
 *
 * Goal: codify the drag-region contract so the
 * `data-tauri-drag-region` + `WebkitAppRegion: 'drag'` / `no-drag`
 * layering never silently regresses (the user-reported
 * "鼠标按住 header 不能拖动窗口" root cause is suspected to be
 * either a missing drag attribute or a child element accidentally
 * inheriting `drag` from the parent).
 *
 * ## What this locks in
 *
 *   1. `<header>` carries `data-tauri-drag-region=""` AND inline
 *      `WebkitAppRegion: 'drag'` (the two attributes Tauri reads).
 *   2. Every interactive control inside the header (back button,
 *      theme toggle, settings button, window controls cluster) has
 *      `WebkitAppRegion: 'no-drag'` — child override wins over the
 *      parent drag region so a click on a button never gets
 *      swallowed as a drag gesture.
 *
 * If any of these ever regress, this test fails. The contract is
 * documented in `docs/design/M2.9-...` and Phase 27 UI-SPEC
 * "Fix 1: header drag-region contract".
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AppHeader } from '../../components/AppHeader';
import { ThemeProvider } from '../../design-system/ThemeProvider';

// Mock ThemeRegistry (same shim as src/__tests__/AppHeader.test.tsx
// so the theme toggle button can render without a real registry).
vi.mock('../../design-system/ThemeRegistry', () => ({
  listThemes: () => [
    { id: 'light', name: '极简卡片', icon: 'sun', isDefault: true },
    { id: 'anime', name: '二次元', icon: 'sparkles' },
  ],
  getTheme: (id: string) => {
    if (id === 'light') return { id: 'light', name: '极简卡片', icon: 'sun' };
    if (id === 'anime') return { id: 'anime', name: '二次元', icon: 'sparkles' };
    return null;
  },
  getDefaultTheme: () => ({ id: 'light', name: '极简卡片', icon: 'sun', isDefault: true }),
  getNextTheme: (id: string) => (id === 'light'
    ? { id: 'anime', name: '二次元', icon: 'sparkles' }
    : { id: 'light', name: '极简卡片', icon: 'sun' }),
  isRegisteredTheme: (id: string) => id === 'light' || id === 'anime',
}));

const noop = (): void => undefined;
const pageTitle = (_v: string): string => 'Test Page';

function wrap(ui: React.ReactElement): React.ReactElement {
  return <ThemeProvider>{ui}</ThemeProvider>;
}

describe('AppHeader — Fix 1: drag-region contract (Phase 27 BUG-CR-01)', () => {
  it('renders the header element with data-tauri-drag-region attribute', () => {
    render(
      wrap(
        <AppHeader
          currentView="optimizer"
          onNavigate={noop}
          pageTitle={pageTitle}
        />,
      ),
    );
    const header = screen.getByTestId('app-header');
    expect(header.tagName.toLowerCase()).toBe('header');
    expect(header.getAttribute('data-tauri-drag-region')).toBe('');
  });

  it('header element has inline WebkitAppRegion: drag', () => {
    render(
      wrap(
        <AppHeader
          currentView="optimizer"
          onNavigate={noop}
          pageTitle={pageTitle}
        />,
      ),
    );
    const header = screen.getByTestId('app-header') as HTMLElement;
    const style = (header.style as unknown as Record<string, string>);
    // jsdom normalizes -webkit-app-region → WebkitAppRegion in style
    expect(style.WebkitAppRegion ?? style['-webkit-app-region']).toBe('drag');
  });

  it('back button has WebkitAppRegion: no-drag (click must not start drag)', () => {
    render(
      wrap(
        <AppHeader
          currentView="optimizer"
          onNavigate={noop}
          pageTitle={pageTitle}
        />,
      ),
    );
    const back = screen.getByTestId('app-header-back') as HTMLElement;
    const style = (back.style as unknown as Record<string, string>);
    expect(style.WebkitAppRegion ?? style['-webkit-app-region']).toBe(
      'no-drag',
    );
  });

  it('theme toggle button has WebkitAppRegion: no-drag', () => {
    render(
      wrap(
        <AppHeader
          currentView="optimizer"
          onNavigate={noop}
          pageTitle={pageTitle}
        />,
      ),
    );
    const toggle = screen.getByTestId('app-header-theme-toggle') as HTMLElement;
    const style = (toggle.style as unknown as Record<string, string>);
    expect(style.WebkitAppRegion ?? style['-webkit-app-region']).toBe(
      'no-drag',
    );
  });

  it('settings button has WebkitAppRegion: no-drag', () => {
    render(
      wrap(
        <AppHeader
          currentView="optimizer"
          onNavigate={noop}
          pageTitle={pageTitle}
        />,
      ),
    );
    const settings = screen.getByTestId('app-header-settings') as HTMLElement;
    const style = (settings.style as unknown as Record<string, string>);
    expect(style.WebkitAppRegion ?? style['-webkit-app-region']).toBe(
      'no-drag',
    );
  });

  it('does NOT render a back button on the home view (singular drag-region contract)', () => {
    render(
      wrap(
        <AppHeader
          currentView="home"
          onNavigate={noop}
          pageTitle={pageTitle}
        />,
      ),
    );
    expect(screen.queryByTestId('app-header-back')).toBeNull();
    // Header itself still draggable.
    const header = screen.getByTestId('app-header');
    expect(header.getAttribute('data-tauri-drag-region')).toBe('');
  });
});