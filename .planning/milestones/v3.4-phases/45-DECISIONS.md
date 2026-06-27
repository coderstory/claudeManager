---
gsd_decisions_version: 1.0
phase: 45
decided: 2026-06-27
decided_by: discuss-phase subagent (待用户复核)
based_on: ../v3.4-DECISIONS.md (5 BLOCKING 关闭) + ./45-RESEARCH.md Open Questions
---

# Phase 45 DECISIONS

> 关闭 Phase 45 剩余 G1-G10。5 BLOCKING 见 ../v3.4-DECISIONS.md (继承 D-45-A: ServiceRegistry Arc 路径; D-CC-A: PluginContext 4 字段 + &mut init).

## 已关闭决策 (继承)

- **D-45-A**: ServiceRegistry Arc 路径 `register_arc<T>(svc: Arc<T>)` + `get<T>() -> Option<Arc<T>>`
- **D-CC-A**: PluginContext 4 字段 + &mut init

## Phase 45 剩余 G1-G10 关闭

### G1 (D-45-A 关闭): ServiceRegistry Arc 路径
见 ../v3.4-DECISIONS.md; Phase 42 ship 后必须 verify API, 不一致加 5 行 API.

### G2: `services()` 返回值
- **决策**: 全空 vec
- **理由**: service plugin 的 service 需运行时构造 (依赖 IO), 静态描述不适用; PluginHost::all_services() Phase 45 不被使用
- **影响**: 9 service plugin (history/backup/provider/usage/mcp/optimizer/resource/marketplace/project) services() = vec![]

### G3: history_db backfill 位置
- **决策**: history-service::init (移到 plugin init)
- **理由**: AppState::build 保持纯路径解析 + ensure_dirs, 无 IO 重活; service 自管 IO 原则统一
- **影响**: app_state.rs:101-153 history_db 逻辑整段迁出; history-service init 内 open_history_db → fallback open_in_memory_db → fallback raw Connection; 失败 best-effort log warn

### G4: `get_service!` macro 还是 method
- **决策**: `get_service!` macro
- **理由**: macro 编译期展开类型安全; 80 处替换 pattern 一致; 错误信息 string 化友好
- **影响**: commands/macros.rs (NEW) 定义 macro; 28 处 `state.<svc>_service.xxx` → `let svc = get_service!(state, SvcType); svc.xxx`

### G5: DFS 还是 Kahn
- **决策**: DFS 3 色标记
- **理由**: cycle 错误信息自带路径, 开发者 1 秒定位; 9 节点规模足够; 0 新增依赖 (符合 §2.3)
- **影响**: plugins/topological.rs (NEW) DFS 函数 ~50 行 + 4 单测 (DAG/cycle/缺依赖/多依赖); PluginHost 加 init_all_topological, 旧 init_all 保留 fallback

### G6 (D-CC-A 关闭): PluginContext &mut init
见 ../v3.4-DECISIONS.md; `init(&mut self, ctx: &mut PluginContext) -> Result<(), PluginError>`.

### G7: 业务 plugin depends_on 补全时机
- **决策**: Phase 45-03 同步补 (在 service plugin 抽离后)
- **理由**: 9 业务 plugin (Phase 42 已 ship) 的 depends_on 必须在 Phase 45 加; 推迟到 Phase 47 风险: 编译过但运行时 panic
- **影响**: 9 业务 stub 各加 `fn depends_on() -> Vec<&'static str>` 1 行; 拓扑图 (详见 PLAN 阶段约束 §9)

### G8: services() 静态 vs 动态
- **决策**: 全动态 (与 G2 一致)
- **理由**: 9 节点规模不需要 deferred PluginServiceDef
- **影响**: 同 G2

### G9: history-service 失败时
- **决策**: best-effort (沿用现状)
- **理由**: app_state.rs 已有 3 层 fallback 链, 不破坏现有行为; 硬失败让 disk 损坏用户无法启动, 违反 §10
- **影响**: history-service::init 保留 3 层 fallback; 任何 IO 失败 log warn + 继续; 永远 register_arc 成功

### G10: 拓扑序稳定排序
- **决策**: HashMap 迭代序 + 单测覆盖
- **理由**: 9 节点 HashMap 迭代序 deterministic; 显式 sort 增加 5 行 + 排序 O(n log n) 重复; 测试覆盖锁死具体顺序
- **影响**: 单测断言 topo_sort 返回顺序 = [history-service, backup-service, usage-service, mcp-service, optimizer-service, resource-service, marketplace-service, project-service, provider-service]

## 推迟到 Phase 47

