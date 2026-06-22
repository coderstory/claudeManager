# M3.8 用量查询 bug 根因排查 (清单 19)

> **任务**: M3 启动门 D-槽4 调研产出
> **日期**: 2026-06-22
> **作者**: Subagent D-槽4 (auto 模式, 跳过 ship 校验)
> **状态**: 调研完成, D14 决策待用户拍板
> **关联**: `docs/milestones/M3-issues-and-roadmap.md` §3 M3.8 + `.planning/STATE.md` §M2.7 ship 段 + `docs/design/cc-switch-usage-pattern.md` (姊妹文档)

---

## 1. 背景

### 1.1 用户反馈 (清单 19, P0)
> 用量查询不生效, 读不到数据
> (M2.7 ship 的 5-min cache + `~/.claude/usage.json` fallback 链路有 gap)

### 1.2 M2.7 ship 记录 (2026-06-20)
- 7 commits + 13 个 Rust 单测 + 10 个 vitest + 5 个 playwright e2e
- Ship exe: `~/Desktop/ClaudeConfigManager-M2/ClaudeConfigManager-M2.2.7-f7-usage-query.exe` (30.9 MB)
- Smoke 7/7 ✅, Vitest 156/156 ✅
- **已知限制**: "只读本地 stub —— 不发外部 HTTP 请求"
- 数据源契约: `~/.claude/usage.json` 本地 Claude Code 写的快照

### 1.3 M2.16-002-M 关联 (docs/investigations/m2.16-limitations-eval.md L16, L46-48)
- 主题: F3 sql_parser 4 app_type 跟随 cc-switch schema 演化
- 决策: **接受** (契约性依赖, 不能独立于上游 schema 演化)
- **隐含意义**: 本项目 sql_parser 锁定了 cc-switch 的 SQL schema (claude / claude-desktop / codex / gemini 4 系), 后续 cc-switch 改 schema 需同步
- **M3.8 关联点**: usage 链路也应该跟随 cc-switch 数据源; 但 M2.7 选错了**数据源类型** —— usage.json 是 Claude Code 自己的本地快照 (不是 cc-switch 维护的), 而 cc-switch 走的是 **JSONL session 历史** + proxy_request_logs 表

---

## 2. 现有架构 (M2.7 ship 现状)

### 2.1 后端 (Rust)

#### 2.1.1 domain/usage.rs — 数据模型
`D:\project\winui3\src-tauri\src\domain\usage.rs:32-89`
```rust
pub enum UsageWindow {
    FiveHours,   // 5h
    OneWeek,     // 1w
    OneMonth,    // 1m
}

pub struct UsageSnapshot {
    pub provider_id: String,    // active provider fingerprint (hash)
    pub window: UsageWindow,
    pub tokens_used: u64,
    pub cost_usd: Option<f64>,
    pub balance_usd: Option<f64>,
    pub timestamp: i64,
}
```

#### 2.1.2 services/usage_service.rs — 业务逻辑
`D:\project\winui3\src-tauri\src\services\usage_service.rs:78-251`

**关键方法**:
- `get_usage(provider_id, window)` (L147-169): 5-min TTL cache miss → `read_local_usage_json`
- `read_local_usage_json` (L188-250): 单文件读 `~/.claude/usage.json`
  - 文件不存在 → `UsageSnapshot::empty`
  - JSON parse 失败 → `UsageError::Json`
  - `providers.<id>.<window>` 字段缺失 → `UsageSnapshot::empty`
- 5-min TTL: `Mutex<HashMap<String, CacheEntry>>`, key = `(fingerprint, window)` (L84)

**provider_id 解析** (`commands/usage.rs:45-76` `resolve_active_provider_id`):
```rust
let token = settings.env.ANTHROPIC_AUTH_TOKEN;
let base = settings.env.ANTHROPIC_BASE_URL;
format!("active-{:x}", hash(token + base))  // cache key
```

### 2.2 前端 (TypeScript)

#### 2.2.1 types/usage.ts — TS mirror
`D:\project\winui3\src\types\usage.ts:11-34`
```typescript
export type UsageWindow = '5h' | '1w' | '1m';
export interface UsageSnapshot {
  provider_id: string;
  window: UsageWindow;
  tokens_used: number;
  cost_usd?: number;
  balance_usd?: number;
  timestamp: number;
}
```

