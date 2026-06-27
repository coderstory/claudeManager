import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { ThemeProvider, useTheme } from '../../design-system/ThemeProvider';
import { THEME_IDS } from '../../design-system/themes/themeIds';

describe('ThemeProvider 切换', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.dataset.theme = '';
  });

  it('默认主题是 light', () => {
    const { result } = renderHook(() => useTheme(), { wrapper: ThemeProvider });
    expect(result.current.theme.id).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('setTheme 切换到 liquid-glass', () => {
    const { result } = renderHook(() => useTheme(), { wrapper: ThemeProvider });
    act(() => result.current.setTheme(THEME_IDS.LiquidGlass));
    expect(result.current.theme.id).toBe('liquid-glass');
    expect(document.documentElement.dataset.theme).toBe('liquid-glass');
  });

  it('5 主题都能切换', () => {
    const { result } = renderHook(() => useTheme(), { wrapper: ThemeProvider });
    for (const id of Object.values(THEME_IDS)) {
      act(() => result.current.setTheme(id));
      expect(document.documentElement.dataset.theme).toBe(id);
    }
  });

  it('localStorage 持久化主题', () => {
    const { result } = renderHook(() => useTheme(), { wrapper: ThemeProvider });
    act(() => result.current.setTheme(THEME_IDS.Dark));
    expect(localStorage.getItem('ccm.theme')).toBe('dark');
  });
});

describe('ThemeProvider URL ?theme=xxx 优先级', () => {
  let originalLocation: Location;

  beforeEach(() => {
    localStorage.clear();
    document.documentElement.dataset.theme = '';
    originalLocation = window.location;
  });

  afterEach(() => {
    // 恢复 window.location 到 jsdom 默认 (about:blank)
    Object.defineProperty(window, 'location', {
      value: originalLocation,
      writable: true,
      configurable: true,
    });
  });

  function setSearch(search: string): void {
    // 模拟 URL query string — jsdom 不允许改 window.location.search, 用 history.replaceState
    const url = new URL(window.location.href);
    url.search = search;
    window.history.replaceState({}, '', url.toString());
  }

  it('URL ?theme=editorial 覆盖 localStorage dark', () => {
    localStorage.setItem('ccm.theme', 'dark');
    setSearch('?theme=editorial');
    const { result } = renderHook(() => useTheme(), { wrapper: ThemeProvider });
    expect(result.current.theme.id).toBe('editorial');
    expect(document.documentElement.dataset.theme).toBe('editorial');
  });

  it('URL ?theme=light (无 localStorage) 用 URL 值', () => {
    setSearch('?theme=light');
    const { result } = renderHook(() => useTheme(), { wrapper: ThemeProvider });
    expect(result.current.theme.id).toBe('light');
  });

  it('URL 非法 id 静默 fallback 到 localStorage', () => {
    localStorage.setItem('ccm.theme', 'dark');
    setSearch('?theme=non-existent-theme');
    const { result } = renderHook(() => useTheme(), { wrapper: ThemeProvider });
    expect(result.current.theme.id).toBe('dark');
  });

  it('URL 非法 id 且无 localStorage fallback 到默认 light', () => {
    setSearch('?theme=non-existent-theme');
    const { result } = renderHook(() => useTheme(), { wrapper: ThemeProvider });
    expect(result.current.theme.id).toBe('light');
  });

  it('无 URL param + 无 localStorage → 默认 light', () => {
    setSearch('');
    const { result } = renderHook(() => useTheme(), { wrapper: ThemeProvider });
    expect(result.current.theme.id).toBe('light');
  });
});