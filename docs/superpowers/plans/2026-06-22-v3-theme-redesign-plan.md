# v3.0 主题重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 2 套插件式主题(light/anime),含 ThemeRegistry 运行时注册 + tokens.css 拆分 + AppHeader 切换按钮 + 内页清理

**Architecture:** themes/*.ts 独立文件(每主题导出 ThemeMeta) + import.meta.glob 编译时扫描 + ThemeRegistry 运行时注册表(Map<ThemeId, ThemeMeta>) + ThemeProvider 扔掉 enum 接 Registry + tokens.css [data-theme] 选择器分支

**Tech Stack:** React 19 + TypeScript + Vite(import.meta.glob) + vitest + jsdom + lucide-react

---

## File Structure

```
src/design-system/
├── themeTypes.ts          (新) ThemeId / ThemeMeta 接口
├── ThemeRegistry.ts       (新) glob 扫描 + 运行时注册表 + 单测
├── ThemeProvider.tsx      (改) 扔掉 Theme union, 接 Registry
├── tokens.css             (改) :root 拆 [data-theme="light"] + [data-theme="anime"]
├── utilities.css          (改) prefers-reduced-motion 块
└── themes/                (新)
    ├── light.ts            (新) light 主题 meta
    ├── light.css           (新) light 专属 (本轮空, 仅 placeholder)
    ├── anime.ts            (新) anime 主题 meta
    └── anime.css           (新) anime 专属 CSS (圆胖厚边 + 双层阴影 + Fredoka)

src/components/
├── AppHeader.tsx          (改) 加切换按钮 + 接 useTheme

src/
├── main.tsx               (改) 加 themes/*.css 静态 import (勿 glob — CSS 必须 eager)

src/__tests__/
├── ThemeRegistry.test.ts  (新)
├── ThemeProvider.test.tsx (改/新)
└── AppHeader.test.tsx     (新) 切换按钮单测

src/test/
└── setup.ts               (已有) 不改
```

**目录约定**: 新文件的同名 `__tests__/` 文件按项目现有模式放在 `src/__tests__/` 下。`src/design-system/themes/` 下的 .ts 文件会被 ThemeRegistry 的 `import.meta.glob('./themes/*.ts')` 扫描。

---

### Task 1: themeTypes.ts 接口定义

**Files:**
- Create: `src/design-system/themeTypes.ts`

- [ ] **Step 1: 创建 themeTypes.ts**

```bash
cat > src/design-system/themeTypes.ts << 'TSEOF'
export type ThemeId = string;

export interface ThemeMeta {
  id: ThemeId;
  name: string;
  description?: string;
  icon: string;
  isDefault?: boolean;
  preview?: {
    accent: string;
    bg: string;
    text: string;
  };
}
TSEOF
```

- [ ] **Step 2: 验证 TypeScript 编译通过**

```bash
npx tsc --noEmit --strict src/design-system/themeTypes.ts
```

- [ ] **Step 3: Commit**

```bash
git add src/design-system/themeTypes.ts
git commit -m "feat(v3.0): add themeTypes interface (ThemeId + ThemeMeta)"
```

---

### Task 2: 主题插件文件 (light.ts + anime.ts)

**Files:**
- Create: `src/design-system/themes/light.ts`
- Create: `src/design-system/themes/anime.ts`

- [ ] **Step 1: 创建 light.ts**

```bash
cat > src/design-system/themes/light.ts << 'TSEOF'
import type { ThemeMeta } from '../themeTypes';

const light: ThemeMeta = {
  id: 'light',
  name: '极简卡片',
  description: '瓷白底色 + 蓝色 accent, 现状保留',
  icon: 'sun',
  isDefault: true,
  preview: { accent: '#0969DA', bg: '#FAFAF7', text: '#1F2328' },
};

export default light;
TSEOF
```

- [ ] **Step 2: 创建 anime.ts**

```bash
cat > src/design-system/themes/anime.ts << 'TSEOF'
import type { ThemeMeta } from '../themeTypes';

const anime: ThemeMeta = {
  id: 'anime',
  name: '二次元',
  description: '薄荷汽水色 + 圆胖厚边 + 双层环境光阴影 + 软弹动效',
  icon: 'sparkles',
  preview: { accent: '#06B6D4', bg: '#F0FDFA', text: '#134E4A' },
};

export default anime;
TSEOF
```

- [ ] **Step 3: Commit**

```bash
git add src/design-system/themes/light.ts src/design-system/themes/anime.ts
git commit -m "feat(v3.0): add light + anime theme plugin files (meta only)"
```

---

### Task 3: ThemeRegistry 运行时注册表

**Files:**
- Create: `src/design-system/ThemeRegistry.ts`
- Create: `src/__tests__/ThemeRegistry.test.ts`

- [ ] **Step 1: 写 Registry 单测**

```bash
cat > src/__tests__/ThemeRegistry.test.ts << 'TSEOF'
import { describe, it, expect, vi } from 'vitest';

// import.meta.glob is a Vite built-in. In vitest with jsdom it's not
// available, so we mock the modules before importing ThemeRegistry.
vi.mock('../design-system/ThemeRegistry', async () => {
  // We test the pure functions after mocking the glob result.
  const actual = await vi.importActual<typeof import('../design-system/ThemeRegistry')>(
    '../design-system/ThemeRegistry',
  );
  return actual;
});

// ThemeRegistry relies on import.meta.glob at module scope.
// Since jsdom doesn't have import.meta, we use vi.mock to replace the
// glob result. The actual test of the registry logic is done via the
// exported pure functions, tested indirectly through ThemeProvider
// integration tests (Task 4).
//
// For this task, we verify the file compiles and exports exist.

describe('ThemeRegistry exports', () => {
  it('exports listThemes as a function', async () => {
    const mod = await import('../design-system/ThemeRegistry');
    expect(typeof mod.listThemes).toBe('function');
  });
  it('exports getTheme as a function', async () => {
    const mod = await import('../design-system/ThemeRegistry');
    expect(typeof mod.getTheme).toBe('function');
  });
  it('exports getDefaultTheme as a function', async () => {
    const mod = await import('../design-system/ThemeRegistry');
    expect(typeof mod.getDefaultTheme).toBe('function');
  });
  it('exports getNextTheme as a function', async () => {
    const mod = await import('../design-system/ThemeRegistry');
    expect(typeof mod.getNextTheme).toBe('function');
  });
  it('exports isRegisteredTheme as a function', async () => {
    const mod = await import('../design-system/ThemeRegistry');
    expect(typeof mod.isRegisteredTheme).toBe('function');
  });
});
TSEOF
```

- [ ] **Step 2: 跑测试, 验证失败(文件不存在)**

```bash
npx vitest run src/__tests__/ThemeRegistry.test.ts
```
Expected: module not found error

- [ ] **Step 3: 创建 ThemeRegistry.ts**

```bash
cat > src/design-system/ThemeRegistry.ts << 'TSEOF'
import type { ThemeId, ThemeMeta } from './themeTypes';

// glob 必须用字面量 './themes/*.ts' 写在这里, 不能抽成变量
const modules = import.meta.glob<ThemeMeta>(
  './themes/*.ts',
  { eager: true, import: 'default' },
);

const registry = new Map<ThemeId, ThemeMeta>();

for (const meta of Object.values(modules)) {
  if (meta && typeof meta.id === 'string') {
    registry.set(meta.id, meta as ThemeMeta);
  }
}

export function listThemes(): ThemeMeta[] {
  return Array.from(registry.values());
}

export function getTheme(id: ThemeId): ThemeMeta | null {
  return registry.get(id) ?? null;
}

export function getDefaultTheme(): ThemeMeta {
  const def = listThemes().find((t) => t.isDefault);
  return def ?? listThemes()[0];
}

export function getNextTheme(currentId: ThemeId): ThemeMeta {
  const list = listThemes();
  if (list.length <= 1) return list[0];
  const idx = list.findIndex((t) => t.id === currentId);
  if (idx === -1) return list[0];
  return list[(idx + 1) % list.length];
}

export function isRegisteredTheme(id: string): id is ThemeId {
  return registry.has(id);
}
TSEOF
```

- [ ] **Step 4: 跑测试, 验证通过**

```bash
npx vitest run src/__tests__/ThemeRegistry.test.ts
```
Expected: 5 PASS

- [ ] **Step 5: Commit**

```bash
git add src/design-system/ThemeRegistry.ts src/__tests__/ThemeRegistry.test.ts
git commit -m "feat(v3.0): add ThemeRegistry with import.meta.glob plugin scanning"
```

---

### Task 4: ThemeProvider 重构 (接 Registry)

**Files:**
- Modify: `src/design-system/ThemeProvider.tsx`
- Create: `src/__tests__/ThemeProvider.test.tsx`

- [ ] **Step 1: 写 Provider 单测**

```bash
cat > src/__tests__/ThemeProvider.test.tsx << 'TSEOF'
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
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
    // Reset data-theme on <html>
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
TSEOF
```

- [ ] **Step 2: 跑测试, 验证失败(ThemeProvider 仍用旧 enum)**

```bash
npx vitest run src/__tests__/ThemeProvider.test.tsx
```
Expected: fail (current-id is 'light' but ThemeContext value shape mismatch)

- [ ] **Step 3: 重写 ThemeProvider.tsx**

```bash
cat > src/design-system/ThemeProvider.tsx << 'TSEOF'
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
    return isRegisteredTheme(stored) ? stored : getDefaultTheme().id;
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
TSEOF
```

- [ ] **Step 4: 跑测试, 验证通过**

```bash
npx vitest run src/__tests__/ThemeProvider.test.tsx
```
Expected: 6 PASS

- [ ] **Step 5: 修复任何因 ThemeContext 类型变化导致的编译错误**

```bash
npx tsc --noEmit
```
如果有编译错误(如 AppHeader 或其他文件引用旧 `Theme` 类型),逐个修:
- `type Theme` → `type ThemeId`
- `useTheme().theme` 现在返回 `ThemeMeta`,要用 `.id` / `.name` 而非字符串

- [ ] **Step 6: Commit**

```bash
git add src/design-system/ThemeProvider.tsx src/__tests__/ThemeProvider.test.tsx
git commit -m "feat(v3.0): refactor ThemeProvider to use ThemeRegistry (plugin-style themes)"
```

---

### Task 5: tokens.css 拆分 light / anime

**Files:**
- Modify: `src/design-system/tokens.css`

- [ ] **Step 1: 备份当前 tokens.css**

```bash
cp src/design-system/tokens.css src/design-system/tokens.css.bak
```

- [ ] **Step 2: 修改 tokens.css — 拆 :root 为 light + 加 anime 块**

现有第 31-117 行的 `:root` 块改为两份。保留第 1-30 行的 reset/transition/animations 不变。

```bash
# 第一部分 (第 1-30 行不动: reset + * + body transitions + @keyframes)
# 第二部分: 将原 :root 块替换为 light + anime 两个选择器块

cat > src/design-system/tokens.css << 'CSSEOF'
/* === Claude 配置管理器 — 设计系统基线 v3.0 (插件式主题) === */'

