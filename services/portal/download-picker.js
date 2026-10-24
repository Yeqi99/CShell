(() => {
  const root = document.querySelector('.download-selector');
  if (!root) return;
  const packages = Array.from(document.querySelectorAll('.download-package'));
  const products = {
    pro: {name: 'CShell Pro', description: '登录后同步连接、模型与设置。所有 Pro 安装包均从香港下载源获取。', guide: '/docs/cloud.html'},
    opensource: {name: 'CShell 开源版', description: 'MIT 开源，无需账号即可使用本地工作台。安装包直接从 GitHub 正式发行页获取。', guide: '/docs/start.html'},
    cagent: {name: 'CAgent', description: '安装在要连接的机器上。账号版支持登录 Pro；独立开源版可直接连接。安装包均从香港下载源获取。', guide: '/docs/cagent.html'}
  };
  const systems = {all: '全部系统', windows: 'Windows', macos: 'macOS', linux: 'Linux', android: 'Android'};
  const description = document.querySelector('#product-description');
  const guide = document.querySelector('#product-guide');
  const count = document.querySelector('#package-count');
  const title = document.querySelector('#package-title');
  const empty = document.querySelector('#download-empty');
  function value(name) { return root.querySelector(`input[name="${name}"]:checked`).value; }
  function render(updateUrl = false) {
    const product = value('download-product');
    const system = value('download-system');
    let visible = 0;
    for (const card of packages) {
      const match = card.dataset.product === product && (system === 'all' || card.dataset.system === system);
      card.hidden = !match;
      if (match) visible++;
    }
    title.textContent = products[product].name;
    description.textContent = products[product].description;
    guide.href = products[product].guide;
    guide.textContent = product === 'cagent' ? '安装 CAgent 指南 ↗' : '使用与安装指南 ↗';
    count.textContent = `${systems[system]} · ${visible} 个安装包`;
    empty.hidden = visible !== 0;
    if (updateUrl) {
      const url = new URL(location.href);
      url.searchParams.set('product', product);
      url.searchParams.set('system', system);
      url.hash = '';
      history.replaceState(null, '', url);
    }
  }
  const params = new URLSearchParams(location.search);
  const product = params.get('product') || location.hash.slice(1);
  const system = params.get('system');
  if (Object.hasOwn(products, product)) root.querySelector(`input[value="${product}"]`).checked = true;
  if (Object.hasOwn(systems, system)) root.querySelector(`input[value="${system}"]`).checked = true;
  root.addEventListener('change', () => render(true));
  render();
  root.hidden = false;
})();
