# 维度 A: 跨平台架构 缺陷盘点

## 元信息

- **维度 ID**: A
- **扫描范围**:
  - `src-tauri/src/platform/` (traits.rs + windows/ + macos/ + mod.rs)
  - `src-tauri/Cargo.toml` + `Cargo.lock`
  - `src-tauri/tauri.conf.json` + `ClaudeConfigManager.entitlements`
  - `scripts/` (12 个 .sh / .py / .cjs / .bash 文件)
- **排除**: 4 个冲突文件 (Wave 0 已解, 当前工作区干净)
- **扫描方法**:
  - Read 全量 `platform/{traits.rs, mod.rs, macos/*, windows/*}` (18 文件)
  - Read 12 个 scripts/ 文件
  - Read Cargo.toml / tauri.conf.json / entitlements
  - Read 既有 4 份 audit (audit-{deps,rust,scripts,frontend}.md)
  - 静态 grep: `#[cfg(windows)]` / `#[cfg(target_os = "macos")]` / `unimplemented!` / `todo!` / Windows-only API 调用
- **引用资产**:
  - `tmp/audit-deps.md` (191 行) — 跨平台依赖
  - `tmp/audit-rust.md` (192 行) — Rust macOS 兼容性
  - `tmp/audit-scripts.md` (282 行) — scripts macOS 兼容性
  - `tmp/audit-frontend.md` (295 行) — 前端 + 构建链 macOS
  - CLAUDE.md §3.2 (OS 抽象层纪律) + §13.2 (跨平台 build 陷阱) + §15 (macOS 约束)
- **扫描时长**: ~30 分钟 (简版扫描后由主 session 补全本完整 REPORT.md)

---

## Top 问题清单 (按严重度排序)

