(() => {
  const tabs = [...document.querySelectorAll('[data-scene]')];
  const scenes = {
    windows: ['windows-workspace.png', 'CShell 机器桌面与智能体窗口', '机器桌面与智能体，在同一个工作空间。', 'desktop'],
    linux: ['linux-workspace.png', 'Linux 文件管理窗口', '查看目录、上传下载，保留当前机器上下文。', 'linux'],
    extensions: ['extensions.png', 'CShell 扩展市场', '按需启用工具，或导入自己的扩展。', 'extensions'],
  };
  function activate(tab) {
    const scene = scenes[tab.dataset.scene];
    if (!scene) return;
    tabs.forEach(t => { t.setAttribute('aria-selected', String(t === tab)); t.tabIndex = t === tab ? 0 : -1; });
    document.getElementById('scene-panel').setAttribute('aria-labelledby', tab.id);
    const img = document.getElementById('scene-image');
    img.src = '/media/' + scene[0]; img.alt = scene[1];
    document.getElementById('scene-image-link').href = img.src;
    document.getElementById('scene-description').textContent = scene[2];
    document.getElementById('scene-guide').href = '/docs/' + scene[3] + '.html';
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => activate(tab));
    tab.addEventListener('keydown', e => {
      const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
      if (!keys.includes(e.key)) return;
      e.preventDefault();
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (index + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      activate(tabs[next]); tabs[next].focus();
    });
  });
})();
