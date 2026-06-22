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
import { listThemes, getTheme, getDefaultTheme, isRegisteredTheme } from './ThemeRegistry';
import type { ThemeId, ThemeMeta } from './themeTypes';

export type { ThemeId, ThemeMeta } from './themeTypes';

export interface ThemeContextValue {
  theme: ThemeMeta;
  themes: ThemeMeta[];
  setTheme: (id: ThemeId) => void;
}

const STORAGE_KEY = 'ccm.theme';

const ThemeProviderContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }): ReactElement {
  const [themeId, setThemeId] = useState<ThemeId>(() => {
    if (typeof window === 'undefined') return getDefaultTheme().id;
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored !== null && isRegisteredTheme(stored) ? stored : getDefaultTheme().id;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(STORAGE_KEY, themeId);
  }, [themeId]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.dataset.theme = themeId;
  }, [themeId]);

  const theme = useMemo(
    () => getTheme(themeId) ?? getDefaultTheme(),
    [themeId],
  );
  const themes = useMemo(() => listThemes(), []);

  const setTheme = useCallback((id: ThemeId) => {
    if (isRegisteredTheme(id)) setThemeId(id);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, themes, setTheme }),
    [theme, themes, setTheme],
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
