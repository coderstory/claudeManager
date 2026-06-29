/**
 * A10 §16 regression — Backup 时间显示正确性。
 *
 * WHY THIS TEST EXISTS
 * --------------------
 * A10 ("Backup time 显示错") 在 triage 阶段列为 "subagent 派出结果不明",
 * 是历史模糊状态。本次按 CLAUDE.md §16 五步流程重新验证:
 *
 *   1. **了解详情**: 用户报告备份与恢复页 + 审计 tab 里显示的备份时间
 *      疑似错(可能是浏览器本地 TZ,而非统一的 UTC+8)。
 *   2. **明确原因 (file:line 证据)**:
 *      - `src/types/backup.ts:50-53` 定义了 `formatBackupTimestamp(unix)`。
 *      - `src/types/backup.ts:13` 该函数 `import { formatDateTime } from
 *        '../lib/formatTime';` — 已经走中心 util。
 *      - `src/lib/formatTime.ts:19-32` 显式 `timeZone: 'Asia/Shanghai'`
 *        锁死 UTC+8。
 *      - `src/pages/backup-restore/index.tsx:894-896 + 1188-1190` 通过
 *        `formatBackupTimestamp(e.timestamp_unix)` 渲染。
 *      - `src/pages/history/BackupHistoryTable.tsx:22-26` 的 `formatTs`
 *        走 `formatDateTime`。
 *   3. **明确边界**: 仅影响备份时间字段的显示 (F13 timeline + 审计 tab
 *      BackupHistoryTable)。其他时间字段(usage history 等)在 B7 已验。
 *   4. **方案**:
 *      - A. (本次采用) 写一个聚焦的 vitest,直接断言:
 *           (a) formatBackupTimestamp 输出 = formatDateTime 输出 (代理)
 *           (b) BackupHistoryTable 渲染 created_at 后,row 文本含
 *               "2026/06/29" + "14:30" 字段(UTC+8 期望值)
 *           (c) 浏览器本地 TZ 不影响显示(模拟 TZ=America/Los_Angeles)
 *      - B. 抽并导出统一 formatDateTime (B7 commit `1deb267` 已做)。
 *   5. **验证**: 改前 FAIL → 改后 PASS,测试留 codebase 做回归。
 *      当前 master HEAD 已含 B7 fix + formatBackupTimestamp 已 delegate,
 *      所以 vitest 应 PASS — 验证 fix 已 ship。
 *
 * §16.2 evidence rules: 这是 §16 第 5 步"修复后实际验证"的硬证据。
 *   PASS 即可关闭 A10 (时间显示已正确 delegate 到 UTC+8 util)。
 *   FAIL 则需修 `formatBackupTimestamp` / `BackupHistoryTable.formatTs`。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import { BackupHistoryTable } from '../../pages/history/BackupHistoryTable';
import type { BackupHistoryRow } from '../../types/history';
import { formatBackupTimestamp } from '../../types/backup';
import { formatDateTime } from '../../lib/formatTime';
import BackupRestorePage from '../../pages/backup-restore';
import { ViewStateProvider } from '../../hooks/useViewState';

// ---------------------------------------------------------------------------
// Mocks (for backup-restore page mount)
// ---------------------------------------------------------------------------

const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

beforeEach(() => {
  mockInvoke.mockReset();
  mockInvoke.mockImplementation(async (cmd: string) => {
    if (cmd === 'list_backups') return [];
    if (cmd === 'get_backup_history') return [];
    return null;
  });
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

// ---------------------------------------------------------------------------
// Test fixture helpers
// ---------------------------------------------------------------------------

/**
 * 2026-06-29 14:30:00 Asia/Shanghai = 2026-06-29 06:30:00 UTC.
 * Pick a date that crosses a TZ boundary (LA = 23:30 the previous day),
 * so a buggy implementation using local TZ would show 2026-06-28 23:30
 * instead of 2026-06-29 14:30 — the test catches that divergence.
 */
