# M3 & M4 路线图草案（M3 Roadmap Draft + M4 Public Release）

> 阶段：M3 用户反馈修复期 + M4 公证发布期
> 起草日期：2026-06-21
> 输入：~/Desktop/问题清单.txt（27 条）+ STATE.md §M2.16 已知限制 + §M2.17 候选 + D6~D13 决策记录
> 状态：**草案待用户核定**。M3 启动门（4 槽）需 M2.17 首批完成后派；M4 需 M3 收尾后启动。

---

## §0 上下文

- **当前进度**：M2.16 done（瓷白磨砂 + 26+ 已知限制归档完成），M2.17 启动中（待派）
- **M3 启动门 4 槽**：见 §4，待 M2.17 首批完成（4 槽）后立即派
- **M4 公证 + 发布**：等 M3 收尾后启动（不在本季度窗口）
- **桌面策略**：D9 — M2.17 启动时清空 26+ 个 M2.16 ship exe（详见 §6）
- **核心新增**：M3.10 双模式（用户 / 项目）是 M3 的**架构级新功能**，触发 F1/F13/F19 等多个 plugin 重新设计

---

## §1 27 条用户反馈清单（按优先级重排）

> 编号 = `清单 N`（对应 ~/Desktop/问题清单.txt 的原序号）。
> 优先级映射：P0 = 紧急 bug 或核心功能缺位；P1 = UI/UX 阻塞或一般 bug；P2 = 增强 / polish。

### §1.1 P0（紧急 bug + 核心需求）

| 清单 # | 主题 | 触发里程碑 | 备注 |
|---|---|---|---|
| **1** | 冷启动白屏 → 全透明 → loading 闪烁 | M3.1 启动优化 | 冷启动事件链路有 gap |
| **15** | reveal "brainstorming" 报错（explorer.exe exit 1） | M3.5 资源浏览修 bug | D13 决策 — 仍按 M3.5 排期 |
| **17** | 资源浏览 plugins 目录显示 cache 等乱七八糟 | M3.4 资源市场重构 | "显示的不对" — 数据源 / 过滤规则有 bug |
| **19** | 用量查询不生效，读不到数据 | M3.8 用量查询修 bug | 后端 HTTP / 解析链路需排查 |
| **20** | JSON 编辑器路径 bug（清单里的"读取失败"路径少 `.claude/`） | M3 启动门 槽 3 | D12 决策 — 挂入 M3 启动门，**不**插队 4 槽 |
| **22** | provider 缺少新增 / 修改 / 查看 / 删除配置功能 | M3.6 Provider CRUD | F1 只读，必须补 CRUD |
| **23** | 欢迎页改造为项目切换（用户 / 项目双模式） | M3.10 双模式 | M3 核心新功能（架构级） |
| **24** | 设置按钮点击无效 | M3.2 F2/托盘/InfoBar polish | "无效" = 缺 onClick / 路由未接 / 无权限 |

### §1.2 P1（UI polish + 一般 bug）

| 清单 # | 主题 | 触发里程碑 | 备注 |
|---|---|---|---|
| **2** | 菜单名 "SQL导入" 改成 "SQL导入配置" | M3.9 SQL 导入命名 | 纯命名改 |
| **3** | 双击托盘图标需要显示窗体 | M3.2 托盘 polish | 托盘事件缺分支 |
| **4** | sidebar 底部 "M1.9 · 架构期" 改成 "钱云飞作品" | M3.2 sidebar polish | 纯文案改（也含个人品牌） |
| **5** | 备份与恢复 — 备份文件存疑路径（应该是 `%APPDATA%\ClaudeConfigManager\backups`） | M3.2 F13 polish | 路径解析 bug |
| **9** | 配置优化 — 显示 13 个内置规则 + 绿勾 / 红 x / Fix 按钮 | M3.3 配置优化 13 规则 | "直到当前内置的 13 个规则是啥" |
| **11** | 资源市场 — 第三方仓库自动安装？还是 npx？默认用户级？ | M3.4 资源市场重构 | 安装语义确认 |
| **12** | 资源市场 — 克隆命令弹出账号密码窗口（不该克隆源码） | M3.4 资源市场重构 | 流程逻辑错误 |
| **16** | 资源浏览 — GSD-* 内容合并为 "Get Shit Done" 一类 | M3.4 资源市场重构 | 拆分显示内容太多 |
| **18** | 单文件部署 — 干啥的看不懂，"当前应用"区域抽出来做"关于"页 | M3.7 单文件部署重构 | F8 重构 |
| **21** | 导入 SQL 没校验文件合法性 | M3.9 SQL 校验 | M2.3 ship 时遗漏 |

