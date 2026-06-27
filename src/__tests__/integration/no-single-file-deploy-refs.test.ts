/**
 * Regression guard for M5 #18 — "删单文件部署 (F8) 这个菜单和代码".
 *
 * M5-PLAN §2.4 / CLAUDE.md §6.4: 任何 UI 改动必须 4 处同步。这里把
 * "grep 全局无 'single-file-deploy' 引用"的验收逻辑编码进 vitest,
 * 之后任何人无意中重新引入 'single-file-deploy' 字符串 (sidebar
 * entry, plugin stub, 路由, capability grant, plugin id 等) 都会
 * 立刻 fail。
 *
 * ## What this test scans
 *
 *  - `src/`               — TS/TSX source + vitest tests
 *  - `src-tauri/src/`     — Rust source
 *  - `src-tauri/capabilities/` — Tauri capability JSON
 *  - `src-tauri/tests/`   — Rust integration tests
 *  - `tests/e2e/`         — Playwright e2e (historical m2-2-8 / m2-2-9
 *                           specs for F8 were deleted in this commit)
 *
 * Excludes `.archive/` (M1-M4 历史快照) and `.planning/` (历史 plan 文档),
 * because those intentionally mention F8 in the historical record.
 *
 * The regression test itself is also excluded — it has to mention
 * the literal string to assert against it. The exclusion is keyed
 * on the file path, so a future copy-paste of this test under a
 * different name would still be scanned (and fail if it introduced
 * new code references).
 *
 * ## Why this is a vitest and not just a shell `grep` in CI
 *
 * The shell equivalent would be:
 *
 *   grep -rn 'single-file-deploy' src/ src-tauri/src/ \
 *     src-tauri/capabilities/ tests/e2e/ src-tauri/tests/ \
 *     | grep -v 'node_modules\|target/'
 *
 * Both work. The vitest version runs on every `pnpm test`, so a
 * developer who adds a new reference (e.g. copy-pastes a stub from
 * another plugin) gets an immediate red signal rather than
 * learning about it on the next CI run.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

// Vitest 2.1.9 evaluates this file without a usable `import.meta.url`
// in the CJS-style test runner, so we fall back to `process.cwd()`
// which vitest sets to the package root. The repo root is two levels
// up from `src/__tests__/integration/`, but the simpler invariant is
// "cwd contains src/" — and we resolve the well-known anchors
// (src/, src-tauri/) against cwd to be safe.
const CWD = process.cwd();
function anchor(...parts: string[]): string {
  return resolve(CWD, ...parts);
}

/** Directories to scan (resolved against CWD). */
const SCAN_DIRS = [
  anchor('src'),
  anchor('src-tauri/src'),
  anchor('src-tauri/capabilities'),
  anchor('src-tauri/tests'),
  anchor('tests/e2e'),
] as const;

/** File extensions to include (TS / TSX / Rust / JSON). */
const EXTS = new Set(['.ts', '.tsx', '.rs', '.json']);

/** Directories to skip (historical / build artifacts). */
const SKIP_DIRS = new Set(['node_modules', 'target', 'dist', '.archive', '.planning']);

/**
 * Regression-test file path (excluded from scan — see file header).
 * Computed once and frozen as a constant so the assertion is
 * stable across `process.cwd()` variations.
 */
const SELF_PATH = 'src/__tests__/integration/no-single-file-deploy-refs.test.ts';

/**
 * Additional files excluded from the scan — they mention the literal
 * "single-file-deploy" string to assert AGAINST it (e.g. RF-02 regression
 * guards in App.test.tsx that verify sidebar / ALL_VIEWS do NOT
 * contain the removed id). These exclusions MUST stay minimal — if
 * a new file mentions the string, the scan should trip, forcing the
 * author to justify it.
 */
