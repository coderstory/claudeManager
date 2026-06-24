# v3.0 主题重构 Spec

> 日期: 2026-06-22
> 状态: 草案 → 待用户审阅
> 范围: 极简卡片(light) + 二次元(anime, 薄荷色) 2 套主题 + **插件式主题机制**(主题独立文件, 可增删)
> 输出: themes/*.ts 插件目录 + ThemeRegistry 运行时注册 + tokens.css 拆分 + AppHeader 切换按钮 + 内页清理

---

## 1. 背景与目标

### 1.1 用户原始诉求

- "UI 没有做任何设计, 比较丑, 也没任何动态效果" → 触发 UI/UX 全量重做
- "主色调改成清爽一点的, 太浓烈了" → 二次元主题从桃粉 `#FF6B95` 改薄荷汽水 `#06B6D4`
- "我只要极简卡片 和 薄荷汽水 2 套主题" → 2 套并存, 主题切换
- "后续可能删减主题" → 主题可删
- "每个主题最好是单独的文件, 类似插件一样" → **插件式主题机制**
- "全部写 v3.0 里面" → 不拆 v3.1, 一步到位

### 1.2 决策表(已与用户对齐)

| 维度 | 决定 |
|---|---|
| 主题数 | 2 套: `light` (极简卡片, 瓷白) + `anime` (二次元, 薄荷汽水) |
| 主题机制 | **插件式**: 每主题 = `src/design-system/themes/<id>.ts` 独立文件 |
| 主题加载 | `import.meta.glob('./themes/*.ts', { eager: true })` 编译时扫描 |
| 主题注册 | 运行时 `ThemeRegistry`(Map<id, ThemeMeta>); 删文件 = 主题消失 |
| 主题枚举 | **扔掉** `type Theme = 'light' \| 'anime'` 硬编码 union; 改 `type ThemeId = string`(运行时收窄) |
| 默认主题 | `light` (现状, 升级用户不被打扰); 由 ThemeMeta.isDefault 标记 |
| 主题存储 | localStorage `ccm.theme` (已有 STORAGE_KEY), 存 ThemeId |
| 切换 UI | AppHeader 加一个切换按钮(在注册表主题间循环) |
| 主题色覆盖 | 覆盖现状 `--accent` / `--text-primary` 等 token |
| 二次元元素保留 | 圆胖 + 厚边 3px + 双层环境光阴影 + 280ms 软弹 + Fredoka 圆头字 |
| 二次元元素去除 | 渐变泛滥(12 处 → 1-2 处) / emoji(13 处 → 0) / 头像渐变盒(4 个 → 4 个首字母纯色盒) |
| Demo 范围 | 已有 demo C (动漫二次元) 是落地参照; 其他 demo A/B/D/E 不动 |

### 1.3 不可承诺(基于已验证事实)

- **Mica/vibrancy 透不到 webview** — commit e8b4b56 实测不生效; CSS 模拟磨砂是唯一路径; 主题切换不涉及窗体 backdrop
- **macOS vibrancy** 同上
- 详见 [[reference-tauri-mica-fallback-deployed]]

---

## 2. 现状审计

### 2.1 主题机制(需重写, 不是扩 union)

- `src/design-system/ThemeProvider.tsx` 第 31 行: `type Theme = 'light'` — **扔掉**, 改 `ThemeId = string`
- 第 48-50 行: `isTheme` 只接受 `'light'` — **扔掉**, 改成"在 ThemeRegistry 中存在"
- 第 38 行: `STORAGE_KEY = 'ccm.theme'` — 保留, 存 ThemeId
- 第 52-56 行: `applyTheme` 写 `data-theme` 到 `<html>` — 保留, 机制不变
- 第 59 行: `useState<Theme>(...)` 初始值 — 改成读 ThemeRegistry 默认主题

### 2.2 token 系统(全部在 `src/design-system/tokens.css`)

- 第 31-117 行: `:root` 单档 light 块, 31 个 token
- 没有任何 `[data-theme="..."]` 分支块 — 主题机制空转, 写穿主题也只走 :root
- **本轮改造**: `:root` 拆成 `:root, [data-theme="light"]` + `[data-theme="anime"]`; 主题专属 CSS 移到 `themes/<id>.css`

### 2.3 AppHeader(缺切换 UI)

- `src/components/AppHeader.tsx` 第 99 行注释: "M2.16 theme-trim: 主题切换按钮已删(单档 light 无需切换)"
- 需在 `.actions` 区(`back` + `settings` + `WindowControls` 之间)加一个 sun/cycle icon button
- **切换按钮行为**: 不再 light↔anime 二选一硬编码, 改成"在 ThemeRegistry 注册顺序中循环到下一个"

### 2.4 渐变与 emoji 滥用(基于 demo C 落地经验)

- 12 处 `linear-gradient()` 大部分应实色化(参见 demo C v17)
- 13 处 emoji 应全删
- 这部分**不直接改代码**, 而是把规则写进 spec, 由实施 plan 阶段去具体页面扫

---

## 3. 架构

### 3.1 主题层结构(插件式)

```
src/design-system/
├── tokens.css              # 改: 拆 :root → :root, [data-theme="light"] + [data-theme="anime"]
├── ThemeProvider.tsx       # 改: 扔掉 enum, 改用 ThemeRegistry
├── ThemeRegistry.ts        # 新: 运行时注册表(Map<ThemeId, ThemeMeta>)
├── themeTypes.ts           # 新: ThemeId / ThemeMeta 接口
└── themes/                 # 新: 插件目录(每个 .ts = 1 个主题)
    ├── light.ts            # 新: light 主题 meta + tokens
    ├── light.css           # 新: light 专属 CSS(如有)
    ├── anime.ts            # 新: anime 主题 meta + tokens
    └── anime.css           # 新: anime 专属 CSS(圆胖厚边 + 双层阴影 + Fredoka)
```

**关键约定**:
- `themes/*.ts` 是**主题元数据 + token 定义**(JS 对象, 运行时注入 `:root` 或 `[data-theme]`)
- `themes/*.css` 是**主题专属 CSS 规则**(选择器带 `[data-theme="<id>"]` 前缀, 0 通用污染)
- 删 `themes/anime.ts` + `themes/anime.css` = anime 主题从注册表消失, 切换按钮跳过它
- 加 `themes/dark.ts` + `themes/dark.css` = dark 主题自动注册, 切换按钮循环到它

### 3.2 数据流

```
┌─────────────────────────────┐
│ themes/*.ts (编译时)        │  每个 export default ThemeMeta
│ themes/light.ts             │  import.meta.glob eager 扫描
│ themes/anime.ts             │
└──────────┬──────────────────┘
           │ build 时聚合
           ▼
┌─────────────────────────────┐
│ ThemeRegistry (运行时)      │  Map<ThemeId, ThemeMeta>
│ registry.list() → Theme[]   │  registry.get(id) → ThemeMeta | null
│ registry.default() → ThemeMeta │  registry.next(curId) → ThemeId(循环)
└──────────┬──────────────────┘
           │ Provider mount 时读
           ▼
┌─────────────────────────────┐
│ localStorage "ccm.theme"    │  存 ThemeId, 缺省 = registry.default().id
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│ ThemeProvider               │  useState<ThemeId>(...)
│ React Context               │  value: { theme: ThemeMeta, setTheme, themes: Theme[] }
└──────────┬──────────────────┘
           │ useEffect 注入 token + 写 data-theme
           ▼
┌─────────────────────────────┐
│ <html data-theme="<id>">    │  + 动态注入 <style id="theme-tokens">
│                             │    :root, [data-theme="<id>"] { --accent: ...; ... }
└──────────┬──────────────────┘
           │ CSS 选择器
           ▼
┌─────────────────────────────┐
│ themes/<id>.css             │  [data-theme="anime"] .card { ... }
│ (静态 import 在 main.tsx)   │  [data-theme="anime"] .btn { ... }
└─────────────────────────────┘
```

### 3.3 关键决策: token 注入方式

**两种方案, 选 A**:

| 方案 | 机制 | 优 | 劣 |
|---|---|---|---|
| **A: 静态 CSS 文件** | tokens.css 拆 light/anime 两块 `[data-theme]` 选择器; themes/*.css 静态 import | 0 运行时开销, CSS 原生 cascade, 调试方便 | 加主题要改 tokens.css(但加文件也要改 registry, 可接受) |
| B: 运行时注入 | ThemeMeta.tokens 是 JS 对象, useEffect 动态写 `<style>` | 主题完全自包含, 加文件 0 改其他 | 运行时开销, FOUC 风险, 调试难 |

**选 A 理由**: Tauri WebView2 对动态 `<style>` 注入有 FOUC 风险(主题切换瞬间白屏); 静态 CSS 文件走 Vite 构建链, 跟项目现有 tokens.css 一致, 0 新机制。

**结论**:
- `tokens.css` 保留**所有主题的 token 定义**(light + anime 两块 `[data-theme]` 选择器)
- `themes/<id>.ts` 只导出 **meta**(id / name / icon / isDefault), 不导出 token
- `themes/<id>.css` 导出**主题专属 CSS 规则**(圆胖厚边等, 不含 token)
- 删主题 = 删 `themes/<id>.ts` + `themes/<id>.css` + tokens.css 里对应的 `[data-theme="<id>"]` 块(3 处)

### 3.4 关键决策: 切换按钮位置

- **不放在 sidebar** — sidebar 是导航, 主题是个人偏好, 混在一起降低可发现性
- **不放在 settings 弹窗** — 弹窗尚未实现, 等 settings 阶段再迁入
- **放 AppHeader `.actions` 区** — 跟现有 `back` / `settings` / `WindowControls` 同区, 32px icon button, 跟 `settings` 同样的 `data-app-control-hover` hover 行为
- **切换逻辑**: 点击 = `registry.next(currentThemeId)` 循环到下一个主题; 只有 1 个主题时按钮 disabled

---

## 4. 组件改造

### 4.1 主题切换按钮 (新增)

**位置**: `src/components/AppHeader.tsx` `.actions` 区, 紧跟 `settings` 按钮之前

**视觉**:
```
[back]  [search]  [theme-toggle]  [settings]  [min] [max] [close]
                ↑ 新增
```

**行为**:
```typescript
const { theme, themes, setTheme } = useTheme();
const next = themes[(themes.findIndex(t => t.id === theme.id) + 1) % themes.length];
// icon: theme.icon (从 ThemeMeta 取, lucide icon name)
// 只有 1 个主题时 disabled
<button
  onClick={() => setTheme(next.id)}
  disabled={themes.length <= 1}
  title={`切换到 ${next.name} 主题`}
  data-testid="app-header-theme-toggle"
  data-app-control-hover="true"
>
  <dynamic-icon name={theme.icon} size={16} />
</button>
```

**保留约束**:
- 不变窗体 drag region(`WebkitAppRegion: 'no-drag'`)
- 不变按钮尺寸(32x32)
- hover 走 `[data-app-control-hover]` 已存在规则

### 4.2 ThemeRegistry (新增)

**新文件: `src/design-system/ThemeRegistry.ts`**

```typescript
import type { ThemeId, ThemeMeta } from './themeTypes';

// 编译时扫描 themes/*.ts, eager 加载所有主题 meta
const modules = import.meta.glob<ThemeMeta>('./themes/*.ts', { eager: true, import: 'default' });

const registry = new Map<ThemeId, ThemeMeta>();

Object.values(modules).forEach((meta) => {
  if (meta && typeof meta.id === 'string') {
    registry.set(meta.id, meta);
  }
});

export function listThemes(): ThemeMeta[] {
  return Array.from(registry.values());
}

export function getTheme(id: ThemeId): ThemeMeta | null {
  return registry.get(id) ?? null;
}

export function getDefaultTheme(): ThemeMeta {
  const def = listThemes().find(t => t.isDefault);
  return def ?? listThemes()[0];
}

export function getNextTheme(currentId: ThemeId): ThemeMeta {
  const list = listThemes();
  const idx = list.findIndex(t => t.id === currentId);
  if (idx === -1 || list.length <= 1) return list[0];
  return list[(idx + 1) % list.length];
}

export function isRegisteredTheme(id: string): id is ThemeId {
  return registry.has(id);
}
```

**关键点**:
- `import.meta.glob` 是 Vite 内置, 编译时扫描, 0 运行时开销
- `eager: true` 同步加载, 避免 Provider mount 时异步等待
- 删 `themes/anime.ts` → `registry` 自动少一项, 切换按钮跳过 anime
- 加 `themes/dark.ts` → `registry` 自动多一项, 切换按钮循环到 dark

### 4.3 themeTypes (新增)

**新文件: `src/design-system/themeTypes.ts`**

```typescript
import type { LucideIcon } from 'lucide-react';

export type ThemeId = string;  // 运行时收窄, 不再硬编码 union

export interface ThemeMeta {
  /** 主题唯一 id, 跟 [data-theme="<id>"] 选择器对应 */
  id: ThemeId;
  /** 中文显示名, 用于切换按钮 title / settings 页 */
  name: string;
  /** 主题描述, 用于 settings 页 tooltip */
  description?: string;
  /** lucide icon 名(字符串), 切换按钮当前主题图标 */
  icon: string;  // e.g. 'sun' / 'sparkles'
  /** 是否默认主题(首次启动 / localStorage 无效时) */
  isDefault?: boolean;
  /** 主题色板预览(用于 settings 页色卡), 可选 */
  preview?: {
    accent: string;
    bg: string;
    text: string;
  };
}
```

### 4.4 主题插件文件 (新增 2 个 .ts + 2 个 .css)

**新文件: `src/design-system/themes/light.ts`**

```typescript
import type { ThemeMeta } from '../themeTypes';

