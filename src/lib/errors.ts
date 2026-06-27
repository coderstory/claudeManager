/**
 * BZ-07 — Marketplace install error 本地化 (zh-CN)
 *
 * 集中管理「本地化文案」(per CLAUDE.md §6.4: 显示文案 3 处同步),
 * 不再在 marketplace 页面 inline 翻译 Rust MarketplaceError 字样。
 *
 * ## Why this exists
 *
 * Rust `MarketplaceError::Display` 返回的字串是英文 / 半中英混合
 * (例如 `"无法启动 'claude' CLI (请确认已安装)"` — 见
 * `src-tauri/src/services/marketplace_service.rs::MarketplaceError`)。
 *
 * 这层翻译放在前端,因为:
 * 1. **不破坏 IPC contract**: 后端 Display 字符串已 ship,前端
 *    翻译是纯展示层 (CLAUDE.md §2.4 不改 Rust enum);
 * 2. **不用 i18n 库**: CLAUDE.md §2.3 零新依赖,简单字符串匹配
 *    比拉 i18next 划算得多;
 * 3. **文案可测试**: 函数纯字符串 → 入 → 出,Vitest 单测覆盖
 *    5 类(CliNotFound 3 + Git + 兜底)。
 *
 * ## 输入约定
 *
 * 输入是 `Error.message` 字符串(Tauri IPC 把 Rust Display 转成
 * JS Error 后 message 字段带过来)。我们匹配 MarketplaceError
 * 的 `#[error("...")]` 模板字串的前缀。
 *
 * ## 输出约定
 *
 * 返回 `{ title, hint, detail? }`:
 * - `title`: 中文短标题 (1 行,展示在 ErrorBanner 第一行)
 * - `hint`: 中文可执行建议 (安装指引 / 下一步动作)
 * - `detail?`: 原始英文/混合错误 (放第二行,detail 不脱敏,
 *   但调用方应自己 sanitize — 本函数不引入新脱敏逻辑)
 *
 * ## 安全 (T-28-02)
 *
 * `detail` 字段来自 Rust 原 Display,不暴露 token / 绝对路径
 * (Rust 端 MarketplaceError 已避免暴露敏感字段 — 见各 variant
 * 定义)。如未来新增 variant 暴露敏感字段,前端展示前应自行
 * sanitize。
 */
export interface LocalizedError {
  /** 中文短标题 (ErrorBanner 第一行) */
  title: string;
  /** 中文可执行建议 (安装指引 / 下一步动作) */
  hint: string;
  /** 原始错误字串 (放 detail 折叠区,不脱敏) */
  detail?: string;
}

// ---------------------------------------------------------------------------
// BZ-07 — CliNotFound (M5 user bug #23 + #24)
// ---------------------------------------------------------------------------

/**
 * CLI 找不到 (claude / npx / git) — 给中文标题 + 各 OS 安装指引。
 *
 * `cmd` 是 CLI 工具名 (e.g. "claude" / "npx" / "git")。
 */
function cliNotFoundHint(cmd: string): string {
  switch (cmd) {
    case 'claude':
      return '请安装 Claude Code (macOS: `brew install claude-code`; Windows: 访问 https://claude.com/download 下载安装包)';
    case 'npx':
      return '请安装 Node.js (macOS: `brew install node`; Windows: 下载 Node.js LTS 安装包 https://nodejs.org)';
    case 'git':
      return '请安装 Git (macOS: `xcode-select --install` 或 `brew install git`; Windows: 下载 Git for Windows https://git-scm.com/download/win)';
    default:
      // 兜底:未知 CLI 名。给通用"PATH 上找不到"提示 + 让用户自查。
      return `请确认 \`${cmd}\` 已安装并在 PATH 中 (macOS: \`brew install ${cmd}\`; Windows: 检查安装路径是否在 PATH)`;
  }
}

/**
 * 解析 "无法启动 '<cmd>' CLI ..." 字串,拿 cmd 名。
 *
 * MarketplaceError::CliNotFound 的 Display 模板是
 * `无法启动 '{cmd}' CLI (请确认已安装)`,所以用 regex 提取 cmd 名。
 */
function extractCliFromNotFound(raw: string): string | null {
  const m = /无法启动 '([^']+)' CLI/.exec(raw);
  return m ? m[1] : null;
}

// ---------------------------------------------------------------------------
// 入口 — localizeMarketplaceError
// ---------------------------------------------------------------------------

/**
 * 把 Rust MarketplaceError Display 字符串翻译成中文。
 *
 * 匹配顺序:
 * 1. CliNotFound (`无法启动 '<cmd>' CLI ...`) — 5 类 CLI 各给安装指引
 * 2. Git (`git error: ...`) — title + 保留 detail
 * 3. Io (`I/O error: ...`) — title + 保留 detail
 * 4. PathUnsafe (`path unsafe: ...`) — title + 保留 detail
 * 5. InvalidResourceId / DestExists / RootNotFound — 通用 title + 保留 detail
 * 6. 兜底 — 通用 title,原样 detail
 *
 * @param rawError 后端 IPC 抛错的 message (Rust Display 字符串)
 * @returns 中文 { title, hint, detail? }
 */
export function localizeMarketplaceError(rawError: string): LocalizedError {
  const detail = rawError;

  // 1. CliNotFound — 最优先,因为最常见 + 给完整安装指引
  const cmd = extractCliFromNotFound(rawError);
  if (cmd !== null) {
    return {
      title: `无法启动 ${cmd} 命令行工具`,
      hint: cliNotFoundHint(cmd),
      detail,
    };
  }

  // 2. Git error (网络 / 认证 / 无效 URL — git CLI 在 PATH 但调用失败)
  if (/^git error:/i.test(rawError)) {
    return {
      title: 'Git 操作失败',
      hint: '请检查网络、git 仓库 URL 与 SSH key / token 配置',
      detail,
    };
  }

  // 3. Io error (文件 / 目录 / 权限)
  if (/^(I\/O error|IO error):/i.test(rawError)) {
    return {
      title: '文件系统错误',
      hint: '请检查目标路径是否可写、磁盘空间是否充足',
      detail,
    };
  }

  // 4. PathUnsafe (slug 校验 / 路径穿越防护)
  if (/^path unsafe:/i.test(rawError)) {
    return {
      title: '路径校验失败',
      hint: '资源路径包含不安全字符,请联系仓库维护者',
      detail,
    };
  }

  // 5. InvalidResourceId / DestExists / RootNotFound / 其它 — 通用兜底
  return {
    title: '操作失败',
    hint: '请重试;若问题持续,请通过"反馈"按钮上报 (F15 错误反馈)',
    detail,
  };
}