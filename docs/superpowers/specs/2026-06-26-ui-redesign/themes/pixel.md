# pixel · 像素黑白 (Minecraft 风)

## 1. 设计理念 (3 句)

8-bit 像素艺术风格, 0 圆角 + 0 阴影 + 0 渐变 + 2px 硬边 + Press Start 2P / ZCOOL KuaiLe 像素字体. 致敬 Minecraft UI 设计语言, 给 Claude 配置管理器一种"游戏化 / 工程极客"风格. 灵感: Minecraft UI + Stardew Valley + 8-bit 游戏 UI.

## 2. 色系 (MC 经典)

| 类别 | 值 |
|---|---|
| 背景 primary | #C6C6C6 (MC 经典石灰色) |
| 背景 elevated | #FFFFFF (卡片纯白) |
| 背景 overlay | #AAAAAA |
| 背景 sunken | #DDDDDD |
| 文字 primary | #000000 |
| 文字 secondary | #222222 |
| 文字 muted | #555555 |
| 品牌 accent | #555555 (灰色主调, 黑白风) |
| 品牌 accent-soft | #DDDDDD |
| 品牌 accent-strong | #222222 |
| 品牌 fg-on | #FFFFFF |
| 状态 success | #5BAA3F (MC 草绿) |
| 状态 warning | #FFAA00 (MC 经验黄) |
| 状态 danger | #AA0000 (MC 红石) |
| 状态 info | #3F76AA (MC 钻石蓝) |
| 边框 | #000000 (全部 2px) |
| 阴影 | none (无阴影, 只有硬边) |

## 3. 字体 (核心特色)

| 类型 | 栈 |
|---|---|
| UI | "Press Start 2P", "ZCOOL KuaiLe", "Courier New", monospace |
| 等宽 | 同 UI |
| Heading | 16-22px |
| Body | 12-14px |

**image-rendering: pixelated** 强制所有元素像素渲染
**-webkit-font-smoothing: none** 关闭字体抗锯齿

## 4. 间距与圆角 (像素方角)

| 元素 | 值 |
|---|---|
| 卡片 | **0px** |
| 按钮 | **0px** |
| 弹窗 | **0px** |
| Badge | **0px** |
| 边框宽度 | **2px** (统一, 区别于其他主题 1px) |

## 5. 阴影 (无! 改用硬阴影偏移)

| 档 | 值 |
|---|---|
| sm/md/lg | **none** |
| 按钮按下 | `box-shadow: 2px 2px 0 #000` (唯一例外) |
| 弹窗 | `box-shadow: 8px 8px 0 rgba(0,0,0,0.4)` (硬阴影, 非模糊) |

## 6. 动效 (硬切 0ms)

| 属性 | 值 |
|---|---|
| 缓动 | steps(1, end) |
| Fast / Normal / Slow | **0ms / 0ms / 0ms** |
| 页面切换 | 0ms |

**特色动效 (按钮物理按下)**:
- 按钮 active: `transform: translate(2px, 2px)` + shadow 消失, 模拟"按下去"
- 头像 hover: 泥土棕边框变色
- macOS 按钮 hover: 荧光黄 (高对比, 醒目)

## 7. 边界

| 状态 | 值 |
|---|---|
| 卡片激活 | 6px solid #5BAA3F (草绿 border-left) + 米色背景 |
| macOS 按钮 | 红黄绿 12px 圆点 (保留 macOS 经典) |
| Topbar | 木板背景 (横向木纹 base64 PNG) |
| Sidebar | 石头背景 (灰色颗粒 base64 PNG) |
| Main | 草方块背景 (绿+棕 base64 PNG) |
| Statusbar | 黑泥土 #2A1810 |
| Modal | 告示牌米色背景 |
| Toggle | 32×16 红/绿 拉杆 (MC 红石开关) |
| 进度条 | 12px 黑色背景槽 + 彩色填充 (MC 经验条) |

## 8. 灵感来源

| 来源 | 借鉴 |
|---|---|
| [Minecraft](https://minecraft.net) | UI 8-bit 像素风 + 16x16 贴图 |
| [Stardew Valley](https://www.stardewvalley.net) | 像素艺术配色 |
| [Press Start 2P](https://fonts.google.com/specimen/Press+Start+2P) | 经典 8-bit 字体 |
| [ZCOOL KuaiLe](https://fonts.google.com/specimen/ZCOOL+KuaiLe) | 像素感中文字体 |

## 9. 反模式

- ❌ 圆角 > 0 — 像素方角是核心
- ❌ 模糊阴影 — 只能用硬阴影 (2px 2px 0 #000)
- ❌ transition > 0ms — 硬切是 MC 风格
- ❌ 渐变背景 — 用 base64 PNG 16x16 平铺
- ❌ emoji — 用 ASCII / Unicode 字符或 lucide 图标
- ❌ 抗锯齿字体 — 必须 `-webkit-font-smoothing: none`