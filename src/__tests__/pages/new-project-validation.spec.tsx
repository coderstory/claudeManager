/**
 * Vitest coverage for A3 — "新建项目 must be an absolute path" bug fix
 * verification (commit `db74286`).
 *
 * Bug: 新建项目输入相对路径 (如 `winui3` / `./relative`) 提交后,
 * Rust 端 `validate_root` 抛 `NotAbsolute("must be an absolute path: ...")`。
 *
 * Fix under verification (commit `db74286`): 把 HTML5 `<input webkitdirectory>`
 * 换成 `pickProjectRoot()` (Tauri native dialog) 拿绝对路径, 并调用
 * `validateProjectPath()` 做前端拦截。
 *
 * Per CLAUDE.md §16 第 5 步, 这些测试必须:
 *   1. 改前 FAIL (验证 commit db74286 是否真解决问题)
 *   2. 改后 PASS (留 codebase 做回归保护)
 *
 * 三个核心场景:
 *   - A3.1: 选目录 (pickProjectRoot) → 拿到绝对路径 → input 填好 + 验证通过
 *   - A3.2: 手输相对路径 (winui3 / ./relative) → onBlur 触发红字提示
 *   - A3.3: 手输绝对路径 (Unix / Win) → 通过前端预检
 *   - A3.4 (额外): 手输相对路径时, 添加按钮应 disabled (拦截在 UI 层)
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
  // Default: list_projects returns an empty list.
  mockInvoke.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
    if (cmd === 'list_projects') {
      return {
        projects: [],
        current_project_id: null,
        file: { version: 1, current_project_id: null, projects: [] },
      };
    }
    if (cmd === 'pick_project_root_dir') {
      return '/Users/test/projects/foo';
    }
    if (cmd === 'validate_project_path') {
      const path = String(args?.path ?? '');
      // Mock Rust-side: path must be absolute AND end with .claude/
      const isAbsolute = path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path);
      const hasClaude = path.endsWith('.claude') || path.includes('/.claude');
      if (!isAbsolute) {
        return {
          path,
          valid: false,
          reason_code: 'not_absolute',
          reason: '必须是绝对路径',
        };
      }
      if (!hasClaude) {
        return {
          path,
          valid: false,
          reason_code: 'missing_claude_subdir',
          reason: '缺少 .claude/ 子目录',
        };
      }
      return { path, valid: true, reason_code: '', reason: '' };
    }
    if (cmd === 'add_project') {
      return {
        id: 'p1',
        name: String(args?.name ?? ''),
        root_dir: String(args?.root_dir ?? ''),
        created_at: 1_700_000_000,
        is_system: false,
      };
    }
    return null;
  });
});

describe('A3 — 新建项目路径验证 (commit db74286)', () => {
  // ---------------------------------------------------------------
  // A3.1: 选目录 (Tauri native dialog) → 拿到绝对路径
  // ---------------------------------------------------------------
  it('A3.1: 点选 [浏览…] → 调 pickProjectRoot → input 填入绝对路径 + 通过验证', async () => {
    render(<HomeView />);
    fireEvent.click(screen.getByTestId('add-project-toggle'));

    // 点 [浏览…] → 触发 pickProjectRoot → mock 返回 '/Users/test/projects/foo'
    fireEvent.click(screen.getByTestId('pick-root-button'));

    // 等 pick_project_root_dir 调完 + setState
    await waitFor(() => {
      const rootInput = screen.getByTestId('new-project-root') as HTMLInputElement;
      expect(rootInput.value).toBe('/Users/test/projects/foo');
    });

    // 自动触发 handleValidateRoot → mock 返回 not_absolute=OK (因为绝对) +
    // missing_claude_subdir (因为 mock 不带 /。这里放走, 因为前端预检就是
    // 看是否绝对路径, 红字显示属于提示不是阻止; 我们要测的是 input 值
    // 正确 + 自动填了 name)。
    const nameInput = screen.getByTestId('new-project-name') as HTMLInputElement;
    expect(nameInput.value).toBe('foo'); // A7 auto-fill from last path segment
  });

  // ---------------------------------------------------------------
  // A3.2: 手输相对路径 → onBlur 触发前端预检 → 红字 "必须是绝对路径"
  // ---------------------------------------------------------------
  it('A3.2: 手输相对路径 (winui3) → onBlur 触发红字 "必须是绝对路径"', async () => {
    render(<HomeView />);
    fireEvent.click(screen.getByTestId('add-project-toggle'));

    const rootInput = screen.getByTestId('new-project-root') as HTMLInputElement;
    fireEvent.change(rootInput, { target: { value: 'winui3' } });
    fireEvent.blur(rootInput);

    await waitFor(() => {
      const hint = screen.getByTestId('path-validation-hint');
      expect(hint).toHaveTextContent('必须是绝对路径');
    });
  });

  it('A3.2b: 手输 ./relative 相对路径 → 同样触发红字', async () => {
    render(<HomeView />);
    fireEvent.click(screen.getByTestId('add-project-toggle'));

    const rootInput = screen.getByTestId('new-project-root') as HTMLInputElement;
    fireEvent.change(rootInput, { target: { value: './relative' } });
    fireEvent.blur(rootInput);

    await waitFor(() => {
      expect(screen.getByTestId('path-validation-hint')).toHaveTextContent(
        '必须是绝对路径',
      );
    });
  });

  // ---------------------------------------------------------------
  // A3.3: 手输绝对路径 → 前端预检通过 → 调 Rust validateProjectPath
  // ---------------------------------------------------------------
  it('A3.3: 手输 Unix 绝对路径 /Users/x → 通过前端预检 + 调 Rust 验证', async () => {
    render(<HomeView />);
    fireEvent.click(screen.getByTestId('add-project-toggle'));

    const rootInput = screen.getByTestId('new-project-root') as HTMLInputElement;
    fireEvent.change(rootInput, { target: { value: '/Users/x/projects/foo' } });
    fireEvent.blur(rootInput);

    // 前端预检 OK (绝对路径) → 调 Rust validate_project_path → mock 返回 valid: false (因为无 .claude)
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith(
        'validate_project_path',
        expect.objectContaining({ path: '/Users/x/projects/foo' }),
      );
    });

    // 由于 mock 返回 missing_claude_subdir, 红字应为 "缺少 .claude/ 子目录"
    await waitFor(() => {
      expect(screen.getByTestId('path-validation-hint')).toHaveTextContent(
        '缺少 .claude/ 子目录',
      );
    });
  });

  it('A3.3b: 手输 Windows 绝对路径 D:\\projects\\foo → 通过前端预检', async () => {
    render(<HomeView />);
    fireEvent.click(screen.getByTestId('add-project-toggle'));

    const rootInput = screen.getByTestId('new-project-root') as HTMLInputElement;
    fireEvent.change(rootInput, { target: { value: 'D:\\projects\\foo' } });
    fireEvent.blur(rootInput);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith(
        'validate_project_path',
        expect.objectContaining({ path: 'D:\\projects\\foo' }),
      );
    });
  });

  // ---------------------------------------------------------------
  // A3.4 (反事故): 手输相对路径时, 添加按钮应 disabled — 不让用户绕过前端验证
  // 这是 §16 强调的 "root cause 真因修复", 不能只显示红字就算了。
  // 当前实现: handleAdd 不检查 pathValidation, 只看 newRoot.trim(), 所以
  // 改前 FAIL, 改后 PASS。
  // ---------------------------------------------------------------
  it('A3.4: 手输相对路径 + 触发红字后 → [添加] 按钮应 disabled (不能绕过前端验证)', async () => {
    render(<HomeView />);
    fireEvent.click(screen.getByTestId('add-project-toggle'));

    // 输 name
    const nameInput = screen.getByTestId('new-project-name') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'myproject' } });

    // 输相对路径 + blur
    const rootInput = screen.getByTestId('new-project-root') as HTMLInputElement;
    fireEvent.change(rootInput, { target: { value: 'winui3' } });
    fireEvent.blur(rootInput);

    // 等红字出现
    await waitFor(() => {
      expect(screen.getByTestId('path-validation-hint')).toHaveTextContent(
        '必须是绝对路径',
      );
    });

    // 关键断言: 添加按钮应 disabled
    const submitBtn = screen.getByTestId('confirm-add-project') as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(true);
  });

  // ---------------------------------------------------------------
  // A3.5 (回归保护): 路径有效 (绝对 + 有 .claude/) → 添加按钮 enabled
  // ---------------------------------------------------------------
  it('A3.5: 路径有效 → [添加] 按钮 enabled + 点添加调 add_project', async () => {
    // 这次 mock 让 validate_project_path 返回 valid: true
    mockInvoke.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === 'list_projects') {
        return {
          projects: [],
          current_project_id: null,
          file: { version: 1, current_project_id: null, projects: [] },
        };
      }
      if (cmd === 'validate_project_path') {
        const path = String(args?.path ?? '');
        return { path, valid: true, reason_code: '', reason: '' };
      }
      if (cmd === 'add_project') {
        return {
          id: 'p1',
          name: String(args?.name ?? ''),
          root_dir: String(args?.root_dir ?? ''),
          created_at: 1_700_000_000,
          is_system: false,
        };
      }
      return null;
    });

    render(<HomeView />);
    fireEvent.click(screen.getByTestId('add-project-toggle'));

    const nameInput = screen.getByTestId('new-project-name') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'myproject' } });

    const rootInput = screen.getByTestId('new-project-root') as HTMLInputElement;
    fireEvent.change(rootInput, { target: { value: '/Users/x/.claude-projects/foo' } });
    fireEvent.blur(rootInput);

    await waitFor(() => {
      expect(screen.getByTestId('path-validation-hint')).toHaveTextContent(
        '路径合法',
      );
    });

    const submitBtn = screen.getByTestId('confirm-add-project') as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(false);

    fireEvent.click(submitBtn);
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith(
        'add_project',
        expect.objectContaining({
          name: 'myproject',
          root_dir: '/Users/x/.claude-projects/foo',
        }),
      );
    });
  });
});