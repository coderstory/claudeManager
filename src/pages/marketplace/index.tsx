/**
 * F17 — 资源市场 (M2.16 real implementation).
 *
 * User flow (SPEC F17):
 *   1. 页面 mount → 调 `listMarketplaceRepos` 拉内置推荐仓库列表。
 *   2. 用户点推荐卡片「克隆并扫描」→ 调 `cloneAndScan(url)`。
 *      或在第三方输入框填 git URL → 点「克隆并扫描」。
 *   3. clone + 扫描完成 → 展示资源表格(plugin/skill/command/lsp/mcp),
 *      每行「安装」按钮。
 *   4. 点「安装」→ 调 `installFromMarketplace(repoPath, resourceId)`。
 *      成功 → 行内绿条;失败 → 行内红条;MCP → 黄条提示手动编辑。
 *
 * ## Design choices (CLAUDE.md §5 + SPEC §5.13)
 *
 * - **clone 是网络操作** → 进度态用 loader + 禁用按钮,真机可能因网络
 *   失败,代码层面做对,错误内联红条展示(CLAUDE.md §7 不静默吞错)。
 * - **install 不覆盖用户数据** → 后端 dest 已存在报错,前端红条展示。
 * - **MCP 不自动安装** → 后端返回 `installed: false` + message,前端
 *   黄条诚实提示(SPEC §6.5 不允许静默吞错)。
 * - **repo_path 原样回传** → 前端不拼路径,避免 OS 差异(CLAUDE.md §3.2)。
 * - **推荐列表硬编码** → M2 不联网拉真实索引,避免网络抖动阻塞 UI。
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

import { ErrorBanner } from '../../components/ErrorBanner';
import {
  cloneAndScan,
  installFromMarketplace,
  listMarketplaceRepos,
} from '../../lib/api/marketplace';
import type {
  InstallResult,
  MarketplaceRepo,
  ScanResult,
} from '../../lib/api/marketplace';
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
    try {
      const result = await cloneAndScan(url.trim());
      setScanResult(result);
    } catch (err) {
      setCloneError(err instanceof Error ? err.message : String(err));
    } finally {
      setCloning(false);
    }
  }, []);

  // ---- install 单个资源 ----
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

  // ---- render ----
  return (
    <div
      data-testid="marketplace-page"
      style={{
        padding: 24,
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        maxWidth: 1100,
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
          从内置推荐仓库或第三方 git URL 克隆 plugin / skill / command,
          扫描后勾选安装到 ~/.claude/。
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
          borderRadius: 8,
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
          内置推荐仓库
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
            暂无推荐仓库。
          </div>
        )}

        {repos.map((repo) => (
          <RepoCard
            key={repo.id}
            repo={repo}
            cloning={cloning}
            onClone={handleClone}
          />
        ))}
      </section>

      {/* 第三方 git URL */}
      <section
        data-testid="marketplace-custom-section"
        style={{
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
          borderRadius: 8,
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
              borderRadius: 4,
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
              borderRadius: 4,
              background: 'var(--accent)',
              color: '#fff',
              cursor:
                cloning || !customUrl.trim() ? 'not-allowed' : 'pointer',
              opacity: cloning || !customUrl.trim() ? 0.6 : 1,
            }}
          >
            {cloning ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Download size={14} />
            )}
            克隆并扫描
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
            borderRadius: 4,
            color: 'var(--accent)',
            fontSize: 13,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <Loader2 size={16} className="animate-spin" />
          正在克隆并扫描仓库(网络操作,可能需要数秒)...
        </div>
      )}

      {/* clone 错误 */}
      {cloneError && (
        <ErrorBanner
          testId="marketplace-clone-error"
          message={cloneError}
        />
      )}

      {/* 扫描结果 */}
      {scanResult && !cloning && (
        <section
          data-testid="marketplace-scan-result"
          style={{
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            borderRadius: 8,
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
              扫描结果({scanResult.resources.length} 项)
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
                  gridTemplateColumns: '1fr 90px 90px 100px',
                  gap: 12,
                  padding: '10px 14px',
                  background: 'rgba(0,0,0,0.02)',
                  borderBottom: '1px solid var(--border)',
                  fontSize: 12,
                  fontWeight: 600,
                  color: 'var(--text-secondary)',
                }}
              >
                <div>名称</div>
                <div>类型</div>
                <div style={{ textAlign: 'right' }}>大小</div>
                <div style={{ textAlign: 'right' }}>操作</div>
              </div>
              {scanResult.resources.map((resource) => (
                <ResourceInstallRow
                  key={resource.id}
                  resource={resource}
                  state={installStates[resource.id]}
                  onInstall={handleInstall}
                />
              ))}
            </>
          )}
        </section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// RepoCard — 推荐仓库卡片
// ---------------------------------------------------------------------------

function RepoCard({
  repo,
  cloning,
  onClone,
}: {
  repo: MarketplaceRepo;
  cloning: boolean;
  onClone: (url: string) => void;
}): ReactElement {
  return (
    <div
      data-testid={`marketplace-repo-card-${repo.id}`}
      style={{
        border: '1px solid var(--border)',
        borderRadius: 6,
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
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--text-primary)',
          }}
        >
          {repo.name}
        </div>
        <button
          type="button"
          data-testid={`marketplace-repo-clone-${repo.id}`}
          onClick={() => void onClone(repo.url)}
          disabled={cloning}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '4px 10px',
            fontSize: 12,
            border: '1px solid var(--accent)',
            borderRadius: 4,
            background: 'var(--bg-elevated)',
            color: 'var(--accent)',
            cursor: cloning ? 'not-allowed' : 'pointer',
            opacity: cloning ? 0.6 : 1,
          }}
        >
          <Download size={12} />
          克隆并扫描
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
    </div>
  );
}

// ---------------------------------------------------------------------------
// ResourceInstallRow — 扫描结果行 + install 按钮 + 行内状态
// ---------------------------------------------------------------------------

function ResourceInstallRow({
  resource,
  state,
  onInstall,
}: {
  resource: ResourceItem;
  state: RowInstallState | undefined;
  onInstall: (resource: ResourceItem) => void;
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
          gridTemplateColumns: '1fr 90px 90px 100px',
          gap: 12,
          padding: '10px 14px',
          alignItems: 'center',
          fontSize: 13,
        }}
      >
        <div
          style={{
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
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
              borderRadius: 4,
              background: 'var(--bg-elevated)',
              color: 'var(--text-primary)',
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.6 : 1,
            }}
          >
            {loading ? (
              <Loader2 size={12} className="animate-spin" />
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