### §1.3 P2（增强 / 优化 / 锦上添花）

| 清单 # | 主题 | 触发里程碑 | 备注 |
|---|---|---|---|
| **6** | 备份与恢复 — 差异属性名后加 ? 图标（悬浮显示作用） | M3.2 F13 polish | tooltip 增强 |
| **7** | 备份记录起别名 | M3.2 F13 polish | 备份 metadata 加 alias 字段 |
| **8** | 备份与恢复 — 右侧 JSON 框允许全屏（app 窗体内） | M3.2 F13 polish | "全屏" = 单 panel 最大化 |
| **10** | 新增配置检查项：`CLAUDE_CODE_ATTRIBUTION_HEADER=0` / `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` / `CLAUDE_CODE_EFFORT_LEVEL=max` | M3.3 配置优化 env 规则 | 3 个 env 检查项加到内置 13 规则里 |
| **13** | 资源市场新增 superpowers 安装：`/plugin install superpowers@claude-plugins-official` | M3.4 资源市场重构 | 内置插件源扩展 |
| **14** | 资源市场新增 GSD：`npx @opengsd/gsd-core@latest` + 限定全局 / 静默 / 装到 claude | M3.4 资源市场重构 | 安装命令封装 |

### §1.4 归档 / 已知限制

> 27 条全部 M3 消化，不进 M4 backlog。

---

## §2 决策记录 D6~D14

| 决策 | 主题 | 选项 | 拍板 | 简注 |
|---|---|---|---|---|
| **D6** | Mac 真机验证时机 | A 暂缓 / B M2.x / C M3 / D M4 | **A 暂缓，后续决定** | 不在 M3 启动门；放 M4 backlog |
| **D7** | F15 ErrorBanner 接入剩余页面 | A 全部 / B 仅核心页 / C 仅关键错误 | **A 扩到全部** | M3.2 顺手做 |
| **D8** | M2.16 26+ ship exe 抽查策略 | A 全部跑 / B 抽查 2 / C 不抽查 | **C 抽查 2 个**（`M2.16-m216-review-fixes.exe` + `M2.16-f15-batch2.exe`） | M2.17 启动时手动跑 |
| **D9** | M2.16 26+ ship exe 桌面清理 | A 清空到归档 / B 保留全部 / C 保留最新 3 | **A 清空到归档** | M2.17 启动时统一清（详见 §6） |
| **D10** | 17 MEDIUM/LOW 已知限制评估 | A 全部评估 / B 抽样 / C 跳过 | **A 按 M2.16-001-M~010-M 顺序全评估** | 主 session 必做 |
| **D11** | 3 件套 + M2.17 业务 4 槽并发 | A 4 槽全开 / B 3 槽 / C 2 槽 | **A 4 槽全开 + 首批 4 槽全选** | 最大化利用率 |
| **D12** | JSON 编辑器路径 bug（清单 20）挂入 M3 启动门 | A 挂入 / B 插队 4 槽 / C 延后 | **A 挂入 M3 启动门**（**不**插队 4 槽） | 启动门槽 3（半天） |
| **D13** | 清单 15 reveal 报错排期 | A M3.5 / B 提前 / C 延后 | **A M3.5 排期** | 不与 D12 抢启动门 |
| **D14** | M3.8 用量查询方向（API key / OAuth / 本地代理？） | 待定 | **待 M3 启动前再问**（主 session 必问类） | 用户输入决定技术路线 |

---

