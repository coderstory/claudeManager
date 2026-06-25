```
 █████╗ ██╗      █████╗ ██╗   ██╗ ██████╗███████╗     ██████╗ ██████╗ ███╗   ██╗███████╗██╗   ██████╗     
██╔════╝██║     ██╔══██╗██║   ██║██╔══██╗██╔════╝    ██╔════╝██╔═══██╗████╗  ██║██╔════╝██║  ██╔════╝ 
██║     ██║     ███████║██║   ██║██║  ██║█████╗      ██║     ██║   ██║██╔██╗ ██║█████╗  ██║  ██║  ███╗
██║     ██║     ██╔══██║██║   ██║██║  ██║██╔══╝      ██║     ██║   ██║██║╚██╗██║██╔══╝  ██║  ██║   ██║
╚██████╗███████╗██║  ██║╚██████╔╝██████╔╝███████╗    ╚██████╗╚██████╔╝██║ ╚████║██║     ██║  ╚██████╔╝
 ╚═════╝╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚═════╝ ╚══════╝     ╚═════╝ ╚═════╝ ╚═╝  ╚═══╝╚═╝     ╚═╝   ╚═════╝ 

                          ⚔  Manager  ⚔
         一念切换 Provider · 配置守护 · 用量监测
        Win 11 + macOS 26 Tahoe · Tauri v2 + React 19 + Rust
```

# Claude Config Manager

---

## 项目简介

Claude Config Manager 是一个面向 Claude Code 重度用户的桌面端配置管理工具。它解决三个真实痛点：

1. **多 provider 快速切换** — 在官方 Anthropic、cc-switch 导出的 `.json`、自建代理等多种 Claude API provider 之间秒级切换，无需手动改 `settings.json`
2. **配置安全管理** — 写入前自动备份、token 字段默认遮罩、JSON 实时校验，避免一次手滑污染全局配置
3. **实时用量监控** — 拉取 provider 用量数据，对比多 provider 消耗，发现异常及时告警

支持 **Windows 11** 和 **macOS 26 (Tahoe)** 双平台。

技术栈：**Tauri v2 + React 19 + TypeScript 5 + Rust + Tailwind/shadcn**。

---

## 快速开始（5 分钟跑起来）

```bash
# 1. clone
git clone <repo-url> claude-config-manager
cd claude-config-manager

# 2. 安装依赖（Node 20+ / Rust 1.75+ / WebView2 已预装）
npm install

# 3. 一键构建 + 冒烟测试 + 复制到桌面
./scripts/build-and-ship.sh --milestone M1 --task 1.0 --slug quickstart
```

成功后到 `~/Desktop/ClaudeConfigManager-M1/` 目录双击 exe 即可启动。
开发期推荐 `npm run tauri dev`（HMR 热重载）。

### 系统要求

| 平台 | 最低版本 | 必需组件 |
|---|---|---|
| Windows | 11 (10.0.22000+) | WebView2 Runtime（Win11 自带） |
| macOS | 26 Tahoe | Xcode CLT + macOS SDK |

---

## 目录结构

```
claude-config-manager/
├── README.md                   ← 本文件（新人入门）
├── AGENTS.md                   ← Subagent 协议（派单 / 网络 / TDD）
├── CLAUDE.md                   ← 项目规则（工程纪律 / 架构 / 评审 / 迭代）
├── SPEC.md                     ← 产品规格（不可修改；实现唯一参考）
│
├── src/                        ← React 前端
│   ├── App.tsx                 ← 根组件 + View 路由
│   ├── design-system/          ← tokens.css + ThemeProvider（设计系统基线）
│   ├── pages/                  ← 业务页面（每 plugin 一个子目录）
│   ├── plugins/                ← 前端 plugin registry + 12 个 stub
│   ├── components/             ← 通用组件（AppHeader / ErrorBanner / WindowControls）
│   ├── hooks/                  ← useViewState / useTheme
│   ├── lib/                    ← 工具（json-editor / fs API 包装）
│   ├── stores/                 ← Zustand 状态（M2+）
│   └── __tests__/              ← Vitest 单元 / 集成测试
│
├── src-tauri/                  ← Rust 后端
│   ├── src/
│   │   ├── lib.rs              ← Tauri builder + plugin 注册 + tray
│   │   ├── domain/             ← 业务模型（Provider / McpServer / UsageSnapshot）
│   │   ├── services/           ← 业务逻辑（ProviderService / MarketplaceService）
│   │   ├── infrastructure/     ← 文件 IO / HTTP / git 客户端 / sql_parser
│   │   ├── platform/           ← OS 抽象层（traits + windows/ + macos/）
│   │   ├── plugins/            ← 后端 plugin host + 12 stub
│   │   └── commands/           ← Tauri command 表面（按 F-编号分模块）
│   └── tauri.conf.json
│
├── tests/                      ← Playwright e2e 测试
├── scripts/                    ← build-only / smoke-test / build-and-ship / kill-app
├── docs/                       ← 架构 / 构建 / 签名 / 设计 / 里程碑报告
├── .planning/                  ← HANDOFF / STATE / 研究产物（只读）
└── tmp/                        ← 诊断产物 / probe 脚本（不进 commit）
```