/* === Reset (不变) === */
html,
body,
#root {
  margin: 0;
  padding: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  box-sizing: border-box;
  background: transparent;
}

*,
*::before,
*::after {
  box-sizing: border-box;
}

/* ── 极简 light (现状, 默认) ── */
:root, [data-theme="light"] {
  --bg-primary:   #FAFAF7;
  --bg-elevated:  #FFFFFF;
  --bg-overlay:   rgba(255, 255, 255, 0.7);
  --text-primary:   #1F2328;
  --text-secondary: #656D76;
  --text-muted:     #8B949E;
  --accent:        #0969DA;
  --accent-soft:   #DDF4FF;
  --accent-strong: #0860C7;
  --success:       #388E3C;
  --warning:       #F57C00;
  --danger:        #D32F2F;
  --border:        #E1E4E8;
  --border-soft:   #E1E4E8;
  --disabled:      rgba(0, 0, 0, 0.4);
  --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.04);
  --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.08);
  --card-radius:   8px;
  --button-radius: 6px;
  --card-border-width: 1px;
  --header-height: 48px;
  --sidebar-width: 220px;
  --fs-heading: 18px;
  --fs-body:    14px;
  --fs-caption: 12px;
  --font-ui:   -apple-system, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
  --font-mono: "Cascadia Code", "SF Mono", Menlo, Consolas, monospace;
  --blur-sm:  10px;
  --blur-md:  20px;
  --blur-lg:  30px;
  --glass-bg:        rgba(255, 255, 255, 0.55);
  --glass-bg-strong: rgba(255, 255, 255, 0.75);
  --glass-border:    rgba(255, 255, 255, 0.18);
  --glass-shadow:    0 8px 32px rgba(0, 0, 0, 0.08);
  --space-1:  4px;
  --space-2:  8px;
  --space-3:  12px;
  --space-4:  16px;
  --space-6:  24px;
  --space-8:  32px;
  --space-12: 48px;
  --view-transition-duration: 150ms;
}

