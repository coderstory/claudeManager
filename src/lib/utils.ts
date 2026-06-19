import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge class names with Tailwind conflict resolution.
 *
 * - `clsx` handles truthy / array / object inputs.
 * - `twMerge` collapses conflicting Tailwind utilities so the later one
 *   wins (`cn('px-2', 'px-4')` → `'px-4'`).
 *
 * Reference: D:\project\cc-switch-main\src\lib\utils.ts.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}