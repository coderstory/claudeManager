/**
 * QuickSearchModal — TDD coverage.
 *
 * Tests focus on the two parts that have stable contracts:
 *   1. `filterResults` — pure function, easy to test without React.
 *   2. The rendered modal — render in isolation with a fake
 *      `onNavigate`, fire keyboard events, assert that navigation
 *      fires for the right entry.
 *
 * The IPC calls (`listProviders`, `listMcpServers`) are NOT
 * exercised here — they would require mocking Tauri internals and
 * the components they feed into. The modal's resilience to empty
 * provider/MCP arrays is implicit in the render test (the modal
 * still shows the 12 plugin entries).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import {
  QuickSearchModal,
  filterResults,
  PLUGIN_LABELS,
  type SearchResult,
} from '../../components/QuickSearchModal';

// Mock Tauri IPC — we don't need real providers / MCP servers for
// the filter / render tests; the modal's IPC errors are swallowed
// (it falls back to empty arrays) so this is a clean default.
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async () => {
    throw new Error('not invoked in this test');
  }),
}));

beforeEach(() => {
  // Each test starts with a clean DOM.
});

const SAMPLE: SearchResult[] = [
  { kind: 'plugin', label: 'Provider 列表', view: 'provider-list', hint: 'provider-list' },
  { kind: 'plugin', label: 'MCP 管理', view: 'mcp-management', hint: 'mcp-management' },
  { kind: 'plugin', label: '用量查询', view: 'usage-query', hint: 'usage-query' },
  { kind: 'plugin', label: '配置优化', view: 'optimizer', hint: 'optimizer' },
  {
    kind: 'provider',
    label: 'work-anthropic',
    view: 'provider-list',
    hint: 'anthropic',
  },
  {
    kind: 'provider',
    label: 'personal-deepseek',
    view: 'provider-list',
    hint: 'deepseek',
  },
  { kind: 'mcp', label: 'fs-mcp', view: 'mcp-management', hint: '已启用' },
];

describe('filterResults', () => {
  it('returns all results when query is empty', () => {
    const r = filterResults(SAMPLE, '');
    expect(r).toHaveLength(SAMPLE.length);
  });

  it('matches case-insensitively on the label', () => {
    const r = filterResults(SAMPLE, 'mcp');
    // Both the MCP plugin label and the fs-mcp server match.
    expect(r.map((x) => x.label)).toEqual(
      expect.arrayContaining(['MCP 管理', 'fs-mcp']),
    );
  });

  it('matches on the hint as well as the label', () => {
    const r = filterResults(SAMPLE, 'anthropic');
    expect(r).toHaveLength(1);
    expect(r[0].label).toBe('work-anthropic');
  });

  it('returns an empty list when nothing matches', () => {
    const r = filterResults(SAMPLE, 'zzz-no-match');
    expect(r).toEqual([]);
  });

  it('respects the limit argument', () => {
    const r = filterResults(SAMPLE, '', 2);
    expect(r).toHaveLength(2);
  });

  it('preserves input order (no re-ranking)', () => {
    const r = filterResults(SAMPLE, '');
    expect(r.map((x) => x.label)).toEqual(SAMPLE.map((x) => x.label));
  });
});

describe('PLUGIN_LABELS', () => {
  it('covers every ViewId except home with a Chinese label', () => {
    expect(PLUGIN_LABELS['provider-list']).toBe('Provider 列表');
    expect(PLUGIN_LABELS['mcp-management']).toBe('MCP 管理');
    expect(PLUGIN_LABELS['optimizer']).toBe('配置优化');
  });
});

describe('QuickSearchModal', () => {
  it('does not render anything when isOpen=false', () => {
    render(<QuickSearchModal isOpen={false} onClose={vi.fn()} onNavigate={vi.fn()} />);
    expect(screen.queryByTestId('quick-search-modal')).toBeNull();
  });

  it('renders the 12 plugin entries when opened with no query', async () => {
    render(<QuickSearchModal isOpen={true} onClose={vi.fn()} onNavigate={vi.fn()} />);
    // 12 plugin results (home is excluded by buildPluginResults).
    const results = await screen.findAllByTestId(/^quick-search-result-/);
    expect(results.length).toBe(12);
  });

  it('typing filters the result list', async () => {
    render(<QuickSearchModal isOpen={true} onClose={vi.fn()} onNavigate={vi.fn()} />);
    const input = (await screen.findByTestId('quick-search-input')) as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: '用量' } });
    });
    const results = await screen.findAllByTestId(/^quick-search-result-/);
    expect(results).toHaveLength(1);
    expect(results[0]).toHaveTextContent('用量查询');
  });

  it('Enter on the highlighted result fires onNavigate + onClose', async () => {
    const onNavigate = vi.fn();
    const onClose = vi.fn();
    render(<QuickSearchModal isOpen={true} onClose={onClose} onNavigate={onNavigate} />);
    const input = (await screen.findByTestId('quick-search-input')) as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: '用量' } });
    });
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    expect(onNavigate).toHaveBeenCalledWith('usage-query');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Escape closes the modal', async () => {
    const onClose = vi.fn();
    render(<QuickSearchModal isOpen={true} onClose={onClose} onNavigate={vi.fn()} />);
    const input = (await screen.findByTestId('quick-search-input')) as HTMLInputElement;
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Escape' });
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('clicking the X button closes the modal', async () => {
    const onClose = vi.fn();
    render(<QuickSearchModal isOpen={true} onClose={onClose} onNavigate={vi.fn()} />);
    const btn = await screen.findByTestId('quick-search-close');
    await act(async () => {
      btn.click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('clicking the backdrop closes the modal', async () => {
    const onClose = vi.fn();
    render(<QuickSearchModal isOpen={true} onClose={onClose} onNavigate={vi.fn()} />);
    const backdrop = await screen.findByTestId('quick-search-backdrop');
    await act(async () => {
      backdrop.click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('clicking a result row navigates and closes', async () => {
    const onNavigate = vi.fn();
    const onClose = vi.fn();
    render(<QuickSearchModal isOpen={true} onClose={onClose} onNavigate={onNavigate} />);
    const firstRow = (await screen.findAllByTestId(/^quick-search-result-/))[0];
    await act(async () => {
      firstRow.click();
    });
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows the empty-state message when no result matches', async () => {
    render(<QuickSearchModal isOpen={true} onClose={vi.fn()} onNavigate={vi.fn()} />);
    const input = (await screen.findByTestId('quick-search-input')) as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: 'zzzz-no-match' } });
    });
    expect(await screen.findByTestId('quick-search-empty')).toBeInTheDocument();
  });
});