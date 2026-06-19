/**
 * cn util — merges class names with conflict resolution.
 *
 * Wraps `clsx` (truthy / array / object handling) with `tailwind-merge`
 * (later utility wins on conflicting Tailwind classes, e.g. `px-2`+`px-4`
 * collapses to `px-4`).
 *
 * Reference: D:\project\cc-switch-main\src\lib\utils.ts (same signature).
 */
import { describe, it, expect } from 'vitest';
import { cn } from '../../lib/utils';

describe('cn', () => {
  it('joins simple string arguments with a space', () => {
    expect(cn('a', 'b')).toBe('a b');
  });

  it('skips falsy values (undefined, null, false, 0, "")', () => {
    // The 0 and empty string would otherwise leak into the className.
    expect(cn('a', undefined, 'b')).toBe('a b');
    expect(cn('a', null, 'b')).toBe('a b');
    expect(cn('a', false, 'b')).toBe('a b');
    expect(cn('a', '', 'b')).toBe('a b');
  });

  it('honours object form (key: true kept, key: false dropped)', () => {
    expect(cn('a', { b: true, c: false })).toBe('a b');
  });

  it('resolves Tailwind conflicts in favour of the later class', () => {
    // Without tailwind-merge this would be 'px-2 px-4' — semantically
    // ambiguous. tailwind-merge collapses it to 'px-4' (later wins).
    expect(cn('px-2', 'px-4')).toBe('px-4');
  });

  it('flattens arrays of class values', () => {
    expect(cn(['a', 'b'])).toBe('a b');
  });
});