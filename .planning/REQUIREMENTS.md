---
gsd_requirements_version: 1.0
milestone: v3.2 (M6)
milestone_name: M6 用户实测反馈修复
shipped: pending
---

# v3.2 (M6) — Requirements

> **Goal:** v3.0.1 M5 修了 33 bug 后用户重新实测 ClaudeManager.app,根据新发现 bug 清单按 critical 优先原则 4 阶段修。
> **继承 v3.0.1 (M5)** 工程模式:M5-PLAN.md 4 阶段排序 (critical 5 → 业务 13 → 重构 9 → A 类 5+整合) + M4 e2e 15/15 ship gate + test-all 6 阶段 PASS + tag v3.2。

## v3.2 Active Requirements

### Critical Bug Fix (P0, phase 27)

> 用户实测新发现的 critical bug,阻塞主流程（备份失败 / 切换 provider 报错 / sqlite 缺表 / settings.json 解析错 等）。
> Phase 27 critical 5 — 5 fix commits,每个 commit 一个独立 fix。

- [ ] **BUG-CR-01**: 用户可以正常切换 provider (atomic backup → write → reload Claude) 不报错
- [ ] **BUG-CR-02**: 用户可以正常使用 F13 备份,备份文件可恢复
- [ ] **BUG-CR-03**: 用户可以正常用 sqlite 读 settings.json,无缺表报错
- [ ] **BUG-CR-04**: 用户可以正常用 F2 switch UI 切换 provider,无 round-trip 错
- [ ] **BUG-CR-05**: 用户可以正常用 F18 配置优化,无 finding 过期错

### 业务 Bug Fix (P1, phase 28)

> 单功能 bug,影响具体功能不阻塞主流程。

- [ ] **BUG-BZ-01**: SQL 导入过滤 — 过滤无效行
- [ ] **BUG-BZ-02**: JSON 全屏编辑可用
- [ ] **BUG-BZ-03**: JSON 目录树渲染正常
- [ ] **BUG-BZ-04**: MCP 文案修正
- [ ] **BUG-BZ-05**: 用量趋势 7 天显示正确
- [ ] **BUG-BZ-06**: 资源市场 browse URL 修正
- [ ] **BUG-BZ-07**: CliNotFound 错误信息本地化
- [ ] **BUG-BZ-08**: (留空待用户实测补)
- [ ] **BUG-BZ-09**: (留空待用户实测补)
- [ ] **BUG-BZ-10**: (留空待用户实测补)
- [ ] **BUG-BZ-11**: (留空待用户实测补)
- [ ] **BUG-BZ-12**: (留空待用户实测补)
- [ ] **BUG-BZ-13**: (留空待用户实测补)

### 重构 Bug (P2, phase 29)

> 重构类 (4 处同步 / 备份分页 / 历史分页 / 搜 settings 等)。

- [ ] **BUG-RF-01**: 欢迎页弹窗逻辑修正
- [ ] **BUG-RF-02**: 单文件部署删除 (M5 已做; M6 需保持)
- [ ] **BUG-RF-03**: 第三方仓库文案修正
- [ ] **BUG-RF-04**: 手动处理 checkbox 不可勾错
- [ ] **BUG-RF-05**: 手动出 JSON 编辑入口正确
- [ ] **BUG-RF-06**: 备份分页 + 多选
- [ ] **BUG-RF-07**: 备份文件不误删
- [ ] **BUG-RF-08**: 历史分页
- [ ] **BUG-RF-09**: JSON 搜 settings 路径正确

### UI/UX A 类 (P3, phase 30)

> 文本/样式 polish,不影响功能。

- [ ] **UI-A-01**: 二次元主题 header 排版
- [ ] **UI-A-02**: Default Model 字段显示
- [ ] **UI-A-03**: formatChineseTokenCount 函数正确
- [ ] **UI-A-04**: 资源市场"重新扫描"按钮位置
- [ ] **UI-A-05**: 关于页项目主页 URL

### 整合验证 (phase 31)

> M6 ship gate — 所有 phase 完成后的最终验证 + tag v3.2。

- [ ] **INT-01**: test-all 6 阶段全 PASS (ui-check / frontend / rust / e2e / smoke / m4-e2e)
- [ ] **INT-02**: M4 e2e 15/15 回归 (14 hard-fail + 1 stub)
- [ ] **INT-03**: vitest 全 PASS (含 v3.2 新增测试)
- [ ] **INT-04**: ClaudeManager.app rebuild + 装 + 启动 1 窗口 OK
- [ ] **INT-05**: STATE.md 写 M6 完成段
- [ ] **INT-06**: tag v3.2

## Future (backlog, 不进 v3.2)

- ❌ 云备份 / S3-OSS 集成 — v3.0 round 3 废弃 (2026-06-26 用户拍板)
- ❌ M4.3 updater 前端 UI — v3.0 round 3 废弃
- ❌ i18n / SQLite 历史 / 多窗口 / Telemetry / L-M2.02 (M4.6 长尾) — v3.0 round 3 废弃
- ❌ M4.1 代码签名证书 — 用户拍板不买
- ❌ M4.5 应用商店上架 — 用户拍板不做
- ❌ D6 Mac 真机验证 — 用户拍板不启动
- ❌ Phase 28/29 BUG-BZ-08~13 — 留待 v3.2 用户实测后补 (v3.2.1 follow-up)

## Out of Scope

- ❌ **其他 Claude client (Codex / Cursor / Gemini / OpenCode)** — SPEC.md §1.4 硬约束
- ❌ **云同步 / 多人协作** — SPEC.md §1.4 硬约束;无服务器依赖
- ❌ **4 槽并发上限之外的新功能** — D11 限制;不插队
- ❌ **macOS 应用商店 / Microsoft Store 上架** — M4.5 用户拍板不上架
- ❌ **M4.1 代码签名证书** — 用户拍板不买
- ❌ **D6 Mac 真机验证** — 用户拍板不处理

## Traceability (filled by roadmap)

| REQ-ID | Phase |
|--------|-------|
| BUG-CR-01 ~ 05 | Phase 27 (critical 5) |
| BUG-BZ-01 ~ 13 | Phase 28 (业务 13) |
| BUG-RF-01 ~ 09 | Phase 29 (重构 9) |
| UI-A-01 ~ 05 | Phase 30 (A 类 5) |
| INT-01 ~ 06 | Phase 31 (整合验证) |

---

*Last updated: 2026-06-26 (v3.2 M6 requirements draft)*