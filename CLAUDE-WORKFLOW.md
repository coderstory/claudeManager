# 工程流程纪律

> 本文件是 CLAUDE.md §9/§11/§14 的独立版本. 迭代交付 / 主 session 工作流 / Subagent 行为禁区.
> 其他章节见 [CLAUDE.md](../CLAUDE.md).

## 9. 迭代交付纪律（每次迭代必做）

### 9.1 交付物
每次迭代（M1.1 / M1.2 / ... / M2.1 / ...）完成时，**必须生成一个 exe 放到桌面**等待用户核定。

### 9.2 命名规则 (跨平台)
| 平台 | exe 名 | Desktop 目录 | 备注 |
|---|---|---|---|
| Windows | `ClaudeConfigManager-M{major}.{minor}-{slug}.exe` | `~/Desktop/ClaudeConfigManager-M{major}/` | 当前实际 |
| macOS | `ClaudeConfigManager-M{major}.{minor}-{slug}.app` | `~/Desktop/ClaudeConfigManager-M{major}/` | .app 是 bundle 目录 |

**`{major}` = M1/M2/M3/M4**；**`{minor}` = 1.1/1.2/.../3.0.3**；**`{slug}` = kebab-case 短描述**（如 `scaffold` / `platform-abstractions` / `ui-text-cleanup`）。

### 9.3 Build 类型
- **M1.x（架构期）**：Dev build（快，5-10 分钟），含调试信息
- **M2.x 及以后**：Dev build（功能迭代期）+ 里程碑结束额外做 1 次 Release build（验证打包链路）

### 9.4 Smoke Test (跨平台)
**当前实跑 10 项**（见 `scripts/smoke-test.sh`，M1.3 时代从 4 项扩到 10 项覆盖 build regression classes）。

