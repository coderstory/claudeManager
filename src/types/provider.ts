/**
 * Provider — TypeScript mirror of `src-tauri/src/domain/provider.rs::Provider`.
 *
 * Keep the field names snake_case to match the Rust serde representation
 * (`#[serde(rename_all = "snake_case")]`). The Rust backend deserializes
 * JSON straight into Provider; the TS layer just reads the shape.
 *
 * SPEC §2.1 contract:
 * - id: kebab-case, unique in the library
 * - name: human-readable display
 * - provider_type: "anthropic" | "openai" | "deepseek" | "custom" | ...
 * - api_base: ANTHROPIC_BASE_URL
 * - api_key: ANTHROPIC_AUTH_TOKEN (M2.5+ will mask in UI; M2.1 raw)
 * - models: optional list (empty = use server default)
 * - is_active: recomputed from settings.json on every list_providers call
 * - created_at / last_used_at: Unix seconds (NOT ms)
 * - notes: free text
 */
export interface Provider {
  id: string;
  name: string;
  provider_type: string;
  api_base: string;
  api_key: string;
  models: string[];
  is_active: boolean;
  created_at: number;
  last_used_at: number | null;
  notes: string | null;
}

/**
 * Response shape from `list_providers_with_warnings`.
 * The plain `list_providers` returns `Provider[]` directly (no warnings).
 */
export interface ListProvidersResult {
  providers: Provider[];
  warnings: string[];
}

// ---------------------------------------------------------------------------
// F3 — .sql 导入 (M2.2)
// ---------------------------------------------------------------------------

/**
 * One MCP server parsed from a .sql dump (M2.2 preview only — F6 owns
 * the write-side). Matches the Rust `McpServer` in
 * `src-tauri/src/infrastructure/sql_parser.rs`.
 */
export interface McpServer {
  id: string;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  description: string | null;
}

/**
 * One row that was skipped during preview / import.
 *
 * `kind` is `"parse"` for parser-level rejections (bad JSON, invalid
 * id, missing field) or `"write"` for serialise / atomic-write failures.
 * `line` is 1-based in the original dump (0 for write errors).
 */
export interface SkippedLine {
  line: number;
  reason: string;
}

/**
 * Returned by `parse_sql_preview` (M2.2).
 *
 * The page renders 3 cards from this: 原始行数 / 可导入数 / 跳过行数,
 * plus a preview list of the providers that will be imported.
 */
export interface SqlPreview {
  total_lines: number;
  importable: number;
  skipped: number;
  preview_providers: Provider[];
  preview_mcp: McpServer[];
  skipped_samples: SkippedLine[];
}

/**
 * Returned by `import_providers_from_sql` (M2.2).
 *
 * `imported` is the count of newly-written provider files; `skipped`
 * is the count of provider rows that were skipped because a file with
 * that id already existed (idempotency). `errors` is the union of
 * parse + write failures — surfaced as a details panel in the UI.
 */
export interface ImportResult {
  imported: number;
  skipped: number;
  mcp_count: number;
  errors: ImportSkip[];
}

/**
 * One entry in `ImportResult.errors`. Same shape as `SkippedLine` but
 * adds a `kind` discriminator and an optional `id` for write errors.
 */
export interface ImportSkip {
  kind: string;
  line: number;
  id: string | null;
  reason: string;
}

/**
 * ProviderInput — mirror of `src-tauri/src/domain/provider.rs::ProviderInput`.
 * Used by add_provider and update_provider IPC commands (M3.6 清单 22 CRUD).
 * Note: `id` is NOT in this struct — `update_provider` takes id as a
 * separate path argument (it's the filename stem and immutable after creation).
 */
export interface ProviderInput {
  name: string;
  base_url: string;
  api_key: string;
  model: string;
  notes: string | null;
}
