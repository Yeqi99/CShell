import { randomBytes, timingSafeEqual, X509Certificate } from 'node:crypto';
import { connect as tcpConnect, type Socket } from 'node:net';
import { connect as tlsConnect, createServer, type TLSSocket, type Server } from 'node:tls';
import { Transform } from 'node:stream';
import { z } from 'zod';
import { ClientVault, fingerprint, type ClientIdentity } from '../core/client/identity';
import {
  agentRelayConfigSchema,
  type AgentRelayEndpoint,
  type AgentRelayStatus,
} from '../shared/agent-relay';

const savedSchema = z.object({
  config: agentRelayConfigSchema,
  credential: z.string().regex(/^[a-f0-9]{64}$/),
  registrations: z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/)).default({}),
});
const requestSchema = z
  .object({
    protocol: z.literal('cshell-relay/1'),
    targetId: z.string().min(1).max(100),
    credential: z.string().length(64),
    operation: z.enum(['forward', 'register', 'channel']).default('forward'),
    requestId: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  })
  .strict();
const normalized = (value: string) => value.replaceAll(':', '').toUpperCase();
function equal(a: string, b: string) {
  const first = Buffer.from(a),
    second = Buffer.from(b);
  return first.length === second.length && timingSafeEqual(first, second);
}
/** One bounded handshake, then return the socket to paused binary-stream mode. */
export function readRelayLine(socket: TLSSocket, signal: AbortSignal): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    const cleanup = () => {
      socket.pause();
      socket.off('data', data);
      socket.off('error', error);
      socket.off('close', closed);
      signal.removeEventListener('abort', aborted);
    };
    const error = (reason: Error) => {
      cleanup();
      reject(reason);
    };
    const closed = () => error(new Error('Relay connection closed'));
    const aborted = () => error(new Error('Relay handshake cancelled or timed out'));
    const data = (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      const end = buffer.indexOf(10);
      if ((end < 0 && buffer.length > 4096) || end > 4096)
        return error(new Error('Relay handshake too large'));
      if (end < 0) return;
      cleanup();
      if (end + 1 < buffer.length) socket.unshift(buffer.subarray(end + 1));
      try {
        resolve(JSON.parse(buffer.subarray(0, end).toString('utf8')));
      } catch {
        reject(new Error('Invalid relay handshake'));
      }
    };
    socket.on('data', data);
    socket.once('error', error);
    socket.once('close', closed);
    signal.addEventListener('abort', aborted, { once: true });
    if (signal.aborted) aborted();
    else socket.resume();
  });
}
/** Control frames never accumulate an unbounded write backlog on a stalled peer. */
export function writeRelayControl(socket: TLSSocket, value: unknown) {
  if (socket.destroyed || socket.writableLength > 65536) {
    socket.destroy();
    throw new Error('Relay control connection is closed or congested');
  }
  socket.write(JSON.stringify(value) + '\n');
}

export interface AgentRelayOptions {
  vault: ClientVault;
  identity: ClientIdentity;
  audit?: (event: {
    action: 'relay.open' | 'relay.close' | 'relay.reject';
    targetId?: string;
    bytes?: number;
    reason?: string;
  }) => void;
}

