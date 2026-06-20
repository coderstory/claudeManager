/**
 * Vitest coverage for the F5 JSON editor utilities (M2.4).
 *
 * The functions under test (`maskTokens` / `validateJson` /
 * `formatJson`) are pure — no DOM, no Tauri IPC. The split
 * exists so the page component can stay focused on event
 * wiring + state, while the hard-to-test token-leak-prevention
 * logic lives in 6 small unit tests.
 *
 * TDD sequence (CLAUDE.md §5.2): these 6 cases were written
 * BEFORE the impl in `src/lib/json-editor.ts`. Reordering
 * would be a §2.2 / §5.2 violation.
 */
import { describe, it, expect } from 'vitest';
import {
  maskTokens,
  validateJson,
  formatJson,
  DEFAULT_TOKEN_FIELDS,
} from '../../lib/json-editor';

describe('maskTokens — F5 token leak prevention', () => {
  it('maskTokens_replaces_api_key', () => {
    const input = JSON.stringify(
      { api_key: 'sk-live-supersecret-123', name: 'p1' },
      null,
      2,
    );
    const out = maskTokens(input);
    expect(out).not.toContain('sk-live-supersecret-123');
    expect(out).toContain('"api_key": "***MASKED***"');
    expect(out).toContain('"name": "p1"');
  });

  it('maskTokens_preserves_other_fields', () => {
    const input = JSON.stringify(
      { name: 'p1', api_base: 'https://api.example.com', model: 'gpt-4' },
      null,
      2,
    );
    const out = maskTokens(input);
    // Non-token fields should pass through unchanged (modulo JSON
    // round-trip formatting — here we feed already-pretty-printed
    // JSON, so the output should equal the input).
    expect(out).toBe(input);
  });

  it('maskTokens_handles_nested_objects', () => {
    const input = JSON.stringify({
      provider: { name: 'p1', api_key: 'sk-deep' },
      nested: {
        another: {
          password: 'hunter2',
          safe_field: 'visible',
        },
      },
    });
    const out = maskTokens(input);
    expect(out).not.toContain('sk-deep');
    expect(out).not.toContain('hunter2');
    expect(out).toContain('"safe_field": "visible"');
    expect(out).toContain('"name": "p1"');
  });

  it('maskTokens_uses_custom_token_fields', () => {
    const input = JSON.stringify({ myCustomSecret: 'abc', open: 1 });
    const out = maskTokens(input, ['myCustomSecret']);
    expect(out).not.toContain('"abc"');
    expect(out).toContain('***MASKED***');
    expect(out).toContain('"open": 1');
  });

  it('maskTokens_returns_input_unchanged_on_invalid_json', () => {
    // On parse failure the function returns the original string
    // (so the editor still shows SOMETHING) rather than blowing up.
    const out = maskTokens('{ broken json');
    expect(out).toBe('{ broken json');
  });
});

describe('validateJson', () => {
  it('validateJson_valid_returns_data', () => {
    const result = validateJson('{"x":1,"y":[2,3]}');
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.data).toEqual({ x: 1, y: [2, 3] });
  });

  it('validateJson_invalid_returns_error', () => {
    const result = validateJson('{"x": }');
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
    expect(typeof result.error).toBe('string');
    expect(result.data).toBeUndefined();
  });

  it('validateJson_empty_string_is_invalid', () => {
    const result = validateJson('');
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('validateJson_primitive_root_is_valid', () => {
    // A bare number / string / array is valid JSON even though
    // it can't be saved as a config file — that's a UI concern,
    // not a parser concern.
    const r1 = validateJson('42');
    expect(r1.valid).toBe(true);
    expect(r1.data).toBe(42);

    const r2 = validateJson('[1,2,3]');
    expect(r2.valid).toBe(true);
    expect(r2.data).toEqual([1, 2, 3]);
  });
});

describe('formatJson', () => {
  it('formatJson_adds_indent', () => {
    const out = formatJson('{"a":1,"b":2}');
    expect(out).toBe('{\n  "a": 1,\n  "b": 2\n}');
  });

  it('formatJson_honours_custom_indent', () => {
    const out = formatJson('{"a":1}', 4);
    expect(out).toBe('{\n    "a": 1\n}');
  });

  it('formatJson_throws_on_invalid', () => {
    expect(() => formatJson('not json')).toThrow();
  });
});

describe('DEFAULT_TOKEN_FIELDS — exported for UI label', () => {
  it('contains the 4 standard token names', () => {
    expect(DEFAULT_TOKEN_FIELDS).toContain('api_key');
    expect(DEFAULT_TOKEN_FIELDS).toContain('token');
    expect(DEFAULT_TOKEN_FIELDS).toContain('password');
    expect(DEFAULT_TOKEN_FIELDS).toContain('secret');
  });
});