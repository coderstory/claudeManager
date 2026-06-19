# Claude 配置管理器 (Claude Config Manager) — 产品 + 设计 SPEC

> 跨平台产品需求与设计文档。
>
> 实现者可基于此文档在 macOS / Windows / Linux 任一平台用任何技术栈实现。
> 真实数据样本与参考产品引用在文末"附录"。

---

## 1. 产品定位

### 1.1 一句话

桌面 GUI 工具,帮助用户在多个 Claude Code provider 配置之间**快速切换 + 安全管理 + 实时监控用量**。

### 1.2 目标用户

已经使用 Claude Code(在终端里跑 `claude` 命令),有 2 个以上 provider 配置要切换(例如:公司代理网关 / 自费 DeepSeek / 自费第三方),希望:
- 不用手编 `~/.claude/settings.json` 切换
- 安全地查看 / 编辑当前生效的配置
- 管理 enabled 的 MCP server 列表
- 看到每个 provider 的 token 用量(避免超额被限额)

### 1.3 价值主张(对比手动方案)

| 现状(手动) | 用本工具 |
|---|---|
| 手编 `~/.claude/settings.json` 切换 provider(2-5 分钟,易错) | 双击卡片,1 秒切换,自动备份原文件 |
| 复制 `ANTHROPIC_AUTH_TOKEN` 字段容易漏空格 | 表单 + 校验 + token-mask 防肩窥 |
| MCP 启用列表在 `~/.claude.json` 里手改,容易破坏其他键 | 一行 toggle,只动 `mcpServers` 字段,其他键保留 |
| 用量超额才发现被限额 | provider 卡片上常驻用量徽章,详情页看精确数字 |
| 想看当前生效的 env / hooks,只能 cat settings.json | 可视化 JSON 编辑器,带语法高亮 + 校验 + 格式化 |

### 1.4 范围声明(必读)

**做**:Claude Code 单 client 的 provider 切换 + 配置编辑 + MCP 管理 + 用量查询。

**当前阶段不做，但可以预留接口**(硬约束):
- 其他 client 应用(Codex / Cursor / Gemini / OpenCode 等)
- 云同步 / 多人协作
- 自动代理 / 失败转移 
- 插件系统 / 主题市场
- 自动更新 / 远程遥测
- i18n(单语言即可,见 §10)

---

## 2. 数据模型

### 2.1 实体

```
┌─────────────────────────────────────────────────────────────┐
│ Provider(本地库条目)                                        │
├─────────────────────────────────────────────────────────────┤
│ id              : string       唯一,lowercase, [a-z0-9-_]  │
│ name            : string       显示名,如 "GLM-4.6 官方"    │
│ baseUrl         : string       ANTHROPIC_BASE_URL          │
│ apiKey          : string       ANTHROPIC_AUTH_TOKEN         │
│ models          : string[]     主/子/快速模型名             │
│ category        : string?      标签:官方/自费/代理         │
│ notes           : string?      自由文本备注                 │
│ createdAt       : datetime     导入/新建时间                │
│ lastUsedAt      : datetime?    上次被切换为活跃的时间       │
│ isCurrent       : bool         是否当前激活(冗余字段,见 2.3)│
│ mcpServers      : McpServer[]  这个 provider 关联的 MCP 列表 │
│ env             : object       完整 env map(进 settings.json)│
│ extraJson       : object       未识别的 settings.json 字段  │
│                   (保留原样,切换时回写)                     │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ McpServer                                                      │
├─────────────────────────────────────────────────────────────┤
│ id              : string       唯一,lowercase                │
│ name            : string       显示名                        │
│ description     : string?                                       │
│ command         : string       如 "npx"                      │
│ args            : string[]                                       │
│ env             : object       KEY=VALUE                      │
│ enabled         : bool         是否写入 mcpServers map       │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ UsageSnapshot(查询结果,缓存 5 分钟)                          │
├─────────────────────────────────────────────────────────────┤
│ kind            : enum         Window | Balance | NotSupported│
│ windows         : Window[]?    当 kind=Window:3 个时间窗     │
│ balance         : Balance?     当 kind=Balance:单数字 + 货币│
│ fetchedAt       : datetime     查询时间                       │
│ errorCode       : enum?        None | AuthFailed | RateLimited│
│                   (None 以外时显示对应错误文案)               │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ Window(时间窗用量)                                            │
├─────────────────────────────────────────────────────────────┤
│ label           : string       "最近 5 小时" / "1 周" / "1 月"│
│ usedPercent     : number       0-100                          │
│ resetAt         : datetime?    下次重置时间                    │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 持久化文件

| 文件路径 | 用途 | 格式 |
|---|---|---|
| `<app-data>/providers.json` | 本地库(所有 provider + mcpServers 列表) | JSON,2 空格缩进,人类可读 |
| `<app-data>/providers.json.bak.<ts>` | 损坏备份(解析失败时自动生成) | JSON |
| `~/.claude/settings.json` | **Claude Code 实际读取的活跃配置** | JSON,平台 Claude Code 定义 |
| `~/.claude/settings.json.bak.<ts>` | 切换前的备份(每次切换生成一次) | JSON |
| `~/.claude.json` | Claude Code 实际读取的 MCP server 配置 | JSON,平台 Claude Code 定义 |
| `~/.claude.json.bak.<ts>` | MCP toggle 前的备份(每次 toggle 生成) | JSON |

`<app-data>` = 平台约定:
- Windows: `%APPDATA%\ClaudeConfigManager\`
- macOS: `~/Library/Application Support/ClaudeConfigManager/`
- Linux: `$XDG_DATA_HOME/ClaudeConfigManager/`(默认 `~/.local/share/ClaudeConfigManager/`)

`~/.claude/...` = Claude Code 自己的配置目录,本工具读写但不拥有。

### 2.3 "当前活跃" 的真相来源

**`isCurrent` 字段不是真相来源,只是缓存。** 真相是 `~/.claude/settings.json` 里 `env.ANTHROPIC_BASE_URL` 等于哪个 provider 的 `baseUrl` + `apiKey`。每次启动应用 / 切换 provider / 焦点回到窗口时,重新从 settings.json 读出并匹配 → 设置 `isCurrent`。

### 2.4 Provider "未识别字段" 保留

`settings.json` 里可能含本工具不识别的字段(`hooks` / `permissions` / `numStartups` 等)。**不能丢** — 切换 provider 时必须把新 provider 自己的 `extraJson` 完整回写,否则会丢失用户的 hooks / 权限规则。

---

## 3. 功能清单

> 详细需求(每条带验收命令)见 `REQUIREMENTS.md`(51 条,按 8 大类:Data / Live / Import / UI / Editor / MCP / Quota / Publish)。

### 3.1 核心 13 大功能

| # | 功能 | 一句话 |
|---|---|---|
| F1 | 列出 provider | 表格化显示所有 provider,标出当前激活 |
| F2 | 切换 provider | 选一个 provider → 备份原 settings.json → 原子写入新值 |
| F3 | 导入 .sql | 从 cc-switch 备份的 .sql 文件批量导入 provider + MCP |
| F4 | 导入 deeplink | 从 `ccswitch://v1/import?...` URL 解析单个 provider |
| F5 | 编辑 JSON | 可视化 JSON 编辑器,带语法高亮 / 校验 / 格式化 |
| F6 | 管理 MCP | 列表 + 新增 / 编辑 / 删除 / 启用 toggle |
| F7 | 查询用量 | 卡片显示 provider token 用量(5h/1w/1m 或余额) |
| F8 | 单文件部署 | 应用 = 一个可执行文件,无外部依赖 |
| **F16** | **浏览资源(基于当前生效配置)** | **在应用里看 `~/.claude/settings.json` 中实际启用的 plugins / skills / commands / LSP,逐项 enable/disable/delete** |
| **F17** | **在线安装(资源市场 + 仓库)** | **从内置推荐仓库 / 第三方 git URL 拉取 plugin / skill / command,自动 git clone + 扫描 + 启用** |
| **F18** | **配置智能优化** | **一键扫描 settings.json 给出优化建议(开 prompt cache / 设合理 timeout / 禁用非必要 telemetry / 调整 retry 策略),按"安全 / 需确认 / 不可改"分级,可一键应用** |
| **F19** | **备份与恢复** | **自动保留 `settings.json` 最近 N 个版本(默认 10),可点任意版本回滚** |
| **F20** | **单实例 + 文件关联** | **双击 .sql 第二次启动时,跳到已运行实例的导入页(而不是开新窗口)** |

### 3.2 支撑功能

| # | 功能 | 用途 |
|---|---|---|
| F9 | 搜索/过滤 | provider 列表按名字 / URL / 标签过滤 |
| F10 | 拖放 .sql 导入 | 把 .sql 拖到主窗口 → 自动跳到导入页 |
| F11 | 快捷键 | `Ctrl+N` 新建 / `Ctrl+I` 导入 / `Ctrl+F` 搜索 / `Ctrl+S` 保存 / `Ctrl+Shift+F` 格式化 JSON / `Esc` 关闭弹窗 |
| F12 | 主题 | 跟随系统 light/dark(可手动覆盖) |
| F13 | 备份恢复(每版本) | `settings.json.bak.<ts>` 列表,用户可点回滚(默认保留 10 个,设置页可改) |
| F14 | 导出单 provider | 把单个 provider 的 settings_config 导出为 .json 分享 |
| F15 | 错误反馈 | 切换 / 编辑 / 导入失败时内联红色提示条,不弹模态 |
| **F21** | **资源搜索** | 在资源浏览页按 name / type / 来源仓库 过滤 |
| **F22** | **资源详情预览** | 点资源项查看 manifest(来源 / 描述 / 文件列表 / 启用状态) |
| **F23** | **优化建议导出** | 把当前 settings.json 的所有优化项导成 markdown 报告(便于发给团队 / 存档) |
| **F24** | **备份版本 diff** | 选两个备份版本,显示 settings.json 字段级 diff(哪个 env 变量被删/改) |

### 3.3 用量查询的具体场景(必须支持)

每种 provider 类型的查询方式不同,**用户要"用一行配置就让某个 provider 跑起来,不用查文档"**:

| Provider 类型 | API endpoint | 响应 → 归一化 |
|---|---|---|
| **Anthropic 官方**(`api.anthropic.com`) | `/v1/organizations/usage` | 3 个时间窗(5h / 1w / 1m) |
| **DeepSeek**(`*.deepseek.com`) | `GET /user/balance` | 单数字 + 货币 |
| **OpenAI 兼容**(`/v1/...`,如 Azure / OpenRouter) | `GET /v1/dashboard/billing/credit_grants` | 单数字 + 货币 |
| **其他 / 不识别** | (无) | `Kind=NotSupported` 显示"此供应商暂不支持余量查询" |

**新加 provider 类型的成本 = 写一个新 class + 注册一行 DI**。不允许"为了加一个 provider 要改 10 个文件"。

### 3.4 资源(Plugins / Skills / Commands / MCPs)类型详解

