/**
 * Vitest coverage for the F5 JsonEditorPage (M2.4).
 *
 * What this covers (TDD, CLAUDE.md §5.2):
 *   - Page renders the toolbar + empty editor.
 *   - Loading a file via `readFile` populates the textarea.
 *   - Token masking default ON: api_key values are NOT visible.
 *   - Toggle mask → raw values visible.
 *   - Format button → pretty-prints the content.
 *   - Save button → calls `writeFileAtomic` with the current content.
 *   - Save on invalid JSON → confirm dialog → user cancels → no save.
 *
 * Mocks: `invoke` (Tauri IPC) is mocked at the module level so the
 * page calls resolve to the mocked values rather than hitting the
 * real Rust backend.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import JsonEditorPage from '../../pages/json-editor';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

const SAMPLE_JSON = JSON.stringify({
  name: 'p1',
  api_key: 'sk-leaked-value',
  api_base: 'https://api.example.com',
}, null, 2);

beforeEach(() => {
  mockInvoke.mockReset();
  // Default: readFile returns the sample, writeFileAtomic succeeds.
  mockInvoke.mockImplementation(async (cmd: string) => {
    if (cmd === 'read_file') return SAMPLE_JSON;
    if (cmd === 'write_file_atomic') return null;
    return null;
  });
});

afterEach(() => {
  // Clean up any leftover dialog confirm mock
  vi.restoreAllMocks();
});

describe('JsonEditorPage — F5 (M2.4)', () => {
  it('renders toolbar with 选择文件 / 保存 / 格式化 / 撤销 / 重做 / 遮罩', async () => {
    render(<JsonEditorPage />);
    await waitFor(() => {
      expect(screen.getByTestId('json-editor-pick-btn')).toBeTruthy();
      expect(screen.getByTestId('json-editor-save-btn')).toBeTruthy();
      expect(screen.getByTestId('json-editor-format-btn')).toBeTruthy();
      expect(screen.getByTestId('json-editor-undo-btn')).toBeTruthy();
      expect(screen.getByTestId('json-editor-redo-btn')).toBeTruthy();
      expect(screen.getByTestId('json-editor-mask-toggle')).toBeTruthy();
    });
  });

  it('starts with masked ON and empty editor', async () => {
    render(<JsonEditorPage />);
    await waitFor(() => {
      const toggle = screen.getByTestId('json-editor-mask-toggle');
      expect(toggle.textContent).toContain('遮罩开');
    });
  });

  it('clicking 选择文件 triggers file input click', async () => {
    render(<JsonEditorPage />);
    await waitFor(() => screen.getByTestId('json-editor-pick-btn'));
    const input = screen.getByTestId('json-editor-file-input') as HTMLInputElement;
    const clickSpy = vi.spyOn(input, 'click');
    fireEvent.click(screen.getByTestId('json-editor-pick-btn'));
    expect(clickSpy).toHaveBeenCalled();
  });

  it('loads file content via readFile and shows masked view', async () => {
    render(<JsonEditorPage />);
    await waitFor(() => screen.getByTestId('json-editor-file-input'));
    const file = new File([SAMPLE_JSON], 'settings.json', {
      type: 'application/json',
    });
    const input = screen.getByTestId('json-editor-file-input') as HTMLInputElement;
    // jsdom doesn't fire onChange via DataTransfer when we use Object.defineProperty,
    // so we drive the underlying handler directly.
    await act(async () => {
      Object.defineProperty(input, 'files', {
        value: [file],
        configurable: true,
      });
      fireEvent.change(input);
    });

    await waitFor(() => {
      const ta = screen.getByTestId('json-editor-textarea') as HTMLTextAreaElement;
      // Default mask ON → raw api_key value must NOT appear
      expect(ta.value).not.toContain('sk-leaked-value');
      expect(ta.value).toContain('***MASKED***');
      // path shown
      expect(screen.getByTestId('json-editor-path').textContent).toContain('settings.json');
    });
  });

  it('toggle mask off shows raw api_key', async () => {
    render(<JsonEditorPage />);
    await waitFor(() => screen.getByTestId('json-editor-file-input'));
    const file = new File([SAMPLE_JSON], 'settings.json', { type: 'application/json' });
    const input = screen.getByTestId('json-editor-file-input') as HTMLInputElement;
    await act(async () => {
      Object.defineProperty(input, 'files', {
        value: [file],
        configurable: true,
      });
      fireEvent.change(input);
    });
    await waitFor(() =>
      expect((screen.getByTestId('json-editor-textarea') as HTMLTextAreaElement).value)
        .toContain('***MASKED***'),
    );

    // Toggle off
    fireEvent.click(screen.getByTestId('json-editor-mask-toggle'));
    await waitFor(() => {
      const ta = screen.getByTestId('json-editor-textarea') as HTMLTextAreaElement;
      expect(ta.value).toContain('sk-leaked-value');
      expect(ta.value).not.toContain('***MASKED***');
    });
  });

  it('format button pretty-prints content', async () => {
    const compact = '{"a":1,"b":2}';
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'read_file') return compact;
      if (cmd === 'write_file_atomic') return null;
      return null;
    });

    render(<JsonEditorPage />);
    await waitFor(() => screen.getByTestId('json-editor-file-input'));
    const file = new File([compact], 'compact.json', { type: 'application/json' });
    const input = screen.getByTestId('json-editor-file-input') as HTMLInputElement;
    await act(async () => {
      Object.defineProperty(input, 'files', { value: [file], configurable: true });
      fireEvent.change(input);
    });
    await waitFor(() =>
      expect((screen.getByTestId('json-editor-textarea') as HTMLTextAreaElement).value)
        .toContain('"a"'),
    );

    fireEvent.click(screen.getByTestId('json-editor-format-btn'));
    await waitFor(() => {
      const ta = screen.getByTestId('json-editor-textarea') as HTMLTextAreaElement;
      expect(ta.value).toContain('\n  "a": 1,\n  "b": 2\n');
    });
  });

  it('save button calls write_file_atomic with the current content', async () => {
    render(<JsonEditorPage />);
    await waitFor(() => screen.getByTestId('json-editor-file-input'));
    const file = new File([SAMPLE_JSON], 'settings.json', { type: 'application/json' });
    const input = screen.getByTestId('json-editor-file-input') as HTMLInputElement;
    await act(async () => {
      Object.defineProperty(input, 'files', { value: [file], configurable: true });
      fireEvent.change(input);
    });
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith('read_file', expect.objectContaining({ path: 'settings.json' })),
    );

    fireEvent.click(screen.getByTestId('json-editor-save-btn'));
    await waitFor(() => {
      const writeCalls = mockInvoke.mock.calls.filter((c) => c[0] === 'write_file_atomic');
      expect(writeCalls.length).toBeGreaterThanOrEqual(1);
      const lastWrite = writeCalls[writeCalls.length - 1];
      expect(lastWrite[1]).toMatchObject({ path: 'settings.json' });
      expect((lastWrite[1] as { content: string }).content).toContain('name');
    });
  });

  it('save on invalid JSON triggers confirm dialog; user cancel skips save', async () => {
    const valid = '{"k":1}';
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'read_file') return valid;
      if (cmd === 'write_file_atomic') return null;
      return null;
    });
    // Stub window.confirm → false (user cancels)
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

    render(<JsonEditorPage />);
    await waitFor(() => screen.getByTestId('json-editor-file-input'));
    const file = new File([valid], 'v.json', { type: 'application/json' });
    const input = screen.getByTestId('json-editor-file-input') as HTMLInputElement;
    await act(async () => {
      Object.defineProperty(input, 'files', { value: [file], configurable: true });
      fireEvent.change(input);
    });
    await waitFor(() => screen.getByTestId('json-editor-textarea'));

    // Type invalid JSON into textarea
    const ta = screen.getByTestId('json-editor-textarea') as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(ta, { target: { value: '{ broken json' } });
    });
    // Wait for debounced validation
    await waitFor(() => {
      expect(screen.getByTestId('json-editor-error')).toBeTruthy();
    }, { timeout: 1000 });

    fireEvent.click(screen.getByTestId('json-editor-save-btn'));
    // confirm() was called with a warning message
    expect(confirmSpy).toHaveBeenCalled();
    // User cancelled → no write
    const writeCalls = mockInvoke.mock.calls.filter((c) => c[0] === 'write_file_atomic');
    expect(writeCalls).toHaveLength(0);
  });

  it('undo/redo buttons navigate history', async () => {
    const original = '{"v":1}';
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'read_file') return original;
      if (cmd === 'write_file_atomic') return null;
      return null;
    });

    render(<JsonEditorPage />);
    await waitFor(() => screen.getByTestId('json-editor-file-input'));
    const file = new File([original], 'u.json', { type: 'application/json' });
    const input = screen.getByTestId('json-editor-file-input') as HTMLInputElement;
    await act(async () => {
      Object.defineProperty(input, 'files', { value: [file], configurable: true });
      fireEvent.change(input);
    });
    await waitFor(() => screen.getByTestId('json-editor-textarea'));

    // Toggle mask OFF so the textarea shows raw state.raw (otherwise
    // maskTokens() re-stringifies via JSON.stringify(..., null, 2)
    // which would make the assertions confusing).
    fireEvent.click(screen.getByTestId('json-editor-mask-toggle'));

    const ta = screen.getByTestId('json-editor-textarea') as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(ta, { target: { value: '{"v":2}' } });
    });
    await waitFor(() => {
      expect((screen.getByTestId('json-editor-textarea') as HTMLTextAreaElement).value).toContain('"v":2');
    });

    // Undo
    fireEvent.click(screen.getByTestId('json-editor-undo-btn'));
    await waitFor(() => {
      expect((screen.getByTestId('json-editor-textarea') as HTMLTextAreaElement).value).toContain('"v":1');
    });

    // Redo
    fireEvent.click(screen.getByTestId('json-editor-redo-btn'));
    await waitFor(() => {
      expect((screen.getByTestId('json-editor-textarea') as HTMLTextAreaElement).value).toContain('"v":2');
    });
  });

  it('readFile error surfaces in InfoBar', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'read_file') throw new Error('路径超出允许范围: /etc/passwd');
      if (cmd === 'write_file_atomic') return null;
      return null;
    });

    render(<JsonEditorPage />);
    await waitFor(() => screen.getByTestId('json-editor-file-input'));
    const file = new File(['x'], 'bad.json', { type: 'application/json' });
    const input = screen.getByTestId('json-editor-file-input') as HTMLInputElement;
    await act(async () => {
      Object.defineProperty(input, 'files', { value: [file], configurable: true });
      fireEvent.change(input);
    });

    await waitFor(() => {
      const msg = screen.getByTestId('json-editor-message');
      expect(msg).toBeTruthy();
      expect(msg.getAttribute('data-message-kind')).toBe('error');
      expect(msg.textContent).toContain('路径超出允许范围');
    });
  });

  // -----------------------------------------------------------------
  // 清单 20 — 4 scenario InfoBar copy
  // Backend returns strings prefixed by `classify_io_error` category
  // word ("文件不存在" / "无权限" / "编码错误" / "I/O 失败"). The
  // page's `mapBackendError` strips the leading category for a
  // short, focused message.
  // -----------------------------------------------------------------

  it('清单 20 scenario 1: 合法路径 → 正常加载 (no InfoBar)', async () => {
    // Sanity: the default mock returns SAMPLE_JSON, which is a valid
    // JSON load — InfoBar must NOT show an error.
    render(<JsonEditorPage />);
    await waitFor(() => screen.getByTestId('json-editor-file-input'));
    const file = new File([SAMPLE_JSON], 'settings.json', { type: 'application/json' });
    const input = screen.getByTestId('json-editor-file-input') as HTMLInputElement;
    await act(async () => {
      Object.defineProperty(input, 'files', { value: [file], configurable: true });
      fireEvent.change(input);
    });
    await waitFor(() =>
      expect(screen.getByTestId('json-editor-textarea')).toBeTruthy(),
    );
    expect(screen.queryByTestId('json-editor-message')).toBeNull();
  });

  it('清单 20 scenario 2: 不存在 → InfoBar 显示"文件不存在"', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'read_file') throw new Error('文件不存在 /home/u/.claude/nope.json: No such file or directory (os error 2)');
      if (cmd === 'write_file_atomic') return null;
      return null;
    });
    render(<JsonEditorPage />);
    await waitFor(() => screen.getByTestId('json-editor-file-input'));
    const file = new File([''], 'nope.json', { type: 'application/json' });
    const input = screen.getByTestId('json-editor-file-input') as HTMLInputElement;
    await act(async () => {
      Object.defineProperty(input, 'files', { value: [file], configurable: true });
      fireEvent.change(input);
    });
    await waitFor(() => {
      const msg = screen.getByTestId('json-editor-message');
      expect(msg.getAttribute('data-message-kind')).toBe('error');
      expect(msg.textContent).toContain('读取失败');
      expect(msg.textContent).toContain('文件不存在');
    });
  });

  it('清单 20 scenario 3: 权限拒绝 → InfoBar 显示"无权限"', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'read_file') throw new Error('无权限 /home/u/.claude/locked.json: Access is denied. (os error 5)');
      if (cmd === 'write_file_atomic') return null;
      return null;
    });
    render(<JsonEditorPage />);
    await waitFor(() => screen.getByTestId('json-editor-file-input'));
    const file = new File([''], 'locked.json', { type: 'application/json' });
    const input = screen.getByTestId('json-editor-file-input') as HTMLInputElement;
    await act(async () => {
      Object.defineProperty(input, 'files', { value: [file], configurable: true });
      fireEvent.change(input);
    });
    await waitFor(() => {
      const msg = screen.getByTestId('json-editor-message');
      expect(msg.textContent).toContain('无权限');
    });
  });

  it('清单 20 scenario 4: 编码错误 → InfoBar 显示"编码错误,请检查文件"', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'read_file') throw new Error('编码错误 /home/u/.claude/bom.json: stream did not contain valid UTF-8');
      if (cmd === 'write_file_atomic') return null;
      return null;
    });
    render(<JsonEditorPage />);
    await waitFor(() => screen.getByTestId('json-editor-file-input'));
    const file = new File([new Uint8Array([0xFF, 0xFE])], 'bom.json', { type: 'application/json' });
    const input = screen.getByTestId('json-editor-file-input') as HTMLInputElement;
    await act(async () => {
      Object.defineProperty(input, 'files', { value: [file], configurable: true });
      fireEvent.change(input);
    });
    await waitFor(() => {
      const msg = screen.getByTestId('json-editor-message');
      expect(msg.textContent).toContain('编码错误');
    });
  });

  // -----------------------------------------------------------------
  // M3.11 (A4#12) — F5 json-editor 侧边文件目录树集成测试
  // -----------------------------------------------------------------

  /**
   * 树测试的 mock:list_editable_jsons 返回固定的 entries,
   * 让断言稳定。读 / 写路径走真实 mock。
   */
  const TREE_ENTRIES = [
    {
      path: '/home/u/.claude/settings.json',
      relative_path: 'settings.json',
      scope: 'user',
      scope_label: '用户级',
      size: 100,
      last_modified: 1700000000,
    },
    {
      path: '/home/u/.claude/commands/a.json',
      relative_path: 'commands/a.json',
      scope: 'user',
      scope_label: '用户级',
      size: 50,
      last_modified: 1700000100,
    },
    {
      path: '/proj/.claude/agents/coder.json',
      relative_path: 'agents/coder.json',
      scope: 'project',
      scope_label: '项目级',
      size: 200,
      last_modified: 1700000300,
    },
  ];

  it('树集成:挂载时调 list_editable_jsons 并渲染文件树', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_editable_jsons') return TREE_ENTRIES;
      if (cmd === 'read_file') return SAMPLE_JSON;
      if (cmd === 'write_file_atomic') return null;
      return null;
    });

    render(<JsonEditorPage />);
    await waitFor(() => {
      expect(screen.getByTestId('json-file-tree')).toBeTruthy();
    });
    await waitFor(() => {
      const entries = screen.getAllByTestId('json-file-tree-entry');
      expect(entries.length).toBe(3);
    });
  });

  it('树集成:点击 tree entry 加载文件', async () => {
    mockInvoke.mockImplementation(async (cmd: string, args: unknown) => {
      if (cmd === 'list_editable_jsons') return TREE_ENTRIES;
      if (cmd === 'read_file') {
        // 根据 path 返回不同内容,方便断言。
        const path = (args as { path: string }).path;
        if (path.includes('settings.json')) return '{"k":"settings"}';
        if (path.includes('a.json')) return '{"k":"a"}';
        return '{}';
      }
      if (cmd === 'write_file_atomic') return null;
      return null;
    });

    render(<JsonEditorPage />);
    await waitFor(() => {
      expect(screen.getAllByTestId('json-file-tree-entry').length).toBe(3);
    });

    // 点 settings.json
    const entries = screen.getAllByTestId('json-file-tree-entry');
    const target = entries.find((e) => e.getAttribute('data-path') === '/home/u/.claude/settings.json')!;
    await act(async () => {
      fireEvent.click(target);
    });

    await waitFor(() => {
      // readFile 用了绝对路径而不是 bare name
      expect(mockInvoke).toHaveBeenCalledWith(
        'read_file',
        expect.objectContaining({ path: '/home/u/.claude/settings.json' }),
      );
    });
    // 选中态高亮
    await waitFor(() => {
      const selected = screen.getAllByTestId('json-file-tree-entry')
        .find((e) => e.getAttribute('data-selected') === 'true');
      expect(selected).toBeTruthy();
      expect(selected!.getAttribute('data-path')).toBe('/home/u/.claude/settings.json');
    });
  });

  it('树集成:list_editable_jsons 错误 → 显示错误 banner(不崩)', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_editable_jsons') throw new Error('扫描失败:权限拒绝');
      return null;
    });

    render(<JsonEditorPage />);
    await waitFor(() => {
      const banner = screen.getByTestId('json-file-tree-error');
      expect(banner).toBeTruthy();
      expect(banner.textContent).toContain('扫描失败');
    });
  });

  it('树集成:scope badge 显示在 toolbar 中', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_editable_jsons') return TREE_ENTRIES;
      if (cmd === 'read_file') return SAMPLE_JSON;
      if (cmd === 'write_file_atomic') return null;
      return null;
    });

    render(<JsonEditorPage />);
    await waitFor(() => screen.getByTestId('json-file-tree'));

    // 没加载文件 → 没 badge
    expect(screen.queryByTestId('json-editor-scope-badge')).toBeNull();

    // 加载文件 → badge 出现,scope=user
    const entries = screen.getAllByTestId('json-file-tree-entry');
    const target = entries.find((e) => e.getAttribute('data-path') === '/home/u/.claude/settings.json')!;
    await act(async () => {
      fireEvent.click(target);
    });
    await waitFor(() => {
      const badge = screen.getByTestId('json-editor-scope-badge');
      expect(badge.getAttribute('data-scope')).toBe('user');
      expect(badge.textContent).toContain('用户级');
    });

    // 切到 project scope 的文件
    const projEntry = entries.find((e) => e.getAttribute('data-path') === '/proj/.claude/agents/coder.json')!;
    await act(async () => {
      fireEvent.click(projEntry);
    });
    await waitFor(() => {
      const badge = screen.getByTestId('json-editor-scope-badge');
      expect(badge.getAttribute('data-scope')).toBe('project');
      expect(badge.textContent).toContain('项目级');
    });
  });
});