| # | 问题 | 文件:行 | 严重度 | 证据 | 修复建议 | 关联 audit/维度 |
|---|---|---|---|---|---|---|
| **A.1** | smoke-test.sh 整脚本 Windows-only (PowerShell + cygpath + Win32 P/Invoke) | `scripts/smoke-test.sh:65,113-117,172-225,272-283,357-360,472-509` | **CRITICAL** | 9 处不兼容点 (audit-scripts §2 smoke-test), macOS 完全无法跑 (Win32 `EnumChildWindows` 不可移植) | Fork `scripts/smoke-test-mac.sh`: 用 `osascript` (System Events + AXWindow) 枚举 webview 子窗口 + `pgrep`/`kill`/`lsof` 替换 powershell/tasklist; 加 IPC `get_webview_children_count` (CLAUDE.md §15.4) | audit-scripts §2 smoke-test §3 §4 (P0); §15.7 已砍 |
| **A.2** | kill-app.sh 整脚本 Windows-only (tasklist/taskkill + powershell) | `scripts/kill-app.sh:21,30,41-43,49,59-65,77-88,102-105` | **CRITICAL** | 6 处不兼容 (audit-scripts §2 kill-app); `EXE_NAME="claude-config-manager.exe"` 硬编码后缀, macOS 无 .exe | Fork `scripts/kill-app-mac.sh`: `pgrep -f "ClaudeConfigManager"` + `osascript 'tell application ... to quit'` + `kill -9`; 抽 `detect_kill_cmd()` 函数统一调度 | audit-scripts §2 kill-app §3 (P0); §15.7 dev 阶段仍做 |
| **A.3** | run-e2e.sh 绑死 msedgedriver.exe + cygpath + powershell | `scripts/run-e2e.sh:68-72,75,81,91,97,106,120,150-153` | **CRITICAL** | 6 处不兼容 (audit-scripts §2 run-e2e); MSEDGEDRIVER_CANDIDATES 数组含 Windows-only `$LOCALAPPDATA/Temp`; `application: exe` 在 macOS 接受 `.app` bundle path (audit-scripts §2) | Fork `run-e2e-mac.sh`: 探测 `safaridriver` (Tauri macOS 用 WebKit, 需要 Safari driver, 已知 ci.yml:153 e2e 整套 skip); `cygpath` 改 `readlink -f` 或省略 | audit-scripts §2 run-e2e §4 (P0); audit-frontend §5.2 e2e 缺口 |
| **A.4** | fs_atomic::local_utc_offset_minutes OS 调用泄漏 (违反 CLAUDE.md §3.2) | `src-tauri/src/infrastructure/fs_atomic.rs:251-326` | HIGH | 24 行 raw FFI + 26 行 libc extern (audit-rust §1.3 §4.3); 直接 `#[cfg(windows)] extern "system"` 调 `GetTimeZoneInformation` 在 infrastructure 层 (应只在 platform/) | 迁到 `src-tauri/src/platform/windows/time.rs` + `platform/macos/time.rs` + `ITimeZone` trait; 业务代码 `infrastructure/fs_atomic` 只调接口 | audit-rust §4.3 P2; CLAUDE.md §3.2 |
| **A.5** | lib.rs 单元测试 fixture 用 `.exe` 字面量 (8 处) | `src-tauri/src/lib.rs:480/504/514/523/532/546/562/571` | HIGH | `extract_sql_file_path` 函数本身跨平台 (用 `Path::extension`), 但 fixture 用了 Windows 风格绝对路径 (audit-rust §1.5 §4.2); 这些不是运行时硬编码但增加 macOS 阅读认知负担 | 改为 `claude-config-manager` (无后缀), 不影响行为 | audit-rust §4.2 P1 |
| **A.6** | build-and-ship.sh 含 5 处 macOS 不兼容点 (high: DESKTOP_BASE 硬编码 + .exe 后缀) | `scripts/build-and-ship.sh:49,51-54,56` | HIGH | DESKTOP_BASE="/c/Users/e-Yunfei.Qian/Desktop" 硬编码 (audit-scripts §2 build-and-ship L49); DEST_EXE="...exe" 硬编码 (audit-scripts §2 L51-54); 整个脚本是 Windows ship 流程 | 加 OS 分支: macOS 走 `build-mac.sh --debug` (CLAUDE.md §9.7.3 Flow 3); Windows 保持现有; 或在脚本头加 `[[ "$OSTYPE" != "msys"* ]] && { echo "macOS 用 build-mac.sh"; exit 0; }` | audit-scripts §2 build-and-ship §4 (P1); CLAUDE.md §9.7.3 |
| **A.7** | test-verify.sh 3 处 Windows-only 假设 (mingw64 PATH / WebView2Loader.dll / *.exe find) | `scripts/test-verify.sh:21,33,41,45` | HIGH | L21 `/c/msys64/...` PATH 注入在 macOS 不存在; L33 cp WebView2Loader.dll (Win DLL); L41/45 find `*.exe` (macOS 无 .exe) (audit-scripts §2 test-verify) | 加 `[[ "$OSTYPE" == "msys"* ]]` 守卫包裹 Win-only 段; macOS/Linux skip cp + find 改 `-type f -executable` (脚本 L54-58 已部分兼容但 L21 PATH 注入未守) | audit-scripts §2 test-verify §4 (P0) |
| **A.8** | build-only.sh EXE_PATH 硬编码 `.exe` 后缀 | `scripts/build-only.sh:72,80` | HIGH | L80 `claude-config-manager$EXE_SUFFIX` (变量已引入但路径拼接仍含); 实际 `EXE_SUFFIX` 在 L34-37 定义了但部分场景未用到 (audit-scripts §2 build-only L72) | audit-scripts 已识别并给出修复 (L80 已用 `$EXE_SUFFIX`, L72 cargo clean 也需同步); 验证 EXE_SUFFIX 路径完整性 | audit-scripts §2 build-only §4 (P0) |
| **A.9** | cdp-f3-import-verify.cjs 含 Windows-only 硬编码路径 + powershell kill | `scripts/tests/cdp-f3-import-verify.cjs:191,207-209` | HIGH | L191 硬编码 `C:\\Users\\e-Yunfei.Qian\\AppData\\Roaming\\...`; L207-209 powershell kill (audit-scripts §2 cdp-f3) | 改 `os.homedir()` + `path.join('Library', 'Application Support', 'ClaudeConfigManager', 'providers')`; kill 走 `child.kill()` (Node 内置, 已部分实现) | audit-scripts §2 cdp-f3 §4 (P0) |
| **A.10** | bundle.macOS.entitlements 路径未做平台分发 (TAURI CONF 仅写一个相对路径) | `src-tauri/tauri.conf.json:59` | MEDIUM | `entitlements: "ClaudeConfigManager.entitlements"` 单一路径; 若未来 Win 也需 `.exe.manifest` 或 Mac 多 entitlement 文件无扩展点 | 当前 OK (单文件够用, §15.6 dev 阶段已 ship); 列入 backlog, 待 M4 backlog 重新评估 | audit-rust §3 §4.1 P0; CLAUDE.md §15.6 |

