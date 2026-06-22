import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppHeader } from '../components/AppHeader';
import { ThemeProvider } from '../design-system/ThemeProvider';
import type { ViewId } from '../hooks/useViewState';

// Mock ThemeRegistry (同 Task 4)
vi.mock('../design-system/ThemeRegistry', () => ({
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

const pageTitle = (_v: ViewId) => 'Test Page';

describe('AppHeader theme toggle', () => {
  beforeEach(() => localStorage.clear());

  it('渲染主题切换按钮', () => {
    render(
      <ThemeProvider>
        <AppHeader currentView="home" onNavigate={vi.fn()} pageTitle={pageTitle} />
      </ThemeProvider>
    );
    expect(screen.getByTestId('app-header-theme-toggle')).toBeDefined();
  });

  it('点击切换按钮改变 data-theme', async () => {
    render(
      <ThemeProvider>
        <AppHeader currentView="home" onNavigate={vi.fn()} pageTitle={pageTitle} />
      </ThemeProvider>
    );
    const btn = screen.getByTestId('app-header-theme-toggle');
    expect(document.documentElement.dataset.theme).toBe('light');
    await userEvent.click(btn);
    expect(document.documentElement.dataset.theme).toBe('anime');
    await userEvent.click(btn);
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('切换按钮有 title 提示', () => {
    render(
      <ThemeProvider>
        <AppHeader currentView="home" onNavigate={vi.fn()} pageTitle={pageTitle} />
      </ThemeProvider>
    );
    const btn = screen.getByTestId('app-header-theme-toggle');
    expect(btn.getAttribute('title')).toContain('切换');
  });
});