import { createServer, type Server } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type { OAuthClientInformationMixed, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import { z } from 'zod';
import type { ConnectionTool } from '../../core/connections/contracts';

export const cloudflareEndpoint = 'https://mcp.cloudflare.com/mcp';
export function validOAuthState(actual: string | null, expected: string) {
  return !!actual && !!expected && Buffer.byteLength(actual) === Buffer.byteLength(expected)
    && timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}
type Host = {
  directory: string; enabled(): boolean; encrypt(s: string): Promise<string>; decrypt(s: string): Promise<string>;
  open(url: string): Promise<void>; authorized(): Promise<void>;
};
type Credentials = { client?: OAuthClientInformationMixed; tokens?: OAuthTokens; redirect?: string };
export class CloudflareExtension {
  private credentials: Credentials = {};
  private client?: Client;
  private connecting?: Promise<Client>;
  private listener?: Server;
  private timer?: ReturnType<typeof setTimeout>;
  private verifier = '';
  private state = '';
  private pending = false;
  private browserOpened = false;
  private generation = 0;
  private error = '';
  private toolNames: string[] = [];
  private saving = Promise.resolve();
  constructor(private host: Host, private network: typeof fetch = fetch) {}
  private file() { return join(this.host.directory, 'oauth.enc'); }
  async load() {
    try { this.credentials = JSON.parse(await this.host.decrypt(await readFile(this.file(), 'utf8'))); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') this.error = 'Cloudflare 授权读取失败，原文件已保留。'; }
  }
  private save() {
    const value = JSON.stringify(this.credentials);
    const next = this.saving.catch(() => {}).then(async () => {
      await mkdir(this.host.directory, { recursive: true });
      await writeFile(this.file() + '.tmp', await this.host.encrypt(value), { mode: 0o600 });
      await rename(this.file() + '.tmp', this.file());
    });
    this.saving = next; return next;
  }
  private check() { if (!this.host.enabled()) throw Error('请先安装并启用 Cloudflare 扩展。'); }
  status() { return { authorized: !!this.credentials.tokens, connected: !!this.client, pending: this.pending, tools: this.toolNames, error: this.error, endpoint: cloudflareEndpoint }; }
  private provider(generation: number): OAuthClientProvider {
    const current = () => { this.check(); if (generation !== this.generation) throw Error('Cloudflare 授权已取消。'); };
    return {
      redirectUrl: this.credentials.redirect,
      clientMetadata: { client_name: 'CShell Cloudflare', redirect_uris: [this.credentials.redirect!], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' },
      state: () => this.state,
      clientInformation: () => this.credentials.client,
      saveClientInformation: async client => { current(); this.credentials.client = client; await this.save(); },
      tokens: () => this.credentials.tokens,
      saveTokens: async tokens => { current(); this.credentials.tokens = tokens; await this.save(); },
      saveCodeVerifier: v => { current(); this.verifier = v; },
      codeVerifier: () => this.verifier,
      redirectToAuthorization: async url => {
        current();
        if (!this.pending) throw Error('Cloudflare 授权已过期，请在扩展设置中重新授权。');
        if (url.protocol !== 'https:' || !(url.hostname === 'cloudflare.com' || url.hostname.endsWith('.cloudflare.com'))) throw Error('授权地址不属于 Cloudflare。');
        await this.host.open(url.href);
        this.browserOpened = true;
      },
      invalidateCredentials: async scope => {
        current();
        if (scope === 'all' || scope === 'client') delete this.credentials.client;
        if (scope === 'all' || scope === 'tokens') delete this.credentials.tokens;
        if (scope === 'all' || scope === 'verifier') this.verifier = '';
        await this.save();
      },
    };
  }
  private transport() { return new StreamableHTTPClientTransport(new URL(cloudflareEndpoint), { authProvider: this.provider(this.generation), fetch: this.network, reconnectionOptions: { maxRetries: 0, initialReconnectionDelay: 1000, maxReconnectionDelay: 1000, reconnectionDelayGrowFactor: 1 } }); }
  private async connect() {
    this.check();
    if (this.client) return this.client;
    if (this.connecting) return this.connecting;
    const generation = this.generation;
    const pending = (async () => {
      const client = new Client({ name: 'CShell-Cloudflare', version: '1.0.0' });
      try {
        await client.connect(this.transport(), { timeout: 30000 });
        const result = await client.listTools({}, { timeout: 30000 });
        this.check();
        if (generation !== this.generation) throw Error('授权已取消');
        this.toolNames = result.tools.map(t => t.name).filter(n => ['search', 'execute', 'docs'].includes(n));
        if (!this.toolNames.includes('search') || !this.toolNames.includes('execute')) throw Error('Cloudflare 工具目录不完整。');
        this.client = client; this.error = ''; return client;
      } catch (e) { await client.close().catch(() => {}); throw e; }
    })().finally(() => { if(this.connecting === pending)this.connecting = undefined; });
    this.connecting = pending; return pending;
  }
  private stopCallback() { clearTimeout(this.timer); this.listener?.close(); this.listener = undefined; this.pending = false; this.state = ''; this.verifier = ''; }
  async authorize() {
    this.check();
    if (this.pending) return this.status();
    await this.disconnect();
    const generation = this.generation;
    this.state = randomBytes(32).toString('hex'); this.pending = true; this.browserOpened = false; this.error = '';
    const listener = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      res.setHeader('Cache-Control', 'no-store'); res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      if (req.method !== 'GET' || url.pathname !== '/callback' || !validOAuthState(url.searchParams.get('state'), this.state)) { res.writeHead(400).end('Invalid authorization callback'); return; }
      const code = url.searchParams.get('code');
      if (!code || code.length > 8192 || url.searchParams.has('error')) { res.writeHead(400).end('授权未完成，请返回 CShell 重试。'); this.error = '授权已取消。'; this.stopCallback(); return; }
      // Consume state before exchanging the code; duplicate callbacks cannot replay it.
      this.state = '';
      res.end('授权已收到，请返回 CShell 查看连接结果。');
      void (async () => {
        const transport = this.transport();
        try {
          await transport.finishAuth(code);
          if (generation !== this.generation) return;
          await this.connect(); await this.host.authorized();
        } catch { if(generation===this.generation)this.error = 'Cloudflare 授权或连接未完成，请检查网络后重新授权。'; }
        finally { await transport.close().catch(() => {}); if(generation===this.generation)this.stopCallback(); }
      })();
    });
    this.listener = listener;
    try {
      await new Promise<void>((resolve, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', resolve); });
      const address = listener.address(); if (!address || typeof address === 'string') throw Error('无法创建授权回调');
      this.credentials = { redirect: `http://127.0.0.1:${address.port}/callback` };
      await this.save();
      this.timer = setTimeout(() => { this.error = '授权等待超时，请重试。'; this.generation++; this.stopCallback(); }, 300000); this.timer.unref();
      try { await this.connect(); } catch { if (!this.pending || !this.browserOpened) throw Error('Cloudflare 授权未启动，请检查网络。'); }
      return this.status();
    } catch (e) { this.stopCallback(); throw e; }
  }
  async disconnect() {
    this.generation++; this.stopCallback();
    this.connecting = undefined;
    const client = this.client; this.client = undefined; this.toolNames = [];
    await client?.close().catch(() => {});
    this.credentials = {}; this.error = ''; await this.save();
  }
  async call(action: string) {
    if (action === 'status') return this.status();
    if (action === 'restart') { await this.disconnect(); return this.authorize(); }
    if (action === 'authorize') return this.authorize();
    if (action === 'disconnect') { await this.disconnect(); return this.status(); }
    if (action === 'refresh') { await this.connect(); return this.status(); }
    throw Error('Unknown Cloudflare action');
  }
  tools(): ConnectionTool[] {
    if (!this.host.enabled() || !this.credentials.tokens) return [];
    return [{
      name: 'cloudflare_call', capability: 'cloudflare.manage',
      description: 'Use the authorized official Cloudflare MCP. First call search to discover exact API schemas (code runs against spec), then execute to call cloudflare.request in Cloudflare’s sandbox. Can build/deploy Workers, Pages, DNS and storage within granted scopes. Use tools/list through action catalog to read current descriptions and schemas before calling. Inspect existing resources before changes; verify deployment and return the live URL. Never claim a timed-out write failed or blindly replay it: inspect remote state first. Authorization tokens stay in the host.',
      input: z.object({ tool: z.enum(['catalog', 'search', 'execute', 'docs']), arguments: z.record(z.string(), z.unknown()).default({}) }).strict(),
      needsReview: input => (input as {tool:string}).tool === 'execute',
      conflictDomain: () => 'cloudflare-account',
      invoke: async (input, signal, _output, guard) => {
        this.check(); signal.throwIfAborted(); guard?.();
        const args = input as {tool:string; arguments:Record<string,unknown>};
        const client = await this.connect();
        this.check(); signal.throwIfAborted(); guard?.();
        if (args.tool === 'catalog') return JSON.stringify(await client.listTools({}, { signal, timeout: 30000 }));
        if (!this.toolNames.includes(args.tool)) throw Error('Cloudflare 当前未提供该工具，请查询 catalog。');
        // Do not retry mutations after transport errors: their remote outcome may be unknown.
        return JSON.stringify(await client.callTool({ name: args.tool, arguments: args.arguments }, undefined, { signal, timeout: 120000 }));
      },
    }];
  }
}
