/**
 * ThemeProvider — runtime layer of the design system.
 *
 * M2.16 glass refactor: the theme palette was collapsed from
 * light/dark/auto to a 3-way light → glass-clear → glass-tinted cycle.
 *   - 'light'        : solid cream-white (#FAFAF7). Native Mica is
 *                      intentionally covered (this is the "opaque"
 *                      mode — the app looks like a flat light UI).
 *   - 'glass-clear'  : app-root / main transparent. The Win11 Mica /
 *                      macOS vibrancy backdrop shows through directly,
 *                      producing the macOS-Tahoe-like fully clear look.
 *   - 'glass-tinted' : app-root / main rgba(250,250,247,0.7). Mica
 *                      bleeds through but the cream tone is preserved,
 *                      so it reads as "porcelain glass" rather than a
 *                      fully clear pane.
 *
 * 'dark' and 'auto' were removed per user decision — the product no
 * longer ships a dark variant, and there is no OS-follow mode. Old
 * localStorage values ('dark' / 'auto') from previous installs are
 * silently coerced back to 'light' on read (isTheme rejects them).
 *
 * Implementation note: the glass effect is achieved purely through
 * CSS tokens (tokens.css sets --bg-primary per data-theme). The
 * React layer only persists the theme + writes data-theme to <html>;
 * it never touches Mica / vibrancy directly (that's applyEffects.ts).
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

export type Theme = 'light' | 'glass-clear' | 'glass-tinted';

export interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  /**
   * Advance to the next theme in the
   * light → glass-clear → glass-tinted → light cycle. Centralised
   * here so <AppHeader>'s onClick and any future control (toolbar
   * dropdown, settings page toggle, etc.) share one definition of
   * the order.
   */
  cycleTheme: () => void;
}

const STORAGE_KEY = 'ccm.theme';

const ThemeProviderContext = createContext<ThemeContextValue | null>(null);

/**
 * isTheme — narrows an arbitrary string (typically from localStorage)
 * to the Theme union. Crucially, this REJECTS the legacy values
 * 'dark' and 'auto' — anyone upgrading from a pre-M2.16 install
 * gets coerced back to the default ('light') instead of crashing
 * the applyTheme switch.
 */
function isTheme(value: string | null): value is Theme {
  return value === 'light' || value === 'glass-clear' || value === 'glass-tinted';
}

function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.dataset.theme = theme;
}

export function ThemeProvider({ children }: { children: ReactNode }): ReactElement {
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window === 'undefined') return 'light';
    const stored = window.localStorage.getItem(STORAGE_KEY);
    // isTheme rejects legacy 'dark' / 'auto' values, so users who
    // previously stored those fall back to 'light' on first load.
    return isTheme(stored) ? stored : 'light';
  });

  // Persist on every change.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  // Apply the theme to <html data-theme>.
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const setTheme = useCallback((next: Theme): void => {
    setThemeState(next);
  }, []);

  // light → glass-clear → glass-tinted → light cycle. Centralised so
  // <AppHeader> and any future control (settings page dropdown, etc.)
  // share one definition of the order. The closure depends on
  // `theme` (NOT just setThemeState) so each call reads the latest
  // value without needing an explicit functional update.
  const cycleTheme = useCallback((): void => {
    setThemeState((prev) => {
      if (prev === 'light') return 'glass-clear';
      if (prev === 'glass-clear') return 'glass-tinted';
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
