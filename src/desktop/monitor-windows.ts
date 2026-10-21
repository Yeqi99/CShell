import { BrowserWindow, ipcMain, screen } from 'electron';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { Profile } from '../shared/contracts';
import type { Store } from '../core/store';
import { arrangeViewTiles, localViewProfiles, monitorViewSchema, type MonitorView, type BorrowedViewTerminal } from '../shared/monitor-views';
import { mergeMonitorDisplay } from '../shared/monitor-view-layout';
import { installWindowPermissions } from './window-permissions';
import { assertMonitorAiRequest, monitorOwnsAi } from '../shared/monitor-ai-access';

type OpenView = { window: BrowserWindow; url: string; view: MonitorView; displayId: string; cleanup: Map<string, () => Promise<unknown>>; targets: Set<string>; desktopIds: Set<string>; pending: number; early: Map<string, string>; borrowed: Record<string, BorrowedViewTerminal>; profiles: Profile[] };
export class MonitorWindows {
  private windows = new Map<number, OpenView>();
  private aiThreads = new Map<number, Set<string>>();
  private allowedAi(view: OpenView, sender: number, id: string) {
    return monitorOwnsAi(view.view.tiles, this.aiThreads.get(sender), id);
  }
  result(sender: number, channel: string, result: any) {
    const view = this.windows.get(sender);
    if (view && channel === 'ai:snapshot') return { ...result, threads: result.threads.filter((t: {id: string}) => this.allowedAi(view, sender, t.id)) };
    return result;
  }
  private temporary = new Map<string, { view: MonitorView; borrowed: Record<string, BorrowedViewTerminal>; profiles: Profile[] }>();
  constructor(private store: Store, private entry: string, private preload: string,
    private tail: (id: string, sequence: number) => { data: string; sequence: number }[] = () => []) {
    ipcMain.handle('views:init', event => {
      const view = this.windows.get(event.sender.id);
      if (!view || !this.accepts(event)) throw new Error('Untrusted view');
      const borrowed = Object.fromEntries(Object.entries(view.borrowed).map(([id, value]) => {
        const tail = this.tail(value.sessionId, value.snapshot.sequence);
        return [id, { ...value, snapshot: { ...value.snapshot, data: value.snapshot.data + tail.map(c => c.data).join(''), sequence: tail.at(-1)?.sequence ?? value.snapshot.sequence } }];
      }));
      return { view: view.view, displayId: view.displayId, borrowed, profiles: view.profiles };
    });
  }
  accepts(event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent) {
    const value = this.windows.get(event.sender.id);
    return !!value && event.senderFrame === event.sender.mainFrame && event.senderFrame.url === value.url;
  }
  authorize(event: Electron.IpcMainInvokeEvent, channel: string, args: any[]) {
    const view = this.windows.get(event.sender.id);
    if (!view) return;
    const allowed = ['config', 'client:connect', 'local-terminal:open', 'connect', 'connect:cancel', 'disconnect', 'input', 'resize', 'acknowledge',
      'clipboard:write', 'key:pick', 'agent:machine-open', 'agent:call',
      'desktop:view-start', 'desktop:view-stop', 'desktop:view-input', 'desktop:view-release',
      'desktop:view-ack', 'desktop:view-quality', 'views:save', 'views:list',
      'ai:snapshot', 'ai:create', 'ai:send', 'ai:stop', 'ai:approve', 'ai:mode', 'ai:text'];
    if (!allowed.includes(channel)) throw new Error('此操作不属于监控视图');
    assertMonitorAiRequest(channel, args, view.view.tiles, this.aiThreads.get(event.sender.id), view.cleanup);
    if (channel === 'ai:create' && view.desktopIds.has(args[3])) throw new Error('请从终端输出发起 AI 分析');
    if (channel === 'local-terminal:open' && !view.view.tiles.some(t=>t.kind==='local'&&(t.shell??'powershell')===args[0])) throw Error('终端不属于此视图');
    if (channel === 'client:connect' && !view.view.tiles.some(t=>t.kind==='client-terminal'&&t.profileId===args[0]&&(t.shell??'powershell')===args[1])) throw Error('终端不属于此视图');
    if (['connect','client:connect','agent:machine-open'].includes(channel)) {
      if (!view.view.tiles.some(t => t.profileId === args[0])) throw new Error('机器不属于此视图');
    }
    if (channel === 'agent:call' && args[1]?.method !== 'desktop.status')
      throw new Error('监控视图只查询桌面状态');
    if ((channel === 'agent:call' && !view.targets.has(args[0])) ||
      (channel === 'desktop:view-start' && !view.targets.has(args[0]?.target)))
      throw new Error('目标不属于此视图');
    if (['input', 'resize', 'acknowledge', 'disconnect'].includes(channel) && !view.cleanup.has(args[0]))
      throw new Error('终端不属于此视图');
    if (channel.startsWith('desktop:view-') && channel !== 'desktop:view-start' && !view.desktopIds.has(args[0]))
      throw new Error('桌面不属于此视图');
    if (['connect','client:connect','local-terminal:open'].includes(channel)) view.pending++;
    if (channel === 'desktop:view-start') view.desktopIds.add(z.string().uuid().parse(args[0]?.id));
    if (channel === 'views:save') {
      const input = monitorViewSchema.parse(args[0]);
      if (input.id !== view.view.id) throw new Error('视图不匹配');
      const saved = this.store.monitorViews().find(v => v.id === input.id) ?? this.temporary.get(input.id)?.view;
      if (!saved) throw new Error('视图已删除');
      if (saved.tiles.some(t => t.kind!=='local' && t.kind!=='ai' && !this.store.snapshot().profiles.some(p => p.id === t.profileId)))
        throw new Error('请先在服务器列表保存临时连接，再保存此视图');
      const own = new Set(view.view.tiles.map(t => t.id));
      args[0] = mergeMonitorDisplay(saved, input, own, view.displayId);
    }
  }
  skip(event: Electron.IpcMainInvokeEvent, channel: string, args: any[]) {
    const owner = this.windows.get(event.sender.id);
    const borrowed = owner && Object.values(owner.borrowed).some(v => v.sessionId === args[0]);
    if (borrowed && channel === 'disconnect') throw new Error('这是主工作台会话，请在原连接中断开');
    return borrowed && (channel === 'acknowledge' || (channel === 'resize' && !owner.window.isFocused()));
  }
  async current(sources: { profile: Profile; shell?: 'cmd'|'powershell'|'sh'; terminal?: BorrowedViewTerminal }[], mode: NonNullable<MonitorView['mode']>) {
    if (!sources.length) throw new Error('没有打开的 SSH 或 CAgent 连接');
    const displayId = String(screen.getPrimaryDisplay().id), id = randomUUID();
    const borrowed: Record<string, BorrowedViewTerminal> = {};
    const tiles = sources.map(source => {
      const tileId = randomUUID();
      if (source.terminal) borrowed[tileId] = source.terminal;
      return { id: tileId, profileId: source.profile.id, label: source.profile.name,
        kind: source.terminal ? localViewProfiles.some(p=>p.id===source.profile.id)?'local' as const:source.profile.protocol==='client'?'client-terminal' as const:'ssh' as const : 'desktop' as const, shell:source.shell??'powershell', displayId,
        column: 0, row: 0, width: 12, height: 12, directory: '', command: '', screen: '' };
    });
    const view = { id, name: '当前连接', mode, tiles: arrangeViewTiles(tiles, mode === 'focus' ? 'focus' : 'grid') };
    this.temporary.set(id, { view, borrowed, profiles: sources.map(s => s.profile) });
    try { await this.open(id); } catch (error) { this.temporary.delete(id); throw error; }
  }
  track(sender: number, channel: string, args: any[], result: any, cleanup: (name: string, id: string) => Promise<unknown>) {
    const owner = this.windows.get(sender);
    if (owner && channel === 'views:save') {
      const own = new Set(owner.view.tiles.map(t => t.id));
      owner.view = { ...owner.view, mode: args[0].mode, tiles: args[0].tiles.filter((t: {id: string}) => own.has(t.id)) };
    }
    if (owner && channel === 'ai:create' && result?.id) {
      const ids = this.aiThreads.get(sender) ?? new Set<string>(); ids.add(result.id); this.aiThreads.set(sender, ids);
    }
    if (['connect','client:connect','local-terminal:open'].includes(channel) && owner) {
      owner.pending = Math.max(0, owner.pending - 1);
      const data = owner.early.get(result?.sessionId);
      if (data && !owner.window.isDestroyed()) owner.window.webContents.send('session:event', { type: 'data', sessionId: result.sessionId, data });
      owner.early.delete(result?.sessionId);
      if (!owner.pending) owner.early.clear();
    }
    if (channel === 'desktop:view-stop') owner?.desktopIds.delete(args[0]);
    if (channel === 'agent:machine-open' && result?.id) owner?.targets.add(result.id);
    if (channel === 'disconnect' || channel === 'desktop:view-stop') owner?.cleanup.delete(args[0]);
    const id = ['connect','client:connect','local-terminal:open'].includes(channel) ? result?.sessionId : channel === 'desktop:view-start' ? args[0]?.id : undefined;
    if (!id) return;
    const stop = () => cleanup(['connect','client:connect','local-terminal:open'].includes(channel) ? 'disconnect' : 'desktop:view-stop', id);
    if (!owner) { void stop().catch(() => {}); return; }
    owner.cleanup.set(id, stop);
  }
  failed(sender: number, channel: string) {
    const owner = this.windows.get(sender);
    if (['connect','client:connect','local-terminal:open'].includes(channel) && owner) { owner.pending = Math.max(0, owner.pending - 1); if (!owner.pending) owner.early.clear(); }
  }
  publish(channel: string, event: any) {
    for (const owner of this.windows.values()) {
      if (owner.window.isDestroyed()) continue;
      if (channel === 'ai:thread' && !this.allowedAi(owner, owner.window.webContents.id, event?.id)) continue;
      if (channel === 'desktop:view-event' && !owner.desktopIds.has(event.id)) continue;
      if (channel === 'session:event' && !owner.cleanup.has(event.sessionId)) {
        if (owner.pending && event.type === 'data') {
          owner.early.set(event.sessionId, ((owner.early.get(event.sessionId) ?? '') + event.data).slice(-262144));
          while (owner.early.size > 16) owner.early.delete(owner.early.keys().next().value!);
        }
        continue;
      }
      owner.window.webContents.send(channel, event);
    }
  }
  ownsSession(id: string) {
    return [...this.windows.values()].some(w => w.cleanup.has(id));
  }
  displays() {
    return screen.getAllDisplays().map((d, i) => ({ id: String(d.id), label: d.label || `显示器 ${i + 1}`,
      width: d.workArea.width, height: d.workArea.height, primary: d.id === screen.getPrimaryDisplay().id }));
  }
  async open(raw: unknown) {
    const id = z.string().uuid().parse(raw);
    const existing = [...this.windows.values()].filter(w => w.view.id === id);
    for (const w of existing) { if (w.window.isMinimized()) w.window.restore(); w.window.show(); }
    const ephemeral = this.temporary.get(id);
    const saved = this.store.monitorViews().find(v => v.id === id) ?? ephemeral?.view;
    if (!saved?.tiles.length) throw new Error('请先为视图添加内容');
    const displays = screen.getAllDisplays(), primary = screen.getPrimaryDisplay();
    const groups = new Map<string, typeof saved.tiles>();
    for (const tile of saved.tiles) {
      const target = displays.find(d => String(d.id) === tile.displayId) ?? primary;
      const key = String(target.id);
      groups.set(key, [...groups.get(key) ?? [], { ...tile, displayId: key }]);
    }
    if ([...groups.values()].some(v => v.length > 12)) throw new Error('当前显示器不足，请调整分配（每屏最多 12 个区域）');
    try {
      for (const [displayId, tiles] of groups) {
        if (existing.some(w => w.displayId === displayId)) continue;
        const display = displays.find(d => String(d.id) === displayId)!;
        const relocated = tiles.some(t => saved.tiles.find(s => s.id === t.id)?.displayId !== displayId);
        const view = { ...saved, tiles: relocated ? arrangeViewTiles(tiles, 'grid') : tiles };
        const url = this.entry + '?monitorView=' + id + '&display=' + encodeURIComponent(displayId);
        const window = new BrowserWindow({ ...display.workArea, minWidth: 400, minHeight: 300,
          title: `${saved.name} · CShell`, show: false, autoHideMenuBar: true,
          backgroundColor: '#f5f7fa',
          webPreferences: { preload: this.preload, partition: 'monitor-views', sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
        installWindowPermissions(window.webContents.session, window.webContents, url);
        const sender = window.webContents.id;
        const borrowed = Object.fromEntries(Object.entries(ephemeral?.borrowed ?? {}).filter(([id]) => tiles.some(t => t.id === id)));
        const owner: OpenView = { window, url, view, displayId, cleanup: new Map(), targets: new Set(), desktopIds: new Set(), pending: 0, early: new Map(), borrowed, profiles: ephemeral?.profiles ?? [] };
        for (const terminal of Object.values(borrowed)) owner.cleanup.set(terminal.sessionId, async () => {});
        this.windows.set(sender, owner);
        window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        window.webContents.on('will-navigate', e => e.preventDefault());
        window.webContents.on('will-attach-webview', e => e.preventDefault());
        const removed = () => {
          if (!window.isDestroyed() && !screen.getAllDisplays().some(d => d.id === display.id))
            window.setBounds(screen.getPrimaryDisplay().workArea);
        };
        screen.on('display-removed', removed);
        window.once('closed', () => {
          screen.removeListener('display-removed', removed);
          this.windows.delete(sender);
          this.aiThreads.delete(sender);
          if (![...this.windows.values()].some(w => w.view.id === id)) this.temporary.delete(id);
          for (const stop of owner.cleanup.values()) void stop().catch(() => {});
        });
        window.once('ready-to-show', () => window.show());
        await window.loadURL(url);
      }
    } catch (error) { this.close(id); throw error; }
  }
  close(id: string) {
    for (const value of this.windows.values()) if (value.view.id === id) value.window.close();
  }
  dispose() { for (const value of this.windows.values()) value.window.destroy(); }
}