---

## 详细分析 (前 3 条展开)

### 问题 A.1: smoke-test.sh 整脚本 Windows-only (CRITICAL)

**症状**:
脚本 `scripts/smoke-test.sh` 是 M1.x ship 门禁的核心 (CLAUDE.md §9.4 10 项验证), 但整脚本从 L65 `cygpath -w` 调用起, 全部用 Windows 工具链: PowerShell + tasklist/taskkill + Win32 P/Invoke `EnumChildWindows` + `Get-ClassName` + `GetFolderPath('ApplicationData')`。脚本首行 `cygpath -w "$EXE_PATH"` 在 macOS 上 `cygpath` 命令不存在 → fallback `echo "$EXE_PATH"` 后传给 PowerShell → 完全失败。

**证据** (9 处不兼容点全在 `scripts/smoke-test.sh`):

```bash
# L65 — Git Bash Windows-only 桥
EXE_PATH_WIN=$(cygpath -w "$EXE_PATH" 2>/dev/null || echo "$EXE_PATH")

# L82 — Windows-only 路径硬编码
TAURI_CONF="${TAURI_CONF:-/d/project/winui3/src-tauri/tauri.conf.json}"

# L113-117, L472-509 — 5 处 powershell.exe 调用 (kill / process query / window state)
powershell.exe -NoProfile -Command "
  foreach (\$n in @('${SOURCE_PROCNAME}', '${EXE_NAME_NO_EXT}')) {
    Get-Process -Name \$n -ErrorAction SilentlyContinue | Stop-Process -Force
  }
" 2>&1 || true

# L172-225 — 大段 Win32 P/Invoke heredoc (EnumChildWindows + GetClassName)
Add-Type -TypeDefinition @'
using System;
public class W2 {
  [DllImport("user32.dll")]
  public static extern bool EnumChildWindows(IntPtr hWndParent, EnumWindowsProc lpEnumFunc, IntPtr lParam);
  ...
}
'@
```

**根因**:
1. **设计期未考虑跨平台**: smoke-test.sh 起源是 M1.3 era (CLAUDE.md §13.1), 当时 dev box 仅 Windows, 脚本自然绑死 Windows 工具链
2. **WebView2 子窗口枚举无 macOS 等价**: Windows 用 `EnumChildWindows` 找 `Chrome_WidgetWin_*` 类名; macOS WKWebView 无等价 CLI API (System Events + AXWindow 可查但需 `osascript`)
3. **CLAUDE.md §15.7 决策**: "本项目不做发布 → macOS smoke test 改造不进 release CI 链路", 但 dev 阶段 (`scripts/build-mac.sh --debug`) 用户在 mac 真机验证时仍需要冒烟测试

**修复建议** (按 CLAUDE.md §9.7.1 §15.7 决策):
1. **短期 (满足 §15.7 dev 阶段)**: Fork `scripts/smoke-test-mac.sh`, 复用 smoke-test.sh 的 10 项结构 (CLAUDE.md §9.4), 但替换 Windows 工具链:
   - `cygpath -w` → `realpath` (跨平台) 或省略 (macOS powershell 不需要)
   - `powershell.exe` → `osascript` + `pgrep` + `lsof`
   - `Get-Process -Name ... | Stop-Process -Force` → `pkill -f "ClaudeConfigManager"`
   - `EnumChildWindows` (找 webview 子窗口) → `osascript -e 'tell application "System Events" to tell process "ClaudeConfigManager" to get name of every window'` (ax window 列表)
   - `[Environment]::GetFolderPath('ApplicationData')` → `$HOME/Library/Application Support/ClaudeConfigManager/`
   - window title 验证 → `osascript -e 'tell application "ClaudeConfigManager" to get name of front window'`
   - WebView2Loader.dll 验证 → 跳过 (macOS 用 WKWebView, 框架自带)
