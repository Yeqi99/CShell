import {MachineHome,type MachineApp} from './machine-home';
import {MobileCoding} from './coding';
import {MobileCloud} from './cloud';
import {MobileIde} from './ide';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import './style.css';
import './account.css';
import {MobileDesktop} from './desktop';

declare global {
  interface Window {
    CShellNative: {
      cloudRequest?(json:string):void;
      browserSupported?(): boolean;
      browserOpen?(id:string,name:string,url:string):void;
      machineRequest?(json:string):void;
      cagentStatus?(): string;
      cagentConfigure?(data: string): string;
      cagentStart?(): void;
      cagentStop?(): void;
      cagentAccessibility?(): void;
      cagentBackgroundSettings?(): void;
      cagentCopyConnection?(): void;
      fileRequest(data: string): void;
      localFilesStatus?(): string;
      localFilesChoose?(): void;
      connect(data: string): void;
      openAgent(id: string, index: number): void;
      desktopOpen(id:string,options:string):void;
      desktopClose(id:string):void;
      desktopCommand(id:string,command:string):void;
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
    localFilesChanged(json: string): void;
    receive(id: string, type: string, value: string): void;
    updateEvent(json: string): void;
    mobileBack(): boolean;
  }
}
const $ = (id: string) => document.getElementById(id)!;
const desktop=new MobileDesktop(window.CShellNative);
const mobileIde=new MobileIde(window.CShellNative);
const mobileCoding=new MobileCoding(window.CShellNative,(id,apps)=>{machineApps.set(id,{...machineApps.get(id),...apps});updateMachineApps(id);});
const machineHomes=new Map<string,MachineHome>();
const machineShells=new Map<string,{label:string;index:number}[]>();
const openedShells=new Map<string,number>();
const machineApps=new Map<string,{browser?:boolean;ide?:boolean;codex?:boolean;claude?:boolean;market?:boolean;files?:boolean}>();
const desktopStatus=new Map<string,{packageReady?:boolean;viewAllowed?:boolean;controlAllowed?:boolean;inputFeatures?:string[];qualityModes?:string[]}>();
const icons: Record<string, string> = {
  browser: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
  extensions: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 17.5h7m-3.5-3.5v7"/>',
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
document.querySelector('.brand-mark')!.innerHTML = '<img src="icon.png" alt="" width="32" height="32">';
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
    'account',
    'extensions',
    'cagent',
    'terminals',
  ])
    $(key).hidden = key !== next;
  const terminal = next === 'terminals';
  $('connect-actions').hidden = next !== 'connect';
  $('tabs').hidden = !terminal;
  $('terminal-tools').hidden = !terminal;
  $('minimal').hidden = !terminal;
  $('back').hidden = !['connect', 'terminals', 'cagent'].includes(next) && !(next==='files'&&machineHomes.has(active));
  $('back').setAttribute('aria-label',next==='files'&&machineHomes.has(active)?'返回机器':'返回工作台');
  $('minimal').setAttribute('aria-label', '极简模式');
  for (const b of document.querySelectorAll<HTMLElement>('[data-page]')) {
    const selected = b.dataset.page === (terminal ? 'session-page' : next === 'cagent' ? 'extensions' : next);
    b.classList.toggle('selected', selected);
    if (selected) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  }
  render();
  if (next === 'files') syncFileSessions();
  if (next === 'cagent' || next === 'extensions') refreshCAgent();
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
function connectedMachine(state: string) { return ['已连接', '已连接 CAgent', '正在打开终端'].includes(state); }
function render() {
  $('overview-connections').textContent = String(profiles.length);
  $('overview-sessions').textContent = String(
    [...sessions.values()].filter((s) => connectedMachine(s.state)).length,
  );
  $('recent-connections').replaceChildren();
  for (const p of profiles.slice(-5).reverse())
    $('recent-connections').append(
      row(p.name, p.host, () => {
        const live = [...sessions].find(([, s]) => s.profile.id === p.id && connectedMachine(s.state));
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
      const live = [...sessions].find(([, s]) => s.profile.id === p.id && connectedMachine(s.state));
      const r = row(
        (p.favorite ? '★ ' : '') + p.name,
        (p.protocol === 'agent' ? 'Agent · ' : p.username + '@') + p.host + ' · ' + p.port,
        () => (live ? select(live[0]) : activateProfile(p)),
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
$('back').onclick = () => {if(page==='files'&&machineHomes.has(active)){select(active);machineHomes.get(active)!.show();}else navigate(page === 'cagent' ? 'extensions' : 'home');};
window.mobileBack = () => {
  if(mobileCoding.visible){mobileCoding.close();return true;}
  if(mobileIde.visible){mobileIde.close();return true;}
  if(desktop.visible){desktop.close();return true;}
  if (document.body.classList.contains('minimal')) {
    document.body.classList.remove('minimal');
    resize();
    return true;
  }
  if(page==='files'&&machineHomes.has(active)){select(active);machineHomes.get(active)!.show();return true;}
  if(page==='terminals'&&machineHomes.has(active)&&machineHomes.get(active)!.root.hidden){machineHomes.get(active)!.show();return true;}
  if (page !== 'home') {
    navigate(page === 'cagent' ? 'extensions' : 'home');
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
    mobileCoding.disconnected(id, true); mobileIde.disconnected(id);
    terminal.dispose();
    element.remove();
    tab.remove();
    sessions.delete(id);machineHomes.delete(id);machineApps.delete(id);machineShells.delete(id);openedShells.delete(id);
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
  window.CShellNative.connect(JSON.stringify({ ...p, ...credentials, cloudProfileId:p.id, id, port: Number(p.port) }));
};
function showMachine(id:string){const s=sessions.get(id);if(!s)return;let home=machineHomes.get(id);if(!home){home=new MachineHome(s.profile.name,s.profile.host,s.profile.id,s.profile.protocol==='agent'?'cagent':'cagent · SSH',(value)=>{dark=value;applyTheme();});machineHomes.set(id,home);s.element.append(home.root);const back=document.createElement('button');back.className='machine-home';back.textContent='机器桌面';back.setAttribute('aria-label','返回机器桌面');back.onclick=()=>home!.show();s.element.append(back);}home.show();updateMachineApps(id);}
function updateMachineApps(id:string){
 const s=sessions.get(id),home=machineHomes.get(id),cap=machineApps.get(id)||{};if(!s||!home)return;
 const apps:MachineApp[]=[];
 if(cap.browser&&window.CShellNative.browserSupported?.())apps.push({id:'browser',name:'浏览器',detail:'通过这台机器访问网页',run:()=>window.CShellNative.browserOpen?.(id,s.profile.name,'')});
 const shell=openedShells.get(id);
 if(s.profile.protocol!=='agent')apps.push({id:'terminal',name:'SSH 终端',detail:'命令与终端历史',run:()=>{home.hide();s.terminal.focus();resize();}});
 else for(const choice of machineShells.get(id)||[]){if(shell!==undefined&&choice.index!==shell)continue;apps.push({id:'terminal',name:choice.label,detail:shell!==undefined?'继续当前终端':'打开终端',run:()=>{if(openedShells.has(id)){home.hide();s.terminal.focus();resize();return;}s.state='正在打开终端';$('status').textContent=s.state;window.CShellNative.openAgent(id,choice.index);openedShells.set(id,choice.index);}});}
 if(s.profile.protocol!=='agent'||cap.files)apps.push({id:'files',name:'文件',detail:'浏览、预览与传输',run:()=>{fileSource='remote';fileSession=id;navigate('files');syncFileSessions();}});
 if(cap.market)apps.push({id:'market',name:'应用市场',detail:'安装与管理远端应用',run:()=>mobileCoding.open(id,s.profile.name,'market',()=>void mobileIde.open(id,s.profile.name))});
 if(cap.ide)apps.push({id:'ide',name:'代码编辑器',detail:'项目文件与集成终端',run:()=>void mobileIde.open(id,s.profile.name)});
 for(const engine of ['codex','claude'] as const)if(cap[engine])apps.push({id:engine,name:engine==='codex'?'Codex':'Claude Code',detail:'项目会话与模型服务',run:()=>mobileCoding.open(id,s.profile.name,engine)});
 const remote=desktopStatus.get(id);if(remote?.packageReady)apps.push({id:'remote',name:'远程控制',detail:remote.viewAllowed?'查看和操作远端桌面':'等待远端共享或授权',disabled:!remote.viewAllowed,run:()=>desktop.open(id,remote)});
 for(const app of apps)if(['ide','codex','claude'].includes(app.id)&&cap.market)app.manage=()=>mobileCoding.open(id,s.profile.name,'market',()=>void mobileIde.open(id,s.profile.name));
 home.setApps(apps);
}
function updateAgentDesktopEntry(id:string){updateMachineApps(id);}
window.receive = (id, type, value) => {
  if(type==='cloud-result'){mobileCloud.receive(value);return;}
  if(type==='ssh-workspace'){const s=sessions.get(id);if(s&&s.state!=='已断开'&&value==='ready')showMachine(id);return;}

  if(type==='machine-result'){mobileIde.receive(id,value);mobileCoding.receive(id,value);return;}
  if(type==='machine-apps'){try{machineApps.set(id,JSON.parse(value));updateMachineApps(id);}catch{}return;}
  if (type === 'cagent-status') { receiveCAgent(value); return; }
  if(type.startsWith('desktop-')){
    if(type==='desktop-status')try{desktopStatus.set(id,JSON.parse(value));updateAgentDesktopEntry(id);}catch{}
    else desktop.event(id,type,value);
    return;
  }
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
      machineShells.set(id,choices.map((choice,index)=>({index,label:choice.distribution?choice.distribution+' · WSL':choice.label})));
      showMachine(id);
      s.state = '已连接 CAgent';
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
    machineHomes.get(id)?.hide();
    if (s.profile.protocol === 'agent' && value) {
      updateMachineApps(id);
    }
    if (active === id) resize();
  }
  if (type === 'closed' || type === 'error') {
    mobileCoding.disconnected(id); mobileIde.disconnected(id);
    machineApps.delete(id);machineHomes.get(id)?.disconnected();machineShells.delete(id);openedShells.delete(id);s.element.querySelector('.machine-home')?.remove();
    desktop.event(id,'desktop-closed',type==='error'?value:'机器连接已断开');desktopStatus.delete(id);
    s.state = '已断开';
    if(!machineHomes.has(id))s.element.querySelector('.agent-environments')?.remove();
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
const mobileCloud=new MobileCloud(window.CShellNative,()=>({profiles,theme:dark?'dark':'light'}),data=>{
  localStorage.setItem('profiles-before-cloud',JSON.stringify(profiles));
  profiles=data.profiles;localStorage.setItem('profiles',JSON.stringify(profiles));
  dark=data.theme==='dark';localStorage.setItem('theme',dark?'dark':'light');applyTheme();render();
});

// File requests are bound to an explicit live session; stale responses never replace another machine.
const filePaths = new Map<string, string>();
let localFileParent: string | null = null;
let fileSource: 'remote' | 'local' = localStorage.getItem('fileSource') === 'local' ? 'local' : 'remote';
let localFileState: {available?: boolean; name?: string; path?: string; error?: string} = {};
try { localFileState = JSON.parse(window.CShellNative?.localFilesStatus?.() || '{}'); } catch { /* Choosing a folder offers recovery. */ }
function remoteFileSessionReady(id: string) { return ['已连接', '已连接 CAgent'].includes(sessions.get(id)?.state || ''); }
function fileSessionReady() { return fileSession === 'local' ? !!localFileState.available : remoteFileSessionReady(fileSession); }
let fileSession = '',
  listingRequest = '',
  fileBusy = false;
const pendingFiles = new Map<string, { session: string; operation: string; timer: ReturnType<typeof setTimeout> }>();
function syncFileSessions() {
  for (const source of ['remote', 'local']) $('files-' + source).setAttribute('aria-pressed', String(fileSource === source));
  const select = $('files-session') as HTMLSelectElement;
  const live = [...sessions].filter(
    ([id]) => remoteFileSessionReady(id),
  );
  const previous = fileSession;
  if (fileSource === 'local') fileSession = localFileState.available ? 'local' : '';
  else if (!live.some(([id]) => id === fileSession))
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
  $('files-empty').hidden = !!fileSession;
  select.hidden = !fileSession || fileSource === 'local';
  $('files-choose').hidden = fileSource !== 'local';
  ($('files-path') as HTMLInputElement).readOnly = fileSource === 'local';
  $('files-empty').querySelector('h2')!.textContent = fileSource === 'local' ? '选择手机文件夹' : '连接后管理文件';
  ($('files-empty').querySelector('button') as HTMLButtonElement).hidden = fileSource === 'local';
  $('files-upload').setAttribute('aria-label', fileSource === 'local' ? '导入到当前文件夹' : '上传到当前目录');
  $('files-path-form').hidden = !fileSession;
  $('files-upload').hidden = !fileSession;
  $('files-refresh').hidden = !fileSession;
  $('files-status').hidden = !fileSession;
  for (const id of ['files-upload', 'files-refresh', 'files-up'])
    ($(id) as HTMLButtonElement).disabled = !fileSession;
  if (!fileSession) {
    $('files-empty-description').textContent =
      fileSource === 'local' ? localFileState.error || '选择一个文件夹后，仅浏览和管理你授权的目录。' : '连接服务器后，可以浏览目录、预览和传输文件。';
    ($('files-path') as HTMLInputElement).value = '.';
    fileBusy = false;
    listingRequest = '';
    for (const [id, pending] of pendingFiles) {
      clearTimeout(pending.timer);
      pendingFiles.delete(id);
    }
    $('files-list').replaceChildren();
    $('file-preview').hidden = true;
  } else if (previous !== fileSession || !$('files-list').childElementCount)
    requestFiles('list', filePaths.get(fileSession) || '.');
}
function requestFiles(operation: string, path: string) {
  if (!fileSession || !fileSessionReady()) return;
  if (!window.CShellNative?.fileRequest) {
    $('files-status').textContent = '请更新 Android 客户端以使用文件功能';
    return;
  }
  if (pendingFiles.size >= 16) {
    $('files-status').textContent = '请等待当前操作完成';
    return;
  }
  const request = crypto.randomUUID();
  const timer = setTimeout(() => window.fileEvent(JSON.stringify({ request, error: '文件操作超时，请重试；传输可在设备文件选择器中重新发起。' })), operation === 'upload' || operation === 'download' ? 300000 : 30000);
  pendingFiles.set(request, { session: fileSession, operation, timer });
  if (operation === 'list') {
    listingRequest = request;
    fileBusy = true;
    $('files-list').replaceChildren();
    $('file-preview').hidden = true;
  }
  $('files-status').textContent = operation === 'list' ? '正在读取…' : '正在处理…';
  try { window.CShellNative.fileRequest(
    JSON.stringify({ request, session: fileSession, operation, path }),
  ); } catch (error) {
    window.fileEvent(JSON.stringify({ request, error: error instanceof Error ? error.message : '无法读取文件，请重试' }));
  }
}
$('files-session').onchange = () => {
  fileSession = ($('files-session') as HTMLSelectElement).value;
  $('files-list').replaceChildren();
  $('file-preview').hidden = true;
  requestFiles('list', filePaths.get(fileSession) || '.');
};
for (const source of ['remote', 'local'] as const) $('files-' + source).onclick = () => {
  fileSource = source;
  localStorage.setItem('fileSource', source);
  for (const option of ['remote', 'local']) $('files-' + option).setAttribute('aria-pressed', String(source === option));
  if (source === 'local') {
    try { localFileState = JSON.parse(window.CShellNative?.localFilesStatus?.() || '{"error":"请更新 Android 客户端以使用手机文件"}'); } catch { localFileState = {error: '无法读取目录授权，请重新选择文件夹'}; }
  }
  $('files-list').replaceChildren();
  syncFileSessions();
};
$('files-choose').onclick = () => window.CShellNative?.localFilesChoose?.();
window.localFilesChanged = (json) => {
  try { localFileState = JSON.parse(json); } catch { return; }
  filePaths.delete('local');
  if (fileSource === 'local') { $('files-list').replaceChildren(); syncFileSessions(); }
};
$('files-path-form').onsubmit = (e) => {
  e.preventDefault();
  requestFiles('list', fileSession === 'local' ? filePaths.get('local') || '.' : ($('files-path') as HTMLInputElement).value);
};
$('files-refresh').onclick = () => {
  if (!fileBusy) requestFiles('list', filePaths.get(fileSession) || '.');
};
$('files-up').onclick = () => {
  if (fileSession === 'local') { if (localFileParent) requestFiles('list', localFileParent); return; }
  const path = filePaths.get(fileSession) || '/';
  requestFiles('list', path.replace(/\/[^/]+\/?$/, '') || '/');
};
$('files-upload').onclick = () => requestFiles('upload', filePaths.get(fileSession) || '.');
$('preview-close').onclick = () => {
  $('file-preview').hidden = true;
};
window.fileEvent = (json) => {
  let result;
  try { result = JSON.parse(json); } catch { return; }
  if (!result || typeof result !== 'object') return;
  const
    pending = pendingFiles.get(result.request);
  if (!pending) return;
  clearTimeout(pending.timer);
  pendingFiles.delete(result.request);
  if (pending.operation === 'list' && result.request === listingRequest) fileBusy = false;
  if (pending.session !== fileSession || !fileSessionReady()) return;
  if (pending.operation === 'list' && result.request !== listingRequest) return;
  if (result.error) {
    $('files-status').textContent = result.error;
    return;
  }
  if (pending.operation === 'list') {
    filePaths.set(fileSession, result.path);
    if (fileSession === 'local') localFileParent = result.parent || null;
    ($('files-up') as HTMLButtonElement).disabled = fileSession === 'local' && !localFileParent;
    ($('files-path') as HTMLInputElement).value = fileSession === 'local' ? result.name || localFileState.name || '所选文件夹' : result.path;
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
        b.setAttribute('aria-label', (fileSession === 'local' ? '导出 ' : '下载 ') + entry.name);
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

type CAgentState = { supported?: boolean; enabled?: boolean; running?: boolean; sharing?: boolean; starting?: boolean; needsProjectionConsent?: boolean; screenLocked?: boolean; ignoringBatteryOptimizations?: boolean; accessibilityEnabled?: boolean; port?: number; advertisedHost?: string; advertisedPort?: number; password?: string; error?: string };
let cagentState: CAgentState = {};
let cagentDraftDirty = false;
const cagentInput = (id: string) => $(id) as HTMLInputElement;
function cagentFeedback(message: string, error = false) {
  $('cagent-feedback').textContent = message;
  $('cagent-feedback').classList.toggle('error', error);
}
function renderCAgent(fill = false) {
  const available = !!window.CShellNative?.cagentStatus && cagentState.supported !== false;
  const enabled = available && !!cagentState.enabled;
  cagentInput('cagent-enabled').checked = enabled;
  cagentInput('cagent-enabled').disabled = !available;
  ($('cagent-fields') as HTMLFieldSetElement).disabled = !enabled;
  $('cagent-card-state').textContent = !available ? '不可用' : cagentState.sharing ? '共享中' : enabled ? '已启用' : '未启用';
  $('cagent-status').textContent = !available ? '手机受控端需要 Android 10 或更新版本。' : cagentState.error || (cagentState.running ? '已监听 · ' + (cagentState.port || 24443) : enabled ? '已启用 · 等待启动' : '启用后可设置连接地址，按需共享此手机屏幕。');
  $('cagent-status').classList.toggle('error', !!cagentState.error);
  $('cagent-screen-state').textContent = cagentState.sharing ? '正在共享此手机屏幕' : cagentState.starting ? '等待 Android 屏幕共享授权' : cagentState.screenLocked ? '手机已锁屏 · 解锁后可重新共享' : cagentState.needsProjectionConsent ? '屏幕共享已结束 · 请重新授权共享' : '未共享';
  $('cagent-start').textContent = cagentState.needsProjectionConsent ? '重新授权共享屏幕' : '共享手机屏幕';
  $('cagent-access-state').textContent = cagentState.accessibilityEnabled ? '已开启 · 可接收远程操作' : '未开启 · 仅能观看画面';
  $('cagent-background-state').textContent = cagentState.ignoringBatteryOptimizations ? '已允许后台运行 · 屏幕共享仍受系统授权限制' : '省电限制可能中断后台连接，可在系统设置中调整。';
  ($('cagent-background') as HTMLButtonElement).disabled = !window.CShellNative?.cagentBackgroundSettings;
  $('cagent-start').hidden = !!cagentState.sharing;
  ($('cagent-start') as HTMLButtonElement).disabled = !enabled || !!cagentState.starting || cagentDraftDirty;
  $('cagent-stop').hidden = !cagentState.sharing && !cagentState.starting;
  ($('cagent-access') as HTMLButtonElement).disabled = !enabled;
  ($('cagent-copy') as HTMLButtonElement).disabled = !enabled || !cagentState.running || cagentDraftDirty;
  if (fill || !cagentDraftDirty) {
    cagentInput('cagent-port').value = String(cagentState.port || 24443);
    cagentInput('cagent-public-port').value = cagentState.advertisedPort ? String(cagentState.advertisedPort) : '';
    cagentInput('cagent-host').value = cagentState.advertisedHost || '';
    cagentInput('cagent-password').value = cagentState.password || '';
  }
}
function receiveCAgent(json: string) {
  try {
    const state = JSON.parse(json);
    if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('无效的 CAgent 状态');
    cagentState = state;
    renderCAgent();
  } catch { cagentFeedback('无法读取 CAgent 状态，请重新打开扩展。', true); }
}
function refreshCAgent() {
  try {
    if (window.CShellNative?.cagentStatus) receiveCAgent(window.CShellNative.cagentStatus());
    else renderCAgent();
  } catch { cagentFeedback('无法读取 CAgent 状态，请重新打开扩展。', true); }
}
function configureCAgent(config: Record<string, unknown>): boolean {
  try {
    if (!window.CShellNative.cagentConfigure) throw new Error('此版本未提供 CAgent');
    const state = JSON.parse(window.CShellNative.cagentConfigure(JSON.stringify(config))) as CAgentState;
    cagentState = state;
    if (state.error) { renderCAgent(); cagentFeedback(state.error, true); return false; }
    renderCAgent();
    return true;
  } catch (error) { cagentFeedback(error instanceof Error ? error.message : '设置未保存', true); renderCAgent(); return false; }
}
$('cagent-open').onclick = () => navigate('cagent');
$('cagent-enabled').onchange = () => {
  const enabled = cagentInput('cagent-enabled').checked;
  if (configureCAgent({ enabled })) cagentFeedback(enabled ? '已启用。保存连接设置后可开始共享。' : '已停用，远程连接已停止。');
};
$('cagent-config').oninput = () => { cagentDraftDirty = true; renderCAgent(); cagentFeedback('设置未保存'); };
$('cagent-config').onsubmit = (event) => {
  event.preventDefault();
  const config = {
    port: Number(cagentInput('cagent-port').value),
    advertisedPort: Number(cagentInput('cagent-public-port').value) || 0,
    advertisedHost: cagentInput('cagent-host').value.trim(),
    password: cagentInput('cagent-password').value,
  };
  if (configureCAgent(config)) { cagentDraftDirty = false; renderCAgent(true); cagentFeedback('已保存'); }
};
$('cagent-password-toggle').onclick = () => {
  const field = cagentInput('cagent-password');
  const show = field.type === 'password';
  field.type = show ? 'text' : 'password';
  $('cagent-password-toggle').textContent = show ? '隐藏' : '显示';
  $('cagent-password-toggle').setAttribute('aria-label', show ? '隐藏连接密码' : '显示连接密码');
  $('cagent-password-toggle').setAttribute('aria-pressed', String(show));
};
for (const [id, action] of [
  ['cagent-start', () => window.CShellNative.cagentStart?.()],
  ['cagent-stop', () => window.CShellNative.cagentStop?.()],
  ['cagent-access', () => window.CShellNative.cagentAccessibility?.()],
  ['cagent-background', () => window.CShellNative.cagentBackgroundSettings?.()],
  ['cagent-copy', () => window.CShellNative.cagentCopyConnection?.()],
] as const) $(id).onclick = () => {
  try { action(); refreshCAgent(); if (!cagentState.error) cagentFeedback(id === 'cagent-copy' ? '已复制连接信息，不包含密码' : ''); }
  catch (error) { cagentFeedback(error instanceof Error ? error.message : '操作未完成', true); }
};
window.addEventListener('focus', () => { if (page === 'cagent') refreshCAgent(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && page === 'cagent') refreshCAgent(); });
window.addEventListener('cagent-status', ((event: CustomEvent) => receiveCAgent(typeof event.detail === 'string' ? event.detail : JSON.stringify(event.detail))) as EventListener);