const light: ThemeMeta = {
  id: 'light',
  name: '极简卡片',
  description: '瓷白底 + 蓝色 accent, 现状保留',
  icon: 'sun',
  isDefault: true,
  preview: { accent: '#0969DA', bg: '#FAFAF7', text: '#1F2328' },
};

export default light;
```

**新文件: `src/design-system/themes/anime.ts`**

```typescript
import type { ThemeMeta } from '../themeTypes';

const anime: ThemeMeta = {
  id: 'anime',
  name: '二次元',
  description: '薄荷汽水色 + 圆胖厚边 + 软弹动效',
  icon: 'sparkles',
  preview: { accent: '#06B6D4', bg: '#F0FDFA', text: '#134E4A' },
};

export default anime;
```

**新文件: `src/design-system/themes/light.css`** — 留空或放 light 专属规则(本轮 light 无专属, 全走 token)

**新文件: `src/design-system/themes/anime.css`** — anime 专属规则(圆胖厚边 + 双层阴影 + Fredoka):

```css
/* 二次元专属: 圆胖厚边 + 双层环境光阴影 + 软弹 */
[data-theme="anime"] .card {
  border-width: 3px;
  border-radius: 20px;
  box-shadow: 0 2px 6px rgba(6, 182, 212, 0.12), 0 4px 16px rgba(6, 182, 212, 0.08);
}
[data-theme="anime"] .card:hover {
  transform: translateY(-3px) rotate(-0.3deg);
  box-shadow: 0 4px 12px rgba(6, 182, 212, 0.16), 0 12px 32px rgba(6, 182, 212, 0.10);
  border-color: #99F6E4;
  transition: transform 280ms cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 200ms ease, border-color 200ms ease;
}
[data-theme="anime"] .btn {
  border-width: 2px;
  border-radius: 14px;
  font-weight: 600;
  box-shadow: 0 1px 2px rgba(6, 182, 212, 0.10);
  transition: transform 150ms cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 150ms ease;
}
[data-theme="anime"] .btn:hover { transform: translateY(-2px); }
[data-theme="anime"] .btn-primary { background: var(--accent); border-color: var(--accent); }
[data-theme="anime"] h1, [data-theme="anime"] h2 { font-family: 'Fredoka', 'Nunito', sans-serif; }
/* ... 其他专属规则 */
```

**重要原则**: `themes/anime.css` 全部用 `[data-theme="anime"]` 前缀, 0 通用规则污染 light。

### 4.5 ThemeProvider 改造

**改 `src/design-system/ThemeProvider.tsx`**:

```typescript
// 扔掉: export type Theme = 'light';
// 扔掉: function isTheme(value) { return value === 'light'; }

