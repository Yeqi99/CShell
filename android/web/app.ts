import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import './style.css';
declare global {
  interface Window {
    CShellNative: {
      connect(data: string): void;
      input(id: string, data: string): void;
      acknowledge(id: string): void;
      resize(id: string, cols: number, rows: number): void;
      disconnect(id: string): void;
    };
    receive(id: string, type: string, value: string): void;
  }
}
const $ = (id: string) => document.getElementById(id)!;
const form = $('connect') as HTMLFormElement;
const sessions = new Map<
  string,
  { terminal: Terminal; fit: FitAddon; element: HTMLElement; tab: HTMLElement; connected: boolean }
>();
let active = '',
  ctrl = false;
let dark = localStorage.getItem('theme') === 'dark';
const theme = () => ({
  background: dark ? '#121820' : '#ffffff',
  foreground: dark ? '#d9e0e8' : '#203044',
  cursor: dark ? '#d9e0e8' : '#203044',
  selectionBackground: '#5287c866',
});
const applyTheme = () => {
  document.body.classList.toggle('dark', dark);
  for (const s of sessions.values()) s.terminal.options.theme = theme();
};
applyTheme();
function select(id: string) {
  active = id;
  form.hidden = !!id;
  for (const [key, s] of sessions) {
    s.element.hidden = key !== id;
    s.tab.classList.toggle('active', key === id);
  }
  const s = sessions.get(id);
  if (s) {
    s.fit.fit();
    s.terminal.focus();
    $('status').textContent = s.connected ? '已连接' : '连接中 / 已断开';
  }
}
function resize() {
  const s = sessions.get(active);
  if (s) {
    s.fit.fit();
    if (s.connected) window.CShellNative.resize(active, s.terminal.cols, s.terminal.rows);
  }
}
new ResizeObserver(resize).observe($('workspace'));
$('new').onclick = () => select('');
$('theme').onclick = () => {
  dark = !dark;
  localStorage.setItem('theme', dark ? 'dark' : 'light');
  applyTheme();
};
$('minimal').onclick = () => {
  const minimal = document.body.classList.toggle('minimal');
  $('minimal').textContent = minimal ? '↙' : '↗';
  $('minimal').setAttribute('aria-label', minimal ? '还原工作台' : '极简模式');
  resize();
};
$('ctrl').onclick = () => {
  ctrl = !ctrl;
  $('ctrl').classList.toggle('active', ctrl);
  sessions.get(active)?.terminal.focus();
};
document.querySelectorAll<HTMLButtonElement>('[data-key]').forEach(
  (b) =>
    (b.onclick = () => {
      const key = JSON.parse('"' + b.dataset.key + '"');
      if (sessions.get(active)?.connected) window.CShellNative.input(active, key);
      sessions.get(active)?.terminal.focus();
    }),
);
form.onsubmit = (e) => {
  e.preventDefault();
  if (sessions.size >= 12) {
    $('status').textContent = '最多 12 个会话';
    return;
  }
  const data = Object.fromEntries(new FormData(form)) as Record<string, string>;
  const id = crypto.randomUUID();
  const element = document.createElement('div');
  element.className = 'terminal';
  $('terminals').append(element);
  const terminal = new Terminal({
      fontSize: 14,
      theme: theme(),
      cursorBlink: true,
      scrollback: 5000,
    }),
    fit = new FitAddon();
  terminal.loadAddon(fit);
  terminal.open(element);
  const tab = document.createElement('div');
  tab.className = 'tab';
  const name = document.createElement('button');
  name.textContent = `${data.username}@${data.host}`;
  name.onclick = () => select(id);
  const close = document.createElement('button');
  close.textContent = '×';
  close.setAttribute('aria-label', '关闭会话');
  close.onclick = () => {
    window.CShellNative.disconnect(id);
    terminal.dispose();
    element.remove();
    tab.remove();
    sessions.delete(id);
    if (active === id) select([...sessions.keys()].at(-1) ?? '');
  };
  tab.append(name, close);
  $('tabs').append(tab);
  sessions.set(id, { terminal, fit, element, tab, connected: false });
  terminal.onData((text) => {
    if (!sessions.get(id)?.connected) return;
    if (ctrl && /^[a-zA-Z]$/.test(text)) {
      text = String.fromCharCode(text.toUpperCase().charCodeAt(0) - 64);
      ctrl = false;
      $('ctrl').classList.remove('active');
    }
    window.CShellNative.input(id, text);
  });
  terminal.onResize((size) => {
    if (sessions.get(id)?.connected) window.CShellNative.resize(id, size.cols, size.rows);
  });
  select(id);
  window.CShellNative.connect(JSON.stringify({ ...data, id, port: Number(data.port) }));
  for (const name of ['password', 'privateKey', 'passphrase'])
    (form.elements.namedItem(name) as HTMLInputElement).value = '';
};
window.receive = (id, type, value) => {
  const s = sessions.get(id);
  if (!s) return;
  if (type === 'data')
    s.terminal.write(
      Uint8Array.from(atob(value), (c) => c.charCodeAt(0)),
      () => window.CShellNative.acknowledge(id),
    );
  if (type === 'connected') {
    s.connected = true;
    if (active === id) {
      $('status').textContent = '已连接';
      resize();
    }
  }
  if (type === 'closed' || type === 'error') {
    s.connected = false;
    if (type === 'error') s.terminal.writeln('\r\n' + value.replace(/[\x00-\x1f\x7f]/g, ' '));
    if (active === id) $('status').textContent = '已断开';
  }
};
