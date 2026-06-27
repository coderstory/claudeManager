import type { ThemeId, ThemeMeta } from './themeTypes';

// glob 必须用字面量 './themes/*.ts' 写在这里, 不能抽成变量
// 注: 排除 themeIds.ts — 它只导出 named const THEME_IDS, 没有 default,
// vite 'import: default' 会 throw "does not provide an export named 'default'",
// 进而阻塞整个 ThemeProvider mount (ThemeRegistry.ts 顶层 import).
const modules = import.meta.glob<ThemeMeta>(
  [
    './themes/*.ts',
    '!./themes/themeIds.ts',
  ],
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