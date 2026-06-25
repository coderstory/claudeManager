# v4.0 端到端用户行为测试 — PLAN

> **Milestone**: v4.0 (2026-06-25 启动)
> **Phase**: planning
> **Status**: 待用户拍板进 Phase 1
> **Owner**: 主 session
> **Spec ref**: `SPEC.md` §3 (F1-F24 清单)

---

## 1. 为什么这样设计 (§2.5)

### 1.1 问题陈述
当前 test-all 5 阶段覆盖到 vitest 单元测试 + cargo build --tests + smoke test 10 项,**没有任何一阶段模拟真实用户操作**:
- **vitest 单元测试** (500/500) — 测 React 组件 render,不能验 IPC 副作用(settings.json 是否真被改)
- **cargo build --tests** — 编译过,从来没跑(CLAUDE.md §13.1 注释原因,WebView2Loader.dll 撞 STATUS_ENTRYPOINT_NOT_FOUND)
- **smoke test 10/10** — 验"窗口能开/资产嵌入了/数据库能查",**不验"切换 provider 后 settings.json 是否真改了"**

**真实 bug 风险**:smoke test 10/10 PASS 的 .app,如果切换 provider 没真改 `~/.claude/settings.json`,**用户看不到 CLAUDE.md §1 核心价值(1 秒切换)**。

### 1.2 已有 e2e 框架(为什么不够)
`tests/e2e/` 有 10 个 spec 文件,跑 Playwright + tauri-driver + WebDriverIO。但:
- **macOS 上 tauri-driver 不支持**(本会话诊断)→ macOS dev box 上 e2e 永远 WARN
- **走 vite dev server mock**(`PLAYWRIGHT_BASE_URL`)→ 验 DOM 但**不验真 .app + 真文件系统副作用**
- **覆盖范围**: tray/关闭/主题/UI 布局/模糊搜索/资源浏览/备份恢复 → **没碰 F1-F7 核心业务流**(列 provider/切换/拖放/JSON 编辑/MCP toggle/用量)

### 1.3 v4.0 设计目标
**black-box 端到端**:
1. 启动**真 .app**(release build,装到 /Applications/)
2. 用 **OS-level 驱动** 模拟用户操作(AppleScript + System Events on macOS,UI Automation on Windows)
3. 验**真文件系统副作用**(`~/.claude/settings.json` 字段级 diff + `~/.claude/settings.json.bak.<ts>` 出现)
4. **不依赖 tauri-driver / Playwright WebView** → macOS dev box 立即可用

### 1.4 关键决策(Q1-Q4 用户拍板)

| Q | 决策 | 理由 |
|---|---|---|
| Q1 场景范围 | 14 场景全收 | 跟 SPEC.md F1-F24 高频+高风险对齐 + 4 跨 F 业务流 |
| Q2 macOS 路径 | AppleScript + 真 .app | macOS 不走 webview,直接 System Events 发键鼠 + 读 settings.json |
| Q3 ship gate | 14 hard-fail | 跟 smoke test 10 项同级严格度,v4.0 ship 必须 14/14 PASS |
| Q4 计划阶段 | 主 session 写 v4-PLAN.md | 刚刚废弃 worktree workflow,subagent 写不可靠;主 session 写 = 可审计 |

---

## 2. 架构

