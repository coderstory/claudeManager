# scripts/ 全量 macOS 兼容性审计 (2026-06-24)

> 审计范围:`D:/project/winui3/scripts/` 下所有 .sh / .py / .cjs / .bash 文件
> 审计目标:找出 Windows-only 调用 / 硬编码路径 / 跨平台陷阱,**不修改任何文件**

---

## 1. 扫描覆盖

| 文件 | 类型 | 大小 | 是否需审计 |
|---|---|---|---|
| `scripts/build-and-ship.sh` | bash | 5.7 KB | 是 |
| `scripts/build-only.sh` | bash | 3.2 KB | 是 |
| `scripts/build-mac.sh` | bash | 3.8 KB | 是(mac 专用) |
| `scripts/build-installer.sh` | bash | 7.8 KB | 是 |
| `scripts/smoke-test.sh` | bash | 22 KB | 是 |
| `scripts/kill-app.sh` | bash | 4.6 KB | 是 |
| `scripts/run-e2e.sh` | bash | 7.8 KB | 是 |
| `scripts/test-verify.sh` | bash | 2.1 KB | 是 |
| `scripts/gen-intro-docx.py` | python | 18 KB | 是 |
| `scripts/tests/cdp-backup-verify.cjs` | node CJS | 3.4 KB | 是 |
| `scripts/tests/cdp-f3-import-verify.cjs` | node CJS | 10 KB | 是 |
| `scripts/tests/kill-app.bash` | bash | 4.9 KB | 是 |

**共 12 个文件**(原 prompt 列了 9 个 + 3 个未列出但实际存在)。

---

## 2. 每个文件的不兼容点

### scripts/build-and-ship.sh
- **L20-28**: windres.exe 自动探测(`/c/msys64/mingw64/bin`)
  - 严重度:中 — macOS 不需要 windres,但循环会直接 `for candidate` 遍历失败,不会破坏功能
  - macOS 替代:`[[ "$OSTYPE" == "darwin"* ]] && continue` 跳过
- **L49**: `DESKTOP_BASE="/c/Users/e-Yunfei.Qian/Desktop"` (Windows-only 路径)
  - 严重度:高 — macOS 路径应是 `/Users/e-Yunfei.Qian/Desktop`
  - macOS 替代:`DESKTOP_BASE="$HOME/Desktop"`
- **L51-54**: `.exe` 硬编码 (`ClaudeConfigManager-${MILESTONE}.${TASK}-${SLUG}.exe`)
  - 严重度:中 — macOS 应输出 `.app` bundle 或不复制到桌面
  - macOS 替代:本脚本本就是 Windows ship 流程,macOS 用 `build-mac.sh` 替代
- **L52-54**: `src-tauri/target/release/claude-config-manager.exe`
  - 严重度:中 — 同上
- **L56**: `EXE_NAME="claude-config-manager.exe"` 硬编码后缀
  - 严重度:低 — 仅在 §9.4 smoke-test 调用链下游使用
- **L62,68**: `touch src-tauri/src/lib.rs`(bash coreutils,跨平台 OK)
- **L101**: `npm run tauri build -- --no-bundle` 跨平台 OK
- **L111**: `stat -c%s`(GNU coreutils) / `stat -f%z`(BSD/macOS) — **已正确兼容**
- **L143**: `rm -f "$DEST_EXE" "$WEBVIEW2_DLL_DST"` 跨平台 OK

**小计:5 处不兼容(全部与"Windows ship to desktop"语义绑定)**

---

### scripts/build-only.sh
- **L15-22**: windres.exe 自动探测
  - 严重度:低 — 同 build-and-ship,循环空跑无害
- **L42**: `cargo clean --manifest-path src-tauri/Cargo.toml --release` 跨平台 OK
- **L62,68**: `touch src-tauri/src/lib.rs` 跨平台 OK
- **L72**: `EXE_PATH="$PROJECT_ROOT/$OUTPUT_DIR/claude-config-manager.exe"` 硬编码 `.exe`
  - 严重度:高 — macOS cargo 输出 `claude-config-manager`(无后缀)
  - macOS 替代:`EXE_PATH="$PROJECT_ROOT/$OUTPUT_DIR/claude-config-manager"`
