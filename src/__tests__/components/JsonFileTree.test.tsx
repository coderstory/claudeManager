/**
 * JsonFileTree — vitest coverage (M3.11 / A4#12).
 *
 * What this covers (TDD, CLAUDE.md §5.2):
 *   1. 渲染 scope group header + 全部 entries
 *   2. 点击 file 触发 onSelect
 *   3. 选中态高亮(data-selected)
 *   4. search box 过滤(大小写不敏感)
 *   5. 空数据 / loading / error 三态
 *
 * 写法参考 QuickSearchModal.test.tsx / ErrorBanner.test.tsx:
 * - 不 mock lucide-react,直接渲染
 * - 用 fireEvent 触发按钮点击
 * - 不依赖 jsdom window.confirm(本组件不弹 dialog)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { JsonFileTree } from '../../components/JsonFileTree';
import type { JsonFileEntry } from '../../types/json';

const sampleEntries: JsonFileEntry[] = [
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
    path: '/proj/.claude/settings.json',
    relative_path: 'settings.json',
    scope: 'project',
    scope_label: '项目级',
    size: 80,
    last_modified: 1700000200,
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

describe('JsonFileTree — F5 (M3.11 / A4#12)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders scope groups + all entries', () => {
    render(<JsonFileTree entries={sampleEntries} selectedPath={null} onSelect={() => {}} />);

    // 两个 scope 头
    expect(screen.getByTestId('json-file-tree-scope-user')).toBeTruthy();
    expect(screen.getByTestId('json-file-tree-scope-project')).toBeTruthy();

    // 4 个 file entry
    const entries = screen.getAllByTestId('json-file-tree-entry');
    expect(entries.length).toBe(4);

    // entry 的 data-path 正确
    const paths = entries.map((e) => e.getAttribute('data-path'));
    expect(paths).toContain('/home/u/.claude/settings.json');
    expect(paths).toContain('/proj/.claude/agents/coder.json');
  });

  it('clicking a file entry calls onSelect with the entry', () => {
    const onSelect = vi.fn();
    render(<JsonFileTree entries={sampleEntries} selectedPath={null} onSelect={onSelect} />);

    const entries = screen.getAllByTestId('json-file-tree-entry');
    // 点 commands/a.json
    const target = entries.find((e) => e.getAttribute('data-path') === '/home/u/.claude/commands/a.json')!;
    fireEvent.click(target);

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/home/u/.claude/commands/a.json' }),
    );
  });

  it('marks the selected file with data-selected="true"', () => {
    render(
      <JsonFileTree
        entries={sampleEntries}
        selectedPath="/home/u/.claude/settings.json"
        onSelect={() => {}}
      />,
    );

    const entries = screen.getAllByTestId('json-file-tree-entry');
    const selectedCount = entries.filter((e) => e.getAttribute('data-selected') === 'true').length;
    expect(selectedCount).toBe(1);

    const selected = entries.find((e) => e.getAttribute('data-selected') === 'true')!;
    expect(selected.getAttribute('data-path')).toBe('/home/u/.claude/settings.json');
  });

  it('search box filters entries (case-insensitive)', () => {
    render(<JsonFileTree entries={sampleEntries} selectedPath={null} onSelect={() => {}} />);
    expect(screen.getAllByTestId('json-file-tree-entry').length).toBe(4);

    const search = screen.getByTestId('json-file-tree-search') as HTMLInputElement;
    fireEvent.change(search, { target: { value: 'CODER' } });

    // 只剩 agents/coder.json 一条
    const filtered = screen.getAllByTestId('json-file-tree-entry');
    expect(filtered.length).toBe(1);
    expect(filtered[0].getAttribute('data-path')).toBe('/proj/.claude/agents/coder.json');
  });

  // M5 #33 — user report: "JSON 编辑器列表里怎么搜索不到 settings.json"
  // Filter is case-insensitive on `relative_path`. With two
  // settings.json entries (one user-scope, one project-scope),
  // searching "settings" must surface both rows.
  it('search "settings" surfaces BOTH user + project scope settings.json', () => {
    render(
      <JsonFileTree
        entries={sampleEntries}
        selectedPath={null}
        onSelect={() => {}}
      />,
    );
    const search = screen.getByTestId('json-file-tree-search') as HTMLInputElement;
    fireEvent.change(search, { target: { value: 'settings' } });

    const filtered = screen.getAllByTestId('json-file-tree-entry');
    expect(filtered.length).toBe(2);
    const paths = filtered.map((e) => e.getAttribute('data-path')).sort();
    expect(paths).toEqual([
      '/home/u/.claude/settings.json',
      '/proj/.claude/settings.json',
    ]);
  });

  it('clearing the search restores all entries', () => {
    render(<JsonFileTree entries={sampleEntries} selectedPath={null} onSelect={() => {}} />);
    const search = screen.getByTestId('json-file-tree-search') as HTMLInputElement;
    // Pick a query that yields ≥1 row but <4 so the post-clear jump is
    // observable. M5 #33 broadened the filter to absolute path +
    // basename, so picking a literal substring of one entry's path
    // (and not the others') is necessary.
    fireEvent.change(search, { target: { value: 'agents' } });
    const filteredCount = screen.getAllByTestId('json-file-tree-entry').length;
    expect(filteredCount).toBeGreaterThan(0);
    expect(filteredCount).toBeLessThan(4);

    fireEvent.change(search, { target: { value: '' } });
    expect(screen.getAllByTestId('json-file-tree-entry').length).toBe(4);
  });

  it('shows empty state when no entries', () => {
    render(<JsonFileTree entries={[]} selectedPath={null} onSelect={() => {}} />);
    expect(screen.getByTestId('json-file-tree-empty')).toBeTruthy();
    expect(screen.getByTestId('json-file-tree-empty').textContent).toContain('范围内没有可编辑');
  });

  it('shows "扫描中" when loading and no entries yet', () => {
    render(
      <JsonFileTree
        entries={[]}
        selectedPath={null}
        onSelect={() => {}}
        loading={true}
      />,
    );
    expect(screen.getByTestId('json-file-tree-loading')).toBeTruthy();
  });

  it('shows error banner when errorMessage is set', () => {
    render(
      <JsonFileTree
        entries={[]}
        selectedPath={null}
        onSelect={() => {}}
        errorMessage="扫描失败:权限拒绝"
      />,
    );
    const banner = screen.getByTestId('json-file-tree-error');
    expect(banner).toBeTruthy();
    expect(banner.textContent).toContain('扫描失败');
  });

  it('refresh button calls onRefresh', () => {
    const onRefresh = vi.fn();
    render(
      <JsonFileTree
        entries={sampleEntries}
        selectedPath={null}
        onSelect={() => {}}
        onRefresh={onRefresh}
      />,
    );
    fireEvent.click(screen.getByTestId('json-file-tree-refresh'));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('toggles scope collapse when clicking scope header', () => {
    render(<JsonFileTree entries={sampleEntries} selectedPath={null} onSelect={() => {}} />);
    // 初始 4 个 entry
    expect(screen.getAllByTestId('json-file-tree-entry').length).toBe(4);

    // 折叠 user scope
    const userHeader = screen.getByTestId('json-file-tree-scope-user');
    fireEvent.click(userHeader);

    // user 下 2 个 entry 隐藏
    const remaining = screen.getAllByTestId('json-file-tree-entry');
    expect(remaining.length).toBe(2);
    const paths = remaining.map((e) => e.getAttribute('data-path'));
    expect(paths).not.toContain('/home/u/.claude/settings.json');
    expect(paths).not.toContain('/home/u/.claude/commands/a.json');

    // 再点 → 恢复
    fireEvent.click(userHeader);
    expect(screen.getAllByTestId('json-file-tree-entry').length).toBe(4);
  });

  it('footer shows total count', () => {
    render(<JsonFileTree entries={sampleEntries} selectedPath={null} onSelect={() => {}} />);
    const footer = screen.getByTestId('json-file-tree-footer');
    expect(footer.textContent).toContain('共 4 个文件');
  });
});

// ---------------------------------------------------------------------------
// M5 bug #10 — folder header rows for nested relative paths
// ---------------------------------------------------------------------------

describe('JsonFileTree — M5 bug #10 folder headers', () => {
  const nested: JsonFileEntry[] = [
    {
      path: '/x/settings.json',
      relative_path: 'settings.json',
      scope: 'user',
      scope_label: '用户级',
      size: 1,
      last_modified: 1,
    },
    {
      path: '/x/commands/a.json',
      relative_path: 'commands/a.json',
      scope: 'user',
      scope_label: '用户级',
      size: 1,
      last_modified: 1,
    },
    {
      path: '/x/commands/sub/b.json',
      relative_path: 'commands/sub/b.json',
      scope: 'user',
      scope_label: '用户级',
      size: 1,
      last_modified: 1,
    },
  ];

  it('emits one folder row per intermediate directory', () => {
    render(<JsonFileTree entries={nested} selectedPath={null} onSelect={() => {}} />);
    const folders = screen.getAllByTestId('json-file-tree-folder');
    // 期望:`commands`(由 commands/a.json 引入),
    //       `commands/sub`(由 commands/sub/b.json 引入)。
    expect(folders.length).toBe(2);
    expect(folders[0].getAttribute('data-folder-path')).toBe('commands');
    expect(folders[1].getAttribute('data-folder-path')).toBe('commands/sub');
  });

  it('does not duplicate folder rows for siblings in the same directory', () => {
    const siblings: JsonFileEntry[] = [
      {
        path: '/x/commands/a.json',
        relative_path: 'commands/a.json',
        scope: 'user',
        scope_label: '用户级',
        size: 1,
        last_modified: 1,
      },
      {
        path: '/x/commands/b.json',
        relative_path: 'commands/b.json',
        scope: 'user',
        scope_label: '用户级',
        size: 1,
        last_modified: 1,
      },
    ];
    render(<JsonFileTree entries={siblings} selectedPath={null} onSelect={() => {}} />);
    const folders = screen.getAllByTestId('json-file-tree-folder');
    expect(folders.length).toBe(1);
    expect(folders[0].getAttribute('data-folder-path')).toBe('commands');
  });

  it('files at root scope have no folder rows above them', () => {
    const rootOnly: JsonFileEntry[] = [
      {
        path: '/x/settings.json',
        relative_path: 'settings.json',
        scope: 'user',
        scope_label: '用户级',
        size: 1,
        last_modified: 1,
      },
    ];
    render(<JsonFileTree entries={rootOnly} selectedPath={null} onSelect={() => {}} />);
    expect(screen.queryAllByTestId('json-file-tree-folder').length).toBe(0);
  });
});
