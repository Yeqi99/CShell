import { agentManageInput, agentRelayInput } from '../api/agent-inputs';
import { agentMethodOutputs, agentOutputContract } from '../api/agent-outputs';
import { ApiError } from '../api/errors';
import { httpResponseSchema, type HttpWireRequest } from '../../shared/http';
import { agentRelayConnectionSchema, type AgentRelayConnection } from '../../shared/agent-relay';
import { openRelayTunnel } from '../../agent/relay';
import { hostingConfigSchema } from '../../shared/agent-hosting';
import {
  agentCallSchema,
  agentCapability,
  type AgentCall,
  type AgentShellOption,
} from '../../shared/agent';
import {
  clientInfoSchema,
  clientEndpointSchema,
  clientPasswordSchema,
  clientExecSchema,
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
import { ManagementQueue } from './management-queue';
const deviceSchema = clientInvitationSchema
  .omit({ token: true, expires: true })
  .extend({ relay: agentRelayConnectionSchema.optional() });
type Device = z.infer<typeof deviceSchema>;
class ClientChannel {
  certificate = '';
  private pending = new Map<
    string,
    {
      resolve: (v: unknown) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
      chunks?: string;
      upgrade?: boolean;
    }
  >();
  private heartbeat?: ReturnType<typeof setInterval>;
  constructor(
    readonly socket: TLSSocket,
    event: (event: string, data?: string) => void,
  ) {
    let closeReason: string | undefined;
    socket.on('error', () => {});
    socket.once('close', () => {
      clearInterval(this.heartbeat);
      for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.reject(new Error('Client disconnected'));
      }
      this.pending.clear();
      event('closed', closeReason);
    });
    frames(socket, (raw) => {
      const value = z
        .object({
          id: z.string().uuid().optional(),
          result: z.unknown().optional(),
          error: z.string().max(200).optional(),
          event: z.enum(['data', 'closed']).optional(),
          data: z.string().max(65536).optional(),
          chunk: z.string().max(32768).optional(),
          complete: z.literal(true).optional(),
        })
        .strict()
        .parse(raw);
      if (value.event) {
        if (value.event === 'data' && value.data !== undefined) event('data', value.data);
        else if (value.event === 'closed') { closeReason = value.error; socket.destroy(); }
        return;
      }
      const pending = value.id && this.pending.get(value.id);
      if (!pending) return;
      if (value.chunk !== undefined) {
        pending.chunks = (pending.chunks ?? '') + value.chunk;
        if (
          [...this.pending.values()].reduce((n, p) => n + Buffer.byteLength(p.chunks ?? ''), 0) >
          4 * 1024 * 1024
        )
          this.socket.destroy();
        return;
      }
      this.pending.delete(value.id!);
      clearTimeout(pending.timer);
      if (value.error) pending.reject(new Error(value.error));
      else if (value.complete) {
        try {
          pending.resolve(JSON.parse(pending.chunks ?? ''));
        } catch {
          pending.reject(new Error('Malformed Agent result'));
        }
      } else pending.resolve(value.result);
      if(pending.upgrade&&(value.result as {desktopStream?:boolean})?.desktopStream===true)return false;
    });
  }
  request(op: string, payload?: unknown, timeoutMs = 15000) {
    return new Promise<unknown>((resolve, reject) => {
      if (this.socket.destroyed || this.pending.size >= 64) {
        reject(new Error('Client disconnected or busy'));
        return;
      }
      const id = randomUUID(),
        timer = setTimeout(() => {
          this.socket.destroy();
          reject(new Error('Client request timed out; not replayed'));
        }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer,upgrade:op==='desktop-stream' });
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
  device: { host: string; port: number; certificate?: string; relay?: AgentRelayConnection },
  identity: ClientIdentity,
  event: (e: string, data?: string) => void,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const expected = device.certificate ? fingerprint(device.certificate) : undefined;
  const tunnel = device.relay ? await openRelayTunnel({ ...device.relay, signal }) : undefined;
  const socket = connect({
    ...(tunnel ? { socket: tunnel } : {}),
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
  readonly capabilities = [
    'terminal.interactive',
    'commands.execute',
    'http.send',
    'agent.manage',
    'agent.hosting',
    'agent.relay',
  ];
  readonly configuration = z
    .object({
      deviceId: z.string().uuid(),
      shell: clientShellSchema,
      distribution: z.string().min(1).max(100).optional(),
    })
    .strict();
  private identity?: Promise<ClientIdentity>;
  private devices: Device[] = [];
  private explicitDisconnectListeners = new Set<(sessionId:string)=>void>();
  onExplicitDisconnect(listener:(sessionId:string)=>void){this.explicitDisconnectListeners.add(listener);return ()=>this.explicitDisconnectListeners.delete(listener);}
  private sessions = new Map<string, { channel: ClientChannel; connection: ProviderConnection }>();
  constructor(
    private vault: ClientVault,
    private emit: (event: SessionEvent) => void,
  ) {}
  async load() {
    this.devices = (await this.vault.read('devices', z.array(deviceSchema).max(100))) ?? [];
  }
  cloudExport() { return structuredClone(this.devices); }
  cloudValidate(value: unknown) {
    const devices = z.array(deviceSchema).max(100).parse(value);
    for (const device of devices) {
      const existing = this.devices.find(d=>d.deviceId===device.deviceId);
      if (existing && fingerprint(existing.certificate)!==fingerprint(device.certificate)) throw new Error('云端 cagent 身份与本机不一致');
    }
    return devices;
  }
  async cloudImport(value: unknown) {
    const devices = this.cloudValidate(value);
    await this.vault.write('devices', devices);
    this.devices = devices;
    // Controller identity stays local: new installations still authenticate to the target.
  }
  list(): ClientDevice[] {
    return this.devices.map(({ certificate, relay: _relay, ...d }) => ({
      ...d,
      fingerprint: fingerprint(certificate),
    }));
  }
  async probe(value: unknown): Promise<ClientInfo> {
    const endpoint = clientEndpointSchema
      .extend({ relay: agentRelayConnectionSchema.optional() })
      .parse(value);
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
        capabilities: z.array(
          z.enum([
            'terminal.interactive',
            'commands.execute',
            'http.send',
            'agent.manage',
            'agent.hosting',
            'agent.relay',
          ]),
        ),
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
  async call(
    deviceId: string,
    input: AgentCall,
    signal: AbortSignal = new AbortController().signal,
  ) {
    return this.managementQueue.run(deviceId,signal,()=>this.managementCall(deviceId,input,signal));
  }
  private managementQueue = new ManagementQueue();
  private async managementCall(deviceId:string,input:AgentCall,signal:AbortSignal) {
    const device = this.devices.find((d) => d.deviceId === deviceId);
    if (!device) throw new Error('Agent 尚未连接并核对身份');
    const call = agentCallSchema.parse(input);
    const channel = await dial(
      device,
      await (this.identity ??= this.vault.identity()),
      () => {},
      signal,
    );
    try {
      const auth = this.verifyAuth(await channel.request('auth', { name: hostname() }), deviceId);
      if (
        call.method !== 'agent.shells' &&
        !auth.capabilities.includes(agentCapability(call.method))
      )
        throw new Error('受控端未授予此管理权限');
      return await channel.request('manage', call, 60000);
    } finally {
      channel.socket.destroy();
    }
  }
  async browserTransport(deviceId:string){
    const device=this.devices.find(d=>d.deviceId===deviceId);if(!device)throw Error('Agent 身份不可用');
    const channel=await dial(device,await(this.identity??=this.vault.identity()),()=>{},new AbortController().signal);
    try{const auth=this.verifyAuth(await channel.request('auth',{name:hostname()}),deviceId);if(!auth.capabilities.includes('http.send'))throw Error('未授权浏览器网络访问');}
    catch(e){channel.socket.destroy();throw e;}
    return {call:async(method:string,params?:unknown)=>{if(!method.startsWith('browser.'))throw Error('浏览器通道操作无效');if(channel.socket.destroyed)throw Error('浏览器通道已断开');return channel.request('manage',agentCallSchema.parse({method,params}),30000);},validate:()=>{if(channel.socket.destroyed)throw Error('浏览器通道已断开');},close:()=>channel.socket.destroy()};
  }
  /** Dedicated TLS channel, same pinned device and optional end-to-end management relay. */
  async openDesktopStream(deviceId:string,signal:AbortSignal=new AbortController().signal){
    const device=this.devices.find(d=>d.deviceId===deviceId);if(!device)throw new Error('Agent identity not configured');
    const channel=await dial(device,await(this.identity??=this.vault.identity()),()=>{},signal);
    try{const auth=this.verifyAuth(await channel.request('auth',{name:hostname()}),deviceId);if(!auth.capabilities.includes('agent.manage'))throw new Error('Desktop transport management permission denied');
      const response=await channel.request('desktop-stream');if(!(response as {desktopStream?:boolean})?.desktopStream)throw new Error('Desktop stream unsupported');return channel.socket;
    }catch(error){channel.socket.destroy();throw error;}
  }
  async shells(deviceId: string): Promise<AgentShellOption[]> {
    try {
      return z
        .array(
          z.object({
            shell: clientShellSchema,
            label: z.string(),
            distribution: z.string().optional(),
          }),
        )
        .parse(await this.call(deviceId, { method: 'agent.shells' }));
    } catch {
      // Legacy Client has no management operation; its granted shells are authoritative.
      const device = this.devices.find((d) => d.deviceId === deviceId);
      if (!device) throw new Error('Agent unavailable');
      const channel = await dial(
        device,
        await (this.identity ??= this.vault.identity()),
        () => {},
        new AbortController().signal,
      );
      try {
        return this.verifyAuth(await channel.request('auth', { name: hostname() }), deviceId)
          .shells.filter((shell) => shell !== 'wsl')
          .map((shell) => ({ shell, label: shell }));
      } finally {
        channel.socket.destroy();
      }
    }
  }
  async connect(
    value: unknown,
    _credentials: unknown,
    signal: AbortSignal,
    onReady?: (id: string) => void,
  ) {
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
          if (ready) this.emit({ type: 'closed', sessionId: id, ...(data ? { error: data } : {}) });
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
      await channel.request(
        'open',
        config.distribution
          ? { shell: config.shell, distribution: config.distribution }
          : config.shell,
      );
      signal.throwIfAborted();
      if (channel.socket.destroyed) throw new Error('Client disconnected');
      const fire = (op: string, payload: unknown) => {
        void channel.request(op, payload).catch(() => channel.socket.destroy());
      };
      let pendingAck = 0,
        ackSending = false;
      const acknowledge = (count: number) => {
        if (channel.socket.destroyed || !Number.isSafeInteger(count) || count <= 0) return;
        pendingAck += count;
        if (pendingAck > 4 * 1024 * 1024) {
          channel.socket.destroy();
          pendingAck = 0;
          return;
        }
        if (ackSending) return;
        ackSending = true;
        void (async () => {
          try {
            while (pendingAck > 0 && !channel.socket.destroyed) {
              const next = Math.min(pendingAck, 1048576);
              pendingAck -= next;
              await channel.request('ack', next);
            }
          } catch {
            channel.socket.destroy();
          } finally {
            ackSending = false;
          }
        })();
      };
      const connection: ProviderConnection = {
        target: {
          providerId: this.id,
          resourceId: device.deviceId,
          identity: fingerprint(device.certificate),
          label: `${device.name} · ${config.distribution ?? config.shell}`,
        },
        http:
          auth.capabilities.includes('http.send') && config.shell !== 'wsl'
            ? async (request: HttpWireRequest, abort: AbortSignal) => {
                const exchange = await dial(
                  device,
                  await (this.identity ??= this.vault.identity()),
                  () => {},
                  abort,
                );
                try {
                  const grant = this.verifyAuth(
                    await exchange.request('auth', { name: hostname() }),
                    device.deviceId,
                  );
                  if (!grant.capabilities.includes('http.send'))
                    throw new Error('Agent HTTP 权限已撤销');
                  return httpResponseSchema.parse(
                    await exchange.request('http', request, request.timeoutMs + 5000),
                  );
                } finally {
                  exchange.socket.destroy();
                }
              }
            : undefined,
        agent: (call, abort) => this.call(device.deviceId, call, abort),
        tools: [
          ...(auth.capabilities.includes('commands.execute')
            ? [
                {
                  name: 'execute_command',
                  capability: 'commands.execute',
                  jsonOutput: z.object({ stdout: z.string(), stderr: z.string(), exitCode: z.number().int(), truncated: z.boolean(), environment: z.string(), distribution: z.string().optional() }).strict(),
                  examples: [{ input: { command: 'echo cshell', timeoutMs: 5000 }, explanation: 'Use syntax supported by this connection shell. Inspect exitCode and truncated; this independent process does not inherit the interactive terminal working directory or state.' }],
                  description: `Execute a command in an independent process on ${device.name}, environment ${config.distribution ?? config.shell}. Does not write to the user's terminal.`,
                  input: z
                    .object({
                      command: z.string().min(1).max(32768),
                      timeoutMs: z.number().int().min(1).max(86400000).default(30000),
                    })
                    .strict(),
                  needsReview: () => true,
                  invoke: async (value: unknown, abort: AbortSignal) => {
                    const request = clientExecSchema.parse({
                      ...(value as object),
                      shell: config.shell,
                      distribution: config.distribution,
                    });
                    const exchange = await dial(
                      device,
                      await (this.identity ??= this.vault.identity()),
                      () => {},
                      abort,
                    );
                    try {
                      const grant = this.verifyAuth(
                        await exchange.request('auth', { name: hostname() }),
                        device.deviceId,
                      );
                      if (
                        !grant.capabilities.includes('commands.execute') ||
                        !grant.shells.includes(config.shell)
                      )
                        throw new Error('命令执行权限已撤销');
                      return JSON.stringify(
                        await exchange.request('exec', request, request.timeoutMs + 5000),
                      );
                    } finally {
                      exchange.socket.destroy();
                    }
                  },
                },
              ]
            : []),
          ...(['agent.manage', 'agent.hosting', 'agent.relay'] as const)
            .filter((cap) => auth.capabilities.includes(cap))
            .map((cap) => ({
              name: cap.replace('.', '_'),
              capability: cap,
              jsonOutput: agentOutputContract(cap),
              description: `Manage the explicitly authorized Agent (${device.name}), ${cap}. Inspect before changing. Hosting code runs with this machine's account permissions; it is not sandboxed.`,
              input:
                cap === 'agent.hosting'
                  ? z.discriminatedUnion('method', [
                      z.object({ method: z.literal('hosting.list') }),
                      z.object({
                        method: z.literal('hosting.save'),
                        params: z.object({ config: hostingConfigSchema }),
                      }),
                      z.object({
                        method: z.literal('hosting.start'),
                        params: z
                          .object({
                            id: z.string().uuid(),
                            expectedRevision: z.number().int().positive(),
                            allowCode: z.boolean().default(false),
                            reviewedConfig: hostingConfigSchema,
                          })
                          .describe(
                            'First use hosting.list. Include the exact reviewed configuration, revision, code and listener address.',
                          ),
                      }),
                      ...(['hosting.stop', 'hosting.logs', 'hosting.remove'] as const).map(
                        (method) =>
                          z.object({
                            method: z.literal(method),
                            params: z.object({ id: z.string().uuid() }),
                          }),
                      ),
                    ])
                  : cap === 'agent.manage' ? agentManageInput : agentRelayInput,
              examples: [{ input: { method: cap === 'agent.manage' ? 'client.status' : cap === 'agent.relay' ? 'relay.status' : 'hosting.list' }, explanation: 'Inspect the actual target state first. Read the selected method contract before changing configuration. WSL plans and revisions must come from this same Windows Agent; listener or relay changes may disconnect this session.' }],
              needsReview: (value: unknown) =>
                !/(\.status|\.list|\.logs|\.check|\.plan|\.shells)$/.test(
                  (value as AgentCall).method,
                ),
              conflictDomain: (value: unknown) => {
                const call = value as AgentCall;
                if (/(\.status|\.list|\.logs|\.check|\.plan|\.shells)$/.test(call.method)) return;
                const params = call.params as { id?: string; config?: { id?: string } } | undefined;
                if (cap === 'agent.hosting')
                  return `hosting:${params?.id ?? params?.config?.id ?? 'configuration'}`;
                // Listener/relay transitions share state; arbitrary commands declare no inferred locks.
                return cap;
              },
              invoke: async (value: unknown, abort: AbortSignal) => {
                if (cap === 'agent.relay') agentRelayInput.parse(value);
                const call = agentCallSchema.parse(value);
                if (call.method === 'hosting.start') {
                  const params = z
                    .object({
                      id: z.string().uuid(),
                      expectedRevision: z.number().int().positive(),
                      allowCode: z.boolean(),
                      reviewedConfig: hostingConfigSchema,
                    })
                    .parse(call.params);
                  const services = (await this.call(
                    device.deviceId,
                    { method: 'hosting.list' },
                    abort,
                  )) as { config: unknown }[];
                  const current = services.find(
                    (s) => hostingConfigSchema.parse(s.config).id === params.id,
                  );
                  if (
                    !current ||
                    hostingConfigSchema.parse(current.config).revision !==
                      params.expectedRevision ||
                    JSON.stringify(hostingConfigSchema.parse(current.config)) !==
                      JSON.stringify(params.reviewedConfig)
                  )
                    throw new Error('服务配置已改变，请重新查看并审核');
                  call.params = {
                    id: params.id,
                    expectedRevision: params.expectedRevision,
                    allowCode: params.allowCode,
                  };
                }
                // Keep valid, complete JSON. The Agent protocol bounds assembled results;
                // callers with smaller retention limits must report that limit explicitly.
                const result = (await this.call(device.deviceId, call, abort)) ?? null;
                if (!agentMethodOutputs[call.method]?.safeParse(result).success)
                  throw new ApiError('OUTCOME_UNKNOWN', 'Agent result did not match its method contract.', 'Inspect the target before another action; do not replay a mutation.');
                return JSON.stringify(result);
              },
            })),
        ],
        terminal: {
          input: (data) => {
            for (const chunk of textChunks(data)) fire('input', chunk);
          },
          resize: (cols, rows) => fire('resize', { cols, rows }),
          acknowledge,
        },
      };
      this.sessions.set(id, { channel, connection });
      onReady?.(id);
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
    // Network socket closure does not call this method. Explicit UI/API closure
    // also invalidates dependent desktop views after the terminal socket is gone.
    for(const listener of this.explicitDisconnectListeners)listener(id);
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
