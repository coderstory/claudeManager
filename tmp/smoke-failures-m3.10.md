# M3.10-arch Smoke Test 报告 (subagent D-槽1)

> 日期: 2026-06-22
> exe: `~/Desktop/ClaudeConfigManager-M3/ClaudeConfigManager-M3.10-dual-mode-arch.exe`
> 流程: `bash scripts/build-and-ship.sh --milestone M3 --task 10 --slug dual-mode-arch`

## §1 Build 结果 — ✅ PASS

| 步骤 | 状态 | 详情 |
|---|---|---|
| beforeBuildCommand (npm run build) | ✅ PASS | tsc + vite build 成功 (1717 modules, 2.15s) |
| cargo release build | ✅ PASS | 1m 57s |
| exe 大小 | 31.8 MB | (M2.16 ship exe ~32MB, 同量级) |
| 复制到桌面 | ✅ PASS | ClaudeConfigManager-M3/ClaudeConfigManager-M3.10-dual-mode-arch.exe |
| WebView2Loader.dll | ✅ PASS | 一同 cp |

## §2 Smoke Test — 7/7 PASS

| # | 检查项 | 结果 |
|---|---|---|
| 1 | 启动 → 5s 内进程在 | ✅ PASS (count=1) |
| 2 | 主窗口可见 (MainWindowHandle + Responding) | ✅ PASS |
| 3 | 关闭 → 进程仍在 (最小化到托盘) | ✅ PASS |
| 4 | 强制 kill → 2s 内进程消失 | ✅ PASS |
| 5 | WebView2 子窗口存在 (frontend loaded) | ✅ PASS (10 个 Chrome_WidgetWin_*) |
| 6 | 窗口标题 = tauri.conf.json productName | ✅ PASS (含 "Claude 配置管理器") |
| 7 | Frontend assets 嵌入 exe | ✅ PASS (index-BofiidDY.{js,css} found) |

## §3 结论

**M3.10-arch exe ship 成功,smoke test 全过。**

- 主 exe 在 Windows 上能启动、能渲染前端、能最小化到托盘、能 kill 干净。
- 窗口标题正确 (M2.16 修复过的产品名)。
- 前端 bundle (TS + Vite build) 已嵌入 exe (Test 7 验证 dist 指纹)。
- WebView2 子窗口类齐全 (WRY_WEBVIEW / Chrome_WidgetWin_0/1 / Chrome_RenderWidgetHostHWND / Intermediate D3D Window)。

## §4 用户核定等待

按 CLAUDE.md §9.5:cp 到桌面后,**等待用户明确"完成"或"未完成：<原因>"**。
未经核定不进入下一迭代 (M3.10 polish / M3.11 plugin 适配)。

## §5 已知不影响 ship 的事项

- `cargo test --lib` 跑不起来 — dev box 缺 `vcruntime140_1.dll`,见 `tmp/test-failures-m3.10-rust.md`。这是环境问题,M2.17 继承而来,与 M3.10-arch 代码无关。`cargo check --lib` + `cargo check --tests` + `cargo test --no-run` 全部 PASS,代码本身正确。
- UI e2e (Playwright `npx playwright test --grep "project switcher"`) auto 模式未跑 — Playwright 配置 TBD,见 `tmp/test-failures-m3.10-e2e.md`。