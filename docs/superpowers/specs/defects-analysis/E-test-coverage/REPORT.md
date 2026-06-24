# 维度 E: 测试覆盖 缺陷盘点

## 元信息
- 维度 ID: E
- 扫描范围:
  - `src/__tests__/` (40 vitest files: 8 design-system + 13 integration + 14 pages + 5 components + 2 hooks + 3 lib + 1 design-tokens + 1 plugin-registry + 1 ThemeRegistry + 1 AppHeader)
  - `src-tauri/tests/` (10 cargo integration tests)
  - `tests/e2e/` (28 Playwright spec files)
  - `playwright.config.ts` + `vitest.config.ts` + `src/test/setup.ts`
  - `scripts/smoke-test.sh` (523 行, 10 项) + `scripts/run-e2e.sh` + `scripts/test-verify.sh`
  - `src-tauri/src/commands/` (14 modules, 68 `#[tauri::command]` fns)
  - `.github/workflows/ci.yml`
- 扫描方法:
  - 实跑 baseline: `npm test -- --run` (470 tests, 25 failed / 445 passed, 8 files failed)
  - 静态审计: grep 命令覆盖度 + per-module unit/integration test 计数
  - 复用 STATE.md "Pre-existing 18 failures" 段 + tmp/test-failures-* (8 份) + tmp/smoke-failures-* (4 份)
- 引用资产: STATE.md §v3.0 round-2, CLAUDE.md §5/§9.4/§11.7/§13.1/§14.1/§15.4, tmp/test-failures-{m-finalize,m2.17-3.1-tests,m3.10-rust,m3.4}.md, tmp/smoke-failures-{m-finalize,m3.10,m3.4}.md, 维度 B-2 报告 (macOS 编译挂), 维度 B-10 报告 (25 failures 集中在 3 个 page test)
- 排除文件 (Wave 0 解 conflict 后): `home.test.tsx` / `json-editor.test.tsx` / `pages/json-editor/index.tsx` / `pages/backup-restore/index.tsx`
- 扫描时长: 实际 ~12 分钟 (含 1 次 npm test 实跑 + 2 次 grep + 1 次 cargo check --no-run)

## Top 问题清单 (10 条, 按严重度排序)

