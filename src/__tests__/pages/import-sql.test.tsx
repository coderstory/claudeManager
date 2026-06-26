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

// jsdom's File polyfill doesn't have `.arrayBuffer()` — polyfill it
// once. (In a real browser / WebView2, File extends Blob which has
// `.arrayBuffer()`.) Phase 2 改造:从 `.text()` polyfill 改为
// `.arrayBuffer()` polyfill,因为 import-sql 现在走 bytes 路径。
if (typeof File !== 'undefined' && !File.prototype.arrayBuffer) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (File.prototype as any).arrayBuffer = function (): Promise<ArrayBuffer> {
    // 优先用 toString() 把内容塞进 buffer(jest File 把内容存在
    // 内部 slot);若空就拿 file name 当占位。
    const str = this.toString();
    return Promise.resolve(new TextEncoder().encode(str).buffer);
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
    models: { default: 'claude-sonnet-4-6', haiku: null, sonnet: null, opus: null, by_tier: {} },
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
    validated_providers: [
      { provider: p('a', 'A'), missing: [] },
      { provider: p('b', 'B'), missing: [] },
      { provider: p('c', 'C'), missing: [] },
    ],
    dedup_outcomes: [
      { provider: p('a', 'A'), is_duplicate: false, duplicate_of: null },
      { provider: p('b', 'B'), is_duplicate: false, duplicate_of: null },
      { provider: p('c', 'C'), is_duplicate: false, duplicate_of: null },
    ],
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
    // M3.9 — 清单 2: 页面 H1 改名 "导入 .sql" → "SQL导入配置"
    expect(
      screen.getByRole('heading', { name: 'SQL导入配置' }),
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

  // M2.17 — F15 batch3: ErrorView 改用共享 ErrorBanner (kind='error')。
  // 测试断言 banner 出现 + role="alert",保证 UI 一致性 + aria。
  it('error view renders shared ErrorBanner (kind=error) with role=alert', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('boom'));
    render(<ImportSqlPage />);

    pickFile('broken');
    await waitFor(() => {
      expect(screen.getByTestId('import-sql-error')).toBeInTheDocument();
    });
    // ErrorBanner kind=error → role="alert" + data-banner-kind="error"
    const banner = screen
      .getByTestId('import-sql-error')
      .querySelector('[data-banner-kind="error"]');
    expect(banner).not.toBeNull();
    expect(banner!.getAttribute('role')).toBe('alert');
    // banner message 显示中文标题 "导入失败"
    expect(banner!.textContent).toContain('导入失败');
  });
});

// ---------------------------------------------------------------------------
// M5 bug #7 — checkbox selection + skip reasons
// ---------------------------------------------------------------------------