// ---------------------------------------------------------------------------
// M5 bug #9 — fullscreen toggle (parity with backup-restore F19)
// ---------------------------------------------------------------------------

describe('JsonEditorPage — M5 bug #9 fullscreen', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it('renders the fullscreen toggle button', async () => {
    render(<JsonEditorPage />);
    expect(
      screen.getByTestId('json-editor-fullscreen-toggle'),
    ).toBeInTheDocument();
  });

  it('clicking the toggle opens the fullscreen overlay', async () => {
    render(<JsonEditorPage />);
    const btn = screen.getByTestId('json-editor-fullscreen-toggle');
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(btn);
    await waitFor(() => {
      expect(
        screen.getByTestId('json-editor-fullscreen-overlay'),
      ).toBeInTheDocument();
    });
    expect(btn.getAttribute('aria-pressed')).toBe('true');
  });

  it('exit button closes the overlay', async () => {
    render(<JsonEditorPage />);
    fireEvent.click(screen.getByTestId('json-editor-fullscreen-toggle'));
    await waitFor(() => {
      expect(
        screen.getByTestId('json-editor-fullscreen-overlay'),
      ).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('json-editor-fullscreen-exit'));
    await waitFor(() => {
      expect(
        screen.queryByTestId('json-editor-fullscreen-overlay'),
      ).not.toBeInTheDocument();
    });
  });
});