/**
 * F8 — 单文件部署 (M2.8 real implementation, M3.7 文案重写)。
 *
 * M3.7 之前页面包含 "当前应用" metadata 卡片(version / identifier /
 * git_commit 等 6 字段)。清单 18:"干啥的看不懂"——metadata 信息不属于
 * "单文件部署"语义,移到新的 about 页(src/pages/about/index.tsx)。
 *
 * 现在页面聚焦核心职责:如何把应用打包成单个 .exe / .dmg 文件,
 * 无需用户安装 .NET / Node / Python runtime。
 *
 * ## M2.8 设计原则(沿用 docs/design/M2.8-dataflow.md §2)
 *
 * Tauri 进程不直接 spawn `tauri build`。理由:
 *   - tauri build 耗时 5-10 分钟,会无限期阻塞 IPC。
 *   - 可靠的进度流式推送需要 sidecar(M3+)。
 *   - 工具链假设(NSIS / 代码签名 / notarize)环境特定,不属于 app 进程职责。
 *
 * 所以页面是"引导 + 溯源",不是一键构建器。one-click 在 M3+ 通过
 * tauri-plugin-shell sidecar 实现。
 *
 * ## M3.7 简化
 *
 * - intro 文案从"应用 = 一个可执行文件..."改为:
 *   "把应用打包成单个可执行文件(.exe / .dmg),无需用户安装
 *   .NET / Node / Python runtime。应用自包含 WebView2(Windows)或
 *   WKWebView(macOS)渲染引擎。"
 * - 移除"当前应用"metadata 卡片(6 字段 → about 页)。
 * - toggle 文案改为"查看构建命令"。
 * - `get_app_metadata` IPC 保留调用,about 页复用,本页仍调以保证向后兼容。
 */
import { useState } from 'react';
import type { ReactElement } from 'react';
import { Terminal } from 'lucide-react';

// ---------------------------------------------------------------------------
// Static content (no IPC needed after M3.7 simplification)
// ---------------------------------------------------------------------------

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
    hint: '生成 installers/<product>_<version>_x64.dmg + .sha256(需 macOS 主机)',
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
  const [showCommands, setShowCommands] = useState(false);

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
          把应用打包成单个可执行文件(.exe / .dmg),无需用户安装 .NET / Node / Python runtime。
          应用自包含 WebView2(Windows)或 WKWebView(macOS)渲染引擎。
          下方展示如何在本地触发 installer 构建 + 校验产物完整性。
        </p>
      </header>

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
        {showCommands ? '隐藏' : '查看'}构建命令
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
          aria-label="构建命令"
        >
          <p
            style={{
              color: 'var(--text-secondary)',
              fontSize: 14,
              marginBottom: 12,
            }}
          >
            从项目根目录运行以下命令;产物会写入{' '}
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
            说明:M2.8 阶段 UI 仅展示与引导,实际编译由本地 shell 触发,避免在
            Tauri 主进程内长时间阻塞。M3+ 引入 sidecar 后会接入按钮一键构建。
          </p>
        </section>
      )}
    </div>
  );
}