Claude Code 的"资源"是 4 类可启用/禁用的资产,在 `~/.claude/settings.json` 里以不同字段记录:

| 资源类型 | 来源 | 启用时写入 settings.json 的字段 | 物理位置 | 启用粒度 |
|---|---|---|---|---|
| **Plugin** | Marketplace 仓库的 `plugins/<name>/` 目录 | `enabledPlugins["<marketplace>:<plugin>"] = true` | `~/.claude/plugins/<marketplace>/<name>/` | 整包启用/禁用 |
| **Skill** | Marketplace 仓库的 `skills/<name>/SKILL.md` | `enabledSkills["<marketplace>:<name>"] = true` | `~/.claude/skills/<marketplace>/<name>/SKILL.md` | 整包启用/禁用 |
| **Command(斜杠命令)** | Marketplace 仓库的 `commands/<name>.md` | `enabledCommands["<marketplace>:<name>"] = true` | `~/.claude/commands/<marketplace>/<name>.md` | 整包启用/禁用 |
| **LSP Plugin** | Marketplace 仓库的 `lsp/<name>/` 目录 | `enabledLsp["<marketplace>:<name>"] = true` | `~/.claude/lsp/<marketplace>/<name>/` | 整包启用/禁用 |
| **MCP Server** | `mcp.json` / `mcp/` 目录 | `mcpServers.<id>`(在 `~/.claude.json` 而非 settings.json) | `~/.claude/mcp/<id>/` 或仓库内 | 整包启用/禁用 |

**Marketplace(仓库)** 本身也存到 settings.json 的 `extraKnownMarketplaces` 字段(键 = 仓库名,值 = git URL 或本地路径)。

**关键设计原则**:本工具**只管理"启用 / 禁用"和"安装 / 删除仓库"** — 不修改资源本身的代码(用户要改 skill 内容应该直接编辑仓库的 `SKILL.md` 文件,本工具不接管)。本工具是"开关 + 仓库管理",不是"资源编辑器"。

### 3.5 配置优化项目清单(F18 必须扫描的所有项)

按"安全 / 需确认 / 不可改"三级分类。**任何不在这个清单里的字段,本工具不主动建议改**(避免误伤)。

| 类别 | 项目 | settings.json 路径 | 风险等级 | 默认值 | 优化值 | 触发条件 |
|---|---|---|---|---|---|---|
| 性能 | 启用 prompt cache | `env.ANTHROPIC_PROMPT_CACHE_ENABLED` | **安全**(空 = 关闭) | 空 | `true` | 缺该字段 |
| 性能 | 设置长 timeout | `env.API_TIMEOUT_MS` | **安全** | `60000` | `600000`(10 分钟) | `< 300000` |
| 性能 | 减少 token 用量(关 telemetry) | `env.DISABLE_TELEMETRY` | **安全** | 空 | `true` | 缺该字段 |
| 体验 | 调整 thinking effort | `env.CLAUDE_CODE_EFFORT_LEVEL` | **需确认** | `default` / `max` | 询问用户 | 缺该字段 |
| 体验 | 启用 editor 集成 | `env.EDITOR` 或类似 | **需确认** | 空 | 询问用户 | 缺该字段 |
| 安全 | 禁用自动升级(防止半夜升级) | `env.DISABLE_AUTOUPDATER` | **需确认** | 空 | `true` | 缺该字段 |
| 安全 | 禁用非必要流量(匿名使用统计) | `env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` | **安全** | 空 | `true` | 缺该字段 |
| 兼容 | 关闭实验 beta 标志 | `env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS` | **需确认** | 空 | `true` | 缺该字段 |
| 体验 | 启用 git bash 路径覆盖 | `env.CLAUDE_CODE_GIT_BASH_PATH` | **不可改**(读取用户本地路径) | 空 | 跳过 | 仅 Windows |
| 不可改 | API base URL / token | `env.ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` | **不可改**(会影响 Claude Code 能否跑) | — | 跳过 | — |
| 不可改 | 已配置的 hooks | `hooks` | **不可改**(可能是用户脚本) | — | 跳过 | — |
| 不可改 | 已配置的 permissions | `permissions` | **不可改** | — | 跳过 | — |

**优化扫描结果展示**:
```
┌─ 配置优化检查 ─────────────────────────────────┐
│ 扫描 ~/.claude/settings.json (3 个安全优化项) │
│                                                │
│ ✓ 安全(可一键应用)                            │
│   ☑ 启用 prompt cache,减少 70% token 重复开销 │
│   ☑ 关闭非必要流量,匿名使用统计归零          │
│   ☑ 设置 10 分钟 timeout(原 60 秒)            │
│                                                │
│ ⚠ 需确认(应用前会问 1 次)                    │
│   ☐ 关闭自动升级(防止半夜升到不兼容版本)      │
│                                                │
│ — 已扫描,跳过 X 个项目(可能是用户故意设置)—  │
│                                                │
│        [应用 3 项]  [导出报告]  [忽略]         │
└────────────────────────────────────────────────┘
```

**规则**:
- 任何"安全"项默认勾选;任何"需确认"项默认不勾选
- 点 [应用 N 项] → 一次原子写,所有勾选项目合并到 `settings.json` 的 `env` map,完整保留其他字段
- 写盘前先备份 → `settings.json.bak.<ts>`
- 应用后自动触发"重新扫描",验证修改没引入新问题
- 如果用户点 [忽略] → 该扫描结果存到本地(`<app-data>/optimization-ignored.json`),下次扫描跳过这些项
- "已忽略"列表用户可在设置页重置

### 3.6 单实例 + 文件关联(F20)

**场景**:用户双击一个 `.sql` 文件时,Windows / macOS / Linux 会启动新进程。本工具要保证:
- 第一次启动:正常初始化 + 创建单实例锁
- 后续启动(在第一个实例还活着时):检测到锁 → 把命令行参数(.sql 路径)通过 OS 进程间通信传给已运行实例 → 已运行实例跳到导入页并预填该文件 → 新进程退出

**OS 实现差异**:
- **Windows**:`Microsoft.Windows.AppLifecycle.AppInstance.FindOrRegisterForKey("ClaudeConfigManager")` + `AppInstance.RedirectActivationToAsync`
- **macOS**:`NSApplication.shared.delegate` + `NSAppleEventManager` 处理 `kAEOpenDocuments`
- **Linux**:`XDG Desktop Portal` + `org.freedesktop.DBus` 单实例协议,或简单的 PID file + `flock`

**抽象接口**(实现者需提供):
```
IPlatformSingleInstance
  - bool TryAcquire(out IDisposable lock):返回 true=主实例
  - void SendArgsToPrimary(string[] args):新实例调,把 args 传给主
  - event Action<string[]> PrimaryReceivedArgs:主实例订阅,新 args 到达时触发
```

主实例接收到 args → 解析首个 `.sql` / `.json` 文件 → 切到导入页并预填。

---

## 4. 核心用户旅程

### 4.1 冷启动:首次使用

```
1. 用户双击应用图标
2. 应用启动,显示空状态:
   ┌──────────────────────────┐
   │    [大图标]              │
   │    还没有任何提供商       │
   │                          │
   │    [从当前配置导入] (主) │
   │    [新建提供商]     (次) │
   └──────────────────────────┘
3. 用户点 "从当前配置导入" → 读 ~/.claude/settings.json → 创建一个 provider,baseUrl + apiKey 从 env 取
4. 用户点 "导入 .sql" → 选 cc-switch 备份的 .sql → 解析出 5 个 provider + 6 个 MCP
5. 库填满,主页面显示卡片列表
6. 用户点任意 provider 卡片 → 应用为该 provider
7. 卡片左边出现 2px 蓝色条 + 右上 "● 已激活" 徽章
8. 状态栏显示 "当前: <provider 名> · 配置文件: <path>"
```

### 4.2 切换 provider

```
1. 用户在主页看到 provider 列表,目标 provider 卡片
2. 点卡片上的 [切换] 按钮
3. 应用:
   a. 读当前 ~/.claude/settings.json 作为 "旧配置"
   b. 把旧配置写回 "上次切换的 provider" 的 settings_config(backfill,防丢失)
   c. 复制目标 provider 的 settings_config → ~/.claude/settings.json (temp 文件 → 原子 rename)
   d. 在 provider 列表里把目标的 isCurrent 改为 true,其他改为 false
   e. 顶部红色 InfoBar 出现 3 秒 "已切换到 [Provider 名]",自动消失
4. 状态栏更新 "当前: <新 provider>"
```

**Friction 要避免**:任何同步 IO 卡 UI 线程、500ms 以上的等待没反馈、切换后新卡片没立刻高亮(要等读盘结果)。

### 4.3 编辑单个 provider 的 token

```
1. 用户双击某 provider 卡片 → 打开"详情/编辑"对话框
2. 看到表单:name / baseUrl / models / API 格式 / notes / token(默认 ●● 遮罩)
3. 点 token 字段的"👁"图标 → 显示完整字符串
4. 改 token,其他字段不动
5. 点 [保存草稿] → 写本地库(不动 ~/.claude/settings.json)
6. 点 [保存并切换] → 写本地库 + 写 settings.json(备份旧)
7. 点 [取消] → 放弃
```

**Friction 要避免**:误点 "保存并切换" 改了激活配置 → 必须有明确文案"将更改写入当前生效的 settings.json?确认?"。

### 4.4 MCP toggle

```
1. 用户点左侧 [MCP] → 切换到 MCP 管理页
2. 看到 6 个 server 卡片,每行有 ToggleSwitch
3. 点 "sequential-thinking" 的开关 → 关闭
4. 应用:
   a. 读 ~/.claude.json 当前内容(完整,保留 numStartups / userID / projects/*)
   b. 修改 mcpServers.<name> = 删除这一项(或设置 disabled=true)
   c. 原子写回 ~/.claude.json
   d. UI ToggleSwitch 立刻显示 "关"
5. 顶部红色 InfoBar "sequential-thinking 已禁用"
6. 用户下次启动 Claude Code 时生效
```

**Friction 要避免**:写 `~/.claude.json` 时破坏其他键 → 必须深拷贝 + 只改 `mcpServers` 子键。

### 4.5 查询用量

```
1. 用户在主页 → provider 卡片右下角看到用量徽章
   ┌────────────────┐
   │ ● 35% ████░ 5h │
   │   62% ██████ 1w│
   │   28% ██░░░ 1m │
   └────────────────┘
2. 双击卡片 → 详情页看到完整 QuotaPanel
3. 点 [刷新] → 应用调 provider 的 API → 重新渲染
4. 显示 "上次更新: 2 分钟前 · 缓存 5 分钟"
```

**Friction 要避免**:多 provider 时重复打 API 浪费额度 / 慢 → 5 分钟内存缓存(per provider)。

### 4.6 导入 cc-switch 备份的 .sql