const EXTRA_EXCLUDED_PATHS: ReadonlySet<string> = new Set([
  // App.test.tsx — RF-02 phase 29 added BUG-RF-02 assertions that
  // assert the literal "single-file-deploy" string is NOT present
  // in sidebar / ALL_VIEWS. Excluding this file from the FS scan
  // mirrors the SELF_PATH pattern (the file must mention the
  // string to assert against it).
  'src/__tests__/integration/App.test.tsx',
]);

/**
 * Recursively collect files under `dir` that match EXTS, skipping
 * SKIP_DIRS. Returns absolute paths.
 */
function collectFiles(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    let s;
    try {
      s = statSync(full);
    } catch {
      continue;
    }
    if (s.isDirectory()) {
      out.push(...collectFiles(full));
    } else if (s.isFile()) {
      const dot = name.lastIndexOf('.');
      const ext = dot === -1 ? '' : name.slice(dot);
      if (EXTS.has(ext)) out.push(full);
    }
  }
  return out;
}

interface Hit {
  file: string;
  line: number;
  text: string;
}

/** Scan all collected files for 'single-file-deploy' (literal string). */
function findRefs(): Hit[] {
  const hits: Hit[] = [];
  for (const dir of SCAN_DIRS) {
    for (const file of collectFiles(dir)) {
      const rel = relative(CWD, file);
      // Skip the regression test itself (it has to mention the
      // literal string to assert against it).
      if (rel === SELF_PATH) continue;
      // Skip additional test files that intentionally mention the
      // string in their assertions (see EXTRA_EXCLUDED_PATHS).
      if (EXTRA_EXCLUDED_PATHS.has(rel)) continue;
      // Defensive: any OTHER file with 'single-file-deploy' in its
      // path is a regression (e.g. someone re-creates
      // src/pages/single-file-deploy/index.tsx).
      if (rel.includes('single-file-deploy')) {
        hits.push({ file: rel, line: 0, text: '(path contains "single-file-deploy")' });
        continue;
      }
      let content: string;
      try {
        content = readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      const lines = content.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? '';
        if (line.includes('single-file-deploy')) {
          hits.push({ file: rel, line: i + 1, text: line.trim() });
        }
      }
    }
  }
  return hits;
}

describe('M5 #18 — no residual references to single-file-deploy (F8) in source', () => {
  it('scans src/, src-tauri/src/, src-tauri/capabilities/, src-tauri/tests/, tests/e2e/ for the literal "single-file-deploy"', () => {
    const hits = findRefs();
    if (hits.length > 0) {
      const msg = hits
        .map((h) => `  ${h.file}:${h.line}: ${h.text}`)
        .join('\n');
      throw new Error(
        `Found ${hits.length} residual "single-file-deploy" reference(s):\n${msg}\n` +
          'See M5 #18 — F8 was removed from the sidebar / page / plugin stub / capability grant. ' +
          'If you are intentionally re-introducing F8, update M5-ANALYSIS.md and the M5 #18 regression first.',
      );
    }
    expect(hits).toEqual([]);
  });

  it('the dedicated test files (m2-2-8, m2-2-9) and the F8 page are physically absent', () => {
    // Belt-and-suspenders: even if a future commit added a stale
    // reference inside a comment that the line scanner missed
    // (shouldn't happen — the line scanner is exhaustive), the
    // path existence checks below catch the file-level regression.
    const mustNotExist = [
      'src/pages/single-file-deploy/index.tsx',
      'src/plugins/stubs/single-file-deploy.tsx',
      'src-tauri/src/plugins/stubs/single_file_deploy.rs',
      'src/__tests__/pages/single-file-deploy.test.tsx',
      'tests/e2e/m2-2-8-real-invoke.spec.ts',
      'tests/e2e/m2-2-9-real-invoke.spec.ts',
    ];
    for (const rel of mustNotExist) {
      const full = anchor(rel);
      let exists = false;
      try {
        exists = statSync(full).isFile();
      } catch {
        exists = false;
      }
      expect(exists, `${rel} must be deleted (M5 #18)`).toBe(false);
    }
  });
});
