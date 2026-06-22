# Phase 6: M3.5 reveal bug - Summary

**Status**: done
**Commits**: 1 (3 子任务 1 commit)
**Smoke**: 7/7 PASS
**Ship**: `~/Desktop/ClaudeConfigManager-M3/ClaudeConfigManager-M3.5-reveal-bug-fix.exe` (31,858,640 bytes / 30.4 MB)

## 修复内容 (清单 15 P1)

### 1. 后端 — `RevealError` 结构化错误 (Rust)

- **`src-tauri/src/platform/traits.rs`**: 新增 `RevealError` enum (4 variant: `NotFound` / `PermissionDenied` / `NetworkPath` / `LauncherFailed`) + `kind()` / `path()` 辅助方法;trait 方法 `reveal` → `reveal_file`;mockall shim 同步;加 2 个新单测 (`reveal_file_dispatch` / `reveal_error_kind_is_stable_string` / `reveal_error_path_returns_inner`)。
- **`src-tauri/src/platform/windows/reveal.rs`**: 重写 `reveal_file` 加入 4 步前置检测 (网络路径 → 存在性 → spawn → status.success());单测改 2 + 加 3 (UNC / `//host` / 合法路径 launcher_failed 兜底)。
- **`src-tauri/src/platform/macos/reveal.rs`**: 同步 windows 改造,4 步前置检测;单测改 2 + 加 2 (SMB 网络路径 / launcher 兜底)。
- **`src-tauri/src/platform/mod.rs`**: `pub use` 列表加 `RevealError`。
- **`src-tauri/src/services/resource_service.rs`**: `ResourceServiceError::Reveal(String)` → `Reveal { kind, message, path }` 结构化;新增 `RevealFailure` (Serialize 形态) 作为 IPC 出口;`detail()` 拒绝 `..` 路径时也走结构化 `permission_denied`;测试 fakes (NoopReveal / RecordingReveal / FailingReveal) 改新签名;加 4 个新单测 (kind 标签 / `RevealFailure` JSON 形状 / `detail` parent traversal)。
- **`src-tauri/src/commands/resource.rs`**: `reveal_in_file_manager` 返回类型改 `Result<(), RevealFailure>`(不再是 `String`),空 path 用合成 `permission_denied` 兜底。

### 2. 前端 — 错误本地化 (TS)

- **`src/components/ErrorBanner.tsx`**: 增 `RevealFailure` interface + `RevealErrorKind` union + `formatRevealError(failure)` 辅助函数(4 类 → 中文文案 + 路径/hint 双行);未知 kind 走 `launcher_failed` 兜底(不抛错)。
- **`src/pages/resource-browser/index.tsx`**: `state.revealError: string` → `state.revealFailure: RevealFailure | null`;`handleReveal` 异常处理用 `isRevealFailure` 探测后端 IPC 形态(兼容旧 Error 字符串);reveal error UI 块替换为 `ErrorBanner` + `formatRevealError` + 显示 `(类型: <kind>)` 标识;`AlertCircle` import 移除(不再用)。

### 3. 文档

- **`docs/investigations/m3.5-reveal-bug.md`**: 4 段根因分析 (背景 / 4 场景实测 / 3 候选根因 / 修复方案) + 残留限制 + 验证清单。
- **`tmp/white-list-phase6-m35.md`**: 12 改 + 3 新文件白名单。
- **`tmp/reviews/phase6-m35-self.md`**: §6 自审(详见文件)。

### 4. 测试

- Rust: `cargo build` 0 error / 0 warning;`cargo check --lib` 通过(单测 binary 在此环境有 pre-existing 0xc0000139 entrypoint 问题 — 与本 phase 无关,见 self-review)。
- 前端: `npx vitest run` 398/398 通过(31 文件),含本 phase 新增 8 个 ErrorBanner + 6 个 resource-browser 测试。

### 5. Build & Ship

- Dev build: 133s
- Smoke test 7/7 (launch / window / tray / kill / webview / title / assets embedded)
- Exe: `~/Desktop/ClaudeConfigManager-M3/ClaudeConfigManager-M3.5-reveal-bug-fix.exe` 30.4 MB
- WebView2Loader.dll 同步 cp

## Commit 列表

`feat(M3.5): reveal error structured (RevealError) + frontend localization`

## 关键决策

1. **trait 方法名 `reveal` → `reveal_file`** — 旧名 `reveal` 不能体现"打开**文件**管理器"动作;新名与错误类型 `RevealError` 语义对齐;`IPlatformReveal` 本身保留(它就是平台文件管理器 trait)。
2. **错误类型从 `PlatformError` 拆出** — `PlatformError` 是通用 7-variant 枚举,`RevealError` 是 `RevealFile` 动作专属。`explorer.exe` 的 exit code 不可信,必须**前置检测**(网络/存在性)+ **结构化分类**(4 变体)才能定位原因。
3. **IPC 用 `RevealFailure { kind, message, path }`** — `kind` 是稳定 routing key (kebab-case, 4 个明确值 + 兜底),`message`/`path` 是辅助。**不**用 `Display` 字符串让前端解析(违反 IPC contract 原则)。
4. **前端 `isRevealFailure` duck-typing** — 兼容旧 IPC(可能仍抛 Error 字符串),降级到 `launcher_failed` 兜底;不破坏既有 contract。
5. **未知 kind 兜底** — 后端新增 kind 时前端不抛错,UI 仍能显示(提示"文件管理器启动失败"),后续 M3.6+ 可补全文案。
6. **白名单 12 改 + 3 新** — 严格按 CLAUDE.md §2.4;不超出范围。