/** Relay authorization only permits opaque byte forwarding, never terminal, HTTP or management operations. */
export class AgentRelayService {
  private config = agentRelayConfigSchema.parse({});
  private credential = '';
  private registrationCredentials: Record<string, string> = {};
  private registrations = new Map<
    string,
    {
      socket: TLSSocket;
      closeTargets: Set<() => void>;
      requests: Map<
        string,
        { resolve: (socket: TLSSocket) => void; reject: (error: Error) => void }
      >;
    }
  >();
  private server?: Server;
  private sockets = new Set<Socket>();
  private tunnels = new Set<() => void>();
  private bytesForwarded = 0;
  private loaded = false;
  private changes: Promise<unknown> = Promise.resolve();
  constructor(private options: AgentRelayOptions) {}
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.changes.then(operation);
    this.changes = pending.catch(() => {});
    return pending;
  }
  async load() {
    return this.serial(async () => {
      if (this.loaded) return this.status();
      const saved = await this.options.vault.read('relay', savedSchema);
      this.config = saved?.config ?? agentRelayConfigSchema.parse({});
      this.credential = saved?.credential ?? randomBytes(32).toString('hex');
      this.registrationCredentials = saved?.registrations ?? {};
      if (!saved) await this.persist();
      this.loaded = true;
      return this.status();
    });
  }
  private persist(
    config = this.config,
    credential = this.credential,
    registrations = this.registrationCredentials,
  ) {
    return this.options.vault.write('relay', { config, credential, registrations });
  }
  private requireLoaded() {
    if (!this.loaded) throw new Error('Relay is not loaded');
  }
  async configure(input: unknown) {
    return this.serial(async () => {
      this.requireLoaded();
      const { expectedRevision, ...raw } = z.object({ expectedRevision: z.string().regex(/^[a-f0-9]{64}$/).optional() }).passthrough().parse(input);
      if (expectedRevision !== undefined && expectedRevision !== this.configurationRevision)
        throw new Error('Relay configuration changed; reload status before saving');
      const config = agentRelayConfigSchema.parse(raw);
      const registrations = Object.fromEntries(
        config.targets
          .filter((target) => target.mode === 'reverse')
          .map((target) => [
            target.id,
            this.registrationCredentials[target.id] ?? randomBytes(32).toString('hex'),
          ]),
      );
      await this.persist(config, this.credential, registrations);
      await this.stopNow();
      this.config = config;
      this.configurationRevision = randomBytes(32).toString('hex');
      this.registrationCredentials = registrations;
      return this.status();
    });
  }
  /** Explicit user action only; never include the return value in status, audit or ordinary connection information. */
  revealCredential() {
    this.requireLoaded();
    return this.credential;
  }
  registrationCredential(input: { targetId: string }) {
    this.requireLoaded();
    const id = z.object({ targetId: z.string() }).parse(input).targetId;
    if (!Object.hasOwn(this.registrationCredentials, id))
      throw new Error('Reverse target is not configured');
    return this.registrationCredentials[id];
  }
  async rotateRegistrationCredential(input: { targetId: string }) {
    return this.serial(async () => {
      this.registrationCredential(input);
      const next = randomBytes(32).toString('hex');
      const registrations = { ...this.registrationCredentials, [input.targetId]: next };
      await this.persist(this.config, this.credential, registrations);
      this.registrationCredentials = registrations;
      const registration = this.registrations.get(input.targetId);
      for (const close of registration?.closeTargets ?? []) close();
      registration?.socket.destroy();
      return next;
    });
  }
  async rotateCredential() {
    return this.serial(async () => {
      this.requireLoaded();
      const next = randomBytes(32).toString('hex');
      await this.persist(this.config, next);
      this.credential = next;
      for (const close of this.tunnels) close();
      for (const socket of this.sockets) socket.destroy();
      return next;
    });
  }
  private configurationRevision = randomBytes(32).toString('hex');
  status(): AgentRelayStatus {
    return {
      revision: this.configurationRevision,
      running: !!this.server?.listening,
      config: structuredClone(this.config),
      fingerprint: fingerprint(this.options.identity.certificate),
      activeConnections: this.tunnels.size,
      bytesForwarded: this.bytesForwarded,
      registeredTargets: [...this.registrations.keys()],
    };
  }
  async start() {
    return this.serial(async () => {
      this.requireLoaded();
      if (!this.config.enabled) throw new Error('Relay is disabled');
      if (this.server?.listening) return this.status();
      const server = createServer(
        {
          key: this.options.identity.key,
          cert: this.options.identity.certificate,
          minVersion: 'TLSv1.2',
          handshakeTimeout: this.config.connectTimeoutMs,
        },
        (socket) => {
          void this.accept(socket);
        },
      );
      server.on('connection', (socket) => {
        if (this.sockets.size >= this.config.maxConnections * 2 + this.config.targets.length) {
          socket.destroy();
          return;
        }
        this.sockets.add(socket);
        socket.once('close', () => this.sockets.delete(socket));
      });
      server.on('tlsClientError', () => {});
      server.on('error', () => {});
      this.server = server;
      try {
        await new Promise<void>((resolve, reject) => {
          server.once('error', reject);
          server.listen(this.config.port, this.config.bind, () => {
            server.off('error', reject);
            resolve();
          });
        });
      } catch (error) {
        this.server = undefined;
        server.close();
        throw error;
      }
      return this.status();
    });
  }
  async stop() {
    return this.serial(async () => {
      await this.stopNow();
      return this.status();
    });
  }
  private async stopNow() {
    const server = this.server;
    this.server = undefined;
    for (const close of this.tunnels) close();
    for (const socket of this.sockets) socket.destroy();
    if (server?.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  private report(event: Parameters<NonNullable<AgentRelayOptions['audit']>>[0]) {
    try {
      this.options.audit?.(event);
    } catch {
      /* Audit sinks cannot change relay authorization. */
    }
  }
  private async register(socket: TLSSocket, targetId: string, signal: AbortSignal) {
    if (this.registrations.has(targetId)) throw new Error('Target is already registered');
    const registration = {
      socket,
      closeTargets: new Set<() => void>(),
      requests: new Map<
        string,
        { resolve: (socket: TLSSocket) => void; reject: (error: Error) => void }
      >(),
    };
    this.registrations.set(targetId, registration);
    socket.write('{"ok":true}\n');
    try {
      while (!signal.aborted) {
        const message = z
          .object({ type: z.enum(['ping', 'reject']), requestId: z.string().optional() })
          .parse(
            await readRelayLine(socket, AbortSignal.any([signal, AbortSignal.timeout(60000)])),
          );
        if (message.type === 'ping') writeRelayControl(socket, { type: 'pong' });
        else if (message.requestId)
          registration.requests
            .get(message.requestId)
            ?.reject(new Error('Reverse target rejected connection'));
      }
    } finally {
      if (this.registrations.get(targetId) === registration) this.registrations.delete(targetId);
      for (const close of registration.closeTargets) close();
      for (const request of registration.requests.values())
        request.reject(new Error('Reverse target disconnected'));
      socket.destroy();
    }
  }
  private reverseTarget(targetId: string, signal: AbortSignal, close: () => void) {
    const registration = this.registrations.get(targetId);
    if (!registration) return Promise.reject(new Error('Reverse target is offline'));
    const requestId = randomBytes(32).toString('hex');
    registration.closeTargets.add(close);
    return new Promise<TLSSocket>((resolve, reject) => {
      const cleanup = () => {
        registration.requests.delete(requestId);
        signal.removeEventListener('abort', cancel);
      };
      const cancel = () => {
        cleanup();
        registration.closeTargets.delete(close);
        reject(new Error('Reverse connection cancelled or timed out'));
      };
      registration.requests.set(requestId, {
        resolve: (socket) => {
          cleanup();
          socket.once('close', () => registration.closeTargets.delete(close));
          resolve(socket);
        },
        reject: (error) => {
          cleanup();
          registration.closeTargets.delete(close);
          reject(error);
        },
      });
      signal.addEventListener('abort', cancel, { once: true });
      if (signal.aborted) cancel();
      else {
        try {
          writeRelayControl(registration.socket, { type: 'open', requestId });
        } catch (error) {
          cleanup();
          registration.closeTargets.delete(close);
          reject(error);
        }
      }
    });
  }
  private async accept(socket: TLSSocket) {
    socket.on('error', () => {});
    let target: Socket | undefined;
    let targetId: string | undefined;
    let bytes = 0;
    let opened = false;
    let finished = false;
    const abort = new AbortController();
    const close = () => {
      if (finished) return;
      finished = true;
      abort.abort();
      socket.destroy();
      target?.destroy();
      this.tunnels.delete(close);
      if (opened) this.report({ action: 'relay.close', targetId, bytes });
    };
    socket.once('close', close);
    try {
      const signal = AbortSignal.any([
        abort.signal,
        AbortSignal.timeout(this.config.connectTimeoutMs),
      ]);
      const input = requestSchema.parse(await readRelayLine(socket, signal));
      const selected = this.config.targets.find((candidate) => candidate.id === input.targetId);
      if (!selected) throw new Error('Relay target is not authorized');
      targetId = selected.id;
      if (input.operation !== 'forward') {
        if (
          selected.mode !== 'reverse' ||
          !Object.hasOwn(this.registrationCredentials, targetId) ||
          !equal(this.registrationCredentials[targetId], input.credential)
        )
          throw new Error('Relay registration authorization denied');
        if (input.operation === 'register') {
          await this.register(socket, targetId, abort.signal);
          return;
        }
        const pending =
          input.requestId && this.registrations.get(targetId)?.requests.get(input.requestId);
        if (!pending) throw new Error('Reverse channel is not requested');
        socket.write('{"ok":true}\n');
        pending.resolve(socket);
        return;
      }
      if (!equal(this.credential, input.credential)) throw new Error('Relay authorization denied');
      if (this.tunnels.size >= this.config.maxConnections)
        throw new Error('Relay connection limit exceeded');
      this.tunnels.add(close);
      if (selected.mode === 'reverse') target = await this.reverseTarget(targetId, signal, close);
      else {
        target = tcpConnect({ host: selected.host, port: selected.port });
        target.on('error', close);
        target.once('close', close);
        await new Promise<void>((resolve, reject) => {
          const cancel = () => reject(new Error('Relay target connection cancelled or timed out'));
          const failed = (error: Error) => {
            cleanup();
            reject(error);
          };
          const cleanup = () => {
            signal.removeEventListener('abort', cancel);
            target!.off('error', failed);
          };
          target!.once('error', failed);
          signal.addEventListener('abort', cancel, { once: true });
          target!.once('connect', () => {
            cleanup();
            resolve();
          });
          if (signal.aborted) cancel();
        });
      }
      target.on('error', close);
      target.once('close', close);
      if (finished || signal.aborted) throw new Error('Relay connection cancelled');
      this.tunnels.add(close);
      opened = true;
      this.report({ action: 'relay.open', targetId });
      socket.write('{"ok":true}\n');
      socket.setTimeout(this.config.idleTimeoutMs, close);
      target.setTimeout(this.config.idleTimeoutMs, close);
      let tokens = this.config.bytesPerSecond;
      let previous = performance.now();
      const meter = () => {
        const stream = new Transform({
          transform: (chunk: Buffer, _encoding, callback) => {
            const now = performance.now();
            tokens = Math.min(
              this.config.bytesPerSecond,
              tokens + ((now - previous) / 1000) * this.config.bytesPerSecond,
            );
            previous = now;
            if (chunk.length > tokens || bytes + chunk.length > this.config.maxBytesPerTunnel) {
              this.report({
                action: 'relay.reject',
                targetId,
                reason: 'Relay traffic limit exceeded',
              });
              close();
              callback(new Error('Relay traffic limit exceeded'));
              return;
            }
            tokens -= chunk.length;
            bytes += chunk.length;
            this.bytesForwarded += chunk.length;
            callback(null, chunk);
          },
        });
        stream.on('error', close);
        return stream;
      };
      socket.pipe(meter()).pipe(target);
      target.pipe(meter()).pipe(socket);
    } catch (error) {
      this.report({
        action: 'relay.reject',
        targetId,
        reason: error instanceof Error ? error.message : 'Relay rejected',
      });
      // No credential, host enumeration or stack is returned to an untrusted peer.
      if (!socket.destroyed)
        socket.end('{"ok":false,"error":"Relay unavailable or unauthorized"}\n');
      target?.destroy();
      const timer = setTimeout(close, 100);
      timer.unref();
    }
  }
}

export interface OpenRelayTunnelOptions extends AgentRelayEndpoint {
  credential: string;
  targetId: string;
  signal: AbortSignal;
  timeoutMs?: number;
  /** Internal reverse protocol only. Control consumers should omit these. */
  operation?: 'forward' | 'register' | 'channel';
  requestId?: string;
}
/** Outer TLS verifies the relay before transmitting its token; wrap returned socket in target TLS with its own identity check. */
export async function openRelayTunnel(options: OpenRelayTunnelOptions): Promise<TLSSocket> {
  if (!/^[a-f0-9]{64}$/i.test(normalized(options.fingerprint)))
    throw new Error('A verified relay fingerprint is required');
  requestSchema.parse({
    protocol: 'cshell-relay/1',
    targetId: options.targetId,
    credential: options.credential,
  });
  options.signal.throwIfAborted();
  const signal = AbortSignal.any([options.signal, AbortSignal.timeout(options.timeoutMs ?? 10000)]);
  const socket = tlsConnect({
    host: options.host,
    port: options.port,
    rejectUnauthorized: false,
    minVersion: 'TLSv1.2',
  });
  socket.on('error', () => {});
  const cancel = () => socket.destroy(new Error('Relay connection cancelled or timed out'));
  signal.addEventListener('abort', cancel, { once: true });
  try {
    await new Promise<void>((resolve, reject) => {
      const error = (reason: Error) => reject(reason);
      socket.once('error', error);
      socket.once('secureConnect', () => {
        socket.off('error', error);
        resolve();
      });
      if (signal.aborted) cancel();
    });
    const peer = socket.getPeerCertificate();
    if (
      !peer.raw ||
      !equal(
        normalized(new X509Certificate(peer.raw).fingerprint256),
        normalized(options.fingerprint),
      )
    )
      throw new Error('Relay identity mismatch');
    const reply = readRelayLine(socket, signal);
    socket.write(
      JSON.stringify({
        protocol: 'cshell-relay/1',
        targetId: options.targetId,
        credential: options.credential,
        operation: options.operation ?? 'forward',
        requestId: options.requestId,
      }) + '\n',
    );
    const result = z.object({ ok: z.boolean() }).parse(await reply);
    if (!result.ok) throw new Error('Relay unavailable or unauthorized');
    signal.removeEventListener('abort', cancel);
    const close = () => socket.destroy(new Error('Relay connection cancelled'));
    options.signal.addEventListener('abort', close, { once: true });
    socket.once('close', () => options.signal.removeEventListener('abort', close));
    if (options.signal.aborted) {
      close();
      options.signal.throwIfAborted();
    }
    return socket;
  } catch (error) {
    socket.destroy();
    throw error;
  } finally {
    signal.removeEventListener('abort', cancel);
  }
}
