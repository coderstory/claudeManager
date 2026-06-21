/**
 * useProjects — M3.10 (清单 23) project state hook.
 *
 * Mirrors the cc-switch `useState` + localStorage pattern from
 * `useViewState` — single source of truth for the project list,
 * persisted server-side via `projects.json`. We don't cache on
 * the frontend (no Zustand store exists yet — the project count
 * is tiny, usually ≤ 5, so a refetch on each page mount is fine).
 *
 * Contract:
 * - `projects` is the full list (system + user projects).
 * - `currentProjectId` is the active id (system project when None).
 * - `loading` is `true` during the initial fetch.
 * - `error` holds the last error message (string) if any fetch / mutation failed.
 * - `reload()` re-fetches.
 * - `add(name, root)` calls the backend + reloads.
 * - `remove(id)` calls the backend + reloads.
 * - `switch(id)` calls the backend + reloads.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  addProject as apiAddProject,
  currentProject as apiCurrentProject,
  listProjects,
  removeProject as apiRemoveProject,
  switchProject as apiSwitchProject,
} from '../lib/api/projects';
import type { Project, ProjectSummary } from '../types/project';

export interface UseProjectsResult {
  projects: ProjectSummary[];
  currentProjectId: string | null;
  currentProject: ProjectSummary | null;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  add: (name: string, rootDir: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  switchTo: (id: string) => Promise<void>;
}

export function useProjects(): UseProjectsResult {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setError(null);
    try {
      const result = await listProjects();
      setProjects(result.projects);
      setCurrentProjectId(result.current_project_id);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      // Keep prior state on error so the UI doesn't flash.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const add = useCallback(
    async (name: string, rootDir: string) => {
      setError(null);
      try {
        await apiAddProject(name, rootDir);
        await reload();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        throw e;
      }
    },
    [reload],
  );

  const remove = useCallback(
    async (id: string) => {
      setError(null);
      try {
        await apiRemoveProject(id);
        await reload();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        throw e;
      }
    },
    [reload],
  );

  const switchTo = useCallback(
    async (id: string) => {
      setError(null);
      try {
        await apiSwitchProject(id);
        await reload();
        // Note: cross-page refresh is handled by the Rust-side
        // emit("project-switched") event. Pages can listen with
        // `listen()` from @tauri-apps/api/event if they need to
        // refetch on switch without polling.
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        throw e;
      }
    },
    [reload],
  );

  const currentProject =
    projects.find((p) => p.id === currentProjectId) ?? null;

  return {
    projects,
    currentProjectId,
    currentProject,
    loading,
    error,
    reload,
    add,
    remove,
    switchTo,
  };
}

/**
 * Helper — project metadata is currently fetched on-demand. We
 * re-export the API directly for callers that need to bypass
 * the hook (e.g. tests, the sidebar's quick-display).
 */
export { apiCurrentProject };
export type { Project };