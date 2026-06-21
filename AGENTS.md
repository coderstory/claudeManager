# AGENTS.md — Subagent Entry Point

> **Purpose**: Tell a fresh subagent, in <60 seconds, what this
> project is, what files it MUST read, what rules it MUST obey,
> and how the main session dispatches work. **Read CLAUDE.md for
> the full rulebook.** Read this file first as a "table of contents".

---

## What this project is

**Claude Config Manager** — cross-platform (Windows 11 + macOS 26)
desktop tool for managing Claude Code provider configs. Tauri v2 +
React 19 + TypeScript 5 + Rust + Tailwind/shadcn. Helps users
switch between Claude API providers, manage settings safely, and
monitor usage.

**Current state** (2026-06-21): M1 架构期 done. M2 业务实现期
**done through M2.16** (commit `d820b82`). M2.17 启动中 — first
parallel subagent batch (4 slots).

---

## MUST-read files (in order)

1. `CLAUDE.md` — project rules. **Read every line.** Especially
   §2 (engineering discipline), §3 (architecture), §6 (review
   process), §9 (iteration ship), §10 (don't-do), §11 (subagent
   dispatch).
2. `docs/ARCHITECTURE.md` — framework invariants. Read every
   line. M1 layer boundaries + M2 plugin status.
3. `SPEC.md` — product spec (immutable; 1434 lines).
4. `README.md` — project entry point (新人入门).
5. `docs/milestones/STATE.md` — recent decisions / known issues /
   ship records.
6. `docs/milestones/M1-REVIEWS.md` + `M2-REVIEWS.md` — 4-stage
   review archive per milestone.
7. `.planning/HANDOFF.json` — task progress.
8. `.planning/research/` (READ-ONLY) — M1-pre decisions.

---

## MUST-not-touch files

- `SPEC.md`
- `.planning/research/`
- `scripts/build-and-ship.sh` (after it's shipped)
- Locked dep versions in `Cargo.toml` / `package.json` (per
  CLAUDE.md §2.3 — no version bumps without PR description)
- `docs/ARCHITECTURE.md` §1-3 (locked M1 layers; deviation
  requires STATE.md exception)

---

## Main session dispatch discipline (CLAUDE.md §11)

### Main session role

Main session **only**: clarifies questions + assigns tasks +
receives results + makes key decisions. Does NOT execute dev work.

### 4-slot concurrency limit (§11.2)

**Maximum 4 subagents running simultaneously.** Wait for one to
finish before dispatching the 5th.

### Streaming dispatch (§11.3)

Don't wait for all subagents to finish before reassigning. Each
completion notification → evaluate → dispatch next. Maximize
4-slot utilization.

### Pre-dispatch checklist (§11.4)

Before dispatching a subagent:

- [ ] Task boundary is clear (not vague "do this feature")
- [ ] Subagent type matches (general-purpose / Explore / gsd-*)
- [ ] Context is in the prompt (not in main session's head)
- [ ] Doesn't violate any CLAUDE.md rule

### Post-dispatch behavior (§11.5)

After dispatching:

- Main session **does NOT execute any shell / file ops**
- Wait for subagent (silence is normal; minutes OK)
- On completion: analyze + decide next immediately

### Decision thresholds (§11.6)

| Must ask user | Can decide autonomously |
|---|---|
| Tech stack choice | Single file naming |
| Major architecture split | Single function signature |
| Whether to enter next iteration | Local refactor |
| SPEC conflict resolution | Single command |
| Large-scale rework | Unit test details |

---

## Subagent-specific hard rules

### Network access

**MUST use**: `node /c/Users/e-Yunfei.Qian/.claude/plugins-dev/cs-knowledge-base/skills/cs-web-fetch/scripts/fetch.js <url>`

**Forbidden**: built-in `WebFetch` / `WebSearch` / `curl` /
`wget`. Main session also uses cs-web-fetch.

### TDD is mandatory (CLAUDE.md §5.2)

1. Write failing test (Red)
2. Write minimal impl to pass (Green)
3. Refactor (Refactor)

Every M1.9.x / M2.x commit followed `<id>-test` → `<id>-fix` →
`<id>-refine` pattern. This is the project's TDD rhythm.

### Review discipline (CLAUDE.md §6)

Every non-trivial change goes through 4 stages:

1. **Self-review** — bug / boundary / concurrency / platform /
   doc consistency (per file per line)
2. **Brainstorm** — reverse-challenge every design decision
3. **Peer review** — external AI CLI (gsd-review opencode
   milestone; if unavailable, self-simulated hostile review)
4. **Business flow analysis** — step-by-step end-to-end lifecycle

Fix all CRITICAL/HIGH; MEDIUM/LOW → STATE.md.

### Build / smoke / ship (CLAUDE.md §9)

**Don't** run `tauri build` directly. Use:

```bash
# Quick check (no ship)
./scripts/build-only.sh

# Smoke test an existing exe
./scripts/smoke-test.sh path/to/exe

# One-shot ship (build + smoke + cp to desktop)
./scripts/build-and-ship.sh --milestone M2 --task 2.X --slug kebab-case
```

**Don't** `git push` without explicit user OK.

### Iteration delivery (CLAUDE.md §9.4-9.5)

After ship:

1. ✅ Launch exe → process within 5s
2. ✅ Main window detected (PowerShell `Get-Process` + title check)
3. ✅ Tray icon detected (enum NotifyIcon)
4. ✅ `taskkill /F /IM ClaudeConfigManager.exe` → 2s cleanup

If any fail → **don't cp to desktop**. Then **wait for user
"完成" or "未完成：<原因>"** before next iteration.

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
- **Main session must NOT execute dev work** — always dispatch

---

## Build / test commands (reference)

```bash
# Frontend unit / integration
npm test                                # Vitest (130+ cases)

# Backend unit
cargo test --manifest-path src-tauri/Cargo.toml

# E2E (requires tauri-driver running)
npx playwright test

# Lint / type-check
npm run lint
npx tsc --noEmit

# Build (manual — prefer build-and-ship.sh)
./scripts/build-only.sh                 # release build
./scripts/kill-app.sh                   # clean stale processes
```

---

## When in doubt

**Stop.** Re-read CLAUDE.md. If still unclear, report to the parent
agent with: (1) what you were trying to do, (2) what you read,
(3) what the conflict is. Do not improvise.

---

*Read CLAUDE.md + docs/ARCHITECTURE.md for the rest. This file is
the entry point only.*