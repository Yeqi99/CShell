type CloudState = { email: string; unlocked: boolean; revision: number; membership?: {active: boolean; expiresAt: number | null} };
export class MobileCloud {
  private pending = new Map<
    string,
    { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();
  private state?: CloudState;
  constructor(
    private native: { cloudRequest?(json: string): void },
    private snapshot: () => { profiles: unknown[]; theme: string },
    private restore: (data: any) => void,
  ) {
    const root = document.getElementById('cloud-sync')!;
    root.innerHTML = `
      <div class="account-heading"><img src="icon.png" alt="" width="56" height="56"><h1 id="cloud-title">登录 CShell</h1><p class="muted">你的连接与设置，随账号同步。</p></div>
      <div id="cloud-account-card" hidden><p id="cloud-account"></p><span id="cloud-membership" class="member-badge"></span><p id="cloud-sync-state" class="muted"></p></div>
      <form id="cloud-login">
        <div class="login-methods" role="group" aria-label="登录方式"><button type="button" id="cloud-mode-password" aria-pressed="true">密码登录</button><button type="button" id="cloud-mode-code" aria-pressed="false">验证码登录</button></div>
        <label>邮箱<input name="email" type="email" autocomplete="email" placeholder="请输入邮箱地址" required></label>
        <label id="cloud-password-field">密码<input name="password" type="password" autocomplete="current-password" placeholder="请输入登录密码" maxlength="128" required></label>
        <label id="cloud-code-field" hidden>验证码<div class="code-input"><input name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" placeholder="6 位验证码"><button type="button" id="cloud-code">获取验证码</button></div></label>
        <button class="primary" id="cloud-password-login" type="submit">登录</button>
        <p class="login-note muted">当前为邀请测试。新账号请使用邮箱验证码验证。</p>
      </form>
      <div id="cloud-unlock" hidden><p>此设备尚未开启自动同步。已有密码的账号，请退出后使用密码登录。</p><details><summary>恢复旧账号</summary><label>恢复密钥<input id="cloud-key" type="password" autocomplete="off"></label><button id="cloud-unlock-button">恢复同步</button></details></div>
      <div id="cloud-operations" hidden><div class="sync-summary"><strong>自动同步已开启</strong><p class="muted">连接和外观设置会自动更新。模型配置随账号保留。</p></div><details><summary>同步恢复选项</summary><button id="cloud-download">重新获取云端配置</button><button id="cloud-upload">上传本机更改</button></details></div>
      <div id="cloud-confirm" hidden><p id="cloud-confirm-text"></p><button id="cloud-confirm-yes">确认</button><button id="cloud-confirm-no">取消</button></div>
      <p id="cloud-message" role="status"></p><div id="cloud-models"></div><button id="cloud-logout" class="logout-button" hidden>退出账号</button>`;
    const $ = (id: string) => document.getElementById(id)!;
    const input = (name: string) =>
      (document.querySelector(`#cloud-login [name="${name}"]`) as HTMLInputElement).value;
    let busy = false, passwordMode = true;
    const switchMode = (password: boolean) => {
      passwordMode=password;
      $('cloud-password-field').hidden=!password;
      $('cloud-code-field').hidden=password;
      (document.querySelector('#cloud-login [name="password"]') as HTMLInputElement).required=password;
      (document.querySelector('#cloud-login [name="code"]') as HTMLInputElement).required=!password;
      $('cloud-mode-password').setAttribute('aria-pressed',String(password));
      $('cloud-mode-code').setAttribute('aria-pressed',String(!password));
      $('cloud-password-login').textContent=password?'登录':'验证并登录';
      $('cloud-message').textContent='';
    };
    $('cloud-mode-password').onclick=()=>switchMode(true);
    $('cloud-mode-code').onclick=()=>switchMode(false);
    const digest = async () => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(this.snapshot()))))).map(b=>b.toString(16).padStart(2,'0')).join('');
    const run = async (action: string, args: any = {}) => {
      if(busy)return; busy=true;
      const before = await digest();
      root.querySelectorAll('button').forEach((b) => (b.disabled = true));
      if(!['status','refresh','upload'].includes(action)) $('cloud-message').textContent = action.includes('login') ? '正在登录并同步…' : '正在处理…';
      try {
        const result = await this.request(action, args);
        this.state = result.status;
        this.render();
        if (result.profiles) {
          this.restore(result);
          this.showModels(result.models);
          localStorage.setItem('cloud-snapshot-hash', await digest());
        }
        if(action === 'upload')localStorage.setItem('cloud-snapshot-hash',before);
        $('cloud-message').textContent =
          action === 'code' ? '验证码已发送，10 分钟内有效。' : '';
        if(action.includes('login')) (document.querySelector('#cloud-login [name="password"]') as HTMLInputElement).value='';
      } catch (e) {
        $('cloud-message').textContent = (e as Error).message;
      } finally {
        busy=false;
        root.querySelectorAll('button').forEach((b) => (b.disabled = false));
      }
    };
    $('cloud-code').onclick = () => { const email = document.querySelector('#cloud-login [name="email"]') as HTMLInputElement; if(email.reportValidity()) void run('code', { email: email.value }); };
    $('cloud-login').onsubmit = (e) => {
      e.preventDefault();
      void run(passwordMode ? 'password-login' : 'login', { email: input('email'), code: input(passwordMode ? 'password' : 'code') });
    };
    $('cloud-unlock-button').onclick = () => {
      const key = $('cloud-key') as HTMLInputElement;
      void run('unlock', { key: key.value });
      key.value = '';
    };
    let direction = '';
    const confirm = (value: string) => {
      direction = value;
      $('cloud-confirm').hidden = false;
      $('cloud-confirm-text').textContent =
        value === 'download'
          ? '将用云端配置更新本机已保存连接及明暗设置。当前会话保留，原连接列表会保留一份本机备份。'
          : '将本机连接更改同步到云端，桌面专属配置保留。旧版本冲突会停止上传。';
    };
    $('cloud-download').onclick = () => confirm('download');
    $('cloud-upload').onclick = () => confirm('upload');
    $('cloud-confirm-no').onclick = () => {
      $('cloud-confirm').hidden = true;
    };
    $('cloud-confirm-yes').onclick = () => {
      $('cloud-confirm').hidden = true;
      void run(direction, direction === 'upload' ? this.snapshot() : {});
    };
    $('cloud-logout').onclick = () => void run('logout');
    const autoSync=async()=>{if(busy||!this.state?.unlocked)return;const previous=localStorage.getItem('cloud-snapshot-hash');await run(previous && previous !== await digest() ? 'upload' : previous ? 'refresh' : 'download',this.snapshot());};
    void run('status').then(autoSync);
    setInterval(()=>void autoSync(),30000);
  }
  private request(action: string, args: any): Promise<any> {
    if (!this.native.cloudRequest)
      return Promise.reject(new Error('请更新 Android 应用后使用云同步'));
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('云同步超时，请重试；上传请求不会重复写入'));
      }, 45000);
      this.pending.set(id, { resolve, reject, timer });
      this.native.cloudRequest!(JSON.stringify({ request: id, action, ...args }));
    });
  }
  receive(json: string) {
    const value = JSON.parse(json),
      p = this.pending.get(value.request);
    if (!p) return;
    clearTimeout(p.timer);
    this.pending.delete(value.request);
    value.error ? p.reject(new Error(value.error)) : p.resolve(value.result);
  }
  private render() {
    const state = this.state!;
    document.getElementById('cloud-account')!.textContent = state.email
      ? state.email
      : '';
    document.getElementById('cloud-title')!.textContent=state.email?'我的账号':'登录 CShell';
    document.getElementById('cloud-account-card')!.hidden=!state.email;
    const badge=document.getElementById('cloud-membership')!;
    badge.textContent=state.membership ? state.membership.active ? 'PRO 会员' : '普通账号' : '会员状态待刷新';
    badge.classList.toggle('active',!!state.membership?.active);
    document.getElementById('cloud-sync-state')!.textContent=state.membership?.active && state.membership.expiresAt ? '会员有效期至 '+new Date(state.membership.expiresAt*1000).toLocaleDateString() : '';
    const entry=document.getElementById('account-entry');
    if(entry)entry.textContent=state.email ? state.membership?.active?'我的账号 · PRO':'我的账号' : '登录 / 注册';
    document.getElementById('cloud-login')!.hidden = !!state.email;
    document.getElementById('cloud-unlock')!.hidden = !state.email || state.unlocked;
    document.getElementById('cloud-operations')!.hidden = !state.email || !state.unlocked;
    document.getElementById('cloud-logout')!.hidden = !state.email;
  }
  private showModels(models: { name: string; model: string }[]) {
    const container = document.getElementById('cloud-models')!;
    container.replaceChildren();
    const title = document.createElement('h3');
    title.textContent = '已同步的基座配置';
    container.append(title);
    for (const model of models) {
      const row = document.createElement('p');
      row.textContent = model.name + ' · ' + model.model;
      container.append(row);
    }
  }
}
