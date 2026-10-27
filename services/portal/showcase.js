(() => {
  const menu = document.querySelector('.home-menu-toggle');
  const navigation = document.getElementById('home-navigation');
  if (menu && navigation) {
    const compact = matchMedia('(max-width:700px)');
    const closeMenu = (restoreFocus = false) => {
      menu.setAttribute('aria-expanded', 'false');
      menu.querySelector('span').textContent = '＋';
      if (restoreFocus) menu.focus();
    };
    menu.hidden = false;
    document.querySelector('.site-header').classList.add('navigation-ready');
    menu.addEventListener('click', () => {
      const open = menu.getAttribute('aria-expanded') !== 'true';
      menu.setAttribute('aria-expanded', String(open));
      menu.querySelector('span').textContent = open ? '−' : '＋';
    });
    navigation.addEventListener('click', event => {
      const link = event.target.closest('a');
      if (link && compact.matches) {
        closeMenu();
        const href = link.getAttribute('href');
        const target = href?.startsWith('#') ? document.getElementById(href.slice(1)) : null;
        if (target) { target.tabIndex = -1; target.focus({preventScroll: true}); }
      }
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && compact.matches && menu.getAttribute('aria-expanded') === 'true') {
        event.preventDefault(); closeMenu(true);
      }
    });
    document.addEventListener('click', event => {
      if (!event.target.closest('.site-header')) closeMenu();
    });
    compact.addEventListener('change', () => {
      const focusInside = navigation.contains(document.activeElement);
      closeMenu(compact.matches && focusInside);
    });
  }

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
    const titles = {windows: '机器的每一面，都在同一桌面。', linux: '从目录到终端，操作各就其位。', extensions: '工具按需加入，工作方式由你决定。'};
    document.getElementById('scene-title').textContent = titles[tab.dataset.scene];
    const index = tabs.indexOf(tab) + 1;
    document.querySelector('.scene-index').replaceChildren(document.createTextNode('0' + index + ' '), Object.assign(document.createElement('span'), {textContent: '/ 03'}));
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
  document.querySelectorAll('[data-platform-jump]').forEach(link => link.addEventListener('click', () => {
    document.querySelector('[data-system="' + link.dataset.platformJump + '"]')?.click();
  }));
})();
