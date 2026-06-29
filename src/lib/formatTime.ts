/**
 * Centralized time formatting with UTC+8 fixed timezone.
 *
 * Why fixed UTC+8: build-time metadata, daily usage, and backups are all
 * stored as Unix seconds (no TZ). Displaying them in the user's local TZ
 * makes the same event show different times on different machines, which
 * breaks "when did I last deploy" muscle memory. UTC+8 (Asia/Shanghai) is
 * the dev team's home TZ and matches the build-time label.
 *
 * All callers MUST go through these helpers — do not call `toLocaleString`
 * directly elsewhere.
 *
 * Note: `toLocaleString` without `timeZone` option uses the browser's
 * local TZ, which is per-user variable. We pass `timeZone: TIME_ZONE`
 * explicitly on every call to force UTC+8 regardless of where the app
 * is running.
 */

const TIME_ZONE = 'Asia/Shanghai';
const LOCALE = 'zh-CN';

export function formatDateTime(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString(LOCALE, {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export function formatDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleDateString(LOCALE, {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

export function formatTime(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleTimeString(LOCALE, {
    timeZone: TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

// Accepts Date object (already constructed by caller, e.g. JS Date.now()).
export function formatDateTimeFromDate(d: Date): string {
  return d.toLocaleString(LOCALE, {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export function formatTimeFromDate(d: Date): string {
  return d.toLocaleTimeString(LOCALE, {
    timeZone: TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}
