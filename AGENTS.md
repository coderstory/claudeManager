# AGENTS.md — Subagent Entry Point

> **Purpose**: Tell a fresh subagent, in <30 seconds, what this
> project is, what files it MUST read, and what rules it MUST obey
> before doing any work. **Read CLAUDE.md for the full rulebook.**
> Read this file first as a "table of contents".

---

## What this project is

**Claude Config Manager** — cross-platform (Windows 11 + macOS 26)
desktop tool for managing Claude Code provider configs.
Tauri v2 + React 19 + TypeScript 5 + Rust + framer-motion.

## State

M1 架构期 paused at M1.9.2. M1.10 (build/CI matrix) and M1.11
(framework invariants, this commit) and M1.12 (final audit) are the
remaining M1 tasks. M2+ adds real features (Provider 列表, MCP
管理, etc.).

## MUST-read files (in order)

1. `CLAUDE.md` — project rules. Read every line. Especially §2
   (engineering discipline), §3 (architecture), §6 (review
   process), §10 (don't-do).
2. `docs/ARCHITECTURE.md` — framework invariants. Read every line.
3. `SPEC.md` — product spec (immutable).
4. `.planning/HANDOFF.json` — task progress.
5. `.planning/STATE.md` — recent decisions / known issues.
6. `.planning/research/` (READ-ONLY) — M1-pre decisions.

## MUST-not-touch files

- `SPEC.md`
- `.planning/research/`
- `scripts/build-and-ship.sh` (after it's shipped)
- Any locked dep version in `Cargo.toml` / `package.json` (per
  CLAUDE.md §2.3 — no version bumps without PR description)

## Key invariants

- **Platform traits are locked** — all OS-specific code goes
  through `src-tauri/src/platform/traits.rs` + `windows/` or
  `macos/` impls. No `#[cfg(target_os)]` outside `platform/`.
- **Plugin system is locked** — 12 stubs in
  `src-tauri/src/plugins/stubs/`, mirrored in `src/plugins/`.
- **Design tokens are in `tokens.css`** — no hard-coded colors,
  spacing, radius, or font sizes.
- **TDD is mandatory** — tests first, then impl, then refactor.
- **All commits atomic** — one commit per task, descriptive
  message (`M1.X-slug: …`).

## Subagent-specific rules

- You are a subagent. Do not spawn sub-sub-agents (YOLO mode).
- For network access, use
  `node /c/Users/e-Yunfei.Qian/.claude/plugins-dev/cs-knowledge-base/skills/cs-web-fetch/scripts/fetch.js <url>`.
  **Never** use WebFetch / WebSearch / curl.
- Do not run `tauri build` (use `scripts/build-and-ship.sh`).
- Do not `git push` without explicit user OK.
- Stop and report if you hit a CRITICAL or HIGH finding outside
  your task scope.

## Build / smoke / ship commands

```bash
# Quick check (no ship)
./scripts/build-only.sh             # cargo build --release

# Smoke test an existing exe
./scripts/smoke-test.sh path/to/exe

# One-shot ship
./scripts/build-and-ship.sh --milestone M1 --task 1.X --slug kebab-case

# Run tests
npm test                            # Vitest
cargo test --manifest-path src-tauri/Cargo.toml  # Rust
npx playwright test                 # e2e (requires tauri-driver running)
```

## When in doubt

Stop. Re-read CLAUDE.md. If still unclear, report to the parent
agent with what you were trying to do, what you read, and what
the conflict is. Do not improvise.

---

*30 lines. Read CLAUDE.md + ARCHITECTURE.md for the rest.*