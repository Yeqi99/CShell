import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { z } from 'zod';
import {
  hostingConfigSchema,
  hostingRouteSchema,
  type HostingConfig,
  type HostingLog,
  type HostingStartOptions,
  type HostingStatus,
} from '../shared/agent-hosting';
import { hostingWorkerSource } from './hosting-worker';

type Active = {
  server: Server;
  port: number;
  abort: AbortController;
  children: Set<ChildProcess>;
  requests: number;
};
const MAX_BODY = 65536;
export class HostingService {
  private configs = new Map<string, HostingConfig>();
  private active = new Map<string, Active>();
  private history = new Map<string, HostingLog[]>();
  private errors = new Map<string, string>();
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;
  constructor(private readonly directory: string) {}
  private exclusive<T>(action: () => Promise<T>): Promise<T> {
    const result = this.queue.then(action);
    this.queue = result.catch(() => {});
    return result;
  }
  async load(): Promise<void> {
    return this.exclusive(async () => {
      if (this.active.size) throw new Error('服务运行中，不能重新加载');
      try {
        if ((await stat(join(this.directory, 'hosting.json'))).size > 1572864)
          throw new Error('托管配置总量超过 1.5 MiB');
        const configs = z
          .array(hostingConfigSchema)
          .max(32)
          .parse(JSON.parse(await readFile(join(this.directory, 'hosting.json'), 'utf8')));
        if (new Set(configs.map((c) => c.id)).size !== configs.length)
          throw new Error('托管配置 ID 重复');
        this.configs = new Map(configs.map((c) => [c.id, c]));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    });
  }
  list(): HostingStatus[] {
    return [...this.configs.keys()].map((id) => this.status(id));
  }
  private status(id: string): HostingStatus {
    const config = this.configs.get(id);
    if (!config) throw new Error('HTTP 服务不存在');
    return {
      config: structuredClone(config),
      running: this.active.has(id),
      actualPort: this.active.get(id)?.port,
      error: this.errors.get(id),
      environment:
        process.platform === 'win32'
          ? 'windows'
          : process.platform === 'darwin'
            ? 'darwin'
            : 'linux',
    };
  }
  private async persist(configs: Map<string, HostingConfig>) {
    const serialized = JSON.stringify([...configs.values()]);
    if (Buffer.byteLength(serialized) > 1572864) throw new Error('托管配置总量超过 1.5 MiB');
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const path = join(this.directory, 'hosting.json');
    await writeFile(`${path}.tmp`, serialized, { mode: 0o600 });
    await rename(`${path}.tmp`, path);
  }
  save(input: unknown): Promise<HostingStatus> {
    return this.exclusive(async () => {
      if (this.closed) throw new Error('托管模块已关闭');
      const config = hostingConfigSchema.parse(input);
      if (this.active.has(config.id)) throw new Error('请先停止服务再修改配置');
      if (config.revision !== (this.configs.get(config.id)?.revision ?? 0))
        throw new Error('服务配置已改变，请刷新后重新保存');
      config.revision++;
      if (!this.configs.has(config.id) && this.configs.size >= 32)
        throw new Error('最多保存 32 个服务');
      const configs = new Map(this.configs).set(config.id, config);
      await this.persist(configs);
      this.configs = configs;
      this.errors.delete(config.id);
      return this.status(config.id);
    });
  }
  start(id: string, options: HostingStartOptions): Promise<HostingStatus> {
    return this.exclusive(async () => {
      if (this.closed) throw new Error('托管模块已关闭');
      const config = this.status(id).config;
      if (options?.expectedRevision !== config.revision)
        throw new Error('服务配置已改变，请重新检查并授权启动');
      if (this.active.has(id)) return this.status(id);
      if (config.routes.some((r) => r.mode === 'code') && options.allowCode !== true)
        throw new Error('代码将在独立进程中以 Agent 用户权限运行；需要明确代码执行授权');
      const active: Active = {
        server: createServer(),
        port: 0,
        abort: new AbortController(),
        children: new Set(),
        requests: 0,
      };
      active.server.maxConnections = 32;
      active.server.headersTimeout = 10000;
      active.server.requestTimeout = 15000;
      active.server.keepAliveTimeout = 1000;
      active.server.maxHeadersCount = 64;
      active.server.on('request', (req, res) => {
        void this.handle(config, active, req, res);
      });
      try {
        await new Promise<void>((resolve, reject) => {
          active.server.once('error', reject);
          active.server.listen(config.port, config.host, () => {
            active.server.removeListener('error', reject);
            resolve();
          });
        });
        const address = active.server.address();
        if (!address || typeof address === 'string') throw new Error('未取得监听端口');
        active.port = address.port;
        active.server.on('error', (error) => {
          this.errors.set(id, error.message);
          void this.stop(id);
        });
        this.active.set(id, active);
        this.errors.delete(id);
        return this.status(id);
      } catch (error) {
        active.server.close();
        this.errors.set(id, String((error as Error).message));
        throw error;
      }
    });
  }
  private record(id: string, log: HostingLog) {
    const logs = this.history.get(id) ?? [];
    logs.push(log);
    // At most 100 x 4 KiB callback previews per service; never retain credentials/headers.
    if (logs.length > 100) logs.splice(0, logs.length - 100);
    while (Buffer.byteLength(JSON.stringify(logs)) > 65536) logs.shift();
    this.history.set(id, logs);
  }
  logs(id: string): HostingLog[] {
    this.status(id);
    return structuredClone(this.history.get(id) ?? []);
  }
  private async handle(
    config: HostingConfig,
    active: Active,
    req: IncomingMessage,
    res: ServerResponse,
  ) {
    const started = Date.now();
    const log: HostingLog = {
      time: new Date().toISOString(),
      method: req.method ?? '',
      path: '',
      status: 500,
      durationMs: 0,
    };
    const abort = new AbortController();
    const onClose = () => {
      if (!res.writableFinished) abort.abort();
    };
    res.on('close', onClose);
    const timer = setTimeout(() => abort.abort(new Error('请求超时')), 10000);
    const signal = AbortSignal.any([abort.signal, active.abort.signal]);
    let counted = false;
    try {
      const path = new URL(req.url ?? '/', 'http://localhost').pathname;
      log.path = path.slice(0, 2048);
      if (active.requests >= 8) {
        log.status = 503;
        res.writeHead(503).end('服务繁忙');
        return;
      }
      counted = true;
      active.requests++;
      const route = config.routes.find((r) => r.method === req.method && r.path === path);
      if (!route) {
        log.status = 404;
        res.writeHead(404).end('Not found');
        req.resume();
        return;
      }
      const body = await this.readBody(req, signal);
      if (route.mode === 'callback') {
        log.body = body.subarray(0, 4096).toString('utf8');
        log.truncated = body.length > 4096;
      }
      let response = { status: route.status, headers: route.headers, body: route.body };
      if (route.mode === 'code') {
        const result = await this.runCode(
          active,
          route.code!,
          {
            method: req.method,
            path,
            query: Object.fromEntries(new URL(req.url!, 'http://localhost').searchParams),
            headers: req.headers,
            body: body.toString('utf8'),
          },
          signal,
        );
        const checked = hostingRouteSchema.parse({ ...route, ...result });
        response = { status: checked.status, headers: checked.headers, body: checked.body };
      }
      if (signal.aborted) throw new Error('请求已取消');
      if (Buffer.byteLength(response.body) > MAX_BODY) throw new Error('响应超过 64 KiB');
      log.status = response.status;
      res.writeHead(response.status, response.headers).end(response.body);
    } catch (error) {
      log.error = String((error as Error).message).slice(0, 1000);
      log.status = log.error === '请求体超过 64 KiB' ? 413 : signal.aborted ? 504 : 500;
      if (!res.destroyed && !res.headersSent)
        res.writeHead(log.status).end(log.status === 413 ? 'Payload too large' : 'Request failed');
    } finally {
      clearTimeout(timer);
      res.removeListener('close', onClose);
      if (counted) active.requests--;
      log.durationMs = Date.now() - started;
      this.record(config.id, log);
    }
  }
  private readBody(req: IncomingMessage, signal: AbortSignal): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks: Buffer[] = [];
      const cleanup = () => {
        req.removeListener('data', data);
        req.removeListener('end', end);
        req.removeListener('error', fail);
        req.removeListener('aborted', aborted);
        signal.removeEventListener('abort', aborted);
      };
      const fail = (error: Error) => {
        cleanup();
        reject(error);
      };
      const aborted = () => fail(new Error('请求已取消'));
      const data = (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BODY) {
          fail(new Error('请求体超过 64 KiB'));
          req.resume();
        } else chunks.push(chunk);
      };
      const end = () => {
        cleanup();
        resolve(Buffer.concat(chunks));
      };
      req.on('data', data).once('end', end).once('error', fail).once('aborted', aborted);
      signal.addEventListener('abort', aborted, { once: true });
      if (signal.aborted) aborted();
    });
  }
  private runCode(
    active: Active,
    code: string,
    request: unknown,
    signal: AbortSignal,
  ): Promise<Record<string, unknown>> {
    if (active.children.size >= 4) return Promise.reject(new Error('代码工作进程繁忙'));
    return new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        ['--max-old-space-size=64', '--input-type=module', '-e', hostingWorkerSource],
        {
          stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
          windowsHide: true,
          detached: process.platform !== 'win32',
          env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
          cwd: this.directory,
        },
      );
      active.children.add(child);
      let done = false;
      let outputBytes = 0;
      const finish = (error?: Error, result?: Record<string, unknown>) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        void this.kill(child).finally(() => {
          active.children.delete(child);
          if (error) reject(error);
          else resolve(result ?? {});
        });
      };
      const timer = setTimeout(() => finish(new Error('代码执行超过 5 秒')), 5000);
      const abort = () => finish(new Error('代码执行已取消'));
      signal.addEventListener('abort', abort, { once: true });
      const output = (data: Buffer) => {
        outputBytes += data.length;
        if (outputBytes > MAX_BODY) finish(new Error('代码输出超过 64 KiB'));
      };
      child.stdout?.on('data', output);
      child.stderr?.on('data', output);
      child.once('error', (error) => finish(error));
      child.once('exit', () => finish(new Error('代码进程意外退出')));
      child.once('message', (value) => {
        try {
          const result = z
            .object({
              ok: z.boolean(),
              result: z.record(z.string(), z.unknown()).optional(),
              error: z.string().max(1000).optional(),
            })
            .parse(value);
          if (!result.ok) finish(new Error(result.error || '代码执行失败'));
          else finish(undefined, result.result);
        } catch {
          finish(new Error('代码响应格式无效'));
        }
      });
      if (signal.aborted) abort();
      else
        child.send({ code, request }, (error) => {
          if (error) finish(error);
        });
    });
  }
  private async kill(child: ChildProcess): Promise<void> {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
    const exited = new Promise<void>((resolve) => {
      child.once('exit', () => resolve());
    });
    if (process.platform === 'win32') {
      const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      });
      killer.on('error', () => child.kill());
      killer.on('exit', (code) => {
        if (code) child.kill();
      });
    } else {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    }
    await exited;
  }
  stop(id: string): Promise<HostingStatus> {
    return this.exclusive(async () => {
      await this.stopNow(id);
      return this.status(id);
    });
  }
  private async stopNow(id: string) {
    const active = this.active.get(id);
    if (!active) return;
    active.abort.abort();
    await Promise.all([...active.children].map((child) => this.kill(child)));
    active.server.closeAllConnections();
    await new Promise<void>((resolve) => active.server.close(() => resolve()));
    this.active.delete(id);
  }
  remove(id: string): Promise<void> {
    return this.exclusive(async () => {
      this.status(id);
      if (this.active.has(id)) throw new Error('请先停止服务再删除');
      const configs = new Map(this.configs);
      configs.delete(id);
      await this.persist(configs);
      this.configs = configs;
      this.history.delete(id);
      this.errors.delete(id);
    });
  }
  dispose(): Promise<void> {
    this.closed = true;
    return this.exclusive(async () => {
      for (const id of this.active.keys()) await this.stopNow(id);
    });
  }
}
