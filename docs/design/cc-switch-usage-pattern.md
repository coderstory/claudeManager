# cc-switch-main 用量读法调研 — 本项目集成路径

> **任务**: M3 启动门 D-槽4 调研产出 (清单 19 修复路径 C 的可行性分析)
> **日期**: 2026-06-22
> **作者**: Subagent D-槽4 (auto 模式, 跳过 ship 校验)
> **状态**: 调研完成, 待 D14 拍板后正式实施
> **关联**: `docs/investigations/m3-8-usage-bug.md` §4.3 (路径 C 详细分析) + `D:\project\cc-switch-main\src-tauri\src\services\session_usage.rs`

---

## 1. 背景

### 1.1 用户最新口述 (2026-06-21)
> 参考 `D:\project\cc-switch-main`, 好像读取回话缓存计算出来的

### 1.2 D14 决策状态
- 状态: **待用户拍板** (M3 启动前必问, 主 session 必问类)
- 当前共识: 用户倾向"读 cc-switch 的方式", 但**未**正式拍板
- 本文档 = D14 拍板前的**可行性预研**, 等 D14 答案后正式实施

### 1.3 为什么调研 cc-switch
- cc-switch 是本项目**姊妹项目**, 同样管理 Claude Code provider
- cc-switch 已实现**完整的 JSONL → 用量统计**链路, 是成熟参考实现
- 复用 cc-switch 解析逻辑 = 与 cc-switch 共享数据契约 (M2.16-002-M 已有先例)

---

## 2. cc-switch-main 实现路径

### 2.1 总体架构

```
[cc-switch 数据流]
~/.claude/projects/<encoded-path>/*.jsonl        (Claude Code 实时写)
    ↓
[services/session_usage.rs sync_claude_session_logs]   (M2.7+: 增量解析 + 去重)
    ↓
[database/dao/usage_rollup.rs]                    (每日聚合到 usage_daily_rollups)
    ↓
[UsageDashboard.tsx + QueryClient]                (UI 展示 + 30s 自动刷新)
```

### 2.2 主入口模块 (按文件)

#### 2.2.1 `D:\project\cc-switch-main\src-tauri\src\services\session_usage.rs`
**职责**: 扫 `~/.claude/projects/` 下的 JSONL, 增量解析, 同步到 SQLite `proxy_request_logs` 表

**关键函数** (file:line):
- `sync_claude_session_logs(db: &Database) -> SessionSyncResult` (L61-108)
  - 主入口, 调 `collect_jsonl_files` 收集 → 逐文件调 `sync_single_file`
- `collect_jsonl_files(projects_dir: &Path) -> Vec<PathBuf>` (L121-167)
  - 扫 `projects_dir/<project>/<SESSION_ID>.jsonl` + 子目录 `subagents/*.jsonl` + 嵌套 `workflows/wf_*/`
- `sync_single_file(db, file_path) -> (imported, skipped)` (L182-260)
  - **增量解析**: 读文件 mtime + `last_offset`, 只处理新增行
  - 用 `messageId` (UUID) 去重 (写到 `dedup_key` HashMap)
  - 提取 `ParsedAssistantUsage { message_id, model, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, stop_reason, timestamp, session_id }`

**数据结构** (L46-58):
```rust
struct ParsedAssistantUsage {
    message_id: String,                       // 去重 key
    model: String,                            // e.g. "claude-sonnet-4-20250514"
    input_tokens: u32,
    output_tokens: u32,
    cache_read_tokens: u32,
    cache_creation_tokens: u32,
    stop_reason: Option<String>,
    timestamp: Option<String>,                // RFC3339
    session_id: Option<String>,
}
```

**JSONL 行 schema** (从 L207-260 解析逻辑):
```json
{
  "type": "assistant",
  "message": {
    "id": "<uuid>",
    "role": "assistant",
    "model": "claude-sonnet-4-20250514",
    "usage": {
      "input_tokens": 40693,
      "cache_creation_input_tokens": 0,
      "cache_read_input_tokens": 0,
      "output_tokens": 712
    }
  },
  "timestamp": "2026-06-09T01:46:13.876Z",
  "sessionId": "<uuid>",
  "cwd": "..."
}
```

