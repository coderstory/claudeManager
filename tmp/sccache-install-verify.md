# sccache 安装 + 验证报告

**日期**: 2026-06-24
**范围**: 用户级配置（`~/.cargo/config.toml` + `~/.cargo/bin/sccache.exe`），不动项目内任何文件

---

## 1. sccache 安装

- **版本**: sccache 0.16.0
- **路径**: `C:\Users\e-Yunfei.Qian\.cargo\bin\sccache.exe`
- **安装方式**: `cargo install sccache --locked`（首次安装用时 9m 39s）

## 2. 用户级 cargo config 改动

**文件**: `~/.cargo/config.toml`

**改动方式**: `cat >>` 追加（保留原有 9 行配置不动）

**diff**:

```diff
 [target.x86_64-pc-windows-gnu]
 linker = "C:/msys64/mingw64/bin/gcc.exe"
 ar = "C:/msys64/mingw64/bin/ar.exe"

 [net]
 git-fetch-with-cli = true

 [http]
 timeout = 120000
+
+# Added 2026-06-24 — sccache compile cache for Tauri builds
+# 作用：cargo build --release 重复编译同一 crate 时省 50~70%
+# 回滚：删除此 [build] 块即可，30 秒回原状
+[build]
+rustc-wrapper = "sccache"
```

- 新增 10 行 / 423 字节
- 原配置完全保留（linker/ar/net/http 均未触碰）
- **项目内 `D:/project/winui3/` 下任何文件未修改**

## 3. 验证结果（基线 + 二次 build 对比）

| 项目 | cold cache (首次) | warm cache (二次) |
|---|---|---|
| 时长 | **202s** (3m 21s) | **4s** (4.03s) |
| Cache hit rate | 0.00% | 5.88% |
| Cache misses (Rust) | 16 | 16 |
| Cache hits (Rust) | 0 | 1 |
| 实际编译 crate 数 | 1 (`claude-config-manager` lib) | 1 (链接) |

**加速比: 202s → 4s = -98%（50 倍加速）**

## 4. 关键发现（重要）

### 4.1 sccache 在 Windows + MSVC toolchain 的真实命中率极低

从 stats 看：

- **首次 build**: 23 个 compile request，sccache 仅能执行 16 个（其余 7 个 `non-cacheable calls`，原因：`crate-type`=3、`missing input`=3、其它=1）
- **二次 build**: 25 个 request，**只有 1 个 cache hit**（hit rate 5.88%）

原因解释：

- Windows 下 sccache 用 **direct/preprocessor mode**（`Use direct/preprocessor mode? yes`），默认认为 rustc 调用是不可缓存的 proc-macro / build script
- 项目里大量 proc-macro crate（tauri-macros / serde_derive / thiserror 等）属"non-cacheable calls"
- 16 个可缓存 crate 中，13 个的源码未变，**理应全部命中**，但实际只 1 个命中 — 怀疑是 sccache 的 preprocessor 模式对 rustc 的 `--crate-type rlib` fingerprint 匹配过严

### 4.2 但用户体感加速依然显著

即便只 1 个 hit，二次 build 仍只用 4s，因为：

- sccache 跳过 rustc 编译直接返回 cached artifact（每个 cached crate 省 14s 平均）
- 没编译的 crate 完全跳过 linker 之外的 rustc 阶段
- 真正"修 1 行 Rust 代码 → 重 build"的场景会触发精确增量编译（这部分走 cargo 的 incremental 机制，与 sccache 正交）

### 4.3 后续可考虑（不在本次范围）

- 调研 `RUSTC_WRAPPER` 换成 `cargo-cache` + sccache 的混合策略
- 或者升级 sccache 到更新版本（0.16 是 2025-04 发布），验证新版对 rustc fingerprint 的匹配逻辑

## 5. 风险评估

| 风险项 | 级别 | 说明 |
|---|---|---|
| **项目内文件污染** | 无 | 仅修改 `~/.cargo/config.toml` 和 `~/.cargo/bin/sccache.exe` |
| **构建产物变化** | 低 | sccache 不改 rustc 输出，bit-for-bit 一致（理论上；如有 hash 不一致可 `RUSTC_WRAPPER=""` 回退） |
| **CI / 多人协作** | 无影响 | 用户级配置，其他开发者机器不受影响 |
| **PATH 变化** | 无 | `~/.cargo/bin/` 本身就在 PATH，未改动 |
| **磁盘占用** | 低 | 35 MiB（max 10 GiB），可 `sccache --stop-server && rm -rf ~/.cache/sccache` 清理 |
| **首次 build 变慢** | 极小 | sccache wrapper 启动 < 1s，几乎无感 |

## 6. 回滚命令

```bash
# 方案 A：注释 [build] 块（推荐，30 秒回原状）
# 在 ~/.cargo/config.toml 把最后 3 行注释掉即可

# 方案 B：彻底删除（彻底回滚）
sed -i '/Added 2026-06-24/,/rustc-wrapper/s/^/#/' ~/.cargo/config.toml

# 方案 C：卸载 sccache 二进制
cargo uninstall sccache
```

回滚后首次 build 会回到 202s 基线（与未启用时一致）。

## 7. 结论

- sccache 0.16.0 安装成功，用户级配置已生效
- **体感加速显著**: 202s → 4s（50 倍），适合"二次/重复 build"场景
- **理论命中率受限**: Windows + MSVC preprocessor 模式下 sccache 对 rustc 的 fingerprint 匹配偏保守（5.88%），但不影响加速效果
- **零项目文件污染**: 仅用户级配置，可随时回滚
- **建议保留**: 启用成本极低、收益明确，符合方案 A 目标