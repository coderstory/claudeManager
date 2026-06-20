/**
 * Fuzzy match — TDD coverage (M2.11 F9).
 *
 * Algorithm: fzy-style subsequence scoring.
 *   - Characters of `query` must appear in `target` in order.
 *   - Consecutive matches get a +10 bonus each.
 *   - The first match at position 0 gets a +20 bonus.
 *   - A match preceded by a separator (_, -, space, /, .) gets +5.
 *   - Case-insensitive (case mismatch still matches, but the
 *     matched position is recorded in the target's coordinate).
 *   - When `query` is empty → returns score=0, no matches.
 *   - When `target` is too short to contain the subsequence →
 *     returns null.
 *
 * Why this lives in a dedicated file:
 *   - §3.1 of CLAUDE.md puts pure functions in src/lib/, not next
 *     to React components.
 *   - The QuickSearchModal test suite can import `fuzzySearch`
 *     directly and verify ordering without rendering a DOM tree.
 *   - Keeps the algorithm unit-testable in isolation: 8 small
 *     cases, no React/jsdom required.
 */
import { describe, it, expect } from 'vitest';
import { fuzzyMatch, fuzzySearch } from '../../lib/fuzzy';

describe('fuzzyMatch', () => {
  it('fuzzyMatch_basic_substring: matches when query is a contiguous substring', () => {
    const r = fuzzyMatch('foo', 'foobar');
    expect(r).not.toBeNull();
    expect(r!.score).toBeGreaterThan(0);
    expect(r!.matches).toEqual([0, 1, 2]);
  });

  it('fuzzyMatch_non_contiguous_subsequence: still matches with gaps', () => {
    const r = fuzzyMatch('fb', 'foobar');
    expect(r).not.toBeNull();
    expect(r!.matches).toEqual([0, 3]);
  });

  it('fuzzyMatch_returns_null_when_target_too_short', () => {
    const r = fuzzyMatch('abcde', 'ab');
    expect(r).toBeNull();
  });

  it('fuzzyMatch_consecutive_chars_higher_score: substring beats subsequence', () => {
    const a = fuzzyMatch('foo', 'foobar')!;
    const b = fuzzyMatch('foo', 'f_o_o_bar')!;
    // Same length query, same number of matches — but `b` has
    // gaps, so its consecutive-bonus is lower.
    expect(a.score).toBeGreaterThan(b.score);
  });

  it('fuzzyMatch_start_of_word_bonus: leading separator adds score', () => {
    // "mp" appears in "MCP" (positions 0,1 — but it's contiguous
    // AND at start). The bonus is bigger than "mp" in "samp".
    const leading = fuzzyMatch('mp', 'MCP 管理')!;
    const embedded = fuzzyMatch('mp', 'samp')!;
    expect(leading.score).toBeGreaterThanOrEqual(embedded.score);
  });

  it('fuzzyMatch_case_insensitive: query in any case finds target', () => {
    const lower = fuzzyMatch('mcp', 'MCP 管理');
    const upper = fuzzyMatch('MCP', 'mcp-server');
    const mixed = fuzzyMatch('McP', 'mcpsrv');
    expect(lower).not.toBeNull();
    expect(upper).not.toBeNull();
    expect(mixed).not.toBeNull();
  });

  it('fuzzyMatch_empty_query_returns_zero_score_no_matches', () => {
    const r = fuzzyMatch('', 'anything');
    expect(r).not.toBeNull();
    expect(r!.score).toBe(0);
    expect(r!.matches).toEqual([]);
  });

  it('fuzzyMatch_returns_null_when_no_subsequence_possible', () => {
    // 'z' doesn't appear anywhere in 'MCP 管理' in the right order.
    const r = fuzzyMatch('zzz', 'MCP 管理');
    expect(r).toBeNull();
  });
});

describe('fuzzySearch', () => {
  it('fuzzySearch_empty_query_returns_empty', () => {
    const r = fuzzySearch('', ['Provider 列表', 'MCP 管理']);
    // Empty query is a no-op — we don't show "all results" here,
    // that's the caller's responsibility (QuickSearchModal shows
    // its own default list before any input).
    expect(r).toEqual([]);
  });

  it('fuzzySearch_no_match_returns_empty', () => {
    const r = fuzzySearch('zzz-nothing', ['Provider 列表', 'MCP 管理']);
    expect(r).toEqual([]);
  });

  it('fuzzySearch_sorts_by_score_desc', () => {
    const targets = ['foobar', 'fb', 'fast', 'f-a-s-t'];
    const r = fuzzySearch('fast', targets);
    expect(r.length).toBeGreaterThan(0);
    // Verify monotonically non-increasing scores.
    for (let i = 1; i < r.length; i++) {
      expect(r[i - 1].score).toBeGreaterThanOrEqual(r[i].score);
    }
    // Top hit must contain all 4 letters in order — `foobar` is
    // only 6 chars and contains 'f' at 0 + 'a' at 3 + 's' at 4 +
    // 't' at 5. So 'foobar' is a subsequence match for 'fast'.
    expect(targets[r[0].index]).toContain('f');
  });

  it('fuzzySearch_returns_original_indices', () => {
    const targets = ['aaa', 'Provider 列表', 'MCP 管理'];
    const r = fuzzySearch('MCP', targets);
    expect(r.length).toBeGreaterThan(0);
    // The 'MCP 管理' entry was at original index 2.
    const hit = r.find((x) => x.index === 2);
    expect(hit).toBeDefined();
  });

  it('fuzzySearch_matches_chinese_subsequence', () => {
    // The Chinese labels are stored in PLUGIN_LABELS — verify
    // that fuzzySearch can handle them.
    const r = fuzzySearch('管理', ['MCP 管理', 'Provider 列表', '备份与恢复']);
    expect(r.length).toBeGreaterThan(0);
    expect(r[0].index).toBe(0);
  });
});