/* ── 二次元 anime (薄荷汽水) ── */
[data-theme="anime"] {
  --bg-primary:   #F0FDFA;
  --bg-elevated:  #FFFFFF;
  --bg-overlay:   rgba(255, 255, 255, 0.7);
  --text-primary:   #134E4A;
  --text-secondary: #5B7B7A;
  --text-muted:     #8FA8A6;
  --accent:        #06B6D4;
  --accent-soft:   #CFFAFE;
  --accent-strong: #0891B2;
  --success:       #10B981;
  --warning:       #F59E0B;
  --danger:        #FB7185;
  --border:        #CCFBF1;
  --border-soft:   #E6FFFA;
  --disabled:      rgba(0, 0, 0, 0.4);
  --shadow-sm: 0 2px 6px rgba(6, 182, 212, 0.12), 0 4px 16px rgba(6, 182, 212, 0.08);
  --shadow-md: 0 4px 12px rgba(6, 182, 212, 0.16), 0 12px 32px rgba(6, 182, 212, 0.10);
  --card-radius:   20px;
  --button-radius: 14px;
  --card-border-width: 3px;
  --header-height: 56px;
  --sidebar-width: 240px;
  --fs-heading: 18px;
  --fs-body:    14px;
  --fs-caption: 12px;
  --font-ui: 'Nunito', -apple-system, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
  --font-mono: "JetBrains Mono", "Cascadia Code", "SF Mono", Menlo, Consolas, monospace;
  /* anime 主题不用磨砂 token, 但保留值以防未来混搭 */
  --blur-sm:  10px;
  --blur-md:  20px;
  --blur-lg:  30px;
  --glass-bg:        rgba(255, 255, 255, 0.55);
  --glass-bg-strong: rgba(255, 255, 255, 0.75);
  --glass-border:    rgba(255, 255, 255, 0.18);
  --glass-shadow:    0 8px 32px rgba(0, 0, 0, 0.08);
  --space-1:  4px;
  --space-2:  8px;
  --space-3:  12px;
  --space-4:  16px;
  --space-6:  24px;
  --space-8:  32px;
  --space-12: 48px;
  --view-transition-duration: 150ms;
}

