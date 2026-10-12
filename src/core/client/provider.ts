import {
  clientInfoSchema,
  clientEndpointSchema,
  clientPasswordSchema,
  type ClientInfo,
} from '../../shared/client';
import { connect, type TLSSocket } from 'node:tls';
import { randomUUID, X509Certificate } from 'node:crypto';
import { hostname } from 'node:os';
import { z } from 'zod';
import { clientInvitationSchema, clientShellSchema, type ClientDevice } from '../../shared/client';
import type { SessionEvent } from '../../shared/contracts';
import type { ManagedProvider } from '../connections/manager';
import type { ProviderConnection } from '../connections/contracts';
import { ClientVault, fingerprint, type ClientIdentity } from './identity';
import { frames, send, textChunks } from './wire';
const deviceSchema = clientInvitationSchema.omit({ token: true, expires: true });
type Device = z.infer<typeof deviceSchema>;
class ClientChannel {
  certificate = '';
  private pending = new Map<
    string,
    {
      resolve: (v: unknown) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private heartbeat?: ReturnType<typeof setInterval>;
  constructor(
    readonly socket: TLSSocket,
    event: (event: string, data?: string) => void,
  ) {
    socket.on('error', () => {});
    socket.once('close', () => {
      clearInterval(this.heartbeat);
      for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.reject(new Error('Client disconnected'));
      }
      this.pending.clear();
      event('closed');
    });
    frames(socket, (raw) => {
      const value = z
        .object({
          id: z.string().uuid().optional(),
          result: z.unknown().optional(),
          error: z.string().max(200).optional(),
          event: z.enum(['data', 'closed']).optional(),
          data: z.string().max(65536).optional(),
        })
        .strict()
        .parse(raw);
      if (value.event) {
        if (value.event === 'data' && value.data !== undefined) event('data', value.data);
        else if (value.event === 'closed') socket.destroy();
        return;
      }
      const pending = value.id && this.pending.get(value.id);
      if (!pending) return;
      this.pending.delete(value.id!);
      clearTimeout(pending.timer);
      if (value.error) pending.reject(new Error(value.error));
      else pending.resolve(value.result);
    });
  }
  request(op: string, payload?: unknown) {
    return new Promise<unknown>((resolve, reject) => {
      if (this.socket.destroyed || this.pending.size >= 64) {
        reject(new Error('Client disconnected or busy'));
        return;
      }
      const id = randomUUID(),
        timer = setTimeout(() => {
          this.socket.destroy();
          reject(new Error('Client request timed out; not replayed'));
        }, 15000);
      this.pending.set(id, { resolve, reject, timer });
      try {
        send(this.socket, { id, op, payload });
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(e);
      }
    });
  }
  pulse() {
    this.heartbeat = setInterval(
      () => void this.request('ping').catch(() => this.socket.destroy()),
      15000,
    );
  }
}
async function dial(
  device: { host: string; port: number; certificate?: string },
  identity: ClientIdentity,
  event: (e: string, data?: string) => void,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const expected = device.certificate ? fingerprint(device.certificate) : undefined;
  const socket = connect({
    host: device.host,
    port: device.port,
    key: identity.key,
    cert: identity.certificate,
    minVersion: 'TLSv1.3',
    rejectUnauthorized: false,
    // Self-signed leaf trust is checked below BEFORE any application bytes are sent.
    // This scoped socket uses an exact invitation pin; it does not trust system CAs.
  });
  const abort = () => socket.destroy(new Error('Client operation cancelled'));
  signal.addEventListener('abort', abort, { once: true });
  socket.once('close', () => signal.removeEventListener('abort', abort));
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => socket.destroy(new Error('Client connection timeout')), 10000);
      socket.once('error', reject);
      socket.once('secureConnect', () => {
        clearTimeout(timer);
        resolve();
      });
      socket.once('close', () => {
        clearTimeout(timer);
        reject(new Error('Client closed during handshake'));
      });
    });
    const cert = socket.getPeerCertificate();
    if (!cert.raw) throw new Error('Client certificate missing');
    const verified = new X509Certificate(cert.raw);
    if (
      (expected !== undefined && verified.fingerprint256 !== expected) ||
      Date.parse(verified.validTo) < Date.now() ||
      Date.parse(verified.validFrom) > Date.now()
    )
      throw new Error('Client identity changed or expired');
    signal.throwIfAborted();
    const channel = new ClientChannel(socket, event);
    channel.certificate = verified.toString();
    return channel;
  } catch (e) {
    socket.destroy();
    throw e;
  }
}
export class ClientProvider implements ManagedProvider {
  readonly id = 'cshell.client';
  readonly version = '0.1.0';
  readonly capabilities = ['terminal.interactive'];
  readonly configuration = z
    .object({ deviceId: z.string().uuid(), shell: clientShellSchema })
    .strict();
  private identity?: Promise<ClientIdentity>;
  private devices: Device[] = [];
  private sessions = new Map<string, { channel: ClientChannel; connection: ProviderConnection }>();
  constructor(
    private vault: ClientVault,
    private emit: (event: SessionEvent) => void,
  ) {}
  async load() {
    this.devices = (await this.vault.read('devices', z.array(deviceSchema).max(100))) ?? [];
  }
  list(): ClientDevice[] {
    return this.devices.map(({ certificate, ...d }) => ({
      ...d,
      fingerprint: fingerprint(certificate),
    }));
  }
  async probe(value: unknown): Promise<ClientInfo> {
    const endpoint = clientEndpointSchema.parse(value);
    const channel = await dial(
      endpoint,
      await (this.identity ??= this.vault.identity()),
      () => {},
      new AbortController().signal,
    );
    try {
      const info = z
        .object({
          protocol: z.literal(1),
          deviceId: z.string().uuid(),
          name: z.string().min(1).max(80),
        })
        .strict()
        .parse(await channel.request('info'));
      return clientInfoSchema.parse({ ...info, ...endpoint, certificate: channel.certificate });
    } finally {
      channel.socket.destroy();
    }
  }
  async pairPassword(value: unknown, secret: unknown) {
    const info = clientInfoSchema.parse(value);
    const password = clientPasswordSchema.parse(secret);
    const existing = this.devices.find((d) => d.deviceId === info.deviceId);
    if (existing && fingerprint(existing.certificate) !== fingerprint(info.certificate))
      throw new Error('设备身份已改变，请先移除旧记录并核对指纹');
    const channel = await dial(
      info,
      await (this.identity ??= this.vault.identity()),
      () => {},
      new AbortController().signal,
    );
    try {
      this.verifyAuth(await channel.request('auth', { name: hostname(), password }), info.deviceId);
      const next = [...this.devices.filter((d) => d.deviceId !== info.deviceId), info];
      if (next.length > 100) throw new Error('Device limit');
      await this.vault.write('devices', next);
      this.devices = next;
      return this.list().find((d) => d.deviceId === info.deviceId)!;
    } finally {
      channel.socket.destroy();
    }
  }
  async pair(text: string) {
    if (text.length > 16384) throw new Error('Invitation too large');
    const invitation = clientInvitationSchema.parse(JSON.parse(text));
    if (invitation.expires < Date.now()) throw new Error('配对邀请已过期');
    if (this.devices.some((d) => d.deviceId === invitation.deviceId))
      throw new Error('设备已配对，请先移除旧记录');
    const channel = await dial(
      invitation,
      await (this.identity ??= this.vault.identity()),
      () => {},
      new AbortController().signal,
    );
    try {
      const response = await channel.request('auth', { name: hostname(), token: invitation.token });
      this.verifyAuth(response, invitation.deviceId);
      const { token: _token, expires: _expires, ...device } = invitation;
      if (this.devices.length >= 100) throw new Error('Device limit');
      const next = [...this.devices, device];
      await this.vault.write('devices', next);
      this.devices = next;
      return this.list().find((d) => d.deviceId === device.deviceId)!;
    } finally {
      channel.socket.destroy();
    }
  }
  private verifyAuth(value: unknown, deviceId: string) {
    const response = z
      .object({
        protocol: z.literal(1),
        deviceId: z.literal(deviceId),
        shells: z.array(clientShellSchema),
        capabilities: z.array(z.literal('terminal.interactive')),
      })
      .strict()
      .parse(value);
    return response;
  }
  async forget(id: string) {
    for (const [sessionId, s] of this.sessions)
      if (s.connection.target.resourceId === id) this.disconnect(sessionId);
    const next = this.devices.filter((d) => d.deviceId !== id);
    await this.vault.write('devices', next);
    this.devices = next;
  }
  async connect(value: unknown, _credentials: unknown, signal: AbortSignal) {
    const config = this.configuration.parse(value),
      device = this.devices.find((d) => d.deviceId === config.deviceId);
    if (!device) throw new Error('Client device not paired');
    const id = randomUUID();
    let ready = false;
    const early: string[] = [];
    let earlySize = 0;
    const channel = await dial(
      device,
      await (this.identity ??= this.vault.identity()),
      (event, data) => {
        if (event === 'data') {
          if (!ready) {
            earlySize += data!.length;
            if (earlySize > 500000) {
              channel.socket.destroy();
              return;
            }
            early.push(data!);
          } else this.emit({ type: 'data', sessionId: id, data: data! });
        } else {
          this.sessions.delete(id);
          if (ready) this.emit({ type: 'closed', sessionId: id });
        }
      },
      signal,
    );
    try {
      const auth = this.verifyAuth(
        await channel.request('auth', { name: hostname() }),
        device.deviceId,
      );
      if (!auth.shells.includes(config.shell)) throw new Error('Client 未授权此 Shell');
      await channel.request('open', config.shell);
      signal.throwIfAborted();
      if (channel.socket.destroyed) throw new Error('Client disconnected');
      const fire = (op: string, payload: unknown) => {
        void channel.request(op, payload).catch(() => channel.socket.destroy());
      };
      const connection: ProviderConnection = {
        target: {
          providerId: this.id,
          resourceId: device.deviceId,
          identity: fingerprint(device.certificate),
          label: `${device.name} · ${config.shell}`,
        },
        tools: [],
        terminal: {
          input: (data) => {
            for (const chunk of textChunks(data)) fire('input', chunk);
          },
          resize: (cols, rows) => fire('resize', { cols, rows }),
          acknowledge: (count) => fire('ack', count),
        },
      };
      this.sessions.set(id, { channel, connection });
      ready = true;
      channel.pulse();
      for (const data of early) this.emit({ type: 'data', sessionId: id, data });
      return id;
    } catch (e) {
      channel.socket.destroy();
      throw e;
    }
  }
  resolve(id: string) {
    const s = this.sessions.get(id);
    if (!s) throw new Error('Client session closed');
    return s.connection;
  }
  disconnect(id: string) {
    const s = this.sessions.get(id);
    this.sessions.delete(id);
    s?.channel.socket.destroy();
  }
  get size() {
    return this.sessions.size;
  }
  dispose() {
    for (const id of this.sessions.keys()) this.disconnect(id);
  }
}