- **PluginServiceDef 静态描述恢复 (G2/G8)**: 9 业务 plugin 可填 services() (facade) 但 Phase 45 不强求
- **app.manage 时机再优化 (G7)**: Phase 45 推迟 manage 到 init 后让 Arc::get_mut 可用
- **9 service plugin 的 depends_on 微调 (G10)**: 拓扑序由单测锁死

## PLAN 阶段必须实现的接口约束

### 1. ServiceRegistry API (D-45-A Arc 终态, plugins/service_registry.rs)

```rust
pub struct ServiceRegistry { map: HashMap<TypeId, Box<dyn Any + Send + Sync>> }
impl ServiceRegistry {
    pub fn new() -> Self;
    pub fn register_arc<T: 'static + Send + Sync>(&mut self, svc: Arc<T>);  // Arc 包装
    pub fn get<T: 'static + Send + Sync>(&self) -> Option<Arc<T>>;  // 返回 Arc, 非 &T
    pub fn contains<T: 'static>(&self) -> bool;
    pub fn count(&self) -> usize;
}
```

### 2. IPlugin::depends_on (Phase 45 加, 默认空 vec)

```rust
fn depends_on(&self) -> Vec<&'static str> { Vec::new() }
```

### 3. PluginContext 4 字段 (D-CC-A)

`app` + `paths` + `host: Option<&'a PluginHost>` + `services: Option<&'a mut ServiceRegistry>`

### 4. 9 service plugin 文件结构

```
src-tauri/src/plugins/
├── topological.rs                 # NEW: DFS + 4 单测
├── history-service/mod.rs         # NEW: deps []
├── backup-service/mod.rs          # NEW: deps [history-service]
├── provider-service/mod.rs        # NEW: deps [backup-service, history-service]
├── usage-service/mod.rs           # NEW: deps [history-service]
├── mcp-service/mod.rs             # NEW: deps []
├── optimizer-service/mod.rs       # NEW: deps []
├── resource-service/mod.rs        # NEW: deps []
├── marketplace-service/mod.rs     # NEW: deps []
└── project-service/mod.rs         # NEW: deps []
```

### 5. AppState 缩到 < 50 行

```rust
pub struct AppState {
    pub paths: AppPaths,
    pub service_registry: Arc<ServiceRegistry>,  // NEW
    pub pending_sql_file: Mutex<Option<String>>,
    pub updater_pubkey: String,
    pub updater_endpoints: Vec<String>,
}
```

### 6. lib.rs::setup 启动顺序 (推迟 app.manage)

```rust
platform::init_for_runtime();
let paths_impl = platform::runtime::paths();
let paths = paths_impl.resolve();
let _ = paths_impl.ensure_dirs();
let state = AppState::build();  // refcount=1
let mut host = PluginHost::new();
// ... register 9 service + 9 业务 plugin ...
let mut plugin_ctx = PluginContext::new(app.app_handle(), &*paths_impl, &state);
host.init_all_topological(&mut plugin_ctx)?;  // refcount=1, Arc::get_mut OK
app.manage(state);  // refcount=2 (Tauri 也持)
app.manage(Mutex::new(host));
```

### 7. PluginHost::init_all_topological

调 `topological::topo_sort(&self.plugins)?` → 按序 `plugin.init(ctx)?`

### 8. 80 commands 取依赖改造 (28 处)

state.<svc>_service.xxx → let svc = get_service!(state, SvcType); svc.xxx; providers 9 / history 6 / resource 3 / usage 3 / mcp 2 / project 2 / backup 1 / marketplace 1 / optimizer 1 = 28.

### 9. 业务 plugin (Phase 42) depends_on 补全 (9 处)

```
provider-list → ["provider-service"]
import-sql → ["provider-service", "history-service"]  (可能)
json-editor → []
mcp-management → ["mcp-service"]  (Phase 46 删)
usage-query → ["usage-service"]
resource-browser → ["resource-service"]
marketplace → ["marketplace-service"]
optimizer → ["optimizer-service"]
backup-restore → ["backup-service", "history-service"]
```

## 强验收 (Phase 47 验证)

- AppState 0 个 Arc<crate::services> 字段 (grep lint)
- commands/*.rs 0 行 state.<svc>_service. 访问 (grep lint)
- cargo test topological::tests::topo_sort_dag/cycle/missing/multi 4 项 PASS
- cargo test plugins::host::tests::init_all_topological 4 项 PASS
- 9 service plugin 各自 init 成功 + backup 拿到 history Arc + provider 拿到 backup+history Arc
- smoke test 10/10 PASS
- "加 1 service 只动 1 文件" 强验收