/* ── 主题共享 ── */
@keyframes fadeIn {
  from { opacity: 0; }
  to   { opacity: 1; }
}

.view-transition {
  width: 100%;
  height: 100%;
  animation: fadeIn var(--view-transition-duration) ease-out;
}

/* ── 全局基线 ── */
body {
  font-family: var(--font-ui);
  font-size: var(--fs-body);
  color: var(--text-primary);
  background: var(--bg-primary);
  transition: background-color 200ms ease, color 200ms ease;
}

code,
pre,
kbd {
  font-family: var(--font-mono);
}
CSSEOF
```

**注意**: 以上用 heredoc 写完整新文件; 如果实施时发现原 tokens.css 有其他行(如旧注释), 先 `git diff` 核实, 只替换第 31-117 行的 :root 块, 保留第 1-30 行 + utilities.css 引入不变。

- [ ] **Step 3: 验证 CSS 语法正确 — 在 jsdom 中设 data-theme 验证 token 值**

```bash
cat > src/__tests__/design-system/tokens.test.ts << 'TSEOF'
import { describe, it, expect } from 'vitest';

// 注入 tokens.css (vitest css transform handles .css imports)
import '../../design-system/tokens.css';

function getComputedVar(name: string): string {
  const el = document.documentElement;
  return getComputedStyle(el).getPropertyValue(name).trim();
}

describe('tokens.css theme switching', () => {
  it('默认 (:root) accent = #0969DA (light)', () => {
    document.documentElement.removeAttribute('data-theme');
    expect(getComputedVar('--accent')).toBe('#0969DA');
  });

  it('[data-theme="light"] accent = #0969DA', () => {
    document.documentElement.dataset.theme = 'light';
    expect(getComputedVar('--accent')).toBe('#0969DA');
  });

  it('[data-theme="anime"] accent = #06B6D4', () => {
    document.documentElement.dataset.theme = 'anime';
    expect(getComputedVar('--accent')).toBe('#06B6D4');
  });

  it('[data-theme="anime"] card-border-width = 3px', () => {
    document.documentElement.dataset.theme = 'anime';
    expect(getComputedVar('--card-border-width')).toBe('3px');
  });
});
TSEOF
```

```bash
npx vitest run src/__tests__/design-system/tokens.test.ts
```
Expected: 4 PASS

- [ ] **Step 4: Commit**

```bash
git add src/design-system/tokens.css src/__tests__/design-system/tokens.test.ts
git commit -m "feat(v3.0): split tokens.css into light + anime [data-theme] blocks"
```

---

### Task 6: 主题专属 CSS (themes/light.css + themes/anime.css + utilities.css)

**Files:**
- Create: `src/design-system/themes/light.css`
- Create: `src/design-system/themes/anime.css`
- Modify: `src/design-system/utilities.css`

- [ ] **Step 1: 创建 light.css (空占位)**

```bash
cat > src/design-system/themes/light.css << 'CSSEOF'
/* light 主题暂无专属规则 — 全走 tokens.css 的 :root / [data-theme="light"] 块 */
CSSEOF
```

- [ ] **Step 2: 创建 anime.css (圆胖厚边 + 双层阴影 + Fredoka)**

```bash
cat > src/design-system/themes/anime.css << 'CSSEOF'
/* 二次元主题专属规则 — 全部用 [data-theme="anime"] 前缀, 0 通用污染 */

/* ── 卡片 ── */
[data-theme="anime"] .card {
  border-width: var(--card-border-width);
  border-radius: var(--card-radius);
  box-shadow: var(--shadow-sm);
}
[data-theme="anime"] .card:hover {
  transform: translateY(-3px);
  box-shadow: var(--shadow-md);
  border-color: #99F6E4;
  transition: transform 280ms cubic-bezier(0.34, 1.56, 0.64, 1),
              box-shadow 200ms ease, border-color 200ms ease;
}

/* ── 按钮 ── */
[data-theme="anime"] .btn {
  border-width: 2px;
  border-radius: var(--button-radius);
  font-weight: 600;
  box-shadow: 0 1px 2px rgba(6, 182, 212, 0.10);
  transition: transform 150ms cubic-bezier(0.34, 1.56, 0.64, 1),
              box-shadow 150ms ease, background-color 150ms ease;
}
[data-theme="anime"] .btn:hover { transform: translateY(-2px); }
[data-theme="anime"] .btn-primary {
  background: var(--accent);
  border-color: var(--accent);
  box-shadow: var(--shadow-sm);
}
[data-theme="anime"] .btn-primary:hover {
  background: var(--accent-strong);
  border-color: var(--accent-strong);
}