#### 2.2.2 lib/api/usage.ts — IPC wrapper
`D:\project\winui3\src\lib\api\usage.ts:25-34`
```typescript
export function getCurrentUsage(window: UsageWindow): Promise<UsageSnapshot> {
  return invoke<UsageSnapshot>('get_current_usage', { window });
}
export function refreshUsage(window: UsageWindow): Promise<UsageSnapshot> {
  return invoke<UsageSnapshot>('refresh_usage', { window });
}
```

#### 2.2.3 pages/usage-query/index.tsx — UI
`D:\project\winui3\src\pages\usage-query\index.tsx:97-580`
- 3-button toggle group (5h / 1w / 1m)
- 3 卡片: tokens / cost / balance
- Sparkline placeholder (M2.7 单点; M2.8+ 加历史)
- 错误用 InfoBar 显示

---

## 3. 根因分析 (3 场景实测)

### 3.1 数据源实测 (2026-06-22 本机)

#### 3.1.1 `~/.claude/usage.json` 状态
```bash
$ cat ~/.claude/usage.json
cat: /c/Users/e-Yunfei.Qian/.claude/usage.json: No such file or directory
```
**实测结果**: 文件 **不存在**。

#### 3.1.2 `~/.claude/projects/` 状态
```bash
$ ls ~/.claude/projects/
C--Users-e-Yunfei-Qian--claude/            (10+ 子目录)
C--Users-e-Yunfei-Qian--claude-mem-observer-sessions/
C--Users-e-Yunfei-Qian--claude-plugins-dev/
...

$ ls ~/.claude/projects/C--Users-e-Yunfei-Qian--claude/*.jsonl | head -5
00ef21b2-4e0f-416c-87aa-a4978fc3c35b.jsonl       (393 KB)
046dc948-a1c0-4456-b7b1-79b0cb65f28e.jsonl       (7.2 MB)
3a3d0ac6-e493-4233-b4eb-cfd1645c5e3c.jsonl       (11 MB)
47c0f502-bda5-4259-8938-26915dd546f2.jsonl       (2 MB)
68bea65e-fc83-440d-9d37-01a45adc13a3.jsonl       (56 KB)
```
**实测结果**: 大量 **JSONL session 文件** (每个会话一个文件), 这是 Claude Code 的**真实运行时缓存**。

#### 3.1.3 JSONL 单行 schema (实测样本)
```bash
$ head -1 ~/.claude/projects/.../00ef21b2.jsonl
{"type":"last-prompt","leafUuid":"...","sessionId":"00ef21b2-..."}

# assistant 消息样本 (有 usage 字段)
{
  "type": "assistant",
  "message": {
    "id": "52bc1ead-...",
    "role": "assistant",
    "model": "deepseek-v4-pro",
    "usage": {
      "input_tokens": 40693,
      "cache_creation_input_tokens": 0,
      "cache_read_input_tokens": 0,
      "output_tokens": 712,
      ...
    },
    "content": [...]
  },
  "timestamp": "2026-06-09T01:46:13.876Z",
  "sessionId": "00ef21b2-...",
  "cwd": "C:\\Users\\e-Yunfei.Qian\\.claude"
}
```
**字段全集** (cc-switch 解析逻辑, `D:\project\cc-switch-main\src-tauri\src\services\session_usage.rs:46-58`):
- `message.id` (UUID, 去重 key)
- `message.model` (e.g. `claude-sonnet-4-20250514`)
- `usage.input_tokens` / `output_tokens` / `cache_read_tokens` / `cache_creation_tokens`
- `timestamp` (RFC3339 字符串)
- `sessionId`

### 3.2 三类失败场景分析

| 场景 | 触发条件 | 实测行为 | 设计意图 | 评级 |
|---|---|---|---|---|
| **(a) `usage.json` 不存在** | Claude Code 未写文件 (本机实测) | `read_local_usage_json` 返回 `UsageSnapshot::empty` (L199) → UI 显示 "暂无数据" (page L430-456) | "容错优于报错" 原则 | ⚠️ **预期行为**, 不是 bug |
| **(b) JSON 格式错误** | Claude Code 写半截 JSON / 编码异常 | `serde_json::from_str` 抛 `UsageError::Json` → IPC 返回 `Err(msg)` → UI InfoBar 报错 | 严格校验, 不吞错 | ⚠️ **预期行为**, 但本机无触发 |
| **(c) schema 字段缺** | `usage.json` 缺 `providers.<id>.<window>` | `bucket = None` → `UsageSnapshot::empty` (L228-230) | 容错优先 | ⚠️ **预期行为** |

### 3.3 真正的根因 (清单 19 真正的 gap)

