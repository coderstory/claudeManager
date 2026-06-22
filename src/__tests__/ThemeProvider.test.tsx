import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, useTheme } from '../design-system/ThemeProvider';
import type { ReactElement } from 'react';

// Mock ThemeRegistry before ThemeProvider imports it (module-level glob)
vi.mock('../design-system/ThemeRegistry', () => ({
  listThemes: () => [
    { id: 'light', name: '极简卡片', icon: 'sun', isDefault: true },
    { id: 'anime', name: '二次元', icon: 'sparkles' },
  ],
  getTheme: (id: string) => {
    if (id === 'light') return { id: 'light', name: '极简卡片', icon: 'sun', isDefault: true };
    if (id === 'anime') return { id: 'anime', name: '二次元', icon: 'sparkles' };
    return null;
  },
  getDefaultTheme: () => ({ id: 'light', name: '极简卡片', icon: 'sun', isDefault: true }),
  getNextTheme: (id: string) => (id === 'light'
    ? { id: 'anime', name: '二次元', icon: 'sparkles' }
    : { id: 'light', name: '极简卡片', icon: 'sun', isDefault: true }),
  isRegisteredTheme: (id: string) => id === 'light' || id === 'anime',
}));

function Consumer(): ReactElement {
  const { theme, themes, setTheme } = useTheme();
  return (
    <div>
      <span data-testid="current-id">{theme.id}</span>
      <span data-testid="theme-count">{themes.length}</span>
      <button data-testid="switch-anime" onClick={() => setTheme('anime')}>
        switch
      </button>
      <button data-testid="switch-invalid" onClick={() => setTheme('nonexistent')}>
        bad
      </button>
    </div>
  );
}

describe('ThemeProvider', () => {
  beforeEach(() => {
    localStorage.clear();
    if (typeof document !== 'undefined') {
      document.documentElement.removeAttribute('data-theme');
    }
  });

  it('默认主题 id = light', () => {
    render(<ThemeProvider><Consumer /></ThemeProvider>);
    expect(screen.getByTestId('current-id').textContent).toBe('light');
  });

  it('暴露所有注册主题(2 个)', () => {
    render(<ThemeProvider><Consumer /></ThemeProvider>);
    expect(screen.getByTestId('theme-count').textContent).toBe('2');
  });

  it('setTheme("anime") 更新当前主题 + 写 data-theme', async () => {
    render(<ThemeProvider><Consumer /></ThemeProvider>);
    await userEvent.click(screen.getByTestId('switch-anime'));
    expect(screen.getByTestId('current-id').textContent).toBe('anime');
    expect(document.documentElement.dataset.theme).toBe('anime');
    expect(localStorage.getItem('ccm.theme')).toBe('anime');
  });

  it('setTheme 拒绝未注册 id', async () => {
    render(<ThemeProvider><Consumer /></ThemeProvider>);
    await userEvent.click(screen.getByTestId('switch-invalid'));
    expect(screen.getByTestId('current-id').textContent).toBe('light');
  });

  it('读取 localStorage 旧值("glass-clear")fallback 到 light', () => {
    localStorage.setItem('ccm.theme', 'glass-clear');
    render(<ThemeProvider><Consumer /></ThemeProvider>);
    expect(screen.getByTestId('current-id').textContent).toBe('light');
  });

  it('读取 localStorage 有效值("anime")正确恢复', () => {
    localStorage.setItem('ccm.theme', 'anime');
    render(<ThemeProvider><Consumer /></ThemeProvider>);
    expect(screen.getByTestId('current-id').textContent).toBe('anime');
  });
});