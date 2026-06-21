/**
 * ThemeProvider — TDD coverage.
 *
 * Verifies the runtime layer of the design system (CLAUDE.md §4.1).
 *
 * M2.16 theme-trim: 主题从 3 档 (light / glass-clear / glass-tinted)
 * 砍到单档 light (瓷白)。原 glass-clear / glass-tinted / 'dark' /
 * 'auto' 旧值在 localStorage 读取时统一 fallback 到 'light'。
 *
 * Coverage:
 *   - default theme = 'light'
 *   - applyTheme writes document.documentElement.dataset.theme
 *   - localStorage persistence under STORAGE_KEY = 'ccm.theme'
 *   - setTheme reference is stable across re-renders
 *   - useTheme throws when used outside the provider
 *   - legacy 'glass-clear' / 'glass-tinted' / 'dark' / 'auto' stored
 *     values fall back to 'light'
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, renderHook, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { ThemeProvider, useTheme, type Theme } from '../../design-system/ThemeProvider';

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

afterEach(() => {
  vi.restoreAllMocks();
});

// --- helpers ----------------------------------------------------------------
function Probe(): ReactElement {
  const { theme, setTheme } = useTheme();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <button data-testid="set-light" onClick={() => setTheme('light')}>
        light
      </button>
    </div>
  );
}

describe('ThemeProvider', () => {
  it('defaults to "light" when localStorage is empty', () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('theme')).toHaveTextContent('light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('reads persisted "light" from localStorage on mount', () => {
    localStorage.setItem('ccm.theme', 'light');
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('theme')).toHaveTextContent('light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('falls back to "light" when stored value is legacy "glass-clear"', () => {
    localStorage.setItem('ccm.theme', 'glass-clear');
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('theme')).toHaveTextContent('light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('falls back to "light" when stored value is legacy "glass-tinted"', () => {
    localStorage.setItem('ccm.theme', 'glass-tinted');
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('theme')).toHaveTextContent('light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('falls back to "light" when stored value is legacy "dark"', () => {
    localStorage.setItem('ccm.theme', 'dark');
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('theme')).toHaveTextContent('light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('falls back to "light" when stored value is legacy "auto"', () => {
    localStorage.setItem('ccm.theme', 'auto');
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('theme')).toHaveTextContent('light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('setTheme("light") updates state, <html data-theme>, and localStorage', () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    act(() => {
      screen.getByTestId('set-light').click();
    });
    expect(screen.getByTestId('theme')).toHaveTextContent('light');
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(localStorage.getItem('ccm.theme')).toBe('light');
  });

  it('keeps the same setTheme reference across re-renders (referential stability)', () => {
    const wrapper = ({ children }: { children: ReactNode }): ReactElement => (
      <ThemeProvider>{children}</ThemeProvider>
    );
    const { result, rerender } = renderHook(() => useTheme(), { wrapper });
    const firstSetter = result.current.setTheme;
    rerender();
    expect(result.current.setTheme).toBe(firstSetter);
  });

  it('useTheme() throws when used outside <ThemeProvider>', () => {
    // Swallow the React error boundary noise from the test runner.
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useTheme())).toThrow(
      /useTheme must be used inside <ThemeProvider>/,
    );
    errSpy.mockRestore();
  });
});

// Type-level sanity check — ensures Theme union stays in sync with what
// the component accepts.
const _exhaustive: Theme = 'light';
void _exhaustive;
