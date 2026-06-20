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
 *        - sha256sum -c dist/installers/*.sha256
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
    hint: '生成 dist/installers/<product>_<version>_x64-setup.exe + .sha256',
  },
  {
    label: 'macOS (DMG)',
    cmd: 'bash scripts/build-installer.sh macos',
    hint: '生成 dist/installers/<product>_<version>_x64.dmg + .sha256（需 macOS 主机）',
  },
  {
    label: '校验 SHA256',
    cmd: 'sha256sum -c dist/installers/*.sha256',
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
      className="mx-auto w-full max-w-4xl p-6"
      data-testid="single-file-deploy-page"
    >
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-text-primary">单文件部署</h1>
        <p className="mt-1 text-sm text-text-secondary">
          应用 = 一个可执行文件，无外部 .NET / Node / Python runtime 依赖。
          下方展示当前运行版本与构建信息；installer 由本地脚本生成。
        </p>
      </header>

      {/* IPC error */}
      {state.error && (
        <div
          className="mb-4 flex items-start gap-2 rounded border border-danger/30 bg-danger/5 p-3 text-sm text-danger"
          data-testid="app-metadata-error"
          role="alert"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>{state.error}</span>
        </div>
      )}

      {/* Metadata card */}
      <section
        className="mb-6 rounded-lg border border-border bg-bg-elevated p-4 shadow-sm"
        data-testid="app-metadata-card"
        aria-label="当前应用元数据"
      >
        <h2 className="mb-3 text-sm font-medium text-text-secondary">
          当前应用
        </h2>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
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
        className="inline-flex items-center gap-1.5 rounded border border-border bg-bg-elevated px-3 py-1.5 text-sm text-text-primary hover:bg-bg-overlay"
        data-testid="toggle-commands-btn"
      >
        <Terminal className="h-4 w-4" />
        {showCommands ? '隐藏' : '查看'} installer 生成命令
      </button>

      {showCommands && (
        <section
          className="mt-3 rounded-lg border border-border bg-bg-elevated p-4 shadow-sm"
          data-testid="installer-commands-panel"
          aria-label="installer 生成命令"
        >
          <p className="mb-3 text-sm text-text-secondary">
            从项目根目录运行以下命令；产物会写入{' '}
            <code className="rounded bg-bg-overlay px-1 py-0.5 text-xs text-text-primary">
              dist/installers/
            </code>
            。
          </p>
          <ol className="space-y-3">
            {INSTALLER_COMMANDS.map((c) => (
              <li key={c.cmd}>
                <div className="text-xs text-text-muted">{c.label}</div>
                <pre className="mt-1 overflow-x-auto rounded border border-border bg-[#1F2328] p-2 font-mono text-xs text-[#FAFAF7]">
                  <code>{c.cmd}</code>
                </pre>
                <div className="mt-1 text-xs text-text-muted">{c.hint}</div>
              </li>
            ))}
          </ol>
          <p className="mt-3 text-xs text-text-muted">
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
    <div className="flex items-baseline gap-3">
      <dt className="w-20 flex-shrink-0 text-xs text-text-muted">{label}</dt>
      <dd
        className={
          'text-sm text-text-primary ' +
          (mono ? 'font-mono tabular-nums' : '')
        }
        data-testid={testId}
      >
        {value}
      </dd>
    </div>
  );
}
