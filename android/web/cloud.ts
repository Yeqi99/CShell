type CloudState = { email: string; unlocked: boolean; revision: number };
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
    root.innerHTML =
      '<h2>账号与云同步 · Pro</h2><p class="muted">与桌面端共享加密保险库。桌面专属模型、视图等数据会保留。</p><p id="cloud-account"></p><form id="cloud-login"><label>邮箱<input name="email" type="email" autocomplete="email" required></label><button type="button" id="cloud-code">发送验证码</button><label>验证码<input name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code"></label><label>密码<input name="password" type="password" autocomplete="current-password" maxlength="128"></label><button type="button" id="cloud-password-login">密码登录</button><button>验证码注册 / 登录</button></form><div id="cloud-unlock" hidden><label>恢复密钥<input id="cloud-key" type="password" autocomplete="off"></label><button id="cloud-unlock-button">解锁</button><p class="muted">首次请在 Windows 端创建保险库并保存恢复密钥。</p></div><div id="cloud-operations" hidden><button id="cloud-download">恢复云端到本机</button><button id="cloud-upload">同步本机更改</button><p class="muted">同步当前支持的连接及明暗设置，保留其他平台配置。冲突时请先核对原设备。</p></div><div id="cloud-confirm" hidden><p id="cloud-confirm-text"></p><button id="cloud-confirm-yes">确认</button><button id="cloud-confirm-no">取消</button></div><button id="cloud-logout" hidden>退出账号</button><p id="cloud-message" role="status"></p><div id="cloud-models"></div>';
    const $ = (id: string) => document.getElementById(id)!;
    const input = (name: string) =>
      (document.querySelector(`#cloud-login [name="${name}"]`) as HTMLInputElement).value;
    const run = async (action: string, args: any = {}) => {
      root.querySelectorAll('button').forEach((b) => (b.disabled = true));
      $('cloud-message').textContent = '正在处理…';
      try {
        const result = await this.request(action, args);
        this.state = result.status;
        this.render();
        if (result.profiles) {
          this.restore(result);
          this.showModels(result.models);
        }
        $('cloud-message').textContent =
          action === 'code' ? '验证码已发送，10 分钟内有效。' : '操作完成';
      } catch (e) {
        $('cloud-message').textContent = (e as Error).message;
      } finally {
        root.querySelectorAll('button').forEach((b) => (b.disabled = false));
      }
    };
    $('cloud-password-login').onclick = () => { void run('password-login', {email: input('email'), code: input('password')}); (document.querySelector('#cloud-login [name="password"]') as HTMLInputElement).value = ''; };
    $('cloud-code').onclick = () => void run('code', { email: input('email') });
    $('cloud-login').onsubmit = (e) => {
      e.preventDefault();
      void run('login', { email: input('email'), code: input('code') });
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
    void run('status');
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
      ? state.email + ' · 云端版本 ' + state.revision
      : '';
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
