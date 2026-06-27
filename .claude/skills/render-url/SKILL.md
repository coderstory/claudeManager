---
name: render-url
description: "用 msedge headless 模式渲染任意动态网页(SPA / 异步加载 / JS 重定向后),支持输出 PNG 截图 / 纯文本 / 渲染后 HTML。适配 macOS / Windows / Linux。Use when user wants to see the final rendered state of a URL — not just HTML source — e.g. '看看这个页面长什么样', '截图这个 URL', '提取这个 URL 的文本', 'render this URL', '把网页渲染出来看'."
---

# render-url — 用 msedge headless 渲染动态网页并产出结果

把任意 URL 喂给本机的 Microsoft Edge headless 模式,等 JS / 字体 / 异步数据跑完,产出最终结果。这样能直接看到 SPA、客户端渲染、JS 重定向后真正"用户看到的页面",而不是 `<script>` 还是空字符串的 HTML 源码。

## 何时调用

- 用户给你一个 URL 想"看看是什么样" → `--mode screenshot` 出图
- 用户想提取页面文本内容(SPA 渲染后) → `--mode text` 出纯文本
- 用户想拿渲染后的 DOM(JS 跑完后的 HTML) → `--mode html`
- 调试 SPA / Next.js / Vite dev server / 任何 client-rendered 页面
- 截图 docs 站 / 设计参考 / 竞品分析素材
- 验证自己写的页面在真实浏览器里的渲染结果(配合 dev server 用)

**不要**用于:
- 只是要读 HTML 文本 / 抓链接 / 抓 markdown → 用 `WebFetch`(更轻量)
- 需要点击 / 表单提交 / 多页导航 → 这个 skill 只支持单页操作;多步交互用 Playwright

## 脚本位置

`.claude/skills/render-url/scripts/render-url.sh`

## 用法(给 AI agent)

```bash
# 截图(默认 mode)
.claude/skills/render-url/scripts/render-url.sh "https://example.com" /tmp/x.png

# 截图 + 自定义等待 / 视口 / 整页
.claude/skills/render-url/scripts/render-url.sh "https://my-spa.dev" /tmp/spa.png --wait 4000
.claude/skills/render-url/scripts/render-url.sh "https://docs.example.com" /tmp/full.png --full-page
.claude/skills/render-url/scripts/render-url.sh "https://x.com" /tmp/x.png --viewport 1920,1080

# 提取纯文本(SPA 渲染后,剥 script/style/nav,保留 h1-h6 + 段落 + 链接)
.claude/skills/render-url/scripts/render-url.sh "https://example.com" /tmp/x.txt --mode text

# 提取渲染后的完整 HTML(JS 跑完后的 DOM,不是 <div id="root">)
.claude/skills/render-url/scripts/render-url.sh "https://my-spa.dev" /tmp/x.html --mode html --wait 4000

# 文本截断到 5000 字符(默认 50000)
.claude/skills/render-url/scripts/render-url.sh "https://long-doc.com" /tmp/long.txt --mode text --text-max-chars 5000
```

## 参数

| 参数 | 默认 | 说明 |
|---|---|---|
| `<URL>` | (必填) | 要渲染的 URL |
| `<output>` | (必填) | 结果保存路径;screenshot→.png,text→.txt,html→.html |
| `--mode` | screenshot | `screenshot` / `text` / `html` |
| `--wait MS` | 1500 | 虚拟时间预算 ms,期间所有 setTimeout / 异步请求都会跑完。SPA / 字体加载慢给到 3000-5000 |
| `--viewport WxH` | 1280,800 | 浏览器窗口尺寸(逗号分隔,Chrome 风格) |
| `--user-agent UA` | Edge 默认 | 自定义 UA,移动端模拟用 |
| `--full-page` | off | (screenshot)截整页 |
| `--text-max-chars N` | 50000 | (text)截断到 N 字符,`0` = 不截断 |

## 三种 mode 对比

| mode | 输出 | 用途 | 实现 |
|---|---|---|---|
| `screenshot` | PNG | 看 UI 长啥样 | Edge `--screenshot` |
| `text` | 纯文本(.txt) | 提取正文 / 抓数据 / 给 AI 阅读 | Edge `--dump-dom` + Python HTMLParser |
| `html` | 完整 HTML(.html) | 拿渲染后的 DOM 做分析 | Edge `--dump-dom`(原样保存) |

**text 模式行为**:
- 剥掉 `<script>` / `<style>` / `<svg>` / `<head>` / `<meta>` / `<link>` / `<iframe>` / `<noscript>`
- 保留 `<h1>` ~ `<h6>` → 转 markdown `#` ~ `######`
- 段落之间用空行分隔
- `<li>` → `•` 项目符号
- `<a href="...">` → `text (url)` 形式保留链接
- 连续空白规范化(多空符合并、连续换行压成 2 个)

## msedge 路径自动检测(跨平台)

按 `uname -s` 判断,优先级:

