# 脚本使用指南（CLAUDE.md §9 扩写）

> 本文档扩写 `CLAUDE.md §9.6 / §9.7`，聚焦 **4 个 build 脚本的使用场景与方法**。
> 不改 CLAUDE.md（用户审后再决定是否合入）。

---

## 1. 决策树（什么场景用什么脚本）

| 场景 | 用哪个 | 命令 | 备注 |
|---|---|---|---|
| **迭代完成，准备 ship 给用户核定** | `build-and-ship.sh` | `./scripts/build-and-ship.sh --milestone M1 --task 1.1 --slug scaffold` | §9.5 唯一允许的 cp 到桌面入口；自动 build + smoke + cp |
| **dev 循环内快速验证 Rust 编译通过**（只改 Rust） | `build-only.sh` | `./scripts/build-only.sh` | 默认 release 编译（3m30s）；不复制、不冒烟 |
| **想看类型错误 / 编译错误但不想链接** | `build-only.sh --check` | `./scripts/build-only.sh --check` | `cargo check`，秒级 |
| **改了 Cargo.toml 依赖或 build.rs，要全量重建** | `build-only.sh --clean` | `./scripts/build-only.sh --clean` | 先 `cargo clean --release` 再 build |
| **已 ship 后想复跑 smoke test**（手动验证某个现成 exe） | `smoke-test.sh` | `./scripts/smoke-test.sh src-tauri/target/release/claude-config-manager.exe` | 10 项验证（launch/window/webview/title/assets/db/schema/queryable/tray/kill） |
| **dev 中残留进程卡死 / smoke test 前清理** | `kill-app.sh` | `./scripts/kill-app.sh` | 优雅关（CloseMainWindow + 5s 超时 + force fallback） |
| **进程僵死无法优雅关** | `kill-app.sh --force` | `./scripts/kill-app.sh --force` | 立即 `taskkill -F -PID`；跳优雅期 |
| **改 src/ 前端**（tsx / css / 组件） | `npm run build`（不走 build-only） | `npm run build` | build-only 不重跑 `beforeBuildCommand`；改前端必须先 `npm run build` |
| **想看 vite HMR 实时预览**（不改 Rust） | `npm run tauri dev` | `npm run tauri dev` | dev server + dev build；**不 ship** |
| **改前端 + 改 Rust 都要快速联调** | `npm run tauri dev` | `npm run tauri dev` | 一条命令搞定 vite + tauri 双 watch |
| **里程碑结束做 Release 打包验证**（bundler 链路） | `build-and-ship.sh`（内部已用 `tauri build --no-bundle`） | 同 ship 命令 | §9.3：M2.x 及以后 release build 全走此脚本 |

---

## 2. 4 个脚本依赖关系（ASCII 图）

```
                     ┌──────────────────────────────┐
                     │  build-and-ship.sh           │   一键 ship 入口
                     │  (build + cp + smoke)        │   §9.5 强制走这条
                     └──────────────┬───────────────┘
                                    │ 内部调
                  ┌─────────────────┴─────────────────┐
                  ▼                                   ▼
      ┌──────────────────────┐            ┌──────────────────────┐
      │  build-only.sh       │            │  smoke-test.sh       │
      │  (仅 cargo build)    │            │  (10 项验证)          │
      └──────────────────────┘            └───────────┬──────────┘
                                                     │ 内部调
                                                     ▼
                                          ┌──────────────────────┐
                                          │  kill-app.sh         │
                                          │  (pre-cleanup)       │
                                          └──────────────────────┘

build-only.sh 是独立工具，不调任何其它脚本。
kill-app.sh 也是独立工具，被 build-and-ship / smoke-test 复用做 pre-cleanup。
```

**关键调用链**：
1. `build-and-ship.sh` 第 132 行 → 调 `smoke-test.sh "$DEST_EXE"`
2. `smoke-test.sh` 第 109 行 → 调 `kill-app.sh` 做 pre-cleanup（统一 kill 逻辑，单一真相源）
3. `build-and-ship.sh` 显式 **不** inline PowerShell `Stop-Process`（避免与 smoke-test 自己的 kill-app.sh 重复冷启动 ~200ms）

---

## 3. 每个脚本的"何时不用"

### 3.1 `build-and-ship.sh` — 何时不用
- ❌ **只想看 vite 跑、UI 实时预览** → 用 `npm run tauri dev`（dev server + HMR）
- ❌ **只想验证编译通过、还不想 ship** → 用 `build-only.sh`（不 cp 到桌面、不冒烟）
- ❌ **只想跑 smoke test 复验现成 exe** → 直接用 `smoke-test.sh <exe-path>`，不用 ship
- ❌ **忘了 milestone / task / slug 参数** → 用 `build-only.sh`（不需要这些参数）