import { listThemes, getTheme, getDefaultTheme, isRegisteredTheme } from './ThemeRegistry';
import type { ThemeId, ThemeMeta } from './themeTypes';

export interface ThemeContextValue {
  theme: ThemeMeta;          // 当前主题完整 meta
  themes: ThemeMeta[];       // 所有注册主题(切换按钮用)
  setTheme: (id: ThemeId) => void;
}

const STORAGE_KEY = 'ccm.theme';

export function ThemeProvider({ children }: { children: ReactNode }): ReactElement {
  const [themeId, setThemeId] = useState<ThemeId>(() => {
    if (typeof window === 'undefined') return getDefaultTheme().id;
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isRegisteredTheme(stored) ? stored : getDefaultTheme().id;
  });

  // 持久化
  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, themeId);
  }, [themeId]);

  // 写 data-theme 到 <html>
  useEffect(() => {
    document.documentElement.dataset.theme = themeId;
  }, [themeId]);

  const theme = getTheme(themeId) ?? getDefaultTheme();
  const themes = listThemes();
  const setTheme = useCallback((id: ThemeId) => {
    if (isRegisteredTheme(id)) setThemeId(id);
  }, []);

  const value = useMemo(() => ({ theme, themes, setTheme }), [theme, themes, setTheme]);
  return <ThemeProviderContext.Provider value={value}>{children}</ThemeProviderContext.Provider>;
}
```

**关键变化**:
- `theme` 从 `Theme`(union) 变成 `ThemeMeta`(对象), 消费方拿 `theme.id` / `theme.name` / `theme.icon`
- `themes` 数组暴露所有注册主题, 切换按钮用它循环
- `setTheme(id)` 内部用 `isRegisteredTheme` 校验, 拒绝未注册 id
- 旧 localStorage 值(`'glass-clear'` / `'dark'` / `'auto'` / `'light'` 等)若不在新 registry 中, 自动 fallback 到 `getDefaultTheme().id`

### 4.6 tokens.css 改造

**`src/design-system/tokens.css` 第 31-117 行(原 :root 块)改为**:

```css
/* ── 极简 light(现状, 默认)── */
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
  --shadow-sm: 0 1px 3px rgba(0,0,0,0.04);
  --shadow-md: 0 4px 12px rgba(0,0,0,0.08);
  --card-radius:   8px;
  --button-radius: 6px;
  --card-border-width: 1px;
  --header-height: 48px;
  --sidebar-width: 220px;
  --font-ui: -apple-system, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
  --font-mono: "Cascadia Code", "SF Mono", Menlo, Consolas, monospace;
}

