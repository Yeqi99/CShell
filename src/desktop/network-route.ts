import type { Session } from 'electron';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { networkRouteSchema, type NetworkRoute, type NetworkRouteStatus } from '../shared/network-route';
import type { Store } from '../core/store';

/** Dedicated application requests; never changes the browser or OS proxy. */
export class ApplicationNetworkRoute {
  private route: NetworkRoute = { mode: 'system' };
  private current?: Session;
  private currentProxy?: string;
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;
  machine?: {
    list(): Promise<NetworkRouteStatus['machines']>;
    // Resolver must enforce entitlement, identity and forwarding permission.
    proxy(id: string): Promise<string>;
    close?(): Promise<void>;
  };
  constructor(private directory: string, private store: Store) {}
  async load() {
    try {
      this.route = networkRouteSchema.parse(JSON.parse(await this.store.decryptPrivate(
        await readFile(join(this.directory, 'network-route.enc'), 'utf8'))));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('网络出口配置无法读取，已保留原文件');
    }
  }
  async status(): Promise<NetworkRouteStatus> {
    return { route: structuredClone(this.route), machines: await this.machine?.list() ?? [] };
  }
  async save(input: unknown) {
    const next = networkRouteSchema.parse(input);
    const task = this.queue.catch(() => {}).then(async () => {
      if (this.closed) throw new Error('网络服务已关闭');
      if (next.mode === 'machine') {
        if (!this.machine) throw new Error('当前版本不支持机器网络出口');
        await this.machine.proxy(next.id);
      }
      const file = join(this.directory, 'network-route.enc');
      await writeFile(file + '.tmp', await this.store.encryptPrivate(JSON.stringify(next)), { mode: 0o600 });
      await rename(file + '.tmp', file);
      this.route = next;
      const previous = this.current;
      this.current = undefined;
      // Explicit application of a new route invalidates pooled old connections.
      await previous?.closeAllConnections();
      return this.status();
    });
    this.queue = task;
    return task;
  }
  readonly fetch: typeof fetch = async (input, init) => {
    const prepare = this.queue.catch(() => {}).then(async () => {
    if (this.closed) throw new Error('网络服务已关闭');
    const route = this.route;
    let proxy: string | undefined;
    if (route.mode === 'proxy') proxy = route.url;
    if (route.mode === 'machine') {
      if (!this.machine) throw new Error('所选机器出口不可用，未回退本机网络');
      proxy = await this.machine.proxy(route.id);
      // Never accept bypass rules, multiple proxies or a DIRECT fallback.
      const parsed = networkRouteSchema.parse({ mode: 'proxy', url: proxy });
      if (parsed.mode !== 'proxy') throw new Error('机器出口地址无效');
      proxy = parsed.url;
    }
    if (route !== this.route) throw new Error('网络出口已更改，请重新发送请求');
    if (this.current && this.currentProxy !== proxy) {
      await this.current.closeAllConnections();
      this.current = undefined;
    }
    if (!this.current) {
      const { session } = await import('electron');
      const connection = session.fromPartition('cshell-api-route-' + randomUUID(), { cache: false });
      connection.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
      connection.setPermissionCheckHandler(() => false);
      await connection.setProxy(proxy ? { mode: 'fixed_servers', proxyRules: proxy, proxyBypassRules: '<-loopback>' } : { mode: route.mode === 'system' ? 'system' : 'direct' });
      if (route !== this.route || this.closed) {
        await connection.closeAllConnections();
        throw new Error('网络出口已更改，请重新发送请求');
      }
      this.current = connection;
      this.currentProxy = proxy;
    }
    return this.current;
    });
    this.queue = prepare.then(() => {}, () => {});
    const connection = await prepare;
    // Model keys are explicit headers; browser cookies/cache never participate.
    return connection.fetch(input as string | Request, { ...init, credentials: 'omit', cache: 'no-store' });
  };
  async close() {
    this.closed = true;
    await this.queue.catch(() => {});
    await this.current?.closeAllConnections();
    await this.machine?.close?.();
  }
}
