import { executeHttp } from '../http-transport';
import { httpWireSchema } from '../../shared/http';
import { accessSchema, hashPassword, verifyPassword } from './password';
import {
  clientAccessSchema,
  clientEndpointSchema,
  clientOpenSchema,
  clientExecSchema,
} from '../../shared/client';
import { agentCallSchema, type AgentShellOption } from '../../shared/agent';
import { createServer, type Server, type TLSSocket } from 'node:tls';
import { randomBytes, timingSafeEqual, X509Certificate } from 'node:crypto';
import { hostname, networkInterfaces } from 'node:os';
import { z } from 'zod';
import { clientShellSchema, type ClientShell, type ClientStatus } from '../../shared/client';
import type { SessionEvent } from '../../shared/contracts';
import type { ManagedProvider } from '../connections/manager';
import { ClientVault, fingerprint, type ClientIdentity } from './identity';
import { frames, send, reply, textChunks } from './wire';
const peerSchema = z.object({
  allowHttp: z.boolean().default(false),
  allowManage: z.boolean().default(false),
  allowHosting: z.boolean().default(false),
  allowRelay: z.boolean().default(false),
  fingerprint: z.string(),
  name: z.string().min(1).max(80),
  shells: z.array(clientShellSchema).max(6),
});
const requestSchema = z
  .object({
    id: z.string().uuid(),
    op: z.enum([
      'info',
      'auth',
      'open',
      'input',
      'resize',
      'ack',
      'close',
      'ping',
      'http',
      'manage',
      'desktop-stream',
      'exec',
    ]),
    payload: z.unknown().optional(),
  })
  .strict();