### 3.2 `build-only.sh` — 何时不用
- ❌ **改 `src/` 前端** → 不要用 build-only；它不跑 `beforeBuildCommand` (= `npm run build`)，老 dist 会嵌进 exe（M1.3 stale-dist 事故模式）。改前端先 `npm run build`，或直接用 `build-and-ship.sh`（内部 `tauri build` 自动跑）
- ❌ **想跑测试** → 用 `cargo test --no-run --tests` 单独编译验证（见全局 memory: Tauri cargo test 0xC0000139 陷阱），或直接 `tauri build`
- ❌ **想打包 msi / nsis 安装包** → 用 `npm run tauri build`（带 bundler）；build-only 只产裸 exe

### 3.3 `smoke-test.sh` — 何时不用
- ❌ **exe 还没生成** → 先 `build-only.sh` 或 `build-and-ship.sh`
- ❌ **想看 vite dev 实时反馈** → smoke test 只测 release exe，不测 dev build
- ❌ **想验证具体 DOM 内容**（按钮文字 / 表单值 / 路由跳转）→ smoke test 只验"窗口有内容 + 标题对 + assets 嵌入了"，**不**验证具体渲染内容。细致 DOM 校验走 Vitest 单元测试 + WebDriver e2e
- ❌ **同名 exe 是别的项目** → 会被误杀；smoke test 会自动 kill 同名进程（pre-cleanup）

### 3.4 `kill-app.sh` — 何时不用
- ❌ **同名 exe 是其他项目** → 会被误杀（M2.6+ 的 `ClaudeConfigManager-M*` 通配符会匹配所有同名变体）
- ❌ **只想关一个特定 PID** → 用 `taskkill -F -PID <pid>`（kill-app 是批杀）
- ❌ **想保留进程不杀** → 那不是 kill-app 的职责

---

## 4. 常见错误（pitfalls）

### 4.1 build-only.sh 相关
- ⚠️ **改了 src/ 但只跑 build-only** → 老 dist 嵌进 exe，前端不更新。必须先 `npm run build`，或直接用 `build-and-ship.sh`。
- ⚠️ **改了 src-tauri/Cargo.toml 没看到 rebuild** → 用 `build-only.sh --clean` 全量重建（sccache warm cache 后增量 build 会很快，但首次 Cargo.toml 变更需要重算依赖图）
- ⚠️ **第一次跑 build-only 报 `windres not found`** → 脚本会 auto-detect msys2 mingw64 bin 并加 PATH；但如果 msys2 不在 `/c/msys64/mingw64/bin` 等候选路径，需手动 `export PATH`

### 4.2 build-and-ship.sh 相关
- ⚠️ **忘了 3 个必传参数** → `Usage: build-and-ship.sh --milestone <M1|M2|...> --task <1.1|1.2|...> --slug <kebab-case>` 直接 exit 1
- ⚠️ **slug 含大写或空格** → 桌面文件名会变成 `ClaudeConfigManager-M1.1.1-Foo Bar.exe`；必须 kebab-case（如 `f9-fuzzy-search`）
- ⚠️ **smoke test FAIL** → 脚本自动 `rm -f` 桌面 exe + WebView2Loader.dll，exit 1。**不要手动 cp 残留 exe**；回任务修。
- ⚠️ **`WebView2Loader.dll not found`** → 脚本 warn 但不 fail；exe 单独能跑但 webview 启动会失败。检查 `src-tauri/target/release/` 下 DLL 是否被 `tauri build` 产出。
- ⚠️ **运行前残留旧进程** → §9.7 流程要求先跑 `kill-app.sh`；build-and-ship 自身不 inline kill（避免与 smoke-test 的 pre-cleanup 重复冷启动）

### 4.3 smoke-test.sh 相关
- ⚠️ **Test 6 (title) FAIL 显示 "skipped"** → `TAURI_CONF` 路径找不到；默认 `/d/project/winui3/src-tauri/tauri.conf.json`，可在调用前 `export TAURI_CONF=/path/to/your/tauri.conf.json`
- ⚠️ **Test 7 (assets) FAIL 但前端其实嵌入了** → `strings` 命令不在 PATH；脚本自动 fallback 到 `grep -a`，仍 FAIL 则确认 `dist/assets/index-*.js` 是否存在
- ⚠️ **Test 8/9/10 FAIL 在 fresh 用户** → Test 9 要求 `usage_history` + `backup_history` + `schema_version` 都在；如果 migration 没跑，db 可能存在但 schema 不全
- ⚠️ **PowerShell heredoc 死锁 / 静默退出** → 不存在的现象（M3.0.4 已验证 `-File` 而非 `-Command -` 解决 Add-Type 问题）

