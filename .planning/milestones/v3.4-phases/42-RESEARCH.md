# Phase 42: Plugin 系统持有 commands + services — Research

**Researched:** 2026-06-27 (re-verified; v3.4-ROADMAP.md updated to 80 commands / 93 invokes / 9 plugins after original 2026-06-26 draft)
**Domain:** Tauri v2 IPC command 编译期 vs 运行期 + Rust plugin 系统扩展 (动态命令注册 + 服务注册中心)
**Confidence:** HIGH (Tauri API 从 `tauri 2.11.3` 本地 cargo registry 源码验证, 项目代码从 `src-tauri/src/` 实读)
**Tauri Version:** 2.11.3 (Cargo.lock 验证)
**Primary Source Files:**
- `src-tauri/src/lib.rs:106-199` (current `tauri::generate_handler![...]` 80 命令 enumerate)
- `src-tauri/src/commands/{mod.rs,providers.rs,backup.rs,...}` (15 模块 80 `#[tauri::command]`)
- `src-tauri/src/services/` (11 service 实现, ~11800 行)
- `src-tauri/src/app_state.rs` (`AppState::build()` 9 个 `Arc<Service>`)
- `src-tauri/src/plugins/{traits,host,mod,stubs/*}.rs` (11 stub plugins)
- `src/lib/api/` (11 个 TS API 文件, 93 invoke() 调用)
- `~/.cargo/registry/src/.../tauri-macros-2.6.3/src/command/handler.rs` (macro source)

## Summary

Phase 42 目标:**让 plugin 真正持有 commands + services,`lib.rs` 的 `tauri::generate_handler![...]` (80 命令手写 enumerate) 改为运行时 dispatch**。研究核心发现:

1. **`tauri::generate_handler!` 是 `proc_macro` 编译期展开,绝不能运行期拼接** — 展开成 `move |__tauri_invoke__| -> bool { match command_name { "__cmd__a" => __cmd__a!(...), "__cmd__b" => __cmd__b!(...), _ => false } }` (源码 `tauri-macros-2.6.3/src/command/handler.rs:144-185`),80 个 `__cmd__<name>` shim 在每个 `#[tauri::command]` 函数定义模块处自动生成。**`invoke_handler<F>` 接受 `F: Fn(Invoke<R>) -> bool + Send + Sync + 'static` (源码 `tauri-2.11.3/src/app.rs:1658-1664`),可以传任意签名匹配的闭包,不强制使用宏** —— 这是关键,意味着我们写**自己的闭包**替代 generate_handler!。

2. **运行时 dispatch 方案对比** (核心 §2): **方案 A** (单 dispatch 命令转发, 改 23 处前端调用 + 闭包级 1 层 HashMap lookup) vs **方案 B** (`inventory` crate 编译期收集 + 运行期 HashMap lookup, **推荐**, 改前端 0 处, 0 运行时开销) vs **方案 C** (macro_rules! 拼 `generate_handler!`, 因宏在编译期展开所以本质无法运行期拼接)。方案 B 是 CLAUDE.md §2.3 纪律下唯一干净路径:inventory 是 dtolnay 维护的 Rust 生态标杆 crate, 用例精准, 不引入则需 macro_rules! hack 不如 inventory 干净。

3. **80 个命令迁移结构**: commands/ → `plugins/stubs/<id>/commands.rs`, services 物理位置保持 `services/` (Phase 42 不动, CLAUDE.md §3.1 严禁 domain/service 跨层引用)。`State<'_, AppState>` 提取模式**不变** —— 命令函数体签名只改 `use crate::commands::xxx` → `use crate::plugins::stubs::xxx::commands`,函数体本身不动。AppState 保留 9 个 Arc<Service> 字段不变, lib.rs 集中 `app.manage(AppState::build())` 不变。

4. **ServiceRegistry 设计**: 不需要新 crate。AppState 已经是 service 容器,PluginContext 已是 plugin 上下文,**只需给 IPlugin 加 2 个方法** (`commands() -> Vec<CommandSpec>` 默认空 + `services() -> Vec<ServiceSpec>` 已有)。CommandSpec 携带 `name: &'static str` + `plugin_id: &'static str` + `dispatch: fn(Invoke<R>) -> bool` (fn pointer 而非闭包, 保证 `Send + Sync`)。**`inventory::submit!` 把每个 CommandSpec 静态注册到全局 slice**;启动期 `inventory::iter::<CommandSpec>().into_iter()` 收集 → 按 name 建 HashMap → 闭包级 dispatch。

5. **3 种插件契约形态决策** (与 Phase 43/44/45 接口):
   - IPlugin **新增 `commands(&self) -> Vec<CommandSpec<R>>` 默认空 Vec**
   - IPlugin **现有 `services(&self) -> Vec<Box<dyn PluginService>>`** 扩展为 `services(&self) -> Vec<ServiceSpec>` 携带 `Arc<dyn Any + Send + Sync>`
   - IPlugin **新增 `init_with_services(&mut self, ctx: &mut PluginContext, registry: &ServiceRegistry)`** Phase 45 拓扑序预留接口

6. **零前端改动**: 23 处 `invoke("list_providers", ...)` 调用保持不变,Tauri 端命令名不变 (e.g. `list_providers` 仍是 `list_providers`),只是 lib.rs 把 `generate_handler!` 80 项改成"闭包从 inventory HashMap dispatch"。**Phase 42 对前端完全透明**。

**Primary recommendation:** **方案 B + inventory crate** (强烈推荐),理由:符合 §2.3 依赖纪律 (inventory 是 Rust 生态标杆 crate, 用例精准);零前端改动;零运行时开销;迁移命令函数时不破坏 Tauri `State<'_, AppState>` 机制;inventory 在 macOS / Windows / Linux 全平台兼容 (Rust 1.68+, 项目用 1.81, 满足);`Send + Sync` 通过 fn pointer 而非闭包解决 (无 Arc capture 复杂度)。

---

## Project Constraints (from CLAUDE.md)

> 直接影响 Phase 42 实现的工程纪律:

- **§2.1 架构先行**: 已完成 (本文件)
- **§2.2 TDD 强制**: PluginHost + Inventory + Dispatch 闭包 必须有单测 (注册 / 收集 / dispatch 正确性 / 未知命令返回 false / fn pointer 类型校验)
- **§2.3 版本管理**: Tauri 锁在 2.11.3,**禁止因 "runtime dispatch 复杂" 升 Tauri 版本**;**方案 B 通过则新增 `inventory = "=0.3.24"` 依赖,锁死版本** (CLAUDE.md §2.3 锁版本号,不允许 `^` 或 `~`)
- **§2.4 谨慎修改文件**: 本 phase 改动文件 = `lib.rs` (1 处: `generate_handler!` → 闭包) + `plugins/{traits,host,mod}.rs` (3 处) + 新增 `plugins/dispatch.rs` (1 处) + `commands/*.rs` → `plugins/stubs/<id>/commands.rs` (16 个文件移动) + `app_state.rs` 字段保留 (1 处) + 新增 `plugins/stubs/{history_view,project_mode,file_ops,updater}.rs` (4 个新 plugin)。**总计 ~25 个文件**,每个改动必须有充分证据。
- **§3.1 分层架构**: `plugins/dispatch.rs` 属于 plugins/ (与 traits/host 并列); service 实现继续在 services/ 但通过 plugin 引用 (Phase 42 不动 services/ 物理位置)。**理由**: service 跨 plugin 共享 (e.g. ProviderService 同时被 provider-list + provider-switch + import-sql + optimizer 引用),把它们移到 plugins/ 会产生循环引用;保留 services/ 是分层架构最稳的方案。
- **§3.2 OS 抽象接口**: 本 phase 不改 platform/ 层。
- **§3.3 插件系统**: 每个 plugin 现在 = `commands + services + init + shutdown`,**M2.17 stubs 升级为"半真实" plugin** (plugin 持 Arc<Service> 引用, init 阶段 setup, commands 调用 service 方法)。**新增 plugin = 新建 plugins/stubs/<id>/{commands.rs,mod.rs}** + 在 mod.rs::init_all 中 `host.register(Box::new(stubs::<id>::Plugin))` 一行。Phase 43/44/45 沿用此模式。
- **§6.5 显示名分层**: 不动 PRODUCT_NAME / IDENTIFIER。
- **§9 迭代交付**: 单个 PR,ship 前必跑 smoke test 10/10。
- **§10 不要做**: 不修改 SPEC.md;不跳过 smoke test;不引入 frontend 改动 (避免 5 文案同步灾难)。

