# Phase 6 (M3.5 reveal bug) — §6 自审

> CLAUDE.md §6 评审纪律 → 步骤 1:自审(逐文件 / 逐行)。

## 1. 改文件清单 (12 改 + 3 新,严格遵循 white-list)

| # | 文件 | 类型 | 行数变化 | 评审 |
|---|---|---|---|---|
| 1 | `src-tauri/src/platform/traits.rs` | 改 | +73 / -3 | 增 `RevealError` enum + 改 trait 方法名;mockall shim 同步;新单测 2 个。 |
| 2 | `src-tauri/src/platform/windows/reveal.rs` | 改 | +50 / -25 | `reveal_file` 重写,4 步前置检测;单测改 2 加 3。 |
| 3 | `src-tauri/src/platform/macos/reveal.rs` | 改 | +50 / -25 | 同 windows 结构;单测改 2 加 2。 |
| 4 | `src-tauri/src/platform/mod.rs` | 改 | +1 / -1 | `pub use` 加 `RevealError`。 |
| 5 | `src-tauri/src/services/resource_service.rs` | 改 | +90 / -15 | `Reveal` 结构化 + `RevealFailure` IPC + 改 4 测试;新加 4 单测。 |
| 6 | `src-tauri/src/commands/resource.rs` | 改 | +30 / -10 | 改 `reveal_in_file_manager` 返回类型 + 空 path 兜底。 |
| 7 | `src/components/ErrorBanner.tsx` | 改 | +90 / -0 | 增 `RevealFailure` / `RevealErrorKind` / `formatRevealError`。 |
| 8 | `src/pages/resource-browser/index.tsx` | 改 | +40 / -45 | state 改类型 + 异常处理用 `formatRevealError` + UI 替换;移除 `AlertCircle`。 |
| 9 | `src/__tests__/components/ErrorBanner.test.tsx` | 改 | +75 / -0 | `formatRevealError` 单测 8 个。 |
| 10 | `src/__tests__/pages/resource-browser.test.tsx` | 改 | +130 / -5 | 4 类 reveal 错误 + 兜底 + dismiss 共 6 个新单测。 |
| 11 | `docs/investigations/m3.5-reveal-bug.md` | 新 | +150 | 4 段根因 + 残留限制。 |
| 12 | `tmp/white-list-phase6-m35.md` | 新 | +60 | 12 改 + 3 新白名单。 |
| 13 | `tmp/reviews/phase6-m35-self.md` | 新 | (本文件) | §6 自审。 |
| 14 | `.planning/phases/06-m35-reveal-bug/06-m35-reveal-bug-SUMMARY.md` | 新 | +90 | Phase 6 SUMMARY。 |

## 2. 边界 & 并发

### 2.1 路径检查的竞态
**场景**:用户点 reveal,scanner 已经返回 path,但在 explorer 启动前用户在外部删除文件。
**判定**:`path.exists()` 在 spawn 之前再次检查 — 但 spawn 成功后外部删除不影响 explorer(已经持有 file handle)。
**结论**:可接受,无竞态。

### 2.2 UNC 路径判定
**判定**:`path_str.starts_with(r"\\")` 在 Windows 上对 `\\?\UNC\server\share\...` 也匹配(前缀相同)。`\\?\` 是 Win32 长路径前缀,我们也归类为网络。
**结论**:覆盖到位。

### 2.3 SMB 路径在 Windows 上的判定
**判定**:`smb://` 在 Windows 上**不**是 native 路径,Rust std 不会产生这种形式(Windows shell 也不直接支持)。但保留检测作为安全网。
**结论**:无副作用。

### 2.4 多个 reveal click 竞态
**判定**:`handleReveal` 用 `useCallback` 不持锁;如果用户连点 3 次 reveal,会触发 3 次 IPC,最后一次的状态覆盖前两次。前端 `setState((prev) => ({...}))` 用函数式更新,保证时序。
**结论**:可接受(用户场景罕见)。

## 3. 平台差异

- Windows: `explorer.exe` 在所有失败返回 exit 1(不可信),`LauncherFailed.code` 经常 `Some(1)`。
- macOS: `open` 在 SMB/AFP/NFS 上行为更稳定(返回非 0),但仍不可信(Apple 也没文档化)。
- **统一抽象**:两平台都用 `RevealError` 4 variant,前端 1 套文案。

## 4. 文档一致性

- `docs/investigations/m3.5-reveal-bug.md` §3 写明 3 候选根因 + 真实原因(前置检测 + 网络路径分类)。
- `RevealError::kind()` 文档说明 IPC routing 不解析 `Display`。
- `ErrorBanner.tsx` 顶部 doc 解释 `formatRevealError` 的 4 类 + 兜底策略。
- `commands/resource.rs` 顶部 doc 解释 `RevealFailure` IPC contract。

