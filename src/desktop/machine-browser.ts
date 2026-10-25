import { browserPagePermission } from '../core/browser-interactions';
import { agentBrowserStream, type BrowserAgentCall } from '../core/agent-browser-stream';
import {
  app,
  safeStorage,
  WebContentsView,
  session,
  BrowserWindow,
  type BrowserWindowConstructorOptions,
  type Session as ElectronSession,
} from 'electron';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { BrowserLibrary, browserUrl } from '../core/browser-library';
import { z } from 'zod';
import { createSshBrowserProxy } from '../core/ssh-browser-proxy';
import type { SshService } from '../core/ssh';
import type { MachineBrowserState } from '../shared/machine-browser';
import { browserOpenInput, browserSnapshotInput, browserCaptureInput, browserInteractInput, browserCrawlInput } from '../shared/visual-tools';
import { captureBrowser, readBrowserSnapshot, runPageOperation } from './browser-automation';
import { browserFrames } from './browser-frames';
const urlSchema = z
  .string()
  .max(8192)
  .transform((v) => new URL(v.includes('://') ? v : 'https://' + v))
  .refine(
    (v) => ['https:', 'http:'].includes(v.protocol) && !v.username && !v.password,
    '仅支持 HTTP/HTTPS 网页',
  );
type Tab = {
  id: string;
  view: WebContentsView;
  error?: string;
  url?: string;
  openerId?: string;
  fullscreen?: boolean;
};
type Workspace = {
  key: string;
  validate?: () => void;
  release?: () => void;
  monitor?: NodeJS.Timeout;
  library: BrowserLibrary;
  disposed?: boolean;
  closing?: boolean;
  persistenceError?: string;
  connectionId: string;
  tabs: Map<string, Tab>;
  selected: string;
  connected: boolean;
  ses: ElectronSession;
  proxy: Awaited<ReturnType<typeof createSshBrowserProxy>>;
};
export class MachineBrowser {
  private agentTransport?: (
    id: string,
  ) => Promise<{ key: string; call: BrowserAgentCall; validate: () => void; close?: () => void }>;
  setAgentTransport(resolve: NonNullable<MachineBrowser['agentTransport']>) {
    this.agentTransport = resolve;
  }
  private workspaces = new Map<string, Promise<Workspace>>();
  private owners = new Map<string, string>();
  private resolved = new Map<string, Workspace>();
  private live = new Set<Workspace>();
  private sessions = new Set<ElectronSession>();
  private automationBusy = new WeakSet<Workspace>();
  private privateInputs = new WeakMap<Workspace,Set<string>>();
  private borrowed = new Map<Tab,{bounds:Electron.Rectangle;visible:boolean}>();
  private layout(tab:Tab,visible:boolean,bounds?:Electron.Rectangle){
    const pending=this.borrowed.get(tab);
    if(pending){pending.visible=visible;if(bounds)pending.bounds=bounds;return;}
    tab.view.setVisible(visible);if(bounds)tab.view.setBounds(bounds);
  }
  constructor(
    private window: BrowserWindow,
    private ssh: SshService,
  ) {
    window.on('close', () => {
      for (const w of this.live) {
        this.save(w);
        w.closing = true;
      }
      setTimeout(() => {
        if (!window.isDestroyed()) for (const w of this.live) w.closing = false;
      }, 200);
    });
    window.once('closed', () => {
      for (const p of this.workspaces.values()) void p.then((w) => this.dispose(w)).catch(() => {});
      this.workspaces.clear();
    });
  }
  async flush() {
    await Promise.all(
      [...this.sessions].map(async (s) => {
        s.flushStorageData();
        await s.cookies.flushStore();
      }),
    );
  }
  private alive(t: Tab) {
    return !!t.view.webContents && !t.view.webContents.isDestroyed();
  }
  private prune(w: Workspace) {
    for (const t of w.tabs.values()) if (!this.alive(t)) this.removeTab(w, t);
    if (!w.tabs.has(w.selected)) w.selected = w.tabs.keys().next().value || '';
  }
  private removeTab(w: Workspace, tab: Tab) {
    if (!w.tabs.has(tab.id)) return;
    w.tabs.delete(tab.id);
    if (!this.window.isDestroyed()) this.window.contentView.removeChildView(tab.view);
    if (w.selected === tab.id) {
      const opener = tab.openerId && w.tabs.get(tab.openerId);
      w.selected =
        opener && this.alive(opener)
          ? opener.id
          : [...w.tabs.values()].find((t) => this.alive(t))?.id || '';
    }
  }
  private save(w: Workspace) {
    if (w.disposed) return;
    try {
      this.prune(w);
      const tabs = [...w.tabs.values()];
      w.library.data.tabs = tabs.map((t) => ({
        url: browserUrl(t.url || '') ? t.url! : 'about:blank',
        title: (t.view.webContents.getTitle() || '新标签页').slice(0, 256),
        zoom: Math.max(0.5, Math.min(2, t.view.webContents.getZoomFactor())),
      }));
      w.library.data.selected = Math.max(
        0,
        tabs.findIndex((t) => t.id === w.selected),
      );
      w.library.save();
      w.persistenceError = undefined;
    } catch (e) {
      w.persistenceError = '浏览器状态保存失败：' + String(e);
    }
  }
  private dispose(w: Workspace) {
    if (w.disposed) return;
    if ([...w.tabs.values()].some((t) => this.alive(t))) this.save(w);
    if (w.monitor) clearInterval(w.monitor);
    w.disposed = true;
    w.connected = false;
    for (const [id, current] of this.resolved) if (current === w) {
      this.resolved.delete(id);
      this.workspaces.delete(id);
      if (this.owners.get(w.key) === id) this.owners.delete(w.key);
    }
    this.live.delete(w);
    w.ses.flushStorageData();
    void w.ses.cookies.flushStore().catch(() => {});
    w.proxy.close();
    w.release?.();
    for (const t of w.tabs.values()) {
      if (!this.window.isDestroyed()) this.window.contentView.removeChildView(t.view);
      if (this.alive(t)) t.view.webContents.close({ waitForBeforeUnload: false });
    }
    w.tabs.clear();
    w.selected = '';
  }
  private async workspace(id: string) {
    const sourceId = id.startsWith('ide@') ? id.slice(4) : id;
    let pending = this.workspaces.get(id);
    if (pending) return pending;
    pending = (async () => {
      const remote = sourceId.startsWith('agent-session:') ? await this.agentTransport?.(sourceId.slice(14)) : /^[0-9a-f-]{36}$/i.test(sourceId) ? undefined : await this.agentTransport?.(sourceId);
      if (!remote && !/^[0-9a-f-]{36}$/i.test(sourceId)) throw Error('浏览器连接不可用');
      if (remote) {
        try {
          await remote.call('browser.status');
        } catch (error) {
          remote.close?.();
          throw error;
        }
      }
      const connection = remote ? undefined : this.ssh.get(sourceId);
      const key = createHash('sha256')
        .update(
          remote
            ? remote.key
            : JSON.stringify([
                connection!.profile.id,
                connection!.profile.host,
                connection!.profile.port,
                connection!.profile.username,
              ]),
        )
        .update(id.startsWith('ide@') ? ':ide' : '')
        .digest('hex');
      if (this.owners.has(key) && this.owners.get(key) !== id) {
        const owner = this.owners.get(key)!;
        const previous = await this.workspaces.get(owner)?.catch(() => undefined);
        if (previous && !previous.disposed && previous.connected) {
          try { previous.validate?.(); }
          catch { this.dispose(previous); }
          if (!previous.disposed) {
            // A machine owns one local browser partition. Multiple connections
            // in this window reuse its tabs instead of competing for a lock.
            // The separately authenticated new transport is unused and released.
            remote?.close?.();
            this.resolved.set(id, previous);
            return previous;
          }
        }
        if (this.owners.get(key) === owner) this.owners.delete(key);
      }
      this.owners.set(key, id);
      const proxy = await createSshBrowserProxy((host, port, done) => {
        if (remote) {
          try {
            remote.validate();
            void agentBrowserStream(remote.call, host, port).then(
              (s) => done(null, s),
              (e) => done(e),
            );
          } catch (e) {
            done(e as Error);
          }
          return;
        }
        try {
          const c = this.ssh.get(sourceId);
          if (c.closed) throw Error('SSH 已断开');
          c.client.forwardOut('127.0.0.1', 0, host, port, (e, s) => done(e || null, s));
        } catch (e) {
          done(e as Error);
        }
      });
      try {
        // Stable per saved target, including address/user, never shared with the CShell UI session.
        const library = new BrowserLibrary(
          join(app.getPath('userData'), 'machine-browser', key + '.bin'),
          {
            encrypt: (s) => {
              if (!safeStorage.isEncryptionAvailable()) throw Error('系统加密存储不可用');
              return safeStorage.encryptString(s);
            },
            decrypt: (b) => safeStorage.decryptString(b),
          },
        );
        const ses = session.fromPartition('persist:machine-browser-' + key);
        this.sessions.add(ses);
        await ses.setProxy({
          mode: 'fixed_servers',
          proxyRules: 'socks5://127.0.0.1:' + proxy.port,
          proxyBypassRules: '<-loopback>',
        });
        await ses.closeAllConnections();

        ses.on('will-download', (event) => event.preventDefault());
        const w: Workspace = {
          key,
          library,
          connectionId: id,
          tabs: new Map(),
          selected: '',
          connected: !connection?.closed,
          validate: remote?.validate,
          release: remote?.close,
          ses,
          proxy,
        };
        this.resolved.set(id, w);
        const allow = (contents: Electron.WebContents | null, permission: string) => {
          const t = w.tabs.get(w.selected);
          return browserPagePermission(
            permission,
            !!(
              w.connected &&
              !w.disposed &&
              t &&
              this.alive(t) &&
              contents === t.view.webContents &&
              contents.isFocused() &&
              this.window.isFocused() &&
              browserUrl(contents.getURL())
            ),
          );
        };
        ses.setPermissionRequestHandler((contents, permission, reply) =>
          reply(allow(contents, permission)),
        );
        ses.setPermissionCheckHandler((contents, permission) => allow(contents, permission));
        this.live.add(w);
        ses.webRequest.onBeforeRequest((details, reply) =>
          reply({
            cancel:
              !w.connected ||
              !['http:', 'https:', 'ws:', 'wss:', 'data:', 'blob:', 'about:'].includes(
                new URL(details.url).protocol,
              ),
          }),
        );
        const disconnected = () => {
          w.connected = false;
          this.dispose(w);
          void ses.closeAllConnections();
        };
        connection?.client.once('close', disconnected);
        if (remote) {
          let checking = false;
          w.monitor = setInterval(() => {
            if (checking) return;
            checking = true;
            Promise.resolve()
              .then(() => {
                remote.validate();
                return remote.call('browser.status');
              })
              .catch(disconnected)
              .finally(() => {
                checking = false;
              });
          }, 3000);
        }
        if (connection?.closed) {
          w.connected = false;
          this.dispose(w);
        }
        if (w.connected && !id.startsWith('ide@')) {
          const saved = library.data.tabs.map((t) => ({ ...t })),
            selected = library.data.selected;
          for (const item of saved) {
            const t = this.tab(w);
            t.view.webContents.setZoomFactor(item.zoom);
            if (browserUrl(item.url)) void this.navigate(t, item.url);
          }
          w.selected = [...w.tabs.keys()][selected] || [...w.tabs.keys()][0] || '';
        }
        return w;
      } catch (error) {
        proxy.close();
        remote?.close?.();
        throw error;
      }
    })();
    this.workspaces.set(id, pending);
    pending.catch(() => {
      if (this.workspaces.get(id) !== pending) return;
      const failed = this.resolved.get(id);
      if (failed) this.dispose(failed);
      this.workspaces.delete(id);
      for (const [key, owner] of this.owners) if (owner === id) this.owners.delete(key);
    });
    return pending;
  }
  private tab(w: Workspace, options?: BrowserWindowConstructorOptions, openerId?: string) {
    if (w.tabs.size >= 12) throw Error('最多打开 12 个标签页');
    const view = new WebContentsView({
      // Electron supplies the already-created popup webContents in options.
      // Adopt that exact instance; creating another breaks openGuestWindow.
      ...options,
      webPreferences: {
        // Preserve Electron's native popup/opener metadata and navigation payload.
        ...options?.webPreferences,
        session: w.ses,
        preload: undefined,
        sandbox: true,
        nodeIntegration: false,
        nodeIntegrationInWorker: false,
        nodeIntegrationInSubFrames: false,
        webviewTag: false,
        contextIsolation: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        spellcheck: false,
        disableHtmlFullscreenWindowResize: true,
      },
    });
    view.webContents.setZoomFactor(0.9);
    const tab: Tab = { id: randomUUID(), view, openerId };
    w.tabs.set(tab.id, tab);
    w.selected = tab.id;
    this.window.contentView.addChildView(view);
    view.setVisible(false);
    const contents = view.webContents;
    contents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
    contents.on('enter-html-full-screen', () => {
      tab.fullscreen = true;
    });
    contents.on('leave-html-full-screen', () => {
      tab.fullscreen = false;
    });
    contents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown' || !input.control) return;
      const key = input.key.toLowerCase();
      if (!['l', 't', 'w'].includes(key)) return;
      event.preventDefault();
      if (key === 'l') {
        this.window.webContents.focus();
        this.window.webContents.send('machine-browser:focus', w.connectionId);
      } else
        void this.action(w.connectionId, key === 't' ? 'new' : 'close', tab.id).catch(() => {});
    });
    contents.on('will-navigate', (event, url) => {
      if (!/^https?:\/\//i.test(url)) event.preventDefault();
    });
    contents.on('will-redirect', (event, url) => {
      if (!/^https?:\/\//i.test(url)) event.preventDefault();
    });
    contents.setWindowOpenHandler(({ url }) => {
      if (
        !w.connected ||
        w.disposed ||
        w.closing ||
        !this.alive(tab) ||
        w.tabs.size >= 12 ||
        !(url === 'about:blank' || browserUrl(url))
      )
        return { action: 'deny' };
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          webPreferences: {
            session: w.ses,
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
            nodeIntegrationInWorker: false,
            nodeIntegrationInSubFrames: false,
            webviewTag: false,
            webSecurity: true,
            allowRunningInsecureContent: false,
            spellcheck: false,
          },
        },
        createWindow: (options) => {
          // Chromium performs the original navigation, including POST/referrer,
          // and maintains WindowProxy/postMessage. Never recreate via loadURL.
          const next = this.tab(w, options, tab.id);
          for (const other of w.tabs.values()) this.layout(other,false);
          return next.view.webContents;
        },
      };
    });
    contents.on('did-fail-load', (_e, code, description, _url, isMain) => {
      if (isMain && code !== -3) tab.error = description;
    });
    contents.on('did-start-navigation', () => {
      tab.error = undefined;
    });
    const remember = () => {
      if (w.disposed || !this.alive(tab)) return;
      const url = contents.getURL();
      if (browserUrl(url)) {
        tab.url = url;
        w.library.visit(url, contents.getTitle() || url);
      }
      this.save(w);
    };
    contents.on('did-navigate', remember);
    contents.on('did-navigate-in-page', remember);
    contents.on('page-title-updated', () => {
      if (w.disposed || !this.alive(tab)) return;
      const existing = w.library.data.history.find((e) => e.url === contents.getURL());
      if (existing) existing.title = contents.getTitle().slice(0, 256);
      this.save(w);
    });
    contents.once('destroyed', () => {
      if (w.disposed || w.closing) return;
      this.removeTab(w, tab);
      this.prune(w);
      this.save(w);
    });
    return tab;
  }
  private async navigate(t: Tab, url: string) {
    try {
      const parsed = urlSchema.parse(url);
      if (!this.alive(t)) return;
      t.url = parsed.href;
      await t.view.webContents.loadURL(parsed.href);
    } catch (e) {
      t.error = (e as Error).message;
    }
  }
  private state(w: Workspace): MachineBrowserState {
    this.prune(w);
    return {
      history: w.library.data.history,
      bookmarks: w.library.data.bookmarks,
      persistenceError: w.persistenceError,
      connected: w.connected,
      selected: w.selected,
      tabs: [...w.tabs.values()].map((t) => ({
        id: t.id,
        title: t.view.webContents.getTitle() || '新标签页',
        url: t.url || t.view.webContents.getURL(),
        loading: t.view.webContents.isLoading(),
        zoom: t.view.webContents.getZoomFactor(),
        back: t.view.webContents.navigationHistory.canGoBack(),
        forward: t.view.webContents.navigationHistory.canGoForward(),
        error: t.error,
        fullscreen: t.fullscreen,
      })),
    };
  }
  /** Only host-registered tools call this. The registry enforces caller/target grants first. */
  async automation(id: string, action: string, raw: unknown, signal: AbortSignal, authorize?:()=>void) {
    signal.throwIfAborted();authorize?.();
    const w=await this.workspace(id);
    const guard=()=>{signal.throwIfAborted();authorize?.();w.validate?.();if(w.disposed||!w.connected)throw Error('机器连接已断开，浏览器不会回退本机网络');};
    guard();
    const secrets=this.privateInputs.get(w)??new Set<string>();this.privateInputs.set(w,secrets);
    const clean=(value:any):any=>{if(Array.isArray(value))return value.map(clean);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,entry])=>[key,typeof entry==='string'&&['text','name','title','href','url'].includes(key)?[...secrets].sort((a,b)=>b.length-a.length).reduce((s,secret)=>s.split(secret).join('[输入内容已隐藏]'),entry):typeof entry==='object'?clean(entry):entry]));return value;};
    if(this.automationBusy.has(w))throw Error('此机器的浏览器正在执行另一项操作，请稍后重试');
    this.automationBusy.add(w);
    const presentations=new Set<Tab>();let background:BrowserWindow|undefined;
    const present=(t:Tab)=>{if(!t.view.getVisible()&&!presentations.has(t)){presentations.add(t);this.borrowed.set(t,{bounds:t.view.getBounds(),visible:false});background??=new BrowserWindow({show:false,width:1280,height:800,webPreferences:{sandbox:true,nodeIntegration:false,contextIsolation:true,backgroundThrottling:false}});this.window.contentView.removeChildView(t.view);background.contentView.addChildView(t.view);t.view.setBounds({x:0,y:0,width:1280,height:800});t.view.setVisible(true);}return t;};
    const tab=(id:string)=>{const t=w.tabs.get(id);if(!t||!this.alive(t))throw Error('标签页不属于此机器或已经关闭');return present(t);};
    const load=async(t:Tab,url:string)=>{urlSchema.parse(url);guard();t.error=undefined;const abort=()=>t.view.webContents.stop();signal.addEventListener('abort',abort,{once:true});try{await this.navigate(t,url);guard();if(t.error)throw Error(t.error);}finally{signal.removeEventListener('abort',abort);}};
    try {
      if(action==='tabs')return clean({tabs:this.state(w).tabs,connected:w.connected});
      if(action==='frames'){const p=z.object({tabId:z.string().uuid()}).strict().parse(raw);const frames=await browserFrames(tab(p.tabId).view.webContents);guard();return clean({frames:frames.map(({session,...frame})=>frame)});}
      if(action==='open') {const p=browserOpenInput.parse(raw),t=present(this.tab(w));try{await load(t,p.url);return {tabId:t.id,...this.state(w).tabs.find(v=>v.id===t.id)};}catch(error){this.removeTab(w,t);if(this.alive(t))t.view.webContents.close({waitForBeforeUnload:false});throw error;}}
      if(action==='snapshot'){const p=browserSnapshotInput.parse(raw),result=await readBrowserSnapshot(tab(p.tabId).view.webContents,p,guard);guard();return clean(result);}
      if(action==='capture'){const p=browserCaptureInput.parse(raw),result=await captureBrowser(tab(p.tabId).view.webContents,id,p.maxWidth,p.quality);guard();return result;}
      if(action==='interact') {
        const p=browserInteractInput.parse(raw),t=tab(p.tabId),contents=t.view.webContents;guard();
        if(p.action==='fill'||p.action==='select'){const text=p.action==='fill'?p.text:p.value;if(text&&!secrets.has(text)){if(secrets.size>=256||[...secrets].reduce((n,s)=>n+s.length,0)+text.length>1048576)throw Error('当前浏览器输入已达保护容量，请重新连接后再试');secrets.add(text);}}
        if(p.action==='navigate')await load(t,p.url);
        else if(p.action==='close'){this.removeTab(w,t);contents.close({waitForBeforeUnload:false});}
        else if(p.action==='reload')contents.reload();
        else if(p.action==='back'){if(!contents.navigationHistory.canGoBack())throw Error('没有上一页');contents.navigationHistory.goBack();}
        else if(p.action==='forward'){if(!contents.navigationHistory.canGoForward())throw Error('没有下一页');contents.navigationHistory.goForward();}
        else if(p.action==='key'){contents.sendInputEvent({type:'keyDown',keyCode:p.key,modifiers:p.modifiers});contents.sendInputEvent({type:'keyUp',keyCode:p.key,modifiers:p.modifiers});}
        else {const result=await runPageOperation(contents,p,guard);guard();if(p.action==='click'&&!result.clicked){const point={x:Math.round(result.x),y:Math.round(result.y),button:'left' as const,clickCount:1};contents.sendInputEvent({type:'mouseDown',...point});contents.sendInputEvent({type:'mouseUp',...point});}}
        guard();this.save(w);return {completed:true,tabId:p.tabId};
      }
      if(action==='crawl') {
        const p=browserCrawlInput.parse(raw),source=tab(p.tabId),origin=urlSchema.parse(source.view.webContents.getURL()).origin;
        const urls=p.urls.map(url=>urlSchema.parse(url));if(urls.some(url=>url.origin!==origin))throw Error('抓取仅支持当前页面同源地址');
        const selected=w.selected,t=present(this.tab(w));w.selected=selected;
        const prevent=(event:Electron.Event,url:string)=>{if(new URL(url).origin!==origin)event.preventDefault();};
        t.view.webContents.on('will-redirect',prevent);t.view.webContents.on('will-navigate',prevent);
        try{const pages=[];for(const url of urls){await load(t,url.href);guard();if(new URL(t.view.webContents.getURL()).origin!==origin)throw Error('页面跳转离开允许的来源');pages.push(await runPageOperation(t.view.webContents,{action:'text',maxText:p.maxText},guard));}guard();return clean({pages});}
        finally{this.removeTab(w,t);if(this.alive(t))t.view.webContents.close({waitForBeforeUnload:false});if(w.tabs.has(selected))w.selected=selected;}
      }
      throw Error('未知浏览器工具操作');
    } finally {for(const t of presentations){const pending=this.borrowed.get(t);this.borrowed.delete(t);if(this.alive(t)){background?.contentView.removeChildView(t.view);if(!this.window.isDestroyed()&&w.tabs.has(t.id)){this.window.contentView.addChildView(t.view);this.layout(t,pending?.visible??false,pending?.bounds);}}}background?.destroy();this.automationBusy.delete(w);}
  }
  async action(id: string, action: string, value?: unknown) {
    z.string().min(1).max(100).parse(id);
    z.enum([
      'hide',
      'status',
      'open',
      'new',
      'select',
      'close',
      'navigate',
      'back',
      'forward',
      'zoom',
      'bookmark',
      'clear-history',
      'remove-history',
      'clear-logins',
      'exit-fullscreen',
      'reload',
      'stop',
      'bounds',
    ]).parse(action);
    if (['hide', 'status', 'bounds'].includes(action) && !this.workspaces.has(id))
      return { tabs: [], selected: '', connected: false };
    const w = await this.workspace(id);
    try {
      w.validate?.();
    } catch (e) {
      w.connected = false;
      this.dispose(w);
      throw e;
    }
    this.prune(w);
    if (action === 'hide') {
      if (w.connectionId === id) for (const t of w.tabs.values()) this.layout(t,false);
      return this.state(w);
    }
    if (action === 'status') return this.state(w);
    if (!w.connected) throw Error('服务器连接已断开；浏览器未切换到本地网络');
    if (!['status', 'hide', 'bounds'].includes(action)) w.connectionId = id;
    if (action === 'open' && w.tabs.size === 0) this.tab(w);
    if (action === 'new') this.tab(w);
    if (action === 'select') {
      const key = z.string().uuid().parse(value);
      if (!w.tabs.has(key)) throw Error('标签页不存在');
      w.selected = key;
    }
    if (action === 'close') {
      const key = z.string().uuid().parse(value),
        t = w.tabs.get(key);
      if (t) {
        this.removeTab(w, t);
        t.view.webContents.close();
      }
      if (w.selected === key) w.selected = [...w.tabs.keys()][0] || '';
      if (!w.tabs.size) this.tab(w);
    }
    const t = w.tabs.get(w.selected);
    if (action === 'bookmark') {
      const input = z
        .object({ url: z.string().max(8192), title: z.string().max(256) })
        .parse(value);
      w.library.bookmark(input.url, input.title);
    }
    if (action === 'exit-fullscreen' && t)
      await t.view.webContents.executeJavaScript(
        'if(document.fullscreenElement)document.exitFullscreen()',
      );
    if (action === 'remove-history') {
      const url = z.string().max(8192).parse(value);
      w.library.data.history = w.library.data.history.filter((e) => e.url !== url);
      w.library.save();
    }
    if (action === 'clear-logins') {
      z.object({ confirm: z.literal(true) })
        .strict()
        .parse(value);
      for (const tab of [...w.tabs.values()]) {
        this.removeTab(w, tab);
        if (this.alive(tab)) tab.view.webContents.close({ waitForBeforeUnload: false });
      }
      await w.ses.clearAuthCache();
      await w.ses.clearStorageData();
      await w.ses.clearCache();
      await w.ses.closeAllConnections();
      w.ses.flushStorageData();
      await w.ses.cookies.flushStore();
      this.tab(w);
    }
    if (action === 'clear-history') {
      w.library.data.history = [];
      w.library.save();
    }
    if (action === 'navigate' && t) {
      void this.navigate(t, z.string().parse(value));
      this.save(w);
    }
    if (action === 'back' && t?.view.webContents.navigationHistory.canGoBack())
      t.view.webContents.navigationHistory.goBack();
    if (action === 'forward' && t?.view.webContents.navigationHistory.canGoForward())
      t.view.webContents.navigationHistory.goForward();
    if (action === 'zoom' && t)
      t.view.webContents.setZoomFactor(z.number().min(0.5).max(2).parse(value));
    if (action === 'reload' && t) t.view.webContents.reload();
    if (action === 'stop' && t) t.view.webContents.stop();
    if (action === 'bounds') {
      const bounds = z
        .object({
          x: z.number().int().min(0),
          y: z.number().int().min(0),
          width: z.number().int().min(0),
          height: z.number().int().min(0),
          visible: z.boolean(),
        })
        .parse(value);
      // Late hide/bounds events from an inactive alias cannot hide the browser
      // currently presented by another workspace.
      if (!bounds.visible && w.connectionId !== id) return this.state(w);
      if (bounds.visible) w.connectionId = id;
      const [width, height] = this.window.getContentSize();
      for (const tab of w.tabs.values()) {
        const visible =
          tab === t &&
          bounds.visible &&
          bounds.x + bounds.width <= width + 1 &&
          bounds.y + bounds.height <= height + 1;
        this.layout(tab,visible,visible?{
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height,
          }:undefined);
      }
    } else if (['new', 'select', 'close'].includes(action)) {
      for (const tab of w.tabs.values()) this.layout(tab,false);
    }
    if (!['bounds', 'status', 'hide'].includes(action)) this.save(w);
    return this.state(w);
  }
}