### 4.4 kill-app.sh 相关
- ⚠️ **Git Bash 里 `/F` 被 mangle 成路径** → 脚本用 `-F -PID` 而非 `/F /PID`（taskkill 在 Git Bash 下 forward-slash 解析异常）
- ⚠️ **`taskkill -IM ClaudeConfigManager-M*` 通配符不展开** → 脚本走 PID 路径（先 tasklist grep 拿 PID，再逐个 taskkill）
- ⚠️ **优雅关 5s 超时后 force kill** → 这是设计而非 bug；M1.3 时代强杀会丢未保存的 history.db 写入

---

## 5. 4 个脚本互不重叠 vs 互相依赖

### 5.1 互相依赖（耦合）
| 调用方 | 被调方 | 用途 |
|---|---|---|
| `build-and-ship.sh` | `smoke-test.sh` | ship 前必跑 smoke test；FAIL 则从桌面删除 exe |
| `smoke-test.sh` | `kill-app.sh` | pre-cleanup：杀掉任何残留进程避免影响 Test 1 启动 |

**设计意图**：kill-app 是"杀进程"的单一真相源（single source of truth），build-and-ship / smoke-test 都复用，避免各自 inline 实现导致行为漂移。

### 5.2 不重叠（独立工具）
| 脚本 | 独立性 | 何时独立用 |
|---|---|---|
| `build-only.sh` | 完全独立 | dev 循环快速验证 Rust 编译；不复制、不冒烟 |
| `kill-app.sh` | 完全独立 | 手动清理残留进程 / 调试卡死时强杀 |

### 5.3 build-and-ship.sh vs build-only.sh 边界
- `build-only.sh` 用裸 `cargo build --release`（带 `touch src-tauri/src/lib.rs` 强制 relink）
- `build-and-ship.sh` 用 `npm run tauri build -- --no-bundle`（自动跑 `beforeBuildCommand` + 自动 enable `tauri/custom-protocol`）
- **M2.17-C3 lesson**：build-and-ship 切换到 `tauri build` 是为了根除 M1.3 stale-dist 失败模式；build-only 仍保留 `cargo build` 路径是 **故意** 的——Rust-only 迭代更快（~90s vs ~3m40s），但调用方必须自负责 `npm run build` 同步

### 5.4 smoke-test.sh vs kill-app.sh 边界
- `smoke-test.sh` 用 `kill-app.sh` 做 pre-cleanup（杀旧进程）；**不**调 `kill-app.sh --force`（优雅路径足够旧进程退出）
- `kill-app.sh` 是被动的"接收调用"，不主动调用 smoke-test

---

## 6. 速查表（最常见 3 个 flow）

### Flow 1：dev 循环（只改 Rust）
```bash
./scripts/kill-app.sh                          # 清残留（如果上轮 smoke test 残留）
./scripts/build-only.sh                        # cargo build --release（~3m30s 冷，~90s warm）
./scripts/smoke-test.sh src-tauri/target/release/claude-config-manager.exe  # 手动冒烟
```

### Flow 2：改前端（src/ 下任何文件）
```bash
npm run build                                  # 必须！build-only 不跑 beforeBuildCommand
./scripts/kill-app.sh
./scripts/build-and-ship.sh --milestone M1 --task 1.1 --slug my-feature
# 内部：tauri build --no-bundle → 自动 npm run build → 自动 enable custom-protocol
# 等用户核定（§9.5）
```

### Flow 3：迭代 ship 给用户核定
```bash
./scripts/build-and-ship.sh --milestone M2 --task 2.3 --slug provider-list
# 内部全流程：kill residue → tauri build --no-bundle → cp exe + WebView2Loader.dll → smoke test 10 项
# smoke PASS → 输出 "SHIPPED ✓" + 桌面路径
# smoke FAIL → 自动 rm 桌面 exe，exit 1（不回桌面）
# 等用户回 "完成" 或 "未完成：<原因>"（§11.7：不核定不派下一个 ship 类 subagent）
```

---

## 7. 与 CLAUDE.md §9 的关键交叉引用

| 本指南章节 | CLAUDE.md 章节 | 约束摘要 |
|---|---|---|
| §1 决策树 | §9.6 | 4 个脚本的职责划分 |
| §2 依赖图 | §9.7 | kill-app 在最前，build-and-ship 在最后 |
| §4 pitfalls | §9.4 | smoke test 4 项 → 10 项的演进（M1.3 lesson） |
| §5.3 | §9.3 | build-and-ship 用 `tauri build` 而非 `cargo build` |
| §5.4 | §11.7 | smoke FAIL 后不立即派下一个 ship subagent |
| §6 Flow 3 | §9.5 | 未经用户核定不进入下一迭代 |

---

*文档生成自 CLAUDE.md §9 + 4 个脚本源码读取；不改 CLAUDE.md。*
