# Target 目录清理方案调研报告

**调研日期**: 2026-06-24
**调研对象**: `D:/project/winui3/src-tauri/target/` (9.6 GB)
**不动任何文件,仅出方案**

---

## 1. 现状概览(已实测)

| 目录 | 大小 | 用途 | 备注 |
|---|---|---|---|
| `target/debug/` | **7.4 G** | 开发期产物 | 可清理 |
| `target/release/` | **2.3 G** | ship exe + cargo deps cache | **不动 exe** |
| **`target/debug/incremental`** | **630 M** | 增量编译缓存 | 仅 dev 用 |
| `target/debug/.fingerprint` | 5.1 M | crate 元数据指纹 | 仅 cargo 内部用 |
| `target/release/incremental` | 0 (空) | — | release 不产 incremental |
| `target/release/.fingerprint` | 2.9 M | release crate 元数据 | 再 build 需要 |
| **`target/debug/deps`** | **3.8 G** | dev rlib + d 文件 | **最大头** |
| `target/debug/build` | 2.7 G | build script 产物 | dev 跑 proc-macro 需要 |
| `target/release/deps` | 1.7 G | release rlib + d 文件 | 见 §4 风险说明 |
| `target/release/build` | 584 M | release build script 产物 | 同上 |

---

## 2. `target/debug/` 最大 10 项 (`du -h | sort -h | tail`)

| # | 路径 | 大小 | 性质 |
|---|---|---|---|
| 1 | `target/debug` (总) | **7.4 G** | dev 全部 |
| 2 | `target/debug/deps` | **3.8 G** | rlib/d/rmeta(再 build 可重用) |
| 3 | `target/debug/build` | **2.7 G** | build-script 产物(proc-macro 链) |
| 4 | `target/debug/incremental` | **630 M** | 增量编译 hash+bitcode,**丢了就全重编** |
| 5 | `target/debug/incremental/claude_config_manager_lib-1fkodvunz0kip` | 363 M | 单 crate incremental |
| 6 | `target/debug/incremental/claude_config_manager_lib-2wferoh3jwlxt` | 264 M | 同上,旧版本 |
| 7 | `target/debug/incremental/claude_config_manager_lib-2wferoh3jwlxt/s-...` | 264 M | 单次 incremental bitcode |
| 8 | `target/debug/incremental/claude_config_manager_lib-1fkodvunz0kip/s-...` | 260 M | 同上 |
| 9 | `target/debug/incremental/claude_config_manager_lib-1fkodvunz0kip/s-...` | 104 M | 同上 |
| 10 | `target/debug/build/claude-config-manager-a05324bac32a658d` | 67 M | 主 crate build script |

---

## 3. `target/release/` 顶层 + 最大 5 项

```
claude-config-manager.exe         323,355,414  (308 MB)   ← ship exe,不动
libclaude_config_manager_lib.a    480,688,578  (458 MB)   ← 静态库,可重链
libclaude_config_manager_lib.rlib 163,071,622  (155 MB)   ← 再 release build 用
WebView2Loader.dll                    160,320  (157 KB)   ← 运行时依赖,不动
claude-config-manager.d                 5,224  (5 KB)     ← 依赖追踪文件
target/release/deps                  1.7 G               ← 见 §4
target/release/build                 584 M               ← 见 §4
```

`du -h | sort -h | tail`:
| # | 路径 | 大小 |
|---|---|---|
| 1 | `target/release/deps` | 1.7 G |
| 2 | `target/release/build` | 584 M |
| 3 | `target/release` (总) | 2.3 G |
| 4 | (无单项文件再超 500M;exe 308M 是单文件最大) | — |

**exe 实际大小确认**:
- `claude-config-manager.exe` = **308 MB** (`323,355,414 bytes`)
- PE32+ x86-64,stripped to external PDB,GUI subsystem
- 依赖 `WebView2Loader.dll`(157 KB,运行时必需)

---

## 4. 关键检查项

### 4.1 `.pdb` / `.dSYM` / `.exe.dSYM/`
- **`find target -name "*.pdb"` = 0 条**
- `find target -name "*.dSYM"` = 0 条
- → MSVC 工具链 + `stripped to external PDB` 标志:debug/release **都不产 PDB**
- **没有可清的 PDB 红利**(本机已经配置 strip)

### 4.2 `release/deps` / `release/build` 是不是 ship exe 运行时依赖?
**不是运行时依赖**。证据:
- `release/claude-config-manager.exe` 是 **PE32+ 自包含可执行文件**(已 strip + LTO)
- 同目录的 `WebView2Loader.dll` 是 WebView2 bootstrapper(运行时唯一外部 dll)
- `release/deps/*.rlib` = Rust 静态库 release build cache,**仅下次 `cargo build --release` 用**
- `release/deps/*.d` = 依赖追踪文件,同上
- `release/build/` = build script(proc-macro)产物,**仅下次 build 用**
- 当前 `release/incremental` 已是空(因为 release 不开 incremental)
- 当前 `release/.fingerprint` 2.9 MB = crate hash 索引,**下次 build 必需**