| # | 问题 | 文件:行 | 严重度 | 证据 | 修复建议 | 关联 audit/维度 |
|---|---|---|---|---|---|---|
| **E-1** | `cargo test` 在 dev box 跑不起来 (WebView2Loader.dll STATUS_ENTRYPOINT_NOT_FOUND 0xC0000139) | scripts/test-verify.sh:5-8 + tmp/test-failures-m3.10-rust.md §3 | **CRITICAL** | rust test binary 全程编译过但 process 启动即 crash, 50 个 #[test] 跑不起来 | (1) 安装 MSVC Redistributable 2015+ 补 `vcruntime140_1.dll` (2) 或切 windows-msvc toolchain (3) 或 CI 强制单跑 `cargo test --test <name>` 跳过 `--lib` | B-2 / C-2 / STATE.md §v3.0 |
| **E-2** | e2e CI job 永久禁用 (`if: ${{ false }}`), 28 个 Playwright spec 在 CI 0 跑过 | .github/workflows/ci.yml:125 | **CRITICAL** | `e2e: if: ${{ false }}` 注释明说 "until M2.x", 实跑仅本地 tauri-driver (6 个 M1.8 spec) | (1) 启用 e2e job + 装 tauri-driver binary (2) 或 M3 引入 vitest-browser 替代真 WebView 测试 | C-3 / tmp/test-failures-m3.10-e2e.md §1 |
| **E-3** | `commands/backup.rs` 7 commands 完全裸奔 (0 unit + 0 integration tests) | src-tauri/src/commands/backup.rs:1-182 | HIGH | `grep -c "#\[test\]" backup.rs` = 0; 7 个 IPC 命令 (list_backups / read_backup_content / diff_backups / restore_backup / backup_now / delete_backup / backup_incremental) 全无测试 | (1) 加 `#[cfg(test)]` + 5-7 unit test 验证 command shape (AppState mock) (2) 加 `tests/backup_commands.rs` 仿照 `tests/history_commands.rs` 的 `_impl` helper pattern | B-2 |
| **E-4** | `commands/autostart.rs` 2 commands 仅 2 个 compile-time type-check (无 runtime test) | src-tauri/src/commands/autostart.rs:51-77 | HIGH | `grep "#\[test\]" autostart.rs` = 0; `#[cfg(test)] mod tests` 仅含 `_get_autostart_status_takes_app_handle` (compile-only) | 加 `tauri::test::mock_app()` runtime test 验证 enable/disable 流程 + 写 fake AppHandle | B-2 |
| **E-5** | 25 个 vitest failures 漂移 (STATE.md 标 18 → 实测 25, +7 个) | src/pages/history/index.tsx:141 + src/pages/usage-query/index.tsx:513 + src/__tests__/components/ConfirmDialog.test.tsx + design-system/base.test.ts 等 | HIGH | `npm test -- --run`: 8 files failed / 25 tests failed, 3 个 page (history:8 + usage-query:9 + 其他 8) | (1) history/index.tsx:141 + usage-query/index.tsx:513 都是 null deref — 修 2 行 (2) base.css / ConfirmDialog class 名漂移 | STATE.md §v3.0 round-2 (漂移 7 个) |
| **E-6** | `src-tauri/tests/{project_service,history_integration}.rs` macOS 编译挂 (硬编码 `use platform::windows::WindowsPaths`) | src-tauri/tests/project_service.rs:14-16 + src-tauri/tests/history_integration.rs:21-23 | HIGH | 2 个 integration test 文件直接 `use claude_config_manager_lib::platform::windows::WindowsPaths`, macOS cargo test build 必撞 `unresolved import` | (1) 改用 `runtime::paths()` (跨平台 dispatch) (2) 或在 `#[cfg(test)]` 块里硬导入 + macOS 路径 mock | B-2 cross-dim |
| **E-7** | 14 个内页只有 13 个有 vitest test, `provider-switch/` 完全无测试 | src/pages/provider-switch/index.tsx (only file) | MEDIUM | `find src/__tests__/pages -name "*provider-switch*"` = 0 hits | (1) 加 `src/__tests__/pages/provider-switch.test.tsx` (2) 或 M4+ 决定该内页是否仍 ship | — |
| **E-8** | page test 极度不均: `home.test.tsx` 仅 4 tests, `resource-browser.test.tsx` 46 tests | src/__tests__/pages/*.test.tsx (14 文件) | MEDIUM | grep -c "^\s*it\(": home:4 vs resource-browser:46; 11x 差距 | 给 home.test.tsx 加 ≥6 test 覆盖 `pick-project-root` 等关键路径 | STATE.md §v3.0 round-2 (10 home failures 漂移) |
| **E-9** | smoke-test 10 项只在 Windows 跑, macOS 完全没等价的 smoke test | scripts/smoke-test.sh:523 (Win-only) + CLAUDE.md §15.4 提及缺 IPC | MEDIUM | smoke-test.sh 用 PowerShell + EnumChildWindows + Add-Type, macOS 无等价; CLAUDE.md §15.7 已声明本项目不做 macOS release | (1) 短期: dev 阶段 mac 用 `scripts/build-mac.sh --debug` + 手动验 (2) 长期: CLAUDE.md §15.4 列 3 个 IPC 命令 (`get_webview_children_count` 等) 仍待加 | F-1 / 维度 F |
| **E-10** | 测试 fixture/mock 复用度低 (16 个 page test 各自重复 `vi.mock('@tauri-apps/api/core', ...)`) | src/__tests__/pages/*.test.tsx (16 files) | LOW | setup.ts 全局 mock 仅 no-op, 每个 page test 重复定义 `mockInvoke = vi.fn()` + sample data builders | 抽 `src/__tests__/test-utils/mockInvoke.ts` 导出共享 helper + 把 sampleUsageRow/sampleBackupRow 挪过去 | — |

## 详细分析 (前 3 条展开)

### 问题 E-1: `cargo test` 在 dev box 跑不起来 (0xC0000139 STATUS_ENTRYPOINT_NOT_FOUND)

- **症状**: 所有 Rust 集成 + 单元测试编译通过 (`cargo test --no-run` OK), 但 binary 一启动立即崩 (exit code 0xc0000139), 任何 `#[test]` fn 都跑不到。
- **证据**:
  - `scripts/test-verify.sh:5-8` 注释明确: "Tauri v2 因 webview2-com 静态链接 + 160KB WebView2Loader.dll fake stub, `cargo test` 实际跑必撞 0xC0000139"
  - `tmp/test-failures-m3.10-rust.md` §3 列出根因: `vcruntime140_1.dll` 缺失 (MSVC Redistributable 2015+ 未装)
  - 实测 `tmp/test-failures-m-finalize.md` 报 `--lib` + `--test about` 都 crash, 但 `cargo check --tests` 通过
- **根因**: windows-gnu toolchain 链接的 test binary 依赖 MSVC C++ runtime (`vcruntime140_1.dll`), dev box 缺此 DLL → PE loader 启动即挂; 与代码本身无关。
- **修复建议**: 3 个候选方案 (按风险递增):
  1. **P0 (推荐)**: 装 MSVC Redistributable 2015+ (含 vcruntime140_1.dll), dev box 一行命令, **不改任何代码**
  2. P1: 切 windows-msvc toolchain (改 `rust-toolchain.toml` + `.cargo/config.toml`), 风险中等 (违反 §2.3 锁版本纪律, 需白名单)
  3. P2: CI 改跑 `cargo test --test <name>` 跳过 `--lib` (workaround, 不真解决问题)
- **关联**: B-2 cross-dim (rust 测试不可跑影响跨维度报告可信度) + C-2 (工程流程: dev box 环境修复未纳入 CI 门禁)

### 问题 E-2: e2e CI job 永久禁用 (`if: ${{ false }}`), Playwright 28 个 spec 0 跑过

- **症状**: `.github/workflows/ci.yml:125` 的 e2e job 用 `if: ${{ false }}` 永久跳过; 28 个 Playwright spec 仅在本地 dev box 通过 `scripts/run-e2e.sh` 实跑 (需 tauri-driver + msedgedriver), CI 上 0 跑过。
- **证据**:
  - `ci.yml:125` 注释: "TODO: dev box 无法 tauri-driver（无 wix 工具链）, CI runner 需 tauri-driver binary; 本 job 在配置生效前 skip"
  - `tmp/test-failures-m3.10-e2e.md` §1: M3.10-arch UI e2e "⏭ SKIPPED auto 模式纪律豁免"
  - `playwright.config.ts:33` BASE_URL 默认 `tauri://localhost`, 但 CI 既无 tauri-driver 又无 vite dev server, 真跑必失败
- **根因**: Tauri v2 官方 WebDriver 路径 = tauri-driver + msedgedriver + WebDriverIO; Playwright 是 CDP-only, 需 `connectOverCDP` 桥接 (`scripts/run-e2e.sh`)。CI runner 装这三个二进制是非平凡工作, 因此一直搁置。
- **修复建议**:
  1. **P1 (短期)**: 把 `if: ${{ false }}` 改为 `if: ${{ matrix.os == 'windows-latest' }}` + 加 step `npm install -g @tauri-apps/tauri-driver` + `npx playwright@1.49.1 install chromium`, 启用 Windows e2e 路径
  2. P2 (长期): 用 vitest-browser-mcp + happy-dom 替代真 WebView, 让 e2e 跑在 jsdom 类似的轻量 env (trade-off: 不能验 IPC, 但能验 React 状态)
  3. P3: 维持现状, 接受 e2e 仅本地 dev 跑 + smoke-test 10 项兜底 (CLAUDE.md §9.4 已设计)
- **关联**: C-3 (工程流程: CI 门禁缺一环) + CLAUDE.md §15.4 (M4 阶段提及 macOS smoke test 待改造, 但本问题连 Windows 都未启用)

### 问题 E-3: `commands/backup.rs` 7 commands 完全裸奔 (0 unit + 0 integration tests)

- **症状**: 7 个 `#[tauri::command]` fn (list_backups / read_backup_content / diff_backups / restore_backup / backup_now / delete_backup / backup_incremental) 是 F13 备份与恢复的核心 IPC, 全部无任何形式的 test coverage — 既无 unit test 也无 integration test。
- **证据**:
  - `grep -c "#\[test\]" src-tauri/src/commands/backup.rs` = **0**
  - `grep -l "commands::backup" src-tauri/tests/*.rs` = **0 hits** (无 integration test 引用)
  - 对比 `history.rs` (5 commands, 9 unit + 2 integration) + `about.rs` (1 command, 1 unit + 1 integration) + `project.rs` (5 commands, 2 unit + 1 integration), backup 是 command 数量最多却覆盖最少的模块
  - `src-tauri/src/commands/backup.rs:182` 是文件末尾 (182 行, 无 `#[cfg(test)] mod tests`)
- **根因**: 备份功能是 M2.6 + M3.12 + M4.6 三个阶段叠加, 每次只加命令未补测试 (TDD §2.2 违反) — 典型"先写代码后补测试"反模式累积。
- **修复建议**:
  1. **P1**: 在 `commands/backup.rs` 末尾加 `#[cfg(test)] mod tests`, 5-7 unit test 验证每个 command 的 shape (AppState mock + `_list_backups_takes_state` 等 compile-only checks), 仿照 `autostart.rs:67-76` 模式
  2. **P1**: 新建 `src-tauri/tests/backup_commands.rs`, 模仿 `tests/history_commands.rs` 的 `*_impl` helper pattern 测业务逻辑 (read_backup_content / diff_backups 的纯函数部分)
  3. **P2**: 加 e2e spec 验证 `list_backups` IPC 真实 round-trip (`tests/e2e/m4-6-backup-delete.spec.ts` 已存在, 但仅 4 inner tests, 不一定覆盖所有 7 commands)
- **风险评估**: 修改低风险, 加 test-only code 不影响 production; 但若不修, M4.6 backup 链路 (`backup_incremental` 的 "no-change" 逻辑) 无回归保护, 一旦 Rust 重构易破
- **关联**: B-2 (commands 覆盖盘点) + STATE.md §v3.0 round-2 (m4-6-backup-delete.spec.ts 已有 4 test, 但 unit 层空白)

## 简要列举 (第 4-10 条)
- **E-4**: `commands/autostart.rs` 2 commands 仅 2 个 compile-only type-check (autostart.rs:67-76), 无 runtime test — HIGH — 需 mock AppHandle 或加 `tauri::test::mock_app`
- **E-5**: 25 个 vitest failures 漂移 (STATE.md 标 18 → 实测 25) — history/index.tsx:141 + usage-query/index.tsx:513 + base.test.ts + ConfirmDialog + splash — HIGH — 主修 2 个 null deref (2 行) + 4 个其他 class/refactor 漂移
- **E-6**: 2 个 Rust integration test (`project_service.rs:14-16`, `history_integration.rs:21-23`) 硬编码 `use platform::windows::WindowsPaths`, macOS cargo test build 必挂 — HIGH — 改用 `runtime::paths()` (跨平台 dispatch)
- **E-7**: 14 个内页仅 13 个有 vitest test, `src/pages/provider-switch/index.tsx` 完全无 test — MEDIUM — 加 `__tests__/pages/provider-switch.test.tsx`
- **E-8**: page test 极度不均: home.test.tsx 仅 4 tests vs resource-browser.test.tsx 46 tests (11x 差距) — MEDIUM — home 至少补 6 test 覆盖 `pick-project-root` 等
- **E-9**: smoke-test 10 项只在 Windows 跑 (用 PowerShell + EnumChildWindows), macOS 无等价 — MEDIUM — 短期 dev 阶段用 `scripts/build-mac.sh --debug`, 长期 CLAUDE.md §15.4 列 3 个 IPC 命令待加
- **E-10**: 测试 fixture/mock 复用度低 — 16 个 page test 各自重复 `vi.mock('@tauri-apps/api/core')` + `mockInvoke = vi.fn()` — LOW — 抽 `src/__tests__/test-utils/mockInvoke.ts` 共享 helper

## 扫描未覆盖 / 已知限制
- **E-1 根因 (vcruntime140_1.dll 缺失)** 在本次扫描中无法独立验证 (本机为 macOS, 不跑 cargo test), 仅依赖 STATE.md / tmp/test-failures-m3.10-rust.md 既有记录
- **E-2 e2e CI 启用方案** 受限于 GitHub Actions runner 装 tauri-driver 的可行性 (需用户决策 + 白名单), 本报告只列方案不给最终建议
- **E-5 25 个 failures 的具体根因** 仅抽样分析 history/index.tsx:141 + usage-query/index.tsx:513 两个 null deref, 其余 23 个未逐文件 root-cause (需后续 GSD code-review 派生)
- **E-6 macOS 编译挂** 仅基于 grep `use platform::windows` 推断, 未实际跑 `cargo check --tests` 在 mac 上验证
- **E-9 macOS smoke test 改造** CLAUDE.md §15.7 已声明本项目不做 release 链路, 故 §15.4 列的 3 个 IPC 命令 (`get_webview_children_count` 等) 改造优先级低
- **设计 doc §2.2 模板要求**: 已严格按格式输出 (元信息 + Top 10 + 前 3 详细 + 后 7 简要 + 已知限制); 跨维度交叉 (B-2/B-10/C-2/C-3/F-1) 已显式引用
- **报告 ≤30-50 页**: 本报告实际 ~135 行 ≈ 3 页 (dense), 满足硬约束

---

*扫描日期: 2026-06-24 | 扫描者: 维度 E subagent | 引用 baseline: npm test 25 failed / 445 passed (470 tests). 本 REPORT.md 由主 session 从 task-3-E-report.md 落盘.*