describe('ImportSqlPage — M5 bug #7 checkboxes', () => {
  it('renders one checkbox per parsed provider row', async () => {
    mockInvoke.mockResolvedValueOnce(samplePreview());
    render(<ImportSqlPage />);
    pickFile('dump.sql');
    await waitFor(() => {
      expect(screen.getByTestId('import-sql-preview')).toBeInTheDocument();
    });
    expect(screen.getByTestId('import-sql-checkbox-a')).toBeInTheDocument();
    expect(screen.getByTestId('import-sql-checkbox-b')).toBeInTheDocument();
    expect(screen.getByTestId('import-sql-checkbox-c')).toBeInTheDocument();
  });

  it('unchecks rows that fail validation (missing fields)', async () => {
    // row 'a' is missing base_url, row 'b' is fine, row 'c' is dup
    mockInvoke.mockResolvedValueOnce(
      samplePreview({
        importable: 3,
        preview_providers: [p('a', 'A'), p('b', 'B'), p('c', 'C')],
        validated_providers: [
          { provider: p('a', 'A'), missing: ['missing base_url'] },
          { provider: p('b', 'B'), missing: [] },
          { provider: p('c', 'C'), missing: [] },
        ],
        dedup_outcomes: [
          { provider: p('a', 'A'), is_duplicate: false, duplicate_of: null },
          { provider: p('b', 'B'), is_duplicate: false, duplicate_of: null },
          { provider: p('c', 'C'), is_duplicate: false, duplicate_of: null },
        ],
      }),
    );
    render(<ImportSqlPage />);
    pickFile('dump.sql');
    await waitFor(() => {
      expect(screen.getByTestId('import-sql-preview')).toBeInTheDocument();
    });
    expect(
      (screen.getByTestId('import-sql-checkbox-a') as HTMLInputElement).checked,
    ).toBe(false);
    expect(
      (screen.getByTestId('import-sql-checkbox-b') as HTMLInputElement).checked,
    ).toBe(true);
    expect(
      screen.getByTestId('import-sql-skip-reason-a').textContent,
    ).toContain('missing base_url');
  });

  it('unchecks duplicate rows and surfaces reason', async () => {
    mockInvoke.mockResolvedValueOnce(
      samplePreview({
        preview_providers: [p('a', 'A'), p('b', 'B')],
        validated_providers: [
          { provider: p('a', 'A'), missing: [] },
          { provider: p('b', 'B'), missing: [] },
        ],
        dedup_outcomes: [
          { provider: p('a', 'A'), is_duplicate: false, duplicate_of: null },
          {
            provider: p('b', 'B'),
            is_duplicate: true,
            duplicate_of: 'Existing',
          },
        ],
      }),
    );
    render(<ImportSqlPage />);
    pickFile('dump.sql');
    await waitFor(() => {
      expect(screen.getByTestId('import-sql-preview')).toBeInTheDocument();
    });
    expect(
      (screen.getByTestId('import-sql-checkbox-a') as HTMLInputElement).checked,
    ).toBe(true);
    expect(
      (screen.getByTestId('import-sql-checkbox-b') as HTMLInputElement).checked,
    ).toBe(false);
    expect(
      screen.getByTestId('import-sql-skip-reason-b').textContent,
    ).toContain('Existing');
  });

  it('toggles a checkbox when clicked', async () => {
    mockInvoke.mockResolvedValueOnce(samplePreview());
    render(<ImportSqlPage />);
    pickFile('dump.sql');
    await waitFor(() => {
      expect(screen.getByTestId('import-sql-preview')).toBeInTheDocument();
    });
    const cb = screen.getByTestId('import-sql-checkbox-a') as HTMLInputElement;
    expect(cb.checked).toBe(true);
    fireEvent.click(cb);
    expect(cb.checked).toBe(false);
  });

  it('disables confirm when no rows are selected', async () => {
    mockInvoke.mockResolvedValueOnce(
      samplePreview({
        preview_providers: [p('a', 'A')],
        validated_providers: [
          { provider: p('a', 'A'), missing: ['missing token'] },
        ],
        dedup_outcomes: [
          { provider: p('a', 'A'), is_duplicate: false, duplicate_of: null },
        ],
      }),
    );
    render(<ImportSqlPage />);
    pickFile('dump.sql');
    await waitFor(() => {
      expect(screen.getByTestId('import-sql-preview')).toBeInTheDocument();
    });
    expect(screen.getByTestId('import-sql-confirm')).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// F20 — initialFilePath 自动加载(文件关联双击 .sql)
// ---------------------------------------------------------------------------

describe('ImportSqlPage — F20 initialFilePath auto-load', () => {
  it('initialFilePath set → auto-reads + parses → shows preview', async () => {
    // read_sql_file 返回内容,parse_sql_preview 返回 preview
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'read_sql_file') return 'INSERT INTO providers ...';
      if (cmd === 'parse_sql_preview') return samplePreview();
      return undefined;
    });

    render(<ImportSqlPage initialFilePath="C:\\Users\\test\\dump.sql" />);

    await waitFor(() => {
      expect(screen.getByTestId('import-sql-preview')).toBeInTheDocument();
    });
    expect(screen.getByTestId('import-sql-stat-importable').textContent).toContain(
      '3',
    );
    // 文件名从绝对路径提取后显示在 UI
    expect(screen.getByText('dump.sql')).toBeInTheDocument();
    // 确认调了 read_sql_file + parse_sql_preview
    const calls = mockInvoke.mock.calls.map((c) => c[0]);
    expect(calls).toContain('read_sql_file');
    expect(calls).toContain('parse_sql_preview');
  });

  it('initialFilePath null → idle state (no auto-load)', () => {
    render(<ImportSqlPage initialFilePath={null} />);
    expect(screen.getByTestId('import-sql-idle')).toBeInTheDocument();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('initialFilePath undefined → idle state (no auto-load)', () => {
    render(<ImportSqlPage />);
    expect(screen.getByTestId('import-sql-idle')).toBeInTheDocument();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('read_sql_file rejects → error view with message', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'read_sql_file') {
        throw new Error('仅支持 .sql 文件: C:\\test\\dump.txt');
      }
      return undefined;
    });

    render(<ImportSqlPage initialFilePath="C:\\test\\dump.txt" />);

    await waitFor(() => {
      expect(screen.getByTestId('import-sql-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('import-sql-error').textContent).toMatch(
      /仅支持 .sql 文件/,
    );
  });

  it('parse_sql_preview rejects → error view with message', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'read_sql_file') return 'garbage';
      if (cmd === 'parse_sql_preview') {
        throw new Error('not valid utf-8');
      }
      return undefined;
    });

    render(<ImportSqlPage initialFilePath="C:\\test\\bad.sql" />);

    await waitFor(() => {
      expect(screen.getByTestId('import-sql-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('import-sql-error').textContent).toMatch(
      /not valid utf-8/,
    );
  });

  it('shows parsing status while loading', async () => {
    // read_sql_file 永不 resolve(挂起),页面应停在 parsing 状态
    const resolveRef: { fn: ((v: string) => void) | null } = { fn: null };
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'read_sql_file') {
        return new Promise<string>((resolve) => {
          resolveRef.fn = resolve;
        });
      }
      return undefined;
    });

    render(<ImportSqlPage initialFilePath="C:\\test\\slow.sql" />);

    await waitFor(() => {
      expect(screen.getByTestId('import-sql-status-parsing')).toBeInTheDocument();
    });
    expect(
      screen.getByTestId('import-sql-status-parsing').textContent,
    ).toContain('slow.sql');

    // 清理:resolve 挂起的 promise 防 unhandled rejection
    if (resolveRef.fn) resolveRef.fn('done');
  });
});