### 2.1 三层
```
tests/v4-e2e/
├── lib/
│   ├── driver-mac.sh        # macOS: osascript + System Events + pgrep
│   ├── driver-win.ps1       # Windows: UI Automation PowerShell module
│   ├── driver-linux.sh      # 预留 (CLAUDE.md §15: Linux 不支持)
│   ├── fs-fixtures.sh       # 准备/恢复 ~/.claude/ 测试环境
│   └── shell.sh             # 通用 helper (assert_equal / assert_file_exists / cleanup)
├── scenarios/               # 14 个 spec,每个一个 .sh 脚本
│   ├── 01-launch-tray.sh
│   ├── 02-list-providers.sh
│   ├── 03-switch-provider.sh
│   ├── 04-switch-stack.sh
│   ├── 05-drag-drop-sql.sh
│   ├── 06-deeplink-import.sh
│   ├── 07-json-editor.sh
│   ├── 08-mcp-toggle.sh
│   ├── 09-usage-card.sh
│   ├── 10-backup-rollback.sh
│   ├── 11-theme-switch.sh
│   ├── 12-shortcut-search.sh
│   ├── 13-error-feedback.sh
│   └── 14-resource-browser.sh
├── fixtures/                # 测试用 settings.json / .sql / deeplink 样本
│   ├── 3-providers.json
│   ├── cc-switch-sample.sql
│   └── deeplink-ccswitch.txt
└── run-all.sh               # 14 场景串行跑,生成 report
```

### 2.2 数据流

```
                    ┌──────────────┐
                    │ 真实 .app     │ ← release build
                    │ /Applications│   (CLAUDE.md §15.2 装到这)
                    └──────┬───────┘
                           │ 启动
                           ▼
                    ┌──────────────┐
                    │ driver-*.sh  │ ← OS-level 模拟用户
                    │ AppleScript  │   (keystroke / click)
                    │ + pgrep      │   (验进程存活)
                    └──────┬───────┘
                           │ 操作 + 验证
                           ▼
                    ┌──────────────┐
                    │ ~/.claude/   │ ← 副作用
                    │ settings.json│
                    │ *.bak.<ts>   │
                    └──────┬───────┘
                           │ 读 + diff
                           ▼
                    ┌──────────────┐
                    │ assert_*     │ ← 真文件级断言
                    │ settings.json│
                    │ env.ANTHROPIC│
                    │ _BASE_URL 改?│
                    └──────────────┘
```

### 2.3 OS 抽象接口

| Trait | macOS | Windows |
|---|---|---|
| 启动 app | `open /Applications/ClaudeManager.app` | `Start-Process .\app.exe` |
| 关闭 app(走 tray) | `osascript 'System Events' 'keystroke "w"'` | UI Automation 找 Close 按钮 |
| 强 kill | `pkill -9 -f "ClaudeManager.app/Contents/MacOS/claude-config-manager"` | `taskkill -F -IM claude-config-manager.exe` |
| 焦点到 app | `osascript 'tell application "ClaudeManager" to activate'` | `[System.Windows.Forms.SendKeys]::SendWait("")` |
| 模拟键入 | `osascript 'System Events' 'keystroke "text"'` | `SendKeys.SendWait("text")` |
| 模拟点击 | `osascript 'System Events' 'click at {x, y}'` | `Mouse.Click(x, y)` |
| 验进程存活 | `pgrep -f "ClaudeManager.app/..."` | `Get-Process -Name claude-config-manager` |
| 读 settings.json | `cat ~/.claude/settings.json` (jq) | 同 |
| 验备份生成 | `ls ~/.claude/settings.json.bak.* | wc -l` | 同 |

### 2.4 fixture 隔离
- **不**用真实 `~/.claude/settings.json`(污染)
- **用** `tests/v4-e2e/fixtures/3-providers.json` → 测试启动前 `cp` 到 `~/.claude/settings.json` + 备份原文件
- 测试结束 `mv` 备份回来 + `kill-app.sh --force`

---

## 3. 接口 — 14 场景 spec 签名

### 3.1 通用约定
- 每个 spec = 一个 `.sh` 脚本,exit 0 = PASS,exit ≠0 = FAIL
- 入口:`./tests/v4-e2e/scenarios/NN-name.sh`
- 输出格式:`[PASS] 03_switch_provider: env.ANTHROPIC_BASE_URL 改从 X 到 Y, 备份 +1`
- 串行跑(CLAUDE.md §10: 不要并行 tauri / e2e)

### 3.2 14 场景清单