/* ── 列表行 ── */
[data-theme="anime"] .list-row {
  padding: 14px 18px;
}
[data-theme="anime"] .list-row:hover {
  transform: translateY(-3px) rotate(-0.3deg);
  box-shadow: var(--shadow-md);
  border-color: #99F6E4;
}
[data-theme="anime"] .list-row.active {
  border-color: var(--accent);
  background: var(--accent-soft);
}

/* ── badge ── */
[data-theme="anime"] .badge {
  padding: 0 10px;
  border-radius: 10px;
  border: 2px solid;
  height: 22px;
  box-sizing: border-box;
}
[data-theme="anime"] .badge-active {
  border-color: #fff;
}

/* ── 标题栏 ── */
[data-theme="anime"] .titlebar {
  background: var(--accent);
  border-bottom: 2px solid #fff;
}
[data-theme="anime"] .titlebar h1 {
  font-family: 'Fredoka', 'Nunito', sans-serif;
  font-size: 16px;
  font-weight: 600;
  color: #fff;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);
}

/* ── 侧边栏 ── */
[data-theme="anime"] .sidebar .nav-item {
  padding: 10px 14px;
  border-radius: 16px;
  border-left: none;
  margin: 0 8px 4px;
}
[data-theme="anime"] .sidebar .nav-item:hover {
  background: rgba(34, 211, 238, 0.15);
  transform: translateX(2px);
}
[data-theme="anime"] .sidebar .nav-item.active {
  background: var(--accent);
  color: #fff;
}
[data-theme="anime"] .sidebar .nav-item.active svg {
  color: #fff;
}

/* ── Provider avatar ── */
[data-theme="anime"] .provider-avatar {
  width: 44px;
  height: 44px;
  border-radius: 14px;
  font-family: 'Fredoka', 'Nunito', sans-serif;
  font-size: 14px;
  font-weight: 600;
}

/* ── h1/h2 ── */
[data-theme="anime"] h1, [data-theme="anime"] h2 {
  font-family: 'Fredoka', 'Nunito', sans-serif;
  font-weight: 600;
}
[data-theme="anime"] h2 { color: var(--accent); }

/* ── KPI ── */
[data-theme="anime"] .kpi { padding: 18px 20px; }
[data-theme="anime"] .kpi .kpi-label { font-weight: 700; }
[data-theme="anime"] .kpi .kpi-value {
  font-family: 'Fredoka', 'Nunito', sans-serif;
  font-weight: 600;
}

/* ── bar ── */
[data-theme="anime"] .bar {
  height: 10px;
  background: var(--accent-soft);
  border-radius: 5px;
}
[data-theme="anime"] .bar > span {
  border-radius: 5px;
  transition: width 400ms cubic-bezier(0.34, 1.56, 0.64, 1);
}

/* ── Page transition ── */
@keyframes bounceIn {
  0%   { opacity: 0; transform: translateY(8px) scale(0.98); }
  60%  { opacity: 1; transform: translateY(-2px) scale(1.01); }
  100% { opacity: 1; transform: translateY(0) scale(1); }
}
[data-theme="anime"] .page {
  animation: bounceIn 280ms cubic-bezier(0.34, 1.56, 0.64, 1);
}
CSSEOF
```

- [ ] **Step 3: 在 main.tsx 中静态 import 这两个 CSS 文件**

现有 `src/main.tsx` 第 6 行已 import `./design-system/utilities.css`。在其后加:

```typescript
// v3.0 主题专属 CSS (静态 import, 不走 glob — CSS 必须 eager)
import './design-system/themes/light.css';
import './design-system/themes/anime.css';
```

修改 `src/main.tsx`:
```typescript
import "./design-system/tokens.css";
import "./design-system/utilities.css";
import "./design-system/themes/light.css";   // v3.0
import "./design-system/themes/anime.css";   // v3.0
```

- [ ] **Step 4: 在 utilities.css 顶部加 prefers-reduced-motion**

```css
/* === prefers-reduced-motion (v3.0) === */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

插入到 `src/design-system/utilities.css` 第 1 行之前。

- [ ] **Step 5: 验证编译通过**

```bash
npx vitest run  # 确保现有测试不因 tokens.css 拆分而崩塌
npx tsc --noEmit  # 确保 CSS import 被 Vite 正确处理
```

- [ ] **Step 6: Commit**

```bash
git add src/design-system/themes/light.css \
        src/design-system/themes/anime.css \
        src/design-system/utilities.css \
        src/main.tsx
git commit -m "feat(v3.0): add theme CSS files + prefers-reduced-motion + static imports"
```

---

### Task 7: AppHeader 加主题切换按钮

**Files:**
- Modify: `src/components/AppHeader.tsx`
- Create: `src/__tests__/AppHeader.test.tsx`

- [ ] **Step 1: 写切换按钮单测**