```
1. 用户点左侧 [导入] → 切换到导入页
2. 拖入 / 选择 .sql 文件
3. 应用解析(.sql 是 SQLite dump 格式,INSERT INTO ... VALUES (...))
4. 显示预览页:
   ┌────────────────────────────────────┐
   │ 解析到 5 个 provider,6 个 MCP      │
   ├────────────────────────────────────┤
   │ ☐ GLM-4.6 (官方) base=... ✓        │
   │ ☐ DeepSeek-V3   base=... ✓ (重命名)│  ← 冲突
   │ ☐ 自定义        base=... ✓        │
   │ ☐ ...                              │
   ├────────────────────────────────────┤
   │ 5 个将被导入,1 个因 ID 冲突被跳过  │
   │              [取消]  [导入]         │
   └────────────────────────────────────┘
5. 用户调整勾选 → 点 [导入]
6. 库更新,跳回主页
```

**Friction 要避免**:导入破坏现有配置 → 永远先预览再确认;同 ID 的 provider 默认 "重命名",用户可改为 "替换" / "跳过"。

---

## 5. UI / UX 设计

### 5.1 整体布局

```
┌────────────────────────────────────────────────────────────────────┐
│ Claude 配置管理器                              [_] [□] [×]          │  ← 标题栏
├────┬───────────────────────────────────────────────────────────────┤
│    │                                                               │
│ 🏠 │  提供商                              [搜索] [+ 新建] [导入]    │  ← 页面头
│ 提商│  ─────────────────────────────────────────────────────────   │
│    │  ⦿ GLM-4.6 (官方)        base=...    [已激活]   [切换]         │
│    │    5 个模型 · 上次使用 2 分钟前                                 │
│    │  ─────────────────────────────────────────────────────────   │
│ 🔌 │  ○ DeepSeek-V3           base=...    [启用]     [切换]         │
│    │    3 个模型 · 上次使用 昨天                                    │
│ MCP│  ─────────────────────────────────────────────────────────   │
│    │  ○ 自定义-内部代理        base=...    [启用]     [切换]         │
│ 📥 │    1 个模型 · 从未使用                                         │
│ 导入│                                                               │
│    │                                                               │
│ ⚙️  │                                                               │
│ 设置│                                                               │
├────┴───────────────────────────────────────────────────────────────┤
│ 当前: GLM-4.6 · 配置文件: C:\Users\...\settings.json              │  ← 状态栏
└────────────────────────────────────────────────────────────────────┘

布局元素:
- 左侧固定宽度 80px 导航栏(可折叠到 40px 图标模式)
- 主内容区,ScrollViewer 包裹
- 底部状态栏固定,显示当前激活的 provider + settings.json 路径
```

### 5.2 页面清单

| 页 | 用途 | 核心控件 |
|---|---|---|
| **主页(Provider List)** | 列出所有 provider,1 键切换 | 搜索框 + 卡片列表 + 空状态 |
| **MCP 管理** | 6 个 server 的 enable toggle | 列表 + ToggleSwitch + 新增/编辑/删除按钮 |
| **导入** | 3 种入口:.sql / deeplink / 当前 settings.json | 拖放区 + 解析预览 |
| **设置** | 主题 / 备份策略 / 快捷键 / 关于 | 分组折叠列表 |

### 5.3 provider 卡片设计

```
┌──────────────────────────────────────────────────┐
│ ⦿ GLM-4.6 (官方)                  ● 35% 62% 28%   │  ← 名字 + 用量徽章
│   https://api.anthropic.com                       │  ← baseUrl
│   5 个模型:claude-opus-4, sonnet, haiku...        │  ← 模型列表
│   官方 · 上次使用 2 分钟前                        │  ← 元数据
│                                  [切换] [⋯]       │  ← 操作(默认隐藏,hover 显现)
└──────────────────────────────────────────────────┘

  ↑ 激活状态:左边 2px 蓝色条 + ⦿ 圆点改为实心 + 右上 "● 已激活" 徽章
  ↑ hover 状态:右边 [切换][⋯] 按钮组 200ms 淡入
  ↑ 用量徽章:3 个小横条(5h / 1w / 1m 百分比),颜色按 §5.7
```

### 5.4 JSON 编辑器设计

```
┌─┬──────────────────────────────────────────────────────┐
│ │ {                                                    │  ← 行号
│1│   "env": {                                            │
│2│     "ANTHROPIC_BASE_URL": "https://api.anthropic...",│  ← 字符串=绿
│3│     "ANTHROPIC_AUTH_TOKEN": "●●●●●●●●●●●●",         │  ← token 遮罩
│4│     "ANTHROPIC_MODEL": "claude-sonnet-4-6"           │
│ │   },                                                 │
│ │   "enabledPlugins": {                                │  ← key=蓝
│ │     "superpowers": true,                             │  ← bool=紫
│ │     "leyline": true                                  │
│ │   }                                                  │
│ │ }                                                    │
└─┴──────────────────────────────────────────────────────┘
  ↑
  顶部 [格式] [保存] [Token 遮罩 ◯]      ← 工具栏
  解析错误时:顶部红色 InfoBar 显示 "Line 4: Expected ',' or '}'"
  200ms 防抖校验,失焦时不卡
```

**配色**(语法高亮):
- 字符串:绿(`#008000`)
- key:蓝(`#0066CC`)
- 数字:橙(`#CC6600`)
- bool/null:紫(`#800080`)
- 标点(括号/逗号/冒号):灰(`#666666`)
- 注释:浅灰(`#999999`)

### 5.5 MCP 卡片设计

```
┌──────────────────────────────────────────────────┐
│ sequential-thinking         [编辑] [删除]         │
│ Sequential thinking via MCP                        │  ← 描述
│ 命令: npx -y @modelcontextprotocol/server-sequential│
│ 已启用: ●                                            │  ← ToggleSwitch
└──────────────────────────────────────────────────┘
```

新增/编辑对话框字段:`id`(必填,小写,库内唯一) / `name` / `description` / `command` / `args`(列表,每行一项,旁边 × 删) / `env`(KEY=VALUE 行) / 启用 toggle。

### 5.6 导入页设计

```
┌────────────────────────────────────────────────────┐
│ 导入配置                                            │
│                                                    │
│  ┌──────────────────────────────────────────┐      │
│  │                                          │      │
│  │   拖入 .sql 文件 / 选择文件 / 粘贴 URL   │      │
│  │                                          │      │
│  │   或点 [选 .sql] / [粘贴 deeplink] /     │      │
│  │      [从当前 settings.json 导入]          │      │
│  └──────────────────────────────────────────┘      │
│                                                    │
│  解析后预览:                                       │
│  ┌──────────────────────────────────────────┐      │
│  │ ☐ GLM-4.6 (官方)        [保留] [重命名]   │     │
│  │ ☐ DeepSeek-V3           [保留] [替换]     │     │
│  │ ...                                       │     │
│  │ 5 个将被导入, 1 个因 ID 冲突被跳过         │     │
│  │              [取消]  [导入]               │     │
│  └──────────────────────────────────────────┘      │
└────────────────────────────────────────────────────┘
```

**Friction 避免**:
- 拖入时不立即解析,显示"准备解析..."(避免长文件卡 UI)
- 解析中显示 ProgressRing + "正在解析 X 行..."
- 完成后才出现预览,没解析完不显示 [导入] 按钮

### 5.7 用量卡片设计

```
┌────────────────────────────────────────────────────┐
│  GLM-4.6 用量                          [刷新 🔄]   │
│  ─────────────────────────────────────────────    │
│  最近 5 小时                  12.4M / 50M (24%)   │
│  ████████░░░░░░░░░░░░░░░░ 绿色(< 50%)              │
│  下次重置: 2 小时 15 分钟后                         │
│                                                    │
│  最近一周                    180M / 1B (18%)     │
│  █████░░░░░░░░░░░░░░░░░░ 绿色                      │
│  下次重置: 周一 0:00                                │
│                                                    │
│  最近一个月                  720M / 5B (14%)      │
│  ████░░░░░░░░░░░░░░░░░░ 绿色                      │
│  下次重置: 2 月 1 日                                │
│                                                    │
│  上次更新: 2 分钟前 · 缓存 5 分钟                   │
└────────────────────────────────────────────────────┘
```

用量进度条颜色规则:
- < 50%:绿(`#4CAF50`)
- 50-80%:黄(`#FFC107`)
- > 80%:红(`#F44336`)

错误状态(替代整个卡片):
- `401` → "认证失败 — 检查 token"
- `429` → "请求过快 — 60 秒后再试"
- `NotSupported` → "此供应商暂不支持余量查询"(灰卡)

### 5.8 视觉规范

| 元素 | 规范 |
|---|---|
| 主题 | 跟随系统 light/dark,可手动覆盖;默认 = 系统 |
| 背景 | 操作系统原生毛玻璃效果(Win11 Mica / macOS vibrancy / Linux 透明) |
| 强调色 | 操作系统系统色,**不覆盖** |
| 字体 | UI 用系统默认;代码/JSON 用等宽字体(Cascadia Code / SF Mono / 系统等宽) |
| 间距 | 4px 网格(默认间距 8px) |
| 圆角 | 卡片 8px,按钮 4px,弹窗 12px |
| 字号 | 标题 16-20px,正文 14px,辅助 12px |
| 禁用色 | 0.4 透明度的文字 |
| 错误色 | 红(`#D32F2F`) |
| 成功色 | 绿(`#388E3C`) |

### 5.9 微交互

| 行为 | 表现 |
|---|---|
| 切换 provider 成功 | 顶部红色 InfoBar 滑入 3 秒自动消失 |
| 编辑 provider 保存 | 弹窗关闭,主页对应卡片 1 次高亮闪烁 |
| 删除 provider | 模态确认,确认后卡片向左滑出消失 |
| 拖入文件到主页 | 自动跳到导入页,文件已预填 |
| Hover 卡片 | 200ms 后右侧操作组淡入(显示 [切换] [⋯]) |
| 切换激活 provider | 旧卡片的 2px 蓝色条 200ms 滑出,新卡片蓝色条滑入 |
| 用量刷新中 | 卡片内部 ProgressRing 替换进度条,完成后进度条 300ms 数值动画 |
| 第一次启动 | 主页 [新建] 按钮上方 TeachingTip "点这里新建第一个 provider",5 秒后自动消失 |

### 5.10 键盘快捷键

| 快捷键 | 行为 | 作用域 |
|---|---|---|
| `Ctrl+N` | 新建 provider | 全局(TextBox 聚焦时禁用) |
| `Ctrl+I` | 跳到导入页 | 全局 |
| `Ctrl+F` | 聚焦搜索框 | 主页 |
| `Ctrl+S` | 保存当前编辑 | 编辑对话框 / JSON 编辑器 |
| `Ctrl+Shift+F` | 格式化 JSON | JSON 编辑器 |
| `F5` | 切换到当前选中 provider | 主页(列表有选中时) |
| `Delete` | 删除选中项 | 列表有焦点时 |
| `Enter` | 打开详情 | 列表有焦点时 |
| `Esc` | 关闭弹窗 / 清空搜索 | 上下文相关 |