## §3 M3 — 用户反馈修复 + 双模式 + 公证准备

> 估时：6-8 周（~25-40 个工作日，含集成测试 + UI e2e + ship 验证）
> 4 槽上限（D11），优先级排序：双模式 > bug fix > polish > 新功能。

### M3.1 启动优化（清单 1）

| 字段 | 内容 |
|---|---|
| 任务来源 | 清单 1（冷启动白屏 → 全透明 → loading 闪烁） |
| 子任务 | (a) 启动事件链路梳理（Tauri setup → splash → window show → webview ready → first paint）；(b) splash 透明度时序修复；(c) webview 预加载优化；(d) loading 闪烁根因（Suspense fallback / hydration mismatch？） |
| 涉及文件 | `src-tauri/src/lib.rs`（setup / show 顺序）+ `src/main.tsx`（Suspense / loading）+ `src/components/Splash.tsx`（如存在） |
| 估时 | 2-3 天 |
| 阻塞 | 无（独立） |
| 测试 | e2e cold-start 截图对比（launch → 1s → 3s → 5s），vitest 启动事件 mock |

### M3.2 F2/托盘/InfoBar polish（清单 3/4/5/6/7/8/24 + M2.16-007-L）

| 字段 | 内容 |
|---|---|
| 任务来源 | 清单 3（双击托盘显示窗体）/ 4（sidebar 文案）/ 5（备份路径）/ 6（tooltip ? 图标）/ 7（备份别名）/ 8（JSON 框全屏）/ 24（设置按钮无效）+ M2.16-007-L 已知限制 |
| 子任务 | (a) 托盘 LeftDoubleClick handler；(b) sidebar 底部文案常量改 "钱云飞作品"；(c) 备份路径校验（`IPlatformPaths::backups_dir`）；(d) 备份差异 attribute tooltip；(e) backup metadata 加 `alias: Option<String>`；(f) F19 恢复页 JSON 框全屏 toggle（app 窗体内）；(g) 设置入口 onClick 修复；(h) D7 F15 ErrorBanner 扩到全部 |
| 涉及文件 | `src-tauri/src/platform/windows/tray.rs` + `src/pages/sidebar/index.tsx` + `src/services/backup_service.rs` + `src/components/InfoBar.tsx` + `src/pages/settings/index.tsx`（路由 + onClick） |
| 估时 | 3-4 天（8 项子任务并行） |
| 阻塞 | 无（独立，但依赖 M2.17 已 ship） |
| 测试 | 8 项每项 1 个 vitest + 1 个 playwright |

### M3.3 配置优化 13 规则 + Fix + 新增 env（清单 9/10）

| 字段 | 内容 |
|---|---|
| 任务来源 | 清单 9（显示 13 个内置规则 + 状态 + Fix）/ 10（新增 3 个 env 检查项） |
| 子任务 | (a) 内置规则清单 markdown 文档化（`docs/rules/builtin-rules.md`）；(b) 规则扫描 UI 重构：每行展示规则名 + 状态（绿勾/红 x）+ Fix 按钮；(c) Fix 按钮调用 `apply_rule_fix(rule_id)` Tauri command；(d) 3 个 env 规则加入内置列表 |
| 涉及文件 | `src-tauri/src/services/optimizer.rs` + `src-tauri/src/domain/rule.rs`（新增 env 规则 3 条）+ `src/pages/optimizer/index.tsx`（UI 重构） |
| 估时 | 2-3 天 |
| 阻塞 | 无 |
| 测试 | 13 规则扫描 fixture + 3 env 规则 fixture + Fix 原子性测试 |

### M3.4 资源市场重构（清单 11/12/13/14/16/17）

