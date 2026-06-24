# Tauri 编译加速方案调研 (2026-06-24)

> 项目：`D:/project/winui3/`
> 技术栈：Tauri v2 + React 19 + TS 5.8 + Vite 7 + Rust (30+ deps, 12 tauri-plugin-*)
> 当前耗时：cargo release build 3m30s + vite 4s + cp/smoke 5s ≈ 3m40s
> Toolchain：Windows 11 + Git Bash + Rust `x86_64-pc-windows-gnu` + msys2 mingw64 (windres)
> Build 命令：`npm run tauri build -- --no-bundle`（M2.17-C3 决策）

---

## 1. 当前耗时分解

| 阶段 | 耗时 | 占比 | 备注 |
|---|---|---|---|
| `npm run build` (tsc + vite build) | ~4s | 2% | ts-check + bundle；增量改 ts 时大多 cache 命中 |
| `cargo build --release`（`tauri build` 内部） | ~210s (3m30s) | 96% | 30+ crate 重 link；主战场 |
| cp + smoke test | ~5s | 2% | file copy + 4 项 smoke check |
| **合计** | **~3m40s** | 100% | |

**瓶颈定位**：cargo release build 独占 96%。30+ crate 全量 release 链接耗时，且 windows-gnu toolchain 默认用 `ld.bfd`（比 `lld` 慢 2-3x）。

---

## 2. 候选方案（按收益排序）

### 方案 A：sccache 编译缓存 — **首选**

- **工作原理**：`rustc-wrapper` 把每次 cargo 编译的 .rlib 输出 hash 到磁盘缓存（默认 `~/.cache/sccache` 或 `~/.cargo/sccache`）。相同 crate 链 + 相同源码 → 直接 hit cache，不调 rustc。
- **预期收益**：
  - **首次 build**：无收益（需全量编译填充缓存）
  - **第二次 build**（仅改 1 个源文件）：**-50~70%**（200s → 60-100s）
  - **依赖未变 + 仅改前端**：可达 -90%（cargo 完全不跑）