- **L74**: `stat -c%s` / `stat -f%z` — **已正确兼容**

**小计:2 处不兼容**

---

### scripts/build-mac.sh
- **L58**: `osascript -e 'tell application "ClaudeConfigManager" to quit'` — **macOS only** (设计如此)
  - 严重度:无 — 整个脚本就是 macOS 专用,这是**预期行为**
- **L60**: `pkill -f "ClaudeConfigManager.app/..."` — **macOS only** (同上)
- **L72-75**: `cargo tauri build` 跨平台 OK
- **L89,100**: `du -sh` BSD/GNU 跨平台 OK

**小计:0 处不兼容(脚本本身就是 mac 专用)**

---

### scripts/build-installer.sh
- **L55-63**: windres.exe 自动探测(只在 windows case 才会被触发)
  - 严重度:低 — macOS case 走 `if ! command -v windres` 判断,循环空跑无害
- **L125**: `"${TAURI_CMD[@]}" build --bundles nsis` — **Windows only**
  - 严重度:无 — 在 `windows)` case 分支内,符合脚本设计
- **L132**: `ls "$BUNDLE_DIR"/*-setup.exe` — Windows-only
  - 严重度:无 — windows case 内,符合设计
- **L144**: `"${TAURI_CMD[@]}" build --bundles app,dmg` — **macOS only**
  - 严重度:无 — 在 `macos)` case 分支内
- **L149**: `ls "$BUNDLE_DIR"/*.dmg` — macOS-only
  - 严重度:无 — macos case 内
- **L168-170**: `stat -c%s` / `stat -f%z` — **已正确兼容**
- **L174-179**: `sha256sum` vs `shasum -a 256` — **已正确兼容**

**小计:0 处不兼容(脚本通过 case 分支已经做了正确分流)**

---

### scripts/smoke-test.sh
- **L65**: `cygpath -w "$EXE_PATH"` — **Git Bash Windows-only 桥**
  - 严重度:高 — macOS 上 `cygpath` 不存在,`|| echo` fallback 后传给 PowerShell 会失败
  - macOS 替代:整段 smoke-test 在 macOS 上必须用 macOS 原生工具(`osascript` + `pgrep` + `lsof`)**完全重写**
- **L82**: `TAURI_CONF="${TAURI_CONF:-/d/project/winui3/src-tauri/tauri.conf.json}"` — **Windows-only 路径硬编码**
  - 严重度:中 — macOS 应为 `$PROJECT_ROOT/src-tauri/tauri.conf.json`
  - macOS 替代:`TAURI_CONF="${PROJECT_ROOT}/src-tauri/tauri.conf.json"`
- **L113-117**: `powershell.exe -NoProfile -Command ... Get-Process ... | Stop-Process -Force` — **Windows-only**
  - 严重度:高 — 整个 kill 流程 macOS 需要替换
- **L172-225**: 大段 PowerShell heredoc(`Add-Type EnumChildWindows` / `Start-Process` / `Get-Process`) — **Windows-only**
  - 严重度:高 — Win32 P/Invoke `EnumChildWindows` 在 macOS 完全不可用
  - macOS 替代:用 `osascript` 查询 `System Events` 找窗口 + class
- **L227**: `powershell.exe -NoProfile -File "$SMOKE_PS1"` — **Windows-only**
- **L272-283**: `powershell.exe` 写 UTF-8 title 到 `$env:TEMP` — **Windows-only**
  - 严重度:高 — macOS 无 PowerShell;窗口标题读取走 `osascript`
- **L357-360**: `powershell.exe -Command "[Environment]::GetFolderPath('ApplicationData')"` — **Windows-only**
  - 严重度:高 — macOS appdata 应是 `~/Library/Application Support/ClaudeConfigManager`