| 字段 | 内容 |
|---|---|
| 任务来源 | 清单 11/12（安装流程错乱）/ 13/14（新增插件源）/ 16（GSD 合并）/ 17（plugins 目录显示错） |
| 子任务 | (a) 安装流程重设计：明确"内置插件源 vs 第三方仓库 vs npx"三类，统一安装 API；(b) 删除"克隆源码"流程（改为 install 命令）；(c) 内置 superpowers + GSD 两个插件源（含 npx 封装）；(d) GSD-* 合并展示为 "Get Shit Done" 分类；(e) 资源浏览过滤规则：屏蔽 `cache/`, `node_modules/`, `.git/`；(f) **D6** 评估 Mac 真机验证（暂缓） |
| 涉及文件 | `src-tauri/src/services/marketplace.rs`（重写）+ `src/pages/marketplace/index.tsx` + `src/pages/resource-browser/index.tsx` + `src/lib/builtin-plugins.ts`（新增） |
| 估时 | 4-5 天 |
| 阻塞 | 无（独立子系统） |
| 测试 | 安装命令 mock + GSD 合并 fixture + 过滤规则单测 |

### M3.5 资源浏览修 bug（清单 15）

| 字段 | 内容 |
|---|---|
| 任务来源 | 清单 15（reveal "brainstorming" 报错） |
| 子任务 | (a) `IPlatformReveal::reveal_file` 错误处理增强（`Result<(), RevealError>`）；(b) `explorer.exe` exit code 1 根因排查（路径不存在 / 权限 / 32 位 shell 拦截？）；(c) 前端错误提示本地化（"无法打开该资源" + 排查建议） |
| 涉及文件 | `src-tauri/src/platform/windows/reveal.rs` + `src-tauri/src/services/resource_browser.rs` + `src/components/ErrorBanner.tsx` |
| 估时 | 0.5-1 天 |
| 阻塞 | 无（D13 决策：按 M3.5 排期） |
| 测试 | 4 个 reveal 场景：合法路径 / 不存在 / 无权限 / 网络路径 |

### M3.6 Provider CRUD + JSON 编辑器路径（清单 20/22）

| 字段 | 内容 |
|---|---|
| 任务来源 | 清单 20（JSON 编辑器路径 bug — 启动门槽 3 已修半）/ 22（provider CRUD） |
| 子任务 | (a) 启动门槽 3 验证回归；(b) provider 新增 / 修改 / 查看 / 删除 UI；(c) provider 删除走 F13 备份流程；(d) provider 修改支持 base_url / api_key_env / model 字段；(e) provider 查看只读详情页 |
| 涉及文件 | `src-tauri/src/commands/provider.rs`（CRUD 4 个 command）+ `src/services/provider_service.rs` + `src/pages/provider-list/index.tsx`（按钮行 + 弹窗） |
| 估时 | 3-4 天 |
| 阻塞 | 依赖 M3 启动门槽 3 已修清单 20 |
| 测试 | CRUD 各 2 用例 + 备份联动 + 权限校验 |

### M3.7 单文件部署重构（清单 18）

| 字段 | 内容 |
|---|---|
| 任务来源 | 清单 18（"干啥的看不懂" + "当前应用"区域抽出来做关于页） |
| 子任务 | (a) F8 单文件部署页面文案重写（解释清楚"导出单 exe" / "嵌入 WebView2" 用途）；(b) 抽出"当前应用"信息（版本 / build hash / 许可证 / 致谢）→ 新建 `pages/about/index.tsx`；(c) sidebar 路由加 "关于" 入口 |
| 涉及文件 | `src/pages/single-file-deploy/index.tsx`（文案 + UI 简化）+ `src/pages/about/index.tsx`（新建）+ `src/App.tsx`（路由） |
| 估时 | 1-2 天 |
| 阻塞 | 无 |
| 测试 | about 页 snapshot + sidebar 路由跳转 |

### M3.8 用量查询修 bug（清单 19）

| 字段 | 内容 |
|---|---|
| 任务来源 | 清单 19（用量查询不生效，读不到数据） |
| 子任务 | (a) **D14 待问**：API key 来源（用户手动 / OAuth / 本地代理）？(b) 根据 D14 决定走 Anthropic / OpenAI / 第三方代理；(c) HTTP 客户端 + 错误处理；(d) 数据缓存策略；(e) UI 表格展示 |
| 涉及文件 | `src-tauri/src/services/usage_service.rs`（重写）+ `src-tauri/src/platform/usage_provider.rs`（新增）+ `src/pages/usage/index.tsx`（重写） |
| 估时 | 3-5 天（视 D14 答案浮动） |
| 阻塞 | **D14 主 session 必问**（M3 启动前） |
| 测试 | mock HTTP 4 场景（success / 401 / 429 / network error） |

