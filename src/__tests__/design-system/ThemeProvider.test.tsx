/**
 * ThemeProvider — TDD coverage.
 *
 * Verifies the runtime layer of the design system (CLAUDE.md §4.1):
 *   - default theme = 'light'
 *   - applyTheme writes document.documentElement.dataset.theme
 *   - 'auto' resolves to OS preference via matchMedia
 *   - localStorage persistence under STORAGE_KEY = 'ccm.theme'
 *   - setTheme reference is stable across re-renders
 *   - useTheme throws when used outside the provider
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, renderHook, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { ThemeProvider, useTheme, type Theme } from '../../design-system/ThemeProvider';

// --- matchMedia mock (jsdom doesn't ship it) -------------------------------
type Listener = (ev: { matches: boolean }) => void;
const listeners = new Set<Listener>();
let prefersDark = false;
const matchMediaMock = vi.fn((query: string): MediaQueryList => {
  if (!query.includes('prefers-color-scheme')) {
    return {
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => true,
    } as unknown as MediaQueryList;
  }
  return {
    get matches() {
      return prefersDark;
    },
    media: query,
    onchange: null,
    addEventListener: (_: string, cb: Listener) => {
      listeners.add(cb);
    },
    removeEventListener: (_: string, cb: Listener) => {
      listeners.delete(cb);
    },
    dispatchEvent: () => true,
    addListener: () => {},
    removeListener: () => {},
  } as unknown as MediaQueryList;
});

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  prefersDark = false;
  listeners.clear();
  // Replace the global matchMedia for the duration of the test.
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: matchMediaMock,
  });
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
      <button data-testid="set-dark" onClick={() => setTheme('dark')}>
        dark
      </button>
      <button data-testid="set-auto" onClick={() => setTheme('auto')}>
        auto
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
    localStorage.setItem('ccm.theme', 'dark');
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('theme')).toHaveTextContent('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('setTheme("dark") updates state, <html data-theme>, and localStorage', () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    act(() => {
      screen.getByTestId('set-dark').click();
    });
    expect(screen.getByTestId('theme')).toHaveTextContent('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem('ccm.theme')).toBe('dark');
  });

  it('setTheme("auto") resolves to OS preference via matchMedia', () => {
    prefersDark = true;
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    act(() => {
      screen.getByTestId('set-auto').click();
    });
    // OS says dark → dataset.theme should be 'dark'.
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(screen.getByTestId('theme')).toHaveTextContent('auto');
  });

  it('reacts to OS theme change while in "auto" mode', () => {
    prefersDark = false;
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    act(() => {
      screen.getByTestId('set-auto').click();
    });
    expect(document.documentElement.dataset.theme).toBe('light');

    // Simulate the OS flipping to dark.
    prefersDark = true;
    act(() => {
      for (const cb of listeners) cb({ matches: true });
    });
    expect(document.documentElement.dataset.theme).toBe('dark');
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
  // M2.10 F12 — cycleTheme advances light → dark → auto → light.
  //
  // Why these cases exist separately from setTheme: the previous
  // AppHeader onClick inline-implemented the same ternary and was
  // the only consumer of `auto` ever clicking the theme button. Now
  // that cycleTheme is centralised in ThemeProvider, it has its
  // own contract that must be pinned: starting from each of the 3
  // possible values, the next click should land on the right next
  // one (and the resolved <html data-theme> should update too).
  // -------------------------------------------------------------------------
  it('cycleTheme_light_to_dark', () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('theme')).toHaveTextContent('light');
    act(() => {
      screen.getByTestId('cycle').click();
    });
    expect(screen.getByTestId('theme')).toHaveTextContent('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('cycleTheme_dark_to_auto', () => {
    // Start at dark so the next cycle lands on auto.
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    act(() => {
      screen.getByTestId('set-dark').click();
    });
    expect(screen.getByTestId('theme')).toHaveTextContent('dark');
    act(() => {
      screen.getByTestId('cycle').click();
    });
    // State reports 'auto'; resolved <html data-theme> depends on
    // matchMedia. jsdom's matchMedia mock returns prefersDark=false
    // by default, so the resolved value is 'light'.
    expect(screen.getByTestId('theme')).toHaveTextContent('auto');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('cycleTheme_auto_to_light', () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    act(() => {
      screen.getByTestId('set-auto').click();
    });
    expect(screen.getByTestId('theme')).toHaveTextContent('auto');
    act(() => {
      screen.getByTestId('cycle').click();
    });
    expect(screen.getByTestId('theme')).toHaveTextContent('light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('cycleTheme_three_clicks_returns_to_initial_state', () => {
    // Pin the full cycle: light → dark → auto → light.
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('theme')).toHaveTextContent('light');
    act(() => screen.getByTestId('cycle').click());
    expect(screen.getByTestId('theme')).toHaveTextContent('dark');
    act(() => screen.getByTestId('cycle').click());
    expect(screen.getByTestId('theme')).toHaveTextContent('auto');
    act(() => screen.getByTestId('cycle').click());
    expect(screen.getByTestId('theme')).toHaveTextContent('light');
  });
});

// Type-level sanity check — ensures Theme union stays in sync with what
// the component accepts.
const _exhaustive: Theme = 'light';
void _exhaustive;