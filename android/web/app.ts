import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import './style.css';

declare global {
  interface Window {
    CShellNative: {
      fileRequest(data: string): void;
      connect(data: string): void;
      openAgent(id: string, index: number): void;
      agentSupported(): boolean;
      resetAgentTrust(host: string, port: number): void;
      input(id: string, data: string): void;
      acknowledge(id: string): void;
      resize(id: string, cols: number, rows: number): void;
      disconnect(id: string): void;
      checkUpdate(): void;
      installUpdate(): void;
      version(): string;
      openUpdatePage(): void;
      setTheme(dark: boolean): void;
    };
    agentTrustReset(host: string, port: number): void;
    fileEvent(json: string): void;
    receive(id: string, type: string, value: string): void;
    updateEvent(json: string): void;
    mobileBack(): boolean;
  }
}
const $ = (id: string) => document.getElementById(id)!;
const icons: Record<string, string> = {
  home: '<path d="m3 10 9-7 9 7v10H3Z M9 20v-7h6v7"/>',
  folder: '<path d="M3 7V4h6l3 3h9v13H3Z"/>',
  file: '<path d="M5 3h9l5 5v13H5Z M14 3v6h5"/>',
  refresh: '<path d="M20 8a8 8 0 1 0 0 8M20 3v5h-5"/>',
  up: '<path d="m5 12 7-7 7 7m-7-7v15"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  upload: '<path d="M12 16V3m-5 5 5-5 5 5M3 15v6h18v-6"/>',
  download: '<path d="M12 3v13m-5-5 5 5 5-5M3 15v6h18v-6"/>',
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
  protocol?: 'ssh' | 'agent';
  favorite?: boolean;
  agentAuthorized?: boolean;
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
let protocol: '' | 'ssh' | 'agent' = '';
const protocolDrafts = new Map<string, Record<string, string>>();
function chooseProtocol(value: '' | 'ssh' | 'agent', resetPort = false) {
  if (resetPort && protocol)
    protocolDrafts.set(editing + ':' + protocol, {
      ...Object.fromEntries(new FormData(form)),
      auth,
    } as Record<string, string>);
  if (resetPort) {
    const draft = protocolDrafts.get(editing + ':' + value);
    for (const name of ['host', 'username', 'password', 'privateKey', 'passphrase'])
      field(name).value = draft?.[name] || (name === 'username' ? 'root' : '');
    setAuth(draft?.auth === 'key' ? 'key' : 'password');
    field('port').value = draft?.port || (value === 'agent' ? '47831' : '22');
  }
  protocol = value;
  $('connection-fields').hidden = !value;
  $('protocol-label').textContent = value === 'agent' ? 'Agent' : value === 'ssh' ? 'SSH' : '';
  $('username-field').hidden = value !== 'ssh';
  field('username').required = value === 'ssh';
  $('ssh-auth').hidden = value !== 'ssh';
  field('password').placeholder =
    value === 'agent' ? '访问密码，已授权的设备可留空' : '输入登录密码';
  $('agent-identity').hidden = value !== 'agent' || !editing;
  if (value === 'agent') setAuth('password');
  field('port').min = value === 'agent' ? '1024' : '1';
  for (const kind of ['ssh', 'agent']) {
    $('protocol-' + kind).classList.toggle('selected', kind === value);
    $('protocol-' + kind).setAttribute('aria-pressed', String(kind === value));
  }
  for (const button of $('connect-actions').querySelectorAll<HTMLButtonElement>('button'))
    button.disabled = !value;
  if (value) profileFields();
}
$('protocol-ssh').onclick = () => chooseProtocol('ssh', true);
$('protocol-agent').onclick = () => chooseProtocol('agent', true);
if (window.CShellNative?.agentSupported?.() === false) {
  ($('protocol-agent') as HTMLButtonElement).disabled = true;
  $('protocol-agent').title = '需要 Android 10 或更新版本';
  $('protocol-agent').textContent = 'Agent · Android 10+';
}
$('agent-reset-trust').onclick = () => {
  if (protocol !== 'agent' || !field('host').reportValidity() || !field('port').reportValidity())
    return;
  window.CShellNative.resetAgentTrust(field('host').value.trim(), Number(field('port').value));
};
window.agentTrustReset = (host, port) => {
  profiles = profiles.map((p) =>
    p.protocol === 'agent' && p.host.toLowerCase() === host.toLowerCase() && Number(p.port) === port
      ? { ...p, agentAuthorized: false }
      : p,
  );
  try {
    localStorage.setItem('profiles', JSON.stringify(profiles));
  } catch {
    /* Native pin was still cleared; metadata is not authority. */
  }
  if (
    page === 'connect' &&
    protocol === 'agent' &&
    field('host').value.trim().toLowerCase() === host.toLowerCase() &&
    Number(field('port').value) === port
  ) {
    field('password').value = '';
    $('form-error').textContent = '已清除保存的指纹。下次连接需重新核对身份，并按需填写凭证。';
  }
  render();
};
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
      protocol,
      favorite: String(field('favorite').checked),
      remember: String(($('remember') as HTMLInputElement).checked),
    } as Record<string, string>);
}
function navigate(next: string) {
  captureDraft();
  page = next;
  document.body.classList.remove('minimal');
  for (const key of [
    'home',
    'connections',
    'files',
    'session-page',
    'connect',
    'settings',
    'terminals',
  ])
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
  if (next === 'files') syncFileSessions();
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
  field('favorite').checked = data?.favorite === true || data?.favorite === 'true';
  ($('remember') as HTMLInputElement).checked =
    !data || !('remember' in data) || data.remember !== 'false';
  profileFields();
  $('form-title').textContent = p ? '连接服务器' : '新建连接';
  $('delete-profile').hidden = !p;
  $('form-error').textContent = '';
  // Current draft has already been captured; don't overwrite it while switching editors.
  page = '';
  navigate('connect');
  chooseProtocol(data?.protocol === 'agent' ? 'agent' : data ? 'ssh' : '');
}
function activateProfile(profile: Profile) {
  openForm(profile);
  if (profile.protocol === 'agent' && profile.agentAuthorized) form.requestSubmit();
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
    $('terminal-protocol').textContent =
      (sessions.get(id)!.profile.protocol === 'agent' ? 'Agent' : 'SSH') + ' · UTF-8';
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
  $('overview-connections').textContent = String(profiles.length);
  $('overview-sessions').textContent = String(
    [...sessions.values()].filter((s) => s.state === '已连接').length,
  );
  $('recent-connections').replaceChildren();
  for (const p of profiles.slice(-5).reverse())
    $('recent-connections').append(
      row(p.name, p.host, () => {
        const live = [...sessions].find(([, s]) => s.profile.id === p.id && s.state === '已连接');
        live ? select(live[0]) : activateProfile(p);
      }),
    );
  $('home-empty').hidden = profiles.length > 0;
  $('home-sessions').replaceChildren();
  for (const [id, s] of sessions)
    $('home-sessions').append(row(s.profile.name, s.state, () => select(id), 'terminal'));
  $('home-session-empty').hidden = sessions.size > 0;
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
      const r = row(
        (p.favorite ? '★ ' : '') + p.name,
        (p.protocol === 'agent' ? 'Agent · ' : p.username + '@') + p.host + ' · ' + p.port,
        () => (live ? select(live[0]) : openForm(p)),
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
        (s.profile.protocol === 'agent' ? 'Agent · ' : s.profile.username + '@') +
          s.profile.host +
          ' · ' +
          s.state,
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
    protocol: protocol === 'agent' ? 'agent' : 'ssh',
    favorite: field('favorite').checked,
    agentAuthorized: profiles.some(
      (p) =>
        p.id === editing &&
        p.protocol === 'agent' &&
        p.host === field('host').value.trim() &&
        p.port === field('port').value &&
        p.agentAuthorized,
    ),
  };
}
function persist(p: Profile) {
  const next = [...profiles.filter((v) => v.id !== p.id), p];
  localStorage.setItem('profiles', JSON.stringify(next));
  profiles = next;
  render();
}
$('save').onclick = () => {
  if (!protocol || !form.reportValidity()) return;
  try {
    persist(readProfile());
    drafts.delete(editing);
    page = '';
    navigate('connections');
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
for (const id of ['new', 'empty-new', 'session-new', 'home-new']) $(id).onclick = () => openForm();
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
  b.onclick = () =>
    b.dataset.page === 'session-page' && active ? select(active) : navigate(b.dataset.page!);
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
  if (!protocol || !p.host || (protocol === 'ssh' && !p.username)) {
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
  protocolDrafts.delete(editing + ':agent');
  protocolDrafts.delete(editing + ':ssh');
  page = '';
  select(id);
  window.CShellNative.connect(JSON.stringify({ ...p, ...credentials, id, port: Number(p.port) }));
};
window.receive = (id, type, value) => {
  const s = sessions.get(id);
  if (!s) return;
  if (type === 'environments') {
    try {
      const saved = profiles.find(
        (p) =>
          p.id === s.profile.id &&
          p.protocol === 'agent' &&
          p.host === s.profile.host &&
          p.port === s.profile.port,
      );
      if (saved) {
        try {
          persist({ ...saved, agentAuthorized: true });
        } catch {
          /* Connection remains usable if metadata storage is full. */
        }
      }
      const choices = JSON.parse(value) as {
        shell: string;
        label: string;
        distribution?: string;
      }[];
      const picker = document.createElement('section');
      picker.className = 'agent-environments';
      const title = document.createElement('h2');
      title.textContent = '选择终端环境';
      const target = document.createElement('p');
      target.textContent = s.profile.name + ' · ' + s.profile.host;
      picker.append(title, target);
      choices.forEach((choice, index) => {
        const button = document.createElement('button');
        button.textContent = choice.distribution ? choice.distribution + ' · WSL' : choice.label;
        button.onclick = () => {
          for (const b of picker.querySelectorAll('button')) b.disabled = true;
          s.state = '正在打开终端';
          $('status').textContent = s.state;
          window.CShellNative.openAgent(id, index);
        };
        picker.append(button);
      });
      s.element.append(picker);
      s.state = '选择终端环境';
    } catch {
      s.state = '环境列表无效';
      window.CShellNative.disconnect(id);
    }
  }
  if (type === 'data')
    s.terminal.write(
      Uint8Array.from(atob(value), (c) => c.charCodeAt(0)),
      () => window.CShellNative.acknowledge(id),
    );
  if (type === 'connected') {
    s.state = '已连接';
    s.element.querySelector('.agent-environments')?.remove();
    if (s.profile.protocol === 'agent' && value) {
      s.profile = { ...s.profile, name: s.profile.name + ' / ' + value };
      s.tab.querySelector('button')!.textContent = s.profile.name;
    }
    if (active === id) resize();
  }
  if (type === 'closed' || type === 'error') {
    s.state = '已断开';
    s.element.querySelector('.agent-environments')?.remove();
    if (type === 'error') s.terminal.writeln('\r\n' + value.replace(/[\x00-\x1f\x7f]/g, ' '));
  }
  if (active === id) $('status').textContent = s.state;
  if (page === 'files') syncFileSessions();
  render();
};
$('version').textContent = '当前版本 ' + (window.CShellNative?.version?.() || '开发预览');
$('check-update').onclick = () => {
  window.updateEvent(JSON.stringify({ message: '正在检查更新…', busy: true }));
  try {
    window.CShellNative.checkUpdate();
  } catch {
    window.updateEvent(
      JSON.stringify({ message: '无法启动更新检查，请重新打开应用后重试。', busy: false }),
    );
  }
};
$('install-update').onclick = () => {
  try {
    window.CShellNative.installUpdate();
  } catch {
    window.updateEvent(JSON.stringify({ message: '无法启动更新，请重新检查更新。', busy: false }));
  }
};
$('update-page').onclick = () => window.CShellNative.openUpdatePage();
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

// File requests are bound to an explicit live session; stale responses never replace another machine.
const filePaths = new Map<string, string>();
let fileSession = '',
  listingRequest = '',
  fileBusy = false;
const pendingFiles = new Map<string, { session: string; operation: string }>();
function syncFileSessions() {
  const select = $('files-session') as HTMLSelectElement;
  const live = [...sessions].filter(
    ([, s]) => s.state === '已连接' && s.profile.protocol !== 'agent',
  );
  const previous = fileSession;
  if (!live.some(([id]) => id === fileSession))
    fileSession = live.some(([id]) => id === active) ? active : live[0]?.[0] || '';
  select.replaceChildren();
  for (const [id, s] of live) {
    const o = document.createElement('option');
    o.value = id;
    o.textContent = s.profile.name + ' · ' + s.profile.host;
    select.append(o);
  }
  select.value = fileSession;
  select.disabled = !fileSession;
  for (const id of ['files-upload', 'files-refresh', 'files-up'])
    ($(id) as HTMLButtonElement).disabled = !fileSession;
  if (!fileSession) {
    $('files-status').textContent =
      sessions.get(active)?.profile.protocol === 'agent'
        ? '此 Agent 连接尚未提供文件能力'
        : '连接服务器后浏览文件';
    $('files-list').replaceChildren();
    $('file-preview').hidden = true;
  } else if (previous !== fileSession || !$('files-list').childElementCount)
    requestFiles('list', filePaths.get(fileSession) || '.');
}
function requestFiles(operation: string, path: string) {
  if (!fileSession || sessions.get(fileSession)?.state !== '已连接') return;
  if (!window.CShellNative?.fileRequest) {
    $('files-status').textContent = '请更新 Android 客户端以使用文件功能';
    return;
  }
  if (pendingFiles.size >= 16) {
    $('files-status').textContent = '请等待当前操作完成';
    return;
  }
  const request = crypto.randomUUID();
  pendingFiles.set(request, { session: fileSession, operation });
  if (operation === 'list') {
    listingRequest = request;
    fileBusy = true;
  }
  $('files-status').textContent = operation === 'list' ? '正在读取…' : '正在处理…';
  window.CShellNative.fileRequest(
    JSON.stringify({ request, session: fileSession, operation, path }),
  );
}
$('files-session').onchange = () => {
  fileSession = ($('files-session') as HTMLSelectElement).value;
  $('files-list').replaceChildren();
  $('file-preview').hidden = true;
  requestFiles('list', filePaths.get(fileSession) || '.');
};
$('files-path-form').onsubmit = (e) => {
  e.preventDefault();
  requestFiles('list', ($('files-path') as HTMLInputElement).value);
};
$('files-refresh').onclick = () => {
  if (!fileBusy) requestFiles('list', filePaths.get(fileSession) || '.');
};
$('files-up').onclick = () => {
  const path = filePaths.get(fileSession) || '/';
  requestFiles('list', path.replace(/\/[^/]+\/?$/, '') || '/');
};
$('files-upload').onclick = () => requestFiles('upload', filePaths.get(fileSession) || '.');
$('preview-close').onclick = () => {
  $('file-preview').hidden = true;
};
window.fileEvent = (json) => {
  const result = JSON.parse(json),
    pending = pendingFiles.get(result.request);
  if (!pending) return;
  pendingFiles.delete(result.request);
  if (pending.operation === 'list' && result.request === listingRequest) fileBusy = false;
  if (pending.session !== fileSession || sessions.get(fileSession)?.state !== '已连接') return;
  if (pending.operation === 'list' && result.request !== listingRequest) return;
  if (result.error) {
    $('files-status').textContent = result.error;
    return;
  }
  if (pending.operation === 'list') {
    filePaths.set(fileSession, result.path);
    ($('files-path') as HTMLInputElement).value = result.path;
    $('files-list').replaceChildren();
    $('file-preview').hidden = true;
    for (const entry of result.entries) {
      const r = row(
        entry.name,
        entry.directory ? '文件夹' : (entry.size / 1024).toFixed(1) + ' KB',
        () => requestFiles(entry.directory ? 'list' : 'preview', entry.path),
        entry.directory ? 'folder' : 'file',
      );
      if (!entry.directory) {
        const b = document.createElement('button');
        b.className = 'icon';
        b.setAttribute('aria-label', '下载 ' + entry.name);
        icon(b, 'download');
        b.onclick = () => requestFiles('download', entry.path);
        r.append(b);
      }
      $('files-list').append(r);
    }
    $('files-status').textContent = result.entries.length + ' 项';
  } else if (pending.operation === 'preview') {
    $('preview-name').textContent = result.name;
    $('preview-text').textContent = result.text;
    $('file-preview').hidden = false;
    $('files-status').textContent = '只读预览 · 最大 64 KiB';
  } else {
    $('files-status').textContent = result.cancelled ? '已取消' : '传输完成';
    if (pending.operation === 'upload' && !result.cancelled)
      requestFiles('list', filePaths.get(fileSession) || '.');
  }
};