type Peer = z.infer<typeof peerSchema>;
type Channel = { socket: TLSSocket; peer?: Peer; terminal?: string; alive: boolean };
export class ClientServer {
  private server?: Server;
  private identity!: ClientIdentity;
  private peers: Peer[] = [];
  private channels = new Set<Channel>();
  private invitation?: { token: string; expires: number; shells: ClientShell[] };
  private audit: ClientStatus['audit'] = [];
  private access?: z.infer<typeof accessSchema>;
  private attempts: number[] = [];
  private changingAccess = false;
  private port?: number;
  private bind?: string;
  private advertisedHost?: string;
  private advertisedPort?: number;
  constructor(
    private vault: ClientVault,
    private terminal: ManagedProvider,
    private options: {
      desktopStream?: (socket: TLSSocket, owner: string) => Promise<void>;
      manage?: (method: string, params: unknown, signal: AbortSignal, owner: string) => Promise<unknown>;
      shells?: () => Promise<AgentShellOption[]>;
      execute?: (input: unknown, signal: AbortSignal) => Promise<unknown>;
    } = {},
  ) {}
  async load() {
    this.identity = await this.vault.identity();
    const listener = await this.vault.read(
      'listener',
      z.object({
        bind: z.string(),
        port: z.number().int().min(1024).max(65535),
        advertisedHost: clientEndpointSchema.shape.host.optional(),
        advertisedPort: clientEndpointSchema.shape.port.optional(),
      }),
    );
    this.bind = listener?.bind;
    this.advertisedHost = listener?.advertisedHost;
    this.advertisedPort = listener?.advertisedPort;
    this.port = listener?.port;
    this.access = (await this.vault.read('access', accessSchema)) ?? undefined;
    this.peers = (await this.vault.read('peers', z.array(peerSchema).max(32))) ?? [];
    this.audit =
      (await this.vault.read(
        'audit',
        z.array(z.object({ time: z.string(), action: z.string(), peer: z.string() })).max(200),
      )) ?? [];
  }
  private record(action: string, peer: string) {
    this.audit.push({ time: new Date().toISOString(), action, peer });
    this.audit = this.audit.slice(-200);
    return this.vault.write('audit', this.audit);
  }
  status(): ClientStatus {
    return {
      passwordConfigured: !!this.access,
      allowedShells: this.access?.shells ?? [],
      allowHttp: this.access?.allowHttp ?? false,
      allowManage: this.access?.allowManage ?? false,
      allowHosting: this.access?.allowHosting ?? false,
      allowRelay: this.access?.allowRelay ?? false,
      running: !!this.server,
      deviceId: this.identity.id,
      fingerprint: fingerprint(this.identity.certificate),
      port: this.port,
      bind: this.bind,
      advertisedHost: this.advertisedHost,
      advertisedPort: this.advertisedPort,
      peers: this.peers.map((p) => ({
        ...p,
        connected: [...this.channels].filter((c) => c.peer?.fingerprint === p.fingerprint).length,
      })),
      audit: [...this.audit].reverse(),
    };
  }
  browserAllowed(owner:string){return !!this.access?.allowHttp&&this.peers.some(p=>p.fingerprint===owner&&p.allowHttp);}
  managementAllowed(owner: string) {
    return !!this.access?.allowManage && this.peers.some((p) => p.fingerprint === owner && p.allowManage);
  }
  async revealPassword() { return (await this.vault.read('connection-password', z.string())) ?? ''; }
  async setAccess(options: unknown) {
    const input = clientAccessSchema.parse(options);
    if (this.server || this.changingAccess) throw new Error('请先停止服务再修改密码与权限');
    this.changingAccess = true;
    try {
      const next = {
        ...(await hashPassword(input.password)),
        shells: [...new Set(input.shells)],
        allowHttp: input.allowHttp,
        allowManage: input.allowManage,
        allowHosting: input.allowHosting,
        allowRelay: input.allowRelay,
      };
      // Saving an endpoint or unchanged password must not revoke paired machines.
      // Narrow existing grants; newly enabled permissions still require explicit pairing.
      const samePassword = this.access && await verifyPassword(input.password, this.access);
      const peers = samePassword ? this.peers.map(peer => ({...peer,
        shells: peer.shells.filter(shell => next.shells.includes(shell)),
        allowHttp: !!peer.allowHttp && !!next.allowHttp,
        allowManage: !!peer.allowManage && !!next.allowManage,
        allowHosting: !!peer.allowHosting && !!next.allowHosting,
        allowRelay: !!peer.allowRelay && !!next.allowRelay,
      })) : [];
      await this.vault.write('peers', peers);
      this.peers = peers;
      this.invitation = undefined;
      await this.vault.write('connection-password', input.password);
      await this.vault.write('access', next);
      this.access = next;
      await this.record('access.changed', 'local');
      return this.status();
    } finally {
      this.changingAccess = false;
    }
  }
  connectionInfo(host: string) {
    const endpoint = clientEndpointSchema.parse({ host, port: this.advertisedPort ?? this.port });
    return JSON.stringify({
      protocol: 1,
      deviceId: this.identity.id,
      name: hostname(),
      ...endpoint,
      certificate: this.identity.certificate,
    });
  }
  async start(options: unknown) {
    if (this.changingAccess) throw new Error('Access configuration busy');
    const input = z
      .object({
        bind: z.string(),
        port: z.number().int().min(1024).max(65535),
        advertisedHost: clientEndpointSchema.shape.host.optional(),
        advertisedPort: clientEndpointSchema.shape.port.optional(),
      })
      .strict()
      .parse(options);
    const addresses = [
      '0.0.0.0', '127.0.0.1',
      '::1',
      ...Object.values(networkInterfaces()).flatMap((rows) => rows?.map((r) => r.address) ?? []),
    ];
    if (!addresses.includes(input.bind)) throw new Error('请选择本机网络接口地址');
    if (this.server) throw new Error('请先停止服务再修改地址');
    const server = createServer(
      {
        key: this.identity.key,
        cert: this.identity.certificate,
        requestCert: true,
        rejectUnauthorized: false,
        minVersion: 'TLSv1.3',
        handshakeTimeout: 10000,
      },
      (socket) => this.accept(socket),
    );
    server.maxConnections = 16;
    server.on('tlsClientError', () => {});
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(input.port, input.bind, () => {
        server.off('error', reject);
        resolve();
      });
    });
    server.on('error', () => {
      void this.stop();
    });
    this.server = server;
    this.port = input.port;
    this.bind = input.bind;
    this.advertisedHost = input.advertisedHost;
    this.advertisedPort = input.advertisedPort;
    await this.vault.write('listener', input);
    await this.record('service.started', input.bind);
    return this.status();
  }
  async stop() {
    this.invitation = undefined;
    const server = this.server;
    this.server = undefined;
    for (const channel of this.channels) channel.socket.destroy();
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    await this.record('service.stopped', 'local');
    return this.status();
  }
  invite(options: unknown) {
    if (!this.server) throw new Error('请先启动 Client 服务');
    const input = z
      .object({
        host: z
          .string()
          .min(1)
          .max(253)
          .regex(/^[a-zA-Z0-9.:-]+$/),
        shells: z.array(clientShellSchema).min(1).max(6),
      })
      .strict()
      .parse(options);
    const token = randomBytes(32).toString('hex'),
      expires = Date.now() + 300000;
    this.invitation = { token, expires, shells: [...new Set(input.shells)] };
    return JSON.stringify({
      protocol: 1,
      deviceId: this.identity.id,
      name: hostname(),
      host: input.host,
      port: this.advertisedPort ?? this.port,
      certificate: this.identity.certificate,
      token,
      expires,
    });
  }
  async revoke(value: unknown) {
    const id = z.string().max(100).parse(value);
    this.peers = this.peers.filter((p) => p.fingerprint !== id);
    for (const c of this.channels) if (c.peer?.fingerprint === id) c.socket.destroy();
    await this.vault.write('peers', this.peers);
    await this.record('peer.revoked', id);
    return this.status();
  }
  event(event: SessionEvent) {
    if (event.type !== 'data' && event.type !== 'closed') return;
    for (const c of this.channels)
      if (c.terminal === event.sessionId) {
        try {
          if (event.type === 'data') {
            for (const data of textChunks(event.data)) send(c.socket, { event: 'data', data });
          } else send(c.socket, { event: 'closed', ...(event.error ? { error: event.error.slice(0, 200) } : {}) });
        } catch {
          c.socket.destroy();
        }
        if (event.type === 'closed') {
          c.terminal = undefined;
          c.socket.end();
        }
      }
  }
  private accept(socket: TLSSocket) {
    const cert = socket.getPeerCertificate();
    if (!cert.raw || !cert.fingerprint256 || this.channels.size >= 8) {
      socket.destroy();
      return;
    }
    const x509 = new X509Certificate(cert.raw);
    if (Date.parse(x509.validTo) < Date.now() || Date.parse(x509.validFrom) > Date.now()) {
      socket.destroy();
      return;
    }
    const c: Channel = { socket, alive: true };
    this.channels.add(c);
    socket.setTimeout(45000, () => socket.destroy());
    socket.on('error', () => {});
    const timeout = setTimeout(() => {
      if (!c.peer) socket.destroy();
    }, 10000);
    socket.once('close', () => {
      clearTimeout(timeout);
      c.alive = false;
      this.channels.delete(c);
      if (c.terminal) void this.terminal.disconnect(c.terminal);
    });
    let queue = Promise.resolve(),
      pending = 0;
    frames(socket, (raw) => {
      const req = requestSchema.parse(raw);
      if(req.op==='desktop-stream'){
        // Dedicated authenticated stream: no pipelined requests/terminal may cross the protocol boundary.
        if(pending||c.terminal||!c.peer||!this.peers.includes(c.peer)||!this.managementAllowed(cert.fingerprint256)||!this.options.desktopStream){socket.destroy();return false;}
        socket.setTimeout(0);
        send(socket,{id:req.id,result:{desktopStream:true}});
        setImmediate(()=>{if(c.alive&&c.peer&&this.managementAllowed(cert.fingerprint256))void this.options.desktopStream!(socket,cert.fingerprint256).catch(()=>socket.destroy());else socket.destroy();});
        return false;
      }
      if (++pending > 64) {
        socket.destroy();
        return;
      }
      queue = queue
        .then(async () => {
          if (!c.alive) return;
          try {
            const result = await this.handle(c, cert.fingerprint256, req.op, req.payload);
            if (c.alive) await reply(socket, req.id, result);
          } catch {
            if (c.alive) send(socket, { id: req.id, error: req.op === 'auth'
              ? 'CAgent 认证失败：配对已失效或密码不正确，请重新认证'
              : 'CAgent 请求失败：请检查远端权限和服务状态' });
            if (!c.peer) socket.end();
          }
        })
        .catch(() => {
          socket.destroy();
        })
        .finally(() => pending--);
    });
  }
  private async handle(c: Channel, fp: string, op: string, payload: unknown): Promise<unknown> {
    if (op === 'info' && !c.peer)
      return { protocol: 1, deviceId: this.identity.id, name: hostname() };
    if (op === 'auth') {
      if (c.peer) throw new Error('Already authenticated');
      const value = z
        .object({
          name: z.string().min(1).max(80),
          token: z.string().max(128).optional(),
          password: z.string().min(1).max(128).optional(),
        })
        .strict()
        .parse(payload);
      let peer = this.peers.find((p) => p.fingerprint === fp);
      if (!peer) {
        const invite = this.invitation;
        let shells: ClientShell[];
        if (value.password !== undefined) {
          const now = Date.now();
          this.attempts = this.attempts.filter((t) => now - t < 60000);
          if (this.attempts.length >= 5) throw new Error('Authentication rate limited');
          this.attempts.push(now);
          const access = this.access;
          if (
            !access ||
            !(await verifyPassword(value.password, access)) ||
            this.access !== access ||
            !c.alive
          )
            throw new Error('Invalid password');
          shells = access.shells;
        } else {
          if (
            !invite ||
            invite.expires < Date.now() ||
            !value.token ||
            value.token.length !== invite.token.length ||
            !timingSafeEqual(Buffer.from(value.token), Buffer.from(invite.token))
          )
            throw new Error('Invalid invitation');
          this.invitation = undefined;
          shells = invite.shells;
        }
        if (this.peers.length >= 32) throw new Error('Peer limit');
        peer = {
          fingerprint: fp,
          name: value.name,
          shells,
          allowHttp: value.password !== undefined && !!this.access?.allowHttp,
          allowManage: value.password !== undefined && !!this.access?.allowManage,
          allowHosting: value.password !== undefined && !!this.access?.allowHosting,
          allowRelay: value.password !== undefined && !!this.access?.allowRelay,
        };
        this.peers.push(peer);
        try {
          await this.vault.write('peers', this.peers);
        } catch (e) {
          this.peers = this.peers.filter((p) => p !== peer);
          throw e;
        }
        await this.record('peer.paired', fp);
      }
      // Revocation may happen while encrypted persistence awaits IO.
      if (!c.alive || !this.peers.includes(peer)) throw new Error('Revoked');
      c.peer = peer;
      return {
        protocol: 1,
        deviceId: this.identity.id,
        shells: peer.shells,
        capabilities: [
          'terminal.interactive',
          ...(this.options.execute ? ['commands.execute'] : []),
          ...(peer.allowHttp ? ['http.send'] : []),
          ...(peer.allowManage ? ['agent.manage'] : []),
          ...(peer.allowHosting ? ['agent.hosting'] : []),
          ...(peer.allowRelay ? ['agent.relay'] : []),
        ],
      };
    }
    if (!c.peer || !this.peers.includes(c.peer)) throw new Error('Not paired');
    if (op === 'ping') return {};
    if (op === 'exec') {
      const input = clientExecSchema.parse(payload);
      if (!this.options.execute || !c.peer.shells.includes(input.shell))
        throw new Error('Shell execution denied');
      await this.record('command.execute.' + (input.distribution ?? input.shell), fp);
      const abort = new AbortController(),
        closed = () => abort.abort();
      c.socket.once('close', closed);
      try {
        if (!c.alive || !this.peers.includes(c.peer)) throw new Error('Revoked');
        return await this.options.execute(input, abort.signal);
      } finally {
        c.socket.off('close', closed);
      }
    }
    if (op === 'manage') {
      const call = agentCallSchema.parse(payload);
      if (call.method === 'agent.shells')
        return this.options.shells
          ? (await this.options.shells()).filter((s) =>
              c.peer!.shells.includes(clientShellSchema.parse(s.shell)),
            )
          : c.peer.shells.map((shell) => ({ shell, label: shell }));
      const permission = call.method.startsWith('browser.') ? 'allowHttp' : call.method.startsWith('hosting.')
        ? 'allowHosting'
        : call.method.startsWith('relay.')
          ? 'allowRelay'
          : 'allowManage';
      if (!c.peer[permission] || !this.access?.[permission] || !this.options.manage)
        throw new Error('Management permission denied');
      if(!['browser.read','browser.write','browser.close'].includes(call.method))await this.record(call.method, fp);
      const abort = new AbortController(),
        closed = () => abort.abort();
      c.socket.once('close', closed);
      try {
        if (
          !c.alive ||
          !this.peers.includes(c.peer) ||
          !c.peer[permission] ||
          !this.access?.[permission]
        )
          throw new Error('Management permission revoked');
        return await this.options.manage(call.method, call.params, abort.signal, fp);
      } finally {
        c.socket.off('close', closed);
      }
    }
    if (op === 'http') {
      if (!c.peer.allowHttp || !this.access?.allowHttp) throw new Error('HTTP denied');
      const request = httpWireSchema.parse(payload);
      await this.record('http.send', fp);
      const abort = new AbortController(),
        closed = () => abort.abort();
      c.socket.once('close', closed);
      try {
        if (!c.alive || !this.peers.includes(c.peer)) throw new Error('Revoked');
        return await executeHttp(request, abort.signal, undefined, 65536);
      } finally {
        c.socket.off('close', closed);
      }
    }
    if (op === 'open') {
      const config = clientOpenSchema.parse(payload);
      const shell = typeof config === 'string' ? config : config.shell;
      if (c.terminal || !c.peer.shells.includes(shell)) throw new Error('Shell denied');
      await this.record('terminal.open.' + shell, fp);
      const abort = new AbortController();
      const closed = () => abort.abort();
      c.socket.once('close', closed);
      try {
        const id = await this.terminal.connect(config, undefined, abort.signal);
        if (!c.alive || !this.peers.includes(c.peer)) {
          await this.terminal.disconnect(id);
          throw new Error('Revoked');
        }
        c.terminal = id;
        return {};
      } finally {
        c.socket.off('close', closed);
      }
    }
    if (!c.terminal) throw new Error('Terminal unavailable');
    const terminal = this.terminal.resolve(c.terminal).terminal!;
    if (op === 'input') terminal.input(z.string().max(32768).parse(payload));
    else if (op === 'resize') {
      const p = z
        .object({ cols: z.number().int().min(2).max(500), rows: z.number().int().min(1).max(300) })
        .strict()
        .parse(payload);
      terminal.resize(p.cols, p.rows);
    } else if (op === 'ack')
      terminal.acknowledge(z.number().int().min(0).max(1048576).parse(payload));
    else if (op === 'close') {
      await this.terminal.disconnect(c.terminal);
      c.terminal = undefined;
    }
    return {};
  }
}