**TextBox 聚焦时快捷键不触发**(系统快捷键优先于应用快捷键)。

### 5.10 资源浏览页(Plugins / Skills / Commands / MCPs)

**目的**:把 `~/.claude/settings.json` 中实际启用的资源可视化,让用户在不打开文件的情况下:
- 看当前启用了哪些 plugin / skill / command / MCP
- 一键启用 / 禁用某项
- 跳到"在线安装"页(本工具的市场页)
- 查看资源详情(来源仓库 / 描述 / 文件列表)

**布局**:4 个 tab(`TabView` 或 4 个并列 `ListView`),默认显示 **Plugins**。

```
┌────────────────────────────────────────────────────────┐
│ 资源浏览                          [搜索] [跳到市场页 →] │
│ ─────────────────────────────────────────────────────  │
│ [Plugins]  [Skills]  [Commands]  [LSP]  [MCP Servers]  │  ← tabs
│ ─────────────────────────────────────────────────────  │
│ 启用 / 全部 7 / 全部 3 / 全部 0 / 全部 0 / 启用 6      │  ← summary
│                                                        │
│ ☑ superpowers  (来自 superpowers@marketplace)         │
│   提供 meta-skill 系统,自动学习 + 决策辅助            │
│   [禁用] [查看文件]                                    │
│                                                        │
│ ☐ leyline  (来自 leyline@marketplace)                  │
│   Claude 工具集(plugins / skills)                       │
│   [启用] [查看文件]                                    │
│                                                        │
│ ☐ spec-driven-engineering  (来自 SDE@marketplace)     │
│   规约驱动开发插件                                     │
│   [启用] [查看文件]                                    │
│ ─────────────────────────────────────────────────────  │
│ 当前激活: 3 / 7 已启用 · 来源: 2 个仓库                  │
└────────────────────────────────────────────────────────┘
```

**数据来源**:
- `enabledPlugins` / `enabledSkills` / `enabledCommands` / `enabledLsp` / `mcpServers` 字段(具体见 §3.4 表)
- 仓库元数据:从 `extraKnownMarketplaces` 字段读仓库名 → git URL → 用 `git ls-remote` 或 `git clone --depth 1` 后读 `manifest.json` / `marketplace.json` 拿资源列表 + 描述
- **本工具不实现 git clone 的 host 代码** — 抽象 `IGitHost` 接口,各 OS 提供 spawn git 的实现,业务层只调接口

**交互规则**:
- 切换 toggle → 走 §6.6 资源启用的 settings.json 写入路径(原子写,先备份)
- 操作完成 → 顶部红色 InfoBar 3 秒
- 资源显示**实际启用状态**(`enabledPlugins["x"] = true` 才显示 ☑,不依赖本地资源文件是否存在 — 防止用户删了文件但 settings 还启用导致 Claude Code 报"找不到"的尴尬)
- 资源名旁边的 marketplace 标签显示来源,例如 `(来自 superpowers@marketplace)` — 用户能看出哪个仓库带来的
- [查看文件] 按钮:在 OS 默认文件管理器中 `reveal in folder`(`open <path>` on macOS, `explorer <path>` on Windows, `xdg-open <path>` on Linux)

**性能要求**:
- 资源列表 **50 项内 < 200ms 渲染**
- 仓库元数据(marketplace.json / manifest.json)按需懒加载 — 只在点进具体资源时拉,不在 tab 切换时全部拉
- 5 分钟内重复查同一仓库元数据走内存缓存

**空状态**:
- 没有任何启用资源时:
  ```
  ┌──────────────────────────┐
  │    [大图标]              │
  │    还没有启用任何资源    │
  │                          │
  │    [去市场页安装] (主)  │
  │    [导入 .sql]     (次)  │
  └──────────────────────────┘
  ```

### 5.11 配置智能优化页(Optimizer)

**目的**:一键发现 `~/.claude/settings.json` 的可优化项,按风险分级,安全项一键应用。

**布局**:左 70% 优化项列表 + 右 30% 当前 settings.json 摘要(只读预览,看改了什么)。

```
┌──────────────────────────────────────────┬─────────────────┐
│ 配置优化检查                              │ 当前 settings   │
│ ──────────────────────────────────────  │ ──────────────  │
│ 扫描 ~/.claude/settings.json             │ env 字段:32   │
│                                          │ 已知:30        │
│ ▼ 安全(可一键应用)  3 项                 │ 未知:2(可能用户 │
│   ☑ 启用 prompt cache,token 复用 -70%     │ 自定义)        │
│   ☑ 关闭非必要流量(匿名使用统计归零)    │                 │
│   ☑ timeout 60s → 600s(长任务不中断)     │ 已扫描 13 项   │
│                                          │ 跳过 4 项      │
│ ▼ 需确认(应用前问 1 次) 1 项             │ (用户故意设置)  │
│   ☐ 关闭自动升级(防半夜升到不兼容版本)   │                 │
│                                          │                 │
│ ─ 已忽略(点重置取消) 0 项                │                 │
│                                          │                 │
│           [应用 3 项]  [导出报告]  [取消] │                 │
└──────────────────────────────────────────┴─────────────────┘
```

**交互规则**:
- 扫描:点 [重新扫描] → 走 §3.5 清单 → 输出结果,自动勾选安全项,需确认项默认不勾选
- [应用 N 项]:
  1. 合并到 `env` map(已存在的字段保留值,新加的添加)
  2. 先备份 `~/.claude/settings.json` → `settings.json.bak.<ts>`
  3. 原子写
  4. 自动重新扫描,验证
  5. 顶部红色 InfoBar "已应用 3 项优化,建议重新启动 Claude Code"
- [导出报告]:把扫描结果 + 当前 settings.json 摘要导出为 `<app-data>/optimization-report-<ts>.md`
- [忽略全部]:把当前所有"安全"项加到 `<app-data>/optimization-ignored.json`,下次扫描不显示
- 在设置页有"重置已忽略项"按钮

**规则**:
- **任何"不可改"项绝不出现**在这个页面(防止用户误点改了 baseUrl / hooks)
- 任何"需确认"项必须有明确的"为什么需要确认" hover tooltip
- 任何"已扫描但跳过"项显示在底部"已扫描,跳过 X 个",hover 显示跳过的字段名(透明,不让用户怀疑"是不是漏了")

### 5.12 备份与恢复页

**目的**:把 F13 备份恢复从 settings 页的隐藏功能升级为独立 L1 页面,让用户能:
- 看 `settings.json` 最近 N 个版本的时间线
- 一键回滚到任意版本
- 比对任意两个版本的字段级 diff
- 手动触发一次备份(立刻)

**布局**:`ListView` 时间线 + 详情面板(选中的版本内容 + 字段级 diff)。

```
┌─────────────────────────────────────────────────────────┐
│ 备份与恢复                                               │
│ ──────────────────────────────────────────────────────  │
│ 保留最近 10 个版本 · 自动保留 [设置]                      │
│                                                         │
│ [立刻备份] [恢复选中的] [比对选中的 2 个]                 │
│                                                         │
│ ☑ 2 分钟前 · 切换到 GLM-4.6 (官方)  · 1.2 KB            │  ← 选中
│ ☐ 5 分钟前 · 切换到 DeepSeek-V3     · 1.4 KB            │
│ ☐ 昨天  18:30 · 用户编辑 settings.json · 1.5 KB         │
│ ☐ 前天  09:15 · 自动备份(应用启动时) · 1.3 KB            │
│ ...                                                      │
│                                                         │
│ ──────────────────────────────────────────────────────  │
│ 选中版本详情:                                             │
│ env.ANTHROPIC_BASE_URL = https://api.anthropic.com     │
│ env.ANTHROPIC_AUTH_TOKEN = ••••••••                     │
│ env.ANTHROPIC_MODEL = claude-sonnet-4-6                  │
│ ...                                                      │
│                                                         │
│ [查看完整内容] [与现在比对]                              │
└─────────────────────────────────────────────────────────┘
```

**规则**:
- **不删超过 N 个的最旧备份** — 用户在 settings 页可改 N(默认 10,范围 1-50)
- "用户编辑 settings.json" 的检测:每次启动应用 + 切换前备份,都从 settings.json 当前 mtime / 内容 hash 检测是否被外部修改过 → 是则独立生成新备份,名字加 "用户编辑" 标记
- 备份列表按时间倒序,最上面是最新的
- 选 1 个版本 + [恢复选中的] → 弹确认 → 走切换流程(备份当前 settings.json → 写回旧版本)
- 选 2 个版本 + [比对选中的 2 个] → 弹 diff 窗口(字段级 — 加 / 删 / 改)
- 备份文件存在 `<app-data>/backups/settings.json.bak.<ts>`(命名规则与 §6.1 一致)

### 5.13 资源市场页(Marketplace)

**目的**:F17 在线安装的入口页面。

**布局**:左 30% 内置推荐仓库 + 右 70% 仓库详情。

```
┌────────────────────┬────────────────────────────────────┐
│ 资源市场            │ 选中:superpowers                   │
│ ─────────────────  │ 来源: https://github.com/...        │
│                    │ ─────────────────────────────────  │
│ ▼ 推荐仓库         │ 描述:                               │
│   ▸ superpowers    │   Meta-skill 系统,自动学习...       │
│   ▸ leyline        │                                    │
│   ▸ spec-driven... │ ▼ 包含的 Plugins(7)               │
│   ▸ document-skills│   ☑ plugin-a (已安装)             │
│                    │   ☐ plugin-b (未安装)             │
│ ▼ 自定义仓库       │   ...                               │
│   [+] 添加 git URL  │                                    │
│                    │ ▼ 包含的 Skills(5)                │
│                    │   ...                               │
│                    │                                    │
│                    │ [全部安装] [按需选择] [查看源码]   │
└────────────────────┴────────────────────────────────────┘
```

**规则**:
- 推荐仓库硬编码 5-10 个在 `<app-data>/recommended-repos.json`(后续可改远程)
- 自定义仓库:用户填 git URL → 应用 `git clone --depth 1` 到 `<app-data>/marketplaces/<name>/` → 扫描 `marketplace.json` 或 `manifest.json` 拿资源列表
- 仓库被克隆后,资源列表里**只显示"已克隆到本地"的资源** — 没克隆的仓库里所有资源标"未安装,先克隆仓库"
- 安装某资源:确认 dialog → 把该资源从仓库 `<marketplace>/<type>/<name>/` 复制到 `~/.claude/<type>/<marketplace>/<name>/` → 写 `enabled<Type>["<marketplace>:<name>"] = true`
- 卸载:从 `~/.claude/<type>/<marketplace>/<name>/` 删除(不删仓库本身)

**关键约束**:
- 资源**安装前必须确认**用户的"是 / 否"(防误装)
- 安装过程**必须显示进度条**(网络操作可能慢)
- 失败必须可回滚(保留原 settings.json 备份)

---

## 6. 业务规则(必须遵守)

### 6.1 数据完整性

