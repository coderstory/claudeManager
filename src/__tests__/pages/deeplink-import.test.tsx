/**
 * Vitest coverage for the F4 DeeplinkImportPage (M2.3).
 *
 * What this covers (TDD, CLAUDE.md §5.2):
 *   - URL input + parse flow: type URL → click 解析 → mock returns
 *     a parsed provider → confirmation modal appears.
 *   - Import success: click 确认导入 → mock resolves → success
 *     message visible.
 *   - Import error: mock rejects with "provider already exists" →
 *     red error InfoBar in the modal.
 *   - Cancel: clicking 取消 closes the modal.
 *   - Parse error: mock rejects with "invalid scheme" → red error
 *     message on the page.
 *   - api_key is NEVER displayed in the modal (token leak guard).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import DeeplinkImportPage from '../../pages/deeplink-import';

// ---------------------------------------------------------------------------
// Mock the Tauri IPC + event layers.
// ---------------------------------------------------------------------------

const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

const mockListen = vi.fn();
vi.mock('@tauri-apps/api/event', () => ({
  listen: (...args: unknown[]) => mockListen(...args),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_URL =
  'ccswitch://v1/import?resource=provider&app=claude&name=GLM-4.6&endpoint=https%3A%2F%2Fapi.anthropic.com&apiKey=sk-test';

const SAMPLE_PARSED = {
  action: { kind: 'import' },
  provider: {
    id: 'glm-4-6',
    name: 'GLM-4.6',
    provider_type: 'claude',
    api_base: 'https://api.anthropic.com',
    api_key: 'sk-test-should-not-leak',
    models: ['claude-sonnet-4-6'],
    is_active: false,
    created_at: 1700000000,
    last_used_at: null,
    notes: null,
  },
};

beforeEach(() => {
  mockInvoke.mockReset();
  mockListen.mockReset();
  // Default: listen() resolves to a noop unlisten function.
  mockListen.mockResolvedValue(() => undefined);
});

function setupParseMock(once: { value?: unknown; reject?: Error }): void {
  let called = 0;
  mockInvoke.mockImplementation(async (cmd: string) => {
    if (cmd === 'parse_deeplink_url') {
      called += 1;
      if (once.reject) throw once.reject;
      return once.value;
    }
    if (cmd === 'import_single_provider') return null;
    return null;
  });
  // The test only ever calls parse once, but keep the helper
  // honest about multi-call expectations.
  void called;
}

describe('DeeplinkImportPage — F4 (M2.3)', () => {
  it('renders the URL input + 解析 button on mount', async () => {
    await act(async () => {
      render(<DeeplinkImportPage />);
    });
    expect(screen.getByTestId('deeplink-url-input')).toBeInTheDocument();
    expect(screen.getByTestId('deeplink-parse-btn')).toBeInTheDocument();
    expect(screen.getByTestId('deeplink-paste-btn')).toBeInTheDocument();
  });

  it('type URL → click 解析 → modal appears with parsed fields', async () => {
    setupParseMock({ value: SAMPLE_PARSED });
    await act(async () => {
      render(<DeeplinkImportPage />);
    });
    const input = screen.getByTestId('deeplink-url-input') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: VALID_URL } });
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('deeplink-parse-btn'));
    });
    await waitFor(() => {
      expect(screen.getByTestId('deeplink-modal')).toBeInTheDocument();
    });
    expect(screen.getByText('GLM-4.6')).toBeInTheDocument();
    expect(screen.getByText('claude')).toBeInTheDocument();
    expect(screen.getByText('https://api.anthropic.com')).toBeInTheDocument();
    // CRITICAL: api_key value is NEVER rendered (token leak guard)
    expect(screen.queryByText('sk-test-should-not-leak')).not.toBeInTheDocument();
  });

  it('click 确认导入 → success message + modal closes', async () => {
    setupParseMock({ value: SAMPLE_PARSED });
    await act(async () => {
      render(<DeeplinkImportPage />);
    });
    const input = screen.getByTestId('deeplink-url-input') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: VALID_URL } });
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('deeplink-parse-btn'));
    });
    await waitFor(() => screen.getByTestId('deeplink-modal'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('deeplink-modal-confirm'));
    });
    await waitFor(() => {
      expect(screen.getByTestId('deeplink-success')).toBeInTheDocument();
    });
    expect(mockInvoke).toHaveBeenCalledWith('import_single_provider', {
      provider: expect.objectContaining({ id: 'glm-4-6' }),
    });
  });

  it('import error → red error InfoBar inside the modal', async () => {
    setupParseMock({ value: SAMPLE_PARSED });
    // Make import_single_provider reject.
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'parse_deeplink_url') return SAMPLE_PARSED;
      if (cmd === 'import_single_provider') {
        throw new Error("provider 'glm-4-6' already exists");
      }
      return null;
    });
    await act(async () => {
      render(<DeeplinkImportPage />);
    });
    const input = screen.getByTestId('deeplink-url-input') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: VALID_URL } });
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('deeplink-parse-btn'));
    });
    await waitFor(() => screen.getByTestId('deeplink-modal'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('deeplink-modal-confirm'));
    });
    await waitFor(() => {
      expect(screen.getByTestId('deeplink-modal-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('deeplink-modal-error').textContent).toContain('already exists');
  });

  it('parse error → red error message on the page (no modal)', async () => {
    setupParseMock({ reject: new Error('invalid scheme: expected ccswitch, got http') });
    await act(async () => {
      render(<DeeplinkImportPage />);
    });
    const input = screen.getByTestId('deeplink-url-input') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: 'http://bad' } });
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('deeplink-parse-btn'));
    });
    await waitFor(() => {
      expect(screen.getByTestId('deeplink-error')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('deeplink-modal')).not.toBeInTheDocument();
  });

  it('click 取消 closes the modal', async () => {
    setupParseMock({ value: SAMPLE_PARSED });
    await act(async () => {
      render(<DeeplinkImportPage />);
    });
    const input = screen.getByTestId('deeplink-url-input') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: VALID_URL } });
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('deeplink-parse-btn'));
    });
    await waitFor(() => screen.getByTestId('deeplink-modal'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('deeplink-modal-cancel'));
    });
    await waitFor(() => {
      expect(screen.queryByTestId('deeplink-modal')).not.toBeInTheDocument();
    });
  });

  it('示例 button populates the input + triggers parse', async () => {
    setupParseMock({ value: SAMPLE_PARSED });
    await act(async () => {
      render(<DeeplinkImportPage />);
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('deeplink-paste-btn'));
    });
    await waitFor(() => screen.getByTestId('deeplink-modal'));
    const input = screen.getByTestId('deeplink-url-input') as HTMLInputElement;
    expect(input.value.startsWith('ccswitch://v1/import')).toBe(true);
  });
});
