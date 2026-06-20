/**
 * useKeyboardShortcuts — window-level keyboard shortcut dispatcher
 * (M2.10 — F11 全局快捷键).
 *
 * Design rationale:
 *
 *   1. We do NOT use `tauri-plugin-global-shortcut` for F11. The
 *      plugin registers shortcuts at the OS level (e.g. "Ctrl+/
 *      fires even when the app is in the background"). For our
 *      M2 scope F11 is "in-app shortcuts" — they only matter when
 *      the Claude Config Manager window has focus, exactly like
 *      GitHub's Ctrl+K palette or VS Code's Ctrl+Shift+P. A plain
 *      `window.addEventListener('keydown', ...)` is therefore the
 *      correct primitive, and it stays inside the webview layer
 *      so we don't bump the Cargo.toml / package.json dependency
 *      tree (CLAUDE.md §2.3 — version lock).
 *
 *   2. The hook attaches ONE listener that walks the binding list
 *      on every keydown. Multiple bindings can match the same event
 *      (the loop doesn't break on first match), so consumers can
 *      register orthogonal shortcuts without worrying about order.
 *
 *   3. Text-entry elements (<input>, <textarea>, contentEditable)
 *      are exempt. A user typing in the QuickSearch box must still
 *      be able to press Ctrl+/ — otherwise the binding re-opens the
 *      modal on every keystroke and you can never close it. This is
 *      the M2.10 §6 failure-handling note made into code.
 *
 *   4. The listener is registered on mount and removed on unmount
 *      via the standard `useEffect` cleanup contract — so React
 *      strict-mode double-mount doesn't leak a dangling listener.
 */
import { useEffect } from 'react';

export interface ShortcutBinding {
  /**
   * The KeyboardEvent.key value to match, e.g. 'Escape', '/', '1'.
   * Compared case-insensitively — KeyboardEvent.key is lowercase
   * for letter keys in jsdom and most browsers, but the DOM spec
   * allows uppercase for non-character keys ('Escape', 'Tab').
   */
  key: string;
  /**
   * When true, the binding only matches if either Ctrl (Windows /
   * Linux) or Cmd (macOS) is held. We don't differentiate the two
   * in M2 — the shortcut "Ctrl+/" should fire whether the user
   * presses Ctrl+/ or Cmd+/.
   */
  ctrlOrMeta?: boolean;
  /** When true, the binding requires Shift to be held. */
  shift?: boolean;
  /** When true, the binding calls e.preventDefault() on a match. */
  preventDefault?: boolean;
  /**
   * The action to run when the binding matches. Receives the
   * underlying KeyboardEvent so callers can read modifiers /
   * target if they need finer control than the binding shape.
   */
  handler: (e: KeyboardEvent) => void;
}

const TEXT_INPUT_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (TEXT_INPUT_TAGS.has(target.tagName)) return true;
  // contentEditable surfaces look like regular <div>s but accept
  // keystrokes. Check the attribute as a final guard.
  if (target.isContentEditable) return true;
  return false;
}

function matches(binding: ShortcutBinding, e: KeyboardEvent): boolean {
  // Case-insensitive compare — covers both 'k' (lowercase, the
  // jsdom default) and 'K' (what some browsers report if Shift is
  // held for a character key).
  if (binding.key.toLowerCase() !== e.key.toLowerCase()) return false;
  if (binding.ctrlOrMeta && !(e.ctrlKey || e.metaKey)) return false;
  if (binding.shift !== undefined && binding.shift !== e.shiftKey) return false;
  return true;
}

/**
 * Register `bindings` against the window keydown stream.
 *
 * @example
 *   useKeyboardShortcuts([
 *     { key: '/', ctrlOrMeta: true, preventDefault: true, handler: openSearch },
 *     { key: 'Escape', handler: closeModals },
 *   ]);
 */
export function useKeyboardShortcuts(bindings: ShortcutBinding[]): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      // Don't hijack typing — see isTextEntryTarget comment.
      if (isTextEntryTarget(e.target)) return;

      for (const b of bindings) {
        if (!matches(b, e)) continue;
        if (b.preventDefault) e.preventDefault();
        b.handler(e);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [bindings]);
}