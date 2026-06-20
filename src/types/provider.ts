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