import { describe, it, expect } from 'vitest';
import { ALL_PLUGINS } from '../plugins/registry';
import type { FrontendPlugin } from '../plugins/types';

describe('Frontend plugin registry', () => {
  it('contains the 11 plugin stubs from CLAUDE.md §3.3 (F2 merged into F1 action button)', () => {
    // F1..F8 core + F16..F19 L1 features = 11 (F2 removed — its action
    // now lives on the F1 [激活] button).
    expect(ALL_PLUGINS.length).toBe(11);
  });

  it('every plugin has a unique kebab-case id', () => {
    const ids = ALL_PLUGINS.map((p) => p.id);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(dupes, `duplicate ids: ${dupes.join(', ')}`).toEqual([]);
    for (const id of ids) {
      expect(id, `id must be kebab-case: ${id}`).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it('every plugin has a non-empty display name', () => {
    for (const p of ALL_PLUGINS) {
      expect(p.name.length, `plugin ${p.id} has empty name`).toBeGreaterThan(0);
    }
  });

  it('every route has a unique absolute path', () => {
    const paths = ALL_PLUGINS.flatMap((p) => p.routes.map((r) => r.path));
    expect(paths.length, 'expected at least one route across the registry').toBeGreaterThan(0);
    for (const path of paths) {
      expect(path.startsWith('/'), `route path must be absolute: ${path}`).toBe(true);
    }
    const dupes = paths.filter((p, i) => paths.indexOf(p) !== i);
    expect(dupes, `duplicate route paths: ${dupes.join(', ')}`).toEqual([]);
  });

  it('every route\'s pluginId matches a registered plugin id', () => {
    const ids = new Set(ALL_PLUGINS.map((p: FrontendPlugin) => p.id));
    for (const p of ALL_PLUGINS) {
      for (const r of p.routes) {
        expect(
          ids.has(r.pluginId),
          `route ${r.path} on plugin ${p.id} has unknown pluginId "${r.pluginId}"`,
        ).toBe(true);
      }
    }
  });
});