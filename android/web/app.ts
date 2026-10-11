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
      checkUpdate(): void;
      installUpdate(): void;
      version(): string;
      setTheme(dark: boolean): void;
    };
    receive(id: string, type: string, value: string): void;
    updateEvent(json: string): void;
    mobileBack(): boolean;
  }
}
const $ = (id: string) => document.getElementById(id)!;
const icons: Record<string, string> = {
  terminal: '<path d="m5 6 6 6-6 6m9 0h5"/>',
  server:
    '<rect x="3" y="3" width="18" height="7" rx="2"/><rect x="3" y="14" width="18" height="7" rx="2"/><path d="M7 6.5h.01M7 17.5h.01"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  back: '<path d="m14 6-6 6 6 6"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
  settings:
    '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>',
  moon: '<path d="M20 13a8 8 0 0 1-9-9 8 8 0 1 0 9 9Z"/>',
  expand: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
  edit: '<path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15Z"/>',
};
function icon(el: HTMLElement, name: string) {
  el.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + icons[name] + '</svg>';
}
document.querySelectorAll<HTMLElement>('[data-icon]').forEach((el) => icon(el, el.dataset.icon!));
document.querySelector('.brand-mark')!.innerHTML =
  '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M43 19H31a13 13 0 0 0 0 26h12" fill="none" stroke="currentColor" stroke-width="6"/><path d="M37 32h12" stroke="#72a8ff" stroke-width="6"/></svg>';
const form = $('connect') as HTMLFormElement;
const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement;
type Profile = {
  id: string;
  host: string;
  username: string;
  port: string;
  name: string;
  group: string;
  auth: 'password' | 'key';
};
let profiles: Profile[] = [];
try {
  const value = JSON.parse(localStorage.getItem('profiles') || '[]');
  if (Array.isArray(value))
    profiles = value.filter(
      (p) =>
        ['id', 'host', 'username', 'port', 'name', 'group'].every(
          (k) => typeof p[k] === 'string',
        ) && ['password', 'key'].includes(p.auth),
    );
} catch {}
const sessions = new Map<
  string,
  {
    terminal: Terminal;
    fit: FitAddon;
    element: HTMLElement;
    tab: HTMLElement;
    state: string;
    profile: Profile;
  }
>();
let active = '',
  page = 'home',
  editing = '',
  auth: 'password' | 'key' = 'password',
  ctrl = false;