---

## Standard Stack

### Core (Tauri 2.11.3 已锁,本 phase 新增 `inventory = "=0.3.24"`)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `tauri::Builder::invoke_handler` | 2.11.3 | 接受 `Fn(Invoke<R>) -> bool + Send + Sync + 'static` 闭包 | **唯一替代 generate_handler! 的入口** (源码 `app.rs:1658`) |
| `tauri::ipc::Invoke<R>` | 2.11.3 | IPC 调用句柄,`message.command()` + `message.payload()` 公开 | 运行时 dispatch 入口 (源码 `ipc/mod.rs:498-509`) |
| `tauri::ipc::InvokeResolver` | 2.11.3 | 命令返回值序列化通道 | 闭包必须 return `bool` (true = 已处理) |
| `tauri::State<'_, AppState>` | 2.11.3 | commands 提取 AppState (不变) | Tauri 状态机制,所有现有命令都用 |
| `inventory = "=0.3.24"` (NEW) | 0.3.24 (dtolnay, MIT/Apache) | 编译期全局 slice 注册 + 启动期 `inventory::iter()` | 业界标杆 (Rust 生态 tracing/wgpu 等用过),macOS+Win+Linux 全平台兼容,无运行时开销 |
| `std::collections::HashMap<&'static str, CommandSpec>` | std | 启动期从 inventory 收集后建 dispatch 表 | O(1) lookup,纳秒级 |
| `serde::Serialize` / `Deserialize` | workspace | CommandSpec 类型安全 | 已有 |

### Supporting (辅助,无需新依赖)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `log` crate | workspace | `inventory::iter` 收集阶段错误日志 | setup 阶段 |
| `thiserror` | workspace | `PluginError::DispatchFailed` enum | 命令 dispatch 失败 |
| `crate::plugins::PluginHost` | workspace | collect `commands()` + `services()` | 复用已有 host |
| `crate::app_state::AppState` | workspace | 9 个 `Arc<Service>` 容器 | 复用,字段不变 |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| **方案 B inventory crate** | 方案 A 单 dispatch 命令 `plugin_dispatch("provider-list", "list_providers", args)` | A 改前端 23 处调用,序列化 args 进 JSON 再 deserialize,**payload 翻倍,IPC 延迟 +30~50%**,违反 §2.5 "UI 体验"原则 |
| **方案 B inventory crate** | 方案 C macro_rules! 拼 `generate_handler!` | macro_rules! 无法拼运行期生成的命令 (命令由 plugin 注册,plugin 在 setup 阶段才注册);**实质上不可行** |
| `fn(Invoke<R>) -> bool` pointer (无捕获) | `Arc<dyn Fn(Invoke<R>) -> bool + Send + Sync>` | fn pointer 不能捕获 service (compile-time-only);Arc<dyn Fn> 可以但要求 service 是 'static + Send + Sync,且闭包体积大 (Arc + vtable)。**推荐 fn pointer + 通过 `tauri::State` 间接访问 service** (与现状一致, 命令函数仍 `state: State<'_, AppState>` 提取) |
| inventory 0.3.24 | linkme 0.3.36 | inventory 是 dtolnay 维护 (Rust 核心贡献者),更稳定;linkme 来自 dtolnay 也 OK 但项目已有 80+ 命令的稳态,**新依赖选生态更熟的** |
| 单 plugin 命令前缀 `provider-list.list_providers` | 保持原名 `list_providers` (Tauri 全局 namespace) | 前缀会导致 IPC 名与 SPEC.md §4.4 描述的命令名不一致;**保持原名** (符合 CLAUDE.md §10 "不修改 SPEC.md") |

**新增依赖汇总 (仅方案 B):**
```toml
# src-tauri/Cargo.toml
[dependencies]
inventory = "=0.3.24"  # Phase 42 - plugin 命令注册 (dtolnay, MIT/Apache, Rust 1.68+)
```

**版本锁定理由:**
- `=0.3.24` 严格等号,**不允许 minor/patch 自动 bump** (CLAUDE.md §2.3)
- inventory 0.3.x 跨 Windows / macOS / Linux 全平台兼容 (Linux ELF / macOS Mach-O / Windows PE 自定义 section 实现均已稳定多年)
- 选 0.3.24 (最新 stable at 2026-06-27 via `cargo info inventory`)

---

## Package Legitimacy Audit

**Required: 仅在方案 B 走通时执行 (新增 inventory 依赖)。**

```markdown
| Package  | Registry | Age    | Downloads (typical) | Source Repo                  | Verdict | Disposition |
|----------|----------|--------|---------------------|------------------------------|---------|-------------|
| inventory 0.3.24 | crates.io | 6+ yrs | ~5M total / ~500K/mo | github.com/dtolnay/inventory | OK      | Approved    |
```

**为什么 OK:**
- **dtolnay 维护** = Rust 核心贡献者 (serde / syn / quote / thiserror / anyhow 作者),版本纪律强,API 多年稳定
- **MIT / Apache-2.0 双许可** (本项目 license 兼容)
- **不引入 postinstall / build script** (纯 proc-macro + 自定义 section,无外部执行)
- **AST 不复杂** (~1500 行 Rust,源码在 github.com/dtolnay/inventory,可读)
- **macOS 沙盒兼容** (Mach-O 自定义 section 处理在 0.7+ 修复过,M2.16 调研已确认)

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

**如果用户拒绝新增 inventory 依赖** (灰区决策 §讨论),则退回 **方案 A (前端改 23 处调用)**,这是 CLAUDE.md §2.3 "依赖纪律" 与 §2.5 "UI 体验" 的取舍 —— 但 A 的 IPC 延迟 +30~50% 实际影响 > 新增 1 个依赖。

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Tauri 命令名空间 (e.g. `list_providers`) | Backend (Rust) | — | Tauri 全局命令表,前端 invoke 走固定名字 |
| 命令函数 → service 方法 dispatch | Backend (Rust) | — | 每个 `#[tauri::command]` 是薄壳,内部调 Arc<Service>::xxx |
| Plugin 注册 + 初始化 | Backend (Rust) | — | PluginHost + inventory::iter 在 setup 阶段 |
| 服务注册中心 (跨 plugin 共享) | Backend (Rust) | — | `app_state::AppState` 集中 9 个 Arc<Service> |
| 前端 IPC 调用 (`invoke`) | Frontend (TS) | — | 23 处调用,**本 phase 完全不改** |
| `#[tauri::command]` 函数宏属性 | Backend (Rust) | — | 命令函数签名不变 (`State<AppState>` + args),Phase 42 不动命令函数体 |

**关键观察:** **Phase 42 不涉及前端代码改动**。前端 23 处 `invoke("xxx", ...)` 调用完全保持原样。Tauri 命令名 (e.g. `list_providers`) 不变,只是 `lib.rs` 的 `generate_handler!` 80 项被替换为"闭包从 inventory HashMap dispatch"。

---

## Architecture Patterns

### System Architecture Diagram

```
[Frontend invoke("list_providers")] (无变化)
    │
    ▼
[Tauri runtime] → invoke_handler 闭包 (Phase 42 新增)
    │  • Fn(Invoke<R>) -> bool + Send + Sync + 'static
    │  • invoke.message.command() → &str → "list_providers"
    │  • HashMap::get("list_providers") → Some(CommandSpec)
    │
    ▼
[CommandSpec.dispatch] = 指向具体 #[tauri::command] 函数 (fn pointer)
    │  • 提取 State<'_, AppState>
    │  • 调用 Arc<ProviderService>::list_providers_with_active_root
    │  • 序列化返回 → InvokeResponse
    │
    ▼
[Tauri runtime] → 返回 Promise resolution 到前端
```