| # | 场景 | 测的功能 | 关键断言 |
|---|---|---|---|
| 01 | 启动 + tray | F1 + 系统集成 | pgrep 找到进程,osascript 看到 1 窗口,关闭后 pgrep 仍找到(tray) |
| 02 | 列出 provider | F1 | jq '.providers | length' = 3,active provider 高亮(osascript 拿 AXValue) |
| 03 | 切换 A→B | F2 核心 | settings.json 的 `env.ANTHROPIC_BASE_URL` 从 A.url 改到 B.url + 新备份 +1 |
| 04 | 切换栈(A→B→A→C) | F2 + F13 | 备份栈 = 3 个,无丢失,A 切回时 settings.json 回到 A.url |
| 05 | 拖 .sql 入窗口 | F3 + F10 | 跳转导入页 + jq 解析出 3 provider + 确认后 settings.json 多 3 条 |
| 06 | 粘贴 deeplink | F4 | `ccswitch://v1/import?id=test` 解析 + 入库 + active 更新 |
| 07 | JSON 编辑器 validate | F5 + F15 | 改 baseUrl 故意破坏 → 红条出现(F15) → 修正 → 绿条 + 保存 |
| 08 | MCP toggle | F6 | `~/.claude.json` 的 `mcpServers.<id>.enabled` 翻转 + 备份 +1 |
| 09 | 用量卡片 | F7 | DOM 包含"5h" / "1w" / "1m" 三个数字段(等 provider 真实响应,可能 mock) |
| 10 | 备份回滚 | F13/F19 | 备份列表显示 v1-v3 + 选 v2 + diff 显示 + 回滚后 settings.json = v2 内容 |
| 11 | 主题切换 | F12 | system → light → dark,每步 osascript 拿窗口背景色 hex,断言不同 |
| 12 | 快捷键 Ctrl+F | F11 | Cmd+Ctrl+F 触发 → 搜索栏 focus 状态(AXFocused=true) + 输入 "Deep" 过滤 |
| 13 | 错误反馈 | F15 | 删 active provider → 红条出现 + 文案 = §15.5 错误提示模板 |
| 14 | 资源浏览 | F16 + F17 | 启 1 plugin + 1 skill → settings.json `enabled` 字段多 2 条 |

### 3.3 spec 骨架示例(03 切换 provider)

```bash
#!/usr/bin/env bash
# scenarios/03-switch-provider.sh
# Validates: F2 切换 provider 核心场景
# Asserts: settings.json env.ANTHROPIC_BASE_URL 从 A.url 改到 B.url, 备份 +1

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/../lib/driver-mac.sh"      # 加载 driver helpers
source "$SCRIPT_DIR/../lib/fs-fixtures.sh"      # 加载 fixture 准备
source "$SCRIPT_DIR/../lib/shell.sh"            # 加载 assert helpers

trap cleanup EXIT

# 1. 准备 fixture
prepare_fixture "$SCRIPT_DIR/../fixtures/3-providers.json"
#   → cp fixtures/3-providers.json → ~/.claude/settings.json
#   → 备份原文件 → ~/.claude/.test-backup

# 2. 启动 app
launch_app
#   → open /Applications/ClaudeManager.app
#   → sleep 3
#   → assert: pgrep finds 1 process

# 3. 模拟用户操作
activate_app
click_button "provider-B-card"            # System Events click at 中心
sleep 1

# 4. 验证副作用
assert_file_modified "$HOME/.claude/settings.json"
NEW_URL=$(jq -r '.env.ANTHROPIC_BASE_URL' "$HOME/.claude/settings.json")
assert_equal "$NEW_URL" "https://api.provider-b.com"

BAK_COUNT=$(ls "$HOME/.claude/settings.json.bak."* 2>/dev/null | wc -l | tr -d ' ')
[[ "$BAK_COUNT" -ge 1 ]] || { echo "FAIL: no backup created"; exit 1; }

echo "[PASS] 03_switch_provider: env.ANTHROPIC_BASE_URL 改到 B, 备份 +1"
exit 0
```