### M3.9 SQL 导入命名 + 校验（清单 2/21）

| 字段 | 内容 |
|---|---|
| 任务来源 | 清单 2（菜单改名）/ 21（SQL 没校验合法性） |
| 子任务 | (a) 菜单/页面标题 "SQL导入" → "SQL导入配置"；(b) SQL 文件 schema 校验（cc-switch 格式：CREATE TABLE providers / INSERT statements）；(c) 校验失败 ErrorBanner + 错误详情；(d) 部分合法时的 dry-run 预览 |
| 涉及文件 | `src/pages/sql-import/index.tsx` + `src-tauri/src/services/sql_import_service.rs` + `src/lib/sql-validator.ts`（新建） |
| 估时 | 1-2 天 |
| 阻塞 | 无 |
| 测试 | 合法 / 非法 / 部分合法 / 空文件 / 编码错误 5 场景 |

### M3.10 双模式 用户/项目（清单 23 — M3 核心新功能）

| 字段 | 内容 |
|---|---|
| 任务来源 | 清单 23（欢迎页改造为项目切换） |
| 子任务 | (a) 数据模型：`Project { id, name, root_dir, created_at, is_system }`；(b) 持久化：`projects.json` + F13 备份；(c) 用户级 = 特殊 `is_system=true` 项目不可删；(d) 项目级 = 指向 `<root>/.claude/` 的虚拟视图；(e) 欢迎页改"项目切换器"（下拉 + 新增/删除按钮）；(f) 所有 plugin（Provider/MCP/Optimizer/Backup）适配 `IPlatformPaths::active_root_dir`；(g) 切换项目走 F13 备份 + 原子切换；(h) UI：sidebar 顶部显示当前项目 + 切换入口 |
| 涉及文件 | `src-tauri/src/domain/project.rs`（新建）+ `src-tauri/src/services/project_service.rs`（新建）+ `src-tauri/src/platform/traits.rs`（`IPlatformPaths::active_root_dir`）+ `src/pages/welcome/index.tsx`（改造）+ `src/pages/sidebar/index.tsx`（顶部 project switcher） |
| 估时 | 5-7 天（含架构评审 + 适配所有 plugin 的回归测试） |
| 阻塞 | **架构级决策**（M3 启动门槽 1 — 见 §4） |
| 测试 | 跨 plugin 的"切换项目后行为"集成测试 + 用户/项目数据隔离单测 |

### M3 总估算

- **子任务总数**：~40 项
- **估时**：6-8 周（含集成测试 + e2e + ship + 用户核定）
- **4 槽上限**：D11 — 最多同时 4 subagent
- **关键依赖**：M3.10 是架构级变更，会触发 M3.6/M3.7/M3.8 等多个 plugin 的回归测试

---

## §4 M3 启动门 4 槽并发（D11）

> M2.17 首批完成后立即派（D11 选项 A）。

| 槽 | 任务 | 估时 | 阻塞 | 备注 |
|---|---|---|---|---|
| **槽 1** | M3.10 双模式架构设计 | 2-3 天 | 无（架构先于实现） | 输出 `docs/design/M3.10-dataflow.md` + Project domain model + `IPlatformPaths::active_root_dir` trait 变更草案；**主 session 必审** |
| **槽 2** | F17 marketplace 重构评估 | 1 天 | 无 | 评估 M3.4 子任务范围 + 现有代码 + 风险清单；输出 `docs/design/M3.4-marketplace-refactor.md`；**主 session 必审** |
| **槽 3** | 清单 20 JSON 编辑器路径 bug 修复 | 0.5 天 | 无（独立 bug） | **D12 决策**：挂入启动门，**不**插队 4 槽 |
| **槽 4** | M3.8 用量查询方向调研 | 1 天 | D14 | **D14 待问**主 session；如未问则先做"现状根因排查"输出 `docs/investigations/m3-8-usage-bug.md`；如已问则直接按选定方向设计实现方案 |

