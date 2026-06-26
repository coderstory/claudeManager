/**
 * Vitest coverage for the F5 file I/O TS wrapper (M2.4).
 *
 * Phase 27 Fix 3 — JSON editor path::field virtual path protocol.
 *
 * What these tests pin:
 *   1. `readFile(path, field?)` passes both `path` and `field`
 *      through to the Rust `read_file` command via Tauri IPC.
 *   2. `readFile(path)` (no field) still works — `field` is omitted
 *      from the IPC args (not sent as `undefined`, which would
 *      serialize to `null` and break the Rust `Option<String>` deser).
 *   3. Optimizer's `handleOpenInEditor` splits the `path::field`
 *      virtual path into two sessionStorage keys.
 *   4. JSON editor mount effect reads both keys and forwards them
 *      to `readFile`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @tauri-apps/api/core's invoke. We must hoist the mock so the
// import below picks it up.
const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

// Import AFTER the mock is set up (vi.mock is hoisted, but being
// explicit about the import order makes the dependency obvious).
import { readFile } from '../../../lib/api/fs';

beforeEach(() => {
  mockInvoke.mockReset();
});

describe('readFile — path::field virtual protocol (Phase 27 Fix 3)', () => {
  it('passes field through IPC args when provided', async () => {
    mockInvoke.mockResolvedValue('{"api_key":"sk-123"}');
    const result = await readFile('providers/foo.json', 'api_key');

    expect(mockInvoke).toHaveBeenCalledWith('read_file', {
      path: 'providers/foo.json',
      field: 'api_key',
    });
    expect(result).toBe('{"api_key":"sk-123"}');
  });

  it('omits field from IPC args when not provided (backward compat)', async () => {
    mockInvoke.mockResolvedValue('{"hello":"world"}');
    const result = await readFile('settings.json');

    expect(mockInvoke).toHaveBeenCalledWith('read_file', {
      path: 'settings.json',
    });
    // Must NOT have a `field: undefined` key — Rust deser expects
    // Option<String>, and JSON `undefined` → serde::de::Error.
    const callArgs = mockInvoke.mock.calls[0][1] as Record<string, unknown>;
    expect(callArgs).not.toHaveProperty('field');
    expect(result).toBe('{"hello":"world"}');
  });
});