2. **Rust IPC 补充**: CLAUDE.md §15.4 列了 3 个 IPC 命令 (`get_webview_children_count` / `get_window_state` / `get_app_metadata`), 后端 IPC 加这 3 条后, 前端 e2e 可以用更可靠的方式验证 webview 状态, 不依赖 Win32 P/Invoke
3. **不强行 fork**: CLAUDE.md §15.7 明确 "macOS smoke test 改造: 可仅做 dev 工具 (不强制), 不进 CI", 因此本条修复可以标记为 P2 backlog, 不阻塞 v3.0 ship

**风险评估**:
- 修改成本: 高 (整脚本 fork, 半天工作量)
- 兼容性: macOS fork 仅 mac 用, 不影响 Windows 路径
- 测试: dev box (Windows) 不能验证 macOS fork → 必须用户 mac 真机手验 (CLAUDE.md §15.1)
- 与 §15.7 决策的关系: §15.7 已砍掉 release CI 改造, 但 dev 阶段 (`scripts/build-mac.sh --debug` + 手动跑) 仍可做

**关联**:
- `tmp/audit-scripts.md` §2 smoke-test §3 §4 (P0 27 处)
- `tmp/audit-frontend.md` §5.2 e2e 缺口 (tauri-driver 在 macOS 推迟)
- CLAUDE.md §9.4 (smoke test 10 项是 ship 门禁)
- CLAUDE.md §13.1 (smoke test 4 项 → 10 项演进)
- CLAUDE.md §15.4 (Rust IPC 补充的 macOS-only 命令)
- CLAUDE.md §15.7 (本项目不做发布 → smoke test 改造不强制)

---

### 问题 A.2: kill-app.sh 整脚本 Windows-only (CRITICAL)

**症状**:
`scripts/kill-app.sh` 是 build-and-ship.sh / smoke-test.sh / run-e2e.sh / 手动 dev 清理的 "central cleanup utility" (CLAUDE.md §9.7.2 依赖图), 但 L21 `EXE_NAME="claude-config-manager.exe"` 硬编码 `.exe` 后缀, L30 `SUFFIX_WILDCARD="ClaudeConfigManager-M*"` 是 Windows shell 通配, L41-43 powershell 调用 + L49 tasklist + L59-65 taskkill + L77-88 powershell heredoc 全是 Windows-only。macOS 无 `.exe` 后缀, 无 `tasklist`/`taskkill` 命令, 无 `powershell.exe`。

**证据** (6 处不兼容点全在 `scripts/kill-app.sh`):

```bash
# L21 — 硬编码 .exe 后缀
EXE_NAME="claude-config-manager.exe"

# L29-30 — Windows shell 通配
SHORT_NAME="${EXE_NAME%.exe}"          # claude-config-manager
SUFFIX_WILDCARD="ClaudeConfigManager-M*" # matches ClaudeConfigManager-M2.3.1-foo.exe etc.

# L41-43 — powershell 调用
check_remaining_count() {
  powershell.exe -NoProfile -Command "
    @(Get-Process -Name @('${ALL_NAMES[0]}','${ALL_NAMES[1]}') -ErrorAction SilentlyContinue).Count
  " 2>&1 | tr -d '\r' | head -1
}

# L49 — tasklist 命令
PIDS=$(tasklist 2>/dev/null | grep -iE "${NAME_REGEX}" | awk '{print $2}' || true)

# L59-65 — taskkill
for pid in $PIDS; do
  taskkill -F -PID "$pid" 2>&1 || true
done

# L77-88 — 大段 powershell heredoc (CloseMainWindow / Stop-Process)
PID_CSV="$PIDS_CSV" powershell.exe -NoProfile -Command - <<PWSH_EOF 2>&1 || true
\$idStr = \$env:PID_CSV
\$ids = @(\$idStr -split ',' | Where-Object { \$_ -match '^\d+\$' } | ForEach-Object { [int]\$_ })
foreach (\$id in \$ids) {
  \$proc = Get-Process -Id \$id -ErrorAction SilentlyContinue
  if (\$proc -and \$proc.MainWindowHandle -ne 0) {
    \$proc.CloseMainWindow() | Out-Null
  } else {
    Stop-Process -Id \$id -Force
  }
}
PWSH_EOF
```

