/**
 * json-editor — pure utilities for the F5 JSON editor (M2.4).
 *
 * Why a separate module (vs putting the logic inside
 * `pages/json-editor/index.tsx`):
 *
 *   - The functions here are pure: no DOM, no Tauri, no React state.
 *     That means they unit-test trivially (6 small vitest cases)
 *     and they're refactorable out of the page at any time.
 *
 *   - The most security-critical function (`maskTokens`) lives at
 *     module scope so a careless future refactor can't accidentally
 *     skip it (e.g. by inlining the mask into a render path).
 *
 *   - The page imports them once at the top of the file, and the
 *     bundle sees a single source of truth for "what does F5 mean by
 *     a token field".
 *
 * ## Token leak prevention contract
 *
 * `maskTokens(json, tokenFields)` MUST:
 *
 *   - Parse the input as JSON (returns the input verbatim on parse
 *     failure — so the editor still renders something rather than
 *     blanking out).
 *   - Recursively walk every object key.
 *   - Match keys case-insensitively against the configured
 *     `tokenFields` (default = api_key / token / password / secret).
 *   - Replace the matching value with the literal string
 *     `"***MASKED***"` regardless of the original type (string /
 *     number / object — masks all 3).
 *   - Re-serialise via `JSON.stringify(value, null, 2)` so the
 *     editor's `format` action and the masked view stay aligned.
 *
 * The default `tokenFields` list is also exported as
 * `DEFAULT_TOKEN_FIELDS` so the UI can render a one-liner label
 * ("遮罩字段：api_key, token, password, secret") without duplicating
 * the literal list.
 */

const MASK = '***MASKED***';

/**
 * Default set of field names whose VALUES must never appear on
 * screen / in screenshots.
 *
 * Case-insensitive match (`apiKey` == `api_key` == `API_KEY`). Add
 * a new field here ONLY if the underlying config file convention
 * uses that exact name; project-specific keys belong in the
 * call-site (the second arg of `maskTokens`).
 */
export const DEFAULT_TOKEN_FIELDS: readonly string[] = [
  'api_key',
  'apikey',
  'token',
  'password',
  'secret',
  'access_token',
  'refresh_token',
  'auth',
] as const;

/**
 * Result of a `validateJson` call.
 *
 * Shape stays a union — we don't throw on bad input — because the
 * editor wants to keep showing the broken text alongside the error
 * message. Throwing would force the page into a try/catch around
 * every keystroke, which is exactly the kind of ceremony that
 * pushes security-critical logic into the "skip it" pile.
 */
export type ValidateResult =
  | { valid: true; data: unknown }
  | { valid: false; error: string };

/**
 * Mask every value whose key matches any entry in `tokenFields`.
 *
 * @param json  Raw JSON text (usually whatever's in the textarea).
 * @param tokenFields  Keys whose values should be replaced with
 *                     `"***MASKED***"`. Matched case-insensitively.
 *                     Default = [`DEFAULT_TOKEN_FIELDS`].
 *
 * @returns  Pretty-printed JSON string with masked values, OR the
 *           original `json` string if parsing failed (the editor
 *           keeps showing the broken text + a red border).
 */
export function maskTokens(
  json: string,
  tokenFields: readonly string[] = DEFAULT_TOKEN_FIELDS,
): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    // Parse failure — return the original text so the editor
    // doesn't blank out. The validate banner will already be
    // showing the parse error.
    return json;
  }

  const lowered = tokenFields.map((f) => f.toLowerCase());
  const masked = walkAndMask(parsed, lowered);
  return JSON.stringify(masked, null, 2);
}

/**
 * Recursively replace values whose key matches a token field.
 *
 * Walks every object (nested too) and every array (replaces
 * inside elements). Non-matching values are returned unchanged
 * (still wrapped in a fresh container, so the caller's `JSON.stringify`
 * is safe).
 */
function walkAndMask(node: unknown, tokenFieldsLower: readonly string[]): unknown {
  if (Array.isArray(node)) {
    return node.map((item) => walkAndMask(item, tokenFieldsLower));
  }
  if (node !== null && typeof node === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (tokenFieldsLower.includes(k.toLowerCase())) {
        result[k] = MASK;
      } else {
        result[k] = walkAndMask(v, tokenFieldsLower);
      }
    }
    return result;
  }
  // Primitives (string / number / boolean / null) — return as-is.
  return node;
}

/**
 * Validate a JSON string.
 *
 * @returns  `{ valid: true, data }` on success, where `data` is
 *           the parsed value (so the caller can short-circuit
 *           "already parsed" without re-parsing).
 *           `{ valid: false, error }` on parse failure, where
 *           `error` is the `JSON.parse` message.
 *
 * Empty string is treated as invalid (an empty file is NOT a
 * valid config — `{}` is).
 */
export function validateJson(text: string): ValidateResult {
  if (text.trim() === '') {
    return { valid: false, error: '内容为空' };
  }
  try {
    return { valid: true, data: JSON.parse(text) };
  } catch (e) {
    return { valid: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Pretty-print a JSON string with the given indent (default 2).
 *
 * Throws on parse failure — this function is called from the
 * `格式化` button which already gates on `validateJson(...)`,
 * so by the time we get here the input is known-good.
 *
 * @param text     The raw JSON text.
 * @param indent   Number of spaces per level. Default 2 (matches
 *                 GitHub / Claude Code convention).
 */
export function formatJson(text: string, indent = 2): string {
  const parsed = JSON.parse(text);
  return JSON.stringify(parsed, null, indent);
}