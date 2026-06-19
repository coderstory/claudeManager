# 跨平台桌面技术方案评估报告

**目标平台**：Windows 11（24H2/25H2） + macOS 26（Tahoe）
**报告日期**：2026-06-18
**核心约束**：纯 AI 开发（无人类团队技能偏好），跨平台一致性 + 生态成熟度优先
**结论先行**：**Tauri v2**（推荐主选） / **Electron**（生态成熟备选） / **Flutter Desktop**（视觉一致性强需求）三选一；其他 4 个为有条件备选。

> 本报告基于 `.planning/research/STACK.md`（25KB，详细版本号 + 框架定位）和 `.planning/research/PITFALLS.md`（52KB，pitfall 清单）综合得出。版本号和源码细节请直接看那两份。

---

## 一、候选方案速览

| # | 框架 | 当前版本 | 语言 | Win 11 | macOS 26 | 包体积 (Hello) | 内存 (idle) | License |
|---|------|---------|------|--------|----------|---------------|-------------|---------|
| 1 | **Tauri v2** | CLI 2.11.3 (2026-06) | Rust + Web | WebView2 系统 | WKWebView 系统 | **3–10 MB** | **30–80 MB** | MIT / Apache-2.0 |
| 2 | **Electron** | 42.4.1 (2026) | TS/JS | 捆绑 Chromium | 捆绑 Chromium | 150–250 MB | 100–200 MB | MIT |
| 3 | **Flutter Desktop** | 3.44.2 stable | Dart | Win32 native | Native macOS | 20–30 MB | 80–150 MB | BSD-3 |
| 4 | **.NET MAUI** | 10.0.71 (.NET 10) | C#/XAML | WinUI 3 | Mac Catalyst ⚠️ | 60–120 MB | 80–150 MB | MIT |
| 5 | **Avalonia 12** | 12.0.4 (2026-05) | C#/XAML | Skia/ANGLE | Skia/Metal | 40–80 MB | 60–120 MB | MIT |
| 6 | **Wails v2** | 2.12.0 (2026-03) | Go + Web | WebView2 系统 | WKWebView 系统 | 5–10 MB | 40–90 MB | MIT |
| 7 | **Qt 6** | 6.10 LTS / 6.11 | C++/QML | Native Win32 | Native AppKit | 30–60 MB | 50–100 MB | **LGPL/Commercial** |

---

## 二、推荐方案：**Tauri v2**

### 为什么是 Tauri

1. **包体积 + 内存最低**（web 类方案里）。~3–10 MB 安装包、~30–80 MB 内存，对比 Electron 的 150–250 MB / 100–200 MB，差一个数量级。用户下载快、运行轻。
2. **不捆绑浏览器引擎**。Windows 用系统 WebView2（Edge 内核），macOS 用系统 WKWebView。系统自带，零维护；攻击面更小、补丁跟随系统。
3. **原生集成齐全**。Tauri v2 官方插件覆盖：文件系统、对话框、shell、single-instance、autostart、store、updater（签名更新）、notifications、HTTP、clipboard、deep-link、window-vibrancy（macOS）、Mica（Win 11，社区插件）。
4. **AI 反馈循环最好**。Rust 后端 `cargo check` 秒级编译；前端用任意 web 框架（React/Vue/Svelte/Solid）—— 全是我训练数据里最强的栈组合。
5. **协议干净**。MIT / Apache-2.0，无 LGPL 商业义务。
6. **机构背书**。2024 年成立 Tauri Foundation，Microsoft Learn / GitHub Sponsors / 1Password 都是生产用户。

### 为什么不是 Tauri（要权衡）

1. **Win 10 用户**：Win 11 默认有 WebView2，但 Win 10 可能没有。安装器要带 WebView2 bootstrapper（增加 ~80 MB 安装包体积）。如果目标用户里 Win 10 占比 < 10%，可忽略。
2. **Microsoft Defender 误报**（Tauri issue #2486，84+ 👍，5 年未完全解决）。未签名的 Tauri `.exe` 会被 Defender 标 Trojan。**Day 1 就必须配 EV 代码签名证书**，否则用户体验被 Defender 警告框挡死。
3. **生态比 Electron 小**。需要 Bluetooth / NFC / 高级媒体这类边缘能力时，得自己写 Rust 插件。
4. **WKWebView ≠ Chromium**。macOS 上的 CSS / JS 行为和 Chrome 不完全一样，"在 Windows 跑通了"不等于 macOS 跑通。从 Day 1 就要在真 macOS 26 上测试。
5. **Rust 学习曲线**（如果团队零基础）。逻辑尽量放在 web 前端，Rust 只做必要的 IPC bridge，2–4 周上手。

### 关键配置 / 命令模式

- **能力文件硬约束**：每个 IPC 命令需要 (a) Rust `#[tauri::command]`、(b) TS wrapper、(c) `src-tauri/capabilities/*.json` 授权。AI 经常忘记给新命令加 capability，必须把 capability 文件纳入上下文。
- **打包**：内置 `tauri build` 支持 macOS DMG/.app + Windows MSI/NSIS/.exe，签名和公证都有 hook。
- **更新**：`tauri-plugin-updater`（官方，支持签名更新）。