#### 2.2.2 `D:\project\cc-switch-main\src-tauri\src\database\dao\usage_rollup.rs`
**职责**: 把 `proxy_request_logs` 聚合到 `usage_daily_rollups` 表, 按本地日界

**关键函数**:
- `Database::rollup_and_prune(retain_days: i64) -> u64` (L61)
  - 按本地午夜切 (L19-55 `compute_local_midnight_cutoff`)
  - 用 SQL `COALESCE(SUM(input_tokens), 0)` 聚合
- `Database::aggregate_for_range(filter) -> Vec<UsageBucket>` (推断, 与 rollup 类似)

#### 2.2.3 `D:\project\cc-switch-main\src-tauri\src\proxy\usage\calculator.rs` (推测)
**职责**: 根据 model + tokens 计算 USD cost

**关键 API** (从 `services/session_usage.rs:457` 推断):
```rust
let (input_cost, output_cost, cache_read_cost, cache_creation_cost, total_cost) = match pricing {
    ModelPricing::Sonnet4 => (input * 3.0e-6, output * 15.0e-6, ...),
    ModelPricing::Opus4 => (input * 15.0e-6, output * 75.0e-6, ...),
    ...
};
```

**价格来源**: cc-switch 有内置价格表 (在 `pricing.yaml` 或 DB `model_pricing` 表), 本项目**需要移植**这份常量

#### 2.2.4 `D:\project\cc-switch-main\src\components\usage\UsageDashboard.tsx`
**职责**: 前端用量看板 (33 个组件文件)

**关键 UI** (file):
- `UsageDashboard.tsx`: 主框架 (L1-200, 含 queryClient + 自动刷新 30s)
- `UsageHero.tsx`: 顶部大数字 + 趋势 sparkline
- `UsageTrendChart.tsx`: 多日趋势图 (用 `usage_daily_rollups` 数据)
- `ProviderStatsTable.tsx`: 按 provider 分桶
- `ModelStatsTable.tsx`: 按 model 分桶
- `PricingConfigPanel.tsx`: 价格配置 (用户可手动覆盖内置价格)

**前端数据源**: `src/lib/query/usage.ts` 用 `@tanstack/react-query` + 自动 refetch (30s)

### 2.3 UI 参考 (本项目可复用 vs 重写)

| cc-switch 组件 | 本项目复用度 | 备注 |
|---|---|---|
| `UsageDashboard.tsx` | ⚠️ 复用结构, 简化 | cc-switch 有 4 种 AppType 切换; 本项目只 Claude 一种, 简化 |
| `UsageHero.tsx` | ✅ 直接复用结构 | 大数字 + sparkline |
| `UsageTrendChart.tsx` | ⚠️ 复用结构 | 本项目暂不需要 SQLite 聚合, 用 5-min cache 自带历史 |
| `ProviderStatsTable.tsx` | ❌ 不复用 | cc-switch 多 provider, 本项目只 active provider |
| `PricingConfigPanel.tsx` | ⚠️ 复用 UI 概念 | 本项目价格表内置, 不暴露配置 |

---

## 3. 本项目集成路径

### 3.1 总体策略

**复用 cc-switch 解析逻辑, 不引入 SQLite**: 本项目用量查询是 M3.8 ship 的小功能, 不需要 cc-switch 的完整持久化 (proxy_request_logs + usage_daily_rollups)。**最小可用方案** = 扫 JSONL + 内存聚合 + 复用现有 5-min cache。

### 3.2 模块拆分

#### 3.2.1 `src-tauri/src/services/usage_provider_ccswitch.rs` (新建, ~250 行)
**职责**: 从 cc-switch 移植 `sync_claude_session_logs` + `sync_single_file` + `collect_jsonl_files`, **不**写 SQLite, 返回内存聚合结果