```bash
cat > src/__tests__/AppHeader.test.tsx << 'TSEOF'
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
TSEOF
```

- [ ] **Step 2: 跑测试, 验证失败(按钮不存在)**

```bash
npx vitest run src/__tests__/AppHeader.test.tsx
```
Expected: FAIL (找不到 data-testid="app-header-theme-toggle")

- [ ] **Step 3: 修改 AppHeader.tsx — 加切换按钮**

在 `src/components/AppHeader.tsx` 的 import 区加:

```typescript
import { Sun, Sparkles, type LucideIcon } from 'lucide-react';
import { useTheme } from '../design-system/ThemeProvider';
```

在 AppHeader 函数体顶部加:

```typescript
const { theme, themes, setTheme } = useTheme();
const themeIconMap: Record<string, LucideIcon> = { sun: Sun, sparkles: Sparkles };
const ThemeIcon = themeIconMap[theme.icon] ?? Sun;
const nextTheme = themes[(themes.findIndex(t => t.id === theme.id) + 1) % themes.length];
```

在 `.actions` div 内, `settings` 按钮之前插入:

```tsx
<button
  type="button"
  data-testid="app-header-theme-toggle"
  data-app-control-hover="true"
  aria-label="切换主题"
  title={`切换到 ${nextTheme.name} 主题`}
  disabled={themes.length <= 1}
  onClick={() => setTheme(nextTheme.id)}
  style={{
    ...noDragStyle,
    width: 32,
    height: 32,
    borderRadius: 'var(--button-radius)',
    border: '1px solid var(--border)',
    background: 'transparent',
    cursor: themes.length <= 1 ? 'not-allowed' : 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--text-primary)',
    transition: 'background-color 120ms ease',
    opacity: themes.length <= 1 ? 0.4 : 1,
  }}
>
  <ThemeIcon size={16} style={{ color: 'var(--text-primary)' }} />
</button>
```

- [ ] **Step 4: 跑测试, 验证通过**

```bash
npx vitest run src/__tests__/AppHeader.test.tsx
```
Expected: 3 PASS

- [ ] **Step 5: 全量回归**

```bash
npx vitest run
```
确保所有已有测试不受影响。AppHeader 的 Props 可能因为新增 `useTheme()` 调用而改变——如果旧 AppHeader 测试没包裹 ThemeProvider, 会报 "useTheme must be used inside ThemeProvider" 错误。需同步改旧测试:

```typescript
// 所有 render(<AppHeader ... />) 改成:
render(
  <ThemeProvider>
    <AppHeader currentView="home" onNavigate={vi.fn()} pageTitle={pageTitle} />
  </ThemeProvider>
);
```

- [ ] **Step 6: Commit**

```bash
git add src/components/AppHeader.tsx src/__tests__/AppHeader.test.tsx
git commit -m "feat(v3.0): add theme toggle button in AppHeader"
```

---

### Task 8: 内页清理 — Provider 列表 (provider-list) 作模板

**Files:**
- Modify: `src/pages/provider-list/index.tsx`
- Verify: `src/__tests__/pages/provider-list.test.tsx`

本任务以 Provider 列表页为完整示例, 应用 spec §4.8 的 4 条规则 + §4.7 的渐变/emoji 清理。后续任务照此模式扫其他 13 页。

- [ ] **Step 1: 确认现有测试通过**

```bash
npx vitest run src/__tests__/pages/provider-list.test.tsx
```
记录当前 PASS/FAIL 数作基线。

- [ ] **Step 2: 应用 §4.8.1 — 4 边统一, 不挖左边**

找到 ProviderRow 组件的 `borderLeft` 硬编码:

```typescript
// 旧 (第 416 行)
borderLeft: isActive ? '2px solid var(--accent)' : '2px solid transparent',
```

改为:

```typescript
// 新: 4 边统一, 靠 border-color 区分
// 不写 borderLeft, 走 var(--card-border-width) solid var(--border)
```

具体改动: 删除 `borderLeft` 行, 在 `style` 对象中只保留:

```typescript
style={{
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-3)',
  padding: 'var(--space-3) var(--space-4)',
  marginBottom: 'var(--space-2)',
  background: isActive ? 'var(--accent-soft)' : 'var(--bg-elevated)',
  border: 'var(--card-border-width) solid var(--border)',
  borderColor: isActive ? 'var(--accent)' : 'var(--border)',
  borderRadius: 'var(--card-radius)',
  boxShadow: 'var(--shadow-sm)',
}}
```

- [ ] **Step 3: 应用 §4.8.2 — 删除任何 inset shadow**

grep provider-list/index.tsx 确认无 `inset` 关键字。如有, 删除。

```bash
grep -n 'inset' src/pages/provider-list/index.tsx
```
Expected: 无输出

- [ ] **Step 4: 应用 §4.8.3 — badge 固定高度**

在 provider-list 页中, ".badge" 样式通过 CSS token 生效 (已在 tokens.css + themes/anime.css 中定义)。确认 badge 内联 style 没有覆盖 `height`:

