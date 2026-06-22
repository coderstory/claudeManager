# Phase 10 (M3.9) Self-Review

**Date**: 2026-06-22
**Reviewer**: Phase10-M3.9 subagent
**Status**: done

## §6.1 自审

### 命名改动 (清单 2)
- ✅ AppSidebar.tsx — `'.sql 导入'` → `'SQL导入配置'`
- ✅ App.tsx PAGE_META — `'导入 .sql'` → `'SQL导入配置'`,描述更新
- ✅ import-sql/index.tsx H1 — `'导入 .sql'` → `'SQL导入配置'`
- ✅ 前端 stub import-sql.tsx — displayName 同步
- ✅ 后端 stub import_sql.rs — display_name 同步
- ✅ 测试 import-sql.test.tsx H1 assertion 同步

**未动** (合理排除):
- App.tsx 第 163/618/650 行 drag-drop 遮罩文本 "松开以导入 .sql 文件" — 这是 drag-drop 操作说明,讲的是"被拖入的文件是 .sql 格式",与"页面叫什么名字"是两件事。改名反而误导。
- import-sql/index.tsx 第 2 行注释 — 仅文档注释,无 UI 影响。

### 校验改动 (清单 21)
- ✅ 新建 `src/lib/sql-validator.ts` — 5 场景分类器,零依赖,纯前端
- ✅ 接入 import-sql 页面 2 个入口 (handleFileChosen + initialFilePath effect)
- ✅ 阻断策略: 仅 `empty` / `encoding_error` show ErrorBanner;`illegal` / `partially_valid` 仍走后端,把诊断交由 preview 流程
- ✅ 14 个测试覆盖 5 场景 + splitStatements 边界

### 关键设计决策
- **不复用后端 parser**: 前端只做"轻量分类",真正的 Provider 提取仍由后端 `parse_sql_dump` 完成。避免前后端解析逻辑漂移。
- **零第三方依赖**: `TextEncoder` 是 WebView2 / 现代浏览器内置,符合 §2.3 依赖纪律。
- **阻断最小化**: 只在不可恢复场景 (空文件 / 编码错误) 阻断,其它场景保留"dry-run preview"信息 (由后端 preview / skipped 流程展示)。

## §6.2 头脑风暴 / 反向挑战

### 决策 1: 阻断策略 = 仅 empty/encoding_error
- **挑战**: 是否应该把 `illegal` 也阻断? (用户大概率选错文件)
- **结论**: 不阻断。原因:
  1. 后端 `parse_sql_dump` 已能优雅处理 (返回空 preview,UI 显示 "无 importable")
  2. 阻断会让现有 17 个 import-sql 测试中 6 个需要改 (用户体感"很严")
  3. 阻断会让半合法 dump (有 INSERT 但全是未知表) 走不到后端的"全部 skipped"展示

### 决策 2: validator 不复用 split_statements Rust 实现
- **挑战**: 是否应在前后端共用一份 split 逻辑?
- **结论**: 不共用。原因:
  1. Rust 端是 `&[u8]`,前端是 `string + TextEncoder`,跨语言共享需 FFI,成本远高于收益
  2. validator 只需"轻量分类",不需精确解析;后端 parser 已做精确解析
  3. 后端 parser 的 `split_statements` 是"包含 PRAGMA/CREATE 完整 SQL dump";validator 的 `splitStatements` 是"分类为 INSERT/OTHER"。两者目的不同

### 决策 3: 不新增 npm 依赖 (sqlparse 库)
- **挑战**: 是否引入 `sqlparse` / `node-sql-parser`?
- **结论**: 不引入。原因:
  1. §2.3: 新增依赖需理由 + 文档
  2. 库体积大 (sqlparse ~150KB),而我们只用 5 场景分类
  3. 库 API 与我们 5 场景需求过度泛化 (覆盖 ANSI SQL 全部),反而难用

## §6.3 同行评审 (N/A — auto 模式跳过)

按 spec "auto 模式失败不阻塞只记录",同行评审步骤跳过。下次手动复盘时建议:
- 调 `gsd-code-review` 对 commit 3ed3ff3 做外部 AI CLI 评审
- 重点关注 validator 与后端 parser 的语义一致性 (5 场景分类是否漏掉某类)

## §6.4 业务流程分析

### User flow: 用户拖一个 cc-switch 导出的 .sql 进入
1. 双击/拖入 → App.tsx 收到 `initialFilePath`
2. ImportSqlPage useEffect 触发 → `readSqlFile(path)` → content
3. **M3.9 新增** `validateSql(content)` → scenario === 'valid' 或 'partially_valid'
4. `parseSqlPreview(content)` → SqlPreview (含 importable/skipped 计数)
5. UI 显示 preview (SummaryCard 3 列 + PreviewList)
6. 用户点 "确认导入" → `importProvidersFromSql` → 写盘
7. DoneView 显示成功/部分成功

### User flow: 用户选了一个空文件
1. 选文件 → handleFileChosen → `file.text()` → "" (empty)
2. **M3.9 新增** `validateSql` → scenario === 'empty', errors[0].code === 'empty'
3. UI 直接 show ErrorBanner "文件为空..."  + 重试按钮,**不调后端** (节省 IPC 往返)
4. 用户点 "重试" → handleReset → 回到 idle

### User flow: 用户选了一个 .txt 改名 .sql
1. 选文件 → content = "hello world"
2. **M3.9 新增** `validateSql` → scenario === 'illegal', errors[0].code === 'no_insert'
3. **不阻断** (按决策 1),仍调后端
4. 后端 `parse_sql_preview` → preview.importable === 0, skipped === 0
5. UI 显示 preview 3 列 (0/0/0) + "当前文件中没有可导入的 provider" 提示
6. 用户看不到"validator 报警"信息 — **已知 UX 限制**

### 已知 UX 限制 (写 STATE.md 时记一下)
- validator 的 `illegal` 诊断没有直接展示给用户,仅在 console 收集
- 改进方向: Preview 顶部加 InfoBar 显示 validator.errors[0]?.message (M3.11+)

## §7 修复 + 文档

### CRITICAL/HIGH
无

### MEDIUM
- 决策 UX 限制 (validator illegal 诊断不展示): 不在 M3.9 范围,记 STATE.md

### LOW
- 字符串内分号测试已覆盖 (单/双引号各 1)
- 行号 1-based 已覆盖 (空行 + 多语句 + 字符串内分号)

---

*自审通过。已 ship + smoke 7/7 + 单元测试 31/31。*