/* ── 二次元 anime(薄荷汽水)── */
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
  --shadow-sm: 0 2px 6px rgba(6, 182, 212, 0.12), 0 4px 16px rgba(6, 182, 212, 0.08);
  --shadow-md: 0 4px 12px rgba(6, 182, 212, 0.16), 0 12px 32px rgba(6, 182, 212, 0.10);
  --card-radius:   20px;
  --button-radius: 14px;
  --card-border-width: 3px;
  --header-height: 56px;
  --sidebar-width: 240px;
  --font-ui: 'Nunito', -apple-system, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
  --font-mono: "JetBrains Mono", "Cascadia Code", "SF Mono", Menlo, Consolas, monospace;
}
```

**注**:
- `--bg-overlay / --shadow-*` 是结构 token(每个主题有自己值), 各写一份
- `--view-transition-duration` 留在 :root(全主题共享)
- `--blur-md / --glass-*` 留现状 light 块(暂未使用, 后续玻璃主题再加)

### 4.7 各页面渐变 / emoji 清理(light 与 anime 共享)

**改造原则(不区分主题, 全局清理)**:
- 任何 2 段以上 `linear-gradient(135deg, X 0%, Y 100%)` 装饰渐变 → 实色
- 单段 `linear-gradient(180deg, X, Y)` 数据柱图 → 实色
- 文本 emoji(✨⚡🌸🐳🌙🌟🎉🎀) → 删除或换 lucide icon
- 头像渐变盒 → 拆 4 色纯色盒(ZP/AD/DS/MK)

**范围**:
- 内页: provider-list, mcp-management, usage-query, marketplace, optimizer
- 主页(home): 项目卡片 / KPI 渐变 / 表头

**不动的渐变**:
- `.os-shell` 桌面外圈 4 段深青墨渐变(anime 主题独有, light 主题下是 :root 的 E5E7EB 灰)
- chart 内的"单柱高亮"暖黄柱(对比保留)

### 4.8 列表行状态机细节(已验证, 2026-06-22 demo 审稿 4 轮迭代)

> 本节记录 demo 审稿阶段发现的 4 个具体 bug 及其修法。实施 plan 阶段
> 必须照此实现, 不要回到"light 主题语义照搬到 anime"的旧写法。

#### 4.8.1 `.list-row` 边框 4 边统一, 不"挖左边"

**错误写法(原 demo C)**:
```css
.list-row {
  border: var(--card-border-width) solid var(--border);
  border-left: 2px solid transparent;  /* ❌ 硬编码 2px, 跟 anime 3px 不一致 */
}
.list-row.active {
  border-left-color: var(--accent);    /* ❌ 只改 left 色, left 宽度仍 2px, 被压住 */
}
```

**问题**: anime 主题 `--card-border-width: 3px`, 但 `border-left: 2px` 硬编码,
导致未选条目左侧"少一截"(3px 边里只显示 2px transparent), 选中条目左侧彩条
被 3px 边压成 2px, 视觉上看不见。

**正确写法**:
```css
.list-row {
  border: var(--card-border-width) solid var(--border);
  /* 不写 border-left, 4 边统一用 --card-border-width */
}
.list-row.active {
  border-color: var(--accent);     /* 4 边整圈变彩 */
  background: var(--accent-soft);  /* 软底色 */
  /* 不加 inset shadow, 不加 border-left 特殊处理 */
}
```

#### 4.8.2 `.list-row.active` 禁止用 `inset` shadow 做高亮

**错误写法(我中途加过, 被用户驳回)**:
```css
[data-theme="anime"] .list-row.active {
  box-shadow: var(--shadow-sm), inset 4px 0 0 var(--accent);  /* ❌ */
}
```

**问题**: `inset 4px` 叠在 3px border 内侧, 左侧视觉变 7px 厚, 看起来
"多了一层边框 + 变宽", 跟其他 3 边不对称。

**原则(CLAUDE.md §2.4 最小化影响)**: 选中状态只改 `border-color` + `background`,
不引入额外 box-shadow 层。如果未来要"左侧高亮线"语义, 用伪元素 `::before`
绝对定位, 不用 inset shadow。

#### 4.8.3 `.badge` 固定高度 + line-height: 1

**错误写法(原 demo C)**:
```css
.badge {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 2px 8px; border-radius: 4px;
  font-size: 11px; font-weight: 600;
  /* ❌ 无固定高度, anime 主题 padding 3px + border 2px 撑高到 24px, 跟同行 name 18px 不齐 */
}
```

**正确写法**:
```css
.badge {
  display: inline-flex; align-items: center; justify-content: center; gap: 4px;
  padding: 2px 8px; border-radius: 4px;
  font-size: 11px; font-weight: 600; line-height: 1;
  height: 20px; box-sizing: border-box; flex-shrink: 0;
}
[data-theme="anime"] .badge {
  padding: 0 10px; border-radius: 10px; border: 2px solid; height: 22px;
}
```

**关键点**:
- `line-height: 1` 锁文字基线, 消除字体差异漂移
- `height` 固定(light 20px / anime 22px), `box-sizing: border-box` 让 padding+border 算进高度
- `flex-shrink: 0` 防止 badge 在窄空间被压缩

#### 4.8.4 选中行"已激活"badge 必须 是 `.list-row` 直接子级

**错误结构(原 demo C)**:
```html
<div class="list-row active">
  <div class="provider-avatar">ZP</div>
  <div style="flex:1">
    <div style="display:flex; align-items:center">  <!-- 内部 flex -->
      <span class="name">zhipu-prod</span>
      <span class="badge badge-active" style="margin-left:auto">● 已激活</span>  <!-- ❌ 在内部 flex 里 -->
    </div>
    <div>api_base</div>
  </div>
  <button class="btn-ghost">导出</button>  <!-- 在 list-row 直接子级 -->
