/**
 * Project — TypeScript mirror of `src-tauri/src/domain/project.rs`.
 *
 * Keep the field names snake_case to match the Rust serde representation
 * (`#[serde(rename_all = "snake_case")]`). The Rust backend deserialises
 * JSON straight into `Project`; the TS layer just reads the shape.
 *
 * M3.10 (清单 23) — 双模式 (用户/项目) architecture.
 */
export interface Project {
  id: string;          // UUID v4 — Uuid::nil() for system project
  name: string;        // display name (1..=64 chars)
  root_dir: string;    // absolute path; platform joins ".claude"
  created_at: number;  // unix seconds
  is_system: boolean;  // true = system project, cannot be removed
}

/**
 * Flat view of the active project for the welcome / sidebar switcher.
 * Mirrors `commands::project::ProjectSummary`.
 */
export interface ProjectSummary {
  id: string;
  name: string;
  root_dir: string;
  is_system: boolean;
}

/**
 * Response shape for `list_projects`. We keep the full file around so
 * the frontend can cache + compare without re-fetching.
 */
export interface ProjectsListResult {
  projects: ProjectSummary[];
  current_project_id: string | null;
  file: ProjectsFile;
}

export interface ProjectsFile {
  version: number;
  current_project_id: string | null;
  projects: Project[];
}

/**
 * UUID nil — the fixed id of the system project. M3.10 contract:
 * `current_project_id === SYSTEM_PROJECT_ID` is a stable signal
 * across machines / reinstalls.
 */
export const SYSTEM_PROJECT_ID = '00000000-0000-0000-0000-000000000000';