**Windows**（当前实跑命令）：
1. ✅ 启动 exe → 进程在 5 秒内运行
2. ✅ 检测到主窗口（`Get-Process` + `MainWindowHandle` + `Responding`）
3. ✅ 检测到 WebView2 子窗口（`EnumChildWindows` + `Chrome_WidgetWin_*` 类名匹配 → 证明前端 bundle 真的加载）
4. ✅ 窗口标题 = tauri.conf.json 中的 productName
5. ✅ dist fingerprint (`index-*.js`) 嵌入到 exe PE 资源（`strings` 命令）
6. ✅ history.db 在 `%APPDATA%\ClaudeConfigManager\` 创建且非空
7. ✅ history.db schema 含 `usage_history` + `backup_history` + `schema_version` 3 个对象
8. ✅ history.db 可查询（usage_history 或 backup_history 至少 1 行 OR 0 行但 schema 有效）
9. ✅ 关闭窗口 → 进程仍在（最小化到托盘）
10. ✅ 强制 kill → 2 秒内进程消失

**macOS**（M4 阶段补，目前仅 §13 "build regression classes" 提及）：
- 第 1-2 项：`pgrep -f ClaudeConfigManager` + `osascript` 查 NSWindow 存在性
- 第 3 项：WKWebView 子窗口枚举（无 CLI 等价；需 Rust IPC 加 `get_webview_children_count` 命令，参考 audit-rust.md）
- 第 4-8 项：相同概念（标题 / dist / db / schema / queryable — 路径改为 `~/Library/Application Support/ClaudeConfigManager/`）
- 第 9-10 项：`osascript quit` + `kill -9`

**禁止 subagent 跳过 smoke test 直接 cp exe 到桌面**（违反 §9.4）。

### 9.5 用户核定
- cp 到桌面后，**等待用户明确"完成"或"未完成：<原因>"**
- 未经核定不能进下一个迭代
- 核定记录写入 `STATE.md`（迭代号 / 日期 / 用户反馈 / 下一步）

### 9.6 实现位置 (跨平台)
**统一脚本**（在 `scripts/` 目录）：

| 脚本 | Windows | macOS | 职责 |
|---|---|---|---|
| `scripts/build-only.sh` | ✅ | ⚠️ 部分 | 仅编译（debug/release/check/clean）|
| `scripts/smoke-test.sh` | ✅ 10/10 | ❌ M4 改造 | 单独 smoke test |
| `scripts/kill-app.sh` | ✅ | ❌ M4 改造 | 关闭进程（优雅或 force）|
| `scripts/build-and-ship.sh` | ✅ | ⚠️ 部分 | 完整 build + smoke + cp 到桌面 |
| `scripts/disk-usage-check.sh` | ✅ | ✅ | target/ 磁盘监控 |

- **build-and-ship.sh 接收参数**：`--milestone M1 --task 1.1 --slug scaffold`
- **build-and-ship.sh 职责**：build → copy exe + WebView2Loader.dll → smoke test → 输出报告
- **WebView2Loader.dll 必须跟 exe 一同 cp**（仅 Windows）：Tauri debug build 不会自动放置，bundler 才处理
- **scripts 互相依赖**（见 §9.7.2 ASCII 图）：
  - `build-and-ship.sh` → `smoke-test.sh`（内部调做 ship 前验证）
  - `smoke-test.sh` → `kill-app.sh`（内部调做 pre-cleanup）
  - `build-only.sh` 和 `kill-app.sh` 是独立工具，可单独调
- **当前 scripts/ macOS 兼容度**：见 `tmp/audit-scripts.md`（34 处不兼容点，高 27 / 中 7）
- **完整使用决策树 + 速查表**：见 §9.7.1 / §9.7.2；详细 pitfalls 见 `tmp/scripts-usage-guides.md`（审阅后决定是否合入 CLAUDE.md）

### 9.7 脚本使用流程 (跨平台)

#### 9.7.1 决策树（什么场景用什么脚本）
| 场景 | 用哪个 | 命令 |
|---|---|---|
| **迭代完成，准备 ship 给用户核定** | `build-and-ship.sh` | `./scripts/build-and-ship.sh --milestone M3 --task 0.3 --slug ui-text-cleanup` |
| **dev 循环内只改 Rust，想验证编译通过** | `build-only.sh` | `./scripts/build-only.sh` (默认 release; --check 更快; --clean 全量重建) |
| **改了 src/ 前端** | `npm run build`（不走 build-only） | `npm run build` — build-only 不跑 beforeBuildCommand |
| **想看 vite HMR 实时预览** | `npm run tauri dev` | dev server + dev build；**不 ship** |
| **已 ship 后想复跑 smoke test** | `smoke-test.sh <exe>` | `./scripts/smoke-test.sh src-tauri/target/release/claude-config-manager.exe` |
| **dev 中残留进程卡死 / smoke 前清理** | `kill-app.sh` | `./scripts/kill-app.sh` (优雅 + force fallback) |
| **进程僵死无法优雅关** | `kill-app.sh --force` | `./scripts/kill-app.sh --force` |

#### 9.7.2 4 脚本依赖关系
```
                  ┌──────────────────────────────┐
                  │  build-and-ship.sh           │   一键 ship 入口 (§9.5 唯一允许)
                  │  (build + cp + smoke)        │
                  └──────────────┬───────────────┘
                                 │ 内部调
                  ┌──────────────┴──────────────┐
                  ▼                             ▼
      ┌──────────────────────┐      ┌──────────────────────┐
      │  build-only.sh       │      │  smoke-test.sh       │
      │  (仅 cargo build)    │      │  (10 项验证)          │
      └──────────────────────┘      └───────────┬──────────┘
                                                │ 内部调
                                                ▼
                                     ┌──────────────────────┐
                                     │  kill-app.sh         │
                                     │  (pre-cleanup)       │
                                     └──────────────────────┘
```

#### 9.7.3 速查表（3 个最常见 flow）

```bash
# Flow 1: dev 循环 (只改 Rust)
./scripts/kill-app.sh
./scripts/build-only.sh
./scripts/smoke-test.sh src-tauri/target/release/claude-config-manager.exe

# Flow 2: 改前端 (src/ 下任何文件)
npm run build                           # 必须! build-only 不跑 beforeBuildCommand
./scripts/kill-app.sh
./scripts/build-and-ship.sh --milestone M3 --task 0.3 --slug my-feature