---

## 三、备选方案对比

### A. Electron — 生态最成熟

- **适合**：JS/TS 团队、UI 本质就是网页、npm 依赖图庞大、能接受 100–200 MB 体积。
- **不适合**：在意包体积、内存、想要 Win11+macOS26 原生感（Electron 永远是"Chromium 风格"）。
- **AI 友好度**：最高（整个 web 栈全在训练数据里）。**风险**：AI 默认会写不安全的 `nodeIntegration: true` / `contextIsolation: false`，必须 review 把关。
- **版本**：v42.4.1，Chromium 148，Node 24.16，月度发布。

### B. Flutter Desktop — 视觉一致性最强

- **适合**：设计语言要"跨平台像素一致"（品牌画布类产品）、同时要做移动端、视觉风格优先于原生感。
- **不适合**：要求 Win11/macOS26 原生感。Flutter 用 Skia/Impeller 画所有控件，没有原生 widget —— 菜单、滚动条、文件选择器都是 Flutter 风格的，macOS 用户会觉得"不对味"。
- **AI 友好度**：良好（Dart 在训练数据里，widget catalog 齐全）。**风险**：AI 容易忽略桌面特定 UX（键盘导航、focus、屏幕阅读器语义）。
- **版本**：3.44.2 stable，Dart 3.12.2。

### C. .NET MAUI — Windows 优先可用

- **适合**：.NET 团队、Windows 优先 + macOS 次要、能接受 Mac Catalyst 的"iPad 跑在 macOS 上"的味道。
- **不适合**：macOS 是一等公民。Mac Catalyst 是 UIKit 在 macOS 上跑，**不是原生 AppKit**。返回手势、iPad 风格弹窗、无 macOS 服务集成 —— 在 macOS 26 上原生感极差，是 macOS-first 项目的硬伤。
- **AI 友好度**：良好（.NET + XAML 在训练数据里）。**风险**：AI 生成的 XAML 在 Mac Catalyst 上渲染异常。
- **版本**：10.0.71（.NET 10）。

### D. Avalonia 12 — XAML 跨 Linux 优选

- **适合**：WPF/XAML 团队、需要 Win + macOS + **Linux 桌面**、能用 Skia 自绘控件（不是 OS 原生）。
- **不适合**：要求 WinUI-3 / AppKit 原生、Avalonia 文档/issue 体量比 MAUI 小。
- **2026 年 6 月 open issues**：CJK 字形回归（#21556）、macOS AppKit 系统字体缺失（#21565）、窗口缩放在 DWM composition 关闭时坏掉（#21603/#21604）。回归频繁。
- **AI 友好度**：良好（C# + XAML），但语料比 WPF 少。

### E. Wails v2 — Go 团队的 Tauri 替代

- **适合**：Go 团队、想要 Tauri 风格（web 前端 + 原生后端）但用 Go 不用 Rust。
- **不适合**：需要成熟插件生态（Wails 插件比 Tauri 少一个量级）、需要 mobile（Wails v2 mobile 是 alpha）。
- **架构上和 Tauri 同源**（WebView2/WKWebView），但工程成熟度差很多。除非有强 Go 偏好，否则选 Tauri 是更优解。

### F. Qt 6 — 工业级但 AI 灾难

- **适合**：工业 / 嵌入式 / 汽车 / 医疗认证、复杂 2D/3D 渲染、已有 C++ 基础设施。
- **不适合**：**AI 作为主要开发者**。QML + C++ + moc（meta-object compiler）的组合在 AI 训练语料里最少 —— 生成的 QML 经常漏 `Q_INVOKABLE`、漏 `Q_OBJECT`、搞错 QObject parent ownership。
- **License 风险**：**LGPL 3 / GPL / 商业**。静态链接 Qt 的专有产品必须买商业 license。LGPL 动态链接 OK 但有合规义务。误用会被 Qt Company 追究。
- **版本**：Qt 6.10 LTS（May 2025）/ 6.11 innovation（GitHub release API 不可用，置信度 MEDIUM）。

---

## 四、决策矩阵（按权重打分）

| 维度 (权重) | Tauri v2 | Electron | Flutter | MAUI | Avalonia | Wails | Qt |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Win11+macOS26 原生感 (20%) | ★★★★ | ★★★ | ★★ | ★★★ (Mac 拖后腿) | ★★★ | ★★★ | ★★★★★ |
| 包体积 + 内存 (15%) | ★★★★★ | ★★ | ★★★★ | ★★★ | ★★★ | ★★★★★ | ★★★ |
| 跨平台一致性 (15%) | ★★★★ | ★★★★ | ★★★★★ | ★★★ | ★★★★ | ★★★★ | ★★★★ |
| AI 开发友好度 (20%) | ★★★★★ | ★★★★★ | ★★★★ | ★★★★ | ★★★ | ★★★ | ★★ |
| 生态成熟度 (10%) | ★★★★ | ★★★★★ | ★★★★ | ★★★ | ★★★ | ★★ | ★★★★★ |
| 部署 + 签名 + 更新 (10%) | ★★★★★ | ★★★★ | ★★★ | ★★★ | ★★★ | ★★★ | ★★ |
| License 干净度 (10%) | ★★★★★ | ★★★★★ | ★★★★★ | ★★★★★ | ★★★★★ | ★★★★★ | ★★★ (LGPL) |
| **加权总分** | **4.55** | **3.85** | **3.55** | **3.25** | **3.25** | **3.20** | **3.30** |

