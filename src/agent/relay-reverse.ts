import { connect, type Socket } from 'node:net';
import { randomBytes } from 'node:crypto';
import type { TLSSocket } from 'node:tls';
import { z } from 'zod';
import { ClientVault } from '../core/client/identity';
import { agentReverseRelayConfigSchema, type AgentReverseRelayStatus } from '../shared/agent-relay';
import { openRelayTunnel, readRelayLine, writeRelayControl } from './relay';

export interface AgentReverseRelayOptions {
  vault: ClientVault;
  audit?: (event: { action: string; reason?: string }) => void;
}

/** B only makes outbound connections to A. The local Agent remains the TLS endpoint. */
export class AgentReverseRelayService {
  private configurationRevision = randomBytes(32).toString('hex');
  private config = agentReverseRelayConfigSchema.parse({});
  private loaded = false;
  private connected = false;
  private error?: string;
  private abort?: AbortController;
  private runner?: Promise<void>;
  private active = new Map<string, () => void>();
  private changes: Promise<unknown> = Promise.resolve();
  constructor(private options: AgentReverseRelayOptions) {}
  private serial<T>(fn: () => Promise<T>) {
    const result = this.changes.then(fn);
    this.changes = result.catch(() => {});
    return result;
  }
  async load() {
    return this.serial(async () => {
      if (!this.loaded) {
        this.config =
          (await this.options.vault.read('relay-reverse', agentReverseRelayConfigSchema)) ??
          agentReverseRelayConfigSchema.parse({});
        this.loaded = true;
      }
      return this.status();
    });
  }
  status(): AgentReverseRelayStatus {
    const { relay, ...rest } = this.config;
    const safeRelay = relay && {
      host: relay.host,
      port: relay.port,
      fingerprint: relay.fingerprint,
      targetId: relay.targetId,
    };
    return {
      revision: this.configurationRevision,
      running: !!this.abort,
      connected: this.connected,
      activeConnections: this.active.size,
      error: this.error,
      config: { ...rest, relay: safeRelay, hasCredential: !!relay?.credential },
    };
  }
  async configure(input: unknown) {
    return this.serial(async () => {
      if (!this.loaded) throw new Error('Reverse relay is not loaded');
      const { expectedRevision, ...raw } = z.object({ expectedRevision: z.string().regex(/^[a-f0-9]{64}$/).optional() }).passthrough().parse(input);
      if (expectedRevision !== undefined && expectedRevision !== this.configurationRevision)
        throw new Error('Reverse relay configuration changed; reload status before saving');
      // A blank password keeps the existing credential only for the exact same relay identity and target.
      const incoming = z
        .object({ relay: z.record(z.string(), z.unknown()).optional() })
        .passthrough()
        .parse(raw);
      const old = this.config.relay;
      if (
        incoming.relay &&
        !incoming.relay.credential &&
        old &&
        ['host', 'port', 'fingerprint', 'targetId'].every(
          (key) => incoming.relay![key] === old[key as keyof typeof old],
        )
      )
        incoming.relay.credential = old.credential;
      const next = agentReverseRelayConfigSchema.parse(incoming);
      await this.options.vault.write('relay-reverse', next);
      await this.stopNow();
      this.config = next;
      this.configurationRevision = randomBytes(32).toString('hex');
      this.error = undefined;
      return this.status();
    });
  }
  async start() {
    return this.serial(async () => {
      if (!this.loaded || !this.config.enabled || !this.config.relay)
        throw new Error('Reverse relay is disabled or not configured');
      if (!this.abort) {
        this.abort = new AbortController();
        this.runner = this.loop(this.abort.signal);
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
    this.abort?.abort();
    this.abort = undefined;
    for (const close of this.active.values()) close();
    await this.runner;
    this.runner = undefined;
    this.connected = false;
  }
  private report(action: string, reason?: string) {
    try {
      this.options.audit?.({ action, reason });
    } catch {}
  }
  private async loop(signal: AbortSignal) {
    while (!signal.aborted) {
      let socket: TLSSocket | undefined;
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      const session = new AbortController();
      const combined = AbortSignal.any([signal, session.signal]);
      try {
        socket = await openRelayTunnel({
          ...this.config.relay!,
          signal: combined,
          timeoutMs: this.config.connectTimeoutMs,
          operation: 'register',
        });
        socket.once('close', () => session.abort());
        this.connected = true;
        this.error = undefined;
        this.report('relay.reverse.connected');
        heartbeat = setInterval(() => {
          try {
            if (socket) writeRelayControl(socket, { type: 'ping' });
          } catch {
            session.abort();
          }
        }, 20000);
        while (!combined.aborted) {
          const message = z
            .object({
              type: z.enum(['open', 'pong']),
              requestId: z
                .string()
                .regex(/^[a-f0-9]{64}$/)
                .optional(),
            })
            .parse(
              await readRelayLine(socket, AbortSignal.any([combined, AbortSignal.timeout(60000)])),
            );
          if (message.type === 'open' && message.requestId) {
            if (
              this.active.size >= this.config.maxConnections ||
              this.active.has(message.requestId)
            )
              writeRelayControl(socket, { type: 'reject', requestId: message.requestId });
            else void this.channel(message.requestId, combined, socket);
          }
        }
      } catch (error) {
        if (!signal.aborted) {
          this.error = error instanceof Error ? error.message : 'Reverse relay disconnected';
          this.report('relay.reverse.disconnected', this.error);
        }
      } finally {
        if (heartbeat) clearInterval(heartbeat);
        session.abort();
        socket?.destroy();
        this.connected = false;
        for (const close of this.active.values()) close();
      }
      if (!signal.aborted)
        await new Promise<void>((resolve) => {
          const done = () => {
            clearTimeout(timer);
            signal.removeEventListener('abort', done);
            resolve();
          };
          const timer = setTimeout(done, 1000);
          signal.addEventListener('abort', done, { once: true });
          if (signal.aborted) done();
        });
    }
  }
  private async channel(requestId: string, signal: AbortSignal, control: TLSSocket) {
    let remote: TLSSocket | undefined;
    let local: Socket | undefined;
    const abort = new AbortController();
    const close = () => {
      abort.abort();
      remote?.destroy();
      local?.destroy();
      this.active.delete(requestId);
    };
    this.active.set(requestId, close);
    const combined = AbortSignal.any([signal, abort.signal]);
    try {
      remote = await openRelayTunnel({
        ...this.config.relay!,
        operation: 'channel',
        requestId,
        signal: combined,
        timeoutMs: this.config.connectTimeoutMs,
      });
      remote.once('close', close);
      remote.on('error', close);
      local = connect({ host: this.config.localHost, port: this.config.localPort });
      local.on('error', close);
      local.once('close', close);
      await new Promise<void>((resolve, reject) => {
        const timeout = AbortSignal.any([
          combined,
          AbortSignal.timeout(this.config.connectTimeoutMs),
        ]);
        const cancel = () => {
          cleanup();
          reject(new Error('Local Agent connection cancelled or timed out'));
        };
        const failed = (error: Error) => {
          cleanup();
          reject(error);
        };
        const connected = () => {
          cleanup();
          resolve();
        };
        const cleanup = () => {
          timeout.removeEventListener('abort', cancel);
          local!.off('error', failed);
          local!.off('connect', connected);
        };
        timeout.addEventListener('abort', cancel, { once: true });
        local!.once('error', failed);
        local!.once('connect', connected);
        if (timeout.aborted) cancel();
      });
      if (combined.aborted) throw new Error('Reverse channel cancelled');
      remote.pipe(local);
      local.pipe(remote);
    } catch {
      if (!control.destroyed && !signal.aborted) {
        try {
          writeRelayControl(control, { type: 'reject', requestId });
        } catch {
          control.destroy();
        }
      }
      close();
    }
  }
}
