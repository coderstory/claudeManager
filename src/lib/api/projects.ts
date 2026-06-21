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

/** M3.10 — list all projects + the active id. Auto-seeds system project. */
export async function listProjects(): Promise<ProjectsListResult> {
  return invoke<ProjectsListResult>('list_projects');
}

/** M3.10 — add a new user project. Validates root_dir has .claude/. */
export async function addProject(name: string, rootDir: string): Promise<Project> {
  return invoke<Project>('add_project', { name, root_dir: rootDir });
}

/** M3.10 — remove a user project. Refuses system project. */
export async function removeProject(id: string): Promise<void> {
  await invoke('remove_project', { id });
}

/** M3.10 — switch the active project. F13 backup + atomic update. */
export async function switchProject(id: string): Promise<Project> {
  return invoke<Project>('switch_project', { id });
}

/** M3.10 — convenience: get the active project. */
export async function currentProject(): Promise<Project | null> {
  return invoke<Project | null>('current_project');
}