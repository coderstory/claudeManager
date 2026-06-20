/**
 * useKeyboardShortcuts — TDD coverage.
 *
 * Why a dedicated hook instead of inline `addEventListener` in App.tsx:
 *   - Reusable across the modal family (QuickSearchModal, future
 *     command palette, etc.) without duplicating the modifier-match
 *     boilerplate.
 *   - Testable in isolation: jsdom + renderHook lets us dispatch
 *     synthetic KeyboardEvents against `window` and assert that the
 *     correct handler fires (and the wrong one doesn't).
 *   - One explicit `useEffect` cleanup so consumer unmount always
 *     removes the listener — the existing AppHeader + AppSidebar
 *     `useEffect`s follow the same pattern.
 *
 * Contract (M2.10 — F11 global shortcuts):
 *   - `useKeyboardShortcuts(bindings)` registers ONE window-level
 *     keydown listener.
 *   - Each binding matches a single keyboard combination:
 *       `key`            — the KeyboardEvent.key value (case-insensitive)
 *       `ctrlOrMeta`     — optional; matches Ctrl on Windows/Linux,
 *                          Cmd on macOS (we don't differentiate in M2)
 *       `shift`          — optional; requires Shift held
 *       `preventDefault`— optional; calls e.preventDefault() when matched
 *   - When a binding matches, its handler runs. Multiple bindings
 *     with the same key MAY match (e.g. Ctrl+1 fires a different
 *     handler than Ctrl+2) — the loop just keeps going.
 *   - Listener is added on mount, removed on unmount (cleanup).
 *   - Listener is replaced (not duplicated) when `bindings` changes.
 *
 * Excluded targets (M2.10 — §6 failure-handling note):
 *   - Typing inside <input> / <textarea> / contentEditable elements
 *     must NOT trigger bindings. A user searching in QuickSearch
 *     should still be able to press Ctrl+/ without immediately
 *     re-opening the modal. The hook skips events whose target is
 *     a text-entry element.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts';

/**
 * Dispatch a synthetic KeyboardEvent on window so the hook's listener
 * picks it up. jsdom supports the full KeyboardEvent constructor
 * (key + ctrlKey + shiftKey + metaKey).
 */
function pressKey(opts: {
  key: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  target?: EventTarget | null;
}): KeyboardEvent {
  const ev = new KeyboardEvent('keydown', {
    key: opts.key,
    ctrlKey: opts.ctrl ?? false,
    metaKey: opts.meta ?? false,
    shiftKey: opts.shift ?? false,
    bubbles: true,
    cancelable: true,
  });
  // Override target if the caller wants to simulate typing in an input.
  if (opts.target) {
    Object.defineProperty(ev, 'target', { value: opts.target });
  }
  window.dispatchEvent(ev);
  return ev;
}

beforeEach(() => {
  // No leftover listeners between cases — renderHook will spin up
  // its own component each test.
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useKeyboardShortcuts', () => {
  it('binding_matches_simple_key', () => {
    // Escape with no modifiers → handler fires.
    const handler = vi.fn();
    renderHook(() =>
      useKeyboardShortcuts([{ key: 'Escape', handler }]),
    );
    act(() => {
      pressKey({ key: 'Escape' });
    });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('binding_with_ctrl_matches_correct_event', () => {
    // Ctrl+K (a common "command palette" shortcut — using K here as
    // the fixture because Ctrl+/ is exercised below).
    const handler = vi.fn();
    renderHook(() =>
      useKeyboardShortcuts([{ key: 'k', ctrlOrMeta: true, handler }]),
    );
    act(() => {
      // Ctrl held → fires.
      pressKey({ key: 'k', ctrl: true });
    });
    expect(handler).toHaveBeenCalledTimes(1);
    act(() => {
      // Bare K with no modifier → does NOT fire.
      pressKey({ key: 'k' });
    });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('binding_with_shift_does_not_fire_without_shift', () => {
    // Shift+? is a distinct binding from ? — make sure we don't
    // accidentally collapse them.
    const handler = vi.fn();
    renderHook(() =>
      useKeyboardShortcuts([{ key: '?', shift: true, handler }]),
    );
    act(() => {
      pressKey({ key: '?' }); // no shift
    });
    expect(handler).not.toHaveBeenCalled();
    act(() => {
      pressKey({ key: '?', shift: true });
    });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('multiple_bindings_register_independently', () => {
    // Ctrl+1 and Ctrl+2 are different handlers.
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    renderHook(() =>
      useKeyboardShortcuts([
        { key: '1', ctrlOrMeta: true, handler: handler1 },
        { key: '2', ctrlOrMeta: true, handler: handler2 },
      ]),
    );
    act(() => {
      pressKey({ key: '1', ctrl: true });
    });
    expect(handler1).toHaveBeenCalledTimes(1);
    expect(handler2).not.toHaveBeenCalled();
    act(() => {
      pressKey({ key: '2', ctrl: true });
    });
    expect(handler1).toHaveBeenCalledTimes(1);
    expect(handler2).toHaveBeenCalledTimes(1);
  });

  it('cleanup_on_unmount_removes_listener', () => {
    const handler = vi.fn();
    const { unmount } = renderHook(() =>
      useKeyboardShortcuts([{ key: 'Escape', handler }]),
    );
    act(() => {
      pressKey({ key: 'Escape' });
    });
    expect(handler).toHaveBeenCalledTimes(1);
    unmount();
    act(() => {
      pressKey({ key: 'Escape' });
    });
    // After unmount, the listener is gone — no extra calls.
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('preventDefault_calls_event_preventDefault_when_matched', () => {
    const handler = vi.fn();
    renderHook(() =>
      useKeyboardShortcuts([
        { key: '/', ctrlOrMeta: true, preventDefault: true, handler },
      ]),
    );
    let ev: KeyboardEvent | null = null;
    act(() => {
      ev = pressKey({ key: '/', ctrl: true });
    });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(ev!.defaultPrevented).toBe(true);
  });

  it('input_target_skips_binding_to_let_user_type', () => {
    // M2.10 §6 failure-handling: a Ctrl+/ pressed inside the
    // QuickSearch input must NOT re-open the modal.
    const handler = vi.fn();
    renderHook(() =>
      useKeyboardShortcuts([
        { key: '/', ctrlOrMeta: true, handler, preventDefault: true },
      ]),
    );
    const input = document.createElement('input');
    document.body.appendChild(input);
    try {
      act(() => {
        pressKey({ key: '/', ctrl: true, target: input });
      });
      expect(handler).not.toHaveBeenCalled();
    } finally {
      document.body.removeChild(input);
    }
  });
});