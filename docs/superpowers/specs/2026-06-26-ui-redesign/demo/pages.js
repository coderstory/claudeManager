// app.js — Demo 核心逻辑
// 5 主题切换 + 12 页渲染 + 8 弹窗

const PAGES = {
  'provider-list': {
    title: 'Provider 列表',
    subtitle: '3 个配置 · 1 个激活',
    actions: '<button class="btn">搜索 ⌘K</button><button class="btn btn-primary">+ 新建</button>',
    render: () => `
      <div class="card active">
        <div class="card-row">
          <div style="display:flex;align-items:center;">
            <div class="card-avatar">G</div>
            <div class="card-info">
              <h3 class="card-title">GLM-4.6 <span class="text-muted">· 官方</span></h3>
              <div class="card-meta">5 个模型 · 上次使用 2 分钟前</div>
            </div>
          </div>
          <div class="card-actions">
            <span class="badge badge-active">● 24%</span>
            <button class="btn btn-primary">切换</button>
          </div>
        </div>
      </div>
      <div class="card">
        <div class="card-row">
          <div style="display:flex;align-items:center;">
            <div class="card-avatar">D</div>
            <div class="card-info">
              <h3 class="card-title">DeepSeek-V3</h3>
              <div class="card-meta">3 个模型 · 上次使用 昨天</div>
            </div>
          </div>
          <div class="card-actions">
            <button class="btn">切换</button>
          </div>
        </div>
      </div>
      <div class="card">
        <div class="card-row">
          <div style="display:flex;align-items:center;">
            <div class="card-avatar">自</div>
            <div class="card-info">
              <h3 class="card-title">自定义 · 内部代理</h3>
              <div class="card-meta">1 个模型 · 从未使用</div>
            </div>
          </div>
          <div class="card-actions">
            <button class="btn">切换</button>
          </div>
        </div>
      </div>
    `
  },

  'mcp': {
    title: 'MCP 管理',
    subtitle: '6 个 server · 4 个已启用',
    actions: '<button class="btn btn-primary">+ 新增</button>',
    render: () => `
      ${['sequential-thinking', 'fetch', 'git', 'github', 'puppeteer', 'playwright'].map((s, i) => `
        <div class="list-row">
          <div class="card-avatar">${s[0].toUpperCase()}</div>
          <div class="list-row-info">
            <div class="card-title">${s}</div>
            <div class="card-subtitle">npx -y @modelcontextprotocol/server-${s}</div>
          </div>
          <div class="toggle ${i < 4 ? 'on' : ''}" data-toggle></div>
          <button class="btn btn-ghost">⋯</button>
        </div>
      `).join('')}
    `
  },

  'usage': {
    title: '用量查询',
    subtitle: 'GLM-4.6 · 实时',
    actions: '<button class="btn">↻ 刷新</button>',
    render: () => `
      <div class="kpi-grid">
        <div class="kpi"><div class="kpi-label">最近 5 小时</div><div class="kpi-value">12.4M / 50M</div><div class="text-sm text-secondary">24%</div></div>
        <div class="kpi"><div class="kpi-label">最近一周</div><div class="kpi-value">180M / 1B</div><div class="text-sm text-secondary">18%</div></div>
        <div class="kpi"><div class="kpi-label">最近一月</div><div class="kpi-value">720M / 5B</div><div class="text-sm text-secondary">14%</div></div>
      </div>
      <div class="card">
        <h3 class="card-title mb-3">详细进度</h3>
        <div class="usage-row"><span class="usage-label">5 小时</span><span>12.4M / 50M · 24% · 下次重置 2h15m</span></div>
        <div class="usage-bar"><span style="width:24%"></span></div>
        <div class="usage-row"><span class="usage-label">一周</span><span>180M / 1B · 18% · 周一 0:00 重置</span></div>
        <div class="usage-bar"><span style="width:18%"></span></div>
        <div class="usage-row"><span class="usage-label">一月</span><span>720M / 5B · 14% · 2 月 1 日重置</span></div>
        <div class="usage-bar"><span style="width:14%"></span></div>
      </div>
    `
  },

  'import': {
    title: '导入配置',
    subtitle: '3 种入口 · 拖入 / 选择 / 粘贴',
    render: () => `
      <div class="card" style="border-style:dashed;border-width:2px;text-align:center;padding:48px;">
        <div style="font-size:32px;margin-bottom:12px;">↓</div>
        <div class="card-title mb-2">拖入 .sql 文件 · 选择文件 · 粘贴 URL</div>
        <div class="text-muted text-sm mb-3">或点击下方按钮</div>
        <div class="flex gap-2" style="justify-content:center;">
          <button class="btn">选 .sql</button>
          <button class="btn">粘贴 deeplink</button>
          <button class="btn">从当前 settings.json</button>
        </div>
      </div>
    `
  },

  'resource': {
    title: '资源浏览',
    subtitle: 'Plugins · Skills · Commands · MCPs',
    render: () => `
      <div class="kpi-grid">
        <div class="kpi"><div class="kpi-label">Plugins</div><div class="kpi-value">12</div></div>
        <div class="kpi"><div class="kpi-label">Skills</div><div class="kpi-value">34</div></div>
        <div class="kpi"><div class="kpi-label">Commands</div><div class="kpi-value">28</div></div>
        <div class="kpi"><div class="kpi-label">MCPs</div><div class="kpi-value">6</div></div>
      </div>
      <div class="card">
        <table class="data-table">
          <thead><tr><th>名称</th><th>类型</th><th>大小</th><th>状态</th></tr></thead>
          <tbody>
            <tr><td>superpowers</td><td>plugin</td><td>1.2MB</td><td><span class="badge badge-active">已启用</span></td></tr>
            <tr><td>leyline</td><td>plugin</td><td>340KB</td><td><span class="badge badge-active">已启用</span></td></tr>
            <tr><td>spec-driven-engineering</td><td>plugin</td><td>892KB</td><td><span class="badge badge-inactive">未启用</span></td></tr>
          </tbody>
        </table>
      </div>
    `
  },

  'marketplace': {
    title: '资源市场',
    subtitle: '在线仓库 · 5 个内置 + 社区',
    actions: '<button class="btn btn-primary">+ 安装</button>',
    render: () => `
      ${['superpowers', 'leyline', 'document-skills', 'claude-tool-management', 'spec-driven-engineering'].map(r => `
        <div class="card">
          <div class="card-row">
            <div style="display:flex;align-items:center;">
              <div class="card-avatar">${r[0].toUpperCase()}</div>
              <div class="card-info">
                <h3 class="card-title">${r}</h3>
                <div class="card-subtitle">official · ★ ${(Math.random()*2+3).toFixed(1)} · ${Math.floor(Math.random()*5000)} installs</div>
              </div>
            </div>
            <button class="btn btn-primary">安装</button>
          </div>
        </div>
      `).join('')}
    `
  },

  'optimizer': {
    title: '智能优化',
    subtitle: '安全 8 项 · 需确认 3 项 · 不可改 1 项',
    actions: '<button class="btn btn-primary">应用优化</button>',
    render: () => `
      <div class="card">
        <h3 class="card-title mb-3"><span class="badge badge-active">安全</span> · 8 项可自动应用</h3>
        <div class="text-sm text-secondary">缓存策略、模型默认参数、日志级别等可自动修复</div>
      </div>
      <div class="card">
        <h3 class="card-title mb-3"><span class="badge badge-warning">需确认</span> · 3 项需要用户决定</h3>
        <div class="text-sm text-secondary">max_tokens 上限、timeout 设置等</div>
      </div>
      <div class="card">
        <h3 class="card-title mb-3"><span class="badge" style="background:var(--danger);color:white;">不可改</span> · 1 项 Claude Code 控制</h3>
        <div class="text-sm text-secondary">API key 加密方式</div>
      </div>
    `
  },

  'backup': {
    title: '备份与恢复',
    subtitle: '12 个备份 · 最近 30 天',
    actions: '<button class="btn btn-primary">+ 立即备份</button>',
    render: () => `
      <div class="card">
        <table class="data-table">
          <thead><tr><th>日期</th><th>大小</th><th>类型</th><th>状态</th><th></th></tr></thead>
          <tbody>
            <tr><td>2026-06-26 14:30</td><td>1.2MB</td><td>自动</td><td><span class="badge badge-active">当前</span></td><td><button class="btn">恢复</button></td></tr>
            <tr><td>2026-06-25 09:15</td><td>1.1MB</td><td>手动</td><td><span class="badge badge-inactive">可用</span></td><td><button class="btn">恢复</button></td></tr>
            <tr><td>2026-06-24 18:42</td><td>1.0MB</td><td>自动</td><td><span class="badge badge-inactive">可用</span></td><td><button class="btn">恢复</button></td></tr>
          </tbody>
        </table>
      </div>
    `
  },

  'history': {
    title: '历史记录',
    subtitle: '切换 / 备份 / 优化操作流水',
    render: () => `
      <div class="card">
        <div class="card-row mb-2"><div><div class="card-title">切换 Provider</div><div class="card-subtitle">GLM-4.6 → DeepSeek-V3</div></div><span class="text-muted text-sm">2 分钟前</span></div>
        <div class="card-row mb-2"><div><div class="card-title">自动备份</div><div class="card-subtitle">~/.claude/settings.json</div></div><span class="text-muted text-sm">5 分钟前</span></div>
        <div class="card-row mb-2"><div><div class="card-title">导入 Provider</div><div class="card-subtitle">通过 .sql 文件</div></div><span class="text-muted text-sm">1 小时前</span></div>
      </div>
    `
  },

  'json-editor': {
    title: 'JSON 编辑',
    subtitle: '~/.claude/settings.json',
    actions: '<button class="btn">格式化</button><button class="btn btn-primary">保存</button>',
    render: () => `
      <div class="json-editor"><span class="json-key">"env"</span>: {
  <span class="json-key">"ANTHROPIC_BASE_URL"</span>: <span class="json-string">"https://api.anthropic.com"</span>,
  <span class="json-key">"ANTHROPIC_AUTH_TOKEN"</span>: <span class="json-string">"sk-ant-●●●●●●●●●●●●"</span>,
  <span class="json-key">"ANTHROPIC_MODEL"</span>: <span class="json-string">"claude-sonnet-4-6"</span>
},
<span class="json-key">"enabledPlugins"</span>: {
  <span class="json-key">"superpowers"</span>: <span class="json-bool">true</span>,
  <span class="json-key">"leyline"</span>: <span class="json-bool">true</span>
}</div>
    `
  },

  'about': {
    title: '关于',
    subtitle: 'Claude 配置管理器',
    render: () => `
      <div class="kpi-grid">
        <div class="kpi"><div class="kpi-label">应用名</div><div class="kpi-value" style="font-size:16px;">Claude Config Manager</div></div>
        <div class="kpi"><div class="kpi-label">版本</div><div class="kpi-value" style="font-size:16px;">v3.2.0</div></div>
        <div class="kpi"><div class="kpi-label">Tauri</div><div class="kpi-value" style="font-size:16px;">v2.11</div></div>
        <div class="kpi"><div class="kpi-label">React</div><div class="kpi-value" style="font-size:16px;">v19.1</div></div>
      </div>
      <div class="card">
        <p class="text-sm text-secondary">跨平台桌面工具 · 帮助用户在多个 Claude Code provider 配置之间快速切换 + 安全管理 + 实时监控用量</p>
        <p class="text-sm text-secondary mt-2">Windows 11 + macOS 26 (Tahoe) · MIT</p>
      </div>
    `
  },
};
