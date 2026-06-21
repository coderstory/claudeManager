/**
 * ThemeProvider — runtime layer of the design system.
 *
 * M2.16 theme-trim: 主题从 3 档 (light / glass-clear / glass-tinted)
 * 砍到单档 light (瓷白 #FAFAF7)。原因:Win11 Mica 在 Tauri v2 +
 * WebView2 下不生效(详见 lib.rs 决定性验证),3 档视觉几乎没区别,
 * 留着只是误导用户。后期用户可自行新增主题。
 *
 * 保留 setTheme 接口:虽然当前只有 'light' 一档,但接口留着是为了
 * 后期加主题时复用(直接在 Theme union 上加新值即可,不用改
 * AppHeader / settings 等消费方)。
 *
 * 旧 localStorage 值 ('glass-clear' / 'glass-tinted' / 'dark' / 'auto')
 * 在读取时被 isTheme 拒绝,统一 fallback 到 'light',不崩。
 *
 * 实现说明:主题效果纯靠 CSS token (tokens.css 的 :root 定义 light
 * token)。React 层只负责持久化 theme + 把 data-theme 写到 <html>,
 * 不直接碰 Mica / vibrancy (那是 lib.rs 的 apply_mica 干的,保留)。
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

export type Theme = 'light';

export interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

const STORAGE_KEY = 'ccm.theme';

const ThemeProviderContext = createContext<ThemeContextValue | null>(null);

/**
 * isTheme — 把任意字符串(通常来自 localStorage)收窄到 Theme union。
 * 当前只接受 'light';旧版残留的 'glass-clear' / 'glass-tinted' /
 * 'dark' / 'auto' 全部被拒绝,读取时 fallback 到默认 'light',
 * 不让 applyTheme 崩。
 */
function isTheme(value: string | null): value is Theme {
  return value === 'light';
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
    // isTheme 拒绝旧版 'glass-clear' / 'glass-tinted' / 'dark' / 'auto',
    // 升级用户统一回到 'light'。
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

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, setTheme }),
    [theme, setTheme],
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