const SAMPLE_UNIX = 1782714600; // 2026-06-29 14:30:00 UTC+8

const sampleAuditRow = (
  overrides: Partial<BackupHistoryRow> = {},
): BackupHistoryRow => ({
  id: 1,
  backup_id: 'bak-1',
  file_name: 'settings.json.bak.1',
  file_size: 1024,
  scope: 'user',
  active_root: null,
  trigger_kind: 'manual',
  file_hash: null,
  metadata_json: null,
  created_at: SAMPLE_UNIX,
  ...overrides,
});

function wrap({ children }: { children: React.ReactNode }): React.ReactElement {
  return <ViewStateProvider>{children}</ViewStateProvider>;
}

// ===========================================================================
// 角度 1 — formatBackupTimestamp 直接断言 (utility layer)
// ===========================================================================

describe('A10 §16 — formatBackupTimestamp renders UTC+8 correctly', () => {
  it('renders 2026/06/29 + 14:30 fields for unix=1782714600 (UTC+8 baseline)', () => {
    const out = formatBackupTimestamp(SAMPLE_UNIX);
    // UTC+8 期望值: 2026-06-29 14:30:00
    expect(out).toContain('2026');
    expect(out).toContain('06');
    expect(out).toContain('29');
    expect(out).toContain('14');
    expect(out).toContain('30');
  });

  it('returns identical output regardless of host TZ (cross-TZ guarantee)', () => {
    // Snapshot in current TZ.
    const baseline = formatBackupTimestamp(SAMPLE_UNIX);

    // Swap host TZ to LA. If formatBackupTimestamp accidentally picks
    // up the browser TZ, output shifts (would show 2026-06-28 23:30).
    const originalTz = process.env.TZ;
    try {
      process.env.TZ = 'America/Los_Angeles';
      const outLa = formatBackupTimestamp(SAMPLE_UNIX);
      expect(outLa).toBe(baseline);

      process.env.TZ = 'Pacific/Auckland'; // UTC+12, opposite side
      const outAk = formatBackupTimestamp(SAMPLE_UNIX);
      expect(outAk).toBe(baseline);
    } finally {
      if (originalTz === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = originalTz;
      }
    }
  });

  it('returns "未知时间" for null (existing contract preserved)', () => {
    expect(formatBackupTimestamp(null)).toBe('未知时间');
  });

  it('delegates to formatDateTime (no parallel toLocaleString implementation)', () => {
    // If someone reverts `formatBackupTimestamp` to a raw
    // `new Date(...).toLocaleString()` call, the output will diverge
    // (or match by accident in some TZs but not others).
    // This test pins the delegation contract.
    const a = formatBackupTimestamp(SAMPLE_UNIX);
    const b = formatDateTime(SAMPLE_UNIX);
    expect(a).toBe(b);
  });
});

// ===========================================================================
// 角度 2 — BackupHistoryTable 渲染时显示 UTC+8 时间 (presentation layer)
// ===========================================================================