- **任何时候**写入 `~/.claude/settings.json` 或 `~/.claude.json` 之前,**必须先备份**当前文件到 `*.bak.<timestamp>`(时间戳格式 `yyyyMMdd-HHmmss`)
- **原子写入**:写临时文件 `*.tmp.<guid>` → 调平台原子 rename(Windows `MoveFileEx` / POSIX `rename()` 都是原子的覆盖)
- **不破坏未知字段**:从 `~/.claude/` 读 JSON → 改要改的字段 → 完整写回,**未识别的字段原样保留**(用 `JsonNode` 遍历,不能 `JsonSerializer.Deserialize<T>` 后再 Serialize,会丢字段)

### 6.2 切换流程(强一致)

切换 provider 的 4 步必须**全部成功**才算切换完成,任一步失败回滚:
1. 备份当前 `~/.claude/settings.json` → `settings.json.bak.<ts>`
2. 把当前配置回填到"上次激活"的 provider 的 `settings_config`(防丢失)
3. 写新 provider 的 `settings_config` → `settings.json` (临时 → 原子 rename)
4. 更新内存中的 `isCurrent` 标记

如果第 3 步失败,已经生成的 `.bak.<ts>` 文件保留供用户回滚,**不要尝试"恢复"**——直接报错给用户。

### 6.3 冲突解决(导入时)

两个 provider 同 `id` 时:
- 默认行为:**重命名**(追加 `-imported` 后缀,例:`deepseek-v3` → `deepseek-v3-imported`)
- 用户可选:每个 provider 独立选择 "保留" / "替换" / "跳过"

### 6.4 缓存与刷新

| 数据 | 缓存策略 | 失效触发 |
|---|---|---|
| `~/.claude/settings.json` 读 | 不缓存,每次显示前重读 | 应用启动 / 窗口 focus / 切换后 |
| 本地库(`providers.json`) | 启动时读一次,写后立即重读 | 新建 / 导入 / 切换 / 删除后 |
| 用量查询结果 | 内存缓存 5 分钟(per provider) | 手动点 [刷新] / 切换为活跃 provider 时 |

**绝不允许"30 秒内对同一 provider 重复打 3 次用量 API"** — 这是用户额度的浪费。

### 6.5 错误处理

| 场景 | 表现 |
|---|---|
| 切换失败(写盘错误) | 顶部红色 InfoBar "切换失败: <错误>",状态栏保持旧 provider |
| 解析 settings.json 失败 | 应用启动时显示"无法读取 Claude 配置: <错误>",提供"打开 settings.json"按钮 |
| 解析 .sql 失败 | 导入页显示"无法解析文件: Line X 列 Y - <错误>",禁用 [导入] 按钮 |
| 用量 API 401 | 该 provider 用量卡片变红,显示"认证失败 — 检查 token",**不影响其他功能** |
| 用量 API 429 | 显示"请求过快 — 60 秒后再试",retry-after 秒后自动重试(只在用户当前会话) |
| `~/.claude/` 不存在 | 主页顶部灰色 banner "未检测到 Claude Code 安装",禁用 [切换] 按钮,只读浏览 |

### 6.6 资源启用 / 禁用的 settings.json 写入路径(F16/F17)

资源 toggle(启用 / 禁用 plugin / skill / command / LSP / MCP)不是改 settings.json 顶层某个字段 — 是修改**对应类型的 map 字段**,且必须保留 settings.json 的所有其他字段。

| 操作 | 触发的 settings.json 改动 |
|---|---|
| 启用 plugin X | `enabledPlugins["marketplace:X"] = true`(缺 map 则创建空 map) |
| 禁用 plugin X | `enabledPlugins.Remove("marketplace:X")`(map 变空则整个字段从 settings.json 删除) |
| 启用 skill X | `enabledSkills["marketplace:X"] = true` |
| 禁用 skill X | `enabledSkills.Remove("marketplace:X")` |
| 启用 command X | `enabledCommands["marketplace:X"] = true` |
| 禁用 command X | `enabledCommands.Remove("marketplace:X")` |
| 启用 LSP X | `enabledLsp["marketplace:X"] = true` |
| 禁用 LSP X | `enabledLsp.Remove("marketplace:X")` |
| 启用 MCP X | **不是写 settings.json**;写 `~/.claude.json` 的 `mcpServers["X"] = {...}` |
| 禁用 MCP X | `mcpServers.Remove("X")` |
| 卸载仓库 | `extraKnownMarketplaces.Remove("marketplace")`;不删该 marketplace 下的资源文件(用户可能想保留本地副本) |

**关键规则**:
- 任何资源 toggle 都走 §6.1 原子写 + 备份
- 任何资源 toggle **不影响** `env.*` 字段(那是 provider 切换的范畴)
- 多个资源 toggle **批量** 应用:用户先勾选,后点 [应用] → 一次原子写(避免 5 次切换造成 5 个 bak 文件)
- 资源 map 字段全空时(用户禁用了所有插件)→ 把整个字段从 settings.json 删除(不留空 map 污染)

### 6.7 优化项目的安全分级(F18)

按 §3.5 清单的三级分类:

| 等级 | 处理 |
|---|---|
| **安全** | 默认勾选 + 一键应用 + 不弹确认;用户可单独取消勾选 |
| **需确认** | 默认不勾选;勾选后弹 1 次 dialog 解释为什么 + 让用户确认 |
| **不可改** | 不出现在 UI;只可能作为"已扫描但跳过"项的 hover 提示 |

**特殊规则**:
- "自动升级"类(disable_auto_updater)即使是"需确认"也要默认**不勾选**(用户可能故意保持升级通道)— 不预判用户意图
- "thinking effort" / "editor" 永远是"需确认"(用户偏好)
- 任何"会改变 API 调用行为"的项目(比如 timeout)即使是"安全"也要在应用后顶部 InfoBar 提示"建议重启 Claude Code"

**已忽略列表**:
- 用户点 [忽略全部] → 写 `<app-data>/optimization-ignored.json`:
  ```json
  {
    "ignored": [
      {"key": "ANTHROPIC_PROMPT_CACHE_ENABLED", "ignoredAt": "2026-06-18T17:30:00Z"}
    ]
  }
  ```
- 下次扫描时,key 在 ignored 列表里的项不显示(即使"安全")
- 设置页"重置已忽略"按钮清空此文件

**冲突保护**:
- 优化应用前先备份 `settings.json` → `settings.json.bak.<ts>`
- 应用后**自动重新扫描** — 验证没有引入新问题
- 如果用户 5 秒内点 [撤销] → 读最近 .bak 文件回写

### 6.8 单实例 + 文件关联(F20)

**启动流程**:
```
[启动]
  ↓
IPlatformSingleInstance.TryAcquire(out lock)
  ↓
true  → 我是主实例 → 正常初始化 + 订阅 PrimaryReceivedArgs 事件
false → 我是新实例 → 调 SendArgsToPrimary(args) → 退出
  ↓
[主实例收到 args]
  ↓
解析 args[0] = .sql / .json 文件路径
  ↓
切到导入页 + 预填该文件 + 自动开始解析
```

**OS 实现矩阵**:

| OS | 锁机制 | Args 传递 | 触发时机 |
|---|---|---|---|
| **Windows** | `AppInstance.FindOrRegisterForKey` | `RedirectActivationToAsync(args)` | OS shell 双击 .sql 时 |
| **macOS** | `NSApplication.shared.delegate` + `LSMultipleInstancesProhibited=YES` | `NSAppleEventManager` `kAEOpenDocuments` | Finder 双击 / `open` 命令 |
| **Linux** | PID file in `/tmp/ClaudeConfigManager.lock` + `flock` | DBus / Unix domain socket | `xdg-mime` / `.desktop` 文件 |

**抽象接口**(实现者必须提供,业务层不直接调 OS API):
```
IPlatformSingleInstance
{
    /// Try to become the primary instance.
    /// Returns true if THIS process is primary; false if another instance is running.
    bool TryAcquire(out IDisposable lock);

    /// Send args to the primary instance. Only valid when TryAcquire returned false.
    /// The primary instance receives PrimaryReceivedArgs event.
    void SendArgsToPrimary(string[] args);

    /// Event fired on primary instance when new instance sends args.
    event Action<string[]> PrimaryReceivedArgs;
}
```

**规则**:
- 如果 .sql 文件路径不存在 / 不可读 → 弹错 InfoBar,不要静默吞
- 同一个文件被多次双击 → 主实例只处理一次(去重)
- 单实例锁**不阻止正常退出**(用户点关闭 → 释放锁 → 下次双击能开新进程)

### 6.9 备份保留策略(F19)

- **保留数量**:设置页可调,默认 10,范围 1-50
- **触发时机**:
  1. 切换 provider 前(已有)
  2. MCP toggle 前(已有)
  3. 资源 toggle / 启用 / 禁用 / 卸载**批量应用**前
  4. 优化项应用前
  5. 应用启动时:如果 `settings.json` 当前 mtime 比最新 .bak 的 mtime 新,且 hash 不同 → 自动备份一次,标记"用户编辑"
- **清理规则**:每次新备份生成时,检查 .bak 数量,超过保留数量 → 删最旧的
- **不被覆盖**:任何 .bak.<ts> 文件创建后,名字 = 时间戳,**永不重名**
- **不被自动清空**:用户清空备份列表是手动操作(设置页 [清空全部历史] 按钮)

---

## 7. 非功能需求

### 7.1 性能

- **应用启动 < 2 秒**(到主页面可交互)
- **切换 provider < 1 秒**(从点击到看到 UI 反馈)
- **JSON 编辑 60fps**(5-10 KB 配置,边输入无卡顿)
- **列表 50 个 provider 流畅滚动**(虚拟化列表,不可一次性渲染全部 DOM)
- **内存占用 < 200 MB**

### 7.2 可用性

- **必须异步 IO**:所有文件读写走 async API,UI 线程不被阻塞
- **必须 debounce 搜索**:输入停止 300ms 后才过滤
- **必须 debounce JSON 校验**:输入停止 200ms 后才解析
- **绝不阻塞主线程**超过 16ms(= 60fps 一帧)

### 7.3 可靠性

- **数据零丢失**:任何写盘操作前必须备份,原子 rename
- **崩溃恢复**:应用崩溃时不破坏 `~/.claude/...`(因为写盘是原子的)
- **错误可见**:任何失败必须用用户能看懂的文字提示,**不静默吞错**
- **.sql 导入容错**:某一行解析失败不影响其他行,最后报告 "X 个成功,Y 个失败"

### 7.4 部署

- **单一可执行文件**(用户双击就跑,无安装)
- **零外部依赖**(不需要预装 .NET / Python / Node / 其他 runtime)
- **平台 native 安装体验**:
  - Windows: 启动 .exe 即可,可选 MSIX 安装
  - macOS: .app bundle,拖到 /Applications
  - Linux: AppImage / deb / rpm
- **占用磁盘 < 150 MB**(含所有运行时)

---

## 8. 验收清单

