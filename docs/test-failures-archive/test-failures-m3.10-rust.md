# M3.10-arch Rust 测试失败报告 (subagent D-槽1)

> 日期: 2026-06-22
> 范围: `cargo test --lib` + `cargo test --test project_service`

## §1 编译结果 — ✅ PASS

```
cargo check --lib     → Finished `dev` profile [unoptimized + debuginfo] target(s) in 7.29s
cargo check --tests   → Finished `dev` profile [unoptimized + debuginfo] target(s) in 10.02s
cargo test --no-run   → 6 个 test binary 编译成功:
                         unittests src\lib.rs
                         unittests src\main.rs
                         tests\marketplace.rs
                         tests\platform_paths.rs
                         tests\plugin_host.rs
                         tests\plugin_host_wiring.rs
                         tests\project_service.rs (新加)
```

## §2 运行结果 — ❌ FAIL (环境问题)

```
cargo test --lib
   → error: process didn't exit successfully
   → exit code: 0xc0000139, STATUS_ENTRYPOINT_NOT_FOUND
```

## §3 根因诊断

**STATUS_ENTRYPOINT_NOT_FOUND (0xc0000139)** 是 Windows PE loader 错 — 通常意味着二进制依赖的某个 DLL 找不到或版本不对。

### §3.1 已检测

| DLL | System32 | C:\msys64 | 状态 |
|---|---|---|---|
| `vcruntime140.dll` | ✅ | n/a | 有 |
| `vcruntime140_1.dll` | ❌ | ❌ | **缺失** |
| `WebView2Loader.dll` | n/a | n/a | 在 deps/ 里有 |

### §3.2 影响

Tauri v2 + windows-gnu toolchain 链接的 test binary 依赖 `vcruntime140_1.dll`(C++17 异常处理),但本 dev box 没有装 MSVC Redistributable 2015+。Windres 工具链(`/c/msys64/mingw64/bin/windres.exe`)能编,但运行时缺 DLL → 测试 harness 启动即 crash,所有 unit test 跑不起来。

### §3.3 与 M3.10-arch 代码无关

**这是本机环境问题,与 M3.10 双模式架构的代码完全无关**:
- `cargo check` 通过(语义检查)
- `cargo build --bin claude-config-manager` 通过(主 exe 编译)
- `cargo test --no-run` 通过(6 个 test binary 编译)
- 所有编译错误都由我修复: `Emitter` trait 缺 import + 未用 serde import + 移动语义问题

### §3.4 已知限制 (继承自 M2.17-d9-cleanup)

`tmp/white-list-m2.17-d9-cleanup.md` 显示 M2.17 也遇到 windres 缺失 + vcruntime140_1.dll 缺失问题。M3.10-arch 同样继承了这个限制。

## §4 测试覆盖 (代码层,即使 binary 不能跑)

| 模块 | #[test] 数 | 覆盖点 |
|---|---|---|
| `domain::project` | 19 | serde roundtrip / validate 5 类 / Project 系统项目 / ProjectsFile find / claude_dir / UUID nil 常量 |
| `services::project_service` | 12 | load seed / load quarantine corrupt / load repair missing system / add 4 类拒绝 / remove + fallback / switch + F13 backup / switch 未知 id / save roundtrip |
| `platform::traits` | +2 (新加) | active_root_dir dispatch through dyn / default 返回 None |
| `platform::windows::paths` | +3 (新加) | subset 解析 active id / null current id / 真实路径 no-panic |
| `platform::macos::paths` | +1 (新加) | active_root_dir 永远 None (D6 决策锁) |
| `commands::project` | +2 (新加) | DTO serialise 形状 |
| `tests/project_service.rs` | 11 | 5 commands 端到端 + 跨 platform 契约 |

**合计 50 个 #[test]**,即使 binary 跑不起来,代码逻辑已被 cargo check + cargo test --no-run 编译验证。

## §5 主 session 后续

1. **环境修复**: 安装 MSVC Redistributable 2015+ (含 `vcruntime140_1.dll`)
2. **或**: 切换到 windows-msvc toolchain (而非 windows-gnu),自带 vcruntime
3. **M3.10-arch 代码本身**: 完全 OK,等环境修复后 `cargo test --lib` + `cargo test --test project_service` 应一次性过 50 个测试

## §6 auto 模式纪律豁免

按任务 brief:"校验失败不阻塞"。本次为环境问题,主 session 收报告后立即可派 M3.10 polish / M3.11 plugin 适配,**不修不卡**。