### 3.4 14 场景依赖关系

```
01 (启动+tray)
  ↓
02 (列 provider)  ← 01
  ↓
03 (切换)         ← 02
  ↓
04 (切换栈)       ← 03
  ↓
05 (拖放 .sql)    ← 02
  ↓
06 (deeplink)     ← 02
  ↓
07 (JSON 编辑)    ← 02
  ↓
08 (MCP toggle)   ← 01
  ↓
09 (用量)         ← 01
  ↓
10 (备份回滚)     ← 03 (要先有切换才有备份)
  ↓
11 (主题)         ← 01
  ↓
12 (快捷键)       ← 02
  ↓
13 (错误条)       ← 02
  ↓
14 (资源浏览)     ← 01
```

**串行依赖**,不能并行(同 .app 进程,单实例)。

---

## 4. 任务拆分(Phase 1 → Phase 4)

按 §2.2 "不要超过 1 小时不 commit" + 任务依赖,分 4 phase:

### Phase 1: 基础设施(估 1-2 天)
- `tests/v4-e2e/lib/driver-mac.sh` (osascript + System Events wrappers)
- `tests/v4-e2e/lib/driver-win.ps1` (UI Automation helpers)
- `tests/v4-e2e/lib/fs-fixtures.sh` (prepare/restore)
- `tests/v4-e2e/lib/shell.sh` (assert_*)
- `tests/v4-e2e/fixtures/3-providers.json` (3 个 provider 样本)
- `tests/v4-e2e/fixtures/cc-switch-sample.sql` (F3 测试用)
- `tests/v4-e2e/run-all.sh` (串行调度)
- **验证标准**: 1 个 stub spec 跑通(exit 0)

### Phase 2: 核心 4 场景(估 1-2 天)
- 01 启动+tray
- 02 列 provider
- 03 切换(最关键,核心价值)
- 04 切换栈
- **验证标准**: 4/4 PASS

### Phase 3: 业务流 6 场景(估 2-3 天)
- 05 拖放 .sql
- 06 deeplink
- 07 JSON 编辑
- 08 MCP toggle
- 10 备份回滚
- 13 错误条
- **验证标准**: 6/6 PASS

### Phase 4: 体验 4 场景(估 1-2 天)
- 09 用量
- 11 主题
- 12 快捷键
- 14 资源浏览
- **验证标准**: 4/4 PASS,整合 `test-all.sh` 加 `v4-e2e` stage(14 hard-fail,Q3-A)

### Phase 5: Windows 对称 + CI
- 在 Windows dev box 跑同样 14 spec
- 加 `.github/workflows/v4-e2e.yml` matrix (macos-arm64 + windows-11)
- **验证标准**: CI 全过

---

## 5. ship gate(Q3-A 集成位置)

修改 `scripts/test-all.sh`,在 stage 5 (smoke) 之后加 stage 6 (v4-e2e):

```bash
# === Stage 6: v4.0 端到端(14 hard-fail per CLAUDE.md v4.0) ===
if [[ -x "$SCRIPT_DIR/v4-e2e/run-all.sh" ]]; then
  run_stage "v4-e2e" "v4.0 端到端 14 场景 (AppleScript/UI Automation)" \
    "$SCRIPT_DIR/v4-e2e/run-all.sh" \
    || true
else
  say_info "[v4-e2e] SKIP (v4.0 not yet built)"
  stage_set "$(stage_index v4-e2e)" "$WARN" "v4.0 not implemented"
fi
```

**14 hard-fail**:任一场景 FAIL → test-all exit 1(Q3-A)

**dev box skip**:`./scripts/test-all.sh --skip-v4-e2e` 跳过(日常 dev loop 不跑 14 spec,大概 5-10 分钟/轮)

---