</div>
```

**问题**: "已激活"badge 在内部 flex 容器里, "导出"按钮在 `.list-row` 直接子级,
两者是叔侄关系, `.list-row` 的 `align-items: center` 管不到它们之间对齐,
导致"已激活"跟"导出"按钮垂直位置错开。

**正确结构**:
```html
<div class="list-row active">
  <div class="provider-avatar">ZP</div>
  <div style="flex:1; min-width:0">
    <div style="display:flex; align-items:center; gap:8px; margin-bottom:4px">
      <span class="name">zhipu-prod</span>
      <span class="badge badge-type">zhipu</span>
      <span class="meta">· 5 个模型</span>
      <!-- 不放"已激活"badge -->
    </div>
    <div class="mono">api_base</div>
    <div>3 分钟前使用</div>
  </div>
  <span class="badge badge-active" style="flex-shrink:0">● 已激活</span>  <!-- ✅ list-row 直接子级 -->
  <button class="btn-ghost">导出</button>
</div>
```

**原则**: 任何"行级状态指示器"(已激活/已禁用/已同步等 badge)必须跟"行级操作按钮"
(导出/删除/切换)在同一 flex 层级, 这样 `.list-row` 的 `align-items: center`
能统一管它们对齐。

---

## 5. 动效规范

| 元素 | light 主题 | anime 主题 | 时长 | 缓动 |
|---|---|---|---|---|
| 主题切换 | 主题色 fade | 主题色 fade + 卡片轻微反弹 | 200ms | ease(anime: cubic-bezier(0.34,1.56,0.64,1)) |
| card hover | box-shadow 升级 | translateY(-3px) + shadow 升级 | 200ms | ease / soft bounce |
| btn hover | bg 变化 | translateY(-2px) + shadow | 150ms | ease / soft bounce |
| view transition | fadeIn 150ms | bounceIn 280ms | 已定义 | ease-out |
| 切换按钮旋转 | 无 | 点击 360° 旋转 1 次 | 400ms | cubic-bezier |

**prefers-reduced-motion** — 全局 CSS:
```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```
放入 `utilities.css` 顶部。

---

## 6. TDD 计划(先测后写)

### 6.1 单元测试(vitest, 现有框架)

**`src/design-system/ThemeRegistry.test.ts`** (新文件):
```typescript
import { listThemes, getTheme, getDefaultTheme, getNextTheme, isRegisteredTheme } from './ThemeRegistry';

