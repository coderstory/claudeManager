/**
 * F10 — 拖放 .sql 导入集成测试 (M2.16)。
 *
 * 覆盖 SPEC F10:把 .sql 拖到主窗口 → 自动跳到导入页 + 加载该文件。
 *
 * 策略:
 *   - mock `@tauri-apps/api/window` 的 `getCurrentWindow().onDragDropEvent`
 *     以捕获 drag-drop handler,手动触发 enter / over / drop / leave 事件。
 *   - mock `@tauri-apps/api/event` 的 `listen` 以满足 F20 的
 *     import-sql-file listener(App.tsx 挂载时注册)。
 *   - mock `@tauri-apps/api/core` 的 `invoke` 以满足 ImportSqlPage 的
 *     read_sql_file + parse_sql_preview 调用(drop 后跳转导入页时触发)。
 *
 * 覆盖场景:
 *   1. 拖入 .sql → 显示拖放遮罩
 *   2. 拖入非 .sql → 不显示遮罩
 *   3. 拖入混合文件(含 .sql)→ 显示遮罩
 *   4. 拖离窗口 → 隐藏遮罩
 *   5. 拖放 .sql → 跳转 import-sql 页 + 自动加载文件
 *   6. 拖放非 .sql → 不跳转(留在当前页)
 *   7. 拖放后遮罩隐藏
 *   8. over 事件不改变遮罩状态(enter 后保持可见)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import App from '../../App';
import { ThemeProvider } from '../../design-system/ThemeProvider';

// ---------------------------------------------------------------------------
// Mock Tauri IPC 层
// ---------------------------------------------------------------------------

const mockOnDragDropEvent = vi.fn();
const mockListen = vi.fn();
const mockInvoke = vi.fn();

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    onDragDropEvent: (...args: unknown[]) => mockOnDragDropEvent(...args),
  }),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: (...args: unknown[]) => mockListen(...args),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

// ---------------------------------------------------------------------------
// Drag-drop handler 捕获 — App.tsx 挂载时调用 onDragDropEvent(handler),
// 我们把 handler 存起来,测试中手动触发。
// ---------------------------------------------------------------------------

type DragDropPayload =
  | { type: 'enter'; paths: string[]; position: { x: number; y: number } }
  | { type: 'over'; position: { x: number; y: number } }
  | { type: 'drop'; paths: string[]; position: { x: number; y: number } }
  | { type: 'leave' };

let dragDropHandler:
  | ((event: { payload: DragDropPayload }) => void)
  | null = null;

/** 模拟 Tauri webview 发来的 drag-drop 事件。 */
function fireDragDropEvent(payload: DragDropPayload): void {
  const handler = dragDropHandler;
  if (!handler) {
    throw new Error('onDragDropEvent handler 未捕获(App 是否挂载?)');
  }
  act(() => {
    handler({ payload });
  });
}

beforeEach(() => {
  localStorage.clear();
  dragDropHandler = null;

  mockOnDragDropEvent.mockImplementation((handler) => {
    dragDropHandler = handler;
    return Promise.resolve(() => {});
  });
  mockListen.mockResolvedValue(() => {});
  mockInvoke.mockReset();
  mockInvoke.mockResolvedValue(undefined);
});

function renderApp(): ReturnType<typeof render> {
  return render(
    <ThemeProvider>
      <App />
    </ThemeProvider>,
  );
}

// ---------------------------------------------------------------------------
// 测试
// ---------------------------------------------------------------------------