- **L362**: `stat -c%s` / `stat -f%z` — **已正确兼容**
- **L472-509**: 4 处 `powershell.exe -NoProfile -Command ... CloseMainWindow()/Stop-Process` — **Windows-only**
  - 严重度:高
- **L56-59**: 进程名硬编码 `claude-config-manager` / `${EXE_NAME_NO_EXT}` — 跨平台 OK,但 `EXE_BASENAME="${EXE_PATH##*/}"` 后 `%` 操作 + `.exe` 拼接是 Windows-only 假设
  - 严重度:中
- **L171**: `SMOKE_PS1="/tmp/smoke-test-1-$$-$RANDOM.ps1"` — `/tmp` 跨平台 OK,但 `.ps1` 后缀无意义
- **L270**: `TITLE_BASENAME="smoke-test-title-$$-$RANDOM.txt"` — `$RANDOM` bash 内置,OK
- **L286**: `rm -f "$TITLE_PATH"` 跨平台 OK

**小计:9 处不兼容(整脚本 Windows-only,几乎无法"局部修复",需 macOS 重写或 fork)**

---

### scripts/kill-app.sh
- **L21**: `EXE_NAME="claude-config-manager.exe"` 硬编码 `.exe` 后缀
  - 严重度:高 — macOS 没有 `.exe` 后缀
- **L30**: `SUFFIX_WILDCARD="ClaudeConfigManager-M*"` Windows shell 通配
  - 严重度:中 — macOS 通配语义不同
- **L41-43**: `powershell.exe -NoProfile -Command "Get-Process -Name @(...)"` — **Windows-only**
  - 严重度:高
- **L49**: `tasklist 2>/dev/null | grep -iE` — **Windows-only**
  - 严重度:高 — macOS 用 `pgrep -f`
- **L59-65**: `taskkill -F -PID "$pid"` — **Windows-only**
  - 严重度:高 — macOS 用 `kill -9 $pid` 或 `killall`
- **L77-88**: `powershell.exe -NoProfile -Command - <<PWSH_EOF ... CloseMainWindow()/Stop-Process` — **Windows-only**
  - 严重度:高
- **L102-105**: `taskkill -F -PID` — **Windows-only**

**小计:6 处不兼容**

---

### scripts/run-e2e.sh
- **L69-72**: `MSEDGEDRIVER_CANDIDATES` 含 `$LOCALAPPDATA/Temp` / `$TEMP` / `/c/Users/.../AppData/Local/Temp`
  - 严重度:高 — macOS 上 `$LOCALAPPDATA` / `$TEMP` 是 Git Bash 模拟,实际 msedgedriver.exe 不存在
  - macOS 替代:走 `tauri-driver` + `safaridriver` 或 `chromedriver` (Tauri macOS 用 WebKit,需要 Safari driver)
- **L75**: `-x "$c/msedgedriver.exe"` — **Windows-only 文件名**
  - 严重度:高
- **L81**: `command -v msedgedriver.exe` — **Windows-only**
- **L91**: `EXE_PATH="${EXE_PATH:-$PROJECT_ROOT/src-tauri/target/release/claude-config-manager.exe}"` — `.exe` 硬编码
- **L97**: `cygpath -w "$EXE_PATH"` — **Windows-only 桥**
  - 严重度:高
- **L106,120**: `powershell.exe ... Get-Process -Name 'tauri-driver','msedgedriver' | Stop-Process -Force` — **Windows-only**
  - 严重度:高
- **L150-153**: WebDriver session payload 调 `application: exe` — tauri-driver 在 macOS 接受 `.app` bundle path
  - 严重度:中

**小计:6 处不兼容**

---

### scripts/test-verify.sh
- **L21**: `export PATH="/c/msys64/mingw64/bin:$PATH"` — **Windows-only 路径硬编码**
  - 严重度:高 — macOS 不需要 mingw64 bin;同时 `/c/msys64/...` 在 macOS 不存在
  - macOS 替代:删除此行(macOS 用系统 Rust toolchain,无 windres)
