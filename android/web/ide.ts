type Bridge = {
  machineRequest?: (json: string) => void;
  browserOpenApp?: (id: string, name: string, url: string) => void;
  browserOpen?: (id: string, name: string, url: string) => void;
};
export class MobileIde {
  private root = document.createElement('section');
  private target = '';
  private generation = 0;
  constructor(private bridge: Bridge) {
    this.root.className = 'mobile-ide'; this.root.hidden = true; document.body.append(this.root);
  }
  get visible() { return !this.root.hidden; }
  close() { this.generation++; this.root.hidden = true; }
  private pending = new Map<
    string,
    {
      target: string;
      resolve: (v: any) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
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
    const generation = ++this.generation;
    this.target = id; this.root.hidden = false;
    const back = document.createElement('button'); back.textContent = '返回机器'; back.onclick = () => this.close();
    const title = document.createElement('h2'); title.textContent = '正在打开代码编辑器';
    this.root.replaceChildren(back, title);
    try {
      const status = await this.call('ide.status');
      if (generation !== this.generation) return;
      if (!status.ready) throw Error('请在应用市场完成代码编辑器安装。');
      if (!status.launchVersion) throw Error('请更新这台机器的 cagent 后重试。');
      const result = await this.call('ide.start', {cwd: status.running?.cwd || ''});
      if (generation !== this.generation) return;
      (this.bridge.browserOpenApp || this.bridge.browserOpen)?.(id, name, result.url);
      this.root.hidden = true;
    } catch(e) {
      if (generation !== this.generation) return;
      title.textContent = '代码编辑器未能打开';
      const message = document.createElement('p'); message.textContent = String(e); message.setAttribute('role', 'alert');
      const retry = document.createElement('button'); retry.textContent = '重试'; retry.onclick = () => void this.open(id, name);
      this.root.append(message, retry);
    }
  }
}