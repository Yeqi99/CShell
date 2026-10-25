import { z } from 'zod';
import { connect } from 'node:net';
import type { Duplex } from 'node:stream';
import { ClientProvider } from '../core/client/provider';
import type { ClientVault } from '../core/client/identity';
import { agentRelayConnectionSchema } from '../shared/agent-relay';
import { agentBrowserStream } from '../core/agent-browser-stream';
import { createSshBrowserProxy } from '../core/ssh-browser-proxy';
import type { CagentCloud } from './cloud';
import { executeHttp } from '../core/http-transport';
import type { HttpWireRequest } from '../shared/http';

const config = z.object({ target: z.string().uuid().nullable() }).strict();
/** Application-only proxy. No system route, firewall or global environment mutations. */
export class AccountNetwork {
  private target: string | null = null;
  private ready = false;
  private error = '';
  private proxy?: Awaited<ReturnType<typeof createSshBrowserProxy>>;
  private transport?: Awaited<ReturnType<ClientProvider['browserTransport']>>;
  private client: ClientProvider;
  private timer?: NodeJS.Timeout;
  private pending = Promise.resolve();
  private closed = false;
  private streams=new Set<Duplex>();
  private opening=0;
  private refreshing=0;
  private updateGuard=()=>false;
  setUpdateGuard(guard:()=>boolean){this.updateGuard=guard;}
  get activity(){return this.streams.size+this.opening+this.refreshing;}
  private admit(){if(this.closed||this.updateGuard())throw Error('CAgent 正在完成更新，请稍后重试');}
  private track(stream:Duplex){this.streams.add(stream);stream.once('close',()=>this.streams.delete(stream));return stream;}
  constructor(
    private cloud: CagentCloud,
    private vault: ClientVault,
  ) {
    this.client = new ClientProvider(vault, () => {});
    this.client.cloudLease = async (id) =>
      agentRelayConnectionSchema.parse(
        (await cloud.sync.accountRequest('/v1/devices/lease', { deviceId: id })).relay,
      );
  }
  async load() {
    this.target = (await this.vault.read('network-route', config))?.target ?? null;
    await this.client.load();
    if(this.target)await this.ensureProxy();
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), 30000);
    this.timer.unref();
  }
  private async ensureProxy(){if(this.proxy)return;
    this.proxy = await createSshBrowserProxy((host, port, done) => {
      void this.forward(host, port).then(
        (stream) => done(null, stream),
        (e) => done(e),
      );
    });
  }
  private refresh() {
    if(this.closed||this.updateGuard())return this.pending;
    this.pending = this.pending.then(async () => {
      if (this.closed||this.updateGuard()) return;
      this.refreshing++;
      try {
        const result = await this.cloud.sync.accountRequest('/v1/network');
        const next =
          result.routes.find((r: { source: string }) => r.source === this.cloud.deviceId())
            ?.target ?? null;
        if (next !== this.target) {
          this.transport?.close();
          this.transport = undefined;
          this.target = next;
          await this.vault.write('network-route', { target: next });
          if(!next){this.proxy?.close();this.proxy=undefined;}
        }
        await this.client.cloudImport(this.cloud.devices());
        if (this.target) {
          await this.ensureProxy();
          if (!this.transport) this.transport = await this.client.browserTransport(this.target);
          this.transport.validate();
        }
        this.ready = true;
        this.error = '';
      } catch (e) {
        this.ready = false;
        this.transport?.close();
        this.transport = undefined;
        this.error = e instanceof Error ? e.message : '出口连接不可用';
      }finally{this.refreshing--;}
    });
    return this.pending;
  }
  async status() {
    let devices: unknown[] = [];
    try {
      devices = (await this.cloud.sync.accountRequest('/v1/devices')).devices;
    } catch {}
    return {
      source: this.cloud.deviceId(),
      mode: 'applications',
      target: this.target,
      ready: this.ready,
      error: this.error,
      proxy: this.target && this.proxy ? 'socks5h://127.0.0.1:' + this.proxy.port : null,
      devices,
    };
  }
  async configure(input: unknown) {
    const next = config.parse(input);
    await this.cloud.sync.accountRequest('/v1/network', {
      source: this.cloud.deviceId(),
      target: next.target,
    });
    await this.refresh();
    return this.status();
  }
  environment(): Record<string, string> {
    if (!this.target) return {};
    if (!this.proxy) throw Error('网络代理尚未启动');
    return {
      ALL_PROXY: 'socks5h://127.0.0.1:' + this.proxy.port,
      all_proxy: 'socks5h://127.0.0.1:' + this.proxy.port,
      NO_PROXY: '',
      no_proxy: '',
    };
  }
  private async forward(host: string, port: number): Promise<Duplex> {
    this.admit();this.opening++;
    try{return await this.forwardNow(host,port);}finally{this.opening--;}
  }
  private async forwardNow(host: string, port: number): Promise<Duplex> {
    if (!this.target || !this.ready) throw Error('所选网络出口不可用，已阻止回退本机网络');
    if (!this.transport) this.transport = await this.client.browserTransport(this.target);
    try {
      this.transport.validate();
      return this.track(await agentBrowserStream(this.transport.call, host, port));
    } catch (e) {
      this.transport.close();
      this.transport = undefined;
      throw e;
    }
  }
  async open(host: string, port: number): Promise<Duplex> {
    this.admit();
    if (this.target) return this.forward(host, port);
    return new Promise((resolve, reject) => {
      const socket = connect({ host, port });this.track(socket);
      const timer = setTimeout(() => socket.destroy(Error('连接超时')), 15000);
      socket.once('error', reject);
      socket.once('connect', () => {
        clearTimeout(timer);
        resolve(socket);
      });
      socket.once('close', () => clearTimeout(timer));
    });
  }
  async http(request: HttpWireRequest, signal: AbortSignal) {
    this.admit();this.opening++;
    try{return await this.httpNow(request,signal);}finally{this.opening--;}
  }
  private async httpNow(request: HttpWireRequest, signal: AbortSignal) {
    if (!this.target) return executeHttp(request, signal, undefined, 65536);
    if (!this.ready) throw Error('网络出口不可用，已阻止回退本机网络');
    return this.client.accountHttp(this.target, request, signal);
  }
  async close() {
    this.closed = true;
    for(const stream of this.streams)stream.destroy();this.streams.clear();
    if (this.timer) clearInterval(this.timer);
    this.transport?.close();
    this.proxy?.close();
    await this.pending;
    this.transport?.close();
    this.proxy?.close();
  }
}
