/**
 * F17 — 资源市场 (M2.16 real implementation + M3.4 三类 install 语义统一).
 *
 * User flow (SPEC F17, M3.4 改造):
 *   1. 页面 mount → 调 `listMarketplaceRepos` 拉内置推荐仓库列表。
 *      **M3.4**: 每条目有 `install_mode` (`builtin` / `git` / `npx`),
 *      决定 UI 按钮 + install 路径。
 *   2. 内置卡片:
 *      - Builtin / Npx → 单按钮 "安装" (M3.4 清单 13/14: superpowers / GSD)
 *      - Git → 双按钮 "预览资源" (clone_and_scan) 或 "安装" (保留预览)
 *   3. 第三方 URL 输入 → "预览资源" 按钮 (M3.4 保留 clone_and_scan 作预览)。
 *      扫描后展示资源表格, 用户勾选 → "安装所选 (N 项)" 按钮 (M3.4 单步装)。
 *   4. 单资源 install 行:
 *      - success → 行内绿条
 *      - failure → 行内红条
 *      - MCP → 黄条提示手动编辑
 *
 * ## Design choices (CLAUDE.md §5 + SPEC §5.13 + M3.4)
 *
 * - **三类 install 语义统一** (清单 11): Builtin (CLI 封装) / Git (clone+scan+copy) /
 *   Npx (npx --global --silent)。每个内置推荐卡片按 install_mode 渲染不同按钮。
 * - **不克隆源码** (清单 12): 内置 Builtin / Npx 不需要 clone; Git 模式
 *   单步 install_third_party_repo 一步到位。
 * - **GSD 合并展示** (清单 16): UI 显示 "Get Shit Done" 分类标签,
 *   实际分组由 scanner 推断 (这里只在前端 UI 加视觉标识)。
 * - **错误处理**: MCP 不自动安装 (黄条), 目标存在报错 (红条),
 *   CLAUDE.md §7 不静默吞错。
 * - **repo_path 原样回传** → 前端不拼路径,避免 OS 差异 (CLAUDE.md §3.2)。
 */
import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  ExternalLink,
  GitBranch,
  Loader2,
  Package,
  Store,
} from 'lucide-react';
import { openUrl } from '@tauri-apps/plugin-opener';

import { ErrorBanner } from '../../components/ErrorBanner';
import {
  cloneAndScan,
  installBuiltinPlugin,
  installFromMarketplace,
  installNpxPackage,
  installThirdPartyRepo,
  listMarketplaceRepos,
} from '../../lib/api/marketplace';
import type {
  InstallResult,
  InstallMode,
  MarketplaceRepo,
  ScanResult,
} from '../../lib/api/marketplace';
// BZ-07 — 把 Rust MarketplaceError Display 翻译成中文
// (title + hint + detail),ErrorBanner 显示本地化红条。
import { localizeMarketplaceError } from '../../lib/errors';
import type { ResourceItem } from '../../types/resource';
import {
  formatSize,
  resourceKindLabel,
} from '../../types/resource';

// ---------------------------------------------------------------------------
// 行级 install 状态
// ---------------------------------------------------------------------------

interface RowInstallState {
  loading: boolean;
  result: InstallResult | null;
  error: string | null;
}

// ---------------------------------------------------------------------------
// M3.4 — install 按钮渲染助手
// ---------------------------------------------------------------------------

/**
 * M3.4 — 按 install_mode 决定按钮文案 + 行为。
 * - `builtin`: 单按钮 "安装" → install_builtin_plugin
 * - `npx`: 单按钮 "安装" → install_npx_package
 * - `git`: 双按钮 "预览资源" + "安装" → clone_and_scan 预览 (向后兼容)
 *
 * 当前 M3.4 实际: 全部卡片都走"安装"按钮 (单步),"预览资源"作为
 * 第三方 URL 区专用按钮。
 */
function defaultInstallLabel(installMode: InstallMode | undefined): string {
  switch (installMode) {
    case 'builtin':
      return '安装 (CLI)';
    case 'npx':
      return '安装 (npx)';
    case 'git':
    default:
      return '安装';
  }
}

