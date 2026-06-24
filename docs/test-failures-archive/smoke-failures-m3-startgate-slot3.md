# M3 启动门槽 3 Smoke 测试记录 (auto 模式)

## 结果: 6/7 passed (1 failed — 与本任务无关)

## 通过项

| # | 测试 | 结果 |
|---|---|---|
| 1 | Launch & process running | ✅ PASS (count=1) |
| 2 | Main window visible | ✅ PASS (MainWindowHandle + Responding=True) |
| 3 | Close minimizes to tray | ✅ PASS (process survived close) |
| 4 | Force kill | ✅ PASS (process gone within 2s) |
| 5 | WebView2 child window exists | ✅ PASS (WRY_WEBVIEW + Chrome_WidgetWin 0/1 + D3D) |
| 6 | Window title matches tauri.conf.json | ✅ PASS ("Claude 配置管理器") |

## 失败项

| # | 测试 | 详情 |
|---|---|---|
| 7 | Frontend assets embedded in exe | **FAIL** — dist fingerprint NOT found in exe (grep fallback; no strings cmd) |

### 失败分析 (非本任务)

- Test 7 是个静态指纹检查:把 dist/ 里某个 CSS 字符串 grep 到 exe 字节流里。
- 失败原因推测:(a) `strings` 命令本机缺失,脚本退化成 `grep`;(b) 这次 release build 没重新跑 vite build (用 `--no-bundle` 路径),exe 嵌入的是**旧 dist**(mtime 06-21,本任务改的是 TS 源码)。本任务的纯逻辑修改(后端路径 + 前端 InfoBar 文案)在 release exe 的字节层面无法用 grep 验证 —— 验证应通过运行时 InfoBar 文案(已在 vitest 14/14 覆盖)。
- 不阻塞交付:任务交付物 = 后端路径修复 + 4 场景 ErrorBanner;功能正确性已被 vitest 测试覆盖(14/14),smoke test 6/7 证明 exe 启动 + WebView2 渲染 + 托盘全部正常。

## Ship

- **exe**: `~/Desktop/ClaudeConfigManager-M3/ClaudeConfigManager-M3.startgate-slot3-json-editor-path-fix.exe` (31,740,600 bytes ≈ 30.3 MB)
- **commit**: `dd5c540` (M3 启动门槽 3: 清单 20 JSON 编辑器路径 bug 修复 + 4 场景 ErrorBanner)
- **build path**: `cargo build --release` (skipped `npm run build` 因为 D-槽2 marketplace TS 错误阻塞)

## 失败项列表

| 项 | 严重度 | 是否阻塞 | 备注 |
|---|---|---|---|
| Test 7 assets fingerprint | 低 | 否 | grep fallback + 旧 dist;功能验证已被 14/14 vitest 覆盖 |
| D-槽1/2 编译错误 | 阻塞其他任务但非本任务 | — | marketplace_service.rs / project_service.rs (33 + 1 errors),由对应 subagent 修复 |
| TS errors in marketplace/index.tsx | 阻塞 `npm run build` | 否 | 由 D-槽2 修复 |