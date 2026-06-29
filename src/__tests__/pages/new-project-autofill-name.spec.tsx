/**
 * Vitest coverage for A7 — "新建项目 选目录不自动填 name" bug fix verification
 * (commits `04c568c` + `db74286`).
 *
 * Bug: 新建项目时点选 [浏览…] → 选完目录 → name 输入框保持空白,
 *      用户必须再手输一遍项目名,体验差。
 *
 * Fix under verification:
 *   - `04c568c` — added 1-line `setNewName(dirName)` to HomeView.handlePickRoot
 *   - `db74286` — evolved picker to Tauri native dialog, refined auto-fill to:
 *       * split path on both `/` and `\` (cross-platform)
 *       * extract last segment
 *       * only fill if user hasn't typed anything yet (non-destructive)
 *
 * Per CLAUDE.md §16 第 5 步, 这些测试必须:
 *   1. 改前 FAIL (验证 fix 是否真解决问题) — git show 04c568c 之前的版本会 fail
 *   2. 改后 PASS (留 codebase 做回归保护)
 *
 * 本测试文件专门聚焦 A7, 跟 A3 (路径验证) 解耦, 便于:
 *   - grep `A7` 找回归保护
 *   - future change 只改 auto-fill 逻辑时不会撞 A3 测试
 *   - 加新场景 (Unicode / UNC / 取消 / 已输 name) 不污染 A3
 *
 * 八个核心场景:
 *   - A7.1: Unix 绝对路径 /Users/foo/projects/my-app → name = 'my-app'
 *   - A7.2: Windows 绝对路径 D:\\projects\\my-app → name = 'my-app'
 *   - A7.3: 深嵌套路径 /a/b/c/d/e/f → name = 'f'
 *   - A7.4: 取消 (picker 返回 null) → name 保持空, 无 crash
 *   - A7.5: 用户先输 name → 选目录不覆盖已输的 name (非破坏性)
 *   - A7.6: Unicode 目录名 /Users/test/项目一 → name = '项目一'
 *   - A7.7: 末尾带斜杠 /Users/foo/projects/my-app/ → name = 'my-app' (filter(Boolean))
 *   - A7.8: 选完目录后, name 输入框立刻可用 (用户可编辑)
 *
 * Mock 策略 (重要!):
 *   `useProjects` 在组件 mount 时调 `list_projects` (会消耗 mockImplementationOnce 的
 *   第一次),所以不能用 plain `mockImplementationOnce` 模拟 picker,否则 queue order
 *   会出错。改用 `mockImplementation` (always-on) 并由 cmd 名字分发:
 *     - 'pick_project_root_dir' → 返回测试指定的 pickerResult (用 let 变量注入)
 *     - 'list_projects' → 返回空 list
 *     - 'validate_project_path' → 返回 valid
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

// Per-test injection point. Set to the absolute path the picker should return,
// or null for "user cancelled". Updated by setPickerResult() in each test.
let pickerResult: string | null = null;

beforeEach(() => {
  mockInvoke.mockReset();
  pickerResult = null; // reset to default (cancelled) per test
  mockInvoke.mockImplementation(async (cmd: string) => {
    if (cmd === 'list_projects') {
      return {
        projects: [],
        current_project_id: null,
        file: { version: 1, current_project_id: null, projects: [] },
      };
    }
    if (cmd === 'pick_project_root_dir') {
      return pickerResult;
    }
    if (cmd === 'validate_project_path') {
      return {
        path: '',
        valid: true,
        reason_code: '',
        reason: '',
      };
    }
    return null;
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Open the "新增项目" modal and click [浏览…] to trigger picker. */
async function openModalAndPick(): Promise<void> {
  render(<HomeView />);
  // Open modal
  fireEvent.click(screen.getByTestId('add-project-toggle'));
  // Click [浏览…] — triggers pickProjectRoot() → invoke('pick_project_root_dir')
  fireEvent.click(screen.getByTestId('pick-root-button'));
}

/** Wait until invoke('pick_project_root_dir') has been awaited and the
 *  picker has settled (root input updated OR no-op if cancelled). */