describe('F10 — 拖放 .sql 导入', () => {
  it('拖入 .sql 文件 → 显示拖放遮罩', () => {
    renderApp();
    expect(screen.queryByTestId('drag-drop-overlay')).not.toBeInTheDocument();

    fireDragDropEvent({
      type: 'enter',
      paths: ['C:\\test\\dump.sql'],
      position: { x: 100, y: 100 },
    });

    expect(screen.getByTestId('drag-drop-overlay')).toBeInTheDocument();
  });

  it('拖入非 .sql 文件 → 不显示遮罩', () => {
    renderApp();
    fireDragDropEvent({
      type: 'enter',
      paths: ['C:\\test\\readme.txt'],
      position: { x: 100, y: 100 },
    });

    expect(screen.queryByTestId('drag-drop-overlay')).not.toBeInTheDocument();
  });

  it('拖入混合文件(含 .sql)→ 显示遮罩', () => {
    renderApp();
    fireDragDropEvent({
      type: 'enter',
      paths: ['C:\\test\\readme.txt', 'C:\\test\\dump.sql'],
      position: { x: 100, y: 100 },
    });

    expect(screen.getByTestId('drag-drop-overlay')).toBeInTheDocument();
  });

  it('拖离窗口 → 隐藏遮罩', () => {
    renderApp();
    fireDragDropEvent({
      type: 'enter',
      paths: ['C:\\test\\dump.sql'],
      position: { x: 100, y: 100 },
    });
    expect(screen.getByTestId('drag-drop-overlay')).toBeInTheDocument();

    fireDragDropEvent({ type: 'leave' });

    expect(screen.queryByTestId('drag-drop-overlay')).not.toBeInTheDocument();
  });

  it('拖放 .sql → 跳转 import-sql 页 + 自动加载文件', async () => {
    // 模拟 read_sql_file 返回 SQL 内容,parse_sql_preview 返回预览数据。
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'read_sql_file') return 'INSERT INTO providers ...';
      if (cmd === 'parse_sql_preview') {
        return {
          total_lines: 1,
          importable: 1,
          skipped: 0,
          preview_providers: [
            {
              id: 'a',
              name: 'A',
              provider_type: 'anthropic',
              api_base: 'https://a.example.com',
              api_key: 'key-a',
              models: ['claude-sonnet-4-6'],
              is_active: false,
              created_at: 1_700_000_000,
              last_used_at: null,
              notes: null,
            },
          ],
          preview_mcp: [],
          skipped_samples: [],
        };
      }
      return undefined;
    });

    renderApp();
    // 初始在 home 页。
    expect(
      screen.getByText('欢迎使用 Claude 配置管理器'),
    ).toBeInTheDocument();

    fireDragDropEvent({
      type: 'drop',
      paths: ['C:\\test\\dump.sql'],
      position: { x: 100, y: 100 },
    });

    // 应跳转到 import-sql 页并自动加载文件 → 显示预览。
    await waitFor(() => {
      expect(screen.getByTestId('import-sql-preview')).toBeInTheDocument();
    });
    // 文件名从绝对路径提取后显示在 UI。
    expect(screen.getByText('dump.sql')).toBeInTheDocument();
  });

  it('拖放非 .sql → 不跳转(留在当前页)', () => {
    renderApp();
    expect(
      screen.getByText('欢迎使用 Claude 配置管理器'),
    ).toBeInTheDocument();

    fireDragDropEvent({
      type: 'drop',
      paths: ['C:\\test\\readme.txt'],
      position: { x: 100, y: 100 },
    });

    // 仍在 home 页,未跳转。
    expect(
      screen.getByText('欢迎使用 Claude 配置管理器'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('import-sql-page')).not.toBeInTheDocument();
  });

  it('拖放后遮罩隐藏', () => {
    renderApp();
    fireDragDropEvent({
      type: 'enter',
      paths: ['C:\\test\\dump.sql'],
      position: { x: 100, y: 100 },
    });
    expect(screen.getByTestId('drag-drop-overlay')).toBeInTheDocument();

    fireDragDropEvent({
      type: 'drop',
      paths: ['C:\\test\\dump.sql'],
      position: { x: 100, y: 100 },
    });

    expect(screen.queryByTestId('drag-drop-overlay')).not.toBeInTheDocument();
  });

  it('over 事件不改变遮罩状态(enter 后保持可见)', () => {
    renderApp();
    fireDragDropEvent({
      type: 'enter',
      paths: ['C:\\test\\dump.sql'],
      position: { x: 100, y: 100 },
    });
    expect(screen.getByTestId('drag-drop-overlay')).toBeInTheDocument();

    // over 事件不带 paths,不应改变遮罩状态。
    fireDragDropEvent({
      type: 'over',
      position: { x: 200, y: 200 },
    });

    expect(screen.getByTestId('drag-drop-overlay')).toBeInTheDocument();
  });
});
