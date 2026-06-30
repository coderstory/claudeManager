/**
 * AboutPage — 关于页 (M3.7 — 清单 18)。
 *
 * 4 分区:
 *   1. 版本信息 —— 从 `get_app_metadata` IPC 读取(version / identifier /
 *      git_commit / build_target / build_timestamp)
 *   2. 许可证 —— MIT, 项目主页占位(待 M4 公证阶段补真实链接)
 *   3. 致谢 —— Tauri / React / cc-switch 引用
 *   4. 技术栈 —— 前端 / 后端 / 设计 token
 *
 * 复用 F8 时代的 IPC:不新增 command,直接调 `get_app_metadata` 拿 5 字段
 * (F8 页面已在 M5 #18 移除,但 IPC `get_app_metadata` 由 about 页消费)。
 * 清单 18 "build hash" 语义 = git short SHA,即 `git_commit` 字段。
 *
 * 设计原则:
 *   - 全部样式 inline `style={{}}`,沿用 F8 时代确立的模式
 *     (项目无 Tailwind 管线,见 CLAUDE.md §2.4)。
 *   - 复用 AboutCard + InfoSection 通用组件。
 *   - 复用 ErrorBanner 显示 IPC 错误(清单 18 不破坏错误语义)。
 *   - LICENSE 用 embedded string(项目根目录无 LICENSE 文件,M4 公证阶段
 *     补真实仓库链接 + 改用 fetch('/LICENSE'))。
 */
import { useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { AlertCircle } from 'lucide-react';

import { getAppMetadata } from '../../lib/api/app';
import type { AppMetadata } from '../../types/app';
import { AboutCard } from '../../components/AboutCard';
import { InfoSection, type InfoItem } from '../../components/InfoSection';
import { Pagination } from '../../components/Pagination';
import { formatDateTime } from '../../lib/formatTime';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface PageState {
  metadata: AppMetadata | null;
  loading: boolean;
  error: string | null;
}

const INITIAL_STATE: PageState = {
  metadata: null,
  loading: true,
  error: null,
};

// ---------------------------------------------------------------------------
// Static content (no IPC needed)
// ---------------------------------------------------------------------------

const LICENSE_TYPE = 'MIT';

// UI-A-05 (2026-06-27) — 项目主页 URL 改由 Rust IPC `get_app_metadata`
// 返回的 `homepage_url` 字段持有 (src-tauri/src/commands/app.rs::HOMEPAGE_URL
// 常量),不再硬编码在前端常量 (CLAUDE.md §6.4 三处同步: 前端字符串 +
// Rust IPC 常量 + 测试 fixture)。这样改 URL 时:
//   1. 改 Rust HOMEPAGE_URL (单点)
//   2. 改测试 fixture sampleMetadata
//   3. 不用动前端代码 (前端只从 metadata 读)
// Fallback 在 metadata 加载失败时用,避免 UI 空白 (CLAUDE.md §7)。
const HOMEPAGE_FALLBACK = 'https://github.com/coderstory/claudeManager';

const CREDITS: ReadonlyArray<{ label: string; value: string }> = [
  {
    label: 'Tauri',
    value: '跨平台桌面框架 (v2, Rust + WebView)',
  },
  {
    label: 'React',
    value: '前端 UI 库 (v19)',
  },
  {
    label: 'cc-switch',
    value: '产品形态 / UX 参考',
  },
];

const STACK: ReadonlyArray<{ label: string; value: string }> = [
  {
    label: '前端',
    value: 'React 19 + TypeScript 5.8 + Vite 7',
  },
  {
    label: '后端',
    value: 'Rust + Tauri v2',
  },
];

// 致谢列表分页大小 — 沿用 history 表 (#31) 的 20 条 / 页, UX 一致。
const CREDITS_PAGE_SIZE = 20;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTimestamp(epochSec: number): string {
  if (!epochSec || epochSec <= 0) return '未知';
  const d = new Date(epochSec * 1000);
  if (Number.isNaN(d.getTime())) return '未知';
  return formatDateTime(epochSec);
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AboutPage(): ReactElement {
  // v3.4.1 TEMP — synthetic error to validate the ErrorBoundary
  // toast. Revert this line to ship.
  if (typeof window !== 'undefined' && window.location.hash === '#__test_throw') {
    throw new Error("AboutPage synthetic error: this is a test exception for the ErrorBoundary toast (v3.4.1)");
  }
  const [state, setState] = useState<PageState>(INITIAL_STATE);
  // 致谢列表分页状态 (0-indexed), 默认第 1 页。
  const [creditsPage, setCreditsPage] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void getAppMetadata()
      .then((metadata) => {
        if (cancelled) return;
        setState({ metadata, loading: false, error: null });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        setState({ metadata: null, loading: false, error: msg });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const m = state.metadata;

  // 致谢列表当前页切片。Pattern 与 UsageHistoryTable (#31) 一致。
  const creditsPageStart = creditsPage * CREDITS_PAGE_SIZE;
  const pageCredits = CREDITS.slice(
    creditsPageStart,
    creditsPageStart + CREDITS_PAGE_SIZE,
  );

  // 版本信息 key-value 列表(IPC 失败时仍渲染,值降级为"加载中..."/"未知")
  const versionItems: ReadonlyArray<InfoItem> = useMemo(
    () => [
      {
        testId: 'about-app-name',
        label: '应用名',
        value: m?.product_name ?? '加载中...',
      },
      {
        testId: 'about-version',
        label: '版本号',
        value: m?.version ?? '加载中...',
        mono: true,
      },
      {
        testId: 'about-build-hash',
        label: 'Build hash',
        value: m?.git_commit ?? '加载中...',
        mono: true,
      },
      {
        testId: 'about-build-target',
        label: '目标平台',
        value: m?.build_target ?? '加载中...',
        mono: true,
      },
      {
        testId: 'about-build-timestamp',
        label: '构建时间',
        value: m ? formatTimestamp(m.build_timestamp) : '加载中...',
      },
      {
        testId: 'about-identifier',
        label: '唯一标识',
        value: m?.identifier ?? '加载中...',
        mono: true,
      },
    ],
    [m],
  );

  return (
    <div
      style={{
        marginLeft: 'auto',
        marginRight: 'auto',
        width: '100%',
        maxWidth: 720,
        padding: 24,
      }}
      data-testid="about-page"
    >
      <header style={{ marginBottom: 'var(--space-4)' }}>
        <h1
          style={{
            color: 'var(--text-primary)',
            fontSize: 'var(--fs-heading)',
            fontWeight: 600,
            margin: 0,
          }}
        >
          关于 Claude 配置管理器
        </h1>
        <p
          style={{
            color: 'var(--text-secondary)',
            fontSize: 14,
            marginTop: 4,
          }}
        >
          跨平台桌面工具,帮助用户在多个 Claude Code provider 配置之间快速切换 + 安全管理 + 实时监控用量。
        </p>
      </header>

      {/* IPC error */}
      {state.error && (
        <div
          data-testid="about-metadata-error"
          role="alert"
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 8,
            borderRadius: 'var(--radius-button)',
            border: '1px solid rgba(211, 47, 47, 0.3)',
            background: 'rgba(211, 47, 47, 0.05)',
            padding: 12,
            fontSize: 14,
            color: 'var(--danger)',
            marginBottom: 16,
          }}
        >
          <AlertCircle
            aria-hidden="true"
            style={{
              marginTop: 2,
              height: 16,
              width: 16,
              flexShrink: 0,
            }}
          />
          <span>{state.error}</span>
        </div>
      )}

      {/* 【1】版本信息 */}
      <AboutCard
        testId="about-version-section"
        title="版本信息"
        description="当前运行的构建版本与目标平台。"
      >
        <InfoSection items={versionItems} />
      </AboutCard>

      {/* 【2】许可证 */}
      <AboutCard
        testId="about-license-section"
        title="许可证"
        description="本项目采用 MIT 许可证,允许自由使用 / 修改 / 分发。"
      >
        {/* M5 bug #32 — 项目主页单独一行展示.
         * 原来用 2 列 grid 把 "许可证" 和 "项目主页" 并排, 视觉混乱.
         * 改为单列纵向, 每项独占一行, 项目主页 URL 单独占据完整宽度. */}
        <dl
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            margin: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
            <dt
              style={{
                width: 80,
                flexShrink: 0,
                color: 'var(--text-muted)',
                fontSize: 12,
              }}
            >
              许可证
            </dt>
            <dd
              data-testid="about-license-type"
              style={{
                color: 'var(--text-primary)',
                fontSize: 14,
                margin: 0,
              }}
            >
              {LICENSE_TYPE}
            </dd>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
            <dt
              style={{
                width: 80,
                flexShrink: 0,
                color: 'var(--text-muted)',
                fontSize: 12,
              }}
            >
              项目主页
            </dt>
            <dd
              data-testid="about-license-homepage"
              style={{
                color: 'var(--text-primary)',
                fontSize: 14,
                fontFamily: 'var(--font-mono)',
                margin: 0,
              }}
            >
              {m?.homepage_url ?? HOMEPAGE_FALLBACK}
            </dd>
          </div>
        </dl>
      </AboutCard>

      {/* 【3】致谢 */}
      <AboutCard
        testId="about-credits-section"
        title="致谢"
        description="感谢以下开源项目提供基础能力。"
      >
        <ul
          style={{
            listStyle: 'none',
            padding: 0,
            margin: 0,
          }}
        >
          {pageCredits.map((c) => (
            <li
              key={c.label}
              style={{ marginBottom: 8, fontSize: 14, color: 'var(--text-primary)' }}
            >
              <strong style={{ color: 'var(--accent)' }}>{c.label}</strong>
              <span style={{ color: 'var(--text-secondary)' }}> — {c.value}</span>
            </li>
          ))}
        </ul>
        <Pagination
          total={CREDITS.length}
          page={creditsPage}
          pageSize={CREDITS_PAGE_SIZE}
          onPageChange={setCreditsPage}
          testIdPrefix="about-credits-pagination"
        />
      </AboutCard>

      {/* 【4】技术栈 */}
      <AboutCard
        testId="about-stack-section"
        title="技术栈"
        description="构建本应用所使用的框架与工具链。"
      >
        <ul
          style={{
            listStyle: 'none',
            padding: 0,
            margin: 0,
          }}
        >
          {STACK.map((s) => (
            <li
              key={s.label}
              style={{ marginBottom: 8, fontSize: 14, color: 'var(--text-primary)' }}
            >
              <strong style={{ color: 'var(--text-primary)' }}>{s.label}</strong>
              <span style={{ color: 'var(--text-secondary)' }}> — {s.value}</span>
            </li>
          ))}
        </ul>
      </AboutCard>
    </div>
  );
}