async function waitForPickSettled(): Promise<void> {
  await waitFor(() => {
    expect(mockInvoke).toHaveBeenCalledWith('pick_project_root_dir');
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('A7 — 新建项目 选目录自动填 name (commits 04c568c + db74286)', () => {
  // -----------------------------------------------------------------
  // A7.1: Unix 绝对路径 → name = 末段
  // -----------------------------------------------------------------
  it('A7.1: 选 Unix 绝对路径 /Users/foo/projects/my-app → name 自动填 my-app', async () => {
    pickerResult = '/Users/foo/projects/my-app';
    await openModalAndPick();

    await waitForPickSettled();
    await waitFor(() => {
      const nameInput = screen.getByTestId('new-project-name') as HTMLInputElement;
      expect(nameInput.value).toBe('my-app');
    });
  });

  // -----------------------------------------------------------------
  // A7.2: Windows 绝对路径 → split on `\` 也取末段
  // -----------------------------------------------------------------
  it('A7.2: 选 Windows 绝对路径 D:\\projects\\my-app → name 自动填 my-app', async () => {
    pickerResult = 'D:\\projects\\my-app';
    await openModalAndPick();

    await waitForPickSettled();
    await waitFor(() => {
      const nameInput = screen.getByTestId('new-project-name') as HTMLInputElement;
      expect(nameInput.value).toBe('my-app');
    });
  });

  // -----------------------------------------------------------------
  // A7.3: 深嵌套路径 → 取最末段
  // -----------------------------------------------------------------
  it('A7.3: 选深嵌套路径 /a/b/c/d/e/f → name 自动填 f', async () => {
    pickerResult = '/a/b/c/d/e/f';
    await openModalAndPick();

    await waitForPickSettled();
    await waitFor(() => {
      const nameInput = screen.getByTestId('new-project-name') as HTMLInputElement;
      expect(nameInput.value).toBe('f');
    });
  });

  // -----------------------------------------------------------------
  // A7.4: 用户取消 → name 保持空, 不 crash
  // -----------------------------------------------------------------
  it('A7.4: 用户取消 (picker 返回 null) → name 保持空, 无 crash', async () => {
    // pickerResult default = null (set in beforeEach)
    await openModalAndPick();

    await waitForPickSettled();
    // Give setState a tick to settle
    await new Promise((r) => setTimeout(r, 50));

    const nameInput = screen.getByTestId('new-project-name') as HTMLInputElement;
    const rootInput = screen.getByTestId('new-project-root') as HTMLInputElement;
    expect(nameInput.value).toBe('');
    expect(rootInput.value).toBe(''); // 也保持空 (handlePickRoot 不动 form 当 picked=null)
  });

  // -----------------------------------------------------------------
  // A7.5: 用户先输 name → 选目录不覆盖已输的 name (非破坏性)
  // 这是 db74286 相对 04c568c 的关键改进: 不抢用户已输的字段
  // -----------------------------------------------------------------
  it('A7.5: 用户先输了 "my-custom-name" → 选目录不覆盖 (非破坏性 auto-fill)', async () => {
    pickerResult = '/Users/foo/projects/picked-name';
    render(<HomeView />);
    fireEvent.click(screen.getByTestId('add-project-toggle'));

    // 用户先输 name
    const nameInput = screen.getByTestId('new-project-name') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'my-custom-name' } });
    expect(nameInput.value).toBe('my-custom-name');

    // 再选目录
    fireEvent.click(screen.getByTestId('pick-root-button'));
    await waitForPickSettled();

    // 关键断言: 用户已输的 name 没被覆盖
    await waitFor(() => {
      const current = screen.getByTestId('new-project-name') as HTMLInputElement;
      expect(current.value).toBe('my-custom-name');
    });
  });

  // -----------------------------------------------------------------
  // A7.6: Unicode 目录名 → name = Unicode 末段
  // -----------------------------------------------------------------
  it('A7.6: 选 Unicode 目录名 /Users/test/项目一 → name 自动填 项目一', async () => {
    pickerResult = '/Users/test/项目一';
    await openModalAndPick();

    await waitForPickSettled();
    await waitFor(() => {
      const nameInput = screen.getByTestId('new-project-name') as HTMLInputElement;
      expect(nameInput.value).toBe('项目一');
    });
  });

  // -----------------------------------------------------------------
  // A7.7: 末尾带斜杠 → filter(Boolean) 干掉空段, name = 末段
  // 实现: picked.split(/[\\/]/).filter(Boolean).at(-1)
  // -----------------------------------------------------------------
  it('A7.7: 末尾带斜杠 /Users/foo/projects/my-app/ → name 自动填 my-app (filter 空段)', async () => {
    pickerResult = '/Users/foo/projects/my-app/';
    await openModalAndPick();

    await waitForPickSettled();
    await waitFor(() => {
      const nameInput = screen.getByTestId('new-project-name') as HTMLInputElement;
      expect(nameInput.value).toBe('my-app');
    });
  });

  // -----------------------------------------------------------------
  // A7.8: 选完目录后, name 输入框 enabled (用户能编辑)
  // 这是 UX 完整性检查: auto-fill 后 form 还能用
  // -----------------------------------------------------------------
  it('A7.8: 选完目录后 name input enabled, 用户可继续编辑', async () => {
    pickerResult = '/Users/foo/projects/my-app';
    await openModalAndPick();

    await waitForPickSettled();
    await waitFor(() => {
      const nameInput = screen.getByTestId('new-project-name') as HTMLInputElement;
      expect(nameInput.value).toBe('my-app');
    });

    // 用户可以继续编辑
    const nameInput = screen.getByTestId('new-project-name') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'renamed' } });
    expect(nameInput.value).toBe('renamed');
  });
});
