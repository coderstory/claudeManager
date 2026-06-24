# 白名单 — Phase 6 / M3.5 reveal bug

> M3.5 清单 15 P1 bug 修复白名单。
> 任何超出本表的变更必须先征得用户同意 (CLAUDE.md §2.4)。

## 变更范围

### Rust 后端 (3 文件)

1. **`src-tauri/src/platform/traits.rs`**
   - 增 `RevealError` enum (4 变体: NotFound / PermissionDenied / NetworkPath / LauncherFailed)
   - 改 `IPlatformReveal::reveal` → `reveal_file`,签名改返回 `Result<(), RevealError>`
   - mockall shim 同步改 `reveal_file`
   - tests 模块改 `reveal_dispatch` → `reveal_file_dispatch`

2. **`src-tauri/src/platform/windows/reveal.rs`**
   - 改 `fn reveal` → `fn reveal_file`
   - 用 `RevealError` 替代 `PlatformError::Path` / `::Command`
   - 加 4 场景分类 (network path 判定 + 权限判定 + 存在性 + launcher exit code)
   - 单元测试改 & 加新 case

3. **`src-tauri/src/platform/macos/reveal.rs`**
   - 改 `fn reveal` → `fn reveal_file`
   - 同样切到 `RevealError`
   - 单元测试改

### Rust 中间层 (1 文件)

4. **`src-tauri/src/services/resource_service.rs`**
   - `ResourceServiceError::Reveal` 内部加 `category` 字段以便前端按 type 路由
   - `Service::reveal` 把 `RevealError` 完整映射过去
   - 测试 fakes (NoopReveal / RecordingReveal / FailingReveal) 改 `reveal_file`

### 前端 (2 文件)

5. **`src/components/ErrorBanner.tsx`**
   - 增 `RevealErrorCategory` type + `formatRevealError(category, message, path)` 辅助函数
   - 4 类别 → 中文文案: 不存在 / 无权限 / 不支持网络路径 / 启动器失败

6. **`src/pages/resource-browser/index.tsx`**
   - `handleReveal` 错误处理用 `ErrorBanner` + `formatRevealError` (替换内联 alert div)
   - 保留 `state.revealError` 字符串 + 增 `state.revealErrorCategory` 字段

### 文档 (1 文件 新建)

7. **`docs/investigations/m3.5-reveal-bug.md`** — 4 段根因分析

### 单元测试 (3 文件)

8. **`src-tauri/src/platform/traits.rs`** — 测试模块内改 1 个 / 加 1 个
9. **`src-tauri/src/platform/windows/reveal.rs`** — 测试改 2 / 加 3 (network path / 权限 / launcher exit code)
10. **`src-tauri/src/platform/macos/reveal.rs`** — 测试改 2

### 前端测试 (2 文件)

11. **`src/__tests__/components/ErrorBanner.test.tsx`** — 加 `formatRevealError` 单元测试 group
12. **`src/__tests__/pages/resource-browser.test.tsx`** — 加 4 类 reveal 错误的 UI 渲染测试

### 报告 (2 文件)

13. **`tmp/reviews/phase6-m35-self.md`** — §6 自审
14. **`tmp/white-list-phase6-m35.md`** — 本文件
15. **`.planning/phases/06-m35-reveal-bug/06-m35-reveal-bug-SUMMARY.md`** — Phase 6 SUMMARY

## 总计

- 改: 12 个文件
- 新建: 3 个文件 (1 doc + 1 self-review + 1 SUMMARY)

## 严禁 (与 Phase 3 互斥)

- ❌ `src-tauri/src/services/marketplace.rs` — Phase 3 范围
- ❌ `src/pages/marketplace/` — Phase 3 范围
- ❌ `src-tauri/src/commands/provider.rs` — M3.6 范围
- ❌ `src-tauri/src/domain/project.rs` — M3.10 范围
- ❌ `.planning/phases/03-m32-polish/` — Phase 3 subagent 占用
- ❌ `.planning/phases/01-m217-closeout/` — 已 done
- ❌ `src-tauri/Cargo.toml` — 锁死不动
- ❌ `CLAUDE.md` / `SPEC.md` / `.planning/{PROJECT,ROADMAP,STATE,HANDOFF}.{md,json}` — 不可改