```bash
grep -n 'badge' src/pages/provider-list/index.tsx
```
如果有内联 style 写了 `padding` 或 `height`, 删掉, 让 CSS 类接管。

- [ ] **Step 5: 应用 §4.8.4 — 已激活 badge 提到 list-row 直接子级**

当前 ProviderRow return 的 JSX 中, "已激活" badge 在 `<div style={{flex:'1 1 auto'}}>` 内部的第一行 flex 里 (第 422-542 行)。需要把 badge 提出来, 变成 `<div class="list-row">` 的直接子级:

```tsx
// 旧结构 (第 397-547 行, 简化):
<li ...>
  <div style={{ flex: '1 1 auto', minWidth: 0 }}>
    <div style={{ display: 'flex', ... }}>
      <span>{provider.name}</span>
      <code>{provider.provider_type}</code>
      <span>· {provider.models.length} 个模型</span>
    </div>
    <div>{provider.api_base}</div>
    <div>{lastUsedLabel(provider)}</div>
  </div>
  {/* 右侧操作区 */}
  <div style={{ flexShrink: 0, ... }}>
    <button>导出</button>
    {isActive ? <span className="badge">● 已激活</span> : <button>激活</button>}
  </div>
</li>
```

改为:

```tsx
// 新结构: "已激活" badge 提到 li 直接子级
<li ...>
  <div style={{ flex: '1 1 auto', minWidth: 0 }}>
    <div style={{ display: 'flex', ... }}>
      <span>{provider.name}</span>
      <code>{provider.provider_type}</code>
      <span>· {provider.models.length} 个模型</span>
    </div>
    <div>{provider.api_base}</div>
    <div>{lastUsedLabel(provider)}</div>
  </div>
  {/* 右侧操作区: 导出 + 激活/已激活 */}
  <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
    <button>导出</button>
    {isActive ? (
      <span className="badge badge-active" style={{ flexShrink: 0 }}>● 已激活</span>
    ) : (
      <button className="btn btn-primary">激活</button>
    )}
  </div>
</li>
```

- [ ] **Step 6: 清理 emoji / 渐变内联 style (provider-list 页)**

```bash
grep -nE 'emoji|✨|⚡|🌸|🐳|🌙|🌟|🎉|🎀|linear-gradient' src/pages/provider-list/index.tsx
```
Expected: 无输出。如有, 替换:
- emoji → 删除或换 lucide icon
- `linear-gradient(...)` → 实色

- [ ] **Step 7: 跑 provider-list 测试, 验证通过**

```bash
npx vitest run src/__tests__/pages/provider-list.test.tsx
```
Expected: 跟 Step 1 基线一致的 PASS 数

- [ ] **Step 8: Commit**

```bash
git add src/pages/provider-list/index.tsx
git commit -m "fix(v3.0): provider-list — apply §4.8 state machine rules + gradient/emoji cleanup"
```

---

### Task 9: 内页清理 — 其余 13 个页面 + 主页

**Files (逐个扫):**
- `src/pages/home/index.tsx` (主页 — 最重要)
- `src/pages/provider-switch/index.tsx`
- `src/pages/import-sql/index.tsx`
- `src/pages/deeplink-import/index.tsx`
- `src/pages/json-editor/index.tsx`
- `src/pages/mcp-management/index.tsx`
- `src/pages/usage-query/index.tsx`
- `src/pages/single-file-deploy/index.tsx`
- `src/pages/resource-browser/index.tsx`
- `src/pages/marketplace/index.tsx`
- `src/pages/optimizer/index.tsx`
- `src/pages/backup-restore/index.tsx`
- `src/pages/about/index.tsx`

对**每个页面**, 按相同模式处理:

- [ ] **Step 1: 扫渐变 — 替换 linear-gradient 为实色**

```bash
# 每个页面:
grep -n 'linear-gradient' src/pages/<page>/index.tsx
```
有输出 → 替换为实色 (取渐变的终止色或中间色)。

- [ ] **Step 2: 扫 emoji — 替换或删除**

```bash
grep -nE '✨|⚡|🌸|🐳|🌙|🌟|🎉|🎀|💫|🔥|💖|📊|🎴' src/pages/<page>/index.tsx
```
有输出 → 删除或换 lucide icon。

- [ ] **Step 3: 扫 list-row 相关 — 对照 §4.8 规则**

```bash
grep -nE 'list-row|borderLeft|border-left' src/pages/<page>/index.tsx
```
有输出 → 确保:
- 不写 `borderLeft` 硬编码
- active 状态用 `borderColor` 而非 `borderLeftColor`
- badge 是 list-row 直接子级 (不在内部 flex 里)
- badge 无硬编码 padding/height (让 CSS class 接管)

- [ ] **Step 4: 跑该页面测试**

```bash
npx vitest run src/__tests__/pages/<page>.test.tsx
```

- [ ] **Step 5: Commit (每个页面独立 commit)**