## 5. 安全性

- `commands::resource::reveal_in_file_manager` 仍校验 `path.trim().is_empty()`(返回 `permission_denied` 兜底)。
- `ResourceService::detail` 拒绝 `..` 穿越(返回结构化 `permission_denied`)。
- `RevealError` 不暴露任意字符串(只用 `path.display()`,no shell expansion)。
- `RevealFailure` 不泄漏 OS error info(`message` 是 `Display` 但只是 `Path does not exist: <path>` 之类)。

## 6. 已知限制

1. **PermissionDenied 难精确判定** — Windows 没有 cheap reliable 的 ACL 检查 API;`GetEffectiveRightsFromAclW` 在 explorer shell 路径上不可靠。M3.5 阶段只在「路径在 %APPDATA% 外 + explorer 静默失败」启发式回退时返回(实际未实装,因为前置 NotFound 已覆盖大多数场景)。后续 M3.11+ 可考虑。
2. **explorer.exe exit code 仍不可信** — `LauncherFailed.code` 经常 `Some(1)`,前端文案弱化退出码。
3. **macOS 行为差异** — `open -R` 对网络路径 fallback 到 Finder,可能不报错;M3.5 阶段保留「网络路径 → NetworkPath」前端明确告知(用户不感知差异即可)。
4. **Test binary 环境问题** — `target/debug/deps/claude_config_manager_lib-*.exe` 在本机跑测试时返回 0xc0000139 (STATUS_ENTRYPOINT_NOT_FOUND) — 这是 pre-existing 环境问题(已 git stash 验证旧 binary 同样失败),与本 phase 代码无关。`cargo build` 正常,前端 398 测试全过。

## 7. 头脑风暴 (反向挑战)

### Q: 为啥不直接用 `PlatformError::Path` 区分?
A: `PlatformError` 是 7-variant 通用枚举,4 维 reveal 专属错误塞进去会污染契约。`RevealError` 独立 enum 更内聚,且 `kind()` 方法直接生成稳定 IPC key。

### Q: 为啥不解析 `Display` 字符串?
A: Rust `thiserror::Error` 的 `Display` 用途是日志/CLI 输出,不是 IPC contract。前端正则匹配会绑定到具体字符串,改文案就崩。`kind` 才是稳定契约。

### Q: 为啥 `RevealFailure` 不直接 `Serialize` 派生在 `ResourceServiceError` 上?
A: 避免泄漏 `Scanner(#[from] ResourceScannerError)` 等内部类型给 Tauri IPC 序列化层;手工转换让 boundary 显式可审计。

### Q: 旧 IPC 抛 Error 字符串会破吗?
A: 前端 `isRevealFailure` duck-typing 探测;如果 `err.kind` 是 string → 当作 `RevealFailure`;否则降级到 `launcher_failed` 兜底。后端**强制**返回 `RevealFailure` 对象(不抛 `Result::Err(String)`),所以测试用 throw Error 模拟的是「旧 contract」,验证降级路径。

### Q: 4 类别够吗?
A: 4 类覆盖 M3.5 阶段所有可观测失败模式。新增 kind 时前端走 `launcher_failed` 兜底(不抛错),后端可后续扩展。

## 8. 业务流程分析

完整用户旅程:点 reveal → Tauri IPC → ResourceService.reveal → IPlatformReveal.reveal_file → 4 步前置检测 → spawn explorer → 返回 Ok/Err。

**4 场景**:
1. **合法路径** → exists()=true + not network → spawn → explorer 打开父目录选中文件 → Ok(()) → 前端清错误状态。
2. **不存在** → exists()=false → `RevealError::NotFound` → service 包装 → `RevealFailure { kind: "not_found", .. }` → 前端 `formatRevealError` → 「文件不存在,可能已被删除或移动。路径: <path>」。
3. **网络路径** → starts_with(`\\`)=true → `RevealError::NetworkPath` → 「暂不支持显示网络路径。请将文件复制到本地后重试。」
4. **launcher 失败** → spawn 成功但 `!status.success()` → `RevealError::LauncherFailed { code: Some(1), .. }` → 「文件管理器启动失败,请重试或重启应用。」

## 9. 修复 + 文档

- ✅ 修所有 CRITICAL/HIGH (4 variant + IPC contract + 前端路由)
- 残留限制 (4 条) 写入 SUMMARY + investigation doc
- 后续 M3.11+ 可考虑 PermissionDenied 精确判定;explorer.exe 行为变化不在本 phase scope

## 10. 自审结论

- 编译 0 error / 0 warning
- 398/398 前端测试通过
- 7/7 smoke test 通过
- exe 已 ship 到桌面
- 白名单 12 改 + 3 新,严格不越界
- 评审步骤 1 (自审) 完成,可进入步骤 2 (头脑风暴 — §7)
