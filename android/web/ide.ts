type Bridge = {
  machineRequest?: (json: string) => void;
  browserOpen?: (id: string, name: string, url: string) => void;
};
export class MobileIde {
  private root = document.createElement('section');
  private target = '';
  private name = '';
  private status: any;
  private pending = new Map<
    string,
    {
      target: string;
      resolve: (v: any) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private directory = '';
  private cwd = '';
  private plan: any;
  private busy = false;
  private error = '';
  private poll?: ReturnType<typeof setInterval>;
  constructor(private bridge: Bridge) {
    this.root.className = 'mobile-ide';
    this.root.hidden = true;
    document.body.append(this.root);
  }
  get visible() {
    return !this.root.hidden;
  }
  close() {
    this.root.hidden = true;
    if (this.poll) clearInterval(this.poll);
  }
  receive(target: string, json: string) {
    try {
      const v = JSON.parse(json),
        p = this.pending.get(v.request);
      if (!p || p.target !== target) return;
      this.pending.delete(v.request);
      clearTimeout(p.timer);
      if (v.error) p.reject(Error(v.error));
      else p.resolve(v.result);
    } catch {}
  }
  private call(method: string, params: unknown = {}) {
    return new Promise<any>((resolve, reject) => {
      const request = crypto.randomUUID(),
        target = this.target;
      const timer = setTimeout(() => {
        this.pending.delete(request);
        reject(Error('机器应用响应超时'));
      }, 35000);
      this.pending.set(request, { target, resolve, reject, timer });
      this.bridge.machineRequest?.(JSON.stringify({ request, session: target, method, params }));
    });
  }
  async open(id: string, name: string) {
    if (this.poll) clearInterval(this.poll);
    if (this.target !== id) {
      this.directory = '';
      this.cwd = '';
      this.plan = undefined;
      this.status = undefined;
    }
    this.target = id;
    this.name = name;
    this.root.hidden = false;
    await this.run(() => this.refresh());
    this.poll = setInterval(() => {
      if (this.status?.installing && !this.busy) void this.run(() => this.refresh());
    }, 2500);
  }
  private async refresh() {
    const target = this.target,
      v = await this.call('ide.status');
    if (target !== this.target) return;
    this.status = v;
    this.directory ||= v.directory;
    if (v.running) this.cwd = v.running.cwd;
    if (v.installError) this.error = v.installError;
  }
  private async run(fn: () => Promise<unknown>) {
    this.busy = true;
    this.error = '';
    this.render();
    try {
      await fn();
    } catch (e) {
      this.error = String(e);
    } finally {
      this.busy = false;
      this.render();
    }
  }
  private element<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', cls = '') {
    const e = document.createElement(tag);
    e.textContent = text;
    if (cls) e.className = cls;
    return e;
  }
  private button(text: string, fn: () => void, primary = false) {
    const b = this.element('button', text, primary ? 'primary' : '');
    b.disabled = this.busy;
    b.onclick = fn;
    return b;
  }
  private field(label: string, value: string, change: (v: string) => void) {
    const l = this.element('label', label),
      input = this.element('input');
    input.value = value;
    input.autocapitalize = 'none';
    input.spellcheck = false;
    input.disabled = this.busy;
    input.oninput = () => change(input.value);
    l.append(input);
    return l;
  }
  private render() {
    this.root.replaceChildren();
    const header = this.element('header');
    const close = this.button('‹', () => this.close());
    close.disabled = false;
    close.setAttribute('aria-label', '返回机器');
    header.append(close, this.element('strong', '代码编辑器'), this.element('small', this.name));
    this.root.append(header);
    const body = this.element('div', '', 'mobile-ide-body');
    this.root.append(body);
    body.append(
      this.element('div', '</>', 'mobile-ide-mark'),
      this.element('h1', '随时进入项目'),
      this.element('p', '编辑器在手机显示，文件与终端运行在当前机器。'),
    );
    if (this.error) {
      const error = this.element('p', this.error, 'error');
      error.setAttribute('role', 'alert');
      body.append(error);
    }
    if (!this.status) {
      body.append(this.element('p', this.busy ? '正在读取机器状态…' : '无法读取状态'));
      return;
    }
    if(this.status.installing)body.append(this.button('取消安装',()=>void this.run(async()=>{await this.call('ide.cancel');await this.refresh();})));
    if (this.status.ready) {
      body.append(
        this.field('项目目录', this.cwd, (v) => (this.cwd = v)),
        this.button(
          '打开项目',
          () =>
            void this.run(async () => {
              const target = this.target,
                name = this.name;
              const r = this.status.running || (await this.call('ide.start', { cwd: this.cwd }));
              if (this.target !== target) return;
              await this.refresh();
              this.bridge.browserOpen?.(target, name, r.url);
            }),
          true,
        ),
      );
      if (this.status.running) {
        const box = this.element('div', '', 'mobile-ide-access');
        box.append(
          this.element('strong', '本次访问密码'),
          this.element('p', '长按复制，在 IDE 登录页粘贴。停止后失效。'),
        );
        const input = this.element('input');
        input.value = this.status.running.password;
        input.readOnly = true;
        input.onclick = () => input.select();
        box.append(
          input,
          this.button(
            '停止 IDE',
            () =>
              void this.run(async () => {
                await this.call('ide.stop');
                await this.refresh();
              }),
          ),
        );
        body.append(box);
      }
      body.append(this.element('small', this.status.version));
    } else if (!this.status.supported)
      body.append(
        this.element('p', '此机器没有可用的独立安装包。Windows 可在真实 WSL 连接中安装。'),
      );
    else {
      body.append(
        this.field('安装目录', this.directory, (v) => {
          this.directory = v;
          this.plan = undefined;
        }),
        this.button(
          '检查安装计划',
          () =>
            void this.run(async () => {
              this.plan = await this.call('ide.plan', { directory: this.directory });
            }),
        ),
      );
      if (this.plan) {
        const card = this.element('div', '', 'mobile-ide-access');
        card.append(
          this.element('strong', 'code-server ' + this.plan.version),
          this.element('p', this.plan.directory),
        );
        for (const step of this.plan.steps) card.append(this.element('p', step));
        card.append(
          this.button(
            this.status.installing ? '正在安装…' : '安装到这台机器',
            () =>
              void this.run(async () => {
                await this.call('ide.install', { id: this.plan.id, confirm: true });
                await this.refresh();
              }),
            true,
          ),
        );
        body.append(card);
      }
    }
  }
}