# Flow 3: 迭代 ship 给用户核定
./scripts/build-and-ship.sh --milestone M2 --task 2.3 --slug provider-list
# 内部全流程: kill residue → tauri build --no-bundle → cp exe + WebView2Loader.dll → smoke 10 项
# smoke PASS → 输出 "SHIPPED ✓" + 桌面路径
# smoke FAIL → 自动 rm 桌面 exe, exit 1 (不回桌面)
# 等用户回 "完成" 或 "未完成: <原因>" (§11.7 不核定不派下一个 ship 类 subagent)
```

#### 9.7.4 平台注意
- **macOS subagent 当前限制**（M4 前）：smoke-test / kill-app / build-and-ship 仅 Windows 部分能用；mac subagent 可用 `build-only.sh --check` + `disk-usage-check.sh` + `npm run tauri dev`
- 详细 pitfalls 与各脚本"何时不用"清单见 `tmp/scripts-usage-guides.md`（180 行），本次未合入 CLAUDE.md（按 preference `doc-focused-not-comprehensive`）

## 11. 主 session 工作流约束

### 11.1 角色分工
- **主 session**：只做决策 + 任务分配 + 接收 subagent 成果
- **Subagent**：执行具体开发任务（编译 / 安装依赖 / 写代码 / 跑命令 / 改文件）

### 11.2 并发上限
- **最多同时开 4 个 subagent**
- 超过 4 个时主 session 必须等其中一个完成再派新的

### 11.3 增量派单（流式）
- 不要等所有 subagent 全部完成才重新分配
- **每收到一个 subagent 完成通知**，立即评估：
  1. 该 subagent 的产出是否成功？
  2. 有没有阻塞下游任务？
  3. 能否派下一个 subagent？
- 如果 subagent 失败 → 决定是修复重派 / 换方案 / 跳过
- 流式派单的目标：**最大化 4 槽利用率，减少主 session 空等时间**

### 11.4 派单前检查
每次派 subagent 前，主 session 评估：
- [ ] 任务边界清晰（不是模糊的"做这个功能"）
- [ ] subagent 类型匹配（general-purpose / Explore / gsd-* 等）
- [ ] 上下文已塞进 prompt（不依赖主 session 私有信息）
- [ ] 不违反本 CLAUDE.md 的任何规则

#### 11.4.1 临时命令合并为脚本 (M3.0.3 lesson)
**规则**：subagent（或主 session）执行 ≥ 3 个**相关联的临时命令**时（如 `sccache --show-stats` + `cargo check` + `grep cfg(windows)`），必须评估是否合并成一个可复用脚本，写入 `scripts/` 目录。

**判断标准**：
- ✅ **合并场景**：命令序列有明确目的（如"诊断 sccache 是否坏"），下次还可能用上
- ❌ **不合并场景**：命令彼此无关 + 一次性探索 + 命令输出仅当前 session 看

**反事故**：
- 本会话派了 3 个 subagent 跑 sccache 诊断（`a374807b29f187ddd` → `acc194445e850f73a` → `a779884d3191cf32d`），每个都跑 `sccache --show-stats` + `cargo check 2>&1 | tail -30`。**正确做法**：第 1 次跑时就该写 `scripts/sccache-diag.sh`，把 `sccache --show-stats` + `cargo check` + 错误分类逻辑固化
- 临时命令 3 次重复 = 必须脚本化（§11.7 三次失败规则的镜像应用：3 次重复 ≠ 1 次性）

**合并步骤**：
1. 收集命令序列 + 输出格式
2. 抽函数（参数化路径 / crate 名 / 输出格式）
3. 写入 `scripts/<purpose>-<target>.sh`（如 `scripts/sccache-diag.sh`）
4. `chmod +x` + `bash -n` 验证
5. 加到 §9.6 实现位置表（如果项目级）
6. 下次同类任务调脚本，不重复 inline

**例外**：纯一次性 ad-hoc 排查（如"先 ls 看看这个文件在不在"）不需要脚本化。

### 11.5 派单后行为
派完 subagent 后：
- 主 session **不要亲自执行任何 shell / file 操作**
- 等 subagent 完成（可能数分钟，silence is normal）
- 收到完成通知后立即分析 + 决定下一步

#### 11.5.1 macOS 开发 subagent 的额外约束（M4 阶段）
- ❌ **mac subagent 不能跑** `scripts/{kill-app,smoke-test,build-and-ship}.sh` 当前版本（含 powershell 调用）— 必须先 audit-scripts 改造
- ✅ mac subagent 可以跑：`scripts/build-only.sh --check`（纯 cargo check）+ `scripts/disk-usage-check.sh`（跨平台）+ `npm run tauri dev`（Vite + Tauri CLI 跨平台）
- ⚠️  macOS 编译产物 = `.app` bundle（不是 `.exe`），命名约定见 §9.2
- ⚠️  macOS 用户数据路径 = `~/Library/Application Support/ClaudeConfigManager/`（不是 `%APPDATA%\ClaudeConfigManager\`）

### 11.6 决策门槛
主 session 的决策分为两类：
- **必须问用户**：技术栈选型 / 架构重大分歧 / 是否进入下一迭代 / SPEC 冲突解决 / 大范围返工
- **可自主决定**：单文件命名 / 单函数签名 / 局部重构 / 单条命令 / 单元测试细节

### 11.7 三次失败必须暂停复盘 (M3.0.3 lesson)
**规则**：同一个问题（同一文件 / 同一错误 / 同一目标）尝试修复 **3 次仍失败** 时：
1. ❌ **禁止** 派第 4 次 subagent / 第 4 轮 Edit / 继续猜
2. ⏸️ **必须** 暂停，进入复盘流程：
   - 重新读 §6 评审纪律（自审 / 头脑风暴 / 同行评审 / 业务流程分析）
   - **重审前提假设**：之前 3 次失败是不是方向错了？该方案是不是压根不可行？
   - 列证据：3 次分别改了什么？每次具体报什么错？错在哪个调用栈？
   - 列可能根因：≥ 3 个候选根因
3. 🛑 **必须** 要么：
   - 改换方案（重新设计，不在原路径上继续试）
   - 或要求用户介入（提供更多上下文 / 授权大改 / 决定是否回滚）

**反事故**：本会话杀死的 `a374807b29f187ddd` 子任务 —— 编译错误诊断跑 20+ 分钟仍无完整产出，被我 TaskStop。原因是任务方向中途改了 2 次（先派"跑 cargo build" → SendMessage 改"只 grep" → TaskStop 杀），subagent 在矛盾指令下陷入死循环。**正确的应对**：第 1 次发现矛盾时立即 TaskStop + 重派新任务，而不是等 20 分钟。

**根因诊断流程**（暂停后必走）：
1. 收集所有错误日志（`cargo check 2>&1 | tee build.log` + `sccache --show-stats` + 浏览器 console 等）
2. 按"调用栈分类"：是 A 处错、B 处错、还是 A → B 链式错？
3. 按"假设 vs 证据"：列出过去 3 次的**前提假设**，哪些假设没被验证？
4. 按"已知 vs 未知"：哪些事实已知（可验证）？哪些未知（需用户确认）？
5. 写"暂停复盘报告"到 `tmp/issue-retro-<date>.md`，包含以上 4 项

### 11.8 用户核定未到 → 不派 ship 类 subagent (M3.0.3 lesson)
§9.5 要求"未经核定不能进下一迭代"。主 session 必须 enforce：
- 收到 ship subagent 完成回报后 → **不要立即派下一个 build/ship/dist-touching subagent**
- 等用户明确 "完成" 或 "未完成：<原因>" 后再决定下一步
- 即使是"修复已知 bug"也属于下一迭代（如本会话 M3.0.3 → M3.0.3-fix-v2）

**反事故**：本会话主 session 在 M3.0.3 未核定时就派了 M3.0.3-fix-v2 build subagent，违反了 §9.5 精神。

## 14. Subagent 行为禁区 (M3.0.3 sccache subagent 违反案例)

### 14.1 禁止擅自 commit / push / tag / 改全局配置
subagent 完成任务后**不得**：
- ❌ `git add` + `git commit`（即使是只是 `tmp/` 下的报告文件）
- ❌ `git push` / `git tag` / `git branch`
- ❌ 改 `~/.cargo/config.toml` / `~/.bashrc` / `~/.zshrc` / 任何用户级配置（即使是"加速"用途）
- ❌ 装全局工具 `cargo install xxx` / `npm install -g xxx` / `brew install xxx`

**正确流程**：subagent 完成 → 回报主 session → 主 session 列白名单 → 用户确认 → 主 session 自己 commit / 自己改全局配置，**或**显式批准 subagent 执行并指定精确命令。

**反事故**：本会话 sccache subagent 自行 `git add tmp/sccache-install-verify.md && git commit`（commit `645680b`）— 违反本条。回滚命令：`git reset --soft HEAD~1`（保留工作区）或 `git reset --hard HEAD~1`（彻底回滚）。

### 14.2 用户核定未到 → 不派 ship 类 subagent
见 §11.7。ship 类 subagent 定义：任何会修改 `dist/` / `target/release/` / 桌面 exe / `Cargo.lock` / `package-lock.json` 的 subagent。