**根因**:
1. **设计期 Windows-only**: 与 smoke-test.sh 同根 (M1.3 era), 当时 dev box 仅 Windows
2. **架构上依赖 PowerShell**: "graceful exit" 用 `CloseMainWindow()` 是 Win32 API (发 WM_CLOSE), macOS 用 `osascript 'tell application ... to quit'` 或 Apple Events (`kill -SIGTERM` 不优雅)
3. **EXE_NAME 硬编码 .exe 是认知负担**: 即便后续 `EXE_SUFFIX` 变量引入 (build-only.sh L34-37 那样), 仍未消除 `claude-config-manager.exe` 字面量 (L21)

**修复建议**:
1. **抽 `detect_kill_cmd()` 函数** (CLAUDE.md §9.7.1 决策树提到但未实施):
   ```bash
   detect_kill_cmd() {
     if [[ "$(uname -s)" == "MINGW"* || "$(uname -s)" == "CYGWIN"* || "$(uname -s)" == "MSYS"* ]]; then
       echo "windows"
     else
       echo "$(uname -s | tr '[:upper:]' '[:lower:]')"
     fi
   }
   ```
2. **Windows 分支** (L41-105 现状): 保留 powershell + tasklist/taskkill + CloseMainWindow
3. **macOS 分支** (新加):
   - `pgrep -f "ClaudeConfigManager"` 找 PID
   - graceful: `osascript -e 'tell application "ClaudeConfigManager" to quit'` + 等待 5s
   - force: `kill -9 $pid` 或 `killall ClaudeConfigManager`
   - 剩余数: `pgrep -fc "ClaudeConfigManager"` 替换 `check_remaining_count`
4. **Linux 分支** (未来扩展, 当前不在 scope): 参照 macOS, 替换为 `killall` / `pkill -f`

**风险评估**:
- 修改成本: 中 (半天, 关键是 graceful exit 的 macOS 实现)
- 兼容性: 4 个调用方 (build-and-ship.sh / smoke-test.sh / run-e2e.sh / 手动) 都在 Windows dev box, Windows 分支不变即可保持
- 测试: 与 A.1 同, dev box 不能验证 macOS 分支 → 用户 mac 真机手验

**关联**:
- `tmp/audit-scripts.md` §2 kill-app §3 §4 (P1)
- CLAUDE.md §9.7.2 依赖图 (kill-app.sh 是 4 脚本的中心节点)
- CLAUDE.md §9.7.4 决策树 (dev 循环 `./scripts/kill-app.sh` 第一步)
- CLAUDE.md §15.7 (kill-app 改造 dev 阶段仍做, 不进 CI)

---

### 问题 A.3: run-e2e.sh 绑死 msedgedriver.exe + cygpath + powershell (CRITICAL)

**症状**:
`scripts/run-e2e.sh` 是 M1.8 e2e 验证入口, 但 L68-72 `MSEDGEDRIVER_CANDIDATES` 数组含 `$LOCALAPPDATA/Temp` + `$TEMP` + `$HOME/.cache/msedgedriver` + `/c/Users/${USER:-e-Yunfei.Qian}/AppData/Local/Temp`, 全是 Windows-only 路径; L75 `[[ -x "$c/msedgedriver.exe" ]]` 检查 .exe 文件 (macOS 没 .exe 后缀); L91 `EXE_PATH` 默认值硬编码 `.exe`; L97 `cygpath -w "$EXE_PATH"`; L106/120 powershell kill; L150-153 WebDriver session payload 调 `application: exe` (macOS 需 `.app` bundle path)。

**证据** (6 处不兼容点):

