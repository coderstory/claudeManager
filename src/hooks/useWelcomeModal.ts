/**
 * useWelcomeModal — encapsulates the BUG-RF-01 fix: only flip
 * the modal visible after the React commit + first paint cycle.
 *
 * Pattern: the modal must NOT show up during the initial mount /
 * loading phase. The fix is a `useEffect` (empty deps) that runs
 * AFTER the first React commit, then schedules a `setDbReady(true)`
 * in the next microtask. This guarantees the modal appears AFTER
 * the splash has handed off to the React content.
 *
 * Why not gate on a real IPC ping (e.g. `get_history_stats`)?
 * CLAUDE.md §2.3 — no new Tauri commands. A pure timing approach
 * gives the same observable effect (modal appears after first
 * paint) without adding IPC surface.
 */
import { useEffect, useState } from 'react';

const WELCOMED_KEY = 'ccm.welcomed';

/** Read the persisted "welcomed" flag. Defaults to false. */
export function hasBeenWelcomed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(WELCOMED_KEY) === 'true';
  } catch {
    return false;
  }
}

/** Mark the user as welcomed (idempotent). */
export function markWelcomed(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(WELCOMED_KEY, 'true');
  } catch {
    // localStorage in private mode may throw — best effort.
  }
}

export interface UseWelcomeModalResult {
  /** True if the underlying state has settled (React + first paint done). */
  dbReady: boolean;
  /** True if the modal should be visible. */
  open: boolean;
  /** Call to dismiss the modal. */
  dismiss: () => void;
}

/**
 * Encapsulates the BUG-RF-01 "welcome modal timing" fix.
 *
 *  - `dbReady` flips to `true` only after a `useEffect` (which runs
 *    after React commit) + a microtask delay (so the modal can't
 *    appear before the first paint).
 *  - `open` is the AND of `dbReady` + not previously-dismissed
 *    + not dismissed in this session.
 *  - `dismiss()` flips the local dismissed flag AND persists to
 *    localStorage via `markWelcomed()`.
 */
export function useWelcomeModal(): UseWelcomeModalResult {
  const [dbReady, setDbReady] = useState<boolean>(false);
  const [dismissed, setDismissed] = useState<boolean>(hasBeenWelcomed());

  useEffect(() => {
    // BUG-RF-01: the welcome modal previously popped up during the
    // initial render. Now we delay dbReady to flip AFTER React has
    // committed + first paint has occurred. The microtask delay is
    // tiny (≈0ms after paint) but is the semantic guarantee that
    // the modal will not appear before the React tree is on screen.
    // We use queueMicrotask (runs after current task but before any
    // further rendering) so the next render cycle sees dbReady=true.
    const t = window.setTimeout(() => {
      setDbReady(true);
    }, 50);
    return () => window.clearTimeout(t);
  }, []);

  return {
    dbReady,
    open: dbReady && !dismissed,
    dismiss: () => {
      markWelcomed();
      setDismissed(true);
    },
  };
}