每条都有具体可执行的验证命令 / 步骤。

### 8.1 基础

- [ ] 双击应用图标 < 2 秒到主页面
- [ ] 主页面显示已导入的 provider 列表(无则显示空状态)
- [ ] 当前激活 provider 有 2px 蓝色条 + "● 已激活" 徽章
- [ ] 状态栏底部显示 "当前: <provider>" 和 settings.json 路径
- [ ] 主题跟随系统(macOS 用户切 dark mode 时应用立即切)

### 8.2 切换

- [ ] 在 5 个 provider 间逐个点 [切换],每次 < 1 秒
- [ ] 切换后激活标记正确更新
- [ ] 切换后 `~/.claude/settings.json` 内容 = 新 provider 的 settings_config
- [ ] `~/.claude/settings.json.bak.<ts>` 文件存在,内容 = 切换前的旧配置
- [ ] 状态栏底部文本更新

### 8.3 编辑

- [ ] 双击卡片打开编辑对话框
- [ ] 点 [👁] icon 让 token 在 ●● 和完整字符串间切换
- [ ] 改任意字段 → [保存草稿] → 库更新,settings.json **不动**
- [ ] 改任意字段 → [保存并切换] → 库更新 + settings.json 更新 + 激活标记更新
- [ ] 取消按钮关闭对话框,所有改动丢弃
- [ ] JSON 编辑器打开 .sql 中典型 5KB 嵌套 JSON,语法高亮 + 缩进正确
- [ ] JSON 编辑器中输入错误 JSON(去一个逗号),200ms 后顶部出现红条提示哪一行
- [ ] `Ctrl+Shift+F` 格式化当前 JSON
- [ ] `Ctrl+S` 触发 [保存并切换] 流程

### 8.4 MCP

- [ ] MCP 页显示 6 个 server,每行有 ToggleSwitch
- [ ] 关闭一个 toggle → `~/.claude.json` 的 mcpServers 对应项消失 / disabled
- [ ] 关闭后 `~/.claude.json.bak.<ts>` 存在
- [ ] `~/.claude.json` 中 `numStartups` / `userID` / `projects/*` 字段**完全保留**
- [ ] 重新打开 toggle → 该 server 重新出现在 mcpServers
- [ ] 点 [新增] 弹出表单,填完后该 server 出现在列表

### 8.5 用量

- [ ] 主页 provider 卡片右下角显示 3 个小横条用量徽章
- [ ] 双击卡片 → 详情页 QuotaPanel 显示 3 张时间窗卡片
- [ ] 点 [刷新] 立即调 API + 缓存 5 分钟
- [ ] 5 分钟内重复点 [刷新] **不打 API**(显示缓存时间)
- [ ] 401 错误 → 卡片变红,显示"认证失败 — 检查 token"
- [ ] 不支持的 provider → 灰卡 "此供应商暂不支持余量查询"

### 8.6 导入

- [ ] 拖 .sql 文件到主窗口 → 自动跳到导入页,文件已选
- [ ] 解析 25MB 的 cc-switch .sql(5 claude + 6 MCP)< 5 秒
- [ ] 预览列表显示 5 个 provider + 6 个 MCP,带勾选框
- [ ] 底部显示 "5 个将被导入, 1 个因 ID 冲突被跳过"
- [ ] 冲突项默认 "重命名",可改为 "替换" / "跳过"
- [ ] 改 token 字段后再导入,token 保持原样
- [ ] 导入 SQL 中的 `\"C:/Program Files/nodejs/node.exe\"` 行能正确解析(嵌套转义)

### 8.7 健壮性

- [ ] `~/.claude/` 不存在 → 主页灰 banner,禁用切换
- [ ] 手动删除 `providers.json` → 下次启动自动重建空库
- [ ] 手动改坏 `providers.json`(非法 JSON)→ 备份为 `.bak.<ts>` + 应用启动正常 + 主页空状态
- [ ] 应用在切换中强制退出 → `settings.json` 要么是旧值要么是新值(原子 rename 保证),不会半写
- [ ] 切到没有 API 文档的 provider → 卡片显示"用量未知",其他功能正常

### 8.8 资源浏览(F16)

- [ ] 资源浏览页 5 个 tab(Plugins / Skills / Commands / LSP / MCP Servers)显示当前 settings.json / claude.json 中实际启用的资源
- [ ] 每个 tab 顶部显示 "启用 / 全部 X" 摘要(如 "启用 3 / 全部 7")
- [ ] 资源项显示名称 + 来源 marketplace 标签 + 描述 + 启用 toggle + [禁用] [查看文件] 按钮
- [ ] 切 toggle 立即生效(settings.json 改对应 map 字段,原子写)
- [ ] 批量勾选 + [应用] 只产生 1 个 .bak 文件(不是每个 toggle 一个)
- [ ] 启用的资源如果本地文件被用户删了,**仍显示 ☑**(settings.json 启用状态为准,不假设本地文件存在)
- [ ] 资源名 marketplace 标签格式 `(来自 <name>@<marketplace>)`,可一眼看出来源
- [ ] [查看文件] 按钮在 OS 文件管理器中 reveal 资源文件(Windows `explorer /select`,macOS `open -R`,Linux `xdg-open`)
- [ ] 资源列表 50 项内 < 200ms 渲染
- [ ] 仓库元数据 5 分钟内重复查走内存缓存

### 8.9 在线安装(F17)

- [ ] 资源市场页左 30% 显示内置推荐仓库(superpowers / leyline / spec-driven-engineering / document-skills 等 5-10 个)
- [ ] 自定义仓库:输入 git URL → 自动 git clone 到本地 + 扫描 marketplace.json → 资源列表
- [ ] 选中一个仓库,右 70% 列出该仓库所有 plugins / skills / commands / LSP,每个带 ☑ 复选框(已安装的默认 ☑)
- [ ] 选 [全部安装] → 一次原子写 settings.json,启用所有选中资源
- [ ] 选 [按需选择] → 用户逐项勾选,后点 [应用] → 一次原子写
- [ ] 安装过程显示 ProgressRing(网络操作可能慢)
- [ ] 失败时弹错 + 不修改 settings.json(原状态保留)
- [ ] 卸载:从 `~/.claude/<type>/<marketplace>/<name>/` 删除 + 写 enabled<Type>.Remove
- [ ] 卸载**不删仓库本身**(用户可能想保留本地副本)
- [ ] 卸载后,资源项在浏览页立刻变 ☐(下个刷新周期)

### 8.10 配置智能优化(F18)

- [ ] 打开优化页 → 走 §3.5 清单扫描 → 显示结果
- [ ] 安全项默认勾选,需确认项默认不勾选,不可改项不出现
- [ ] [应用 N 项] 一次原子写 + 自动备份 + 自动重新扫描
- [ ] 应用后顶部 InfoBar 提示"已应用 N 项优化,建议重启 Claude Code"
- [ ] 5 秒内点 [撤销] → 读最近 .bak 文件回写
- [ ] [忽略全部] 把当前安全项加到 `<app-data>/optimization-ignored.json`
- [ ] 下次扫描自动跳过 ignored 列表中的项
- [ ] 设置页"重置已忽略"按钮清空 ignored 文件
- [ ] [导出报告] 生成 `<app-data>/optimization-report-<ts>.md`,含扫描结果 + 当前 settings.json 摘要
- [ ] 任何"不可改"项绝不出现在 UI(只能作为"已扫描但跳过"项的 hover 提示)
- [ ] "自动升级"类默认不勾选(尊重用户意图,即使标为"安全")

### 8.11 备份与恢复(F19)

- [ ] 备份页时间线显示最近 N 个版本(默认 10)
- [ ] 选 1 个版本 + [恢复] → 弹确认 → 走切换流程(备份当前 settings.json → 写回旧版本)
- [ ] 选 2 个版本 + [比对] → 弹 diff 窗口(字段级 — 加 / 删 / 改)
- [ ] 立刻备份按钮 → 立刻生成一个新 .bak 文件
- [ ] 应用启动时如果 settings.json 被外部修改过(mtime + hash 检测)→ 自动生成新备份,标记"用户编辑"
- [ ] 备份数量超过 N(设置可改,默认 10)→ 删最旧的
- [ ] 备份列表按时间倒序,最上面最新
- [ ] 设置页"清空全部历史"按钮 → 弹确认 → 删所有 .bak 文件

### 8.12 单实例 + 文件关联(F20)

- [ ] 第一次启动 → 正常初始化,创建单实例锁
- [ ] 不退出第一个实例,双击 .sql 第二次启动 → 第二个进程 0.5 秒内退出,第一个实例切到导入页 + 预填该文件 + 自动开始解析
- [ ] 单实例锁**不阻止正常退出**(用户点关闭 → 释放锁 → 下次能开新进程)
- [ ] 同一文件被多次双击 → 主实例只处理一次(去重)
- [ ] 锁的 OS 实现:
  - Windows:`AppInstance.FindOrRegisterForKey` + `RedirectActivationToAsync`
  - macOS:`NSApplication.shared.delegate` + `kAEOpenDocuments`
  - Linux:PID file + `flock` 或 DBus
- [ ] 双击 .sql 但文件不存在 → 弹错 InfoBar"文件不存在: <path>",不静默

---

## 9. 范围(显式)

### 9.1 v1.1 必做(本 SPEC 范围)

| # | 功能 |
|---|---|
| 1 | Provider 列表 + 1 键切换 |
| 2 | .sql 导入 + deeplink 导入 + 当前 settings.json 导入 |
| 3 | Provider 表单编辑 + JSON 编辑器 |
| 4 | MCP 列表 + 增删改 + 启用 toggle |
| 5 | 用量查询(Anthropic / DeepSeek / OpenAI 兼容 / NotSupported) |
| 6 | 搜索 + 键盘快捷键 + 主题 + 备份恢复 |
| 7 | 单一可执行文件部署 |
| 8 | **资源浏览**(plugins / skills / commands / LSP / MCPs) |
| 9 | **在线安装**(内置推荐仓库 + 自定义 git URL + 资源勾选安装) |
| 10 | **配置智能优化**(13 项清单扫描,3 级风险,一键应用) |
| 11 | **备份与恢复**升级为独立页(N 版本时间线 + diff) |
| 12 | **单实例 + 文件关联**(双击 .sql 跳到已运行实例) |

### 9.2 v1.2+ 延后(本 SPEC 不做)

| 类别 | 原因 |
|---|---|
| JSON 编辑器自动补全 | 复杂(需 parser-state engine);用户能用 Ctrl+Shift+F 格式化 + 高亮已足够 |
| JSON 编辑器 minimap | 装饰性,大文件性能损耗 |
| Provider 列表拖拽重排 | WinUI3 / SwiftUI / GTK 都要重写;非核心 |
| 用量历史趋势图 | 需持久化时间序列;v1.1 只需当前值 |
| 自动故障转移 | 用户手动切换已够;复杂 |
| Tray icon + 全局快捷键 | 个人工具,主动开 app 即可 |
| 主题市场 / 插件系统 | 范围爆炸 |
| 远程同步 (WebDAV/S3) | 多人协作,本工具是单用户 |
| 自动更新 / 遥测 / 崩溃报告 | 涉及隐私 + 发布渠道,延后 |