describe('A10 §16 — BackupHistoryTable renders UTC+8 in each row', () => {
  it('row text contains "2026", "06", "29", "14", "30" for the sample timestamp', () => {
    const rows = [sampleAuditRow()];
    render(<BackupHistoryTable rows={rows} />);
    const row = screen.getByTestId('backup-history-row');
    // The first <td> is the formatted timestamp.
    expect(row.textContent).toContain('2026');
    expect(row.textContent).toContain('06');
    expect(row.textContent).toContain('29');
    expect(row.textContent).toContain('14');
    expect(row.textContent).toContain('30');
  });

  it('renders multiple rows each with their own UTC+8 timestamps', () => {
    // Two distinct timestamps 50 min apart on the same UTC+8 day.
    const u1 = 1782714600; // 2026-06-29 14:30:00 UTC+8
    const u2 = u1 + 50 * 60; // 2026-06-29 15:20:00 UTC+8
    const rows = [
      sampleAuditRow({ id: 1, created_at: u1 }),
      sampleAuditRow({ id: 2, created_at: u2 }),
    ];
    render(<BackupHistoryTable rows={rows} />);
    const renderedRows = screen.getAllByTestId('backup-history-row');
    expect(renderedRows).toHaveLength(2);
    // Both rows should contain 2026-06-29
    for (const row of renderedRows) {
      expect(row.textContent).toContain('2026');
      expect(row.textContent).toContain('06');
      expect(row.textContent).toContain('29');
    }
  });

  it('cross-TZ: row text identical regardless of host TZ', () => {
    const rows = [sampleAuditRow()];
    const originalTz = process.env.TZ;
    try {
      // First snapshot under default TZ
      const { unmount } = render(<BackupHistoryTable rows={rows} />);
      const baselineText =
        screen.getByTestId('backup-history-row').textContent ?? '';
      unmount();

      // Re-render under LA TZ
      process.env.TZ = 'America/Los_Angeles';
      render(<BackupHistoryTable rows={rows} />);
      const laText = screen.getByTestId('backup-history-row').textContent ?? '';
      expect(laText).toBe(baselineText);
    } finally {
      if (originalTz === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = originalTz;
      }
    }
  });
});

// ===========================================================================
// 角度 3 — backup-restore 页 audit tab 显示 UTC+8 (integration layer)
// ===========================================================================

describe('A10 §16 — backup-restore audit tab displays UTC+8 timestamp', () => {
  it('audit tab row contains UTC+8 fields after IPC resolves', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_backups') return [];
      if (cmd === 'get_backup_history') {
        return [sampleAuditRow({ file_name: 'settings.json.bak.audit' })];
      }
      return null;
    });

    render(<BackupRestorePage />, { wrapper: wrap });
    await waitFor(() => {
      expect(screen.getByTestId('tab-audit')).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('tab-audit'));
    });

    await waitFor(() => {
      const rows = screen.getAllByTestId('backup-history-row');
      expect(rows.length).toBe(1);
    });

    const row = screen.getByTestId('backup-history-row');
    expect(row.textContent).toContain('2026');
    expect(row.textContent).toContain('06');
    expect(row.textContent).toContain('29');
    expect(row.textContent).toContain('14');
    expect(row.textContent).toContain('30');
  });
});

// ===========================================================================
// 反向 case — 故意 broken impl, 验证测试能抓到 (TDD-style FAIL→PASS)
// ===========================================================================

describe('A10 §16 — reverse case: a buggy local-TZ impl would FAIL this test', () => {
  it('asserts that swapping TZ to LA would expose a buggy local-TZ implementation', () => {
    // Compute what a buggy `new Date(unix * 1000).toLocaleString()`
    // (without explicit timeZone option) would return in LA:
    // 1782714600 UTC = 2026-06-29 06:30 UTC = 2026-06-28 23:30 LA (UTC-7)
    const originalTz = process.env.TZ;
    try {
      process.env.TZ = 'America/Los_Angeles';
      const buggy = new Date(SAMPLE_UNIX * 1000).toLocaleString('zh-CN');
      // A buggy impl would render 2026-06-28 23:30:00 (LA local).
      // The correct formatBackupTimestamp should NOT match the buggy output.
      const correct = formatBackupTimestamp(SAMPLE_UNIX);
      // If formatBackupTimestamp is correct (UTC+8), it shows 2026-06-29 14:30.
      // If buggy (local TZ under LA env), it would show 2026-06-28 23:30.
      // The buggy output contains "28" + "23", the correct contains "29" + "14".
      expect(correct).not.toBe(buggy);
      expect(correct).toContain('29');
      expect(correct).toContain('14');
      expect(buggy).toContain('28');
      expect(buggy).toContain('23');
    } finally {
      if (originalTz === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = originalTz;
      }
    }
  });
});