```bash
# L68-72 — MSEDGEDRIVER_CANDIDATES 全 Windows 路径
MSEDGEDRIVER_CANDIDATES=(
  "$LOCALAPPDATA/Temp"
  "$TEMP"
  "$HOME/.cache/msedgedriver"
  "/c/Users/${USER:-e-Yunfei.Qian}/AppData/Local/Temp"
)
for c in "${MSEDGEDRIVER_CANDIDATES[@]}"; do
  if [[ -n "$c" && -x "$c/msedgedriver.exe" ]] && ! command -v msedgedriver.exe >/dev/null 2>&1; then
    export PATH="$c:$PATH"
    echo ">>> Auto-added $c to PATH (msedgedriver.exe found)"
    break
  fi
done
if ! command -v msedgedriver.exe >/dev/null 2>&1; then
  echo "FAIL: msedgedriver.exe not on PATH."
  ...

# L91 — EXE_PATH 硬编码 .exe
EXE_PATH="${EXE_PATH:-$PROJECT_ROOT/src-tauri/target/release/claude-config-manager.exe}"

# L97 — cygpath
EXE_PATH_WIN=$(cygpath -w "$EXE_PATH" 2>/dev/null || echo "$EXE_PATH")

# L106 — powershell kill
powershell.exe -NoProfile -Command "Get-Process -Name 'tauri-driver','msedgedriver' -ErrorAction SilentlyContinue | Stop-Process -Force" 2>&1 || true

# L150-153 — WebDriver session payload (macOS 需 .app bundle path)
node -e "
const fs = require('fs');
const exe = process.argv[1];
const payload = JSON.stringify({
  capabilities: { alwaysMatch: { 'tauri:options': { application: exe } } }
});
fs.writeFileSync(process.argv[2], payload, 'utf8');
" "$EXE_PATH_WIN" "$SESSION_PAYLOAD_FILE"
```

**根因**:
1. **WebDriver 协议差异**: tauri-driver 是 Tauri 官方的 WebDriver 实现, 但**macOS 端需要 `safaridriver`** (Apple 的 Safari WebDriver, 单独安装 `safaridriver --enable`), 不能用 msedgedriver (Edge 是 Win/Linux Chromium 内核)
2. **Tauri 在 macOS 上用 WKWebView (Safari 内核)**, 不是 WebView2 (Edge Chromium), 因此 e2e 测试 macOS 必须用 safaridriver 而非 msedgedriver
3. **CI 端 e2e 整体 skip**: `audit-frontend.md §5.2` 提到 `ci.yml:125` `if: ${{ false }}` 整体禁用 e2e job, 因此 run-e2e.sh 在 CI 上根本没跑, 本地 Windows dev box 才用

**修复建议**:
1. **macOS fork `run-e2e-mac.sh`** (与 smoke-test-mac.sh / kill-app-mac.sh 一套):
   - `MSEDGEDRIVER_CANDIDATES` → `SAFARIDRIVER_CANDIDATES` (探测 `/usr/bin/safaridriver` + `/Applications/Safari Technology Preview.app/Contents/MacOS/safaridriver`)
   - `cygpath -w` → 省略 (macOS powershell 不存在)
   - `EXE_PATH` 默认值 → `target/release/bundle/macos/ClaudeConfigManager.app`
   - WebDriver payload `application: exe` → `application: <path>/ClaudeConfigManager.app` (Tauri driver 接受 .app bundle)
   - powershell kill → `pkill -f tauri-driver`
2. **不动现状 CI**: CLAUDE.md §15.7 + audit-frontend §5.2 已确认 e2e 整套 skip, macOS fork 仅作为 dev 工具 (用户 mac 手验)
3. **Playwright + CDP 桥接**: 现有 Playwright via CDP 方案 (L142-185) 在 macOS 上 WKWebView 同样有 CDP 端点 (`remote-debugging-port`), 但需要 `safaridriver --enable` + Apple Events 授权 (类似 entitlements `com.apple.security.temporary-exception.apple-events` 已在 §15.6 配好)

**风险评估**:
- 修改成本: 中-高 (跨 WebDriver 协议, 比 smoke-test 复杂)
- 兼容性: macOS fork 仅 mac 用
- 测试: dev box 不能验证 → 用户 mac 真机手验; 若 safaridriver 未启用, 报错信息必须清晰 (`safaridriver --enable` 命令)
- 与 §15.7 决策关系: §15.7 砍掉了 release CI 改造, 但 run-e2e-mac.sh 仍可作为 dev 工具

