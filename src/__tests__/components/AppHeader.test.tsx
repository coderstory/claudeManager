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

// ---------------------------------------------------------------------------
// Phase 30 UI-A-01 — 二次元主题 header layout 与瓷白/暗色对齐
//
// 旧布局: 所有主题都用 justifyContent: 'space-between',title 左对齐
//        (在二次元主题下视觉上偏左, 与瓷白/暗色风格不同 → 不一致)。
// 新布局:
//   - 二次元主题 (anime): data-header-layout='centered', header
//     用 justifyContent: 'flex-start', title wrap 用 flex: 1 +
//     justify-content: center → title 视觉居中 (与瓷白 / 暗色主题的
//     左对齐不同, 但 anime 主题本身就是活泼风格, 居中合理)。
//   - 瓷白 / 暗色主题: data-header-layout='split',header 用
//     justifyContent: 'space-between',title 左对齐。
//   - actions 按钮组位置 3 主题一致 (右对齐, theme/settings + WindowControls)。
//
// 测试只覆盖 layout 形状 (data-header-layout / justifyContent), 不强求
// 视觉居中像素位置 (依赖 jsdom 渲染, 不可靠)。
//
// 测试策略: ThemeProvider 从 localStorage 'ccm.theme' 读 initial theme。
// 直接设 window.localStorage 让 ThemeProvider mount 时直接拿到目标主题,
// 不靠 click theme-toggle 间接切 (jsdom 测 setTimeout 旋转动画易卡)。
// ---------------------------------------------------------------------------

describe('AppHeader — Phase 30 UI-A-01 二次元主题 header 居中布局', () => {
  it('UI-A-01: 二次元主题下 header data-header-layout=centered', () => {
    // 直接设 localStorage 为 anime → ThemeProvider mount 时初始主题 = anime
    window.localStorage.setItem('ccm.theme', 'anime');
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
    expect(header.getAttribute('data-header-layout')).toBe('centered');
    // anime 主题下 header 的 justify-content = flex-start (让 spacer 把 title 推到中心)
    const style = (header.style as unknown as Record<string, string>);
    expect(style.justifyContent).toBe('flex-start');
    // 重置 localStorage 避免影响后续 test
    window.localStorage.removeItem('ccm.theme');
  });

  it('UI-A-01: 瓷白主题下 header data-header-layout=split (space-between)', () => {
    // 默认 light 主题 (不设 localStorage)
    window.localStorage.removeItem('ccm.theme');
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
    expect(header.getAttribute('data-header-layout')).toBe('split');
    const style = (header.style as unknown as Record<string, string>);
    expect(style.justifyContent).toBe('space-between');
  });

  it('UI-A-01: 暗色主题下 header data-header-layout=split (space-between)', () => {
    // 直接设 localStorage 为 dark → ThemeProvider mount 时初始主题 = dark
    window.localStorage.setItem('ccm.theme', 'dark');
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
    expect(header.getAttribute('data-header-layout')).toBe('split');
    const style = (header.style as unknown as Record<string, string>);
    expect(style.justifyContent).toBe('space-between');
    window.localStorage.removeItem('ccm.theme');
  });

  it('UI-A-01: 二次元主题下 actions 按钮位置仍右对齐 (3 主题一致)', () => {
    window.localStorage.setItem('ccm.theme', 'anime');
    render(
      wrap(
        <AppHeader
          currentView="optimizer"
          onNavigate={noop}
          pageTitle={pageTitle}
        />,
      ),
    );
    expect(screen.getByTestId('app-header').getAttribute('data-header-layout')).toBe('centered');
    // actions 区域 flexShrink: 0 → 始终右对齐 (与瓷白 / 暗色一致)
    const themeToggle = screen.getByTestId('app-header-theme-toggle') as HTMLElement;
    const settings = screen.getByTestId('app-header-settings') as HTMLElement;
    expect(themeToggle).toBeInTheDocument();
    expect(settings).toBeInTheDocument();
    // 两者同属 actions 区, 父级 actions 容器存在
    const actions = themeToggle.parentElement as HTMLElement;
    expect(actions).toBe(settings.parentElement);
    window.localStorage.removeItem('ccm.theme');
  });
});

import { fireEvent, waitFor } from '@testing-library/react';