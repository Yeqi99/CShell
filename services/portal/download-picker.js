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
  const architecture = document.getElementById('download-architecture');
  const architectures = {all: '全部架构', x64: 'x64', arm64: 'ARM64'};
  function value(name) { return root.querySelector(`input[name="${name}"]:checked`).value; }
  function render(updateUrl = false) {
    const product = value('download-product');
    const system = value('download-system');
    const available = new Set(packages.filter(card => card.dataset.product === product && (system === 'all' || card.dataset.system === system)).map(card => card.dataset.arch));
    const selectable = ['x64', 'arm64'].filter(arch => available.has(arch));
    architecture.parentElement.hidden = selectable.length < 2;
    for (const option of architecture.options) option.disabled = option.value !== 'all' && !selectable.includes(option.value);
    if (selectable.length < 2 || (architecture.value !== 'all' && !selectable.includes(architecture.value))) architecture.value = 'all';
    const arch = architecture.value;
    let visible = 0;
    for (const card of packages) {
      const match = card.dataset.product === product && (system === 'all' || card.dataset.system === system) && (arch === 'all' || card.dataset.arch === arch || card.dataset.arch === 'universal');
      card.hidden = !match;
      if (match) visible++;
    }
    title.textContent = products[product].name;
    description.textContent = products[product].description;
    guide.href = products[product].guide;
    guide.textContent = product === 'cagent' ? '安装 CAgent 指南 ↗' : '使用与安装指南 ↗';
    count.textContent = `${systems[system]}${arch === 'all' ? '' : ' · ' + architectures[arch]} · ${visible} 个安装包`;
    empty.hidden = visible !== 0;
    if (updateUrl) {
      const url = new URL(location.href);
      url.searchParams.set('product', product);
      url.searchParams.set('system', system);
      if (arch === 'all') url.searchParams.delete('arch'); else url.searchParams.set('arch', arch);
      url.hash = '';
      history.replaceState(null, '', url);
    }
  }
  function restoreLocation() {
    const params = new URLSearchParams(location.search);
    const product = params.get('product') || location.hash.slice(1);
    const system = params.get('system');
    root.querySelector(`input[name="download-product"][value="${Object.hasOwn(products, product) ? product : 'pro'}"]`).checked = true;
    root.querySelector(`input[name="download-system"][value="${Object.hasOwn(systems, system) ? system : 'all'}"]`).checked = true;
    architecture.value = Object.hasOwn(architectures, params.get('arch')) ? params.get('arch') : 'all';
    render();
  }
  window.addEventListener('popstate', restoreLocation);
  window.addEventListener('hashchange', restoreLocation);
  root.addEventListener('change', () => render(true));
  restoreLocation();
  root.hidden = false;
})();