**关联**:
- `tmp/audit-scripts.md` §2 run-e2e §3 §4 (P1)
- `tmp/audit-frontend.md` §5.2 (e2e 整套 skip, ci.yml:125)
- CLAUDE.md §15.4 (tauri-driver 在 macOS 需要 codesign + helper bundle)
- CLAUDE.md §15.7 (e2e macOS fork 不进 CI, dev 阶段仍做)

---

## 简要列举 (第 4-10 条)

- **A.4** (`fs_atomic::local_utc_offset_minutes` OS 调用泄漏, HIGH): `src-tauri/src/infrastructure/fs_atomic.rs:251-326` 直接 `#[cfg(windows)] extern "system"` 调 Win32 `GetTimeZoneInformation` (24 行 raw FFI) + `#[cfg(not(windows))] extern "C"` 调 libc `localtime_r` + `tm_gmtoff` (26 行) — 违反 CLAUDE.md §3.2「业务代码只调接口」纪律, audit-rust §4.3 列为 P2 — 修复: 迁到 `platform/windows/time.rs` + `platform/macos/time.rs` + `ITimeZone` trait, 业务代码 `infrastructure/fs_atomic` 只调接口, `#[cfg(target_os)]` 收敛到 platform 层 — file_path: `src-tauri/src/infrastructure/fs_atomic.rs:251-326`, 严重度 HIGH, 关联 `audit-rust.md §4.3 P2` / CLAUDE.md §3.2

- **A.5** (lib.rs 测试 fixture `.exe` 硬编码, HIGH): `src-tauri/src/lib.rs:480/504/514/523/532/546/562/571` 共 8 处用 `claude-config-manager.exe` 字面量作为 fixture. 函数 `extract_sql_file_path` 本身跨平台 (用 `Path::extension`), 但 fixture 用 Windows 风格绝对路径. 修复: 改为 `claude-config-manager` (无后缀), 不影响行为 — file_path: `src-tauri/src/lib.rs:480-571`, 严重度 HIGH, 关联 `audit-rust.md §4.2 P1`

- **A.6** (build-and-ship.sh 5 处 macOS 不兼容, HIGH): `scripts/build-and-ship.sh:49,51-54,56` 含 DESKTOP_BASE 硬编码 `/c/Users/e-Yunfei.Qian/Desktop` + DEST_EXE 硬编码 `.exe` + EXE_NAME 硬编码 `.exe`. 整个脚本是 Windows ship 流程. 修复: 加 OS 分支, macOS 走 `build-mac.sh --debug` (CLAUDE.md §9.7.3 Flow 3); 或在脚本头加 `[[ "$OSTYPE" != "msys"* ]] && { echo "macOS 用 build-mac.sh"; exit 0; }` — file_path: `scripts/build-and-ship.sh:49-56`, 严重度 HIGH, 关联 `audit-scripts.md §2 build-and-ship §4 (P1)` / CLAUDE.md §9.7.3

- **A.7** (test-verify.sh 3 处 Windows-only 假设, HIGH): `scripts/test-verify.sh:21,33,41,45` mingw64 PATH 注入 (L21 `/c/msys64/...`) + WebView2Loader.dll cp (L33, Win DLL) + `find *.exe` (L41/45, macOS 无 .exe). 修复: 加 `[[ "$OSTYPE" == "msys"* ]]` 守卫包裹 Win-only 段; macOS/Linux skip cp + find 改 `-type f -executable` (脚本 L54-58 已部分兼容, L21 PATH 注入未守, 关键) — file_path: `scripts/test-verify.sh:21-33-41-45`, 严重度 HIGH, 关联 `audit-scripts.md §2 test-verify §4 (P0)`

- **A.8** (build-only.sh EXE_SUFFIX 路径不完整, HIGH): `scripts/build-only.sh:72,80` L80 `claude-config-manager$EXE_SUFFIX` 已用变量, 但 L72 cargo clean 输出路径未用 `EXE_SUFFIX`. 修复: 验证 L72-80 EXE_SUFFIX 路径完整性; cargo clean 后输出路径 `target/release/` 下应同时检测 `.exe` (Win) 和无后缀 (Mac/Linux) — file_path: `scripts/build-only.sh:72,80`, 严重度 HIGH, 关联 `audit-scripts.md §2 build-only §4 (P0)`