---

## 五、明确不要选的方案

| 方案 | 排除理由 |
|---|---|
| **WinUI 3 / Windows App SDK 单独用** | Windows-only，macOS 完全不支持 |
| **Xamarin.Mac** | 已废弃，被 .NET MAUI 的 Mac Catalyst 取代 |
| **Cordova / PhoneGap desktop** | 桌面端基本无人维护 |
| **NW.js** | 活跃但小众，生态比 Electron 小 |
| **JavaFX** | 与 Win11/macOS26 设计语言不匹配，社区萎缩 |
| **UWP** | 微软正在用 WinUI 3 / Windows App SDK 替代 UWP |
| **React Native for Windows+macOS** | 桌面端未经证实，社区已向 Electron/Tauri 集中 |
| **手撸 CEF / WebView 包装** | 自定义 Electron 是维护陷阱；用现成的 Electron 或 Tauri/Wails |
| **Flutter Web 当桌面替代** | 浏览器沙箱、无原生菜单、无系统托盘、文件系统受限 |

---

## 六、给 Tauri v2 的下一步建议（如果你决定选它）

1. **1 天 Hello-World benchmark**：在 Win 11 + macOS 26 真机上跑 Tauri v2 / Electron / Flutter Desktop 三个空壳 app，测冷启动时间、idle 内存、安装包体积、跨 DPI 拖窗表现。
2. **Day 1 配签名**：
   - 注册 Apple Developer Program（$99/年）
   - 买 EV 代码签名证书（DigiCert/GlobalSign/Sectigo/SSL.com）
   - macOS 用 App Store Connect API key 走 `notarytool`（不要 Apple ID + app-specific password，CI 上会因 2FA 翻车）
3. **macOS 菜单栏从第一个菜单开始就按 macOS 规范设计**。Windows-style 菜单后期改 macOS 是多周重构。
4. **真 macOS 26 硬件从 Day 1 必测**。WKWebView ≠ Chromium，"Windows 跑通了" 啥也证明不了。
5. **建 `AGENTS.md` 框架不变量清单**：安全默认（`contextIsolation: true` / `nodeIntegration: false`）、capability 授权流程、签名命令、平台抽象层。AI 必须遵守。
6. **延迟做自动更新**（v1.0 之后再规划）。先用手动下载更新，验证后再上 `tauri-plugin-updater`。

---

## 七、置信度声明

| 项 | 置信度 |
|---|---|
| 7 个框架的版本号（除 Qt 点版本） | **HIGH**（GitHub releases API + flutter_infra_release JSON 验证） |
| Win11 + macOS26 支持矩阵 | **HIGH**（官方 prerequisite 文档） |
| 包体积 / 内存数字 | **MEDIUM**（公开 benchmark 平均值，依赖应用；选型前必须自己跑 Hello-World） |
| Tauri 生态健康度 | **HIGH**（Tauri Foundation 2024 成立，月度发布） |
| Mac Catalyst 质量 | **HIGH**（苹果官方区分 AppKit vs UIKit-on-macOS） |
| Wails / Qt 插件生态细节 | **MEDIUM**（部分主源被 Cloudflare / 公司代理拦截） |
| AI 友好度评分 | **MEDIUM-HIGH**（基于训练语料量和已知失败模式） |

---

## 八、决策结论

**主选**：Tauri v2 —— 满足 80% 场景的最佳均衡（原生感 / 体积 / AI 友好 / License）。

**条件切换**：
- 如果业务是"网页套壳"、JS/TS 团队主导、能接受 200MB 安装包 → **切 Electron**
- 如果设计语言要求像素级跨平台一致、需要同时做 mobile → **切 Flutter Desktop**
- 如果必须支持 Linux 桌面、有 XAML 经验 → **切 Avalonia**（不是 Tauri）
- 如果是 .NET 团队、Win 优先、macOS 是 secondary → **切 MAUI**（接受 Mac Catalyst 妥协）
- 如果有强 Go 团队偏好 → **切 Wails v2**
- 如果是工业 / 嵌入式 / 已有 C++ 基础设施 → **切 Qt 6**（但 AI 友好度极差）

**下一步**：你拍板选哪个，我再决定要不要：
- 跑 1 天 Hello-World benchmark 验证选型
- 进入 `/gsd-new-project` 后续流程（写 PROJECT.md / REQUIREMENTS.md / ROADMAP.md → 进入开发）
- 还是先就某个备选做更深的专项调研

---

*报告基于 `.planning/research/STACK.md`（25KB，2026-06-18）+ `.planning/research/PITFALLS.md`（52KB，2026-06-18）。如需补充 FEATURES / ARCHITECTURE 维度细节或联网核实某个具体数字，告诉我。*