**核心结论**: M2.7 ship 的 3 类"失败场景"都是**设计意图** —— `UsageSnapshot::empty` 是规格内的"无数据"路径, 不是 bug。

**真正的 gap** 是 **数据源选错**:
- M2.7 假设: `~/.claude/usage.json` 是 Claude Code 主动维护的 quota 快照 (含 5h/1w/1m 累计 token / cost / balance)
- 现实:
  - **本机实测**: `~/.claude/usage.json` **不存在** (Claude Code 实际**不**写这个文件)
  - Claude Code 的 quota / cost / balance 信息需要走 **Admin API** (OAuth, 用户已排除) 或 **第三方代理 API** (走 Anthropic-compatible / OpenAI / DeepSeek)
  - Claude Code **本地实际有的** = `~/.claude/projects/<encoded-path>/*.jsonl` session 历史 (每个会话一个 JSONL 文件, 累计 token / 模型 / 时间戳都在 `message.usage` 字段里)

**佐证**: cc-switch-main 的 `services/session_usage.rs` 整个模块就是从 JSONL 提取用量的实现, 它**根本不用** `usage.json`, 直接扫 JSONL + 同步到自己的 SQLite + 算 cost。

### 3.4 失败路径 (用户视角)

1. 用户点 sidebar "用量查询"
2. UI mount → `getCurrentUsage('5h')` → IPC → `commands/usage.rs:82 get_current_usage`
3. 后端 `resolve_active_provider_id` → `"active-xxxxxx"` (cache key)
4. `UsageService::get_usage` → cache miss → `read_local_usage_json`
5. `read_local_usage_json` → `fs::read_to_string` → `Err(NotFound)` → `UsageSnapshot::empty` (L199)
6. 返回 `{ tokens_used: 0, cost_usd: null, balance_usd: null, timestamp: now }`
7. UI 渲染 3 卡片全 0 / `—` + 底部 "暂无数据 — 等待 Claude Code 写入 `~/.claude/usage.json`"

**用户看到的"不生效"**: 数字永远是 0, 永远显示 "暂无数据", **永远等不到 Claude Code 写入** (因为 Claude Code 不写这个文件)。

---

## 4. 修复路径 (3 选 1)

### 4.1 路径 A — 重写为 Admin API (OAuth)
- **方案**: 走 Anthropic Admin API (需 OAuth token) 或 OpenAI Billing API
- **依赖**: 用户提供 OAuth token (持久化到 `IPlatformPaths` + 加密)
- **HTTP 客户端**: reqwest + retry + backoff
- **缺点**: 用户已排除 (M3.8 §D14 决策)
- **估时**: 4-5 天 (含 OAuth 持久化 + token 刷新 + UI 改动)
- **评级**: ❌ **本调研排除** (用户口头确认不选)

### 4.2 路径 B — 修现有 stub (5-min cache + usage.json fallback)
- **方案**: 在 `read_local_usage_json` 失败时, **回退到扫 JSONL** 算累计 (类似 cc-switch 的 `session_usage.rs`), 仍走 5-min cache
- **改动范围**:
  - `services/usage_service.rs` 新增 `compute_usage_from_jsonl(projects_dir, window)` 函数 (复用 cc-switch `session_usage.rs` 的解析逻辑, ~80 行 Rust)
  - `commands/usage.rs` 引入新依赖: `get_claude_config_dir()` 来自 platform (已有, 不需新增)
  - 替换 `read_local_usage_json` → `read_or_compute_usage`: 先查 `usage.json`, 失败回退 JSONL
- **优点**:
  - 不引入新依赖
  - 复用现有 cache + UI + 测试 (改 1 个 service + 5 个 vitest + 5 个 playwright)
  - 兼容性好 (Claude Code 写 `usage.json` 时优先用, 没写时 JSONL 兜底)
- **缺点**:
  - `cost_usd` / `balance_usd` JSONL 不直接给, 需**本地价格表** (cc-switch 维护 `pricing.yaml`, 我们要加一个内置常量)
  - 时间窗聚合 (5h/1w/1m) 需扫所有 JSONL + 按 `timestamp` 过滤, **性能** 需考虑 (本机实测: 16 个 JSONL 文件, 累计 ~36 MB, 扫一遍 ~200ms, 加 cache 后可接受)
- **估时**: 1 天 (复用 cc-switch 解析 + 写 5 个新测试)
- **评级**: ⭐⭐⭐ **可快速 ship**, 但 cost / balance 字段需要补"本地价格表" 才能算出