// ---------------------------------------------------------------------------
// Phase 27 Fix 5 (BUG-CR-05 P0) — selectedIds wired through to backend
// ---------------------------------------------------------------------------
//
// User feedback #11: "勾 1 个导入 6 个". 根因:前端 handleConfirm 调
// importProvidersFromSql(bytes) 不传 selectedIds,后端写所有行。
// 修后:handleConfirm 传 Array.from(selected) 给后端,后端按 ID 过滤
// (D-15~D-18)。

describe('ImportSqlPage — Phase 27 Fix 5 (BUG-CR-05): selectedIds passed to backend', () => {
  it('handleConfirm passes selected_ids (Array.from(selected)) to import_providers_from_sql', async () => {
    mockInvoke
      .mockResolvedValueOnce(samplePreview())
      .mockImplementation((cmd: string) => {
        if (cmd === 'import_providers_from_sql') {
          return Promise.resolve(sampleImportResult({ imported: 1 }));
        }
        return Promise.resolve(undefined);
      });
    render(<ImportSqlPage />);
    pickFile('dump.sql');
    await waitFor(() => {
      expect(screen.getByTestId('import-sql-preview')).toBeInTheDocument();
    });

    // 用户手动取消勾选 a 和 c,只留 b。
    fireEvent.click(screen.getByTestId('import-sql-checkbox-a'));
    fireEvent.click(screen.getByTestId('import-sql-checkbox-c'));

    fireEvent.click(screen.getByTestId('import-sql-confirm'));

    await waitFor(() => {
      expect(screen.getByTestId('import-sql-done')).toBeInTheDocument();
    });

    // 关键断言:invoke 'import_providers_from_sql' 第二个参数应含
    // selected_ids: ['b'] (只有 b 被勾选)。
    const importCall = mockInvoke.mock.calls.find(
      (c) => c[0] === 'import_providers_from_sql',
    );
    expect(importCall).toBeDefined();
    const args = importCall![1] as { selectedIds: string[] };
    expect(args.selectedIds).toEqual(['b']);
  });

  it('DONE summary shows the actual imported count (from result.imported) not the SQL row count', async () => {
    mockInvoke
      .mockResolvedValueOnce(samplePreview())
      .mockImplementation((cmd: string) => {
        if (cmd === 'import_providers_from_sql') {
          return Promise.resolve(sampleImportResult({ imported: 1 }));
        }
        return Promise.resolve(undefined);
      });
    render(<ImportSqlPage />);
    pickFile('dump.sql');
    await waitFor(() => {
      expect(screen.getByTestId('import-sql-preview')).toBeInTheDocument();
    });

    // 只勾 a(取消 b + c),模拟用户实际行为。
    fireEvent.click(screen.getByTestId('import-sql-checkbox-b'));
    fireEvent.click(screen.getByTestId('import-sql-checkbox-c'));

    fireEvent.click(screen.getByTestId('import-sql-confirm'));

    await waitFor(() => {
      expect(screen.getByTestId('import-sql-done')).toBeInTheDocument();
    });
    // 关键断言:summary 文案 "成功导入 1 个" — 不是 "3 个"
    // (D-17 distinct count from backend)。
    expect(screen.getByTestId('import-sql-done-summary').textContent).toMatch(
      /成功导入 1 个 provider/,
    );
  });

  it('confirms are blocked when no rows are selected (selectedCount === 0)', async () => {
    // 整组都缺 token(validate fail)→ 默认全不勾。
    mockInvoke.mockResolvedValueOnce(
      samplePreview({
        importable: 2,
        preview_providers: [p('a', 'A'), p('b', 'B')],
        validated_providers: [
          { provider: p('a', 'A'), missing: ['missing token'] },
          { provider: p('b', 'B'), missing: ['missing token'] },
        ],
        dedup_outcomes: [
          { provider: p('a', 'A'), is_duplicate: false, duplicate_of: null },
          { provider: p('b', 'B'), is_duplicate: false, duplicate_of: null },
        ],
      }),
    );
    render(<ImportSqlPage />);
    pickFile('bad.sql');
    await waitFor(() => {
      expect(screen.getByTestId('import-sql-preview')).toBeInTheDocument();
    });
    // 按钮 disabled,即便用户强行触发也不会发 invoke。
    const confirmBtn = screen.getByTestId('import-sql-confirm');
    expect(confirmBtn).toBeDisabled();
    // 没调 import 任何东西。
    const importCalls = mockInvoke.mock.calls.filter(
      (c) => c[0] === 'import_providers_from_sql',
    );
    expect(importCalls.length).toBe(0);
  });
});