/**
 * A9 bug regression test (2026-06-29 reverify) + v3.4 主题精简
 * ----------------------------------------------------------------
 * Bug: 用户报 "删除 mc + pure-black 主题" (清单 §1 A9 行).
 * v3.4: 用户报 "删除 dark + pixel 主题", 主题从 5 → 3.
 * NO-OP 状态: themeIds.ts 已只导出 3 个主题 (light / liquid-glass /
 *            editorial),源码 grep 0 命中 (pure-black / mc-theme /
 *            theme-mc / mcTheme / "mc" / 'mc').
 *
 * 防回归 (A9 §5 验证): 本测试锁住 "3 主题 + 字符串列表里不含 mc / pure-black"
 * 两条 invariant. 任一 invariant 失败 → 立刻 FAIL,防止后续 commit 把已删
 * 的主题重新加回 themeIds.ts / themes/*.ts / 任何业务 import.
 *
 * 注: 与 theme-isolation.test.ts 互补 — 后者锁定正向 (3 个必须存在),
 *    本测试锁定负向 (mc / pure-black 必须不存在).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { THEME_IDS, type ThemeIdValue } from '../../design-system/themes/themeIds';

const ALL_THEME_IDS: ThemeIdValue[] = Object.values(THEME_IDS);

describe('A9 回归 + v3.4 主题精简: 已删 mc / pure-black / dark / pixel 主题不可再出现', () => {
  describe('正向 invariant (themeIds.ts 导出列表)', () => {
    it('主题列表长度严格 = 3', () => {
      expect(ALL_THEME_IDS).toHaveLength(3);
    });

    it('3 个主题恰好是 light / liquid-glass / editorial', () => {
      const expected = ['light', 'liquid-glass', 'editorial'];
      expect([...ALL_THEME_IDS].sort()).toEqual([...expected].sort());
    });
  });

  describe('负向 invariant (禁词扫描)', () => {
    it.each([
      ['mc'],
      ['MC'],
      ['pure-black'],
      ['pure_black'],
      ['pureBlack'],
      ['mc-theme'],
      ['theme-mc'],
      ['mcTheme'],
      ['mc_theme'],
      ['dark'],
      ['pixel'],
    ])('主题列表不含禁词 %j', (forbidden) => {
      for (const id of ALL_THEME_IDS) {
        expect(id).not.toBe(forbidden);
        expect(id.toLowerCase()).not.toContain('pure-black');
        expect(id.toLowerCase()).not.toContain('pure_black');
        expect(id.toLowerCase()).not.toMatch(/^mc(-|$)/);
        expect(id.toLowerCase()).not.toMatch(/mc-theme/);
      }
    });

    it('isRegisteredTheme 返回 false for "mc" / "pure-black" / "dark" / "pixel"', async () => {
      const { isRegisteredTheme } = await import('../../design-system/ThemeRegistry');
      expect(isRegisteredTheme('mc')).toBe(false);
      expect(isRegisteredTheme('pure-black')).toBe(false);
      expect(isRegisteredTheme('pure_black')).toBe(false);
      expect(isRegisteredTheme('dark')).toBe(false);
      expect(isRegisteredTheme('pixel')).toBe(false);
    });
  });

  describe('源码层禁词扫描 (themes/ 目录 + themeIds.ts)', () => {
    const themesDir = join(process.cwd(), 'src', 'design-system', 'themes');
    const themeFiles = readdirSync(themesDir).filter(
      (f) => f.endsWith('.ts') || f.endsWith('.css'),
    );

    it.each(themeFiles)('themes/%s 不含 mc / pure-black / dark / pixel 字符串', (file) => {
      const content = readFileSync(join(themesDir, file), 'utf-8');
      const patterns = [
        /(['"])mc\1/,
        /(['"])pure-black\1/,
        /(['"])pure_black\1/,
        /(['"])mc-theme\1/,
        /(['"])theme-mc\1/,
      ];
      for (const re of patterns) {
        expect(content).not.toMatch(re);
      }
    });

    it('themeIds.ts 不导出 mc / pure-black / Dark / Pixel 相关 key', () => {
      const themeIdsContent = readFileSync(
        join(process.cwd(), 'src', 'design-system', 'themes', 'themeIds.ts'),
        'utf-8',
      );
      const forbiddenKeys = ['Mc', 'MC', 'PureBlack', 'pure-black', 'pure_black', 'Dark', 'Pixel'];
      for (const key of forbiddenKeys) {
        expect(themeIdsContent).not.toContain(key);
      }
    });
  });
});