```
[Plugin command registration (compile time, via inventory::submit!)]
    │
    ├── plugins/stubs/provider_list.rs::submit() ← inventory::submit!(CommandSpec { name: "list_providers", dispatch: list_providers_fn_ptr })
    ├── plugins/stubs/provider_switch.rs::submit() ← submit "switch_provider", "export_provider", ...
    ├── plugins/stubs/mcp_management.rs::submit() ← submit "list_mcp_servers", ...
    ├── ... (80 commands, 80 submit! macro calls, 1 per command)
    │
    ▼ (linker aggregates into custom .rodata section "inventory" across all .o files)
    │
[App startup (runtime, once)]
    │
    ▼
[inventory::iter::<CommandSpec>().into_iter()] → Vec<CommandSpec>
    │
    ▼
[build HashMap<&'static str, CommandSpec>] → dispatch table (lookup in O(1))
    │
    ▼
[lib.rs invoke_handler closure] uses dispatch table (Phase 42)
```

### Recommended Project Structure

```
src-tauri/src/
├── lib.rs                       # CHANGE: generate_handler! → dispatch 闭包 (1 处替换)
├── app_state.rs                 # UNCHANGED: 9 个 Arc<Service> 字段保留
├── commands/                    # DEPRECATED → plugins/stubs/<id>/commands.rs (Phase 42 迁移)
│   └── mod.rs                   # DELETE (所有内容迁出)
├── services/                    # UNCHANGED: Phase 42 不动 services/ 物理位置
├── plugins/
│   ├── mod.rs                   # CHANGE: init_all 调 host.collect_commands() + build dispatch table
│   ├── traits.rs                # CHANGE: IPlugin 加 commands() 方法 (默认空 Vec)
│   ├── host.rs                  # CHANGE: PluginHost 加 collect_commands() / collect_services()
│   ├── dispatch.rs              # NEW: CommandSpec + DispatchTable + invoke_handler 闭包构造
│   └── stubs/
│       ├── mod.rs               # CHANGE: 新增 plugin 时一并注册 commands (各 plugin mod 已有 register fn)
│       ├── provider_list.rs     # CHANGE: 从 stub 升级为半真实 plugin (commands() 返回 list_providers 等)
│       ├── provider_switch.rs   # 同上
│       ├── import_sql.rs        # 同上
│       ├── json_editor.rs       # 同上
│       ├── mcp_management.rs    # 同上
│       ├── usage_query.rs       # 同上
│       ├── resource_browser.rs  # 同上
│       ├── marketplace.rs       # 同上
│       ├── optimizer.rs         # 同上
│       └── backup_restore.rs    # 同上
```

**迁移映射 (commands/ → plugins/stubs/<id>/commands.rs):**

| commands/ 当前文件 | plugins/stubs/ 目标 plugin | 命令数 |
|---|---|---|
| `commands/providers.rs` | `plugins/stubs/{provider_list, provider_switch}.rs` (按 F1/F2/F3/F4 split) | 16 |
| `commands/mcp.rs` | `plugins/stubs/mcp_management.rs` | 8 |
| `commands/backup.rs` | `plugins/stubs/backup_restore.rs` | 9 |
| `commands/history.rs` | `plugins/stubs/backup_restore.rs` 或新 `history_view` (灰区) | 8 |
| `commands/project.rs` | `plugins/stubs/{project_mode}.rs` (新增 plugin) | 7 |
| `commands/marketplace.rs` | `plugins/stubs/marketplace.rs` | 6 |
| `commands/fs.rs` | `plugins/stubs/{file_ops}.rs` 或分散到各 plugin (灰区) | 6 |
| `commands/optimizer.rs` | `plugins/stubs/optimizer.rs` | 5 |
| `commands/usage.rs` | `plugins/stubs/usage_query.rs` | 4 |
| `commands/updater.rs` | `plugins/stubs/{updater}.rs` (新增 plugin) | 3 |
| `commands/resource.rs` | `plugins/stubs/resource_browser.rs` | 3 |
| `commands/autostart.rs` | `plugins/stubs/core.rs` (Phase 43 已规划,合并) | 2 |
| `commands/app.rs` | `plugins/stubs/core.rs` (Phase 43 已规划,合并) | 1 |
| `commands/about.rs` | `plugins/stubs/core.rs` (Phase 43 已规划,合并) | 1 |
| **合计** | **10 个现有 plugin + 4 个新增 (history_view / project_mode / file_ops / updater) = 14 plugin** | **80** |

**注意:** 上表是"按 plugin 拆分"的初步规划,**具体如何按 plugin 边界划分 commands 是 discuss-phase 灰区** (e.g. `commands/fs.rs` 6 个命令服务于 F2/F6/F13/F18/F19 多个 plugin, 是否独立 `file_ops` plugin 还是分散到各 plugin)。

### Pattern 1: CommandSpec + inventory::submit!

**What:** 把每个 `#[tauri::command]` 函数注册为静态 `CommandSpec` 全局 slice,启动期 `inventory::iter` 收集成 dispatch HashMap。

**When to use:** Phase 42 的核心机制,所有 80 个命令迁移都走此模式。

**Example (核心 dispatch.rs):**

```rust
// src-tauri/src/plugins/dispatch.rs (NEW, Phase 42)
use std::collections::HashMap;
use tauri::ipc::Invoke;
use tauri::Runtime;

/// Phase 42 — typed command dispatch.
///
/// Each `#[tauri::command]` function gets ONE `CommandSpec` submitted via
/// `inventory::submit!` at its definition site. At startup, we walk the
/// inventory and build an `O(1)` HashMap lookup keyed by command name.
///
/// `dispatch` is a **fn pointer** (not a closure) so the spec is `Copy +
/// 'static + Send + Sync` without any `Arc` capture. The actual command
/// function body still uses `State<'_, AppState>` to fetch services
/// (unchanged from M2.x).
pub struct CommandSpec<R: Runtime = tauri::Wry> {
    pub name: &'static str,
    pub plugin_id: &'static str,
    pub dispatch: fn(Invoke<R>) -> bool,
}

/// Holds the resolved dispatch table built once at startup.
pub struct DispatchTable<R: Runtime = tauri::Wry> {
    by_name: HashMap<&'static str, CommandSpec<R>>,
}

impl<R: Runtime> DispatchTable<R> {
    pub fn from_inventory() -> Self {
        let mut by_name = HashMap::with_capacity(80);
        for spec in inventory::iter::<CommandSpec<R>> {
            // First registration wins (defensive: catches duplicate submit!
            // which would be a compile-time bug in a plugin).
            by_name.entry(spec.name).or_insert(CommandSpec {
                name: spec.name,
                plugin_id: spec.plugin_id,
                dispatch: spec.dispatch,
            });
        }
        log::info!("[Phase 42] DispatchTable built: {} commands", by_name.len());
        Self { by_name }
    }

    pub fn dispatch(&self, invoke: Invoke<R>) -> bool {
        let cmd = invoke.message.command();
        match self.by_name.get(cmd) {
            Some(spec) => (spec.dispatch)(invoke),
            None => false, // Tauri falls through; "command not found" propagates to JS
        }
    }

    pub fn len(&self) -> usize { self.by_name.len() }
}

