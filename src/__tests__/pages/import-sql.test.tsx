/**
 * Vitest coverage for the F3 ImportSqlPage (M2.2).
 *
 * Strategy: mock `@tauri-apps/api/core` so `invoke()` becomes a plain
 * Promise we control. Avoids spinning up a real Tauri runtime in jsdom.
 *
 * What this covers:
 *   - idle state shows the "选择 .sql 文件" CTA.
 *   - file chosen → parse_sql_preview resolves → preview view shows
 *     3 columns + provider list + confirm button enabled.
 *   - confirm click → import_providers_from_sql → success view with
 *     summary text.
 *   - parse failure → error view with retry.
 *   - import failure → error view with retry.
 *   - importable = 0 → confirm button disabled.
 *   - MCP preview-only banner appears when preview_mcp has rows.
 *   - skipped details panel renders when skipped > 0.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { ImportSqlPage } from '../../pages/import-sql';
import type {
  ImportResult,
  McpServer,
  Provider,
  SqlPreview,
} from '../../types/provider';

// ---------------------------------------------------------------------------
// Mock the Tauri IPC layer.
// ---------------------------------------------------------------------------

const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

// jsdom's File polyfill doesn't have `.text()` — polyfill it once.
// (In a real browser / WebView2, File extends Blob which has `.text()`.)
if (typeof File !== 'undefined' && !File.prototype.text) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (File.prototype as any).text = function (): Promise<string> {
    return Promise.resolve(this.toString());
  };
}

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

function p(id: string, name: string): Provider {
  return {
    id,
    name,
    provider_type: 'anthropic',
    api_base: `https://${id}.example.com`,
    api_key: `key-${id}`,
    models: ['claude-sonnet-4-6'],
    is_active: false,
    created_at: 1_700_000_000,
    last_used_at: null,
    notes: null,
  };
}

function samplePreview(overrides: Partial<SqlPreview> = {}): SqlPreview {
  return {
    total_lines: 4,
    importable: 3,
    skipped: 0,
    preview_providers: [p('a', 'A'), p('b', 'B'), p('c', 'C')],
    preview_mcp: [],
    skipped_samples: [],
    ...overrides,
  };
}

function sampleImportResult(overrides: Partial<ImportResult> = {}): ImportResult {
  return {
    imported: 3,
    skipped: 0,
    mcp_count: 0,
    errors: [],
    ...overrides,
  };
}

function mcp(id: string, name: string): McpServer {
  return {
    id,
    name,
    command: 'npx',
    args: ['-y', `@mcp/${id}`],
    env: {},
    description: null,
  };
}

beforeEach(() => {
  mockInvoke.mockReset();
});

// ---------------------------------------------------------------------------
// Helpers — simulate picking a file via the hidden <input type="file">.
// ---------------------------------------------------------------------------

function pickFile(content: string, name = 'dump.sql') {
  const input = document.querySelector(
    '[data-testid="import-sql-file-input"]',
  ) as HTMLInputElement | null;
  if (!input) throw new Error('file input not found');
  const file = new File([content], name, { type: 'text/plain' });
  // DataTransfer isn't always available in jsdom; assign directly.
  Object.defineProperty(input, 'files', {
    value: [file],
    configurable: true,
  });
  fireEvent.change(input);
}

// ---------------------------------------------------------------------------
// Idle / file-picker state
// ---------------------------------------------------------------------------

describe('ImportSqlPage — F3 idle state', () => {
  it('shows the pick-file CTA when no file is chosen', () => {
    render(<ImportSqlPage />);
    expect(screen.getByTestId('import-sql-idle')).toBeInTheDocument();
    expect(screen.getByTestId('import-sql-pick-file')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: '导入 .sql' }),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Preview flow
// ---------------------------------------------------------------------------

describe('ImportSqlPage — F3 preview flow', () => {
  it('after picking a file, renders preview with 3 summary cards + list', async () => {
    mockInvoke.mockResolvedValueOnce(samplePreview());
    render(<ImportSqlPage />);

    pickFile('INSERT INTO providers ...');

    await waitFor(() => {
      expect(screen.getByTestId('import-sql-preview')).toBeInTheDocument();
    });
    expect(screen.getByTestId('import-sql-stat-importable').textContent).toContain(
      '3',
    );
    expect(screen.getByTestId('import-sql-stat-skipped').textContent).toContain(
      '0',
    );
    expect(screen.getByTestId('import-sql-provider-list')).toBeInTheDocument();
    expect(screen.getByTestId('import-sql-row-a')).toBeInTheDocument();
    expect(screen.getByTestId('import-sql-row-b')).toBeInTheDocument();
    expect(screen.getByTestId('import-sql-row-c')).toBeInTheDocument();
    expect(screen.getByTestId('import-sql-confirm')).not.toBeDisabled();
  });

  it('disables confirm button when importable is 0', async () => {
    mockInvoke.mockResolvedValueOnce(
      samplePreview({
        total_lines: 2,
        importable: 0,
        skipped: 2,
        preview_providers: [],
        skipped_samples: [
          { line: 1, reason: 'invalid id' },
          { line: 2, reason: 'missing api_base' },
        ],
      }),
    );
    render(<ImportSqlPage />);

    pickFile('garbage');

    await waitFor(() => {
      expect(screen.getByTestId('import-sql-empty')).toBeInTheDocument();
    });
    expect(screen.getByTestId('import-sql-confirm')).toBeDisabled();
  });

  it('shows MCP preview banner when preview_mcp has rows', async () => {
    mockInvoke.mockResolvedValueOnce(
      samplePreview({
        importable: 1,
        preview_providers: [p('a', 'A')],
        preview_mcp: [mcp('fs', 'Filesystem'), mcp('git', 'GitHub')],
      }),
    );
    render(<ImportSqlPage />);

    pickFile('mixed.sql');

    await waitFor(() => {
      expect(screen.getByTestId('import-sql-mcp-banner')).toBeInTheDocument();
    });
    expect(screen.getByTestId('import-sql-mcp-banner').textContent).toContain(
      '2 个 MCP server',
    );
  });

  it('shows skipped details panel when skipped > 0', async () => {
    mockInvoke.mockResolvedValueOnce(
      samplePreview({
        importable: 1,
        skipped: 2,
        preview_providers: [p('ok', 'OK')],
        skipped_samples: [
          { line: 5, reason: 'invalid id' },
          { line: 9, reason: 'missing api_base' },
        ],
      }),
    );
    render(<ImportSqlPage />);

    pickFile('mixed.sql');

    await waitFor(() => {
      expect(screen.getByTestId('import-sql-skipped-details')).toBeInTheDocument();
    });
    // Details is collapsed by default; open it.
    const details = screen.getByTestId('import-sql-skipped-details');
    details.querySelector('summary')?.click();
    await waitFor(() => {
      expect(screen.getByTestId('import-sql-skip-0')).toBeInTheDocument();
      expect(screen.getByTestId('import-sql-skip-1')).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// Confirm / import flow
// ---------------------------------------------------------------------------

describe('ImportSqlPage — F3 confirm flow', () => {
  it('clicking confirm calls import and shows success', async () => {
    // Preview resolves once. Import resolves on every call (StrictMode
    // can double-invoke the click handler; mockResolvedValueOnce would
    // starve the second invocation).
    mockInvoke
      .mockResolvedValueOnce(samplePreview())
      .mockImplementation((cmd: string) => {
        if (cmd === 'import_providers_from_sql') {
          return Promise.resolve(sampleImportResult({ imported: 3 }));
        }
        return Promise.resolve(undefined);
      });
    render(<ImportSqlPage />);

    pickFile('dump.sql');
    await waitFor(() => {
      expect(screen.getByTestId('import-sql-preview')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('import-sql-confirm'));

    await waitFor(() => {
      expect(screen.getByTestId('import-sql-done')).toBeInTheDocument();
    });
    expect(screen.getByTestId('import-sql-done-summary').textContent).toMatch(
      /成功导入 3 个 provider/,
    );
    // The second invoke call must be `import_providers_from_sql`.
    const calls = mockInvoke.mock.calls.map((c) => c[0]);
    expect(calls[0]).toBe('parse_sql_preview');
    expect(calls).toContain('import_providers_from_sql');
  });

  it('shows error view when import rejects', async () => {
    mockInvoke
      .mockResolvedValueOnce(samplePreview())
      .mockImplementation((cmd: string) => {
        if (cmd === 'import_providers_from_sql') {
          return Promise.reject(new Error('write failed: ENOSPC'));
        }
        return Promise.resolve(undefined);
      });
    render(<ImportSqlPage />);

    pickFile('dump.sql');
    await waitFor(() => {
      expect(screen.getByTestId('import-sql-preview')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('import-sql-confirm'));

    await waitFor(() => {
      expect(screen.getByTestId('import-sql-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('import-sql-error').textContent).toMatch(
      /write failed: ENOSPC/,
    );
  });

  it('shows error view when parse_sql_preview rejects', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('not valid utf-8'));
    render(<ImportSqlPage />);

    pickFile('binary');

    await waitFor(() => {
      expect(screen.getByTestId('import-sql-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('import-sql-error').textContent).toMatch(
      /not valid utf-8/,
    );
  });
});

// ---------------------------------------------------------------------------
// Reset / re-pick
// ---------------------------------------------------------------------------

describe('ImportSqlPage — F3 reset flow', () => {
  it('reset button returns to idle state', async () => {
    mockInvoke.mockResolvedValueOnce(samplePreview());
    render(<ImportSqlPage />);

    pickFile('dump.sql');
    await waitFor(() => {
      expect(screen.getByTestId('import-sql-preview')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('import-sql-reset'));

    await waitFor(() => {
      expect(screen.getByTestId('import-sql-idle')).toBeInTheDocument();
    });
  });

  it('error view retry button returns to idle', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('boom'));
    render(<ImportSqlPage />);

    pickFile('broken');
    await waitFor(() => {
      expect(screen.getByTestId('import-sql-error')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('import-sql-error-retry'));
    await waitFor(() => {
      expect(screen.getByTestId('import-sql-idle')).toBeInTheDocument();
    });
  });
});