describe('ThemeRegistry', () => {
  it('listThemes 返回所有扫描到的主题(light + anime)', () => { /* ... */ });
  it('getTheme("light") 返回 light meta', () => { /* ... */ });
  it('getTheme("不存在的id") 返回 null', () => { /* ... */ });
  it('getDefaultTheme 返回 isDefault=true 的主题(light)', () => { /* ... */ });
  it('getNextTheme("light") 循环到 anime', () => { /* ... */ });
  it('getNextTheme("anime") 循环回 light(2 主题循环)', () => { /* ... */ });
  it('isRegisteredTheme 拒绝 "glass-clear" / "dark" / "auto" / 乱字符串', () => { /* ... */ });
});
```

**`src/design-system/ThemeProvider.test.tsx`** (新文件):
```typescript
import { render, screen, act } from '@testing-library/react';
import { ThemeProvider, useTheme } from './ThemeProvider';

function Consumer() {
  const { theme, themes, setTheme } = useTheme();
  return (
    <div>
      <span data-testid="current">{theme.id}</span>
      <span data-testid="count">{themes.length}</span>
      <button onClick={() => setTheme('anime')}>switch</button>
    </div>
  );
}

describe('ThemeProvider', () => {
  beforeEach(() => localStorage.clear());

  it('默认主题 = light', () => { /* ... */ });
  it('setTheme("anime") 写入 localStorage + data-theme', () => { /* ... */ });
  it('读取 localStorage 旧值(不在 registry)fallback 到 default', () => { /* ... */ });
  it('setTheme 拒绝未注册 id(不切主题)', () => { /* ... */ });
  it('themes 数组长度 = registry 大小', () => { /* ... */ });
});
```

**`src/components/AppHeader.test.tsx`** (新文件, 验证切换按钮):
```typescript
it('渲染 theme 切换按钮', () => { /* ... */ });
it('点击切换按钮触发 setTheme 到下一个主题', () => { /* ... */ });
it('当前主题 icon = theme.meta.icon', () => { /* ... */ });
it('只有 1 个主题时按钮 disabled', () => { /* ... */ });
it('切换按钮有 title 提示(鼠标悬停可读)', () => { /* ... */ });
```

### 6.2 集成测试(Playwright / WebDriverIO, 已有 tauri-driver 框架)

不在 v3.0 范围(CLAUDE.md §5.1 强调 UI 自动化测试必做, 但本轮优先把 token / 按钮 / 主题机制落地; 集成测试 v3.0.1 补)。**预留卡口**: 实施 plan 中须明确"本轮不做 e2e, 但 1 个手动 smoke test 必过"。

### 6.3 手动 smoke test(必过)

按 CLAUDE.md §9.4:
1. 启动 dev exe → 进程 5 秒内运行
2. 检测主窗口(标题"Claude 配置管理器")
3. 检测托盘图标
4. 进程清理

加本轮主题特定:
5. 启动默认 light 主题(对比现状截图)
6. 点击 AppHeader 主题切换按钮 → 立即变 anime(薄荷色)
7. F5 重启 → localStorage 持久化, 仍是 anime
8. 切回 light → 恢复瓷白
9. 3 个内页(主页/Provider 列表/用量)主题色均正确生效
10. **插件机制验证**: 临时删 `src/design-system/themes/anime.ts` + `anime.css`, 重启 dev → registry 只剩 light, 切换按钮 disabled

---

## 7. 风险与依赖

### 7.1 已知风险

| 风险 | 概率 | 缓解 |
|---|---|---|
| `import.meta.glob` 在 vitest 测试环境不工作 | 中 | vitest 配置已支持 Vite glob(import.meta.glob 是 Vite 内置); 测试用 vi.mock 或 fixtures |
| 现有页面有内联 `style={{color:'#0969DA'}}` 写死, 切 anime 不变 | 中 | 实施 plan 阶段用 grep 扫, 改成 `var(--accent)` |
| 头像 `provider-avatar` class 命名在某些页面不一致 | 中 | 4 个内页逐一 grep, 改统一 class |
| `--bg-overlay / --shadow-sm` 改名 light 块变量(破坏 CLAUDE.md §4 token 纪律) | 低 | 保持变量名, 仅改值 |
| Phosphor icon 在 Tauri WebView2 release 模式下不可用 | 低 | demo C 用了 Phosphor CDN 做验证, **落地代码不引入 Phosphor**, 只用 project 已锁版本的 lucide-react |
| 二次元主题的 `text-shadow / cubic-bezier` 大量增加, 导致 CSS 文件 10% 增长 | 低 | themes/anime.css 单独文件, light 主题 0 字节增长 |
| 切换按钮在窗体 drag 区域内 | 0 | `WebkitAppRegion: 'no-drag'` 已写 |
| 删主题文件后 tokens.css 残留 `[data-theme="<id>"]` 块(死代码) | 中 | 实施 plan 加 lint 规则: tokens.css 的 `[data-theme]` id 必须在 themes/*.ts 中存在 |
| `ThemeId = string` 失去类型安全, 拼错 id 不报错 | 中 | `isRegisteredTheme` 运行时收窄 + `setTheme` 内部校验; 编译时无保护但运行时不崩 |

### 7.2 不在范围

- Mica / vibrancy 真实透桌面窗体 — commit e8b4b56 已 commit 不修
- Settings 弹窗 — 后续版本
- 主题市场(marketplace) — 远期
- macOS vibrancy — 同 7.1
- demo A/B/D/E 接入主题切换 — 本轮只动 demo C 主题色作落地参照
- 动态加载主题(运行时 fetch 主题包) — 本轮 glob 是编译时扫描, 不是运行时

### 7.3 依赖

- 无新 npm 依赖(已用 lucide-react, 0 新增)
- 无新 Cargo 依赖(不涉及 Rust)
- 无数据库迁移
- Vite `import.meta.glob` 是 Vite 内置, 0 配置

---

## 8. 落地路径(实施 plan 阶段拆)

按 CLAUDE.md §2.4 顺序(原子提交), 建议 6 个 commit:

1. **commit 1: 新建 ThemeRegistry + themeTypes + themes/*.ts** — 建插件目录, 写 light.ts + anime.ts meta, 写 Registry 扫描逻辑, 加单测; 0 视觉影响(还没接 Provider)
2. **commit 2: 改造 ThemeProvider 接 Registry** — 扔掉 enum, 改用 Registry; 加 Provider 单测; 0 视觉影响(data-theme 写入但 tokens.css 没拆)
3. **commit 3: tokens.css 拆 light / anime + themes/*.css** — 改 :root 加 [data-theme="anime"], 加 themes/anime.css 专属规则; 视觉看 anime 默认(临时, 验证后切回 light)
4. **commit 4: AppHeader 加切换按钮** — 加 icon button, 接 useTheme, 写按钮单测; 视觉看切换生效
5. **commit 5: 内页渐变 / emoji 清理 + §4.8 列表行状态机** — 14 个页面逐个扫, 改渐变实色 + 去 emoji + avatar class 统一; **重点照 §4.8 4 条规则改 `.list-row` / `.badge` / 选中行 HTML 结构**, 不要回到"light 语义照搬到 anime"的旧写法; 局部
6. **commit 6: 手动 smoke + 文档** — 跑 CLAUDE.md §9.4 smoke test + §6.3 主题特定 10 项, 写 STATE.md "v3.0 主题重构" 段落

**插曲**: commit 3 期间要切回 light 做回归测试, 通过后保留 light 默认。

---

## 9. 附录

### 9.1 demo 颜色对照(已通过 demo C 落地验证)

| 元素 | light | anime |
|---|---|---|
| 背景 | `#FAFAF7` 瓷白 | `#F0FDFA` 米白薄荷 |
| 卡片背景 | `#FFFFFF` | `#FFFFFF`(共享) |
| 卡片边 | `#E1E4E8` 浅灰 | `#CCFBF1` 薄荷边 3px |
| 主文字 | `#1F2328` | `#134E4A` 青墨 |
| accent | `#0969DA` 蓝 | `#06B6D4` 薄荷青 |
| 圆角 | 8px | 20px(圆胖) |
| 卡片阴影 | `0 1px 3px rgba(0,0,0,0.04)` | `0 2px 6px + 0 4px 16px` 双层薄荷 |
| 字体 | 系统默认 | Nunito + Fredoka 圆头 |
| 动效时长 | 150-200ms ease | 200-280ms cubic-bezier 软弹 |

