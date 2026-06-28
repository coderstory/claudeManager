/**
 * Frontend plugin registry — Phase 44 派生收敛重写。
 *
 * 旧断言只检查 id/name/routes,Phase 44 增 4 字段后必须验证每个
 * plugin 都有 viewId/pageMeta/componentEntry/sidebarTile。
 * 9 stub (含 mcp-management,Phase 47 D-44-A → 8) 每个有完整字段。
 */
import { describe, it, expect } from 'vitest';
import {
  ALL_PLUGINS,
  PAGE_META,
  VIEW_META,
  VIEW_COMPONENTS,
} from '../plugins/registry';
import type { FrontendPlugin } from '../plugins/types';

describe('Frontend plugin registry — Phase 44 派生收敛', () => {
  it('contains 9 plugin stubs (Phase 47 → 8 after mcp-management removal)', () => {
    expect(ALL_PLUGINS.length).toBe(9);
  });

  it('every plugin has unique kebab-case id + matching viewId', () => {
    const ids = ALL_PLUGINS.map((p) => p.id);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(dupes, `duplicate ids: ${dupes.join(', ')}`).toEqual([]);
    for (const id of ids) {
      expect(id, `id must be kebab-case: ${id}`).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
    for (const p of ALL_PLUGINS) {
      expect(p.viewId, `${p.id}.viewId 必填且 === id`).toBe(p.id);
    }
  });

  it('every plugin has pageMeta { title, description }', () => {
    for (const p of ALL_PLUGINS) {
      expect(p.pageMeta.title.length, `${p.id}.pageMeta.title empty`).toBeGreaterThan(0);
      expect(
        p.pageMeta.description.length,
        `${p.id}.pageMeta.description empty`,
      ).toBeGreaterThan(0);
    }
  });

  it('every plugin has sidebarTile { icon (LucideIcon), short, order, group }', () => {
    for (const p of ALL_PLUGINS) {
      const tile = p.sidebarTile;
      expect(tile, `${p.id}.sidebarTile must be defined`).toBeDefined();
      expect(tile!.icon, `${p.id}.sidebarTile.icon must be a LucideIcon`).toBeDefined();
      expect(['object', 'function']).toContain(typeof tile!.icon);
      expect(tile!.short.length).toBeGreaterThan(0);
      expect(typeof tile!.order).toBe('number');
      expect(tile!.group).toMatch(/^(main|utility)$/);
    }
  });

  it('every plugin has componentEntry { component, propsBuilder }', () => {
    for (const p of ALL_PLUGINS) {
      const entry = p.componentEntry;
      expect(
        typeof entry.component,
        `${p.id}.componentEntry.component should be ComponentType`,
      ).toBe('function');
      expect(typeof entry.propsBuilder).toBe('function');
    }
  });

  it('resource-browser.sidebarTile.migrateFrom = { fromViewId: "mcp-management", appendQuery: { tab: "mcp" } }', () => {
    const rb = ALL_PLUGINS.find((p) => p.id === 'resource-browser');
    expect(rb).toBeDefined();
    expect(rb!.sidebarTile!.migrateFrom).toEqual({
      fromViewId: 'mcp-management',
      appendQuery: { tab: 'mcp' },
    });
  });

  it('every route has unique absolute path + pluginId matches', () => {
    const paths = ALL_PLUGINS.flatMap((p) => p.routes.map((r) => r.path));
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      expect(path.startsWith('/')).toBe(true);
    }
    const dupes = paths.filter((p, i) => paths.indexOf(p) !== i);
    expect(dupes).toEqual([]);
    const ids = new Set(ALL_PLUGINS.map((p: FrontendPlugin) => p.id));
    for (const p of ALL_PLUGINS) {
      for (const r of p.routes) {
        expect(ids.has(r.pluginId), `${p.id} 路由 ${r.path} pluginId 未知`).toBe(true);
      }
    }
  });

  it('registry-derived PAGE_META / VIEW_META / VIEW_COMPONENTS cover all 12 views', () => {
    // Cross-check the derived collections match the union of 3 core
    // + 9 plugins.
    for (const p of ALL_PLUGINS) {
      expect(PAGE_META[p.viewId]).toBeDefined();
      expect(VIEW_META[p.viewId]).toBeDefined();
      expect(VIEW_COMPONENTS.get(p.viewId)).toBeDefined();
    }
    // 3 core views
    expect(PAGE_META.home).toBeDefined();
    expect(PAGE_META.history).toBeDefined();
    expect(PAGE_META.about).toBeDefined();
    expect(VIEW_META.home).toBeDefined();
    expect(VIEW_META.history).toBeDefined();
    expect(VIEW_META.about).toBeDefined();
    expect(VIEW_COMPONENTS.get('home')).toBeDefined();
    expect(VIEW_COMPONENTS.get('history')).toBeDefined();
    expect(VIEW_COMPONENTS.get('about')).toBeDefined();
  });
});