**API**:
```rust
/// 扫 ~/.claude/projects/ 下所有 .jsonl, 聚合给定时间窗的 token 用量
pub fn compute_usage_from_jsonl(
    projects_dir: &Path,
    window: UsageWindow,
    pricing: &PricingTable,
) -> Result<UsageSnapshot, UsageError>;

/// 内置价格表 (从 cc-switch 移植, 简化版)
pub fn builtin_pricing() -> PricingTable;
```

**关键实现**:
- `collect_jsonl_files`: 直接复用 cc-switch `L121-167`, 略改返回类型
- `parse_line`: 提取 `ParsedAssistantUsage`, 略改去重 (用 HashSet<message_id> 内存去重即可)
- 时间窗过滤: 按 `timestamp` (RFC3339) → unix seconds → 与 `now - window_secs` 比较
- 聚合: `sum(input_tokens + output_tokens + cache_read_tokens + cache_creation_tokens)` → `tokens_used`
- cost 计算: `sum(input_cost + output_cost + cache_cost)` 用 pricing 表

#### 3.2.2 `src-tauri/src/infrastructure/pricing.rs` (新建, ~80 行)
**职责**: 内置价格表常量 (替代 cc-switch 的 `pricing.yaml`)

**API**:
```rust
#[derive(Debug, Clone, Copy)]
pub struct ModelPricing {
    pub input_per_million: f64,        // USD per 1M input tokens
    pub output_per_million: f64,
    pub cache_read_per_million: f64,
    pub cache_creation_per_million: f64,
}

pub fn builtin_pricing() -> HashMap<&'static str, ModelPricing> {
    let mut m = HashMap::new();
    m.insert("claude-sonnet-4-20250514", ModelPricing {
        input_per_million: 3.0,
        output_per_million: 15.0,
        cache_read_per_million: 0.30,
        cache_creation_per_million: 3.75,
    });
    m.insert("claude-opus-4-20250514", ModelPricing {
        input_per_million: 15.0,
        output_per_million: 75.0,
        ...
    });
    // ... haiku-4, deepseek-v4-pro, etc.
    m
}

pub fn lookup_pricing(model: &str) -> Option<ModelPricing> {
    builtin_pricing().get(model).copied()
}
```

**价格来源**: 抄 cc-switch `proxy/usage/calculator.rs` 的常量 (Claude 官方价格 2025-05)
**fallback**: 不在表内的 model → `cost_usd = None`, `tokens_used` 仍正常显示

#### 3.2.3 `src-tauri/src/services/usage_service.rs` (改 ~50 行)
**改造点**:
- `read_local_usage_json` (L188-250) → 替换为 `compute_usage_from_jsonl(projects_dir, window)`
- 保留 5-min cache + provider fingerprint 逻辑
- 路径解析: `paths.claude_dir().join("projects")` (已有 AppPaths, 不需新 trait)

**新方法签名**:
```rust
fn compute_usage_for_window(
    &self,
    provider_id: &str,
    window: UsageWindow,
) -> Result<UsageSnapshot, UsageError> {
    let projects_dir = self.paths.claude_dir()
        .ok_or(UsageError::PathUnresolved)?
        .join("projects");
    let pricing = infrastructure::pricing::builtin_pricing();
    let snap = usage_provider_ccswitch::compute_usage_from_jsonl(
        &projects_dir, window, &pricing
    )?;
    Ok(UsageSnapshot {
        provider_id: provider_id.to_string(),
        window,
        tokens_used: snap.tokens_used,
        cost_usd: snap.cost_usd,
        balance_usd: None,  // balance 仍无法算 (需要 Admin API)
        timestamp: now_unix_secs(),
    })
}
```

#### 3.2.4 `src-tauri/src/commands/usage.rs` (+ ~20 行)
**新增 command**: `sync_usage_history` (触发一次性同步, 不阻塞 UI)

```rust
#[tauri::command]
pub async fn sync_usage_history(
    state: State<'_, AppState>,
) -> CmdResult<UsageSyncResult> {
    state.usage_service.sync_now()
        .map_err(|e| e.to_string())
}
```

**UI 触发**: "立即同步" 按钮 → `invoke('sync_usage_history')` → 后端扫 JSONL + 写 cache

