//! ErrorBoundary — React 18 渲染时错误兜底。
//!
//! ## 背景
//!
//! React 18 行为变化:render-time error 抛出会 unmount 整个 root
//! tree(防止 corrupted state 持续)。没有 ErrorBoundary,任何
//! 子组件 throw → 整个 webview 空白("白屏")。
//!
//! v3.4 之前:白屏 = 死 app + 用户困惑。**root cause** 见过:
//!   - src-tauri/src/plugins/stubs/file_ops/commands.rs 字段名
//!     `path` vs 前端期望 `relative_path` → `m.relative_path` undefined
//!
//! ## 设计
//!
//! - **fallback UI** = 固定右下角 toast(红色),显示 error message
//!   + 可选 component stack + 复制按钮(整段 stack trace 复制到剪贴板)
//!   + 重新加载按钮
//! - **不 unmount children**:`render()` 返回 `{this.props.children, toast}`,
//!   即使 toast 显示,主 UI 仍然在 (React 18 tree 内部可能 unmount 部分
//!   子树但 main chrome 可见)
//! - **复制按钮**:用 `navigator.clipboard.writeText`(secure context),
//!   fallback `document.execCommand('copy')`(Tauri webview dev mode)
//! - **A5-fix (单 sink)**:A5 报告用户看到两个异常窗口(全屏 overlay +
//!   右下 toast)。原实现 `componentDidCatch` 同时写到
//!   `#ccm-error-overlay`(index.html) + toast(render) → 同一错误显示
//!   两次。修复:移除 overlay 写入路径,只保留右下 toast 作为唯一
//!   错误显示。Stack 完整信息走 console.error → tauri-plugin-log
//!   → Rust 日志。
//!
//! ## 位置
//!
//! 在 main.tsx 包在 `<App />` 外,作为最外层兜底。如果未来
//! 多个 ErrorBoundary 嵌套(per-route),只要根这一个就够
//! 防止白屏。

import { Component, type ReactNode } from "react";

export interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
  info: string | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = {
    error: null,
    info: null,
  };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  override componentDidCatch(
    error: Error,
    info: { componentStack?: string | null },
  ): void {
    // eslint-disable-next-line no-console
    console.error("[ErrorBoundary]", error, info.componentStack);

    // A5-fix: 不再写入 #ccm-error-overlay(它和 render() 的 toast
    // 显示同一错误 → 两个窗口)。错误显示统一收敛到右下 toast,
    // 完整 stack 通过 console.error 走 tauri-plugin-log → Rust 日志。

    this.setState({ info: info.componentStack ?? null });
  }

  handleCopy = async (): Promise<void> => {
    const { error, info } = this.state;
    const text =
      `[ErrorBoundary]\n` +
      `${error?.name ?? "Error"}: ${error?.message ?? "(no message)"}\n\n` +
      `Stack:\n${error?.stack ?? "(no stack)"}\n\n` +
      `Component stack:\n${info ?? "(none)"}\n\n` +
      `User agent: ${navigator.userAgent}\n` +
      `Time: ${new Date().toISOString()}`;

    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        // Tauri webview dev mode 报 non-secure context,fallback 到
        // execCommand('copy') (deprecated 但仍是 webview 内可用
        // 最稳的方法)。
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      const btn = document.getElementById("ccm-error-toast-copy");
      if (btn) {
        const original = btn.textContent;
        btn.textContent = "✓ 已复制";
        setTimeout(() => {
          if (btn && original) btn.textContent = original;
        }, 1500);
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[ErrorBoundary] copy failed:", e);
    }
  };

  handleReload = (): void => {
    window.location.reload();
  };

  override render(): ReactNode {
    const { error, info } = this.state;
    if (!error) return this.props.children;

    return (
      <>
        {this.props.children}
        <div
          role="alert"
          aria-live="assertive"
          data-testid="ccm-error-toast"
          style={{
            position: "fixed",
            right: 16,
            bottom: 16,
            maxWidth: 420,
            padding: "12px 14px",
            borderRadius: 8,
            background: "var(--danger, #D32F2F)",
            color: "#fff",
            fontFamily: "var(--font-mono, monospace)",
            fontSize: 12,
            lineHeight: 1.5,
            boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
            zIndex: 100001,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 6,
            }}
          >
            <strong style={{ fontSize: 13 }}>渲染错误 — 已捕获</strong>
            <button
              type="button"
              onClick={this.handleReload}
              title="重新加载页面"
              style={{
                border: "1px solid rgba(255,255,255,0.4)",
                background: "transparent",
                color: "#fff",
                borderRadius: 4,
                padding: "2px 8px",
                fontSize: 11,
                cursor: "pointer",
              }}
            >
              重新加载
            </button>
          </div>
          <div
            style={{
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              maxHeight: 120,
              overflow: "auto",
              marginBottom: 8,
              opacity: 0.95,
            }}
          >
            {error.message || String(error)}
          </div>
          {info && (
            <details style={{ marginBottom: 8, opacity: 0.85 }}>
              <summary style={{ cursor: "pointer", fontSize: 11 }}>
                组件堆栈
              </summary>
              <pre
                style={{
                  margin: "4px 0 0 0",
                  fontSize: 10,
                  maxHeight: 80,
                  overflow: "auto",
                  whiteSpace: "pre-wrap",
                }}
              >
                {info}
              </pre>
            </details>
          )}
          <button
            id="ccm-error-toast-copy"
            type="button"
            onClick={this.handleCopy}
            data-testid="ccm-error-toast-copy"
            style={{
              border: "1px solid #fff",
              background: "transparent",
              color: "#fff",
              borderRadius: 4,
              padding: "4px 12px",
              fontSize: 11,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            复制
          </button>
        </div>
      </>
    );
  }
}