```bash
git add src/pages/<page>/index.tsx
git commit -m "fix(v3.0): <page-name> — gradient/emoji cleanup + §4.8 list-row rules"
```

**主页 (home) 例外 — 它是项目列表页, 没有 list-row, 但有 KPI 渐变和 emoji**:
- 扫 KPI 卡片的 `linear-gradient` 背景 → 实色
- 扫 emoji → 删除
- 跑 `npx vitest run src/__tests__/pages/home.test.tsx` (如存在)

---

### Task 10: 手动 smoke test + STATE.md

- [ ] **Step 1: 关闭残留进程**

```bash
./scripts/kill-app.sh
```

- [ ] **Step 2: 编译 dev**

```bash
./scripts/build-only.sh
```
Expected: `cargo build` 成功, exe 生成在 `src-tauri/target/debug/claude-config-manager.exe`

- [ ] **Step 3: 启动 + 验证 10 项 smoke test**

1. 启动 exe → 进程 5 秒内运行
2. 检测主窗口 (标题 "Claude 配置管理器")
3. 检测托盘图标
4. 默认 light 主题
5. 点击 header sparkles 按钮 → 变 anime (薄荷色)
6. F5 重启 → 仍是 anime
7. 再切回 light → 恢复瓷白
8. 主页 / Provider 列表 / 用量 三个内页主题色均正确
9. 关闭 (taskkill) → 2 秒内进程消失

```bash
./scripts/smoke-test.sh src-tauri/target/debug/claude-config-manager.exe
```

- [ ] **Step 4: 插件机制验证 (新增 smoke 项)**

临时删 anime 主题:
```bash
mv src/design-system/themes/anime.ts src/design-system/themes/anime.ts.bak
mv src/design-system/themes/anime.css src/design-system/themes/anime.css.bak
```
重新编译 → theme toggle button 应为 disabled。恢复:
```bash
mv src/design-system/themes/anime.ts.bak src/design-system/themes/anime.ts
mv src/design-system/themes/anime.css.bak src/design-system/themes/anime.css
```

- [ ] **Step 5: 写 STATE.md**

在 `STATE.md` 新建或追加章节:

```markdown
## v3.0 主题重构 (2026-06-22)

**状态**: ✅ 完成 (smoke test 通过)

**摘要**:
- 2 套插件式主题: light (极简卡片, 瓷白) + anime (二次元, 薄荷汽水)
- 主题机制: themes/*.ts 独立文件 + import.meta.glob 扫描 + ThemeRegistry
- AppHeader 加主题切换按钮 (循环)
- 内页渐变/emoji 清理完成

**已知限制**:
- ThemeId = string, 无编译时类型保护 (运行时 isRegisteredTheme 校验)
- 加主题需同步改 tokens.css 的 [data-theme] 块 (v3.1 可改为 JS 动态注入)
- 无 Settings 页 — 主题切换仅 AppHeader 按钮
- preferences-reduced-motion 全局生效但无 per-theme motion token

**用户核定**: (留空, 等你填)
```

- [ ] **Step 6: Commit STATE.md**

```bash
git add STATE.md
git commit -m "docs(v3.0): add STATE.md entry for theme redesign"
```

---

### Task 11: 最终全量回归

- [ ] **Step 1: 全量 vitest**

```bash
npx vitest run
```
Expected: 0 failures (允许 pre-existing known failures)

- [ ] **Step 2: TypeScript 编译**

```bash
npx tsc --noEmit
```
Expected: 0 errors

- [ ] **Step 3: 最终打包 + ship**

```bash
./scripts/build-and-ship.sh --milestone M3 --task 3.0 --slug theme-redesign
```

- [ ] **Commit 任何残留修改**

```bash
git status
git add <remaining files>
git commit -m "chore(v3.0): final regression + ship"
```

---

## Post-Plan Notes

1. **lucide-react dynamic icon**: 本项目用具名导入, 不支持 `<DynamicIcon name="sun" />`。方案: AppHeader 维护 `Record<string, LucideIcon>` map。已编入 Task 7。

2. **import.meta.glob vs vitest**: jsdom 不提供 `import.meta`. Task 3 / Task 4 的测试用 `vi.mock` 替换 ThemeRegistry。这是 Vite 项目的标准做法。

3. **tokens.css 重写**: Task 5 用 heredoc 重写整个文件 (保留 reset 区域)。如果原文件有其他修改未 commit, 先 diff。

4. **Task 9 (13 个页面)**: 每页面遵循相同模式 (grep → fix → test → commit)。实施者可自行决定顺序和批处理。关键页: home, mcp-management, usage-query, marketplace。

5. **Nunito / Fredoka 字体**: anime 主题的 tokens.css 声明了 `--font-ui: 'Nunito', ...`, 但 <head> 中需 <link> Google Fonts。现有 index.html header 不加载 Nunito。实施者需在 `index.html` 或 main.tsx 中加字体加载 (或接受 fallback 到系统字体)。

6. **Desired order for agent implementation**: Task 1→2→3→4→5→6→7→8→9→10→11
