/**
 * Vitest coverage for the F6 McpManagementPage (M2.5).
 *
 * What this covers (TDD, CLAUDE.md §5.2):
 *   - Empty state: no servers → empty card with prompt.
 *   - List state: 3 servers → table rows render.
 *   - Toggle: optimistic update + IPC call.
 *   - Toggle rollback: IPC error → revert + InfoBar.
 *   - Add modal: opens form, validates required fields.
 *   - Edit modal: pre-fills current values.
 *   - Delete: confirm + IPC call.
 *   - Import: parseMcpDeeplink fills the form.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import McpManagementPage from '../../pages/mcp-management';
import type { McpServer } from '../../types/mcp';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

const sampleStdio = (id: string, name: string): McpServer => ({
  id,
  name,
  transport: 'stdio',
  command: 'npx',
  args: ['-y', `@mcp/${name}`],
  env: {},
  enabled: true,
  created_at: 1_700_000_000,
});

const sampleHttp = (id: string, name: string): McpServer => ({
  id,
  name,
  transport: 'http',
  args: [],
  env: {},
  url: `https://${name}.example/sse`,
  enabled: false,
  created_at: 1_700_000_001,
});

beforeEach(() => {
  mockInvoke.mockReset();
  // Default: list returns 3 servers.
  mockInvoke.mockImplementation(async (cmd: string) => {
    if (cmd === 'list_mcp_servers') {
      return [
        sampleStdio('11111111-1111-1111-1111-111111111111', 'fs'),
        sampleHttp('22222222-2222-2222-2222-222222222222', 'remote'),
        sampleStdio('33333333-3333-3333-3333-333333333333', 'echo'),
      ];
    }
    return null;
  });
  // Default window.confirm: accept.
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

describe('McpManagementPage — F6 (M2.5)', () => {
  it('renders the page title and toolbar', async () => {
    render(<McpManagementPage />);
    expect(screen.getByTestId('mcp-management-page')).toBeInTheDocument();
    expect(screen.getByTestId('mcp-add-btn')).toBeInTheDocument();
    expect(screen.getByTestId('mcp-import-btn')).toBeInTheDocument();
    expect(screen.getByTestId('mcp-refresh-btn')).toBeInTheDocument();
  });

  it('shows the empty state when there are no servers', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_mcp_servers') return [];
      return null;
    });
    render(<McpManagementPage />);
    await waitFor(() => {
      expect(screen.getByTestId('mcp-empty')).toBeInTheDocument();
    });
  });

  it('renders a row per server with name / type / command', async () => {
    render(<McpManagementPage />);
    await waitFor(() => {
      expect(screen.getByTestId('mcp-table')).toBeInTheDocument();
    });
    const rows = screen.getAllByTestId('mcp-row');
    expect(rows.length).toBe(3);
    expect(screen.getByText('fs')).toBeInTheDocument();
    expect(screen.getByText('remote')).toBeInTheDocument();
    expect(screen.getByText('echo')).toBeInTheDocument();
  });

  it('toggling a checkbox calls toggle_mcp_server', async () => {
    mockInvoke.mockImplementation(async (cmd: string, args: unknown) => {
      if (cmd === 'list_mcp_servers') {
        return [
          sampleStdio('11111111-1111-1111-1111-111111111111', 'fs'),
          sampleHttp('22222222-2222-2222-2222-222222222222', 'remote'),
          sampleStdio('33333333-3333-3333-3333-333333333333', 'echo'),
        ];
      }
      if (cmd === 'toggle_mcp_server') {
        const a = args as { id: string; enabled: boolean };
        const source = a.id === '11111111-1111-1111-1111-111111111111'
          ? sampleStdio(a.id, 'fs')
          : a.id === '22222222-2222-2222-2222-222222222222'
            ? sampleHttp(a.id, 'remote')
            : sampleStdio(a.id, 'echo');
        return { ...source, enabled: a.enabled };
      }
      return null;
    });
    render(<McpManagementPage />);
    await waitFor(() => {
      expect(screen.getAllByTestId('mcp-toggle').length).toBeGreaterThan(0);
    });
    const toggles = screen.getAllByTestId('mcp-toggle');
    await act(async () => {
      fireEvent.click(toggles[0]); // fs is enabled, click to disable
    });
    await waitFor(() => {
      const calls = mockInvoke.mock.calls.filter(
        (c) => c[0] === 'toggle_mcp_server',
      );
      expect(calls.length).toBeGreaterThanOrEqual(1);
      expect(calls[0][1]).toMatchObject({
        id: '11111111-1111-1111-1111-111111111111',
        enabled: false,
      });
    });
  });

  it('rolling back toggle on IPC error keeps the original enabled flag', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_mcp_servers') {
        return [sampleStdio('id-1', 'fs')];
      }
      if (cmd === 'toggle_mcp_server') {
        throw new Error('disk full');
      }
      return null;
    });
    render(<McpManagementPage />);
    await waitFor(() => {
      expect(screen.getByTestId('mcp-toggle')).toBeInTheDocument();
    });
    const toggle = screen.getByTestId('mcp-toggle') as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    await act(async () => {
      fireEvent.click(toggle);
    });
    await waitFor(() => {
      // After rollback, the checkbox reverts to checked.
      expect((screen.getByTestId('mcp-toggle') as HTMLInputElement).checked).toBe(true);
      // InfoBar shows the error.
      expect(screen.getByTestId('mcp-message')).toBeInTheDocument();
      expect(screen.getByTestId('mcp-message').textContent).toContain('disk full');
    });
  });

  it('opening the add modal shows the form fields', async () => {
    render(<McpManagementPage />);
    await waitFor(() => {
      expect(screen.getByTestId('mcp-add-btn')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('mcp-add-btn'));
    expect(screen.getByTestId('mcp-modal')).toBeInTheDocument();
    expect(screen.getByTestId('mcp-form-name')).toBeInTheDocument();
    expect(screen.getByTestId('mcp-form-transport')).toBeInTheDocument();
  });

  it('add form rejects empty name', async () => {
    render(<McpManagementPage />);
    await waitFor(() => {
      expect(screen.getByTestId('mcp-add-btn')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('mcp-add-btn'));
    fireEvent.click(screen.getByTestId('mcp-form-submit'));
    expect(screen.getByTestId('mcp-form-error')).toBeInTheDocument();
    expect(screen.getByTestId('mcp-form-error').textContent).toContain('名称');
  });

  it('add form requires command for stdio transport', async () => {
    render(<McpManagementPage />);
    await waitFor(() => {
      expect(screen.getByTestId('mcp-add-btn')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('mcp-add-btn'));
    fireEvent.input(screen.getByTestId('mcp-form-name'), {
      target: { value: 'new-fs' },
    });
    fireEvent.click(screen.getByTestId('mcp-form-submit'));
    expect(screen.getByTestId('mcp-form-error').textContent).toContain('command');
  });

  it('submitting a valid add form calls add_mcp_server', async () => {
    render(<McpManagementPage />);
    await waitFor(() => {
      expect(screen.getByTestId('mcp-add-btn')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('mcp-add-btn'));
    fireEvent.input(screen.getByTestId('mcp-form-name'), {
      target: { value: 'my-fs' },
    });
    fireEvent.input(screen.getByTestId('mcp-form-command'), {
      target: { value: 'npx' },
    });
    fireEvent.input(screen.getByTestId('mcp-form-args'), {
      target: { value: '-y @mcp/filesystem' },
    });
    fireEvent.click(screen.getByTestId('mcp-form-submit'));
    await waitFor(() => {
      const calls = mockInvoke.mock.calls.filter(
        (c) => c[0] === 'add_mcp_server',
      );
      expect(calls.length).toBe(1);
      expect(calls[0][1].server.name).toBe('my-fs');
      expect(calls[0][1].server.command).toBe('npx');
      expect(calls[0][1].server.args).toEqual(['-y', '@mcp/filesystem']);
    });
  });

  it('clicking delete confirms then calls remove_mcp_server', async () => {
    render(<McpManagementPage />);
    await waitFor(() => {
      expect(screen.getAllByTestId('mcp-delete-btn').length).toBeGreaterThan(0);
    });
    const deleteButtons = screen.getAllByTestId('mcp-delete-btn');
    fireEvent.click(deleteButtons[0]);
    await waitFor(() => {
      const calls = mockInvoke.mock.calls.filter(
        (c) => c[0] === 'remove_mcp_server',
      );
      expect(calls.length).toBe(1);
      expect(calls[0][1].id).toBe('11111111-1111-1111-1111-111111111111');
    });
  });

  it('cancel button closes the modal without invoking', async () => {
    render(<McpManagementPage />);
    await waitFor(() => {
      expect(screen.getByTestId('mcp-add-btn')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('mcp-add-btn'));
    expect(screen.getByTestId('mcp-modal')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('mcp-form-cancel'));
    await waitFor(() => {
      expect(screen.queryByTestId('mcp-modal')).toBeNull();
    });
    const addCalls = mockInvoke.mock.calls.filter(
      (c) => c[0] === 'add_mcp_server',
    );
    expect(addCalls.length).toBe(0);
  });

  it('import button reads clipboard and calls parse_mcp_deeplink', async () => {
    // Mock clipboard.readText.
    const readText = vi.fn().mockResolvedValue(
      'ccswitch://v1/import?resource=mcp&app=claude&name=imported&command=npx',
    );
    Object.defineProperty(navigator, 'clipboard', {
      value: { readText },
      configurable: true,
    });
    mockInvoke.mockImplementation(async (cmd: string, args: unknown) => {
      if (cmd === 'list_mcp_servers') return [];
      if (cmd === 'parse_mcp_deeplink') {
        expect((args as { url: string }).url).toContain('resource=mcp');
        return {
          action: { kind: 'import_mcp' },
          provider: null,
          mcp_server: sampleStdio('uuid-1', 'imported'),
        };
      }
      return null;
    });
    render(<McpManagementPage />);
    await waitFor(() => {
      expect(screen.getByTestId('mcp-import-btn')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('mcp-import-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('mcp-modal')).toBeInTheDocument();
      expect(
        (screen.getByTestId('mcp-form-name') as HTMLInputElement).value,
      ).toBe('imported');
    });
  });

  // M5 bug #12 — 剪贴板里是 MCP server JSON 时,不应该走 deeplink URL
  // 解析(会因 'relative URL without a base' 报错),而应该直接解析
  // JSON 并填入 modal。
  it('import button parses JSON clipboard content (not URL)', async () => {
    const json = JSON.stringify({
      name: 'MyMCP',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@my/mcp'],
      env: { TOKEN: 'k' },
    });
    const readText = vi.fn().mockResolvedValue(json);
    Object.defineProperty(navigator, 'clipboard', {
      value: { readText },
      configurable: true,
    });
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_mcp_servers') return [];
      // 关键断言:不应调 parse_mcp_deeplink(JSON 不该走 URL 解析)。
      if (cmd === 'parse_mcp_deeplink') {
        throw new Error('parse_mcp_deeplink should NOT be called for JSON');
      }
      return null;
    });
    render(<McpManagementPage />);
    await waitFor(() => {
      expect(screen.getByTestId('mcp-import-btn')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('mcp-import-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('mcp-modal')).toBeInTheDocument();
      expect(
        (screen.getByTestId('mcp-form-name') as HTMLInputElement).value,
      ).toBe('MyMCP');
      expect(
        (screen.getByTestId('mcp-form-command') as HTMLInputElement).value,
      ).toBe('npx');
    });
  });

  it('import button reports error for non-JSON non-URL clipboard content', async () => {
    const readText = vi.fn().mockResolvedValue('just some random text');
    Object.defineProperty(navigator, 'clipboard', {
      value: { readText },
      configurable: true,
    });
    render(<McpManagementPage />);
    await waitFor(() => {
      expect(screen.getByTestId('mcp-import-btn')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('mcp-import-btn'));
    await waitFor(() => {
      const msg = screen.getByTestId('mcp-message');
      expect(msg).toBeInTheDocument();
      expect(msg.getAttribute('data-message-kind')).toBe('error');
      expect(msg.textContent).toContain('既不是 JSON 也不是');
    });
  });

  // M2.17 — F15 batch3: InfoBar 改用共享 ErrorBanner。
  // 保留对外 testid `mcp-message` + data-message-kind,新增断言 banner 内部
  // 走 kind=success (role="status") / kind=error (role="alert")。
  it('toggle failure → mcp-message wrapper contains ErrorBanner kind=error with role=alert', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_mcp_servers') {
        return [sampleStdio('id-1', 'fs')];
      }
      if (cmd === 'toggle_mcp_server') {
        throw new Error('disk full');
      }
      return null;
    });
    render(<McpManagementPage />);
    await waitFor(() => {
      expect(screen.getByTestId('mcp-toggle')).toBeInTheDocument();
    });
    const toggle = screen.getByTestId('mcp-toggle') as HTMLInputElement;
    await act(async () => {
      fireEvent.click(toggle);
    });
    await waitFor(() => {
      const msg = screen.getByTestId('mcp-message');
      expect(msg).toBeInTheDocument();
      expect(msg.getAttribute('data-message-kind')).toBe('error');
      // ErrorBanner kind=error → role="alert"
      const banner = msg.querySelector('[data-banner-kind="error"]');
      expect(banner).not.toBeNull();
      expect(banner!.getAttribute('role')).toBe('alert');
      expect(banner!.textContent).toContain('disk full');
    });
  });

  it('delete success → mcp-message wrapper contains ErrorBanner kind=success with role=status', async () => {
    render(<McpManagementPage />);
    await waitFor(() => {
      expect(screen.getAllByTestId('mcp-delete-btn').length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getAllByTestId('mcp-delete-btn')[0]);
    await waitFor(() => {
      const msg = screen.getByTestId('mcp-message');
      expect(msg).toBeInTheDocument();
      expect(msg.getAttribute('data-message-kind')).toBe('success');
      // ErrorBanner kind=success → role="status"
      const banner = msg.querySelector('[data-banner-kind="success"]');
      expect(banner).not.toBeNull();
      expect(banner!.getAttribute('role')).toBe('status');
    });
  });
});

// ---------------------------------------------------------------------------
// M5 bug #11 — path label switches between user-level and project-level
// ---------------------------------------------------------------------------

describe('McpManagementPage — M5 bug #11 scope-aware path label', () => {
  it('shows ~/.claude/mcp.json at user level (no current project)', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_mcp_servers') return [];
      if (cmd === 'list_projects') return { projects: [], current_project_id: null };
      if (cmd === 'current_project') return null;
      return null;
    });
    render(<McpManagementPage />);
    await waitFor(() => {
      expect(screen.getByTestId('mcp-path-label').textContent).toBe(
        '~/.claude/mcp.json',
      );
    });
  });

  it('shows project name in path label when a project is active', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_mcp_servers') return [];
      if (cmd === 'list_projects') {
        return {
          projects: [
            {
              id: 'p1',
              name: 'MyApp',
              root_dir: '/x/y',
              created_at: 0,
              last_used_at: null,
              is_system: false,
            },
          ],
          current_project_id: 'p1',
        };
      }
      if (cmd === 'current_project') {
        return {
          id: 'p1',
          name: 'MyApp',
          root_dir: '/x/y',
          created_at: 0,
          last_used_at: null,
          is_system: false,
        };
      }
      return null;
    });
    render(<McpManagementPage />);
    await waitFor(() => {
      const label = screen.getByTestId('mcp-path-label').textContent;
      expect(label).toContain('MyApp');
      expect(label).toContain('.claude/mcp.json');
    });
  });
});
