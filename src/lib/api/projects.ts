/**
 * Frontend wrapper for the M3.10 (清单 23) Tauri commands.
 *
 * The functions here are the single source of truth for "how the
 * frontend talks to the Rust project service". Pages must import
 * `listProjects` / `addProject` / `removeProject` / `switchProject` /
 * `currentProject` from here — they MUST NOT call `invoke('list_projects', ...)`
 * directly (so the IPC shape is refactorable in one place).
 *
 * ## Tauri IPC arg-name convention
 *
 * Tauri converts camelCase JS arg names to snake_case on the Rust
 * side. We keep snake_case keys here to match the Rust convention.
 */
import { invoke } from '@tauri-apps/api/core';
import type { Project, ProjectsListResult } from '../../types/project';

// v3.0 (M3.0.2 fix) — `invoke` is undefined in plain browser (vite dev on
// localhost:1420) AND in Tauri release builds where the backend command
// isn't yet registered. Calling `undefined('list_projects')` throws a
// synchronous TypeError that bypasses every try/catch and crashes the
// React tree, leaving the webview white and the Tauri window dying.
//
// We guard the call: outside Tauri, the API becomes a no-op that
// returns sane empty defaults so the UI renders the "no projects"
// empty state instead of crashing.
function isTauriRuntime(): boolean {
  return (
    typeof window !== 'undefined' &&
    '__TAURI_INTERNALS__' in window
  );
}

const NO_PROJECTS: ProjectsListResult = {
  projects: [],
  current_project_id: null,
  file: { version: 1, current_project_id: null, projects: [] },
};

/** M3.10 — list all projects + the active id. Auto-seeds system project. */
export async function listProjects(): Promise<ProjectsListResult> {
  if (!isTauriRuntime()) return NO_PROJECTS;
  return invoke<ProjectsListResult>('list_projects');
}

/** M3.10 — add a new user project. Validates root_dir has .claude/. */
export async function addProject(name: string, rootDir: string): Promise<Project> {
  if (!isTauriRuntime()) throw new Error('Tauri runtime not available (browser preview)');
  return invoke<Project>('add_project', { name, root_dir: rootDir });
}

/** M3.10 — remove a user project. Refuses system project. */
export async function removeProject(id: string): Promise<void> {
  if (!isTauriRuntime()) throw new Error('Tauri runtime not available (browser preview)');
  await invoke('remove_project', { id });
}

/** M3.10 — switch the active project. F13 backup + atomic update. */
export async function switchProject(id: string): Promise<Project> {
  if (!isTauriRuntime()) throw new Error('Tauri runtime not available (browser preview)');
  return invoke<Project>('switch_project', { id });
}

/** M3.10 — convenience: get the active project. */
export async function currentProject(): Promise<Project | null> {
  if (!isTauriRuntime()) return null;
  return invoke<Project | null>('current_project');
}

/**
 * M3.13.4 — native folder picker for the "新建项目" form.
 *
 * The Rust-side `pick_project_root_dir` wraps
 * `tauri-plugin-dialog::DialogExt::blocking_pick_folder`, so the
 * frontend never imports `@tauri-apps/plugin-dialog` directly
 * (CLAUDE.md §2.3 dep discipline — keeps the npm dep surface tight,
 * same pattern as `exportProvider` in `optimizer.ts`).
 *
 * Returns the absolute path string if the user picked a folder, or
 * `null` if they cancelled the dialog (which is a normal flow, not
 * an error).
 */
export async function pickProjectRoot(): Promise<string | null> {
  return invoke<string | null>('pick_project_root_dir');
}

/**
 * M3.13.4 — live validation result for the "新建项目" root path.
 *
 * `reason_code` is a stable snake_case identifier (e.g.
 * `"missing_claude_subdir"`) for analytics / future i18n; `reason`
 * is the user-facing Chinese message that the page renders as the
 * red hint line.
 *
 * When `valid === true`, both fields are empty strings — the page
 * renders a green check mark in that case.
 */
export interface PathValidation {
  path: string;
  valid: boolean;
  reason_code: string;
  reason: string;
}

/**
 * M3.13.4 — validate a candidate project root path without
 * committing it. The frontend's "新建项目" form runs this on input
 * blur and after a successful folder pick, so the user gets instant
 * feedback (green ✓ or red reason) and the submit button can lock
 * itself before `addProject` actually touches disk.
 */
export async function validateProjectPath(path: string): Promise<PathValidation> {
  return invoke<PathValidation>('validate_project_path', { path });
}