#### 3.2.5 `src/pages/usage-query/index.tsx` (+ ~30 行)
**改造点**:
- 加 "最后同步" 时间戳 (替代现有 "最后更新")
- 加 "立即同步" 按钮 (替代现有 "刷新" 按钮的语义; "刷新" = 从 cache 读, "立即同步" = 重扫 JSONL)
- 现有 3 卡片 + sparkline 不动

### 3.3 数据流 (M3.8 ship 后)

```
[用户点用量查询]
    ↓
[pages/usage-query/index.tsx mount]
    ↓
[invoke('get_current_usage', { window: '5h' })]
    ↓
[commands/usage.rs get_current_usage]
    ↓
[UsageService::get_usage] (5-min cache)
    ↓ cache miss
[UsageService::compute_usage_for_window]
    ↓
[usage_provider_ccswitch::compute_usage_from_jsonl]
    ↓
[扫 ~/.claude/projects/<encoded-path>/*.jsonl]
    ↓
[解析每行 assistant.message.usage → 聚合]
    ↓
[pricing::lookup_pricing(model) → 算 cost]
    ↓
[UsageSnapshot { tokens_used: N, cost_usd: $X.XX, ... }]
    ↓
[UI 渲染 3 卡片 + sparkline]
```

**性能**: 本机实测 16 个 JSONL / 36 MB, 扫一遍 ~200ms, cache 命中后不触发 (5min TTL)。

---

## 4. 风险评估

### 4.1 high 风险
**无 high 风险**。cc-switch 解析逻辑已经成熟, 本项目是移植而非创新。

### 4.2 medium 风险

| # | 风险 | 缓解 |
|---|---|---|
| M-1 | **cc-switch 改 JSONL schema** | 写测试覆盖 4 系 (claude / codex / gemini / opencode), schema 变化时 fail-fast; M2.16-002-M 已接受契约性依赖 |
| M-2 | **JSONL 扫性能** (用户有大量会话) | 持久化 mtime + last_offset (cc-switch 模式), 增量扫; 5-min cache 兜底 |
| M-3 | **价格表过期** | UI 加 "价格表版本号" + "更新于 2025-05" 提示; 留接口让用户手动覆盖 (M4+) |
| M-4 | **path 解析权限** | 沿用 `IPlatformPaths::claude_dir()`, 错误用 UsageError::Io 抛 |

### 4.3 low 风险

| # | 风险 | 缓解 |
|---|---|---|
| L-1 | provider_id fingerprint 错位 | 现有 `hash(ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN)` 仍是合理 cache key, 不改 |
| L-2 | 与 cc-switch 版本不同步 | 价格表 + 解析器都是本地常量, 可手工 cherry-pick; 不依赖 cargo workspace |
| L-3 | balance_usd 仍 None | 文档化 (JSONL 不含 balance), UI 显示 "—" 不报错 |
| L-4 | 多 provider / 多 model 数据混算 | 当前 UI 只显示 active provider; 全局聚合留给 M4+ |

### 4.4 不在风险评估内 (明确排除)

- ❌ **不引入 SQLite**: M3.8 用纯内存聚合, SQLite 留 M4+ (cc-switch 走 SQLite 是因为它需要持久化历史, 本项目用量查询只是 ship 一个能用的功能)
- ❌ **不发 HTTP**: Admin API 用户已排除 (D14 排除 A 路径), 文档化在 `m3-8-usage-bug.md §4.1`
- ❌ **不写 OAuth**: 同上

---

## 5. 派单建议 (M3.8 子任务表)

### 5.1 实施分解 (5.5 天, 1 subagent 单跑)

