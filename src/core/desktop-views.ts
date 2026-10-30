import { z } from 'zod';
import {SharedDesktop} from './desktop-shared';
import {
  desktopViewStartSchema,
  desktopViewInputSchema,
  type DesktopViewEvent,
} from '../shared/desktop-view';
import { desktopQualitySchema, type DesktopTicket } from '../shared/agent-desktop';
import { connectDesktop, type DesktopClient } from './desktop-client';
import type { MediaFrame } from '../agent/desktop-media';

type Host = {
  ticket: DesktopTicket;
  host: string;
  identity: string;
  local: boolean;
  close: () => Promise<unknown>;
  connect?: () => Promise<DesktopClient>;
};
type Request = z.infer<typeof desktopViewStartSchema>;
type View = {
  target: string;
  request: Request;
  generation: number;
  attempts: number;
  connectedAt: number;
  host?: Host;
  client?: DesktopClient;
  closed: boolean;
  needsKey?: boolean;
  pending?: { sequence: string; at: number };
  timer?: ReturnType<typeof setTimeout>;
  retry?: ReturnType<typeof setTimeout>;
};
const NETWORK = new Set([
  'CONTROL_CLOSED',
  'CONTROL_FAILURE',
  'UDP_FAILURE',
  'IDLE_TIMEOUT',
  'HANDSHAKE_OR_UDP_PATH_TIMEOUT',
  'MEDIA_SEND_FAILURE',
  'DESKTOP_BOOTSTRAP_TIMEOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EPIPE',
  'EAI_AGAIN',
  'Client disconnected',
  'Client connection timeout',
  'Client closed during handshake',
]);
export function desktopNetworkFailure(error: unknown) {
  const code =
    error instanceof Error
      ? ((error as NodeJS.ErrnoException).code ?? error.message)
      : String(error);
  return NETWORK.has(code);
}
/** Every reconnect reopens authorization and gets a fresh single-use ticket. */
export class DesktopViews {
  private views = new Map<string, View>();
  private shared = new Map<string,Promise<{host:Host;hub:SharedDesktop}>>();
  private disposed = false;
  private guardTimer: ReturnType<typeof setInterval>;
  constructor(
    private readonly options: {
      authorize: (target: string) => void;
      open: (input: Request) => Promise<Host>;
      publish: (event: DesktopViewEvent) => void;
      connect?: typeof connectDesktop;
      retryDelays?: readonly number[];
      onStopped?: (id: string) => void;
    },
  ) {
    this.guardTimer = setInterval(() => {
      for (const [id, view] of this.views)
        try {
          options.authorize(view.target);
        } catch {
          this.finish(id, view, '连接或授权已撤销');
        }
    }, 500);
    this.guardTimer.unref();
  }
  private live(id: string, v: View) {
    return !v.closed && this.views.get(id) === v;
  }
  private finish(id: string, v: View, reason: string) {
    if (!this.live(id, v)) return;
    this.options.publish({ id, generation: v.generation, type: 'closed', reason });
    void this.stop(id);
  }
  async start(raw: unknown) {
    const request = desktopViewStartSchema.parse(raw);
    this.options.authorize(request.target);
    if (this.disposed || this.views.has(request.id) || this.views.size >= 4)
      throw new Error('桌面连接数量已达上限或连接标识重复');
    const view: View = {
      target: request.target,
      request,
      generation: 1,
      attempts: 0,
      connectedAt: 0,
      closed: false,
    };
    this.views.set(request.id, view);
    try {
      await this.attach(request.id, view);
      return { id: request.id, control: view.host!.ticket.control && !!request.control, generation: view.generation };
    } catch (error) {
      await this.stop(request.id);
      throw error;
    }
  }
  private async attach(id: string, view: View) {
    this.options.authorize(view.target);
    const generation = view.generation;
    let pending=this.shared.get(view.target);
    if(!pending){
      pending=(async()=>{
        const host=await this.options.open(view.request);
        try{
          if(![...this.views.values()].some(v=>!v.closed&&v.target===view.target))throw new Error('桌面连接已取消');
          const upstream=await (host.connect?host.connect():(this.options.connect??connectDesktop)(host.ticket,{host:host.host,expectedHostIdentity:host.identity,local:host.local}));
          const hub=new SharedDesktop(upstream,host.close,()=>{if(this.shared.get(view.target)===pending)this.shared.delete(view.target);});
          return {host,hub};
        }catch(error){await host.close().catch(()=>{});throw error;}
      })();
      this.shared.set(view.target,pending);
      void pending.catch(()=>{if(this.shared.get(view.target)===pending)this.shared.delete(view.target);});
    }
    const shared=await pending;
    const host={...shared.host,close:async()=>{}};
    const client=shared.hub.acquire();
    view.host=host;
    try{this.options.authorize(view.target);}catch(error){await client.close();throw error;}
    if(view.request.control&&!host.ticket.control){await client.close();throw new Error('当前桌面连接为仅观看；请先断开原桌面，再启用键鼠控制连接。');}
    if (!this.live(id, view) || generation !== view.generation) {
      await client.close();
      throw new Error('桌面连接已取消');
    }
    view.client = client;
    view.connectedAt = Date.now();
    view.needsKey = true;
    const current = () =>
      this.live(id, view) && view.generation === generation && view.client === client;
    const publish = (event: DesktopViewEvent) => {
      if (current()) this.options.publish({ ...event, generation });
    };
    client.on('video', (info) => publish({ id, type: 'config', info }));
    client.on('notice', (message) => {const text=String(message);const resumed=text==='INPUT_RESUMED';const recoverable=resumed||text.startsWith('INPUT_SUSPENDED:')||/^桌面采集(?:未输出首帧|暂未更新)，正在切换兼容采集…$/.test(text);publish({id,type:'error',message:text,...(recoverable?{recoverable:true}:{}),...(resumed?{resumed:true}:{})});});
    client.on('closed', (reason) => {
      if (current()) void this.disconnected(id, view, reason);
    });
    publish({
      id,
      type: 'state',
      state: 'connected',
      attempt: 0,
      delayMs: 0,
      control: host.ticket.control && !!view.request.control,
    });
    if (client.videoInfo) publish({ id, type: 'config', info: client.videoInfo });
    client.requestKeyframe();
    client.on('frame', (frame: MediaFrame) => {
      if (!current()) return;
      try {
        this.options.authorize(view.target);
      } catch {
        this.finish(id, view, '连接或授权已撤销');
        return;
      }
      if (view.pending) {
        client.ack(frame.id);
        if (!view.needsKey) {
          view.needsKey = true;
          client.requestKeyframe();
        }
        return;
      }
      if (view.needsKey && !frame.key) {
        client.ack(frame.id);
        return;
      }
      if (frame.key) view.needsKey = false;
      view.pending = { sequence: String(frame.id), at: Date.now() };
      view.timer = setTimeout(() => {
        if (!current()) return;
        view.pending = undefined;
        view.needsKey = true;
        client.ack(frame.id);
        client.requestKeyframe();
      }, 1500);
      view.timer.unref();
      publish({
        id,
        type: 'frame',
        sequence: String(frame.id),
        timestamp: Number(frame.timestamp),
        key: frame.key,
        data: new Uint8Array(frame.data),
      });
    });
  }
  private async clean(view: View) {
    clearTimeout(view.timer);
    view.pending = undefined;
    const client = view.client,
      host = view.host;
    view.client = undefined;
    view.host = undefined;
    try {
      await client?.releaseInput();
    } catch {}
    try {
      await client?.close();
    } catch {}
    await host?.close().catch(() => {});
  }
  private async disconnected(id: string, view: View, reason: unknown) {
    if (!desktopNetworkFailure(reason)) {
      this.finish(id, view, String(reason));
      return;
    }
    if (Date.now() - view.connectedAt > 30000) view.attempts = 0;
    view.generation++;
    await this.clean(view);
    this.schedule(id, view, reason);
  }
  private schedule(id: string, view: View, reason: unknown) {
    if (!this.live(id, view)) return;
    try {
      this.options.authorize(view.target);
    } catch {
      this.finish(id, view, '连接或授权已撤销');
      return;
    }
    const delays = this.options.retryDelays ?? [500, 1000, 2000, 4000, 8000];
    if (view.attempts >= delays.length) {
      this.finish(id, view, '网络连接未恢复，自动重连已停止');
      return;
    }
    const delayMs = delays[view.attempts++];
    this.options.publish({
      id,
      generation: view.generation,
      type: 'state',
      state: 'reconnecting',
      attempt: view.attempts,
      delayMs,
      control: false,
      reason: String(reason),
    });
    view.retry = setTimeout(() => {
      view.retry = undefined;
      void this.attach(id, view).catch(async (error) => {
        await this.clean(view);
        if (!this.live(id, view)) return;
        if (desktopNetworkFailure(error)) {
          view.generation++;
          this.schedule(id, view, error);
        } else this.finish(id, view, error instanceof Error ? error.message : String(error));
      });
    }, delayMs);
    view.retry.unref();
  }
  private get(raw: unknown, generation: unknown = 1) {
    const id = z.string().uuid().parse(raw),
      view = this.views.get(id);
    if (!view || view.closed || !view.client) throw new Error('桌面连接已关闭或正在重连');
    if (generation !== view.generation) throw new Error('过期的桌面连接代次');
    try {
      this.options.authorize(view.target);
    } catch (error) {
      void this.stop(id);
      throw error;
    }
    return view;
  }
  input(id: unknown, raw: unknown, generation?: unknown) {
    const view=this.get(id,generation);
    if(!view.request.control)throw new Error('此视图为仅观看');
    return view.client!.input(desktopViewInputSchema.parse(raw));
  }
  inputConfirmed(id:unknown,raw:unknown,generation?:unknown){const view=this.get(id,generation);if(!view.request.control)throw Error('此视图为仅观看');return view.client!.inputConfirmed(desktopViewInputSchema.parse(raw));}
  release(id: unknown, generation?: unknown) {
    return this.get(id, generation).client!.releaseInput();
  }
  quality(id: unknown, raw: unknown, generation?: unknown) {
    const view = this.get(id, generation),
      quality = desktopQualitySchema.parse(raw);
    const result = view.client!.quality(quality);
    view.request = { ...view.request, quality };
    return result;
  }
  ack(id: unknown, sequence: unknown, decoded: unknown, decodeMs: unknown, generation?: unknown) {
    const view = this.get(id, generation),
      seq = z
        .string()
        .regex(/^\d{1,10}$/)
        .parse(sequence);
    z.number().finite().min(0).max(60000).parse(decodeMs);
    const ok = z.boolean().parse(decoded);
    if (view.pending?.sequence !== seq) return;
    view.client!.reportDecode(
      Number(decodeMs),
      Math.max(0, Date.now() - view.pending.at - Number(decodeMs)),
    );
    clearTimeout(view.timer);
    view.pending = undefined;
    view.client!.ack(seq);
    if (!ok) view.needsKey = true;
    if (view.needsKey) view.client!.requestKeyframe();
  }
  async stop(raw: unknown, reason?: string) {
    const id = z.string().uuid().parse(raw),
      view = this.views.get(id);
    if (!view) return;
    if (reason) this.options.publish({ id, generation: view.generation, type: 'closed', reason });
    view.closed = true;
    this.views.delete(id);
    this.options.onStopped?.(id);
    clearTimeout(view.retry);
    await this.clean(view);
  }
  async dispose() {
    this.disposed = true;
    clearInterval(this.guardTimer);
    await Promise.allSettled([...this.views.keys()].map((id) => this.stop(id)));
  }
}