### 启动门派单前置清单（主 session）

- [ ] **D14 主 session 必问类**（M3 启动前必须拿到答案；如未拿，槽 4 降级为调研任务）
- [ ] M2.17 首批 4 槽已完成（D11）
- [ ] 桌面清理 D9 已执行（M2.16 26+ exe 清空到归档，详见 §6）
- [ ] M2.16 17 MEDIUM/LOW 已知限制已按 D10 顺序全评估

---

## §5 M4 — 公证 + 发布 + 长期 Backlog

> 估时：4-6 周（含代码签名证书申请周期，可与 M3 重叠启动）
> 触发条件：M3.10 双模式 ship 后启动 M4.1；M4.4~M4.6 需 M4.1~M4.3 收尾。

### M4.1 代码签名证书

| 字段 | 内容 |
|---|---|
| 任务 | 申请 Windows EV 代码签名证书 + macOS Developer ID |
| 估时 | 2-4 周（含证书颁发机构审核，**可与 M3 并行**） |
| 阻塞 | 无（独立流程） |
| 关键决策 | 证书颁发商选型（DigiCert / Sectigo / GlobalSign） |
| 费用 | EV 证书 ~$300-500/年，Developer ID ~$99/年（Apple 强制） |

### M4.2 公证（SmartScreen + notarization + staple）

| 字段 | 内容 |
|---|---|
| 任务 | Windows SmartScreen 提交 + macOS notarization + staple ticket |
| 估时 | 1 周（含首次审核往返） |
| 阻塞 | M4.1 证书到手 |
| 关键决策 | Windows SmartScreen 信誉积累策略（新证书前几次安装会有 SmartScreen 警告） |

### M4.3 updater 启用

| 字段 | 内容 |
|---|---|
| 任务 | 启用 Tauri updater 真实 pubkey + endpoint + E2E 更新流程 |
| 估时 | 1-2 周 |
| 阻塞 | M4.1（pubkey 关联签名） |
| 关键决策 | 更新服务器选型（GitHub Releases / S3 / 自建 CDN） |
| 风险 | M2.x updater 一直是 stub；首次启用需充分 E2E 验证 |

### M4.4 双轨打包

| 字段 | 内容 |
|---|---|
| 任务 | Windows MSI/NSIS + macOS DMG + CI matrix（Windows + macOS 真机） |
| 估时 | 2-3 周 |
| 阻塞 | M4.2（公证后才能分发） |
| 关键决策 | 打包格式选型（MSI vs NSIS for Windows；DMG vs PKG for macOS） |
| 测试 | CI matrix 在 Windows Server 2019 + macOS 14 真机分别跑完整 e2e |

### M4.5 应用商店上架（可选）

| 字段 | 内容 |
|---|---|
| 任务 | Microsoft Store + Mac App Store 上架 |
| 估时 | 2-4 周（含商店审核往返） |
| 阻塞 | M4.2 + M4.4 |
| 关键决策 | 是否上架（CLAUDE.md §1 提到"跨平台桌面工具"，但未承诺商店分发） |
| 备注 | 标 "可选" — 主 session 启动前需用户拍板 |

### M4.6 长期 Backlog

> 不在 M4 主线，按需启动。

| 主题 | 来源 | 估时 | 优先级 |
|---|---|---|---|
| F13 / F19 备份增强（增量备份 / 云备份） | M2.16 已知限制 + 用户潜在需求 | 2 周 | P1 |
| i18n 国际化（en / zh-CN） | 用户群体扩展需求 | 1-2 周 | P2 |
| SQLite 历史查询（用量 / 备份历史） | M2.x 已知限制 | 1 周 | P2 |
| 多窗口（主窗口 + 独立弹窗） | F8 单文件部署重构引申 | 1 周 | P3 |
| Telemetry（崩溃报告 + 匿名统计） | 产品质量需求 | 1-2 周 | P3 |
| L-M2.02 已知限制回归 | M2.16 STATE.md L-M2.02 | 1 天 | P3 |
| Tailwind 接入评估 | 设计系统现代化 | 待评估 | P3 |
| MacWindowChrome（vibrancy + traffic light） | M1 平台抽象层已知 stub | 2-3 天 | P2 |
| **D6 Mac 真机验证** | D6 决策暂缓 | 待定 | M4 启动前再问 |