完整分层说明见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)。

---

## 开发流程（CLAUDE.md §9 + §11）

本项目采用**主 session + subagent** 双层架构：

- **主 session** 只负责：澄清需求 / 拆任务 / 派单 / 接收成果 / 关键决策
- **Subagent** 执行：编译 / 跑测试 / 改代码 / 写文档 / ship exe
- **并发上限 4 槽** — 主 session 同时最多派 4 个 subagent

### 迭代交付纪律（每次 ship 必做）

```
设计 → TDD（红→绿→重构）→ 自审 → 头脑风暴 → 同行评审 → 业务流程分析
     → 修 CRITICAL/HIGH → ship exe 到桌面 → smoke test → 等用户核定
```

完整规则见 [`CLAUDE.md`](CLAUDE.md) §9（迭代交付）+ §6（评审纪律）。

---

## 测试

```bash
# 前端单元 / 集成（Vitest + jsdom）
npm test                              # 当前 130+ 用例

# 后端单元（cargo test）
cargo test --manifest-path src-tauri/Cargo.toml

# 端到端（Playwright via tauri-driver）
npx playwright test

# 冒烟测试（已 ship 的 exe）
./scripts/smoke-test.sh path/to/exe
```

CI 在 `.github/workflows/ci.yml` 跑全 3 层；release 流水线在 `release.yml`。

---

## 当前状态（2026-06-25）

| Milestone | 状态 | 范围 |
|---|---|---|
| **M1 架构期** | ✅ Done（12 子任务 + 评审） | Tauri 骨架 / 8 traits / 12 plugin stub / 设计系统 / CI |
| **M2 业务实现期** | ✅ Done to M2.16 | F1~F8 + F13 + F14 + F15 + F17 + F20~F23 + Mac 平台修复 |
| **M3 主题重构（v3.0）** | ✅ Done（2026-06-22） | 插件式主题系统（`light` 瓷白 / `anime` 薄荷汽水）+ 14 内页收束 + AppHeader 切换 |
| **M4** | 🚧 WIP | 主 session 整流 + Mac 真机验真；4 个 M4.6 WIP 文件待解 merge conflict |

历史里程碑报告：[`docs/milestones/`](docs/milestones/)（M1-final-report / M2-roadmap-draft / M3-issues-and-roadmap / STATE）。

---

## 进一步阅读

| 文档 | 何时读 |
|---|---|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | **第一次看代码前必读**（分层 / 8 traits / plugin 契约 / 设计系统） |
| [`AGENTS.md`](AGENTS.md) | 你是 subagent 必读（网络纪律 / TDD / 评审 / 派单清单） |
| [`CLAUDE.md`](CLAUDE.md) | **项目规则圣经**（§2 工程纪律 / §3 架构 / §6 评审 / §9 迭代 / §11 派单） |
| [`SPEC.md`](SPEC.md) | 产品规格（F1~F24 + 设计规范 §5） |
| [`docs/BUILD.md`](docs/BUILD.md) | 构建脚本 / WebView2 依赖 / 发布流水线 |
| [`docs/milestones/STATE.md`](docs/milestones/STATE.md) | 迭代记录 / 用户反馈 / 已知限制 |
| [`docs/milestones/M1-REVIEWS.md`](docs/milestones/M1-REVIEWS.md) | M1 阶段 4 阶段评审（自审 / 头脑风暴 / 同行 / 业务流程） |
| [`docs/milestones/M2-REVIEWS.md`](docs/milestones/M2-REVIEWS.md) | M2 阶段评审汇总（M2.1~M2.16） |
| [`docs/milestones/M3-issues-and-roadmap.md`](docs/milestones/M3-issues-and-roadmap.md) | M3 主题重构待办与路线 |

---

## 贡献

本项目处于 M3 主题重构已 ship / M4 业火中的阶段，不接受外部 PR。所有变更走"主 session 派单 → subagent 执行"流程。

发现 bug / 提需求：直接在主 session 对话中描述，主 session 会拆成 subagent 任务派单。

---

*本文档为新人入口。详细规则请读 `CLAUDE.md`（规则圣经）+ `docs/ARCHITECTURE.md`（架构基线）。*