**结论**:
- ✅ `release/incremental`(空) / `release/examples`(空)= 已经无东西可清
- ⚠️ `release/deps`(1.7G) / `release/build`(584M) / `release/.fingerprint`(2.9M) = **cargo build cache,清掉下次 release build 需重链 + 重跑 proc-macro**
- ❌ `release/claude-config-manager.exe`(308M) / `WebView2Loader.dll`(157K) = **绝对不动**

### 4.3 `libclaude_config_manager_lib.a` / `.rlib` 是不是运行时依赖?
**不是**。它们是 cargo 的产物 cache:
- `.a` = 静态 archive(下次 release build 重链用)
- `.rlib` = Rust 内部中间表示(下次 dev/release build 都用)
- exe 已 link 完毕,这些文件可删

---

## 5. 候选方案对比

| 方案 | 操作 | 节省空间 | 下次 build 增量耗时 | 风险 | 推荐场景 |
|---|---|---|---|---|---|
| **A 轻量** | `rm -rf target/debug/incremental target/release/.fingerprint` (release incremental 已空,跳过) | **~630 MB** (debug incremental) + 2.9 MB | +5-10 秒 (重生成 fingerprint) | **低** | 想立刻轻装、不动 deps cache |
| **B 中量** | A + `rm -rf target/debug/deps target/release/deps` (保留 `WebView2Loader.dll` + `claude-config-manager.exe` + `.d` 文件不动) | **~5.5 GB** (debug deps 3.8G + release deps 1.7G) | +1-3 分钟 (重链 ~250 个 crate + 重生成 rlib) | **中**(首次 release build 也会重链) | 下次必走 dev;release 已 ship 不再改 |
| **C 重量** | `cargo clean --manifest-path src-tauri/Cargo.toml` + 提前 cp 出 `release/claude-config-manager.exe` + `WebView2Loader.dll` 到 `tmp/release-backup-20260624/` 备份 | **~9.4 GB** (全清) | +3-4 分钟 (首次全量重编) | **高**(release 需完整重 build,~10-15 分钟) | 准备彻底换 toolchain / 换 cargo 版本 / 磁盘极度紧张 |

### 5.1 关键说明

1. **A 方案的 fingerprint 价值不大**:2.9 MB 极小,且删了首次 build 会重算所有 crate hash;
   **更纯的 A 方案**:仅删 `target/debug/incremental`(630 MB),其他全留 → 收益/风险比最高。
2. **B 方案删 `release/deps` 的副作用**:
   - 当前 ship exe 是 **308 MB**,不会受影响(已 link 完成)
   - 但下次 `cargo build --release` 会重跑全量 link,**比有 cache 慢 1-3 分钟**
   - WebView2.dll 不在 deps/ 里,安全
3. **C 方案的 release exe 备份必要性**:
   - 既然 smoke-test 已过 + 已 ship 到桌面,**release exe 不再需要保持 linkable**
   - 但下一迭代若要 release build,需从零开始(~10 分钟)
   - 建议备份路径: `D:/project/winui3/tmp/release-backup-20260624/claude-config-manager.exe` + `WebView2Loader.dll`

---

## 6. 推荐

**推荐方案 B**(中量清理),原因:

1. **磁盘回报最高**:一次性拿回 5.5 GB,占可清总量 7.4 GB 的 **74%**
2. **风险可控**:
   - 已 ship 的 `release/claude-config-manager.exe`(308 MB)+ `WebView2Loader.dll`(157 KB)**完全保留**
   - 桌面上的 `ClaudeConfigManager-M3/...exe` 已 smoke-test 通过,**与 target/release 内 exe 无关**
   - 仅损失下次 release build 的 1-3 分钟增量
3. **不影响当前工作流**:
   - 当前迭代周期已确认转 v3.0-round2 规划,短期不再 release build
   - dev cycle 必然要 `cargo build`(debug),无论 target 是否清,都会重链 → 影响最小化

**如果用户希望最保守**:方案 A(仅清 debug incremental,~630 MB,+5 秒 build)。
**如果用户想释放极致**:方案 C,但需先 `mkdir tmp/release-backup-20260624 && cp release/claude-config-manager.exe WebView2Loader.dll tmp/release-backup-20260624/` 兜底。

---

## 7. 不在清理范围(留作信息)

- `target/release/claude-config-manager.exe` 308 MB(ship 产物,**不动**)
- `target/release/WebView2Loader.dll` 157 KB(运行时必需,**不动**)
- `target/debug/examples` / `target/release/examples` 都已是空目录
- 没有 .pdb / .dSYM 可清(本机配置已 strip)
- `target/debug/.fingerprint`(5.1 MB)体积小,价值高于删除收益,**不动**

---

**报告生成完毕,未对任何文件做修改。**