const drafts = new Map<string, Record<string, string>>();
let dark = localStorage.getItem('theme') === 'dark';
const theme = () => ({
  background: dark ? '#141b24' : '#ffffff',
  foreground: dark ? '#e0e7ef' : '#243348',
  cursor: dark ? '#e0e7ef' : '#243348',
  selectionBackground: '#5287c866',
});
function applyTheme() {
  document.body.classList.toggle('dark', dark);
  window.CShellNative?.setTheme?.(dark);
  for (const s of sessions.values()) s.terminal.options.theme = theme();
}
applyTheme();
function captureDraft() {
  if (page === 'connect')
    drafts.set(editing, {
      ...Object.fromEntries(new FormData(form)),
      auth,
      remember: String(($('remember') as HTMLInputElement).checked),
    } as Record<string, string>);
}
function navigate(next: string) {
  captureDraft();
  page = next;
  document.body.classList.remove('minimal');
  for (const key of ['home', 'session-page', 'connect', 'settings', 'terminals'])
    $(key).hidden = key !== next;
  const terminal = next === 'terminals';
  $('connect-actions').hidden = next !== 'connect';
  $('tabs').hidden = !terminal;
  $('terminal-tools').hidden = !terminal;
  $('minimal').hidden = !terminal;
  $('back').hidden = !['connect', 'terminals'].includes(next);
  $('minimal').setAttribute('aria-label', '极简模式');
  for (const b of document.querySelectorAll<HTMLElement>('[data-page]')) {
    const selected = b.dataset.page === (terminal ? 'session-page' : next);
    b.classList.toggle('selected', selected);
    if (selected) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  }
  render();
  if (terminal) requestAnimationFrame(resize);
}
function setAuth(value: 'password' | 'key') {
  auth = value;
  $('password-field').hidden = value !== 'password';
  $('key-fields').hidden = value !== 'key';
  for (const a of ['password', 'key']) {
    $('auth-' + a).classList.toggle('selected', a === value);
    $('auth-' + a).setAttribute('aria-pressed', String(a === value));
  }
}
function profileFields() {
  const save = ($('remember') as HTMLInputElement).checked;
  $('profile-fields').hidden = !save;
  ($('save') as HTMLButtonElement).disabled = !save;
}
function openForm(p?: Profile) {
  $('delete-profile').dataset.confirm = '';
  $('delete-profile').textContent = '删除此连接配置';
  captureDraft();
  editing = p?.id || '';
  form.reset();
  const data = drafts.get(editing) || p;
  for (const name of [
    'host',
    'username',
    'port',
    'name',
    'group',
    'password',
    'privateKey',
    'passphrase',
  ])
    if (data && name in data) field(name).value = (data as Record<string, string>)[name];
  setAuth(data?.auth === 'key' ? 'key' : 'password');
  ($('remember') as HTMLInputElement).checked =
    !data || !('remember' in data) || data.remember !== 'false';
  profileFields();
  $('form-title').textContent = p ? '连接服务器' : '新建连接';
  $('delete-profile').hidden = !p;
  $('form-error').textContent = '';
  // Current draft has already been captured; don't overwrite it while switching editors.
  page = '';
  navigate('connect');
}
function resize() {
  const s = sessions.get(active);
  if (s && page === 'terminals') {
    s.fit.fit();
    if (s.state === '已连接') window.CShellNative.resize(active, s.terminal.cols, s.terminal.rows);
  }
}
new ResizeObserver(resize).observe($('workspace'));
function select(id: string) {
  active = id;
  for (const [key, s] of sessions) {
    s.element.hidden = key !== id;
    s.tab.classList.toggle('active', key === id);
  }
  if (id) {
    navigate('terminals');
    $('status').textContent = sessions.get(id)!.state;
  } else navigate('session-page');
}
function row(name: string, detail: string, action: () => void, symbol = 'server') {
  const r = document.createElement('div');
  r.className = 'server-row';
  const b = document.createElement('button');
  b.className = 'server-open';
  b.onclick = action;
  const i = document.createElement('span');
  i.className = 'server-symbol';
  icon(i, symbol);
  const info = document.createElement('span');
  info.className = 'server-info';
  const title = document.createElement('strong');
  title.textContent = name;
  const sub = document.createElement('small');
  sub.textContent = detail;
  info.append(title, sub);
  b.append(i, info);
  r.append(b);
  return r;
}
function render() {
  $('server-count').textContent = String(profiles.length);
  $('server-list').replaceChildren();
  $('groups').replaceChildren();
  const query = ($('search') as HTMLInputElement).value.toLowerCase(),
    filtered = profiles.filter((p) =>
      [p.name, p.host, p.group].some((v) => v.toLowerCase().includes(query)),
    );
  for (const group of [...new Set(profiles.map((p) => p.group))].sort()) {
    const option = document.createElement('option');
    option.value = group;
    $('groups').append(option);
    const list = filtered.filter((p) => p.group === group);
    if (!list.length) continue;
    const h = document.createElement('h2');
    h.className = 'group-heading';
    h.textContent = (group || '未分组') + ' · ' + list.length;
    $('server-list').append(h);
    for (const p of list) {
      const live = [...sessions].find(([, s]) => s.profile.id === p.id && s.state === '已连接');
      const r = row(p.name, p.username + '@' + p.host + ' · ' + p.port, () =>
        live ? select(live[0]) : openForm(p),
      );
      if (live) {
        const indicator = document.createElement('span');
        indicator.className = 'live';
        indicator.textContent = '已连接';
        r.append(indicator);
      }
      const edit = document.createElement('button');
      edit.className = 'icon';
      edit.title = '编辑连接';
      edit.setAttribute('aria-label', '编辑 ' + p.name);
      icon(edit, 'edit');
      edit.onclick = () => openForm(p);
      r.append(edit);
      $('server-list').append(r);
    }
  }
  $('empty').hidden = profiles.length > 0;
  $('no-results').hidden = !profiles.length || !!filtered.length;
  $('session-count').textContent = String(sessions.size);
  $('session-badge').textContent = String(sessions.size);
  $('session-badge').hidden = !sessions.size;
  $('session-empty').hidden = !!sessions.size;
  $('session-list').replaceChildren();
  for (const [id, s] of sessions)
    $('session-list').append(
      row(
        s.profile.name,
        s.profile.username + '@' + s.profile.host + ' · ' + s.state,
        () => select(id),
        'terminal',
      ),
    );
}
function readProfile(): Profile {
  return {
    id: editing || crypto.randomUUID(),
    host: field('host').value.trim(),
    username: field('username').value.trim(),
    port: field('port').value,
    name: field('name').value.trim() || field('host').value.trim(),
    group: field('group').value.trim(),
    auth,
  };
}
function persist(p: Profile) {
  const next = [...profiles.filter((v) => v.id !== p.id), p];
  localStorage.setItem('profiles', JSON.stringify(next));
  profiles = next;
  render();
}
$('save').onclick = () => {
  if (!form.reportValidity()) return;
  try {
    persist(readProfile());
    drafts.delete(editing);
    page = '';
    navigate('home');
  } catch {
    $('form-error').textContent = '保存失败，请检查设备存储空间。';
  }
};
$('delete-profile').onclick = () => {
  const button = $('delete-profile');
  if (button.dataset.confirm !== 'yes') {
    button.dataset.confirm = 'yes';
    button.textContent = '再次点击删除配置（不会断开会话）';
    return;
  }
  profiles = profiles.filter((p) => p.id !== editing);
  localStorage.setItem('profiles', JSON.stringify(profiles));
  drafts.delete(editing);
  button.dataset.confirm = '';
  button.textContent = '删除此连接配置';
  page = '';
  navigate('home');
};
$('remember').onchange = profileFields;
$('auth-password').onclick = () => setAuth('password');
$('auth-key').onclick = () => setAuth('key');
for (const id of ['new', 'empty-new', 'session-new']) $(id).onclick = () => openForm();
$('back').onclick = () => navigate('home');
window.mobileBack = () => {
  if (document.body.classList.contains('minimal')) {
    document.body.classList.remove('minimal');
    resize();
    return true;
  }
  if (page !== 'home') {
    navigate('home');
    return true;
  }
  return false;
};
for (const b of document.querySelectorAll<HTMLButtonElement>('[data-page]'))
  b.onclick = () => navigate(b.dataset.page!);