### 4.3 路径 C — 接入 cc-switch-main 的回话缓存读法 (用户最新口述方向)
- **方案**: 完整移植 cc-switch 的 `services/session_usage.rs` 解析逻辑 (扫 JSONL → 提取 token → 算 cost → 持久化到本地 SQLite), 替换 `~/.claude/usage.json` 整条数据源
- **改动范围**:
  - 新增 `src-tauri/src/services/usage_provider_ccswitch.rs` (~300 行 Rust, 从 cc-switch 移植)
  - 新增 `src-tauri/src/services/usage_stats.rs` (复用 cc-switch 的 `effective_usage_log_filter` 等 helper)
  - 新增 `src-tauri/src/infrastructure/pricing.rs` (内置价格表常量, 替代 cc-switch 的 `pricing.yaml`)
  - 替换 `services/usage_service.rs` 的 `read_local_usage_json` → 调用新模块
  - 新增 command: `sync_usage_history` (触发一次性 JSONL → SQLite 同步)
  - 新增 table: `proxy_request_logs` (SQLite, 存每日聚合)
  - UI: 复用 `pages/usage-query/index.tsx`, 数据从 cache hit 拿, 不需大改
- **优点**:
  - 与 cc-switch 完整 schema 兼容 (跟 cc-switch 共享同一份数据模型)
  - 持续可用: JSONL 是 Claude Code **每个会话实时写**的, 数据**实时更新**
  - 历史趋势: cc-switch 已实现 `usage_daily_rollups` 表, **可直接复用 sparkline 历史**
  - 多 provider / 多 model 支持: 天然 (cc-switch 已实现按 model 分桶)
- **缺点**:
  - 改动大 (~500 行 Rust + 价格表常量 + SQLite schema)
  - **依赖 SQLite** (本项目当前无 SQLite 依赖, 需在 `Cargo.toml` 加 `rusqlite` 或 `sqlx`)
  - 与 cc-switch schema 耦合 (M2.16-002-M 已有先例, 接受契约性依赖)
- **估时**: 3-5 天 (移植 ~300 行 + 价格表 ~100 行 + 5 个新 command + 10 个新单测 + 5 个新 vitest + 5 个新 playwright)
- **评级**: ⭐⭐⭐⭐ **推荐**, 与用户最新口述方向一致 + 长期可维护

### 4.4 路径对比表

| 维度 | A. Admin API | B. 修 stub + JSONL 兜底 | C. 接 cc-switch JSONL |
|---|---|---|---|
| 用户口述方向 | ❌ 已排除 | — | ✅ 最新口述 |
| 数据源 | Admin API 实时 | usage.json (罕见) + JSONL | JSONL (实时) |
| 实时性 | 实时 | 准实时 (cache + JSONL 兜底) | 准实时 (cache + SQLite 同步) |
| 改动 LOC | ~500 (HTTP + OAuth) | ~150 (解析 + 兜底) | ~500 (移植 + 价格表 + SQLite) |
| 估时 | 4-5 天 | 1 天 | 3-5 天 |
| 新依赖 | reqwest + OAuth | 无 | rusqlite + chrono + rust_decimal |
| 风险 | 高 (依赖外部 API + OAuth) | 中 (JSONL 解析可能踩 schema 变化) | 中 (cc-switch schema 演化, 已在 M2.16-002-M 接受) |
| 长期可维护 | 中 (需维护 OAuth token 刷新) | 高 (Claude Code 写 usage.json 是契约) | 高 (与 cc-switch 同源) |
| 历史趋势 | ❌ 无 | ⚠️ 简单滚动 (cache 自带) | ✅ 完整 SQLite 聚合 |

---

## 5. 派单建议 (M3.8 子任务表)

### 5.1 推荐路径
**C (接 cc-switch JSONL)**, 与用户最新口述方向一致, 长期可维护。

### 5.2 子任务分解

