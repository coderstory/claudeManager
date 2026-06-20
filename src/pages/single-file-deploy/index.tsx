/**
 * F8 — 单文件部署 (M2.8 real implementation).
 *
 * Replaces the M1.9 PluginPlaceholder. The page has two zones:
 *
 *   1. **App metadata card** — read-only snapshot of the running
 *      app: version, identifier, product name, git commit, build
 *      target, build timestamp. Sourced via `getAppMetadata()` IPC.
 *
 *   2. **Installer-command panel** — collapsed by default. When the
 *      user clicks "查看 installer 生成命令", the panel reveals
 *      three shell commands they can run from the project root:
 *        - bash scripts/build-installer.sh windows
 *        - bash scripts/build-installer.sh macos
 *        - sha256sum -c installers/*.sha256
 *
 * ## M2.8 design principle (per docs/design/M2.8-dataflow.md §2)
 *
 * The Tauri process does NOT spawn `tauri build` itself. Reasons:
 *   - tauri build takes 5-10 minutes; would block IPC indefinitely
 *   - reliable progress streaming requires a sidecar (M3+)
 *   - tooling assumptions (NSIS, code signing, notarize) are
 *     environment-specific and don't belong inside the app process
 *
 * So the page is **guidance + provenance**, not a one-click builder.
 * That ships in M3+ via tauri-plugin-shell sidecar.
 *
 * ## Error semantics (CLAUDE.md §7 — "不允许静默吞错")
 *
 * - IPC error → InfoBar with the user-readable message.
 * - `build_timestamp === 0` (build.rs couldn't read the clock) →
 *   render "未知" rather than the meaningless 1970 epoch date.
 *
 * ## M2.x-inline
 *
 * Previously this page composed ~25 Tailwind utility classes
 * (`mx-auto w-full max-w-4xl p-6`, `mb-6 flex items-center
 * justify-between`, `rounded-lg border border-border bg-bg-elevated
 * p-4 shadow-sm`, `inline-flex items-center gap-1.5 rounded
 * border border-border bg-bg-elevated px-3 py-1.5 text-sm
 * text-text-primary hover:bg-bg-overlay`, etc). The project has
 * no Tailwind pipeline, so all those classes silently noop'd
 * on the real Tauri WebView2 release exe. Every utility class
 * is now inlined as `style={{}}` properties; the one hover rule
 * (`hover:bg-bg-overlay` on the toggle button) lives in
 * src/design-system/utilities.css under [data-app-cmd-toggle].
 */
import { useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { AlertCircle, Terminal } from 'lucide-react';

import { getAppMetadata } from '../../lib/api/app';
import type { AppMetadata } from '../../types/app';

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
// Helpers
// ---------------------------------------------------------------------------

function formatTimestamp(epochSec: number): string {
  if (!epochSec || epochSec <= 0) return '未知';
  const d = new Date(epochSec * 1000);
  if (Number.isNaN(d.getTime())) return '未知';
  return d.toLocaleString();
}

const INSTALLER_COMMANDS: ReadonlyArray<{
  label: string;
  cmd: string;
  hint: string;
}> = [
  {
    label: 'Windows (NSIS, 单 .exe installer)',
    cmd: 'bash scripts/build-installer.sh windows',
    hint: '生成 installers/<product>_<version>_x64-setup.exe + .sha256',
  },
  {
    label: 'macOS (DMG)',
    cmd: 'bash scripts/build-installer.sh macos',
    hint: '生成 installers/<product>_<version>_x64.dmg + .sha256（需 macOS 主机）',
  },
  {
    label: '校验 SHA256',
    cmd: 'sha256sum -c installers/*.sha256',
    hint: '从校验和文件验证 installer 完整性',
  },
];

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function SingleFileDeployPage(): ReactElement {
  const [state, setState] = useState<PageState>(INITIAL_STATE);
  const [showCommands, setShowCommands] = useState(false);

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

  const timestampLabel = useMemo(
    () =>
      state.metadata ? formatTimestamp(state.metadata.build_timestamp) : '加载中...',
    [state.metadata],
  );

  return (
    <div
      style={{
        marginLeft: 'auto',
        marginRight: 'auto',
        width: '100%',
        maxWidth: 896,
        padding: 24,
      }}
      data-testid="single-file-deploy-page"
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
          单文件部署
        </h1>
        <p
          style={{
            color: 'var(--text-secondary)',
            fontSize: 14,
            marginTop: 4,
          }}
        >
          应用 = 一个可执行文件，无外部 .NET / Node / Python runtime 依赖。
          下方展示当前运行版本与构建信息；installer 由本地脚本生成。
        </p>
      </header>

      {/* IPC error */}
      {state.error && (
        <div
          data-testid="app-metadata-error"
          role="alert"
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 8,
            borderRadius: 6,
            // --danger at 30% alpha (was `border-danger/30`).
            border: '1px solid rgba(211, 47, 47, 0.3)',
            // --danger at 5% alpha (was `bg-danger/5`).
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

      {/* Metadata card */}
      <section
        style={{
          marginBottom: 24,
          borderRadius: 8,
          border: '1px solid var(--border)',
          background: 'var(--bg-elevated)',
          padding: 16,
          boxShadow: 'var(--shadow-sm)',
        }}
        data-testid="app-metadata-card"
        aria-label="当前应用元数据"
      >
        <h2
          style={{
            color: 'var(--text-secondary)',
            fontSize: 14,
            fontWeight: 500,
            marginBottom: 12,
          }}
        >
          当前应用
        </h2>
        <dl
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
            columnGap: 24,
            rowGap: 8,
            margin: 0,
          }}
        >
          <MetaRow
            testId="meta-product-name"
            label="名称"
            value={state.metadata?.product_name ?? '加载中...'}
          />
          <MetaRow
            testId="meta-version"
            label="版本"
            value={state.metadata?.version ?? '加载中...'}
            mono
          />
          <MetaRow
            testId="meta-identifier"
            label="标识"
            value={state.metadata?.identifier ?? '加载中...'}
            mono
          />
          <MetaRow
            testId="meta-git-commit"
            label="提交"
            value={state.metadata?.git_commit ?? '加载中...'}
            mono
          />
          <MetaRow
            testId="meta-build-target"
            label="目标"
            value={state.metadata?.build_target ?? '加载中...'}
            mono
          />
          <MetaRow
            testId="meta-build-timestamp"
            label="构建时间"
            value={timestampLabel}
          />
        </dl>
      </section>

      {/* Installer-command panel toggle */}
      <button
        type="button"
        onClick={() => setShowCommands((v) => !v)}
        aria-expanded={showCommands}
        data-testid="toggle-commands-btn"
        // M2.x-inline: hover rule lives in src/design-system/utilities.css
        // under [data-app-cmd-toggle] (was Tailwind `hover:bg-bg-overlay`).
        data-app-cmd-toggle="true"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          borderRadius: 4,
          border: '1px solid var(--border)',
          background: 'var(--bg-elevated)',
          paddingLeft: 12,
          paddingRight: 12,
          paddingTop: 6,
          paddingBottom: 6,
          fontSize: 14,
          color: 'var(--text-primary)',
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        <Terminal
          aria-hidden="true"
          style={{ height: 16, width: 16 }}
        />
        {showCommands ? '隐藏' : '查看'} installer 生成命令
      </button>

      {showCommands && (
        <section
          style={{
            marginTop: 12,
            borderRadius: 8,
            border: '1px solid var(--border)',
            background: 'var(--bg-elevated)',
            padding: 16,
            boxShadow: 'var(--shadow-sm)',
          }}
          data-testid="installer-commands-panel"
          aria-label="installer 生成命令"
        >
          <p
            style={{
              color: 'var(--text-secondary)',
              fontSize: 14,
              marginBottom: 12,
            }}
          >
            从项目根目录运行以下命令；产物会写入{' '}
            <code
              style={{
                borderRadius: 4,
                background: 'var(--bg-overlay)',
                paddingLeft: 4,
                paddingRight: 4,
                paddingTop: 2,
                paddingBottom: 2,
                fontSize: 12,
                color: 'var(--text-primary)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              installers/
            </code>
            。
          </p>
          <ol
            style={{
              listStyle: 'none',
              padding: 0,
              margin: 0,
            }}
          >
            {INSTALLER_COMMANDS.map((c) => (
              <li key={c.cmd} style={{ marginBottom: 12 }}>
                <div
                  style={{
                    color: 'var(--text-muted)',
                    fontSize: 12,
                  }}
                >
                  {c.label}
                </div>
                <pre
                  style={{
                    marginTop: 4,
                    overflowX: 'auto',
                    borderRadius: 4,
                    border: '1px solid var(--border)',
                    background: '#1F2328',
                    padding: 8,
                    fontSize: 12,
                    color: '#FAFAF7',
                    fontFamily: 'var(--font-mono)',
                    margin: '4px 0 0 0',
                  }}
                >
                  <code>{c.cmd}</code>
                </pre>
                <div
                  style={{
                    color: 'var(--text-muted)',
                    fontSize: 12,
                    marginTop: 4,
                  }}
                >
                  {c.hint}
                </div>
              </li>
            ))}
          </ol>
          <p
            style={{
              color: 'var(--text-muted)',
              fontSize: 12,
              marginTop: 12,
            }}
          >
            说明：M2.8 阶段 UI 仅展示与引导，实际编译由本地 shell 触发，避免在
            Tauri 主进程内长时间阻塞。M3+ 引入 sidecar 后会接入按钮一键构建。
          </p>
        </section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tiny metadata row component (kept inline; not exported).
// ---------------------------------------------------------------------------

interface MetaRowProps {
  testId: string;
  label: string;
  value: string;
  mono?: boolean;
}

function MetaRow({ testId, label, value, mono }: MetaRowProps): ReactElement {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 12,
      }}
    >
      <dt
        style={{
          width: 80,
          flexShrink: 0,
          color: 'var(--text-muted)',
          fontSize: 12,
        }}
      >
        {label}
      </dt>
      <dd
        style={{
          color: 'var(--text-primary)',
          fontSize: 14,
          fontFamily: mono ? 'var(--font-mono)' : 'inherit',
          fontVariantNumeric: mono ? 'tabular-nums' : 'normal',
          margin: 0,
        }}
        data-testid={testId}
      >
        {value}
      </dd>
    </div>
  );
}