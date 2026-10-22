import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  Globe,
  Terminal,
  Folder,
  Package,
  Code,
  Monitor,
  Settings,
  Search,
  ArrowLeft,
  LayoutGrid,
  Clock,
  Sun,
  Moon,
  Check,
} from 'lucide-react';
export type MachineApp = {
  id: string;
  name: string;
  detail: string;
  run: () => void;
  manage?: () => void;
  disabled?: boolean;
};
const symbols: Record<string, any> = {
  browser: Globe,
  terminal: Terminal,
  files: Folder,
  market: Package,
  codex: Code,
  claude: Code,
  ide: Code,
  remote: Monitor,
  settings: Settings,
};
function glyph(symbol: any) {
  const span = document.createElement('span');
  span.innerHTML = renderToStaticMarkup(createElement(symbol, { size: 24, 'aria-hidden': true }));
  return span;
}
function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

/** Local presentation preferences only; app actions always keep their original connection binding. */
export class MachineHome {
  readonly root = el('section', 'agent-environments machine-desktop');
  private grid = el('div', 'machine-launcher');
  private recent = el('div', 'machine-recent');
  private apps: MachineApp[] = [];
  private history: string[] = [];
  private query = '';
  private wallpaper = 'coast';
  private dark = false;
  private offline = false;
  private panel = el('section', 'machine-preferences');
  private key: string;
  constructor(
    readonly name: string,
    address: string,
    key: string,
    private transport: string,
    private themeChanged?: (dark: boolean) => void,
  ) {
    this.key = 'machine-look:' + key;
    try {
      const saved = JSON.parse(localStorage.getItem(this.key) || '{}');
      if (['coast', 'dusk', 'forest', 'slate'].includes(saved.wallpaper))
        this.wallpaper = saved.wallpaper;
      this.dark = !!saved.dark;
    } catch {}
    this.applyLook();
    const header = el('header', 'machine-hero');
    const heading = el('div');
    heading.append(el('small', 'machine-eyebrow', '远程机器'), el('h1', '', name));
    const status = el('p', 'machine-identity');
    status.append(el('i'), document.createTextNode(transport + ' · ' + address));
    heading.append(status);
    const settings = el('button', 'machine-settings');
    settings.setAttribute('aria-label', '桌面设置');
    settings.append(glyph(Settings));
    settings.onclick = () => this.settings();
    header.append(heading, settings);
    const search = el('label', 'machine-search');
    search.append(glyph(Search));
    const input = el('input');
    input.placeholder = '搜索这台机器的应用';
    input.setAttribute('aria-label', input.placeholder);
    input.oninput = () => {
      this.query = input.value;
      this.render();
    };
    search.append(input);
    const area = el('main', 'machine-home-content');
    area.append(search, el('h2', 'machine-section-title', '应用'), this.grid, this.recent);
    const dock = el('footer', 'machine-dock');
    dock.append(glyph(LayoutGrid), el('span', '', '机器桌面'), el('small', '', transport));
    this.root.append(header, area, dock, this.panel);
    this.panel.hidden = true;
  }
  setApps(apps: MachineApp[]) {
    this.apps = apps;
    this.render();
  }
  show() {
    this.root.hidden = false;
    this.themeChanged?.(this.dark);
  }
  hide() {
    this.root.hidden = true;
  }
  disconnected() {
    this.offline = true;
    this.root.hidden = false;
    const status = this.root.querySelector('.machine-identity');
    if (status) status.textContent = '连接已断开 · 请从连接列表重新连接';
    this.root.dataset.offline = 'true';
    this.render();
  }
  private launch(app: MachineApp) {
    if (app.disabled || this.offline) return;
    this.history = [app.id, ...this.history.filter((id) => id !== app.id)].slice(0, 4);
    this.render();
    app.run();
  }
  private render() {
    this.grid.replaceChildren();
    for (const app of this.apps.filter((a) =>
      a.name.toLowerCase().includes(this.query.trim().toLowerCase()),
    )) {
      const button = el('button', 'machine-tile');
      button.dataset.app = app.id;
      button.disabled = !!app.disabled || this.offline;
      button.title = app.detail;
      button.setAttribute('aria-label', app.name);
      const mark = glyph(symbols[app.id] || Terminal);
      mark.className = 'machine-tile-icon';
      const text = el('span', 'machine-tile-name', app.name);
      button.append(mark, text, el('small', 'machine-tile-detail', app.detail));
      let held = false;
      let hold: ReturnType<typeof setTimeout> | undefined;
      const menu = () => {
        if (!app.manage || this.offline) return;
        held = true;
        this.panel.replaceChildren(); this.panel.hidden = false;
        const title = el('h2', '', app.name), back = el('button', '', '返回桌面'), manage = el('button', '', '管理应用');
        back.onclick = () => { this.panel.hidden = true; };
        manage.onclick = () => { this.panel.hidden = true; app.manage?.(); };
        this.panel.append(title, manage, back);
      };
      button.onpointerdown = () => { held = false; hold = setTimeout(menu, 550); };
      button.onpointerup = button.onpointercancel = button.onpointerleave = () => clearTimeout(hold);
      button.oncontextmenu = e => { if(app.manage) {e.preventDefault(); clearTimeout(hold); menu();} };
      button.onclick = () => { if(!held) this.launch(app); held = false; };
      this.grid.append(button);
    }
    if (!this.grid.childElementCount) this.grid.append(el('p', 'machine-empty', '没有匹配的应用'));
    this.recent.replaceChildren();
    const recent = this.history
      .map((id) => this.apps.find((a) => a.id === id))
      .filter((a): a is MachineApp => !!a && !a.disabled);
    if (recent.length) {
      const heading = el('h2', 'machine-section-title', '最近打开');
      heading.prepend(glyph(Clock));
      this.recent.append(heading);
      const list = el('div', 'machine-recent-list');
      for (const app of recent) {
        const b = el('button', '');
        b.disabled = this.offline;
        b.append(glyph(symbols[app.id] || Terminal), el('span', '', app.name));
        b.onclick = () => this.launch(app);
        list.append(b);
      }
      this.recent.append(list);
    }
  }
  private applyLook() {
    this.root.dataset.wallpaper = this.wallpaper;
    this.root.dataset.dark = String(this.dark);
  }
  private save() {
    this.applyLook();
    this.themeChanged?.(this.dark);
    try {
      localStorage.setItem(
        this.key,
        JSON.stringify({ wallpaper: this.wallpaper, dark: this.dark }),
      );
    } catch {
      this.panel.append(el('p', 'machine-empty', '外观未保存，请检查手机存储空间'));
    }
  }
  private settings() {
    this.panel.hidden = false;
    this.panel.replaceChildren();
    const header = el('header');
    const back = el('button');
    back.setAttribute('aria-label', '返回机器桌面');
    back.append(glyph(ArrowLeft));
    back.onclick = () => {
      this.panel.hidden = true;
    };
    header.append(back, el('h2', '', '桌面设置'));
    const body = el('div', 'machine-preferences-body');
    body.append(el('h3', '', '桌面背景'));
    const wallpapers = el('div', 'machine-wallpapers');
    for (const [id, name] of [
      ['coast', '海岸'],
      ['dusk', '暮色'],
      ['forest', '森林'],
      ['slate', '石墨'],
    ]) {
      const b = el('button');
      b.dataset.wallpaper = id;
      b.setAttribute('aria-label', name + '背景');
      b.setAttribute('aria-pressed', String(id === this.wallpaper));
      b.append(el('span', '', name));
      if (id === this.wallpaper) b.append(glyph(Check));
      b.onclick = () => {
        this.wallpaper = id;
        this.save();
        this.settings();
      };
      wallpapers.append(b);
    }
    body.append(wallpapers, el('h3', '', '窗口主题'));
    const themes = el('div', 'machine-theme-options');
    for (const [name, dark] of [
      ['浅色', false],
      ['深色', true],
    ] as const) {
      const b = el('button');
      b.append(glyph(dark ? Moon : Sun), el('span', '', name));
      b.setAttribute('aria-pressed', String(this.dark === dark));
      b.onclick = () => {
        this.dark = dark;
        this.save();
        this.settings();
      };
      themes.append(b);
    }
    body.append(
      themes,
      el('h3', '', '当前连接'),
      el('p', '', this.name + ' · ' + this.transport),
      el('p', 'machine-note', '外观仅保存在这台手机，不会修改远端系统或访问权限。'),
    );
    this.panel.append(header, body);
  }
}