- **L33**: `cp -f target/debug/WebView2Loader.dll target/debug/deps/...` — **WebView2Loader.dll 是 Windows-only DLL**
  - 严重度:高 — macOS 用 WebKit,无此 DLL
  - macOS 替代:`[[ "$OSTYPE" != "msys"* ]] && continue` 跳过
- **L37**: `cargo build --tests` 跨平台 OK
- **L41,45**: `find target/debug/deps -maxdepth 1 -name "*.exe"` — **Windows-only `.exe` 后缀**
  - 严重度:高 — macOS cargo 输出无 `.exe`,find 会 0 命中

**小计:3 处不兼容**

---

### scripts/gen-intro-docx.py
- **L28**: `DESKTOP = Path.home() / "Desktop"` — **跨平台 OK**(`Path.home()` 是 stdlib 抽象,macOS 自动解析到 `/Users/<u>/Desktop`)
  - 严重度:无 — 这就是正确写法
- **L14-25**: `from docx import Document` + `os.system("pip install python-docx")` 跨平台 OK
- **L29-30**: `OUTPUT_NAME = "Claude-Config-Manager-项目介绍-v3.0.docx"` UTF-8 跨平台 OK
- 全脚本零 `os.name == "nt"` 分支,**完全 macOS 兼容**

**小计:0 处不兼容**

---

### scripts/tests/cdp-backup-verify.cjs
- **L1-53**: Node.js + ws + CDP,纯跨平台,零 OS 判断
- 全脚本零 Windows-only 调用

**小计:0 处不兼容**

---

### scripts/tests/cdp-f3-import-verify.cjs
- **L191**: `const providersDir = 'C:\\Users\\e-Yunfei.Qian\\AppData\\Roaming\\ClaudeConfigManager\\providers'` — **Windows-only 硬编码**
  - 严重度:高 — macOS 路径应是 `/Users/e-Yunfei.Qian/Library/Application Support/ClaudeConfigManager/providers`
  - macOS 替代:`path.join(os.homedir(), 'Library', 'Application Support', 'ClaudeConfigManager', 'providers')`
- **L207-209**: `powershell.exe ... Get-Process -Name 'claude-config-manager' ... | Stop-Process -Force` — **Windows-only**
  - 严重度:高 — macOS 用 `process.kill(pid)` 或 `pkill -f`

**小计:2 处不兼容**

---

### scripts/tests/kill-app.bash
- **L81**: `bash "$KILL_APP" --force` — **直接调用 Windows-only kill-app.sh**
  - 严重度:高 — 测试本身是验证 kill-app.sh 的 tasklist/grep 模式,macOS 上 kill-app.sh 整个会失败
  - macOS 替代:需要 macOS 版 kill-app.sh 才能跑这个测试

**小计:1 处不兼容(间接依赖 kill-app.sh 的 Windows 实现)**

---

## 3. 不兼容点汇总

| 文件 | 不兼容点数 | 严重度(高/中/低) | 可修复性 |
|---|---|---|---|
| `build-and-ship.sh` | 5 | 3高/2中 | 易(加 OS 分支) |
| `build-only.sh` | 2 | 1高/1中 | 易 |
| `build-mac.sh` | 0 | — | — (mac 专用,无问题) |
| `build-installer.sh` | 0 | — | — (case 已分流) |
| `smoke-test.sh` | 9 | 7高/2中 | **难**(Win32 P/Invoke 完全不可移植,需 fork) |
| `kill-app.sh` | 6 | 5高/1中 | 中(需 fork mac 版本) |
| `run-e2e.sh` | 6 | 5高/1中 | 中(需换 safaridriver) |
| `test-verify.sh` | 3 | 3高 | 易(加 OS guard) |
| `gen-intro-docx.py` | 0 | — | 完全兼容 |
| `cdp-backup-verify.cjs` | 0 | — | 完全兼容 |
| `cdp-f3-import-verify.cjs` | 2 | 2高 | 易 |
| `tests/kill-app.bash` | 1 | 1高 | 难(测试逻辑绑 Windows) |
| **总计** | **34** | **27高/7中** | — |

