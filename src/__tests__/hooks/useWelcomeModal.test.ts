/**
 * useWelcomeModal — BUG-RF-01 fix coverage.
 *
 * Verifies that:
 *  1. `dbReady` starts as `false` on mount (modal never appears during
 *     the initial render / loading phase).
 *  2. `dbReady` flips to `true` only inside a useEffect (so the modal
 *     can't pop up before React has committed + painted).
 *  3. Once dismissed via `dismiss()`, `open` returns to `false`.
 *  4. `hasBeenWelcomed()` reflects localStorage state.
 *  5. `markWelcomed()` persists `true` to localStorage.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  hasBeenWelcomed,
  markWelcomed,
  useWelcomeModal,
} from '../../hooks/useWelcomeModal';

beforeEach(() => {
  // Match the existing test convention (useViewState.test.ts) —
  // direct localStorage (no `window.` prefix) so jsdom's per-file
  // localStorage state is wiped between cases.
  localStorage.clear();
});

describe('useWelcomeModal (BUG-RF-01 — welcome modal timing)', () => {
  it('dbReady starts as false on first render', () => {
    const { result } = renderHook(() => useWelcomeModal());
    // BUG-RF-01: the modal must NEVER be visible during the initial
    // mount. dbReady is the gate — it must be false right after the
    // first render.
    expect(result.current.dbReady).toBe(false);
    expect(result.current.open).toBe(false);
  });

  it('dbReady flips to true after a useEffect cycle (post-paint)', async () => {
    const { result } = renderHook(() => useWelcomeModal());
    // The hook uses setTimeout(50) inside a useEffect. We need to
    // wait for the effect to fire + the timer to elapse.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    expect(result.current.dbReady).toBe(true);
  });

  it('open is true after dbReady=true when not previously welcomed', async () => {
    const { result } = renderHook(() => useWelcomeModal());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    expect(result.current.dbReady).toBe(true);
    expect(result.current.open).toBe(true);
  });

  it('open stays false when hasBeenWelcomed() returns true', async () => {
    // Pre-mark as welcomed before mounting.
    markWelcomed();
    expect(hasBeenWelcomed()).toBe(true);

    const { result } = renderHook(() => useWelcomeModal());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    expect(result.current.dbReady).toBe(true);
    // The dismissed state is read at hook init time from localStorage,
    // so a previously-welcomed user never sees the modal again.
    expect(result.current.open).toBe(false);
  });

  it('dismiss() hides the modal and persists to localStorage', async () => {
    const { result } = renderHook(() => useWelcomeModal());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    expect(result.current.open).toBe(true);

    act(() => {
      result.current.dismiss();
    });
    expect(result.current.open).toBe(false);
    expect(hasBeenWelcomed()).toBe(true);
  });

  it('hasBeenWelcomed() returns false initially and true after markWelcomed()', () => {
    expect(hasBeenWelcomed()).toBe(false);
    markWelcomed();
    expect(hasBeenWelcomed()).toBe(true);
  });
});