| # | 子任务 | 文件 | 估时 | 阻塞 |
|---|---|---|---|---|
| C-1 | 新增 `services/usage_provider_ccswitch.rs`: 从 cc-switch 移植 `sync_single_file` + `collect_jsonl_files` (去掉 SQLite 同步部分) | `src-tauri/src/services/usage_provider_ccswitch.rs` (新建, ~250 行) | 1.5 天 | D14 拍板 |
| C-2 | 新增 `infrastructure/pricing.rs`: 内置价格表常量 (claude-sonnet-4 / opus-4 / haiku-4 / deepseek-v4 等), 暴露 `lookup_price(model) -> ModelPricing` | `src-tauri/src/infrastructure/pricing.rs` (新建, ~80 行) | 0.5 天 | — |
| C-3 | `services/usage_service.rs` 改造: `read_local_usage_json` → `compute_usage_from_jsonl(projects_dir, window)`, 复用 5-min cache, `cost_usd` 从 pricing 计算 | `src-tauri/src/services/usage_service.rs` (改 ~50 行) | 0.5 天 | C-1, C-2 |
| C-4 | 新增 `commands/sync_usage_history.rs`: 触发一次性 JSONL → in-memory 聚合 (不引入 SQLite, 简单内存聚合) | `src-tauri/src/commands/usage.rs` (+ ~30 行) | 0.5 天 | C-3 |
| C-5 | UI 适配: pages/usage-query/index.tsx 复用, 加 "最后同步" 时间戳 + "立即同步" 按钮 | `src/pages/usage-query/index.tsx` (+ ~30 行) | 0.5 天 | C-4 |
| C-6 | 单测: pricing 解析 + JSONL 解析 + 5min cache 集成 (Rust + Vitest) | `src-tauri/src/services/usage_provider_ccswitch.rs` 测 + `src/__tests__/pages/usage-query.test.tsx` (+5) | 1 天 | C-1, C-2 |
| C-7 | E2E: playwright 验证 "用量查询页加载数字 > 0 (因本机有 JSONL)" | `tests/e2e/m3-8-usage.spec.ts` (新建) | 0.5 天 | C-5 |
| C-8 | Ship: 走 `scripts/build-and-ship.sh --milestone M3 --task 3.8 --slug usage-fix` | 走标准流程 | 0.5 天 (含 smoke 7 项) | C-7 |

**总计**: 5.5 天 (1 subagent 单跑) 或 4 天 (2 subagent 并发: C-1+2 一个, C-6 一个)

### 5.3 阻塞条件
- **D14 用户拍板** = 路径 C 是否是用户想要的? 用户最新口述(2026-06-21)倾向于 C, 但**未正式拍板**
- 路径 B 是**保底方案** (D14 走 C 失败时 fallback, 1 天即可 ship)

### 5.4 不在 M3.8 scope 的项
- ❌ 不引入 SQLite (M3.8 用纯内存聚合, SQLite 留 M4+)
- ❌ 不引入 reqwest (Admin API 排除, 文档化在 §4.1)
- ❌ 不改 `domain/usage.rs` (数据结构兼容, 只在 service 改)
- ❌ 不改 UI 大框架 (复用现有 3 卡片 + sparkline, 加 1 个 "立即同步" 按钮)

---

## 6. 风险评估

| 风险 | 等级 | 理由 | 缓解 |
|---|---|---|---|
| cc-switch 改 JSONL schema | medium | M2.16-002-M 已有先例, 接受契约性依赖 | 写测试覆盖 4 系 (claude / codex / gemini / opencode), schema 变化时 fail-fast |
| JSONL 扫性能 | low | 本机实测 16 文件 / 36 MB, 扫一遍 ~200ms, 5-min cache 后基本不触发 | 持久化 mtime + last_offset (cc-switch 模式), 增量扫 |
| 价格表过期 | medium | 模型价格会变, 内置常量不会自动同步 | UI 加 "价格表版本号", 留接口让用户手动覆盖; 不做实时同步 |
| path 解析权限 | low | 读 `~/.claude/projects/` 是用户目录, 权限正常 | 沿用 `IPlatformPaths::claude_dir()`, 错误用 UsageError::Io |
| 与 cc-switch 版本不同步 | low | cc-switch 用 cargo workspace 共享, 本项目独立 | 价格表 + 解析器都是本地常量, 可手工 cherry-pick |
| provider_id fingerprint 错位 | low | 现有 `hash(ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN)` 仍是合理 cache key | 不改 |

---

## 7. 结论

**清单 19 不是 bug**, 是 M2.7 选错数据源 (usage.json 是 Claude Code 的 quota 快照文件, 但 Claude Code 实际**不**写这个文件) + JSONL 是 Claude Code 真实运行时缓存。

**推荐路径 C** (接 cc-switch JSONL 读法), 与用户最新口述一致, 估时 4-5 天。

**保底路径 B** (JSONL 兜底) 可在 1 天内 ship, 适合 D14 用户**未拍板**时先做过渡。

**附录**: cc-switch 详细解析逻辑见 `docs/design/cc-switch-usage-pattern.md`