- **A.9** (cdp-f3-import-verify.cjs Windows-only, HIGH): `scripts/tests/cdp-f3-import-verify.cjs:191,207-209` 硬编码 `C:\\Users\\e-Yunfei.Qian\\AppData\\Roaming\\...` + powershell kill. 修复: L191 改 `os.homedir()` + `path.join('Library', 'Application Support', 'ClaudeConfigManager', 'providers')`; L207-209 改 Node 内置 `process.kill(pid)` (macOS 兼容, 已部分实现) — file_path: `scripts/tests/cdp-f3-import-verify.cjs:191-209`, 严重度 HIGH, 关联 `audit-scripts.md §2 cdp-f3 §4 (P0)`

- **A.10** (bundle.macOS.entitlements 平台分发缺失, MEDIUM): `src-tauri/tauri.conf.json:59` `bundle.macOS.entitlements: "ClaudeConfigManager.entitlements"` 单一路径 (无 OS 分发字段). 当前 dev 阶段够用 (audit-rust §3 §4.1 已识别 + CLAUDE.md §15.6 dev 阶段 entitlements 已 ship 于 commit `2b621ab`). 修复: 当前无需改; 列入 backlog, 待 M4 backlog 重新评估 Mac 真机验证时机; 若未来 Win 需 `.exe.manifest` 或 Mac 多 entitlement 文件, Tauri v2 不支持平台分流, 需手动用 `tauri.conf.json` 的 `bundle.windows`/`bundle.macOS` 子键分别配置 — file_path: `src-tauri/tauri.conf.json:59`, 严重度 MEDIUM, 关联 `audit-rust.md §4.1 P0` / CLAUDE.md §15.6

---

## 扫描未覆盖 / 已知限制

1. **本项目不做发布** (CLAUDE.md §15.7): 修复 A.1-A.3 + A.6-A.7 + A.9 共 6 条修复需要 fork macOS 版本, 总工作量约 2-3 天 (半天/脚本 × 4-6), 但 §15.7 决策不强制 — macOS fork 仅作 dev 工具, 不进 CI
2. **A.4 fs_atomic refactor 风险**: 修复方案是 refactor (迁代码到 platform 层), 涉及多个文件 + 测试, 工作量约 0.5-1 天, 需评估 refactor 风险 (现有 `infrastructure/fs_atomic` 有 4 处调用 `local_utc_offset_minutes()`, 改 trait 后需全替换)
3. **A.5 lib.rs fixture 改名**: 修复简单 (8 处文本替换), 但需跑 cargo test 验证 (CLAUDE.md §5 TDD 强制), 注意 macOS 上 cargo test 不跑 (webview2-com 静态链接导致 STATUS_ENTRYPOINT_NOT_FOUND, scripts/test-verify.sh 已知), 仅做编译验证
4. **A.10 entitlements**: 当前无需改, 列入 backlog; CLAUDE.md §15.7 决策已砍 release 链路 (codesign / 公证 / Hardened Runtime), 因此 §15.6 dev 阶段 entitlements 够用
5. **macOS 真机验证依赖用户**: dev box 是 Windows (CLAUDE.md §15.1), 本审计无法跑 `cargo tauri build` 在 macOS 真机, 所有 macOS 兼容结论基于静态代码阅读 + `audit-{deps,rust,scripts}.md` 引用
6. **本报告补全说明**: A 子报告 (task-2-A-report.md) 仅 58 行简版, 本完整 REPORT.md 由主 session 基于已有证据 + transcript 拼装而成, 与 B/C/D/E/F 子报告同构 (元信息 + Top 10 + 前 3 详细 + 后 7 简要 + 已知限制)

---

*Report compiled: 2026-06-24 | Scanned by: subagent A + 主 session 补全 | Source: 12 scripts/ + 9 macos/ + 9 windows/ + 1 traits.rs + 1 mod.rs + Cargo.toml + tauri.conf.json + entitlements + 6 existing audits | Cross-ref: CLAUDE.md §3.2 §9 §12 §13 §15*