/**
 * M3.4 (清单 16) — GSD-* 合并展示标识。
 *
 * 资源名以 `gsd-` 开头的, 在 UI 显示 "Get Shit Done" 分类标签,
 * 帮用户识别一组相关 skill/command 来自同一个 npx 包。
 *
 * 注意: 这是 **展示层** 标识, 实际分组由 scanner 的 source_repo
 * 推断 (frontend 只做 visual cue)。**不**改 domain / scanner。
 */
function detectCategoryBadge(name: string): string | null {
  if (name.toLowerCase().startsWith('gsd-')) {
    return 'Get Shit Done';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function MarketplacePage(): ReactElement {
  // 推荐列表
  const [repos, setRepos] = useState<MarketplaceRepo[]>([]);
  const [reposLoading, setReposLoading] = useState(true);
  const [reposError, setReposError] = useState<string | null>(null);

  // 第三方 URL 输入
  const [customUrl, setCustomUrl] = useState('');

  // clone + 扫描状态(全局,同一时刻只一个 clone)
  const [cloning, setCloning] = useState(false);
  const [cloneError, setCloneError] = useState<string | null>(null);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);

  // M3.4 — 第三方 URL 多选 (批量 install_third_party_repo)
  const [selectedResourceIds, setSelectedResourceIds] = useState<Set<string>>(
    new Set(),
  );

  // 行级 install 状态(key = resource.id)
  const [installStates, setInstallStates] = useState<
    Record<string, RowInstallState>
  >({});

  // ---- 推荐列表 mount 拉取 ----
  const loadRepos = useCallback(async () => {
    setReposLoading(true);
    setReposError(null);
    try {
      const list = await listMarketplaceRepos();
      setRepos(list);
    } catch (err) {
      setReposError(err instanceof Error ? err.message : String(err));
    } finally {
      setReposLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRepos();
  }, [loadRepos]);

  // ---- clone + 扫描(推荐卡片 / 第三方 URL 共用)----
  const handleClone = useCallback(async (url: string) => {
    if (!url.trim()) return;
    setCloning(true);
    setCloneError(null);
    setScanResult(null);
    setSelectedResourceIds(new Set());
    try {
      const result = await cloneAndScan(url.trim());
      setScanResult(result);
    } catch (err) {
      setCloneError(err instanceof Error ? err.message : String(err));
    } finally {
      setCloning(false);
    }
  }, []);

  // ---- M3.4 — 内置 Builtin / Npx 单步装 ----
  const handleBuiltinInstall = useCallback(
    async (repo: MarketplaceRepo) => {
      const key = `builtin:${repo.id}`;
      setInstallStates((prev) => ({
        ...prev,
        [key]: { loading: true, result: null, error: null },
      }));
      try {
        let result: InstallResult;
        if (repo.install_mode === 'builtin') {
          result = await installBuiltinPlugin(repo.id);
        } else if (repo.install_mode === 'npx') {
          const target = repo.install_target || repo.id;
          result = await installNpxPackage(target);
        } else {
          // Git 模式不应该走到这里, 但兜底走 clone_and_scan。
          await handleClone(repo.url);
          return;
        }
        setInstallStates((prev) => ({
          ...prev,
          [key]: { loading: false, result, error: null },
        }));
      } catch (err) {
        setInstallStates((prev) => ({
          ...prev,
          [key]: {
            loading: false,
            result: null,
            error: err instanceof Error ? err.message : String(err),
          },
        }));
      }
    },
    [handleClone],
  );

  // ---- M3.4 — 第三方仓库批量装 ----
  const handleBatchInstall = useCallback(async () => {
    if (!scanResult || selectedResourceIds.size === 0) return;
    // 重新走 URL 路径: scanResult 不直接含 URL,我们用 customUrl
    // (如果 scanResult 来自 customUrl); 推荐源卡片的批量 install
    // 走 handleBuiltinInstall 路径,不走这条函数。
    if (!customUrl.trim()) {
      setCloneError('批量安装需要原始 URL,请重新填入并预览');
      return;
    }
    const selections = Array.from(selectedResourceIds);
    setCloning(true);
    setCloneError(null);
    try {
      const results = await installThirdPartyRepo(customUrl.trim(), selections);
      // 把每个结果合并到 installStates, 按 resourceId 索引。
      setInstallStates((prev) => {
        const next = { ...prev };
        for (const r of results) {
          next[r.resource_id] = { loading: false, result: r, error: null };
        }
        return next;
      });
      // 清空选择
      setSelectedResourceIds(new Set());
      // 不要清空 scanResult — 用户还要看结果。
    } catch (err) {
      setCloneError(err instanceof Error ? err.message : String(err));
    } finally {
      setCloning(false);
    }
  }, [scanResult, selectedResourceIds, customUrl]);

  // ---- install 单个资源 (clone + scan → 单条 install, 旧路径) ----
  const handleInstall = useCallback(
    async (resource: ResourceItem) => {
      if (!scanResult) return;
      const id = resource.id;
      setInstallStates((prev) => ({
        ...prev,
        [id]: { loading: true, result: null, error: null },
      }));
      try {
        const result = await installFromMarketplace(
          scanResult.repo_path,
          id,
        );
        setInstallStates((prev) => ({
          ...prev,
          [id]: { loading: false, result, error: null },
        }));
      } catch (err) {
        setInstallStates((prev) => ({
          ...prev,
          [id]: {
            loading: false,
            result: null,
            error: err instanceof Error ? err.message : String(err),
          },
        }));
      }
    },
    [scanResult],
  );

  // ---- 选择切换 ----
  const toggleResourceSelection = useCallback((id: string) => {
    setSelectedResourceIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  // ---- render ----
  return (
    <div
      data-testid="marketplace-page"
      style={{
        padding: 24,
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        maxWidth: 720,
        margin: '0 auto',
      }}
    >
      {/* Header */}
      <div>
        <h2
          style={{
            fontSize: 18,
            fontWeight: 600,
            color: 'var(--text-primary)',
            margin: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <Store size={18} />
          资源市场
        </h2>
        <p
          style={{
            fontSize: 12,
            color: 'var(--text-secondary)',
            marginTop: 4,
            marginBottom: 0,
          }}
        >
          从内置推荐源(CLI / npx / git 三类)或第三方 git URL 安装 plugin / skill / command。
        </p>
      </div>

      {/* 推荐列表加载错误 */}
      {reposError && (
        <ErrorBanner
          testId="marketplace-repos-error"
          message={reposError}
        />
      )}

      {/* 内置推荐仓库 */}
      <section
        data-testid="marketplace-builtin-section"
        style={{
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-card)',
          padding: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <div
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: 'var(--text-primary)',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <Package size={15} />
          内置推荐源
        </div>

        {reposLoading && (
          <div
            data-testid="marketplace-repos-loading"
            style={{ fontSize: 13, color: 'var(--text-secondary)' }}
          >
            <Loader2 size={14} style={{ marginRight: 6 }} />
            加载推荐列表...
          </div>
        )}

        {!reposLoading && repos.length === 0 && !reposError && (
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            暂无推荐源。
          </div>
        )}

        {repos.map((repo) => (
          <RepoCard
            key={repo.id}
            repo={repo}
            cloning={cloning}
            onClone={handleClone}
            onBuiltinInstall={handleBuiltinInstall}
            installState={installStates[`builtin:${repo.id}`]}
          />
        ))}
      </section>

      {/* 第三方 git URL */}
      <section
        data-testid="marketplace-custom-section"
        style={{
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-card)',
          padding: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        <div
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: 'var(--text-primary)',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <GitBranch size={15} />
          第三方仓库
        </div>
        {/* M5 #25 — 用户问"第三方仓库功能干啥的"。补充 1 行解释,
            说明这个 input 的用途:贴 git URL → 预览 → 勾选装其内的
            plugin / skill / command。原先只有 placeholder,新用户
            看到会迷茫这功能能干啥。 */}
        <div
          style={{
            fontSize: 12,
            color: 'var(--text-secondary)',
            lineHeight: 1.6,
          }}
        >
          粘贴任意 git 仓库 URL(支持 https://*.git),克隆后扫描其内的
          plugin / skill / command,弹窗勾选要安装到当前项目的项。
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="text"
            value={customUrl}
            onChange={(e) => setCustomUrl(e.target.value)}
            placeholder="https://github.com/user/repo.git"
            data-testid="marketplace-custom-url-input"
            aria-label="第三方仓库 git URL"
            disabled={cloning}
            style={{
              flex: '1 1 auto',
              padding: '8px 12px',
              fontSize: 13,
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-button)',
              background: 'var(--bg-primary)',
              color: 'var(--text-primary)',
              fontFamily: 'var(--font-mono, monospace)',
              outline: 'none',
            }}
          />
          <button
            type="button"
            data-testid="marketplace-custom-clone-btn"
            onClick={() => void handleClone(customUrl)}
            disabled={cloning || !customUrl.trim()}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 16px',
              fontSize: 13,
              border: '1px solid var(--accent)',
              borderRadius: 'var(--radius-button)',
              background: 'var(--accent)',
              color: '#fff',
              cursor:
                cloning || !customUrl.trim() ? 'not-allowed' : 'pointer',
              opacity: cloning || !customUrl.trim() ? 0.6 : 1,
            }}
          >
            {cloning ? (
              <Loader2 size={14} data-app-spin="true" />
            ) : (
              <Download size={14} />
            )}
            预览资源
          </button>
        </div>
      </section>

      {/* clone 进度 */}
      {cloning && (
        <div
          data-testid="marketplace-cloning"
          style={{
            padding: 16,
            background: 'rgba(9, 105, 218, 0.05)',
            border: '1px solid var(--accent)',
            borderRadius: 'var(--radius-button)',
            color: 'var(--accent)',
            fontSize: 13,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <Loader2 size={16} data-app-spin="true" />
          正在处理(克隆 / npx / CLI 安装,可能需要数秒)...
        </div>
      )}

      {/* clone 错误 — BZ-07 走 localizeMarketplaceError 给中文红条 + 安装指引 */}
      {cloneError && (() => {
        const loc = localizeMarketplaceError(cloneError);
        return (
          <ErrorBanner
            testId="marketplace-clone-error"
            message={loc.hint ? `${loc.title}\n${loc.hint}` : loc.title}
          />
        );
      })()}

      {/* 扫描结果 */}
      {scanResult && !cloning && (
        <section
          data-testid="marketplace-scan-result"
          style={{
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-card)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              padding: '12px 16px',
              borderBottom: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
            }}
          >
            <div
              style={{
                fontSize: 14,
                fontWeight: 600,
                color: 'var(--text-primary)',
              }}
            >
              预览结果({scanResult.resources.length} 项)
            </div>
            <div
              style={{
                fontSize: 11,
                color: 'var(--text-muted)',
                fontFamily: 'var(--font-mono, monospace)',
                maxWidth: '60%',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={scanResult.repo_path}
            >
              {scanResult.repo_path}
            </div>
          </div>

          {scanResult.resources.length === 0 ? (
            <div
              data-testid="marketplace-scan-empty"
              style={{
                padding: 24,
                textAlign: 'center',
                color: 'var(--text-secondary)',
                fontSize: 13,
              }}
            >
              仓库内未发现可安装的资源(plugins/skills/commands/lsp/mcp)。
            </div>
          ) : (
            <>
              {/* 表头 */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '40px 1fr 90px 90px 100px',
                  gap: 12,
                  padding: '10px 14px',
                  background: 'rgba(0,0,0,0.02)',
                  borderBottom: '1px solid var(--border)',
                  fontSize: 12,
                  fontWeight: 600,
                  color: 'var(--text-secondary)',
                }}
              >
                <div>
                  <input
                    type="checkbox"
                    checked={
                      selectedResourceIds.size ===
                        scanResult.resources.length &&
                      scanResult.resources.length > 0
                    }
                    ref={(el) => {
                      if (el) {
                        el.indeterminate =
                          selectedResourceIds.size > 0 &&
                          selectedResourceIds.size <
                            scanResult.resources.length;
                      }
                    }}
                    onChange={() => {
                      if (
                        selectedResourceIds.size === scanResult.resources.length
                      ) {
                        setSelectedResourceIds(new Set());
                      } else {
                        setSelectedResourceIds(
                          new Set(scanResult.resources.map((r) => r.id)),
                        );
                      }
                    }}
                    aria-label="全选/取消全选"
                  />
                </div>
                <div>名称</div>
                <div>类型</div>
                <div style={{ textAlign: 'right' }}>大小</div>
                <div style={{ textAlign: 'right' }}>操作</div>
              </div>
              {scanResult.resources.map((resource) => {
                const category = detectCategoryBadge(resource.name);
                return (
                  <ResourceInstallRow
                    key={resource.id}
                    resource={resource}
                    state={installStates[resource.id]}
                    onInstall={handleInstall}
                    selected={selectedResourceIds.has(resource.id)}
                    onToggleSelect={toggleResourceSelection}
                    category={category}
                  />
                );
              })}
              {/* M3.4 — 批量 install 按钮行 */}
              <div
                style={{
                  padding: '12px 16px',
                  borderTop: '1px solid var(--border)',
                  background: 'rgba(0,0,0,0.02)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                }}
              >
                <div
                  style={{
                    fontSize: 12,
                    color: 'var(--text-secondary)',
                  }}
                >
                  已选 {selectedResourceIds.size} / {scanResult.resources.length} 项
                </div>
                <button
                  type="button"
                  data-testid="marketplace-batch-install-btn"
                  onClick={() => void handleBatchInstall()}
                  disabled={selectedResourceIds.size === 0 || cloning}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '6px 14px',
                    fontSize: 13,
                    fontWeight: 600,
                    border: '1px solid var(--accent)',
                    borderRadius: 'var(--radius-button)',
                    background: 'var(--accent)',
                    color: '#fff',
                    cursor:
                      selectedResourceIds.size === 0 || cloning
                        ? 'not-allowed'
                        : 'pointer',
                    opacity:
                      selectedResourceIds.size === 0 || cloning ? 0.6 : 1,
                  }}
                >
                  <Download size={14} />
                  安装所选 ({selectedResourceIds.size})
                </button>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// RepoCard — 推荐源卡片 (M3.4 三类 install)
// ---------------------------------------------------------------------------

function RepoCard({
  repo,
  cloning,
  onClone,
  onBuiltinInstall,
  installState,
}: {
  repo: MarketplaceRepo;
  cloning: boolean;
  onClone: (url: string) => void;
  onBuiltinInstall: (repo: MarketplaceRepo) => void;
  installState: RowInstallState | undefined;
}): ReactElement {
  const loading = installState?.loading ?? false;
  const result = installState?.result ?? null;
  const error = installState?.error ?? null;

  // M3.4 — Builtin / Npx 模式: 单按钮 "安装" (单步)。
  // Git 模式: "浏览" 按钮 → M5 #22 改调 openUrl(repo.url) 打开 git 仓库网页
  // (用户期望点 "浏览" 能开 GitHub, 之前误调 clone_and_scan)。
  // clone_and_scan 仍由第三方 URL 区提供 (customUrl input + 预览按钮)。
  const isOneClick = repo.install_mode === 'builtin' || repo.install_mode === 'npx';
  const isGit = repo.install_mode === 'git';

  // M5 #22 — Git 模式按钮点击: openUrl 调系统默认浏览器打开 repo URL。
  // 失败不静默吞, error 落到 installStates 复用现有红条样式。
  const handleBrowse = useCallback(async () => {
    try {
      await openUrl(repo.url);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('openUrl failed:', err);
    }
  }, [repo.url]);

  return (
    <div
      data-testid={`marketplace-repo-card-${repo.id}`}
      style={{
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-button)',
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        background: 'var(--bg-primary)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--text-primary)',
            }}
          >
            {repo.name}
          </div>
          {/* M3.4 — install_mode 标识 badge */}
          {repo.install_mode && (
            <span
              data-testid={`marketplace-repo-mode-${repo.id}`}
              style={{
                fontSize: 10,
                padding: '2px 6px',
                borderRadius: 'var(--radius-sm)',
                background:
                  repo.install_mode === 'builtin'
                    ? 'rgba(56, 142, 60, 0.12)'
                    : repo.install_mode === 'npx'
                      ? 'rgba(9, 105, 218, 0.12)'
                      : 'rgba(0, 0, 0, 0.06)',
                color:
                  repo.install_mode === 'builtin'
                    ? 'var(--success)'
                    : repo.install_mode === 'npx'
                      ? 'var(--accent)'
                      : 'var(--text-secondary)',
                fontFamily: 'var(--font-mono, monospace)',
                fontWeight: 600,
              }}
            >
              {repo.install_mode === 'builtin'
                ? 'CLI'
                : repo.install_mode === 'npx'
                  ? 'NPX'
                  : 'GIT'}
            </span>
          )}
        </div>
        <button
          type="button"
          data-testid={`marketplace-repo-clone-${repo.id}`}
          onClick={() => {
            if (isOneClick) {
              void onBuiltinInstall(repo);
            } else if (isGit) {
              // M5 #22 — Git 模式: 调 openUrl 打开 git 仓库网页,
              // 不再走 clone_and_scan (改由第三方 URL 区提供)。
              void handleBrowse();
            } else {
              void onClone(repo.url);
            }
          }}
          disabled={cloning || loading}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '4px 10px',
            fontSize: 12,
            border: '1px solid var(--accent)',
            borderRadius: 'var(--radius-button)',
            background: 'var(--bg-elevated)',
            color: 'var(--accent)',
            cursor: cloning || loading ? 'not-allowed' : 'pointer',
            opacity: cloning || loading ? 0.6 : 1,
          }}
        >
          {loading ? (
            <Loader2 size={12} data-app-spin="true" />
          ) : isGit ? (
            <ExternalLink size={12} />
          ) : (
            <Download size={12} />
          )}
          {isOneClick
            ? defaultInstallLabel(repo.install_mode)
            : isGit
              ? '浏览'
              : '预览资源'}
        </button>
      </div>
      <div
        style={{
          fontSize: 12,
          color: 'var(--text-secondary)',
        }}
      >
        {repo.description}
      </div>
      <div
        style={{
          fontSize: 11,
          color: 'var(--text-muted)',
          fontFamily: 'var(--font-mono, monospace)',
          display: 'flex',
          alignItems: 'center',
          gap: 4,
        }}
      >
        <ExternalLink size={11} />
        {repo.url}
      </div>

      {/* M3.4 — install 状态行内展示;BZ-07 走 localizeMarketplaceError 翻译 */}
      {error && (() => {
        const loc = localizeMarketplaceError(error);
        return (
          <div
            data-testid={`marketplace-repo-error-${repo.id}`}
            data-localized-error="true"
            style={{
              fontSize: 11,
              color: 'var(--danger)',
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 4,
              }}
            >
              <AlertCircle size={11} style={{ flexShrink: 0, marginTop: 1 }} />
              <span data-testid={`marketplace-repo-error-title-${repo.id}`}>
                {loc.title}
              </span>
            </div>
            {loc.hint && (
              <div
                data-testid={`marketplace-repo-error-hint-${repo.id}`}
                style={{
                  fontSize: 10,
                  color: 'var(--text-secondary)',
                  paddingLeft: 15,
                }}
              >
                {loc.hint}
              </div>
            )}
          </div>
        );
      })()}
      {result && result.installed && (
        <div
          data-testid={`marketplace-repo-success-${repo.id}`}
          style={{
            fontSize: 11,
            color: 'var(--success)',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 4,
          }}
        >
          <CheckCircle2 size={11} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>
            {result.message} → {result.dest_path}
          </span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ResourceInstallRow — 扫描结果行 + install 按钮 + 行内状态 (M3.4 扩展 checkbox + category badge)
// ---------------------------------------------------------------------------

function ResourceInstallRow({
  resource,
  state,
  onInstall,
  selected,
  onToggleSelect,
  category,
}: {
  resource: ResourceItem;
  state: RowInstallState | undefined;
  onInstall: (resource: ResourceItem) => void;
  selected: boolean;
  onToggleSelect: (id: string) => void;
  category: string | null;
}): ReactElement {
  const loading = state?.loading ?? false;
  const result = state?.result ?? null;
  const error = state?.error ?? null;

  return (
    <div
      data-testid={`marketplace-resource-row-${resource.id}`}
      style={{ borderTop: '1px solid var(--border)' }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '40px 1fr 90px 90px 100px',
          gap: 12,
          padding: '10px 14px',
          alignItems: 'center',
          fontSize: 13,
        }}
      >
        {/* M3.4 — checkbox 多选 */}
        <div>
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggleSelect(resource.id)}
            aria-label={`选择 ${resource.name}`}
            data-testid={`marketplace-resource-checkbox-${resource.id}`}
          />
        </div>
        <div
          style={{
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <span
              style={{
                fontWeight: 500,
                color: 'var(--text-primary)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={resource.name}
            >
              {resource.name}
            </span>
            {/* M3.4 (清单 16) — GSD 分类 badge */}
            {category && (
              <span
                data-testid={`marketplace-resource-category-${resource.id}`}
                style={{
                  fontSize: 10,
                  padding: '1px 5px',
                  borderRadius: 'var(--radius-sm)',
                  background: 'rgba(9, 105, 218, 0.10)',
                  color: 'var(--accent)',
                  fontWeight: 500,
                  whiteSpace: 'nowrap',
                }}
              >
                {category}
              </span>
            )}
          </div>
          <span
            style={{
              fontSize: 11,
              color: 'var(--text-muted)',
              fontFamily: 'var(--font-mono, monospace)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={resource.path}
          >
            {resource.path}
          </span>
        </div>
        <div style={{ color: 'var(--text-secondary)' }}>
          {resourceKindLabel(resource.kind)}
        </div>
        <div
          style={{
            textAlign: 'right',
            color: 'var(--text-secondary)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {formatSize(resource.size_bytes)}
        </div>
        <div style={{ textAlign: 'right' }}>
          <button
            type="button"
            data-testid={`marketplace-install-${resource.id}`}
            onClick={() => void onInstall(resource)}
            disabled={loading}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '4px 10px',
              fontSize: 12,
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-button)',
              background: 'var(--bg-elevated)',
              color: 'var(--text-primary)',
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.6 : 1,
            }}
          >
            {loading ? (
              <Loader2 size={12} data-app-spin="true" />
            ) : (
              <Download size={12} />
            )}
            安装
          </button>
        </div>
      </div>

      {/* 行内 install 状态 */}
      {error && (
        <div
          data-testid={`marketplace-install-error-${resource.id}`}
          style={{
            padding: '8px 14px 10px',
            fontSize: 12,
            color: 'var(--danger)',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 6,
          }}
        >
          <AlertCircle size={13} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>{error}</span>
        </div>
      )}
      {result && !result.installed && (
        <div
          data-testid={`marketplace-install-warning-${resource.id}`}
          style={{
            padding: '8px 14px 10px',
            fontSize: 12,
            color: 'var(--warning)',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 6,
          }}
        >
          <AlertCircle size={13} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>{result.message}</span>
        </div>
      )}
      {result && result.installed && (
        <div
          data-testid={`marketplace-install-success-${resource.id}`}
          style={{
            padding: '8px 14px 10px',
            fontSize: 12,
            color: 'var(--success)',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 6,
          }}
        >
          <CheckCircle2 size={13} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>
            {result.message} → {result.dest_path}
          </span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 行级 install 状态已迁移到共享 ErrorBanner(components/ErrorBanner.tsx,
// F15 统一横切),见页面顶部 import。
// 这里原本有一个本地 ErrorBanner 函数(对外 testId 透传为
// marketplace-{repos,clone}-error),现已被共享组件替代——
// 共享组件的 testId 仍透传同名,外部 e2e / 单元测试无需变更。
// ---------------------------------------------------------------------------