| OS | 查找顺序 |
|---|---|
| **macOS** | `/Applications/Microsoft Edge.app` → `/Applications/Google Chrome.app`(回退) |
| **Windows** (Git Bash / MSYS) | `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe` → `C:\Program Files\Microsoft\Edge\Application\msedge.exe` → `chrome.exe`(回退) |
| **Linux** | `microsoft-edge` → `msedge` → `google-chrome` → `chromium` |

完全找不到 → 退出码 2,提示信息会列出已搜索的所有路径。

## 关于 Edge 不退出 + timeout 命令

**问题**:macOS Edge headless 模式下,无论是 `--screenshot` 还是 `--dump-dom`,Edge 截完/写完后**主进程不主动退出**(已知 bug,跨 Edge/Chrome 都有)。如果脚本靠 `wait` 等 Edge,会永远卡住。

**解法**:脚本优先用 GNU `timeout` 命令包 Edge(`timeout 8s msedge ...`),超时就强杀整组子进程。timeout 命令跨平台位置:
- **Linux** / **Git Bash (Windows)**: 自带 `timeout`
- **macOS**: 默认不带,需 `brew install coreutils`(装好后有 `gtimeout` 和 `timeout` symlink)
- 脚本会同时探测 `timeout` 和 `gtimeout`,**装一个就行**

**未装 timeout**:脚本会强警告,但仍能跑 — 用轮询产物 + `kill -TERM` 进程组兜底。**稳定性不如 timeout**。

如果 macOS 上脚本卡住:先 `brew install coreutils` 再跑。

## 退出码

| Code | 含义 |
|---|---|
| 0 | 成功 |
| 1 | 参数错误 |
| 2 | 找不到 msedge / chrome(以及 text/html 模式找不到 python3) |
| 3 | msedge 渲染失败 / 产物未生成 |

## 内部实现细节(给 reviewer)

- **headless 模式**:用 `--headless=new`(Chrome 109+ 的 new headless,完整页面渲染管线,不是老的 stub)
- **虚拟时间**:`--virtual-time-budget=MS` 跑得快,且保证 setTimeout / Promise 在 budget 内全部 flush
- **隔离**:`--user-data-dir=$(mktemp -d)` 避免与用户日常 Edge profile 冲突(cookie / 扩展 / 设置)
- **scrollbar**:`--hide-scrollbars` 让截图不被系统滚动条污染(screenshot 模式)
- **GPU**:`--disable-gpu` headless 必需,否则 macOS 上会卡住
- **sandbox**:`--no-sandbox` 在某些 CI / 容器环境必需;本机 macOS Edge 不需要但加上无副作用

**text 模式 HTML 提取器**:Python `html.parser`,skip 栈 + void elements 处理:
- SKIP_TAGS (script/style/svg/iframe/noscript/head/link/meta) 用栈管理,遇到 endtag 才 pop(避免 `<head>` 嵌套 `<title>` 时 `</title>` 错误 pop head)
- VOID_TAGS (meta/link/br/hr/img/...) 自闭合无 endtag,**不进栈**,直接 skip
- 标签过滤掉 script/style 后,SPA 框架输出的 React/Vue hydrate 后的 DOM 全保留

## 常见问题

**Q: 截图是空白的?**
A: 给 `--wait` 加到 3000-5000(SPA 还没 hydrate 完);或者 dev server 没起 / 端口错。

**Q: 文本输出是空白的?**
A: 同上,SPA 还没 hydrate,Edge dump-dom 时 DOM 是空的。给 `--wait` 加到 5000+。

**Q: 中文 / CJK 字体渲染成方块?**
A: 系统缺中文字体。macOS 默认有 PingFang,Windows 默认有 Microsoft YaHei,Linux 需 `apt install fonts-noto-cjk`。

**Q: 截图比 viewport 大?**
A: 没加 `--full-page`,默认只截首屏 viewport。加了会按内容实际高度截。

**Q: 脚本卡住不退?**
A: macOS 没装 GNU `timeout`,但 fallback 仍可能在某些 Edge 异常状态下卡。装 `brew install coreutils` 后稳定。

**Q: 想看 stdout 的 console.log?**
A: 当前不实现。改用 Chrome DevTools Protocol / Playwright。

## 反事故

- ❌ **不要用这个脚本跑 production 网站大规模截图** — 单次 5-10s,一次会话跑 10 次就几分钟
- ❌ **不要把 `--user-data-dir` 设到固定路径** — 会污染用户 profile,本脚本每次 mktemp -d
- ❌ **不要在 CI 容器里跑(没装 Edge)** — 退出码 2 会明确告诉你找不到浏览器
- ✅ **dev server 起好后等 1-2s 再截** — 端口起来了但 vite/webpack 可能还没编译完,加 `--wait 3000` 兜底
- ✅ **text 模式配 --text-max-chars 0 + html 模式 配 grep/less 自行截取** — 大页面不要全 dump 到内存