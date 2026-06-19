/**
 * Vitest setup — runs once before any test file.
 *
 * Loads `@testing-library/jest-dom` so we get nice matchers like
 * `toBeInTheDocument()`, `toHaveTextContent()`, etc.
 *
 * Keep this file lean — global mocks belong in dedicated modules so
 * individual tests can opt in via `vi.mock()`.
 */
import '@testing-library/jest-dom/vitest';