## 6. 风险 + 缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| AppleScript 拿 AXValue 不稳定(macOS 14+ 加了 accessibility permission) | 02/07/13 失败 | macOS dev box 上跑一次 `osascript -e 'tell application "System Events" to get ...'`,如果失败提示用户在 系统设置 → 隐私 → 辅助功能 允许 Terminal/iTerm |
| 真 .app 启动慢(~2-3s 冷启动) | 14 spec 总耗时翻倍 | 14 spec 复用 1 个长跑 .app(启动一次,关 14 次),省 14 * 3s = 42s |
| 用户 settings.json 状态被测试污染 | 真实数据丢失 | `fs-fixtures.sh` 必须先备份 `~/.claude/.test-backup` 再覆盖,trap EXIT 还原 |
| UI Automation 在 Windows headless CI 跑不起来 | CI 红 | macOS 用 osascript,Windows 用 UI Automation 都需要有 display 接入,CI runner 必须是有头(macos-latest / windows-11 runner) |
| tauri-driver 装过但 v4.0 完全不用,白装 | 浪费 ~5min | 不修,v4.0 不需要;未来 M5 修 e2e 还能用 |

---

## 7. 不做(v4.0 scope 排除)

- ❌ **修 tauri-driver macOS 支持** — 上游限制,M5 工作
- ❌ **Linux 支持** — CLAUDE.md §15 不支持
- ❌ **性能基准测试** — 不是 v4.0 scope,M5 单独 phase
- ❌ **可视化回归测试**(pixel diff)— 需要 Screenshot test 框架,量级超过 14 场景,M5+
- ❌ **F18 优化建议 / F23 优化导出** — v4.0 不覆盖(SPEC §3.5 范围大)
- ❌ **F8 单文件部署 / F20 单实例+文件关联** — 已是 ship-time 验证(Windows MSI/NSIS),e2e 不重做

---

## 8. 验证 / 成功标准

### Phase 1 完成标志
- [ ] `tests/v4-e2e/run-all.sh --scenario=stub` 跑通(exit 0)
- [ ] 14 spec 模板占位文件存在
- [ ] 1 fixture 文件就位

### Phase 4 完成标志 (= v4.0 完成)
- [ ] `test-all.sh` 加 v4-e2e stage,dev box 上 14/14 PASS
- [ ] CI workflow 在 macos-latest + windows-latest 都过
- [ ] 写进 STATE.md "v4.0 完成" 段
- [ ] tag v4.0

### 不在 v4.0 scope(M5+)
- M5.1: 修 tauri-driver macOS 支持
- M5.2: 性能基准 (启动时间 / 切换延迟 / 内存峰值)
- M5.3: 可视化回归 (pixel diff)
- M5.4: F8/F18/F23/F20 e2e 覆盖

---

## 9. 开放问题(等用户拍板进 Phase 1)

| # | 问题 |
|---|---|
| A | **macOS 14+ accessibility permission** 怎么处理?(用户得在系统设置里允许 Terminal/iTerm/osascript)— 文档化 vs 自动化引导 |
| B | **14 spec 串行总时长估 5-10 分钟** — 是否接受,还是 spec 之间复用 1 个长跑 .app 进程(复杂度 ↑ 速度 ↑) |
| C | **v4.0 spec 默认 macOS-first**(AppleScript),Windows 移植延后到 Phase 5 — 确认?还是同时出双平台? |
| D | **fixture 隔离** — `~/.claude/settings.json` 覆盖风险高,要不要用 `XDG_CONFIG_HOME` 强制重定向(更安全,改动小) |
| E | **历史 e2e(`tests/e2e/`)是否废弃** — v4.0 写完后,playwright 路径已无 macOS 支持,旧 spec 还能在 Windows 跑但维护成本高,建议归档 |

**等用户在 Phase 1 开始前回答 A-E**。

---

*Refs: CLAUDE.md §2.1 架构先行 + §2.5 为什么这样设计 + §6 review discipline + §10 不要 + §15 macOS + §13.1 smoke test 10 项.  F1-F24 来自 SPEC.md §3.*
