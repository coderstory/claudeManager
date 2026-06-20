/**
 * ThemeProvider — TDD coverage.
 *
 * Verifies the runtime layer of the design system (CLAUDE.md §4.1).
 *
 * M2.16 glass refactor: the palette is now a 3-way
 *   light → glass-clear → glass-tinted → light cycle.
 * 'dark' / 'auto' were removed; legacy localStorage values must
 * fall back to 'light'.
 *
 * Coverage:
 *   - default theme = 'light'
 *   - applyTheme writes document.documentElement.dataset.theme
 *   - localStorage persistence under STORAGE_KEY = 'ccm.theme'
 *   - setTheme reference is stable across re-renders
 *   - useTheme throws when used outside the provider
 *   - cycleTheme advances through all 3 themes
 *   - legacy 'dark' / 'auto' stored values fall back to 'light'
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
  const { theme, setTheme, cycleTheme } = useTheme();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <button data-testid="set-light" onClick={() => setTheme('light')}>
        light
      </button>
      <button data-testid="set-glass-clear" onClick={() => setTheme('glass-clear')}>
        glass-clear
      </button>
      <button data-testid="set-glass-tinted" onClick={() => setTheme('glass-tinted')}>
        glass-tinted
      </button>
      <button data-testid="cycle" onClick={() => cycleTheme()}>
        cycle
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

  it('reads persisted theme from localStorage on mount', () => {
    localStorage.setItem('ccm.theme', 'glass-tinted');
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('theme')).toHaveTextContent('glass-tinted');
    expect(document.documentElement.dataset.theme).toBe('glass-tinted');
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

  it('setTheme("glass-clear") updates state, <html data-theme>, and localStorage', () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    act(() => {
      screen.getByTestId('set-glass-clear').click();
    });
    expect(screen.getByTestId('theme')).toHaveTextContent('glass-clear');
    expect(document.documentElement.dataset.theme).toBe('glass-clear');
    expect(localStorage.getItem('ccm.theme')).toBe('glass-clear');
  });

  it('setTheme("glass-tinted") updates state, <html data-theme>, and localStorage', () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    act(() => {
      screen.getByTestId('set-glass-tinted').click();
    });
    expect(screen.getByTestId('theme')).toHaveTextContent('glass-tinted');
    expect(document.documentElement.dataset.theme).toBe('glass-tinted');
    expect(localStorage.getItem('ccm.theme')).toBe('glass-tinted');
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

  // -------------------------------------------------------------------------
  // M2.16 glass refactor — cycleTheme advances
  //   light → glass-clear → glass-tinted → light.
  //
  // The cycle is centralised in ThemeProvider so <AppHeader> and any
  // future control (settings dropdown, etc.) share one definition of
  // the order. Each test starts from a known theme and verifies the
  // next click lands on the right value (and that the resolved
  // <html data-theme> updates too).
  // -------------------------------------------------------------------------
  it('cycleTheme_light_to_glass_clear', () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('theme')).toHaveTextContent('light');
    act(() => {
      screen.getByTestId('cycle').click();
    });
    expect(screen.getByTestId('theme')).toHaveTextContent('glass-clear');
    expect(document.documentElement.dataset.theme).toBe('glass-clear');
  });

  it('cycleTheme_glass_clear_to_glass_tinted', () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    act(() => {
      screen.getByTestId('set-glass-clear').click();
    });
    expect(screen.getByTestId('theme')).toHaveTextContent('glass-clear');
    act(() => {
      screen.getByTestId('cycle').click();
    });
    expect(screen.getByTestId('theme')).toHaveTextContent('glass-tinted');
    expect(document.documentElement.dataset.theme).toBe('glass-tinted');
  });

  it('cycleTheme_glass_tinted_to_light', () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    act(() => {
      screen.getByTestId('set-glass-tinted').click();
    });
    expect(screen.getByTestId('theme')).toHaveTextContent('glass-tinted');
    act(() => {
      screen.getByTestId('cycle').click();
    });
    expect(screen.getByTestId('theme')).toHaveTextContent('light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('cycleTheme_three_clicks_returns_to_initial_state', () => {
    // Pin the full cycle: light → glass-clear → glass-tinted → light.
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('theme')).toHaveTextContent('light');
    act(() => screen.getByTestId('cycle').click());
    expect(screen.getByTestId('theme')).toHaveTextContent('glass-clear');
    act(() => screen.getByTestId('cycle').click());
    expect(screen.getByTestId('theme')).toHaveTextContent('glass-tinted');
    act(() => screen.getByTestId('cycle').click());
    expect(screen.getByTestId('theme')).toHaveTextContent('light');
  });
});

// Type-level sanity check — ensures Theme union stays in sync with what
// the component accepts.
const _exhaustive: Theme = 'light';
void _exhaustive;
