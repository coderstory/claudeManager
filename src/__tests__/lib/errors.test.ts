/**
 * BZ-07 — localizeMarketplaceError 单测 (Vitest)
 *
 * 覆盖 5 类错误输入:
 * 1. CliNotFound × 3 (claude / npx / git)
 * 2. Git error
 * 3. Io error
 * 4. PathUnsafe
 * 5. 兜底 (其它未匹配字符串)
 *
 * Why each test:
 * - 锁住中文 title 字符串 (防止 i18n 字符串 typo)
 * - 锁住 hint 含 mac/win 安装指引 (M6 用户实测反馈的核心理由)
 * - 锁住 detail 字段保留原 raw error (用户可看到原始报错排查)
 */
import { describe, it, expect } from 'vitest';
import { localizeMarketplaceError } from '../../lib/errors';

describe('localizeMarketplaceError — BZ-07 CliNotFound (3 CLI × 1 case each)', () => {
  it("translates 'claude' CliNotFound with brew + Windows 安装包 hint", () => {
    const raw = "无法启动 'claude' CLI (请确认已安装)";
    const out = localizeMarketplaceError(raw);
    expect(out.title).toBe('无法启动 claude 命令行工具');
    // hint 必须同时含 macOS 和 Windows 安装指引 (M6 用户实测需求)
    expect(out.hint).toContain('Claude Code');
    expect(out.hint).toContain('brew install claude-code');
    expect(out.hint).toContain('Windows');
    // detail 保留原 raw error
    expect(out.detail).toBe(raw);
  });

  it("translates 'npx' CliNotFound with brew + Node.js LTS hint", () => {
    const raw = "无法启动 'npx' CLI (请确认已安装)";
    const out = localizeMarketplaceError(raw);
    expect(out.title).toBe('无法启动 npx 命令行工具');
    expect(out.hint).toContain('Node.js');
    expect(out.hint).toContain('brew install node');
    expect(out.hint).toContain('https://nodejs.org');
    expect(out.detail).toBe(raw);
  });

  it("translates 'git' CliNotFound with Xcode CLT + Git for Windows hint", () => {
    const raw = "无法启动 'git' CLI (请确认已安装)";
    const out = localizeMarketplaceError(raw);
    expect(out.title).toBe('无法启动 git 命令行工具');
    expect(out.hint).toContain('Git');
    expect(out.hint).toContain('xcode-select --install');
    expect(out.hint).toContain('Git for Windows');
    expect(out.hint).toContain('https://git-scm.com/download/win');
    expect(out.detail).toBe(raw);
  });

  it('falls back to generic CLI hint for unknown cmd names', () => {
    const raw = "无法启动 'unknown-tool' CLI (请确认已安装)";
    const out = localizeMarketplaceError(raw);
    expect(out.title).toBe('无法启动 unknown-tool 命令行工具');
    // 兜底仍给 PATH 自查指引
    expect(out.hint).toContain('PATH');
    expect(out.hint).toContain('unknown-tool');
    expect(out.detail).toBe(raw);
  });
});

describe('localizeMarketplaceError — BZ-07 Git / Io / PathUnsafe / 兜底', () => {
  it("translates 'git error:' prefix without CliNotFound branching", () => {
    const raw = 'git error: fatal: unable to access repository';
    const out = localizeMarketplaceError(raw);
    expect(out.title).toBe('Git 操作失败');
    // Git error 走网络/SSH/token 自查指引,而不是 CLI 安装指引
    expect(out.hint).toContain('网络');
    expect(out.hint).toContain('SSH');
    expect(out.detail).toBe(raw);
  });

  it("translates 'I/O error:' prefix to filesystem error hint", () => {
    const raw = 'I/O error: permission denied (os error 13)';
    const out = localizeMarketplaceError(raw);
    expect(out.title).toBe('文件系统错误');
    expect(out.hint).toContain('目标路径');
    expect(out.detail).toBe(raw);
  });

  it("translates 'path unsafe:' prefix to path validation hint", () => {
    const raw = 'path unsafe: contains .. component';
    const out = localizeMarketplaceError(raw);
    expect(out.title).toBe('路径校验失败');
    expect(out.hint).toContain('不安全');
    expect(out.detail).toBe(raw);
  });

  it('falls through to generic 兜底 for unknown prefixes', () => {
    const raw = 'invalid resource id: foo/bar/baz';
    const out = localizeMarketplaceError(raw);
    expect(out.title).toBe('操作失败');
    // 兜底 hint 应引导用户重试 + 用 F15 反馈
    expect(out.hint).toContain('重试');
    expect(out.hint).toContain('反馈');
    // detail 仍保留
    expect(out.detail).toBe(raw);
  });

  it('handles empty input gracefully (title + hint, no detail)', () => {
    const out = localizeMarketplaceError('');
    // 空串 → 走兜底,detail = ''
    expect(out.title).toBe('操作失败');
    expect(out.detail).toBe('');
  });
});