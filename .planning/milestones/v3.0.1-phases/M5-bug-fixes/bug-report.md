
1 二次元主题 header 菜单名字需要到单独的背景色
2 历史查询页面 报错 加载失败: sqlite error: no such table: usage_history
3 欢迎页 新增项目 改成弹窗形式
4 Provider 列表，点击激活，条目的选中状态消失，并且没有哪个条目显示已激活
5 Default Model (ANTHROPIC_MODEL) 改成 Default Model
6 编辑 Provider弹窗，点击报错报错：invalid args `input` for command `update_provider`: missing field `id`，并且弹窗标题变成【添加 Provider】
7 SQL 导入功能，需要过滤 base_url 或者 token 缺值的条目，并需要和当前的Provider 列表对比，重复数据也要过滤，然后选择 SQL 文件后显示的列表，用户可以选择导入哪些条目，需要加复选框
8 SQL 导入功能，跳过的条目，应该显示他的名字，而不是 sql 里的行号，看不懂是啥
9 JSON 编辑器的全屏功能又丢了，JSON 需要一个全屏功能 备份与恢复功能页面的 JSON 也需要能全屏
10 JSON编辑器，左侧的目录树很奇怪，json 文件下面挂别的 json 文件，文件夹的名字怎么没了？
11 MCP 管理  切换到项目级之后，读取的是项目的 json，且相关文本提示也需要切换
12 MCP 管理 从剪切板导入 报错 剪贴板读取失败: invalid URL: relative URL without a base  这个功能不是导入 json 配置吗？ 怎么是 url
13 MCP 管理，文本提示过时了，ccswitch 协议删除了。 【未配置 MCP server。点击「新增 MCP server」开始配置,或粘贴一个ccswitch://v1/import?resource=mcp&...URL 到剪贴板后点「从剪贴板导入」。】
14 用量查询 已用 TOKENS 超过一亿后 显示的文本没改成 x 亿 x 千万，修改没了
15 用量查询  余额和费用 删掉，相关计算代码也删了，这个不需要了。页面下方的列表里也删除
16 用量查询  用量趋势 (按天) 这个图标，只显示当前的数据，历史数据怎么没有？ 应该最多显示近 7 天的数据
17 按 Model 拆分这个列表 CACHE CREATE永远是 0，如果无法获取，则删除这个列
18 删除单文件部署这个菜单和代码
19 我已经切换到项目了，资源浏览还是用户级的资源
20 重新扫描这个按钮长度不够，导致文本换行了
21 plugins 里显示的东西不是插件啊 是 外层的目录 解析的不对
22 资源市场  浏览资源 这个按钮没能成功打开网页 应该打开 git 仓库网页
23 资源市场 点击安装 npx  提示  √git error: 无法启动 'npx' (请确认 Node.js + npm 已安装): No such file or directory (os error 2)。又是 git 又是 npx，不对劲
24 资源市场 点击 安装 cli 报错  git error: 无法启动 'claude' CLI (请确认 Claude Code 已安装): No such file or directory (os error 2)
25 资源市场  第三方仓库 这个功能干啥的？ 输入 git 仓库然后干啥？
26 配置优化检查  为什么能勾选【需手动处理】的选项？ 点击 应用 能优化？
27 配置优化检查  点击应用 报错 未应用: 1c185e46
finding 已过期(可能已被其他修复处理或上次扫描已失效),请重新扫描。
28 配置优化检查  标记为手动处理的项目，点击后出现 json 编辑框，自动定位到对应的行，提供关闭，保存，撤回 全屏 等按钮操作
29 备份与恢复  列表需要分页展示 能多选删除
30 备份与恢复 文件选择恢复后 不应该从列表里删除
31 历史查询 三个列表都需要分页
32 关于页面  项目主页 单独一行展示
33 JSON 编辑器列表里怎么搜索不到 settings.json？