---

## §6 桌面清理 D9

> D9 决策：**M2.17 启动时清空 26+ 个 M2.16 ship exe**到归档目录。

### 清理流程

1. **归档目录创建**：`~/Desktop/ClaudeConfigManager-archive/M2.16-<date>/`
2. **mv 操作**（用 `mv` 不是 `rm`，保留可恢复）：
   ```bash
   mkdir -p ~/Desktop/ClaudeConfigManager-archive/M2.16-2026-06-21
   mv ~/Desktop/ClaudeConfigManager-M2/ClaudeConfigManager-M2.16*.exe \
      ~/Desktop/ClaudeConfigManager-archive/M2.16-2026-06-21/
   ```
3. **保留**：M2.17 ship 的 exe（启动 M2.17 后只留最新）
4. **验证**：`ls ~/Desktop/ClaudeConfigManager-M2/` 应只剩 0-1 个 exe

### 时机

- **执行者**：M2.17 启动 subagent（CLAUDE.md §11 — 主 session 不亲自执行 shell）
- **时机**：M2.17 首批 4 槽派单**前**
- **失败处理**：归档失败不阻塞 M2.17 启动，事后手工处理

---

## §7 关键纪律提醒

> 引用 `D:\project\winui3\CLAUDE.md` 关键条款，M3 / M4 全程适用。

| 条款 | 标题 | M3/M4 重点 |
|---|---|---|
| §2.4 | 谨慎修改文件 | M3.10 双模式会触发多 plugin 回归，**改前先列白名单给用户确认** |
| §2.5 | UI/UX 是头等大事 | M3.2 polish + M3.10 双模式 UI 是 M3 的"脸面" |
| §5 | 测试纪律 | M3.10 架构变更必须**先写测试再写实现**（CLAUDE.md §2.2 TDD 强制） |
| §6 | 评审纪律 | M3.10 双模式架构设计完成后必须**自审 → 头脑风暴 → 同行评审 → 业务流程分析** 4 步走 |
| §7 | 内存/状态纪律 | M3.10 切换项目走 F13 备份 + 原子 rename |
| §9 | 迭代交付纪律 | 每个 M3.x / M4.x 子任务 ship 都按 §9.1~§9.7 走（含 smoke test） |
| §10 | 不要做 | ❌ 不要改 SPEC.md / ❌ 不要散落 OS 判断 / ❌ 不要跳过 smoke test / ❌ 不要在用户没核定前进入下一迭代 |
| §11 | 主 session 工作流 | 主 session **只做决策**，所有执行派 subagent；最多 4 槽并发（D11） |

### M3 启动前主 session 必问

> 这些问题**不**由 subagent 代答，必须主 session 当面问用户：

1. **D14**：M3.8 用量查询的 API key 来源（用户手动 / OAuth / 本地代理）？
2. **M4.5**：是否上架应用商店（Microsoft Store + Mac App Store）？
3. **M4.6 Telemetry**：是否启用崩溃报告 + 匿名统计？

### M3 启动前主 session 必审

> 这些产出 subagent 可以做，但必须主 session 拍板：

1. **槽 1（M3.10 双模式架构）**：`docs/design/M3.10-dataflow.md` + trait 变更草案
2. **槽 2（M3.4 marketplace 重构评估）**：`docs/design/M3.4-marketplace-refactor.md`
3. **D10**：M2.16 17 MEDIUM/LOW 已知限制按 M2.16-001-M~010-M 顺序全评估

---

*本文件由 M3 文档归档 subagent（临时插队任务）生成于 2026-06-21，主 session 决策 D6~D13 已拍板，待用户核定后启动 M3 启动门 4 槽。*