### 9.2 关键文件清单

| 文件 | 改/新 | 说明 |
|---|---|---|
| `src/design-system/themeTypes.ts` | 新 | ThemeId / ThemeMeta 接口 |
| `src/design-system/ThemeRegistry.ts` | 新 | 运行时注册表 + glob 扫描 |
| `src/design-system/ThemeRegistry.test.ts` | 新 | Registry 单测 |
| `src/design-system/ThemeProvider.tsx` | 改 | 扔掉 enum, 接 Registry |
| `src/design-system/ThemeProvider.test.tsx` | 新 | Provider 单测 |
| `src/design-system/tokens.css` | 改 | :root 拆 + [data-theme="anime"] 加 |
| `src/design-system/themes/light.ts` | 新 | light 主题 meta |
| `src/design-system/themes/light.css` | 新 | light 专属规则(本轮空) |
| `src/design-system/themes/anime.ts` | 新 | anime 主题 meta |
| `src/design-system/themes/anime.css` | 新 | anime 专属规则(圆胖厚边 + 双层阴影 + Fredoka) |
| `src/design-system/utilities.css` | 改 | prefers-reduced-motion 块 |
| `src/components/AppHeader.tsx` | 改 | 加切换按钮 + useTheme |
| `src/components/AppHeader.test.tsx` | 新 | 切换按钮单测 |
| 14 个内页(`.tsx` 文件) | 扫 | 渐变实色 + 去 emoji + avatar class |

### 9.3 参考材料

- `tmp/ui-redesign/demo-c-anime.html` — 薄荷色 demo C, **落地参照基准**
- `[[reference-tauri-mica-fallback-deployed]]` — Mica 不透 webview, 玻璃方案不可行
- `CLAUDE.md` §2.1(架构先行)+ §2.4(谨慎修改文件)+ §4(token 纪律)+ §9(交付纪律)
- Vite `import.meta.glob` 官方文档: https://vitejs.dev/guide/features.html#glob-import