$('search').oninput = render;
$('theme').onclick = () => {
  dark = !dark;
  localStorage.setItem('theme', dark ? 'dark' : 'light');
  applyTheme();
};
$('minimal').onclick = () => {
  const minimal = document.body.classList.toggle('minimal');
  $('minimal').setAttribute('aria-label', minimal ? '还原工作台' : '极简模式');
  $('minimal').title = minimal ? '还原工作台' : '极简模式';
  resize();
};
$('ctrl').onclick = () => {
  ctrl = !ctrl;
  $('ctrl').classList.toggle('active', ctrl);
  $('ctrl').setAttribute('aria-pressed', String(ctrl));
  sessions.get(active)?.terminal.focus();
};
document.querySelectorAll<HTMLButtonElement>('[data-key]').forEach(
  (b) =>
    (b.onclick = () => {
      if (sessions.get(active)?.state === '已连接')
        window.CShellNative.input(active, JSON.parse('"' + b.dataset.key + '"'));
      sessions.get(active)?.terminal.focus();
    }),
);
form.onsubmit = (e) => {
  e.preventDefault();
  if (sessions.size >= 12) {
    $('form-error').textContent = '最多打开 12 个会话，请先关闭不需要的标签。';
    return;
  }
  const p = readProfile();
  if (!p.host || !p.username) {
    $('form-error').textContent = '请填写主机地址和用户名。';
    return;
  }
  if (auth === 'key' && !field('privateKey').value.trim()) {
    $('form-error').textContent = '请填写私钥内容。';
    return;
  }
  try {
    if (($('remember') as HTMLInputElement).checked) persist(p);
  } catch {
    $('form-error').textContent = '保存失败，请检查设备存储空间。';
    return;
  }
  const id = crypto.randomUUID(),
    element = document.createElement('div');
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
  name.textContent = p.name;
  name.onclick = () => select(id);
  const close = document.createElement('button');
  close.textContent = '×';
  close.setAttribute('aria-label', '关闭 ' + p.name);
  close.onclick = () => {
    window.CShellNative.disconnect(id);
    terminal.dispose();
    element.remove();
    tab.remove();
    sessions.delete(id);
    if (active === id) select([...sessions.keys()].at(-1) || '');
    render();
  };
  tab.append(name, close);
  $('tabs').append(tab);
  sessions.set(id, { terminal, fit, element, tab, state: '连接中', profile: p });
  terminal.onData((text) => {
    if (sessions.get(id)?.state !== '已连接') return;
    if (ctrl && /^[a-zA-Z]$/.test(text)) {
      text = String.fromCharCode(text.toUpperCase().charCodeAt(0) - 64);
      ctrl = false;
      $('ctrl').classList.remove('active');
      $('ctrl').setAttribute('aria-pressed', 'false');
    }
    window.CShellNative.input(id, text);
  });
  terminal.onResize((size) => {
    if (sessions.get(id)?.state === '已连接') window.CShellNative.resize(id, size.cols, size.rows);
  });
  const credentials =
    auth === 'key'
      ? { privateKey: field('privateKey').value, passphrase: field('passphrase').value }
      : { password: field('password').value };
  for (const name of ['password', 'privateKey', 'passphrase']) field(name).value = '';
  drafts.delete(editing);
  page = '';
  select(id);
  window.CShellNative.connect(JSON.stringify({ ...p, ...credentials, id, port: Number(p.port) }));
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
    s.state = '已连接';
    if (active === id) resize();
  }
  if (type === 'closed' || type === 'error') {
    s.state = '已断开';
    if (type === 'error') s.terminal.writeln('\r\n' + value.replace(/[\x00-\x1f\x7f]/g, ' '));
  }
  if (active === id) $('status').textContent = s.state;
  render();
};
$('version').textContent = '当前版本 ' + (window.CShellNative?.version?.() || '开发预览');
$('check-update').onclick = () => window.CShellNative.checkUpdate();
$('install-update').onclick = () => window.CShellNative.installUpdate();
window.updateEvent = (json) => {
  const state = JSON.parse(json);
  $('update-status').textContent = state.message;
  ($('check-update') as HTMLButtonElement).disabled = state.busy === true;
  $('install-update').hidden = !state.available;
  ($('install-update') as HTMLButtonElement).disabled = state.busy === true;
  $('install-update').textContent = state.ready ? '安装更新' : '下载更新';
  $('update-progress').hidden = typeof state.progress !== 'number';
  ($('update-progress') as HTMLProgressElement).value = state.progress || 0;
};
render();
