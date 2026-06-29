/**
 * A1 (Bug 2026-06-29) — JSON 编辑器双层包装回归保护
 *
 * Bug 历史:
 *   - 用户在 JSON 编辑器选任意文件都看到
 *     "读取失败: 读取失败 : No such file or directory (os error 2)"
 *   - ffb00cd (line 226) + 303b4d3 (line 258) 删除了前端 "读取失败:" 包裹
 *
 * 关键 invariant (本测试断言):
 *   1. 后端通过 classify_io_error 返回的 4 类错误 (文件不存在 / 无权限 /
 *      编码错误 / I/O 失败) 经前端 mapBackendError 处理后,**无双前缀**——
 *      不应出现 "读取失败 : 读取失败 :" 重复。
 *   2. mapBackendError 必须能正确匹配 CJK category + space 分隔
 *      (回归 §16 — root cause 是 regex \b 在 CJK→ASCII 边界不匹配)。
 *   3. 用户可见的文案必须包含 Rust 返回的 OS-level 详情 (如
 *      "No such file or directory") 帮助 debug,但**不应有** 重复前缀。
 *
 * 这是 §16 五步流程的 step 5 "修复后验证" 测试 — 改前应 FAIL,
 * 修后应 PASS。测试留 codebase 做回归保护 (§16.2 硬证据)。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import JsonEditorPage from '../../pages/json-editor';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

vi.mock('../../hooks/useProjects', () => ({
  useProjects: () => ({
    projects: [],
    currentProjectId: null,
    currentProject: null,
    loading: false,
    error: null,
    reload: vi.fn(),
    add: vi.fn(),
    remove: vi.fn(),
    switchTo: vi.fn(),
  }),
}));

beforeEach(() => {
  mockInvoke.mockReset();
});

/**
 * Helper: 模拟用户通过 <input type="file"> 选文件,触发 read_file
 * 错误,返回渲染出的 InfoBar 文本内容。
 */
async function triggerReadFileError(
  errMessage: string,
  fileName: string = 'nope.json',
): Promise<string> {
  mockInvoke.mockImplementation(async (cmd: string) => {
    if (cmd === 'read_file') throw new Error(errMessage);
    if (cmd === 'write_file_atomic') return null;
    if (cmd === 'list_editable_jsons') return [];
    return null;
  });

  render(<JsonEditorPage />);
  await waitFor(() => screen.getByTestId('json-editor-file-input'));
  const file = new File([''], fileName, { type: 'application/json' });
  const input = screen.getByTestId('json-editor-file-input') as HTMLInputElement;
  await act(async () => {
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    fireEvent.change(input);
  });
  await waitFor(() => screen.getByTestId('json-editor-message'));
  const msg = screen.getByTestId('json-editor-message');
  return msg.textContent ?? '';
}

// ---------------------------------------------------------------------------
// 1. 双层包装 regression (历史 bug 的硬证据)
// ---------------------------------------------------------------------------

describe('A1 — 双层包装 regression', () => {
  it('scenario: 文件不存在 → InfoBar 文本无双层"读取失败"前缀', async () => {
    // Rust classify_io_error → "文件不存在 <path>: <io error>"
    const text = await triggerReadFileError(
      '文件不存在 /home/u/.claude/nope.json: No such file or directory (os error 2)',
    );
    // §16 硬证据:无双层前缀
    expect(text).not.toContain('读取失败 : 读取失败');
    expect(text).not.toContain('读取失败: 读取失败');
    // §16 硬证据:后端分类信息保留
    expect(text).toContain('文件不存在');
    // §16 硬证据:OS 级错误细节保留(供截图/bug report 用)
    expect(text).toContain('No such file or directory');
  });

  it('scenario: 无权限 → InfoBar 文本无双层"读取失败"前缀', async () => {
    const text = await triggerReadFileError(
      '无权限 /home/u/.claude/locked.json: Access is denied. (os error 5)',
      'locked.json',
    );
    expect(text).not.toContain('读取失败 : 读取失败');
    expect(text).not.toContain('读取失败: 读取失败');
    expect(text).toContain('无权限');
    expect(text).toContain('Access is denied');
  });

  it('scenario: 编码错误 → InfoBar 文本无双层"读取失败"前缀', async () => {
    const text = await triggerReadFileError(
      '编码错误 /home/u/.claude/bom.json: stream did not contain valid UTF-8',
      'bom.json',
    );
    expect(text).not.toContain('读取失败 : 读取失败');
    expect(text).not.toContain('读取失败: 读取失败');
    expect(text).toContain('编码错误');
  });

  it('scenario: I/O 失败 → InfoBar 文本无双层"读取失败"前缀', async () => {
    const text = await triggerReadFileError(
      'I/O 失败 /home/u/.claude/whatever.json: disk I/O error',
      'whatever.json',
    );
    expect(text).not.toContain('读取失败 : 读取失败');
    expect(text).not.toContain('读取失败: 读取失败');
    expect(text).toContain('I/O 失败');
  });

  it('regression: 即使 raw 错误里已含"读取失败"前缀,前端不再叠加', async () => {
    // 历史 bug 复现条件:Rust fs.rs:298/306/308 在某些路径返回
    // "读取失败 <path>: <io error>"。前端若再 pre-pend "读取失败:"
    // 就成 "读取失败: 读取失败 ..." 双层。修复后前端不应再叠前缀。
    const text = await triggerReadFileError(
      '读取失败 /home/u/.claude/whatever.json: No such file or directory (os error 2)',
      'whatever.json',
    );
    expect(text).not.toContain('读取失败: 读取失败');
    expect(text).not.toContain('读取失败 : 读取失败');
    // raw 文案至少要保留一份"读取失败"(供用户定位)
    expect(text).toContain('读取失败');
  });
});

// ---------------------------------------------------------------------------
// 2. mapBackendError 行为 sanity
// ---------------------------------------------------------------------------

describe('A1 — mapBackendError 行为 sanity', () => {
  it('整个 InfoBar 文本里"读取失败"出现 0 次 (任何出现都是回归)', async () => {
    // 真实 Rust 后端不会在错误里带"读取失败"前缀(那是前端历史 bug
    // 的来源);此 test 锁住这个不变性,避免后续有人重新加回去。
    const text = await triggerReadFileError(
      '文件不存在 /home/u/.claude/x.json: No such file or directory (os error 2)',
    );
    // 直接断言:整个文本里"读取失败"出现 0 次(若 1 次都是回归)
    const occurrences = (text.match(/读取失败/g) ?? []).length;
    expect(occurrences).toBe(0);
  });
});