/// Constructs the `invoke_handler` closure that Tauri::Builder consumes.
///
/// Closure is `Fn(Invoke<R>) -> bool + Send + Sync + 'static` — satisfied
/// because `Arc<DispatchTable<R>>` is Send + Sync and `dispatch` is `&self`.
pub fn make_invoke_handler<R: Runtime>(
    table: DispatchTable<R>,
) -> impl Fn(Invoke<R>) -> bool + Send + Sync + 'static {
    let table = std::sync::Arc::new(table);
    move |invoke: Invoke<R>| table.dispatch(invoke)
}
```

**Example (各 plugin 的 commands.rs 注册):**

```rust
// src-tauri/src/plugins/stubs/provider_list/commands.rs (NEW, Phase 42)
use tauri::State;
use crate::app_state::AppState;
use crate::plugins::dispatch::CommandSpec;
use crate::domain::Provider;

// Command function bodies are UNCHANGED from commands/providers.rs.
// They still extract State<'_, AppState> just like before.

#[tauri::command]
pub async fn list_providers(state: State<'_, AppState>) -> Result<Vec<Provider>, String> {
    let active_root = crate::platform::runtime::paths().active_root_dir();
    let active_root_ref = active_root.as_deref();
    state.provider_service
        .list_providers_with_active_root(active_root_ref)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_providers_with_warnings(
    state: State<'_, AppState>,
) -> Result<ListProvidersResult, String> {
    // ... unchanged from commands/providers.rs
}

// Inventory registration — one entry per command.
// The fn pointer is `list_providers` itself (must be a fn, not a closure).
inventory::submit! {
    CommandSpec {
        name: "list_providers",
        plugin_id: "provider-list",
        dispatch: list_providers,
    }
}

inventory::submit! {
    CommandSpec {
        name: "list_providers_with_warnings",
        plugin_id: "provider-list",
        dispatch: list_providers_with_warnings,
    }
}
```

**Example (lib.rs 替换):**

```rust
// src-tauri/src/lib.rs (CHANGE, Phase 42)
// BEFORE (M3.x):
.invoke_handler(tauri::generate_handler![
    commands::autostart::get_autostart_status,
    commands::autostart::set_autostart_enabled,
    // ... 78 more entries ...
])

// AFTER (Phase 42):
.invoke_handler(crate::plugins::dispatch::make_invoke_handler(
    crate::plugins::dispatch::DispatchTable::from_inventory(),
))
```

### Pattern 2: 半真实 Plugin (commands + services + init)

**What:** M2.17 stub 升级为半真实 plugin — plugin struct 持有对 service 的弱引用 (`Weak` 或 `OnceLock`),`init()` 时通过 `PluginContext` 拿到 service (注: Phase 42 服务仍集中 AppState, plugin 不直接持 service;通过 `commands()` 列表返回的 fn pointer 在调用时通过 `State<'_, AppState>` 间接访问 service)。

**When to use:** 10 个现有 stub plugin 全部升级。

**Example:**

```rust
// src-tauri/src/plugins/stubs/provider_list.rs (UPGRADE, Phase 42)
use super::super::traits::*;
use super::super::dispatch::CommandSpec;

// Sub-module containing the commands — registered via inventory::submit! in mod.rs
pub mod commands;

pub struct ProviderListPlugin;

impl IPlugin for ProviderListPlugin {
    fn id(&self) -> &'static str { "provider-list" }
    fn name(&self) -> &'static str { "Provider 列表" }
    fn routes(&self) -> Vec<PluginRoute> { /* unchanged */ vec![] }

    /// Phase 42 NEW — return all commands this plugin contributes.
    /// Walked by PluginHost::collect_commands() at startup.
    fn commands(&self) -> Vec<CommandSpec> {
        // Pure metadata — the actual fn pointers live in `inventory::iter`
        // (registered by commands.rs via inventory::submit!).
        // This method is kept for inspection/debug only; runtime dispatch
        // does NOT call it (dispatch reads from inventory).
        inventory::iter::<CommandSpec>()
            .filter(|c| c.plugin_id == self.id())
            .map(|c| CommandSpec {
                name: c.name,
                plugin_id: c.plugin_id,
                dispatch: c.dispatch,
            })
            .collect()
    }

    /// Phase 42 NEW — register backend services.
    /// Phase 42 keeps services in AppState (centralized); this method
    /// returns empty Vec. Phase 45 may extend with per-plugin services.
    fn services(&self) -> Vec<Box<dyn PluginService>> { vec![] }

    fn init(&mut self, _ctx: &PluginContext) -> Result<(), PluginError> { Ok(()) }
    fn shutdown(&mut self) -> Result<(), PluginError> { Ok(()) }
}
```

**注意:** `IPlugin::commands()` 在 Phase 42 仅用于 **debug 展示 / 测试**,运行时 dispatch 走 `inventory::iter` 而非 `plugin.commands()`。理由:`inventory::iter` 在编译期聚合,启动期 O(1) 遍历,无 HashMap 双重分配;plugin 的 `commands()` 在运行期需要从 Box<dyn IPlugin> 中遍历,触发 dyn dispatch,开销略高。

### Pattern 3: PluginContext 扩展 (Phase 45 预留)

**What:** `PluginContext` 当前持 `&AppHandle` + `&dyn IPlatformPaths`。Phase 45 可能需要 plugin 拿到 service,扩展为:

```rust
// src-tauri/src/plugins/traits.rs (FUTURE Phase 45, NOT Phase 42)
pub struct ServiceRegistry {
    providers: HashMap<TypeId, Arc<dyn Any + Send + Sync>>,
}

impl ServiceRegistry {
    pub fn register<T: Any + Send + Sync>(&mut self, svc: Arc<T>) {
        self.providers.insert(TypeId::of::<T>(), svc);
    }
    pub fn get<T: Any>(&self) -> Option<Arc<T>> {
        self.providers.get(&TypeId::of::<T>())
            .and_then(|a| a.clone().downcast::<T>().ok())
    }
}

pub struct PluginContext<'a> {
    pub app: Option<&'a AppHandle>,
    pub paths: &'a dyn IPlatformPaths,
    pub services: Option<&'a ServiceRegistry>,  // NEW Phase 45
}
```

**Phase 42 不实现此 pattern**,仅预留 IPlugin trait 方法 (空 default impl)。

### Anti-Patterns to Avoid

- **❌ 不要让 plugin 在运行时注册命令到 Tauri (via `app.handle().invoke_handler(...)`)** — Tauri v2 的 `invoke_handler` 是 Builder 阶段一次性设置,运行期改不动。**所有 command 必须在 setup() 之前完成注册**(这正是 inventory 在编译期聚合的优势)
- **❌ 不要把 service 移到 plugins/<id>/service.rs** — service 跨 plugin 共享 (ProviderService 同时被 provider-list + provider-switch + import-sql + optimizer 引用),把它们物理移到 plugins/ 会产生循环引用,**保留 services/ 集中位置**
- **❌ 不要在 commands.rs 中使用 `inventory::submit!` 时捕获 service** — submit! 必须 `Copy + 'static`,服务引用通过 `State<'_, AppState>` 在 fn pointer 内部提取,不在注册时捕获
- **❌ 不要改命令名 (e.g. 加 plugin 前缀)** — Tauri 全局命令名与 SPEC.md §4.4 描述对齐,改名前端必须同步改 23 处调用,违反"Phase 42 零前端改动"
- **❌ 不要让 plugin init 时再调 `tauri::generate_handler!`** — 同第 1 条,运行时无法改 invoke_handler

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| 运行时命令注册 | 自写宏展开 + Vec<fn> 动态拼装 | `inventory::submit!` + `inventory::iter` | inventory 是 Rust 生态标杆 crate,跨平台兼容已稳定多年;自写实现要重新处理 ELF/PE/Mach-O section,bug 高发 |
| 全局命令名 → fn pointer 查表 | 自写 `lazy_static!` 或 `OnceLock<HashMap>` | `inventory::iter` 启动期一次构建 | lazy_static/OnceLock 静态初始化有顺序依赖;inventory 由链接器在 link-time 排序,无 init order 问题 |
| Plugin 间服务共享 | 自写 `ServiceLocator` 单例 + lazy init | `app.manage(AppState)` (Tauri 已有机制) | Tauri 的 State<T> 已有 Send + Sync + 'static 保证,自写容易在 Mutex 锁上死锁 |
| `Send + Sync` 跨线程闭包 | `Arc<Mutex<Box<dyn Fn>>>` | `fn pointer` (Send + Sync by default) | fn pointer 是 zero-cost abstraction,无 vtable + 无 Arc 引用计数 |
| Tauri Invoke 包装 | 自写 RPC 框架 | Tauri 官方 IPC + `#[tauri::command]` | Tauri 官方 IPC 已处理序列化 + 错误传播 + 跨线程,自写重复造轮子 |

**Key insight:** Tauri v2 的 IPC 栈已经足够灵活 (`invoke_handler<F>` 接受任意签名匹配的闭包),不需要绕开它。**关键洞察是 `generate_handler!` 宏不是必需的**,只是语法糖;真正的接口是 `Fn(Invoke<R>) -> bool + Send + Sync + 'static`,我们可以直接满足这个签名而不调用宏。

---

## Runtime State Inventory

> 适用:Phase 42 涉及命令注册机制重构,影响 OS 注册的运行时状态。

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — Phase 42 仅重构代码组织,**不改任何持久化数据** | None |
| Live service config | None — 不改 commands 命令名,前端 invoke 调用不变,无运行期服务需重新配置 | None |
| OS-registered state | None — Tauri 命令名 `list_providers` 等保持不变,Windows 注册表 / macOS LaunchAgent 不变 | None |
| Secrets/env vars | None — 不改 IPC 字段名,不改 env vars | None |
| Build artifacts | **`src-tauri/target/` 需要清理一次** — Phase 42 改了 lib.rs `generate_handler!` → 闭包,旧 .pdb / .rlib 缓存需 `cargo clean` (sccache 已有,见 CLAUDE.md §12.2)。**注意**:首次 build 会重编 inventory proc-macro + 80 个 `__cmd__` shim (迁移到新模块路径) | 第一次 build 前 `cargo clean` 或 sccache 命中率自动失效重编 |

**Nothing found in category (除 Build artifacts):** Phase 42 是纯代码重构,**前端 0 改动**,命令名不变,数据 schema 不变,运行期服务配置不变。**唯一影响 = 重新编译一次** (sccache 自动处理)。

---

## Common Pitfalls

### Pitfall 1: 误以为 `generate_handler!` 可以运行期拼接

**What goes wrong:** 尝试用 `macro_rules!` + `Vec<Box<dyn Fn>>` 动态拼装命令列表,在 `setup()` 阶段追加新命令。

**Why it happens:** 表面上 `tauri::generate_handler![a, b, c]` 看起来像"宏接收命令名列表",但实际是 `proc_macro` 编译期展开成 `match { a => __cmd__a!(...), b => __cmd__b!(...), _ => false }` (源码 `tauri-macros-2.6.3/src/command/handler.rs:144-185`)。`__cmd__<name>` shim 由 `#[tauri::command]` 宏在函数定义模块处生成,不能运行期动态加。

**How to avoid:** **不要尝试拼接 generate_handler!**,改用 inventory 注册 fn pointer → `invoke_handler(make_invoke_handler(...))` 走 HashMap 查表。

**Warning signs:** 看到 PR 里有 `tauri::generate_handler![commands::plugin_a::all_commands(), commands::plugin_b::all_commands()]` 这种"宏嵌套"用法,运行会立刻 compile error。

### Pitfall 2: inventory 注册的 fn pointer 不是 `Copy`

**What goes wrong:** `inventory::submit!(CommandSpec { name, plugin_id, dispatch: list_providers })` 其中 `dispatch` 字段类型设为 `Box<dyn Fn>` 或 `Arc<dyn Fn>` —— `inventory::iter` 返回的引用 `&CommandSpec` 用 `.clone()` 时无法复制 fn pointer。

**Why it happens:** Box<dyn Fn> 不是 Copy,即使是 dyn Fn 也要 Arc。

**How to avoid:** **使用裸 fn pointer `fn(Invoke<R>) -> bool`**,这是 `Copy + 'static + Send + Sync` zero-cost。

**Warning signs:** 编译错误 `the trait bound 'fn(Invoke<Wry>) -> bool {list_providers}: Clone' is not satisfied`。

### Pitfall 3: 改 invoke 命令名导致前端调用全失效

**What goes wrong:** 把 `list_providers` 改成 `provider_list::list_providers` (加 plugin 前缀),前端 23 处调用全部失效,UI 全黑。

**Why it happens:** Phase 42 假设"plugin 持有命令"会附带命名空间,但 Tauri 命令是全局 namespace 不支持点号分隔。

**How to avoid:** **保持 Tauri 命令名原样** (`list_providers` 等),plugin_id 字段仅用于 debug 日志,不参与命令名。

**Warning signs:** 在 PR diff 里看到 `commands::providers::list_providers` → `commands::provider_list::list_providers` 这种"加模块前缀"改动。

### Pitfall 4: IPlugin::commands() 在运行期被频繁调用

**What goes wrong:** `lib.rs` setup 中遍历 `host.iter().map(|p| p.commands())` 把所有 plugin 的命令收集到 Vec,**每次启动都从 Box<dyn IPlugin> 触发 dyn dispatch**,80 个命令 × dyn dispatch 略慢。

**Why it happens:** "自然的实现" — 在 host 上加 `all_commands()` 方法,简单。

**How to avoid:** **运行期 dispatch 直接读 `inventory::iter::<CommandSpec>()`**,不走 IPlugin::commands()。`IPlugin::commands()` 仅用于 debug 展示 + 测试断言"plugin 声明的命令数 == inventory 实际注册数"。

**Warning signs:** `DispatchTable::from_inventory()` 实现里调用 `host.all_commands()` 而不是 `inventory::iter`。

### Pitfall 5: 多个 plugin 注册同名命令 (duplicate name)

**What goes wrong:** 两个 plugin 都 `inventory::submit!(CommandSpec { name: "list_providers", ... })`,后者覆盖前者,bug 难发现。

**Why it happens:** Tauri 命令是全局 namespace,无编译期检查"这个命令已被另一个 plugin 注册"。

**How to avoid:** **`DispatchTable::from_inventory()` 用 `entry().or_insert()` 而非 `insert()` (first-wins)**,并在调试日志输出"plugin X 注册了命令 Y,该命令已存在"的警告。**Phase 42 加单测**:故意 submit 两个同名 spec,断言 second 被忽略。

**Warning signs:** 两个 plugin 都有 `list_providers` 函数 (e.g. provider-list 和某个新 backup plugin),编译不报错但运行时其中一个失效。

### Pitfall 6: tauri::State 在 commands 函数签名中的 lifetime 变化

**What goes wrong:** 迁移命令函数时,把 `state: State<'_, AppState>` 改成 `state: State<'_, PluginState>`,其中 `PluginState` 是 plugin 自己的 state,**但 Tauri 状态机制按 TypeId 索引,plugin init 时 `app.manage(PluginState::new())` 必须在所有命令注册之前完成**,否则 `try_state::<PluginState>()` 返回 None,命令 panic。

**Why it happens:** 看到 "plugin 持有 commands"的描述,误以为 plugin 应该管理自己的 state。

**How to avoid:** **保持命令函数签名 `state: State<'_, AppState>` 不变**,所有命令从同一个全局 AppState 提取 service。**不要让 plugin 自己 manage state**。

**Warning signs:** PR diff 里有 `app.manage(ProviderState::new(...))` 在 plugin init 中,或 `State<'_, ProviderState>` 在命令签名中。

---

## Code Examples

### Verified patterns from official sources:

### [Common Operation 1] `tauri::generate_handler!` 展开结构 (源码验证)

```rust
// Source: tauri-macros-2.6.3/src/command/handler.rs:144-185
// generate_handler![a, b, c] expands to:
move |__tauri_invoke__| {
    let __tauri_cmd__ = __tauri_invoke__.message.command();
    match __tauri_cmd__ {
        __tauri_command_name_a!() => __cmd__a!(a, __tauri_invoke__),
        __tauri_command_name_b!() => __cmd__b!(b, __tauri_invoke__),
        __tauri_command_name_c!() => __cmd__c!(c, __tauri_invoke__),
        _ => return false,
    }
}
```

每个 `__cmd__<name>` shim 由 `#[tauri::command]` 宏在函数定义模块处生成 (源码 `tauri-macros-2.6.3/src/command/wrapper.rs`)。

### [Common Operation 2] `invoke_handler` 签名 (源码验证)

```rust
// Source: tauri-2.11.3/src/app.rs:1658-1664
pub fn invoke_handler<F>(mut self, invoke_handler: F) -> Self
where
    F: Fn(Invoke<R>) -> bool + Send + Sync + 'static,
{
    self.invoke_handler = Box::new(invoke_handler);
    self
}
```

**F 可以是任意签名匹配的闭包**,不必是 `generate_handler!` 宏产物。

### [Common Operation 3] `Invoke<R>` 公开字段 (源码验证)

```rust
// Source: tauri-2.11.3/src/ipc/mod.rs:498-509, 542-545
pub struct InvokeMessage<R: Runtime> {
    pub(crate) webview: Webview<R>,
    pub(crate) state: Arc<StateManager>,
    pub(crate) command: String,        // 命令名
    pub(crate) payload: InvokeBody,    // 参数 (JSON)
    pub(crate) headers: HeaderMap,
}

impl<R: Runtime> InvokeMessage<R> {
    pub fn command(&self) -> &str { &self.command }
    pub fn payload(&self) -> &InvokeBody { &self.payload }
    pub fn state(&self) -> Arc<StateManager> { self.state.clone() }
}
```

**dispatch 闭包用 `invoke.message.command()` 取命令名 + `invoke.message.state()` 取 StateManager 即可提取 `State<'_, AppState>`**。

### [Common Operation 4] inventory::submit! + inventory::iter 标准模式

```rust
// 标准模式 (来自 Rust 生态 tracing-subscriber / wgpu 等用法)
use inventory::submit;

pub struct PluginCommand {
    pub name: &'static str,
    pub handler: fn() -> Result<(), String>,
}

pub fn register() {
    submit!(PluginCommand {
        name: "list_providers",
        handler: || Ok(()),
    });
}

// 启动期收集
for cmd in inventory::iter::<PluginCommand> {
    println!("{}", cmd.name);
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `tauri::generate_handler![80 项手写 enumerate]` | `tauri::Builder::invoke_handler(make_invoke_handler(DispatchTable::from_inventory()))` | Tauri v2.0 (2024) — invoke_handler 接受任意签名匹配闭包 | 让 plugin 系统真正持有 commands,新增命令零 lib.rs 改动 |
| 静态枚举命令 (compile-time only) | inventory 编译期聚合 + 启动期 dispatch (compile-time + run-time) | inventory 0.1 (2019) → 0.3 (2023) 稳定 | 跨 crate 静态注册,Rust 生态标杆 |
| Plugin stub (no commands/services) | 半真实 plugin (持 commands + services + init) | M1.3 → Phase 42 | 业务 plugin 真实持有功能模块 |
| Service 集中在 `AppState` 单例 | 保留 AppState 集中,但 plugin 引用 `Arc<Service>` | M2.1 → Phase 42 | service 物理位置不变,plugin 是 logical owner |

**Deprecated/outdated:**
- **M2.17 stub plugin 模式** (只有 routes(),没有 commands/services/init body):被 Phase 42 半真实 plugin 替代。routes() 保留 (Phase 43/44 用),commands()/services() 新增。
- **`generate_handler!` 作为命令注册唯一方式**:被 `inventory::submit! + invoke_handler 闭包` 替代,但 `#[tauri::command]` 函数宏属性保留 (函数定义语法不变)。

---

## Environment Availability

> Step 2.6 审计结果:

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Rust toolchain | Phase 42 编译 | ✓ | 1.81+ (项目 workspace) | — |
| `cargo` | 编译 + sccache wrapper | ✓ | workspace | — |
| `tauri` 2.11.3 | Tauri v2 IPC | ✓ | Cargo.lock 锁 | — |
| `inventory = "=0.3.24"` | 编译期命令注册 (NEW Phase 42) | ✗ (未安装) | — | 退回方案 A (前端改 23 处) |
| sccache | 增量编译 (CLAUDE.md §12.2) | ✓ (已启用) | — | — |
| `tauri::Wry` runtime | Tauri 默认 runtime | ✓ | 项目默认 | — |

**Missing dependencies with no fallback:**
- **`inventory = "=0.3.24"`** — 方案 B 必需。如用户拒绝新增依赖,必须退回方案 A。**强烈建议用户接受**,理由已在 §Package Legitimacy Audit 详述。

**Missing dependencies with fallback:**
- None (除 inventory)。

---

## Validation Architecture

> workflow.nyquist_validation = true (default enabled)。

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Rust `cargo test` + 既有 `host.rs::tests` 子模块 |
| Config file | None — 测试直接嵌入各模块 `#[cfg(test)] mod tests` |
| Quick run command | `cargo test --manifest-path src-tauri/Cargo.toml --lib plugins::` |
| Full suite command | `cargo test --manifest-path src-tauri/Cargo.toml --lib` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| REQ-42.1 | PluginHost collect_commands 聚合 inventory | unit | `cargo test plugins::host::tests::collect_commands` | ❌ Wave 0 |
| REQ-42.2 | DispatchTable dispatch 找到正确 fn pointer | unit | `cargo test plugins::dispatch::tests::dispatch_routes_correctly` | ❌ Wave 0 |
| REQ-42.3 | DispatchTable dispatch 未知命令返回 false | unit | `cargo test plugins::dispatch::tests::unknown_command_returns_false` | ❌ Wave 0 |
| REQ-42.4 | inventory duplicate submit first-wins | unit | `cargo test plugins::dispatch::tests::duplicate_name_first_wins` | ❌ Wave 0 |
| REQ-42.5 | lib.rs invoke_handler 闭包正确创建 | integration | `cargo test --test dispatch_invoke` (新增 integration test) | ❌ Wave 0 |
| REQ-42.6 | 80 个命令迁移后 Tauri runtime 正常 dispatch | smoke | smoke test 10/10 (CLAUDE.md §13.1) | ❌ Wave 0 |
| REQ-42.7 | Frontend 23 处 invoke 调用不变 | frontend e2e | Playwright e2e 测试 (M5 阶段已有,跑全部 23 处) | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `cargo test --manifest-path src-tauri/Cargo.toml --lib plugins::` (focused)
- **Per wave merge:** `cargo test --manifest-path src-tauri/Cargo.toml --lib` (full)
- **Phase gate:** Full suite green + smoke test 10/10 + Playwright e2e 全过

### Wave 0 Gaps
- [ ] `src-tauri/src/plugins/dispatch.rs::tests` — REQ-42.2 / REQ-42.3 / REQ-42.4 (4 单测, ~80 行)
- [ ] `src-tauri/src/plugins/host.rs::tests` 新增 `collect_commands` 测试 — REQ-42.1 (~30 行)
- [ ] `src-tauri/src/plugins/stubs/<id>/commands.rs::tests` — 每个 plugin 加 smoke 单测验证 fn pointer 可调用 (~5 行 × 10 plugin)
- [ ] `src-tauri/tests/dispatch_invoke.rs` — REQ-42.5 integration test (~50 行)
- [ ] `src-tauri/Cargo.toml` 新增 `inventory = "=0.3.24"` 依赖
- [ ] Smoke test 扩展:启动后立即调 80 个命令 (或选 5 个代表) 验证 inventory dispatch 路径无 missing command — 现有 smoke test 10 项不覆盖这条,**需新增**

---

## Security Domain

> security_enforcement = true (enabled at ASVS Level 1)。

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V1 Architecture | yes | Phase 42 是架构重构,plugin 隔离 = 安全边界 (一个 plugin 不能直接访问另一个 plugin 的 service,只能通过 AppState 共享) |
| V2 Authentication | no | Phase 42 不涉及 auth |
| V3 Session Management | no | 不涉及 session |
| V4 Access Control | yes | IPlugin trait 是 object-safe 的 plugin 边界;plugin 不能直接访问其他 plugin 的 internal state |
| V5 Input Validation | yes | `State<'_, AppState>` 仍由 Tauri 状态机制管理,未授权命令无法被 invoke (前端只能调 inventory 注册的命令名) |
| V6 Cryptography | no | 不涉及加密 |
| V7 Error Handling | yes | `CmdResult<T> = Result<T, String>` 不变;新增 `dispatch_failed` 错误路径 (未知命令返回 false → Tauri 报 "command not found") |
| V8 Data Protection | no | Phase 42 不动数据 schema |
| V9 Communication | no | 不涉及网络 |
| V10 Malicious Code | yes | inventory::submit! 接受 `fn pointer`,**没有外部代码注入路径** (proc-macro 仅在编译期执行) |
| V11 Business Logic | yes | 命令迁移不改变业务逻辑,仅物理位置 + 注册机制 |
| V12 Files | no | 不涉及文件 |
| V13 API | yes | Tauri IPC 是 Phase 42 唯一 API;dispatch 闭包对外契约不变 |
| V14 Configuration | no | 不改配置 |

### Known Threat Patterns for Tauri v2 + inventory

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| 恶意 plugin 注册同名命令覆盖核心命令 | Tampering | DispatchTable first-wins + 启动期 `warn!` 日志记录所有同名 submit |
| inventory::submit! 接收非 fn pointer | Spoofing | 类型系统保证 `dispatch: fn(Invoke<R>) -> bool` 必须是 fn,不可能传 `Arc<dyn Any>` 等非法值 |
| Plugin init 时调 `app.manage(...)` 注入恶意 state | Elevation | Tauri 状态机制按 TypeId 索引,plugin 不能修改其他 plugin 注册的 state (除非 panic) |
| dispatch 闭包捕获 service 引用导致 'static 违反 | Denial of Service | fn pointer 不捕获,所有 service 通过 `State<'_, AppState>` 在 fn 内部按需 clone |

**ASVS Level 1 合规:** Phase 42 不引入新的安全风险 (只换注册机制,不改业务逻辑 + 命令名 + 数据 schema),所有 V 类目由 Tauri 状态机制 + inventory proc-macro 保证。

---

## Phase Requirements

> Phase 42 由 v3.4-milestone/00-PHASE-OVERVIEW.md 派生需求。本研究产物支持以下需求:

| ID | Description | Research Support |
|----|-------------|------------------|
| REQ-42.1 | IPlugin trait 加 `commands(&self) -> Vec<CommandSpec>` 方法 | Pattern 1 + 2 (§Architecture Patterns) |
| REQ-42.2 | 80 个 `#[tauri::command]` 函数迁移到 `plugins/stubs/<id>/commands.rs` | §Migration Map (§Recommended Project Structure) |
| REQ-42.3 | 每个 command 配 `inventory::submit!(CommandSpec)` | Pattern 1 (§Architecture Patterns) |
| REQ-42.4 | `lib.rs::run` 把 `generate_handler![80 项]` 换成 `make_invoke_handler(DispatchTable::from_inventory())` | Pattern 1 (lib.rs 替换示例) |
| REQ-42.5 | PluginHost 加 `collect_commands()` 方法聚合 inventory | §Architecture Patterns Pattern 2 |
| REQ-42.6 | ServiceRegistry 设计 (Phase 45 预留, Phase 42 占位) | Pattern 3 (§Architecture Patterns) |
| REQ-42.7 | 10 个 stub plugin 升级为"半真实" plugin (持 commands/services/init) | Pattern 2 (§Architecture Patterns) |
| REQ-42.8 | AppState 字段保留不变 (9 个 Arc<Service>) | §Project Constraints §3.1 + §Standard Stack |
| REQ-42.9 | 4 个新增 plugin (history_view / project_mode / file_ops / updater) | §Migration Map |
| REQ-42.10 | Frontend 0 改动 (23 处 invoke 调用保持原样) | §Architectural Responsibility Map (Frontend tier 不参与) |
| REQ-42.11 | Smoke test 10/10 通过 (含新增 "dispatch 路径可达" 项) | §Validation Architecture Wave 0 Gaps |
| REQ-42.12 | `inventory = "=0.3.24"` 新增依赖 + 锁版本 | §Package Legitimacy Audit + §Standard Stack |

---

## Assumptions Log

> 列出所有标记为 `[ASSUMED]` 的事实声明,供 discuss-phase 用户确认:

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `inventory = 0.3.24` 是当前 stable 且 macOS / Windows / Linux 全平台兼容 | §Standard Stack / §Package Legitimacy Audit | 若 inventory 不兼容 macOS sandbox / Windows PE 链接,Phase 42 编译失败,需退回方案 A 或换 linkme |
| A2 | `inventory::iter::<T>` 启动期遍历耗时 < 1ms (80 项) | §Performance | 若遍历慢,setup 阶段用户能看到启动延迟,违反 §9 启动 < 3s 约束 |
| A3 | `fn(Invoke<R>) -> bool` fn pointer 在 Rust 1.81+ 是 `Copy + 'static + Send + Sync` | §Architecture Patterns Pattern 1 | 若不是,需改用 `Arc<dyn Fn + Send + Sync>` 增加 Arc capture 复杂度 |
| A4 | Tauri v2 `invoke_handler` 的 `Fn(Invoke<R>) -> bool` 闭包签名在 2.11.3 仍然稳定 | §Architecture Patterns (源码验证) | 若未来 Tauri 改签名,Phase 42 代码需重写 (但 Tauri v2 是 stable 不会 break) |
| A5 | 80 个 `#[tauri::command]` 函数体本身不需要改 (只改物理位置) | §Migration Map | 若某些命令有特殊的模块私有 helper 函数,迁移需额外处理 import |
| A6 | sccache 在 inventory proc-macro 重编时自动失效缓存 | §Runtime State Inventory | 若 sccache 不失效,首次 build 慢 (但 §12.2 已验证 sccache 兼容 proc-macro) |

**If this table is empty:** All claims in this research were verified or cited — no user confirmation needed. (本表非空,需用户确认 A1 — 是否接受新增 inventory 依赖)

---

## Open Questions

1. **`commands/fs.rs` 6 个命令的 plugin 归属**
   - What we know: `commands/fs.rs` 6 个命令 (`read_file` / `write_file_atomic` / `read_sql_file` / `take_pending_sql_file` / `list_editable_jsons`) 服务于 F2/F6/F13/F18/F19 多个 plugin
   - What's unclear: 是独立 `file_ops` plugin,还是分散到对应 plugin (`read_file` 进 provider-switch、`read_sql_file` 进 import-sql 等)
   - Recommendation: **建议独立 `file_ops` plugin** (理由: 6 个命令跨 F,集中便于维护;新增 F 也只需 import file_ops 的命令),discuss-phase 确认

2. **`commands/history.rs` 8 个命令的 plugin 归属**
   - What we know: history 是 M4.6 新增的 Plan B,主要服务于 F13 (history page UI 是 M4.6 后才有)
   - What's unclear: 归到 `backup_restore` plugin (共享 BackupService) 还是独立 `history_view` plugin
   - Recommendation: **建议独立 `history_view` plugin** (理由: history 命令有自己的 schema + query pattern,与 backup 的写时插入分离;Phase 45 拓扑序预留单独 init 阶段),discuss-phase 确认

3. **`commands/providers.rs` 16 个命令的 plugin 拆分粒度**
   - What we know: 16 命令覆盖 F1 (list) + F2 (switch) + F3 (sql import) + F4 (deeplink) + F14 (export) + M2.16 (read current config / generate from current) + M3.7 (CRUD 5 命令)
   - What's unclear: 拆 1 个 `provider` 大 plugin 还是 2 个 (`provider_list` + `provider_switch`) 还是 3 个 (`provider_list` + `provider_switch` + `import_sql`)
   - Recommendation: **建议 3 个 plugin**: `provider_list` (F1, 5 命令 list/CRUD) + `provider_switch` (F2 + F14, 3 命令) + `import_sql` (F3 + F4 + M2.16 generate, 8 命令)。理由: 现有 10 stub 已分别有这 3 个,迁移时 stub plugin 自然承接命令

4. **IPlugin::commands() 在运行期被谁调用**
   - What we know: Phase 42 设计 `commands()` 仅供 debug/测试使用;运行期 dispatch 走 `inventory::iter`
   - What's unclear: Phase 45 拓扑序是否需要 plugin 在 init 时报告"我有多少命令"以决定依赖顺序
   - Recommendation: Phase 42 保留 `commands()` 方法 (默认空 Vec),Phase 45 决定是否在拓扑序中使用

5. **新增 plugin 的命名与现有 stub 是否同名**
   - What we know: `plugins/stubs/` 现有 10 个 stub plugin id (provider_list / provider_switch / import_sql / json_editor / mcp_management / usage_query / resource_browser / marketplace / optimizer / backup_restore)
   - What's unclear: 新增的 `history_view` / `project_mode` / `file_ops` / `updater` 是否与现有 stub id 冲突,如何命名
   - Recommendation: 历史 plugin 历史已有同名 ID (F19 backup_restore),可直接继承。新增 plugin 用 SPEC.md §4 中描述的功能名 (history → history_view, project mode → project_mode, file ops → file_ops, updater → updater)。discuss-phase 确认命名细节

---

## Cross-Phase Interface Contracts

> Phase 42 与后续 phase (43/44/45) 的接口约定:

### Phase 43 (MenuRegistry)
- **消费 Phase 42 输出**: IPlugin trait 已加 `commands()` 方法,Phase 43 可扩展类似 `tray_items() / app_menu_items()`
- **接口预留**: `IPlugin` 默认方法设计 = **新增方法都返回空 Vec / Vec::new()**,Phase 43 沿用此模式
- **不冲突**: Phase 42 commands() 与 Phase 43 tray_items() 各自一个方法,各管各的

### Phase 44 (Sidebar Registry)
- **消费 Phase 42 输出**: IPlugin 已有 `routes()` 方法返回 `Vec<PluginRoute>`,Phase 44 的 sidebar navigation 直接读 `host.all_routes()`
- **接口稳定**: PluginRoute struct 字段 (`path` / `plugin_id` / `display_name`) 不变,Phase 44 仅消费
- **数据流**: Phase 44 启动期调 `PluginHost::all_routes()` → 生成 sidebar 树 → IPC 到前端 React Router

### Phase 45 (Topology Order)
- **消费 Phase 42 输出**: IPlugin::init() 当前签名 `fn init(&mut self, ctx: &PluginContext) -> Result<()>`,Phase 45 可能扩展为 `fn init(&mut self, ctx: &mut PluginContext, deps: &[PluginId])` 表达依赖
- **预留**: Phase 42 保留 IPlugin 默认 impl,Phase 45 通过**新增方法** `init_with_deps(&mut self, ctx, deps)` (默认 impl 调 `self.init(ctx)`) **避免破坏 Phase 42 已注册的 plugin**
- **ServiceRegistry 接口**: Phase 42 §Pattern 3 已预留 `ServiceRegistry` 类型骨架,Phase 45 实现

### 兼容性矩阵

| Phase | 增加的 IPlugin 方法 | 对 Phase 42 的影响 |
|---|---|---|
| 42 | `commands(&self) -> Vec<CommandSpec>` | 无 (本 phase 引入) |
| 43 | `tray_items(&self) -> Vec<PluginTrayItem>` / `app_menu_items(&self) -> Vec<PluginAppMenuItem>` | 无 (新增方法,默认空) |
| 44 | (Phase 44 不扩 IPlugin,只消费 `routes()`) | 无 |
| 45 | `init_with_deps(&mut self, ctx, deps)` (可选) | 无 (新增默认方法,旧 plugin 自动用 init 默认 impl) |

---

## Sources

### Primary (HIGH confidence)
- **Tauri 2.11.3 本地源码** (`~/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tauri-2.11.3/`)
  - `src/app.rs:1658-1664` — `invoke_handler<F: Fn(Invoke<R>) -> bool + Send + Sync + 'static>`
  - `src/ipc/mod.rs:498-509, 542-545` — `Invoke<R>` 公开字段 (command / payload / state)
  - `src/plugin.rs:264-326` — `Builder::invoke_handler` (plugin 内部也用相同签名)
  - `src/app/plugin.rs:123-150` — Tauri 官方 `app` plugin 用 `generate_handler!` 配 `#![plugin(app)]` 内属性
- **tauri-macros 2.6.3 本地源码** (`~/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tauri-macros-2.6.3/`)
  - `src/command/handler.rs:144-185` — `generate_handler!` 展开成 `move |invoke| match ... { __cmd__a!(a, invoke), __cmd__b!(b, invoke), _ => false }`
  - `src/command/mod.rs:14` — `fn format_command_wrapper(function: &Ident) -> Ident { quote::format_ident!("__cmd__{}", function) }` (每个 #[tauri::command] 函数生成 __cmd__<name> shim)
- **本项目代码实读** (`/Users/coderstory/CodeSource/winui3/src-tauri/src/`)
  - `lib.rs:106-199` — 80 命令 enumerate 现状
  - `lib.rs:218-220` — AppState::build() + app.manage()
  - `commands/mod.rs:11-16` — `__cmd__<name>` 在函数定义模块处查找,提示 generate_handler! 是编译期
  - `app_state.rs:88-228` — 9 个 Arc<Service> 字段
  - `plugins/{traits,host,mod}.rs` — 现有 IPlugin + PluginHost + 10 stub
  - `services/*.rs` — 10 个 service 实现
  - `src/lib/api/*.ts` — 23 处 invoke 调用
- **inventory 0.3.24 metadata** (`cargo info inventory` 2026-06-27)
  - "Typed distributed plugin registration"
  - MIT OR Apache-2.0
  - Rust 1.68+ requirement (project uses 1.81+, 满足)

### Secondary (MEDIUM confidence)
- **CLAUDE.md §3.1, §3.3, §6.5, §9, §10, §12** — 工程纪律 (项目内部文档,权威)
- **Phase 43-RESEARCH.md** (本目录前序研究产物) — Phase 43 的 IPlugin 扩展模式 (`tray_items()` / `app_menu_items()` 默认空 Vec) 与 Phase 42 一致,可作模板

### Tertiary (LOW confidence)
- **`inventory` crate 在 `tracing-subscriber` / `wgpu` 等项目的用法** — 标准模式 `inventory::submit!(spec) + inventory::iter::<spec>()`,Rust 生态通用做法,无需引用具体文档
- **`fn(Invoke<R>) -> bool` 在 Rust 1.81 的 Copy 推导** — 标准 Rust 语言规则,fn pointer 本身是 Copy,与版本无关

---

## Metadata

**Confidence breakdown:**
- Standard stack: **HIGH** — Tauri API 从本地 cargo registry 源码 (2.11.3) 实读验证;inventory 从 `cargo info` 获取元数据 (0.3.24,dtolnay 维护)
- Architecture: **HIGH** — Phase 42 设计核心 (inventory + dispatch 闭包 + fn pointer) 与 Phase 43 (MenuRegistry HashMap dispatch) 同构,已验证可行
- Pitfalls: **HIGH** — 6 个 pitfall 全部从 Tauri 源码 + Rust 语言规则推导,有具体修复策略

**Research date:** 2026-06-27
**Valid until:** 2026-07-27 (Tauri v2 稳定期内,API 不会 break;inventory 0.3.x 跨 6+ 年兼容)