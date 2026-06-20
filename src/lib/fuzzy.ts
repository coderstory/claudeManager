/**
 * Fuzzy match — M2.11 F9 (升级 QuickSearchModal 用的 fuzzy 算法).
 *
 * Algorithm: fzy-style subsequence scoring.
 *   - Characters of `query` must appear in `target` in order.
 *   - Consecutive matches get a +10 bonus each.
 *   - The first match at position 0 of target gets a +20 bonus.
 *   - A match preceded by a separator (_, -, space, /, .) gets +5.
 *   - Case-insensitive: 'M' / 'm' / 'm' all match 'M', but the
 *     recorded `matches` index is in the TARGET's coordinate
 *     (so the renderer can wrap `<mark>` around the right glyph).
 *   - Empty query → score 0, matches [].
 *   - Subsequence impossible → return null.
 *
 * Why this is a pure module with no React dep:
 *   - CLAUDE.md §3.1 keeps pure functions in src/lib/.
 *   - Unit-testable without jsdom (8 cases, sub-millisecond).
 *   - Reusable: any future command-palette / search box / file
 *     picker can import fuzzySearch and get the same ranking.
 *
 * Tuning notes:
 *   - Score weights are hand-tuned, not derived from fzy's
 *     original formula. fzy uses a 2-row DP with strict-gapped /
 *     gapped / exact-match runs — that's overkill for our 12
 *     plugin labels + a few dozen provider / MCP rows. The
 *     simpler "bonus per match" formula gives nearly identical
 *     ordering on real inputs and is 5 lines of code.
 */
export interface FuzzyResult {
  /** Original index in the input array. */
  index: number;
  /** Higher = more relevant. Empty query returns 0. */
  score: number;
  /** Indices in `target` where each character of `query` matched. */
  matches: number[];
}

/** Characters treated as word separators for the "start of word" bonus. */
const SEPARATORS = new Set(['_', '-', ' ', '/', '.', ':']);

function isSeparator(ch: string | undefined): boolean {
  return ch !== undefined && SEPARATORS.has(ch);
}

/**
 * Single-target fuzzy match.
 *
 * @param query  The search string (user-typed). May be empty.
 * @param target The candidate string. May be empty.
 * @returns      A FuzzyResult, or null if the query's characters
 *               cannot be found as an in-order subsequence.
 */
export function fuzzyMatch(query: string, target: string): FuzzyResult | null {
  if (query === '') {
    return { index: 0, score: 0, matches: [] };
  }
  if (target === '') return null;

  const q = query.toLowerCase();
  const t = target.toLowerCase();

  const matches: number[] = [];
  let prevTargetIdx = -2; // sentinel: not "previous" so no consecutive bonus on first match
  let score = 0;

  let tIdx = 0;
  for (let qIdx = 0; qIdx < q.length; qIdx++) {
    const qch = q[qIdx]!;
    let found = -1;
    for (let i = tIdx; i < t.length; i++) {
      if (t[i] === qch) {
        found = i;
        break;
      }
    }
    if (found === -1) return null;
    matches.push(found);

    // Bonuses — applied per matched character.
    // 1. Consecutive: previous match was at found-1 in target.
    if (found === prevTargetIdx + 1) score += 10;
    // 2. Start of word: preceded by a separator (or at pos 0).
    if (found === 0 || isSeparator(target[found - 1])) score += 5;
    // 3. Leading match: first match at position 0 of target.
    if (qIdx === 0 && found === 0) score += 20;

    prevTargetIdx = found;
    tIdx = found + 1;
  }

  return { index: 0, score, matches };
}

/**
 * Fuzzy-search across many targets, sorted by score descending.
 *
 * Empty query → returns [] (the caller renders its own default
 * list — QuickSearchModal shows all 12 plugins + live providers
 * / MCP servers before the user types anything).
 *
 * No-match query → returns [].
 */
export function fuzzySearch(query: string, targets: readonly string[]): FuzzyResult[] {
  if (query === '') return [];
  const out: FuzzyResult[] = [];
  for (let i = 0; i < targets.length; i++) {
    const r = fuzzyMatch(query, targets[i]!);
    if (r !== null) {
      out.push({ index: i, score: r.score, matches: r.matches });
    }
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}