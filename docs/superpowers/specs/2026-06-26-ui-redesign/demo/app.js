// app.js — Demo 入口 (主题切换 + 页面路由 + 弹窗)
const THEME_NAMES = {
  'light': '极简卡片',
  'liquid-glass': '液态玻璃',
  'dark': '深色高级',
  'editorial': '瑞士网格',
  'pixel': '像素黑白'
};

const MODALS = {
  'confirm': { icon: '?', title: '切换到 DeepSeek-V3?', body: '将修改 <code>~/.claude/settings.json</code> · 备份已创建 · 当前会话中已激活的 provider 将被替换。', danger: false },
  'delete': { icon: '×', title: '删除 Provider?', body: '将永久删除 <strong>自定义 · 内部代理</strong> · 此操作不可撤销 · 建议先备份。', danger: true },
  'quick-search': { icon: '⌕', title: '快速搜索', body: '<input class="input" placeholder="搜索 Provider / MCP / 资源..." style="margin-bottom:8px;"><div class="text-sm text-muted">↑↓ 选择 · Enter 打开 · Esc 关闭</div>', danger: false },
  'new-provider': { icon: '+', title: '新建 Provider', body: '<label class="text-sm">名称</label><input class="input mb-3" placeholder="GLM-4.6"><label class="text-sm">Base URL</label><input class="input mb-3" placeholder="https://api.anthropic.com"><label class="text-sm">API Key</label><input class="input" type="password" placeholder="sk-ant-...">', danger: false },
  'import-preview': { icon: '↓', title: '导入预览', body: '5 个将被导入 · 1 个因 ID 冲突被跳过<div class="card mt-3" style="padding:8px;"><div class="text-sm"><strong>GLM-4.6</strong> · 官方</div></div><div class="card mt-2" style="padding:8px;"><div class="text-sm"><strong>DeepSeek-V3</strong></div></div>', danger: false },
  'error': { icon: '!', title: '认证失败', body: 'API Key 无效或已过期 · 请检查 ~/.claude/settings.json 中的 ANTHROPIC_AUTH_TOKEN · <a href="#" style="color:var(--accent)">查看文档</a>', danger: true },
  'about-modal': { icon: 'ⓘ', title: '关于', body: 'Claude Config Manager v3.2.0<br>Tauri v2.11 + React 19.1<br><a href="#" style="color:var(--accent)">查看 GitHub</a> · <a href="#" style="color:var(--accent)">报告问题</a>', danger: false },
  'theme-picker': { icon: '◐', title: '选择主题', body: '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">' + Object.entries(THEME_NAMES).map(([id, name]) => `<button class="btn" onclick="document.documentElement.dataset.theme='${id}';document.getElementById('themeStatus').textContent='主题: '+'${name}'+(' (${id})');setActiveTheme('${id}');">${name}</button>`).join('') + '</div>', danger: false }
};

// 初始化
function init() {
  renderPage('provider-list');
  bindThemeSwitcher();
  bindNav();
  bindModals();
  bindToggles();
}

// 主题切换
function bindThemeSwitcher() {
  document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const theme = btn.dataset.theme;
      document.documentElement.dataset.theme = theme;
      document.getElementById('themeStatus').textContent = `主题: ${THEME_NAMES[theme]} (${theme})`;
      setActiveTheme(theme);
      try { localStorage.setItem('demo-theme', theme); } catch(e) {}
    });
  });
  // 恢复 (优先用 URL 参数 ?theme=xxx, 方便截图)
  try {
    const urlTheme = new URLSearchParams(window.location.search).get('theme');
    const stored = localStorage.getItem('demo-theme');
    const theme = (urlTheme && THEME_NAMES[urlTheme]) ? urlTheme : (stored && THEME_NAMES[stored] ? stored : null);
    if (theme) {
      document.documentElement.dataset.theme = theme;
      setActiveTheme(theme);
      document.getElementById('themeStatus').textContent = `主题: ${THEME_NAMES[theme]} (${theme})`;
    }
  } catch(e) {}
}

function setActiveTheme(theme) {
  document.querySelectorAll('.theme-btn').forEach(b => b.classList.toggle('active', b.dataset.theme === theme));
}

// 页面路由
function bindNav() {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const page = item.dataset.page;
      renderPage(page);
      document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n === item));
    });
  });
}

function renderPage(pageId) {
  const page = PAGES[pageId];
  if (!page) return;
  const main = document.getElementById('main');
  main.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">${page.title}</h1>
        <div class="page-subtitle">${page.subtitle}</div>
      </div>
      <div class="page-actions">${page.actions || ''}</div>
    </div>
    ${page.render()}
  `;
  bindToggles();
}

// 弹窗
function bindModals() {
  document.querySelectorAll('[data-modal]').forEach(btn => {
    btn.addEventListener('click', () => openModal(btn.dataset.modal));
  });
  document.getElementById('modalOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'modalOverlay') closeModal();
  });
}

function openModal(modalId) {
  const m = MODALS[modalId];
  if (!m) return;
  document.getElementById('modalIcon').textContent = m.icon;
  document.getElementById('modalTitle').textContent = m.title;
  document.getElementById('modalBody').innerHTML = m.body;
  document.getElementById('modal').classList.toggle('danger', m.danger);
  document.getElementById('modalOverlay').classList.add('open');
}

function closeModal() {
  document.getElementById('modalOverlay').classList.remove('open');
}

// Toggle
function bindToggles() {
  document.querySelectorAll('.toggle').forEach(t => {
    if (t._bound) return;
    t._bound = true;
    t.addEventListener('click', () => t.classList.toggle('on'));
  });
}

document.addEventListener('DOMContentLoaded', init);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
