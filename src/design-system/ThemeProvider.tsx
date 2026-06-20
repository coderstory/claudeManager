/**
 * ThemeProvider — runtime layer of the design system.
 *
 * Mirrors cc-switch's theme-provider interface (CLAUDE.md §4.1 +
 * D:\project\cc-switch-main\src\components\theme-provider.tsx) but
 * writes to `documentElement.dataset.theme` (the mechanism our
 * `tokens.css` dark-mode block already keys off) rather than
 * `classList`, and uses the project-scoped storage key `ccm.theme`.
 *
 *  - default theme = 'light'
 *  - persistence via localStorage under STORAGE_KEY
 *  - 'auto' resolves to OS preference and re-resolves on change
 *  - setTheme reference is stable (memoised via useCallback)
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';

export type Theme = 'light' | 'dark' | 'auto';

export interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  /**
   * Advance to the next theme in the light → dark → auto → light
   * cycle. M2.10 F12 polish — centralised here (was previously
   * duplicated in <AppHeader>'s onClick) so any future control
   * (toolbar dropdown, settings page toggle, etc.) can call it
   * without re-implementing the order.
   */
  cycleTheme: () => void;
}

const STORAGE_KEY = 'ccm.theme';

const ThemeProviderContext = createContext<ThemeContextValue | null>(null);

function isTheme(value: string | null): value is Theme {
  return value === 'light' || value === 'dark' || value === 'auto';
}

function readSystemTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'light';
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.dataset.theme = theme === 'auto' ? readSystemTheme() : theme;
}

export function ThemeProvider({ children }: { children: ReactNode }): ReactElement {
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window === 'undefined') return 'light';
    const stored = window.localStorage.getItem(STORAGE_KEY);
    // M1.11 fix (F-1.04 / BP-3.01): if the persisted value is 'auto',
    // resolve to the system theme NOW so the first render paints with
    // the correct data-theme. Previously the initial state was the
    // literal string 'auto', leaving documentElement.dataset.theme
    // unset until the useEffect ran on the next render.
    if (stored === 'auto') return 'auto';
    return isTheme(stored) ? stored : 'light';
  });

  // Persist on every change.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  // Apply the resolved theme to <html data-theme>.
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // In 'auto' mode, follow OS-level changes.
  useEffect(() => {
    if (theme !== 'auto') return;
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (): void => {
      applyTheme('auto');
    };
    mq.addEventListener('change', handler);
    return () => {
      mq.removeEventListener('change', handler);
    };
  }, [theme]);

  const setTheme = useCallback((next: Theme): void => {
    setThemeState(next);
  }, []);

  // M2.10 F12 — light → dark → auto → light cycle. Centralised so
  // <AppHeader> and any future control (settings page dropdown, etc.)
  // share one definition of the order. The closure depends on
  // `theme` (NOT just setThemeState) so each call reads the latest
  // value without needing an explicit functional update.
  const cycleTheme = useCallback((): void => {
    setThemeState((prev) => {
      if (prev === 'light') return 'dark';
      if (prev === 'dark') return 'auto';
      return 'light';
    });
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, setTheme, cycleTheme }),
    [theme, setTheme, cycleTheme],
  );

  return (
    <ThemeProviderContext.Provider value={value}>
      {children}
    </ThemeProviderContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeProviderContext);
  if (ctx === null) {
    throw new Error('useTheme must be used inside <ThemeProvider>');
  }
  return ctx;
}