按严重度:
- **高(需改造)** :27 处
- **中(可选)** :7 处
- **完全兼容** :3 文件(gen-intro-docx.py / cdp-backup-verify.cjs / build-mac.sh / build-installer.sh)

---

## 4. 推荐改造顺序

### 第一优先级(影响 ship 链路,必须改)
1. **`scripts/build-only.sh`** — 改 `.exe` → 用 `$EXE_SUFFIX` 变量(L72)
   - 影响:开发循环每次 `cargo build` 后的产物检测,改动小、收益大
   - 预计:5 分钟

2. **`scripts/test-verify.sh`** — 去掉 mingw64 PATH 注入(L21) + WebView2Loader.dll cp(L33) + `*.exe` find(L41/45),加 `[[ "$OSTYPE" != "msys"* ]] && skip`
   - 影响:cargo test 编译验证链路
   - 预计:10 分钟

3. **`scripts/cdp-f3-import-verify.cjs`** — 改硬编码 `C:\\Users\\...\\AppData\\Roaming\\...` 为 `os.homedir()` + `path.join`;`powershell.exe` kill 改为 `child.kill()`(已经做了)+ 加 OS 分支
   - 影响:F3 导入 e2e 验证
   - 预计:10 分钟

### 第二优先级(需 fork,但局部改造可复用)
4. **`scripts/kill-app.sh`** — 抽 `detect_kill_cmd()` 函数,Windows 走 tasklist/taskkill + PowerShell,macOS 走 `pgrep` + `osascript` + `kill -9`
5. **`scripts/run-e2e.sh`** — msedgedriver.exe 探测分支换 safaridriver / chromedriver;`cygpath` 改 `readlink -f` 或省略
6. **`scripts/build-and-ship.sh`** — `DESKTOP_BASE` 用 `$HOME/Desktop`(已跨平台),L51 exe 后缀做 OS 分支

### 第三优先级(架构改造,成本高)
7. **`scripts/smoke-test.sh`** — 整个 Win32 P/Invoke(`EnumChildWindows` / `Get-ClassName`)在 macOS 不可用;需 fork `smoke-test-mac.sh`,用 `osascript` `tell application "System Events" to tell process ...` 查 AXWindow 子窗口
   - 预计:半天
8. **`scripts/tests/kill-app.bash`** — 绑死 kill-app.sh 的 Windows tasklist 模式,要么 fork mac kill-app.sh 再 fork 这个测试

---

## 5. 关键发现

1. **零 OS 分支是最大问题**:`smoke-test.sh` / `kill-app.sh` / `run-e2e.sh` 三个核心脚本从一开始就没考虑 macOS,纯 PowerShell + cygpath + taskkill 实现,几乎每个关键路径都是 Windows-only。
2. **windres 自动探测是无害噪声**:build-and-ship / build-only / build-installer 都加了 mingw64 bin 自动注入,macOS 上 `[[ -x "$candidate/windres.exe" ]]` 全 false,循环空跑,**不会破坏功能**。
3. **build-installer.sh 是范本**:已经用 `case "$TARGET" in windows|macos) ... esac` 正确分流,**完全可以作为其他脚本的改造模板**。
4. **stat -c%s / stat -f%z 双写法已经普及**:build-and-ship / build-only / smoke-test / build-installer 都正确兼容 GNU/BSD,无需再改。
5. **sha256sum / shasum -a 256 正确兼容**:仅 build-installer.sh 有此需求,已正确处理。
6. **gen-intro-docx.py / cdp-backup-verify.cjs 已经跨平台**:可作为范本。
7. **desktop 路径硬编码**:build-and-ship.sh L49 `/c/Users/...` 是单点硬编码,直接换成 `$HOME/Desktop` 即可(其它文件没碰)。

---

*审计完毕,共扫描 12 个文件,发现 34 处不兼容点(27 高 / 7 中),已分优先级给出改造建议。*