### 9.3 不做(永久排除)

| 类别 | 原因 |
|---|---|
| 其他 client 支持(Codex / Cursor / Gemini / OpenCode 等) | 用户明确只做 Claude;cc-switch 的 7-client AppSwitcher 不移植 |
| 多用户 / 团队功能 | 个人工具 |
| 云端 AI 推理 / 模型路由 | 不在工具定位内 |
| Claude Code 自身功能扩展(对话 / 命令) | 用户要的是"配置 Claude Code",不是"替代 Claude Code" |

---

## 10. i18n / 国际化

**v1.1 单语言**:简体中文(zh-CN)
- 所有 UI 文字硬编码中文
- 不引入 i18n 框架
- 字符串集中放一个文件(如 `Strings.zh-CN.cs`),便于未来扩

**v1.2+**:可加 en-US,字符串放 `Strings.en-US.cs`

---

## 11. 风险与开放问题

### 11.1 已知风险

| 风险 | 缓解 |
|---|---|
| 不同 OS 路径处理差异(`~` / `$HOME` / `%APPDATA%` / `$XDG_DATA_HOME`) | 抽象 `IPlatformPaths` 接口,各 OS 单独实现,实现者保证正确 |
| Claude Code 平台特定配置目录 + 文件格式可能升级 | 写盘前深读完整,只改 `mcpServers` 子键,其他字段保留为 `JsonNode` 透传 |
| Provider API 改动(Anthropic / DeepSeek / OpenAI 改 endpoint) | `IUsageProvider` 抽象隔离;新 provider 用 1 个 class + 1 行 DI |
| 单文件 .exe 在不同 OS 需要不同打包方式 | 见 §7.4 各 OS 部署要求 |

### 11.2 开放问题(实现时决定)

1. **首次启动引导**:要不要 TeachingTip?要不要"导入示例 .sql"按钮?—— 本 SPEC 不强制,实现者可自定
2. **provider 删除确认**:模态确认框还是 undo toast?—— 本 SPEC 用模态(更安全)
3. **导出格式**:provider 导出用什么格式?—— `.json`(用户问的)还是 `.sql` 兼容 cc-switch?—— 建议 `.json` + 用户可手动导入
4. **MCP 字段标准化**:MCP server 的 `command` + `args` + `env` 是不是所有实现都一样的语义?—— Claude Code 平台定义,实现者照搬

---

## 12. 已知冲突项 / 未做 TODO(实现前必读)

> 以下是 v1.1 规划过程中被显式提出但**未纳入本 SPEC 范围**的改动,以及跟当前 §5/§2 描述**直接冲突**的决策。**实现者重新开发时必须决定:接受本 SPEC 的版本,还是按 §12 调整**。

### 12.1 已细化的 backlog(3 个 todo → 可执行 spec)

#### 12.1.1 `claude-config-validation.md` — 配置检测 + 一键修复

**目标**:在 §5.11 配置优化页基础上,扩展为"全检测 + 分级修复"工作流,把"安全 / 需确认 / 不可改"分级细化到**实际可修复**的层面。

**详细范围**:
- **静态扫描**(`settings.json` + 库自身):
  - `ANTHROPIC_*` 字段拼写错误(白名单 diff,例 `ANTRHOPIC_AUTH_TOKEN` → `ANTHROPIC_AUTH_TOKEN`)
  - 必填字段缺失(库 + live)
  - 协议不匹配(`baseUrl` 必须是 `https://` 或 `http://127.0.0.1:*`)
  - 路径引号缺失(`C:/Program Files/...` 没加引号)
  - 重复 id(库内 + 跨库)
  - 未知 key(标记为"黄标"但保留 — Phase 11 LiveConfig.Extra 已落地)
- **语义扫描**(读 library + 当前 live):
  - provider 缺 quota endpoint 但注册为 `AnthropicUsageProvider` → 警告
  - `baseUrl = api.openai.com` 但注册为 `AnthropicUsageProvider` → 警告
  - MCP command 路径不存在 → 红标
  - 同时启了两个互斥的 provider
- **一键修复分级**:
  - **真一键**:纯机械,无副作用,静默执行 — 拼写纠正 / 引号 / 转义 / null 清理 / 字段重命名 / 重复 id 加后缀
  - **需 dialog**:工具知道有问题,不知道正确值 — 缺 URL/Token 弹 dialog / 协议不匹配让用户选 / 缺 model 选下拉
  - **做不到**:Token 类 / MCP 路径 / 业务判断 / 错配 — 只展示,不承诺修复
- **UI**:InfoBar issue list(分组:真一键 / 需 dialog / 做不到),每条带 [修复] 或 [查看] 按钮

**依赖**:
- 本 SPEC §5.11 配置优化页(已规划)
- 本 SPEC §6.1 原子写 + 备份(继承)
- 调研 cc-switch `src-tauri/src/validator.rs` 作为参考(实现者调研)

**验收清单**:
- [ ] 检测能识别至少 8 种 issue 类型(拼写 / 缺失 / 协议 / 引号 / 重复 id / 未知 key / quota 错配 / MCP 路径)
- [ ] 真一键修复 < 1 秒完成且不弹 dialog
- [ ] 需 dialog 的修复点 dialog 关闭后立即应用
- [ ] 任何 fix 不破坏 settings.json 的未识别字段
- [ ] 修复记录写到 `<app-data>/validation-fixes.log`(便于追溯)

**v1.1 / v1.2 判定**:当前 SPEC 列入 v1.2+ 候选(因依赖 §5.11 优化页 + 调研 cc-switch validator.rs)。**实现者重做时可拉前到 v1.1**,只要把本节当成需求给实现者就行。

#### 12.1.2 `claude-tool-management.md` — 资源管理(已部分纳入本 SPEC §5.10/5.13)

**目标**:**本 SPEC §5.10 资源浏览 + §5.13 资源市场已覆盖此 TODO 的 80%**。**剩余 20%(可放 v1.2+)**:
- 资源文件内容的预览 / 内嵌编辑(SKILL.md 全文预览,不让用户切到外部编辑器)
- 仓库依赖图(一个 plugin 依赖哪些 skill)
- 远程推荐列表拉取(从 JSON URL,而不是硬编码)
- 资源版本约束(指定 plugin 安装 v1.2.3 而非 latest)

**依赖**:
- 本 SPEC §3.4 资源类型
- 本 SPEC §6.6 资源启用路径
- 调研 cc-switch `src/components/repo/`

**验收清单(本 SPEC 已覆盖)**:
- [x] 资源浏览页 5 个 tab 显示当前启用状态
- [x] 内置推荐仓库 5-10 个(硬编码)
- [x] 自定义仓库 git URL → 克隆 + 扫描
- [x] 资源勾选安装
- [x] 卸载(不删仓库)
- [ ] 资源文件内嵌预览 / 编辑(本 SPEC 未做,v1.2+)
- [ ] 依赖图 / 版本约束(v1.2+)

**v1.1 / v1.2 判定**:**本 SPEC §5.10/5.13 = v1.1 必做,覆盖 80%**;剩余 20% 走 v1.2+。

#### 12.1.3 `cli-operation-mode.md` — CLI 100% GUI 覆盖

**目标**:`--cli` 入口 + 一次性子命令 + `--json` 输出 + 100% GUI 路径覆盖的 e2e 测试套件。**测试 = 应用完整功能规格说明书**。

**详细范围**:
- **CLI 入口**:`WinUIScaffold --cli` 不启动 GUI,走完整 DI 初始化(复用 `AddClaudeConfigManagerServices` 等价抽象)
- **子命令列表**(13 个核心功能各 1 个 + 复合操作):
  | 子命令 | 对应 GUI 功能 | 状态 |
  |---|---|---|
  | `list-providers` | F1 主页 | 必做 |
  | `switch <id>` | F2 切换 | 必做 |
  | `import <path>` | F3 导入 .sql | 必做 |
  | `deeplink <url>` | F4 deeplink 导入 | 必做 |
  | `edit <id> <json>` | F5 编辑 | 必做 |
  | `mcp list / add / edit / toggle / delete` | F6 MCP | 必做 |
  | `quota [provider-id]` | F7 用量 | 必做 |
  | `resources list / enable / disable` | F16 资源 | 必做 |
  | `marketplace add / install / remove` | F17 安装 | 必做 |
  | `optimize scan / apply` | F18 优化 | 必做 |
  | `backup list / restore` | F19 备份 | 必做 |
  | `validate scan / fix` | §12.1.1 检测 | 必做 |
  | `interactive` | REPL 模式(可选 v1.2+) | 延后 |
- **输出**:`--json` 标志切 JSON,默认 human-readable
- **e2e 测试**:**每个子命令 ≥ 1 个 e2e 测试,断言副作用(库文件 / settings.json / claude.json 内容)**
- **覆盖率要求**:**100% GUI 路径通过 CLI 测试覆盖**

**依赖**:
- 业务层必须 OS 无关(UI 框架抽象成接口,业务层调接口)— 否则 CLI 调不动 UI 层的代码
- DI 容器必须能在无 WinUI3 / GUI 运行时启动(否则 CLI 启不来)

**验收清单**:
- [ ] 13 个子命令全部实现 + 每个有 ≥ 1 e2e 测试
- [ ] 测试套件跑通 = 应用所有功能跑通
- [ ] `--json` 输出格式稳定(给脚本用,不破坏向后兼容)
- [ ] CLI 模式启动 < 2 秒(无 WinUI3 启动开销)
- [ ] CLI 模式不依赖 .NET 之外的 runtime

**v1.1 / v1.2 判定**:v1.1 必做 12 个一次性子命令(13 个里跳过 REPL);100% 覆盖率作为 v1.1 发布门槛。

### 12.2 UI/UX 决策跟本 SPEC 冲突(`/planning/tmp/ui-clarifications.md`)

用户在 2026-06-17 chat 中追加的 6 条澄清,**覆盖了本 SPEC §5 的部分设计**。如果实现者采用本 SPEC 的版本(§5.1 左 rail + 4 个 L1 原计划),就忽略 §12.2;如果采用澄清文件的版本,就要改 §5。

