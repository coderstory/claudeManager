# AGENTS.md — Subagent Entry Point

> **Purpose**: 60-second onboarding for a fresh subagent. Tell it
> what this project is, what files it MUST read, and the rules it
> MUST obey that differ from the main session's. **Read CLAUDE.md
> for the full rulebook first**; this file is a focused supplement.

---

## What this project is

**Claude Config Manager** — cross-platform (Windows 11 + macOS 26)
desktop tool for managing Claude Code provider configs. Tauri v2 +
React 19 + TypeScript 5 + Rust + Tailwind/shadcn. Helps users
switch between Claude API providers, manage settings safely, and
monitor usage.

See `CLAUDE.md` §1 (project background) for the canonical
description and `STATE.md` for the current milestone state.

---

## MUST-read files (in order)

1. `CLAUDE.md` — project rules. Especially §2 (engineering
   discipline), §3 (architecture), §6 (review), §10 (don't-do).
2. `CLAUDE-WORKFLOW.md` — main session workflow / GSD
   orchestration rules.
3. `SPEC.md` — product spec (immutable; do NOT modify).
4. `STATE.md` — recent decisions / known issues / ship records.
5. `.planning/HANDOFF.json` — task progress.

---

## MUST-not-touch files

- `SPEC.md`
- `.planning/research/`
- `scripts/build-and-ship.sh` (after it's shipped)
- Locked dep versions in `Cargo.toml` / `package.json` (per
  CLAUDE.md §2.3 — no version bumps without PR description)

---

## Subagent role in this project (2026-06-25 update)

**Code changes**: the **main session edits code directly** on the
current branch. Subagents should NOT be dispatched for
code-writing tasks.

**Subagents are appropriate for**:
- Read-only investigation (codebase search, doc fetch, version
  lookup)
- Running read-only scripts (test suites, lint, type-check) that
  may take minutes and would block the main session
- Parallel research where the outputs are independent

**Subagents are NOT appropriate for**:
- Writing or modifying source files
- Running scripts that mutate state (git push, install deps,
  release builds that write to `target/`)
- Anything where a `worktree` isolation flag would normally be
  requested — worktree workflow is **discontinued** as of
  2026-06-25 after data-loss incidents.

If you are a subagent dispatched by the main session, default to
read-only tools (Read / Grep / Glob / Bash for safe commands).
Do NOT use Edit / Write / NotebookEdit unless your prompt
explicitly authorizes it.

---

## Subagent-specific hard rules

### Network access (CLAUDE.md §8)

If your task requires web access, ask the main session to fetch
the URL. The main session uses `WebFetch` / `WebSearch` directly;
subagents running on macOS dev boxes do not have access to the
Windows-only `cs-web-fetch` script path
(`/c/Users/e-Yunfei.Qian/.claude/plugins-dev/...`).

### TDD is mandatory (CLAUDE.md §5.2)

When you are authorized to write code:
1. Write failing test (Red)
2. Write minimal impl to pass (Green)
3. Refactor (Refactor)

Every M1.9.x / M2.x commit followed `<id>-test` → `<id>-fix` →
`<id>-refine` pattern.

### Review discipline (CLAUDE.md §6)

Every non-trivial change goes through 4 stages:
self-review → brainstorm → peer review → business-flow analysis.
Fix all CRITICAL/HIGH; MEDIUM/LOW → STATE.md.

### Build / smoke / ship (CLAUDE.md §9 / §12)

```bash
# Quick check (no ship)
./scripts/build.sh --check               # cross-platform cargo check

# Full unified gate (5 stages: ui-check / frontend / rust / e2e / smoke)
./scripts/test-all.sh

# Skip sub-stages for fast iteration
./scripts/test-all.sh --skip-e2e --skip-smoke

# Build + smoke + cp to desktop (requires milestone flags)
./scripts/build.sh --ship --milestone M3 --task 3.4 --slug kebab-case
```

**Don't** `git push` without explicit user OK.

---

## Don't do (CLAUDE.md §10)

- Don't modify `SPEC.md`
- Don't sprinkle OS checks in business code (use `platform/` traits)
- Don't "边写边想" — design first
- Don't write code first, add tests later — TDD is mandatory
- Don't swap deps because they don't work — read docs first
- Don't modify `.planning/research/`
- Don't go >1 hour without commit (M1 atomic; M2 best-effort)
- Don't delete files without confirmation (especially `.planning/`
  and `src/`)
- Don't skip smoke test before cp exe to desktop
- Don't enter next iteration without user 核定

---

## When in doubt

**Stop.** Re-read CLAUDE.md. If still unclear, report to the
parent agent with: (1) what you were trying to do, (2) what you
read, (3) what the conflict is. Do not improvise.

---

*Read CLAUDE.md + CLAUDE-WORKFLOW.md for the rest. This file is
the entry point only.*