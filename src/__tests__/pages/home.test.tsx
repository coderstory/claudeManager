/**
 * Vitest coverage for the M3.10 HomeView + M3.13.4 project picker.
 *
 * Covers (TDD, CLAUDE.md §5.2):
 *   1. Add form is hidden until the toggle button is clicked.
 *   2. Add form exposes a [浏览…] button beside the root input.
 *   3. Clicking [浏览…] fills the root input with the picked dir name.
 *   4. onBlur on the root input triggers frontend path validation
 *      and shows the validation hint.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { HomeView } from '../../pages/home';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

beforeEach(() => {
  mockInvoke.mockReset();
  // Default: list_projects returns an empty list, current_project_id null.
  mockInvoke.mockImplementation(async (cmd: string) => {
    if (cmd === 'list_projects') {
      return { projects: [], current_project_id: null, file: { version: 1, current_project_id: null, projects: [] } };
    }
    return null;
  });
});

describe('HomeView — M3.10 + M3.13.4 project picker', () => {
  it('add form is hidden until the toggle button is clicked', () => {
    render(<HomeView />);
    expect(screen.queryByTestId('add-project-form')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('add-project-toggle'));
    expect(screen.getByTestId('add-project-form')).toBeInTheDocument();
  });

  it('exposes a [浏览…] button beside the root path input', () => {
    render(<HomeView />);
    fireEvent.click(screen.getByTestId('add-project-toggle'));
    expect(screen.getByTestId('pick-root-button')).toBeInTheDocument();
    expect(screen.getByTestId('new-project-root')).toBeInTheDocument();
  });

  it('clicking [浏览…] fills the input with selected dir name', async () => {
    render(<HomeView />);
    fireEvent.click(screen.getByTestId('add-project-toggle'));

    // Simulate a directory selection via the hidden file input.
    const fileInput = screen.getByTestId('pick-root-input') as HTMLInputElement;
    const file = new File([''], 'foo', { type: '' });
    Object.defineProperty(file, 'webkitRelativePath', { value: 'foo/bar' });
    Object.defineProperty(fileInput, 'files', { value: [file] });
    fireEvent.change(fileInput);

    await waitFor(() => {
      const rootInput = screen.getByTestId('new-project-root') as HTMLInputElement;
      expect(rootInput.value).toContain('foo');
    });
  });

  it('onBlur on the root input shows validation hint for invalid path', async () => {
    render(<HomeView />);
    fireEvent.click(screen.getByTestId('add-project-toggle'));
    const rootInput = screen.getByTestId('new-project-root') as HTMLInputElement;
    fireEvent.change(rootInput, { target: { value: 'bad' } });
    fireEvent.blur(rootInput);

    await waitFor(() => {
      expect(screen.getByTestId('path-validation-hint')).toHaveTextContent('必须是绝对路径');
    });
  });

  // M5 #3 — 新增项目 must render as a modal dialog (Esc + overlay
  // dismiss). The form should NOT be in the DOM before the toggle is
  // clicked.
  it('add project renders inside a modal overlay (Esc closes it)', () => {
    render(<HomeView />);
    expect(screen.queryByTestId('add-project-modal-overlay')).toBeNull();
    fireEvent.click(screen.getByTestId('add-project-toggle'));
    const overlay = screen.getByTestId('add-project-modal-overlay');
    expect(overlay).toBeInTheDocument();
    expect(overlay.getAttribute('role')).toBe('dialog');
    expect(overlay.getAttribute('aria-modal')).toBe('true');
    // Press Escape inside the form — closes the modal.
    fireEvent.keyDown(screen.getByTestId('add-project-form'), { key: 'Escape' });
    expect(screen.queryByTestId('add-project-modal-overlay')).toBeNull();
  });
});