| # | 澄清项 | 跟本 SPEC §5 冲突 | 决策记录 |
|---|---|---|---|
| 1 | **list + edit 同一窗口 + 顶部导航栏可后退** | §5.3 卡片设计是 "双击卡片打开对话框";改后变成 "点卡片 → 切到 L2 详情页" | 跟 §12.2 #3 联动 |
| 2 | **设计语言统一单窗口** | 跟 §5.1 一致(单窗口 OK) | 取消 "NavigationView 是唯一选项" 的硬约束 |
| 3 | **L1 底部 TAB + L2 顶部 nav bar + back** | §5.1 是 `NavigationView` 左 rail | **冲突**:实现者二选一;选这个要重画 §5.1/§5.2/§5.3 |
| 4 | **瓷白主题 + 液态玻璃 / 磨砂 / 亚克力半透** | §5.8 是 "系统主题 + 毛玻璃"(macOS vibrancy / Win Mica) | **冲突**:实现者二选一;选这个要按 Apple HIG Liquid Glass 标准学习 + 实现 |
| 5 | **新 L1 重构** | §5.2 主页 = Provider List;改成:Claude 配置管理 / Token 消耗统计 / 备份与恢复 / 设置(4 个) | **已部分采纳**:本 SPEC §5.11 优化 + §5.12 备份与恢复 已升级为独立页 |
| 6 | **单 EXE + 同级 config 目录** | §2.2 写的是 `%APPDATA%\ClaudeConfigManager\`;改后:`{exeDir}\Config\providers.json` | **冲突**:Phase 1 / Phase 9 路径要改;`~/.claude/settings.json` 路径不变(用户 Claude Code 自己的) |

### 12.3 跟本 SPEC §9 范围(延后 / 不做)有冲突的项

| 冲突项 | 本 SPEC 状态 | 澄清文件 / TODO 状态 | 实现者判断 |
|---|---|---|---|
| **备份与恢复**(MCP / skill / 插件 / 全部 Claude 配置) | §9.1 升级为 v1.1 必做(11) | 澄清 #5 要求进 v1.1 L1 | **已采纳** |
| **Claude 工具管理页**(仓库浏览 / Skills / Commands) | §9.1 必做(8/9)+ §5.10/5.13 覆盖 80% | TODO `claude-tool-management.md` 要求 v1.1 | **大部分已采纳**;剩 20%(内嵌编辑 / 依赖图) v1.2+ |
| **配置检测 + 一键修复** | §12.1.1 细化(可作 v1.1 子任务或 v1.2+) | TODO `claude-config-validation.md` v1.2+ 候选 | 实现者选 |

### 12.4 仍未回答的开放问题(连 SPEC 都还没定)

- v1.1 是否要"单实例"(双击 .sql 时跳到现有窗口)?—— **已采纳**:本 SPEC §5.1 + §6.8 详写,F20 核心功能
- v1.1 备份文件保留多少个?—— **已采纳**:本 SPEC §6.9 + §8.11,默认 10,范围 1-50
- "从当前 settings.json 直接导入" 是 L1 还是 L2?—— §5.6 写 L1 拖放区;澄清 #5 把它降为 L2 子操作。**实现者二选一**
- 推荐仓库列表的"内置硬编码 5-10 个"具体是哪几个?—— TODO `claude-tool-management.md` 没列。**本 SPEC §5.13 给参考**:superpowers / leyline / spec-driven-engineering / document-skills 是 4 个推荐起点,实现者定具体列表
- §5.11 优化页"安全 vs 需确认"分级是基于**假设**的 Claude Code 默认行为 — 实际可能因 Claude Code 版本变化而变化 → 实现者需要在 Phase 9 重新校准清单

---

## 附录 A:真实数据样本

实现时需要验证的样本数据:

| 文件 | 路径 | 用途 |
|---|---|---|
| cc-switch 备份的 .sql(25MB) | `D:\project\winui3\cc-switch-export-20260617_155944.sql` | 导入功能测试,含 5 claude + 6 MCP |
| 当前 Claude Code 配置 | `~/.claude/settings.json` + `~/.claude.json` | 实机集成测试 |

样例 .sql 中的关键测试点:
- 5 个 Claude provider(`app_type='claude'` 的行)
- 6 个 MCP server(其中 `enabled_claude=1` 的有 6 个)
- 第 364 行附近:嵌套转义 `\"C:/Program Files/nodejs/node.exe\"` 在 SQL 的单引号字符串里
- 跳过:`app_type` 是 `codex` / `gemini` / `opencode` 的行(本工具不导入)

## 附录 B:参考产品(UX 借鉴)

`D:\project\cc-switch-main` 是已落地的同类工具(Tauri + Rust + React,7 client 支持)。**本 SPEC 借鉴其 UX 模式但不复制代码**:

| 借鉴 | 文件 | 适配方式 |
|---|---|---|
| Provider 卡片视觉 | `src/components/ProviderCard.tsx` | 重写为本工具的视觉规范(本 SPEC §5.3) |
| 列表筛选 + 搜索 | `src/components/ProviderList.tsx` | 同 §5.1 |
| 1 键切换 | `src/components/ProviderList.tsx` switch action | 同 §4.2 |
| MCP 列表 | `src/components/UnifiedMcpPanel.tsx` | 简化为只 Claude 1 栏(本 SPEC §5.5) |
| JSON 编辑 | `src/components/JsonEditor.tsx` | **不复制 CodeMirror**;本工具手写高亮(本 SPEC §5.4) |
| 用量 footer | `src/components/UsageFooter.tsx` | 重写为 QuotaPanel(本 SPEC §5.7) |
| 原子写盘 | `src-tauri/src/config.rs:239-249` | **改用 `File.Move(overwrite: true)`**(比 cc-switch 的 `remove+rename` 更原子) |
| deeplink 解析 | `src-tauri/src/deeplink/parser.rs` | 重新实现;格式相同,API 不同 |

## 附录 C:实现自由度的边界

实现者可自由选择(本 SPEC 不约束):
- 编程语言(任何能编译/打包成单文件的)
- UI 框架(native / web / 跨平台任一)
- 数据存储格式(本 SPEC 只说"2 空格缩进 JSON",可换 msgpack / sqlite 等)
- 进程内状态管理(MVVM / Redux / 类 Flux / 单例任一)
- 异步模型(Task / Promise / coroutine / actor 任一)
- 用量查询的 HTTP 客户端(native / library 任一)
- 测试框架(xUnit / pytest / XCTest / 任何)
- git 客户端实现(本 SPEC §3.4 §5.13 抽象成 `IGitHost` 接口,实现者自己写 spawn git 的 OS 实现)

实现者**必须遵守**(本 SPEC 约束):
- §2 数据模型字段(含 `enabledPlugins` / `enabledSkills` / `extraKnownMarketplaces` 资源 map)
- §3.4 资源类型(5 类资源 + marketplace)
- §3.5 优化项目清单(13 项 + 三级风险)
- §5 UI/UX 规范(用户视角)— 含 §5.10 资源浏览 + §5.11 优化 + §5.12 备份 + §5.13 市场
- §6 业务规则(原子写、备份、冲突解决、缓存、资源写入路径、优化分级、单实例、备份保留)
- §7 非功能需求(性能 / 可靠性)
- §8 验收清单(含 §8.8-8.12 新增 5 组)
- §9 范围(12 个核心功能全必做,§9.1 列表为准)
- §12.1.3 CLI 100% 覆盖(如果做 v1.1,这是发布门槛)

## 附录 D:Day-in-the-life 端到端流程

把 12 个核心功能(F1-F8 + F16-F20)串成一个完整故事,**实现者跑通这个流程 = v1.1 完工**:

```
[Day 1] 首次使用
  1. 用户双击应用图标 → 应用启动,空状态显示
  2. 用户点 [从当前配置导入] → F1 列出 1 个 provider(从 ~/.claude/settings.json 读出)
  3. 用户点 [导入 .sql] → F3 解析 25MB cc-switch 备份 → 5 个 provider + 6 个 MCP 入库
  4. 主页显示 5 个 provider,1 个标 [● 已激活]
  5. 用户点 [切换] 一个 provider → F2 1 秒切换,InfoBar "已切换到 X"
  6. 用户点 [切换] 另一个 provider → 第一个被回填到库(§6.2 backfill)

[Day 3] 编辑 + 优化
  1. 用户双击一个 provider → F5 JSON 编辑器打开 settings_config
  2. 用户改 token,Ctrl+S → F4 弹"保存草稿 / 保存并切换" dialog
  3. 用户选 [保存并切换] → §6.2 流程跑完
  4. 用户点 [优化检查] → F18 扫到 3 个安全项 + 1 个需确认项
  5. 用户勾 3 个安全项,点 [应用] → §6.7 原子写 + 自动重扫
  6. InfoBar 提示 "已应用 3 项优化,建议重启 Claude Code"

[Day 5] 加资源
  1. 用户点 [资源市场] → F17 看内置 5 个推荐仓库
  2. 用户选 superpowers 仓库 → 右栏显示该仓库 7 plugins / 5 skills
  3. 用户勾 3 个 plugin + 1 个 skill,点 [应用] → §6.6 批量原子写 enabledPlugins / enabledSkills
  4. 用户点 [资源浏览] → F16 看到 3 个新启用的 plugin + 1 个 skill(带 [禁用] 按钮)
  5. 用户禁用一个 plugin → enabledPlugins 移除 + 备份 + InfoBar

[Day 7] 出问题回滚
  1. 用户改完 settings.json 启 Claude Code,挂了
  2. 用户打开本工具 → F19 备份与恢复页
  3. 用户看到最近 10 个版本,选 2 天前那个 → [恢复]
  4. 弹确认,用户点 [确认] → 走 §6.2 流程(备份当前 → 写回旧版本)
  5. Claude Code 重启 OK

[Day 10] 双击 .sql 第二次触发
  1. 用户在 Finder / Explorer 双击一个新 .sql → F20 单实例跳到已运行实例
  2. 新进程 0.5 秒内退出,已运行实例切到导入页 + 预填该 .sql
  3. 用户点 [导入] → 5 个新 provider 入库

[Day 14] MCP 调整
  1. 用户点 [MCP] → F6 看到 6 个 server
  2. 用户 toggle 一个 → §6.1 原子写 ~/.claude.json
  3. 用户新增一个 MCP → F6 ContentDialog 填字段 → 校验(id 小写、唯一)→ 写库
  4. Claude Code 重启,该 MCP 生效

[Day 30] 用量监控
  1. 用户在主页看到 5 个 provider 卡片,每个右下角 F7 用量徽章
  2. 用户点 GLM-4.6 卡片 → 详情页 QuotaPanel 显示 5h/1w/1m 三个时间窗
  3. 用户点 [刷新] → 5 分钟内重复点不打 API(§6.4 缓存)
  4. 401 错误 → 卡片变红,提示"认证失败 — 检查 token"
  5. 用户检查 token → 切换到 DeepSeek 顶一会(§6.2)
  6. 回到 GLM-4.6 → 详情页用量重新查,这次 200 → 卡片恢复

[自动化] CI 跑 CLI 测试
  1. 开发者改完代码 push → CI 跑 WinUIScaffold.CliTests 项目
  2. CLI 13 个子命令各 1+ 个 e2e 测试(§12.1.3)
  3. 100% GUI 路径覆盖 → 测试通过 = v1.1 真的能跑
  4. publish 131 MB self-contained EXE → 干净 Windows 11 装机双击 OK
```

实现者按这个流程逐个跑通 → 12 个核心功能都触达 + 所有边界情况被发现。
