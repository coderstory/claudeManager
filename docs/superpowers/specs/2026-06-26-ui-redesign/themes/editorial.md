# editorial · 瑞士网格

## 1. 设计理念 (3 句)

学术 + 报告 + 出版物的视觉权威. Inter 字体的几何精确感 + 严格网格的工程美学 + 黑白高对比的克制. 给工具一种"被研究过、值得信任"的感觉. 灵感: Bloomberg 终端 + Apple Keynote 标题页 + Dieter Rams / Braun.

## 2. 色系 (黑白为主)

| 类别 | 值 | WCAG |
|---|---|---|
| 背景 primary | #FAFAF9 米白 (纸张感) | — |
| 背景 elevated | #FFFFFF 纯白 | — |
| 背景 sunken | #F5F5F4 浅灰 | — |
| 文字 primary | #000000 纯黑 | 21:1 极致 AAA |
| 文字 secondary | #52525B 深灰 | 7.5:1 AAA |
| 文字 muted | #A1A1AA 中灰 | 2.7:1 (辅助) |
| 品牌 accent | #000000 黑 (主色就是黑, 黑底白字按钮) | — |
| 品牌 accent-soft | #F5F5F4 | — |
| 品牌 fg-on | #FFFFFF | — |
| 状态 success | #15803D 深绿 | 6.4:1 AA |
| 状态 warning | #B45309 深橙 | 5.8:1 AA |
| 状态 danger | #B91C1C 深红 | 6.8:1 AA |
| 状态 info | #1E40AF 深蓝 | — |
| 边框 | #000000 黑 2px (核心) | — |

## 3. 字体 (核心特色)

| 类型 | 栈 |
|---|---|
| UI | **Inter**, "Helvetica Neue", "Arial", sans-serif (黑体, 800-900 标题) |
| 等宽 | "JetBrains Mono", "SF Mono", Menlo (用于编号章节 § 01) |
| Heading | **32px** / 800-900 (其他主题 18-22, editorial 突出展示) |
| Body | 13px / 400-500 |
| 小标签 | 大写 + letter-spacing: 0.1em + font-weight: 700 (e.g. "CONFIRM") |
| 标题 letter-spacing | -0.03em (压紧, 几何感) |

## 4. 间距与圆角 (锐角!)

| 元素 | 值 |
|---|---|
| 卡片 | **0px** (印刷感) |
| 按钮 | **0px** |
| 弹窗 | 0px |
| Badge | 0px |
| 边框 | **2px** (核心, 区别于其他 1px 主题) |

## 5. 阴影 (硬阴影! 阶梯式)

| 档 | 值 |
|---|---|
| sm | 2px 2px 0 #000 (硬阴影, 0 模糊) |
| md | 4px 4px 0 #000 (弹窗) |
| lg | 6px 6px 0 #000 (浮层) |

## 6. 动效 (硬切 0ms!)

| 属性 | 值 |
|---|---|
| 缓动 | steps(1, end) (无插值, 阶梯式) |
| Fast / Normal / Slow | **0ms / 0ms / 0ms** (无过渡) |
| 页面切换 | 0ms (瞬时) |

**特色动效 (打字机 + 网格扫描)**:
- **硬切 0ms**: 所有 hover/active/focus 无 transition, 瞬间切换
- **打字机动画** (独有): 页面标题 / 章节号 (§ 01) 字符逐个出现, 50ms 间隔
- **网格扫描线** (独有): 页面首次加载, 黑色横线从顶到底快速扫过 200ms
- **硬阴影偏移** (独有): 按钮 active 时 shadow 从 4px4px → 2px2px, button transform translate(2px, 2px), 模拟"按下"

## 7. 边界

| 状态 | 值 |
|---|---|
| macOS 按钮 | **白 / 浅灰 / 黑** (白圆 #FFFFFF / 浅灰圆 #DDDDDD / 黑圆 #000000) + 2px 黑边 + 1px1px 硬阴影, hover 变荧光黄 #FFFF00 |
| Sidebar | 黑色 64px 实心块, 顶部 logo 单字符 "C" + 垂直 "v3.0" |
| 编号章节 | § 01 / § 02 + 标题 + 副标题 (12 列网格中占 1+8+3 列) |
| 主内容最大宽度 | 1080px (其他主题 720-1280) |

## 8. 灵感来源

| 来源 | 借鉴 |
|---|---|
| [Notion](https://notion.so) | 编号章节 + 硬阴影 |
| [Bloomberg Terminal](https://bloomberg.com/professional) | 网格密度 + 黑白高对比 |
| [Dieter Rams / Braun](https://en.wikipedia.org/wiki/Dieter_Rams) | 锐角 + 几何精确 |

## 9. 反模式

- ❌ 圆角 > 0 — 必须是 0 圆角, 哪怕 2px 都破坏印刷感
- ❌ 模糊阴影 / 渐变阴影 — 只能是阶梯式
- ❌ 任何 transition > 0ms — 软化就失去 editorial 感
- ❌ 彩色品牌 (蓝/紫/红) — 主色就是黑, 状态色要"暗"
- ❌ emoji / 装饰图形 — 纯文字 + 几何线条