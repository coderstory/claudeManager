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
import { ThemeProvider, useTheme, type Theme } from '../../design-system/ThemeProvider';

// --- matchMedia mock (jsdom doesn't ship it) -------------------------------
type Listener = (ev: { matches: boolean }) => void;
const listeners = new Set<Listener>();
let prefersDark = false;
const matchMediaMock = vi.fn((query: string) => {
  if (!query.includes('prefers-color-scheme')) {
    return { matches: false, addEventListener: () => {}, removeEventListener: () => {} } as MediaQueryList;
  }
  return {
    get matches() {
      return prefersDark;
    },
    media: query,
    addEventListener: (_: string, cb: Listener) => {
      listeners.add(cb);
    },
    removeEventListener: (_: string, cb: Listener) => {
      listeners.delete(cb);
    },
    dispatchEvent: () => true,
    onchange: null,
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
function Probe(): JSX.Element {
  const { theme, setTheme } = useTheme();
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
    const { result, rerender } = renderHook(
      ({ children }: { children: React.ReactNode }) => (
        <ThemeProvider>{children}</ThemeProvider>
      ),
      { initialProps: { children: null as React.ReactNode } },
    );
    const firstSetter = result.current.setTheme;
    rerender({ children: null });
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