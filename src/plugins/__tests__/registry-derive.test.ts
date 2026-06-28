/**
 * registry.ts derived exports — Phase 44 派生收敛单测。
 *
 * 锁死 5 个派生导出 (ALL_VIEW_IDS / ALL_VIEWS_ORDERED / PAGE_META /
 * VIEW_META / VIEW_COMPONENTS) 的形状,确保"加 1 plugin 改 1 文件"
 * 强验收:加 plugin → 自动并入派生,不需要再手改 registry.ts 派生段。
 */
import { describe, it, expect } from 'vitest';
import {
  ALL_PLUGINS,
  ALL_VIEW_IDS,
  ALL_VIEWS_ORDERED,
  PAGE_META,
  VIEW_META,
  VIEW_COMPONENTS,
  type ViewId,
} from '../registry';

describe('registry.ts derived exports — Phase 44 派生收敛', () => {
  it('ALL_VIEW_IDS = 3 core + 9 plugin = 12', () => {
    expect(ALL_VIEW_IDS.length).toBe(12);
    expect(ALL_VIEW_IDS).toContain('home');
    expect(ALL_VIEW_IDS).toContain('history');
    expect(ALL_VIEW_IDS).toContain('about');
    expect(ALL_PLUGINS.length).toBe(9);
  });

  it('ALL_VIEWS_ORDERED 由 sidebarTile.order 字段驱动', () => {
    expect(ALL_VIEWS_ORDERED.length).toBe(12);
    expect(ALL_VIEWS_ORDERED[0]).toBe('home'); // order=0
    // Last 2 are history (order=100) and about (order=101).
    expect(ALL_VIEWS_ORDERED[10]).toBe('history');
    expect(ALL_VIEWS_ORDERED[11]).toBe('about');
    // mcp-management is in plugin order, but ALL_VIEWS_ORDERED skips
    // it because the stub has no sidebarTile; the plugin is still in
    // ALL_PLUGINS (Phase 46 will delete the stub).
  });

  it('PAGE_META 全部 12 view 都有 title + description', () => {
    for (const id of ALL_VIEW_IDS) {
      const meta = PAGE_META[id as ViewId];
      expect(meta, `${id} missing from PAGE_META`).toBeDefined();
      expect(meta.title.length, `${id}.title empty`).toBeGreaterThan(0);
      expect(meta.description.length, `${id}.description empty`).toBeGreaterThan(0);
    }
  });

  it('VIEW_META 全部 12 view 都有 icon (LucideIcon) + short + order + group', () => {
    for (const id of ALL_VIEW_IDS) {
      const tile = VIEW_META[id as ViewId];
      expect(tile, `${id} missing from VIEW_META`).toBeDefined();
      // lucide-react exports icons as forwardRef objects (`typeof` =
      // 'object' in JS). Acceptable to render as <Icon size={18} />.
      expect(
        tile.icon,
        `${id}.icon must be a LucideIcon (object|function)`,
      ).toBeDefined();
      expect(['object', 'function']).toContain(typeof tile.icon);
      expect(tile.short.length, `${id}.short empty`).toBeGreaterThan(0);
      expect(typeof tile.order, `${id}.order 应为 number`).toBe('number');
      expect(tile.group, `${id}.group 应为 main|utility`).toMatch(/^(main|utility)$/);
    }
  });

  it('VIEW_COMPONENTS Map 12 项 + component + propsBuilder', () => {
    expect(VIEW_COMPONENTS.size).toBe(12);
    for (const id of ALL_VIEW_IDS) {
      const entry = VIEW_COMPONENTS.get(id as ViewId);
      expect(entry, `${id} 应有 componentEntry`).toBeDefined();
      expect(
        typeof entry!.component,
        `${id}.component 应为 ComponentType (function)`,
      ).toBe('function');
      expect(typeof entry!.propsBuilder, `${id}.propsBuilder 应为 function`).toBe(
        'function',
      );
    }
  });

  it('resource-browser.sidebarTile.migrateFrom = { fromViewId: "mcp-management", appendQuery: { tab: "mcp" } }', () => {
    const rb = ALL_PLUGINS.find((p) => p.id === 'resource-browser');
    expect(rb, 'resource-browser must be in ALL_PLUGINS').toBeDefined();
    expect(rb!.sidebarTile!.migrateFrom).toEqual({
      fromViewId: 'mcp-management',
      appendQuery: { tab: 'mcp' },
    });
  });

  it('every plugin has viewId === id (Q44-5 contract)', () => {
    for (const p of ALL_PLUGINS) {
      expect(p.viewId, `${p.id}.viewId must equal id`).toBe(p.id);
    }
  });
});