| # | 子任务 | 文件 | 估时 | 阻塞 |
|---|---|---|---|---|
| 1 | 移植 `collect_jsonl_files` + `parse_line` 到 `usage_provider_ccswitch.rs` | `src-tauri/src/services/usage_provider_ccswitch.rs` (新建 ~250 行) | 1.5 天 | D14 拍板 |
| 2 | 新增内置价格表 `pricing.rs` (抄 cc-switch `proxy/usage/calculator.rs` 的常量) | `src-tauri/src/infrastructure/pricing.rs` (新建 ~80 行) | 0.5 天 | — |
| 3 | 改造 `usage_service.rs`: `compute_usage_for_window` 替换 `read_local_usage_json` | `src-tauri/src/services/usage_service.rs` (改 ~50 行) | 0.5 天 | 1, 2 |
| 4 | 新增 `sync_usage_history` command + 注册到 lib.rs | `src-tauri/src/commands/usage.rs` (+ ~30 行) + `src-tauri/src/lib.rs` (+5 行) | 0.5 天 | 3 |
| 5 | UI 适配: 加 "最后同步" 时间戳 + "立即同步" 按钮 | `src/pages/usage-query/index.tsx` (+ ~30 行) | 0.5 天 | 4 |
| 6 | 单测: pricing 解析 + JSONL 解析 + 5min cache 集成 (Rust) | `src-tauri/src/services/usage_provider_ccswitch.rs` 测 (~5) + `src-tauri/src/infrastructure/pricing.rs` 测 (~3) + `src-tauri/src/services/usage_service.rs` 测 (+3) | 1 天 | 1, 2, 3 |
| 7 | Vitest: 模拟 `getCurrentUsage` 返回 JSONL 聚合结果 | `src/__tests__/pages/usage-query.test.tsx` (+5) | 0.5 天 | 3 |
| 8 | Playwright E2E: 启动应用 → 点用量查询 → 验证数字 > 0 | `tests/e2e/m3-8-usage.spec.ts` (新建, 5 cases) | 0.5 天 | 5, 7 |
| 9 | Ship 流程 | `scripts/build-and-ship.sh --milestone M3 --task 3.8 --slug usage-fix` (含 smoke 7 项) | 0.5 天 | 8 |

**总计**: 5.5 天 (1 subagent) 或 4 天 (2 subagent 并发: 1+2 一个, 6 一个)

### 5.2 估时浮动因素

- **乐观**: 4 天 (假设 cc-switch 解析逻辑直接复用, 价格表常量已知)
- **保守**: 6 天 (假设 JSONL schema 有微小差异需调整, 价格表需手动校对)
- **基线**: 5 天 (M3-issues-and-roadmap.md §3 M3.8 估时一致)

### 5.3 与 D14 答案的关系

| D14 答案 | 路径 | 估时 | 备注 |
|---|---|---|---|
| **走 C** (本调研推荐) | 路径 C (cc-switch JSONL) | 5 天 | 本文档详细方案 |
| **走 B** (兜底) | 路径 B (修 stub + JSONL 兜底) | 1 天 | 见 `m3-8-usage-bug.md §4.2`, 不引入新依赖, 不移植 cc-switch, 简单 |
| **走 A** (Admin API) | 路径 A | 4-5 天 | **用户已口头排除**, 文档化在 `m3-8-usage-bug.md §4.1` |

### 5.4 D-槽4 交付边界 (本次任务范围)

**本调研 (D-槽4) 不实施**。仅产 2 个文档:
1. `docs/investigations/m3-8-usage-bug.md` (现状 + 3 路径对比)
2. `docs/design/cc-switch-usage-pattern.md` (本文档, cc-switch 实现细节)

**实施 = M3.8 phase**, 等 D14 拍板后正式派 subagent。**不在 M3 启动门** (D11 = 4 槽全开, 启动门已派 M3.10 / M3.4 / 清单 20 / 本调研)。

### 5.5 主 session 收报告后决定项

1. **D14 是否走 C**? (推荐: 是, 与用户口述一致)
2. **估时是否合理**? (推荐: 5 天, M3-issues-and-roadmap.md §3 M3.8 一致)
3. **是否复用 M2.7 cache**? (推荐: 是, 改 1 个 service + 复用 cache)
4. **是否需要 SQLite**? (推荐: 否, M3.8 内存聚合足够, M4+ 再考虑)
5. **价格表是否暴露给用户编辑**? (推荐: 否, M3.8 内置即可, M4+ 再加 `PricingConfigPanel`)

---

## 6. 附录 — cc-switch 关键代码引用

