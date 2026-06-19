/**
 * applyEffects — bootstrap the native window effects (M1.9.2).
 *
 * This module is the single source of truth for "what backdrop does
 * the app ask the OS for at startup". Currently:
 *
 *   Windows 11      → Effect.Mica
 *                      (the host's own desktop colour bleeds through
 *                      a translucent WebView2 surface)
 *   macOS 10.11+    → Effect.Sidebar
 *                      (the standard macOS sidebar vibrancy material)
 *   Anything else   → No-op (the CSS backdrop-filter fallback in
 *                      AppHeader / AppSidebar / PluginPlaceholder
 *                      already gives a Liquid-Glass look)
 *
 * Per CLAUDE.md §3.1 the OS branch lives here, NOT in the calling
 * code, and per §3.2 the business code never touches OS APIs
 * directly — it always goes through this module (the Tauri
 * @tauri-apps/api/window adapter is the only thing in src/ that
 * crosses the OS boundary, just like the Rust IPlatformWindowChrome
 * is the only thing in src-tauri/ that does).
 *
 * The call is fire-and-forget. Failures are logged but never
 * thrown to the React tree:
 *   - On Windows 10, Effect.Mica is a no-op; we don't want the
 *     app to fail to mount.
 *   - On Linux (theoretical; not in M1.9.2 spec) the effects API
 *     is unsupported at the OS level.
 *   - If the capability `core:window:allow-set-effects` is missing
 *     the call rejects; we want the user to see the app even
 *     without Mica, not a "this app is broken" modal.
 *
 * @see https://v2.tauri.app/reference/javascript/api/namespacewindow/
 *   setEffects signature: (effects: Effects): Promise<void>
 *   Effects: { effects: Effect[]; state?; radius?; color? }
 */
import { Effect, getCurrentWindow } from '@tauri-apps/api/window';

/**
 * detectPlatform — pick the effect family appropriate to the host.
 *
 * The `@tauri-apps/api` doesn't expose an OS-detection helper on
 * the window side, so we sniff the userAgent. This is the same
 * heuristic the cc-switch reference app uses (D:\project\cc-switch-
 * main\src\components\window-effects.tsx) and it intentionally
 * ignores Linux / unknown (both fall through to "no native effect,
 * CSS backdrop-filter only").
 */
function detectPlatform(): 'windows' | 'macos' | 'other' {
  if (typeof navigator === 'undefined') return 'other';
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('mac')) return 'macos';
  if (ua.includes('win')) return 'windows';
  return 'other';
}

/**
 * buildEffectsFor — turn a platform decision into the Effects object
 * the Tauri API expects.
 *
 * Per the Tauri v2 typings (`interface Effects` in
 * @tauri-apps/api/window), the call signature is a single object
 * with an `effects: Effect[]` array, NOT an array of objects.
 * Conflicting effects use the first one (documented behaviour),
 * so the per-platform branch always returns a single-element array.
 */
function buildEffectsFor(platform: 'windows' | 'macos' | 'other'):
  | { effects: Effect[] }
  | null {
  if (platform === 'windows') {
    return { effects: [Effect.Mica] };
  }
  if (platform === 'macos') {
    return { effects: [Effect.Sidebar] };
  }
  return null;
}

/**
 * applyWindowEffects — request the OS backdrop. Idempotent (safe
 * to call multiple times — the Tauri API treats re-applies as
 * "set to this").
 *
 * Returned promise resolves on success or rejects with the Tauri
 * error. Callers in main.tsx `await` it but the bootstrap is wrapped
 * in a try/catch in main.tsx so a rejection never breaks the mount.
 */
export async function applyWindowEffects(): Promise<void> {
  const platform = detectPlatform();
  const effects = buildEffectsFor(platform);
  if (effects === null) {
    // Unknown / Linux / server-side render — the CSS backdrop-filter
    // in AppHeader / AppSidebar / PluginPlaceholder is the fallback.
    return;
  }
  try {
    await getCurrentWindow().setEffects(effects);
  } catch (err) {
    // Logged at the boundary so a user reporting "Mica doesn't work"
    // can check the dev-tools console and find the underlying error
    // (typically a missing capability or a too-old Windows build).
    // CLAUDE.md §7: no silent error eating — we surface to the
    // developer console but never block app startup.
    console.error(
      '[applyEffects] setEffects failed (platform=' + platform + '):',
      err,
    );
  }
}