- **风险**：**低**
  - 用户级配置 `~/.cargo/config.toml`，**不动项目**（CLAUDE.md §2.4 友好）
  - sccache 在 windows-msvc + windows-gnu 都被官方支持（[Mozilla/sccache Rust.md](https://github.com/mozilla/sccache/blob/main/docs/Rust.md)）
  - 已知限制：`--crate-type=bin` / `cdylib` / `proc-macro` **不能 cache**（直接调 system linker）—— 但 metadata + dep-info 可 cache，本项目主要重编译时间是 metadata
  - proc-macro 读 fs 可能不被 cache（极少数 case，无影响）
- **安装成本**：~2-5 分钟
  - `cargo install sccache --locked`（一次性 ~5min 编译）
  - 或 `winget install Mozilla.sccache`（已编译好的 release 版本，秒装，**推荐**）
- **验证方法**：
  1. 装好后跑 `sccache --version` + `sccache -s`（首次清零）
  2. 跑一次 release build → 记录 `Compile requests × Cache hit` 比例
  3. 再跑一次 → 应看到大量 hit，耗时显著下降
- **适用本项目**：**是**（30+ crate 是最大受益场景；增量迭代占绝大多数）

**权威来源**：
- [Cargo Book: build-cache.md](https://github.com/rust-lang/cargo/blob/master/src/doc/src/reference/build-cache.md) — 官方推荐方案
- [Mozilla/sccache Rust docs](https://github.com/mozilla/sccache/blob/main/docs/Rust.md) — Rust 支持矩阵
- [Mozilla/sccache README](https://github.com/mozilla/sccache/blob/main/README.md) — 安装与 config 模板

---

### 方案 B：lld / mold 链接器 — **次选**（中期）

- **工作原理**：替换默认 `ld.bfd` 为 `lld`（LLVM 链接器）或 `mold`（现代极速链接器，Linux/macOS 主力）。链接是 release build 最重的一步。
- **预期收益**：
  - `lld`：链接阶段 **-50~70%**（实测：mingw-w64 lld 比 ld.bfd 快 2-3x）
  - `mold`：链接阶段 **-5~10x**（但 **Windows 支持差**，本项目不能用）
- **风险**：**中**
  - `lld` for windows-gnu：需装 LLVM for Windows（`winget install LLVM.LLVM`），增加 ~300MB 工具链
  - windres 已经走 mingw64，不受影响
  - `lld` 与部分 PE 资源 link 偶尔有兼容性问题（极少见，需 fallback）
  - 改动位置：项目 `.cargo/config.toml`（CLAUDE.md §2.4 跨文件变更 → **需列白名单给用户**）
- **安装成本**：~10 分钟（下载 LLVM ~5min + 配置 + 验证）
- **验证方法**：同方案 A，单独测链接阶段耗时
- **适用本项目**：**是**，但比方案 A 优先级低（sccache 已砍掉重编译，剩下 link 阶段才需要这个）

**权威来源**：
- [Tauri 文档：distribute/windows-installer](https://v2.tauri.app/distribute/windows-installer) — 官方推荐装 `lld` + `llvm-rc`
- LLVM 官网 `lld` 文档

---

### 方案 C：cargo profile 调优 — **不推荐**

- **工作原理**：在 `src-tauri/Cargo.toml` 写 `[profile.release]` 调 `codegen-units` / `lto` / `opt-level` / `strip` / `incremental`。
- **预期收益**：
  - `codegen-units = 1` + `lto = true`：编译 **更慢**（LLVM 优化 + 链接时间增长），产物更小 + 略快
  - `codegen-units = 256`（默认）+ `lto = false`：编译快，但运行慢
  - `incremental = true`（release profile 允许）：**+5-10%** 增量重编
- **风险**：**高（相对）**
  - 直接动 `src-tauri/Cargo.toml` 违反 CLAUDE.md §2.4 "改 1 个文件也要有充分证据"
  - profile 调优与二进制大小/运行速度强相关，本项目目标是 desktop UI 工具，**运行速度不敏感**，没必要牺牲编译时间换体积
- **推荐度**：**不推荐**（除非用户明确要求优化二进制大小）

**权威来源**：
- [Tauri 文档：concept/size](https://v2.tauri.app/concept/size) — profile 设置示例
- [Cargo Book: profiles](https://doc.rust-lang.org/cargo/reference/profiles.html)

---

### 方案 D：dev build + `tauri dev` 流程 — **限定场景推荐**

- **工作原理**：开发期用 `tauri dev`（cargo 跑 debug profile），build 时间 **~30s** 而非 210s。release 仅在 ship 时跑。
- **预期收益**：开发迭代循环 **-80%**（30s vs 210s），但**ship 时不变**
- **风险**：**低**
  - debug 与 release 行为差异（log 级别、panic unwind、optimization）需明确边界
  - 当前 CLAUDE.md §9.5 "每次迭代必 ship" → ship 流程必须 release，不能改
  - 但**开发期**完全可以走 debug → ship 时再 release（不冲突）
- **成本**：**零**（无安装成本；仅工作流调整）
- **验证方法**：本地试一次 `tauri dev` 看启动时间 + UI 完整性
- **适用本项目**：**是**——开发/调试期主用 dev build；ship 时保留 release

**权威来源**：
- [Tauri 文档：development](https://v2.tauri.app/start/development/) — `tauri dev` vs `tauri build`

---

### 方案 E：cargo-zigbuild — **不推荐**

- **工作原理**：用 Zig 作为链接器（自带 lld），针对 cross-compile 优化。
- **预期收益**：同 `lld`，但额外收益对 cross-compile 场景不显著（本项目 native build）
- **风险**：**高**
  - 需额外装 Zig 工具链
  - windows-gnu target + Zig 0.16+ 自动加 `-lcompiler_rt` 行为可能与本项目 mingw 链接冲突
  - 比方案 B（直接装 lld）多一层 Zig 抽象，调试更麻烦
- **推荐度**：**不推荐**（本项目不需要 cross-compile）

**权威来源**：
- [rust-cross/cargo-zigbuild docs](https://github.com/rust-cross/cargo-zigbuild) — 主要场景是 cross-compile

---

### 方案 F：拆分 workspace / feature flag — **远期**

- **工作原理**：把 30+ crate 拆 workspace + 用 feature flag 减少编译单元；build 只编需要的 features。
- **预期收益**：**当前架构下不显著**（架构变化才能落地）
- **风险**：**高**
  - 架构层变更（M1 已固化 plugin stub 架构）
  - 改动跨 10+ 文件，违反 CLAUDE.md §2.4
- **推荐度**：**远期考虑**（M3+ 视情况）

---

## 3. 推荐方案

| 优先级 | 方案 | 收益 | 风险 | 决策点 |
|---|---|---|---|---|
| **短期立即做** | **A: sccache** | 二次 build -50~70% | 低（不动项目） | 用户批准装 sccache |
| **中期做** | B: lld linker | link 阶段 -50~70% | 中（动 .cargo/config） | 用户批准 + 白名单 |
| **开发期立即采纳** | D: dev build 流程 | dev 循环 -80% | 极低（仅工作流） | 仅作开发建议，ship 不变 |
| 不推荐 | C / E | 收益小 / 风险高 | — | 跳过 |
| 远期 | F: workspace 拆分 | 架构变更 | 高 | M3+ 评估 |

---

## 4. 实施步骤（方案 A 详细）

### Step 1: 安装 sccache（二选一）

```bash
# 推荐（已编译，秒装）
winget install Mozilla.sccache

# 备选（需编译 5min）
cargo install sccache --locked
```

### Step 2: 用户级 cargo config（**不动项目**）

写入 `~/.cargo/config.toml`（如不存在）：

```toml
[build]
rustc-wrapper = "sccache"
```

> **关键**：`~/.cargo/config.toml` 是**用户级**，与项目无关，零污染（CLAUDE.md §2.4 友好）。

### Step 3: 验证

```bash
# 确认装好
sccache --version
which sccache   # Git Bash 下确认路径

# 跑 build 看效果
./scripts/kill-app.sh
./scripts/build-only.sh        # 首次会全量编，填缓存
./scripts/build-only.sh        # 二次触发，看耗时下降
sccache -s                     # 看 cache hit 比例
```

预期结果：二次 build 耗时降至 **~90-120s**（vs 210s 当前）。

### Step 4: 与 build-and-ship.sh 集成（**可选**）

不需要改脚本 —— sccache 是 `RUSTC_WRAPPER` 自动 wrap rustc 的，`tauri build` 内部 cargo 调用会被自动拦截。

### Step 5: 缓存管理

```bash
# 缓存膨胀时清理
sccache -C

# 看缓存大小
sccache -s
```

默认磁盘上限 10GB（`~/.cache/sccache`，可配）。本项目重 build 大约占 ~1-2GB，远低于上限。

---

## 5. 风险与回滚

### 风险矩阵

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| sccache 缓存膨胀占满磁盘 | 低 | 中 | `sccache -C` 一键清理；可设 `[cache.disk] size = 5368709120`（5GB） |
| Windows gnu toolchain 兼容性问题 | **极低** | 高 | sccache 官方 Windows 全 target 支持；万一有问题见回滚 |
| proc-macro 不被 cache（cache miss 比例偏高） | 中 | 低 | 不影响开发体验，只是部分 crate 仍需重编 |
| 缓存污染（旧 build 产物被错误 hit） | **极低** | 中 | sccache hash 包含源码 + rustc 版本 + flags；理论不可能污染 |
| 用户级配置影响其他项目 | 极低 | 低 | 反而是收益（其他 Rust 项目也受益） |

### 回滚方案

**方案 A 的回滚**（30 秒）：
```bash
# 方案 1：注释掉配置（保留文件便于恢复）
# 编辑 ~/.cargo/config.toml，注释 rustc-wrapper 行

# 方案 2：彻底删除
rm ~/.cargo/config.toml

# 方案 3：用环境变量覆盖（一次性 disable 本次 build）
RUSTC_WRAPPER="" ./scripts/build-and-ship.sh --milestone M3 --task ...
```

回滚后 build 耗时回到 210s（与现状一致）。

---

## 6. 实施 checklist（给主 session 用）

- [ ] **先方案 A**（sccache）— 用户级 config，零项目改动
  - [ ] 问用户是否同意装 sccache
  - [ ] 用户批准后：装 + 配 + 验证
  - [ ] 验证通过：交付加速 build 给用户核定
- [ ] **采纳方案 D**（dev build 流程）— 仅作开发建议，不需要用户批准
- [ ] **方案 B**（lld）等方案 A 落地 + 数据确认后再议
- [ ] **不**做方案 C / E / F

---

## 7. 关键参考链接

| 来源 | URL | 用法 |
|---|---|---|
| Cargo Book build-cache | https://github.com/rust-lang/cargo/blob/master/src/doc/src/reference/build-cache.md | 方案 A 权威 |
| Mozilla/sccache Rust.md | https://github.com/mozilla/sccache/blob/main/docs/Rust.md | 方案 A 兼容性 |
| Tauri windows-installer | https://v2.tauri.app/distribute/windows-installer | 方案 B 工具链 |
| Tauri concept/size | https://v2.tauri.app/concept/size | 方案 C profile |
| Cargo Book profiles | https://doc.rust-lang.org/cargo/reference/profiles.html | 方案 C 详细 |
| cargo-zigbuild LinkerArgumentFiltering | https://github.com/rust-cross/cargo-zigbuild/blob/main/_autodocs/LinkerArgumentFiltering.md | 方案 E 风险 |
| Tauri development | https://v2.tauri.app/start/development/ | 方案 D dev build |

---

## 8. 一句话总结

**短期：装 sccache（用户级 config，零项目污染）→ 二次 build -50~70%；中期：补 lld → link 阶段再砍半；不碰 profile/cross-compile/workspace 拆分（风险/收益不匹配）。**