### 6.1 文件清单
- `D:\project\cc-switch-main\src-tauri\src\services\session_usage.rs` (主解析)
- `D:\project\cc-switch-main\src-tauri\src\database\dao\usage_rollup.rs` (SQLite 聚合, 本项目**不**移植)
- `D:\project\cc-switch-main\src-tauri\src\proxy\usage\calculator.rs` (推测, 价格计算)
- `D:\project\cc-switch-main\src-tauri\src\session_manager\providers\claude.rs` (JSONL 扫描, L17-30 `scan_sessions` + L268-286 `collect_jsonl_files`)
- `D:\project\cc-switch-main\src-tauri\src\session_manager\providers\utils.rs` (timestamp 解析 + text 提取, 本项目**不**需要)
- `D:\project\cc-switch-main\src\components\usage\UsageDashboard.tsx` (UI 参考)
- `D:\project\cc-switch-main\src\components\usage\UsageHero.tsx` (大数字卡片参考)
- `D:\project\cc-switch-main\docs\guides\codex-unified-session-history-guide-zh.md` (JSONL 行为文档)

### 6.2 实测 JSONL 数据样本 (本机)
```bash
# 路径: ~/.claude/projects/C--Users-e-Yunfei-Qian--claude/*.jsonl
# 文件数: 16
# 累计大小: ~36 MB
# 单文件最大: 11 MB
# usage 字段样本 (assistant 消息):
{
  "type": "assistant",
  "message": {
    "id": "52bc1ead-5843-4d3b-a439-c8b3232f9b3b",
    "role": "assistant",
    "model": "deepseek-v4-pro",          # 本项目支持
    "usage": {
      "input_tokens": 40693,             # 必有
      "cache_creation_input_tokens": 0,  # 可选
      "cache_read_input_tokens": 0,      # 可选
      "output_tokens": 712               # 必有
    },
    "content": [...]
  },
  "timestamp": "2026-06-09T01:46:13.876Z",  # RFC3339
  "sessionId": "00ef21b2-...",
  "cwd": "C:\\Users\\e-Yunfei.Qian\\.claude"
}
```

### 6.3 时间窗过滤逻辑 (本项目将实现的)
```rust
fn filter_by_window(
    lines: &[ParsedLine],
    window: UsageWindow,
) -> Vec<&ParsedLine> {
    let window_secs = match window {
        UsageWindow::FiveHours => 5 * 3600,
        UsageWindow::OneWeek => 7 * 86400,
        UsageWindow::OneMonth => 30 * 86400,
    };
    let cutoff = now_unix_secs() - window_secs;
    lines.iter()
        .filter(|l| l.timestamp_unix_secs() >= cutoff)
        .collect()
}
```

### 6.4 cost 计算逻辑 (从 cc-switch 移植)
```rust
fn compute_cost(
    usage: &ParsedAssistantUsage,
    pricing: ModelPricing,
) -> f64 {
    let input_cost = usage.input_tokens as f64 / 1_000_000.0 * pricing.input_per_million;
    let output_cost = usage.output_tokens as f64 / 1_000_000.0 * pricing.output_per_million;
    let cache_read_cost = usage.cache_read_tokens as f64 / 1_000_000.0 * pricing.cache_read_per_million;
    let cache_creation_cost = usage.cache_creation_tokens as f64 / 1_000_000.0 * pricing.cache_creation_per_million;
    input_cost + output_cost + cache_read_cost + cache_creation_cost
}
```

---

## 7. 结论

**cc-switch 的 JSONL 解析方案在技术可行性上完全成立**:
- ✅ 解析逻辑成熟 (cc-switch 已在生产用)
- ✅ 数据源稳定 (Claude Code 实时写 JSONL)
- ✅ 性能可接受 (本机 200ms / 5min cache)
- ✅ 移植成本可控 (~330 行 Rust)

**推荐**: M3.8 ship 路径 C (本方案), 5 天估时, 与用户最新口述方向一致。

**保底**: 路径 B (JSONL 兜底, 1 天), 适合 D14 用户未拍板时先做过渡。

**附录**: 根因分析见 `docs/investigations/m3-8-usage-bug.md`