import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { networkInterfaces } from 'node:os';
import { X509Certificate, createPublicKey } from 'node:crypto';
import { z } from 'zod';
import { ClientServer } from '../core/client/server';
import { ClientVault } from '../core/client/identity';
import { accessSchema } from '../core/client/password';
import { clientShellSchema, clientAccessSchema, clientEndpointSchema } from '../shared/client';
import { AgentTerminalProvider } from '../core/agent-terminal';
import { agentDirectory, agentCodec } from './storage';
import { startAgentControl } from './control';
import { AgentWslService } from './wsl';
import { WslNetworkSettings } from './wsl-network';
import { HostingService } from './hosting';
import { AgentRelayService } from './relay';
import { AgentReverseRelayService } from './relay-reverse';
import { hostingConfigSchema } from '../shared/agent-hosting';
import { AgentApplicationService } from './applications';

const legacySchema = z
  .object({
    confirm: z.literal(true),
    identity: z
      .object({
        id: z.string().uuid(),
        key: z.string().min(100).max(16384),
        certificate: z.string().min(100).max(16384),
      })
      .strict(),
    access: accessSchema.optional(),
    peers: z
      .array(
        z
          .object({
            fingerprint: z.string().max(100),
            name: z.string().min(1).max(80),
            shells: z.array(clientShellSchema).min(1).max(6),
            allowHttp: z.boolean().default(false),
            allowManage: z.boolean().default(false),
            allowHosting: z.boolean().default(false),
            allowRelay: z.boolean().default(false),
          })
          .strict(),
      )
      .max(32),
    listener: z
      .object({
        bind: z.string().max(253),
        port: z.number().int().min(1024).max(65535),
        advertisedHost: z.string().max(253).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
const idInput = (params: unknown) => z.object({ id: z.string().uuid() }).strict().parse(params).id;
async function finishLegacyImport(vault: ClientVault, input: z.infer<typeof legacySchema>) {
  await vault.write('peers', input.peers);
  if (input.access) await vault.write('access', input.access);
  if (input.listener) await vault.write('listener', input.listener);
  await vault.write('identity', input.identity);
  await vault.write('legacy-import-pending', null);
}
export async function createAgentRuntime(
  options: { directory?: string; terminal?: AgentTerminalProvider } = {},
) {
  const directory = options.directory ?? agentDirectory();
  let canImportLegacy = false;
  try {
    await access(join(directory, 'identity.enc'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    canImportLegacy = true;
  }
  const vault = new ClientVault(directory, await agentCodec(directory));
  const interruptedImport = await vault.read('legacy-import-pending', legacySchema.nullable());
  if (interruptedImport) {
    await finishLegacyImport(vault, interruptedImport);
    canImportLegacy = false;
  }
  let server: ClientServer;
  const terminal = options.terminal ?? new AgentTerminalProvider((event) => server.event(event));
  const shells = async () =>
    (await terminal.shells()).map((s) => ({
      shell: s.environment === 'wsl' ? 'wsl' : s.id,
      label: s.label,
      ...(s.distribution ? { distribution: s.distribution } : {}),
    }));
  server = new ClientServer(vault, terminal, {
    manage: (method, params, signal, owner) => dispatch(method, params, signal, false, owner),
    shells,
    execute: (input, signal) => terminal.execute(input, signal),
  });
  await server.load();
  const applications = new AgentApplicationService(vault, (owner) =>
    server.managementAllowed(owner));
  await applications.load();
  const hosting = new HostingService(join(directory, 'hosting'));
  await hosting.load();
  let relay = new AgentRelayService({ vault, identity: await vault.identity() });
  await relay.load();
  const reverseRelay = new AgentReverseRelayService({ vault });
  await reverseRelay.load();
  const wsl = new AgentWslService(vault);
  await wsl.load();
  const wslNetwork = new WslNetworkSettings();
  const auditSchema = z
    .array(z.object({ time: z.string(), action: z.string(), error: z.string().optional() }))
    .max(100);
  const managementAudit = (await vault.read('management-audit', auditSchema)) ?? [];
  const recordManagement = async (action: string, error?: unknown) => {
    managementAudit.push({
      time: new Date().toISOString(),
      action,
      ...(error
        ? { error: error instanceof Error ? error.message.slice(0, 500) : '管理操作失败' }
        : {}),
    });
    managementAudit.splice(0, Math.max(0, managementAudit.length - 100));
    await vault.write('management-audit', managementAudit);
  };
  let control: Awaited<ReturnType<typeof startAgentControl>> | undefined;
  let closed = false;
  let mutation = Promise.resolve<unknown>(undefined);
  const serialized = (action: () => Promise<unknown>) => {
    const current = mutation.then(action);
    mutation = current.catch(() => {});
    return current;
  };
  async function dispatch(
    method: string,
    params: unknown,
    signal = new AbortController().signal,
    local = true,
    owner = 'local',
  ): Promise<unknown> {
    signal.throwIfAborted();
    if (closed) throw new Error('Agent 已关闭');
    if (!local && owner === 'local' && method.startsWith('applications.')) throw new Error('缺少控制端身份');
    if (method === 'applications.list') return applications.list(owner);
    if (method === 'applications.status') return applications.status(params, owner);
    if (method === 'applications.plan') return applications.plan(params, owner, signal);
    if (method === 'agent.shells' || method === 'agent.environments') return shells();
    if (method === 'client.status')
      return {
        ...server.status(),
        canImportLegacy: local && canImportLegacy,
        platform: process.platform,
        interfaces: [
          ...new Set([
            '127.0.0.1',
            '::1',
            ...Object.values(networkInterfaces()).flatMap((v) => v?.map((i) => i.address) ?? []),
          ]),
        ],
      };
    if (method === 'agent.logs')
      return [...server.status().audit, ...managementAudit].sort((a, b) =>
        b.time.localeCompare(a.time),
      );
    if (method === 'client.info')
      return server.connectionInfo(
        z
          .string()
          .max(253)
          .parse(
            typeof params === 'object' && params ? (params as { host?: string }).host : params,
          ),
      );
    if (method === 'hosting.list') return hosting.list();
    if (method === 'hosting.logs') return hosting.logs(idInput(params));
    if (method === 'relay.status') return relay.status();
    if (method === 'relay.revealCredential') return relay.revealCredential();
    if (method === 'relay.registrationCredential')
      return relay.registrationCredential(
        z
          .object({ targetId: z.string().min(1).max(100) })
          .strict()
          .parse(params),
      );
    if (method === 'relay.reverse.status') return reverseRelay.status();
    if (method === 'wsl.check') return wsl.check();
    if (method === 'wsl.status' || method === 'wsl.logs') return wsl.status();
    if (method === 'wsl.account.status') return wsl.accountStatus(params);
    if (method.startsWith('wsl.network.') && process.platform !== 'win32')
      throw new Error('WSL 网络仅适用于 Windows Agent');
    if (method === 'wsl.network.read') return wslNetwork.read();
    if (method === 'agent.shutdown') {
      if (!local) throw new Error('仅本机可退出 Agent');
      z.object({ confirm: z.literal(true) })
        .strict()
        .parse(params);
      setTimeout(() => void close(), 100).unref();
      return { stopping: true };
    }
    return serialized(async () => {
      signal.throwIfAborted();
      if (closed) throw new Error('Agent 已关闭');
      if (method === 'applications.configure') {
        if (!local) throw new Error('仅目标 Agent 本机可修改应用安装授权');
        const result = await applications.configure(params);
        await recordManagement('applications.configure');
        return result;
      }
      if (method === 'applications.cancel') return applications.cancel(params, owner);
      if (method === 'applications.install') {
        await recordManagement('applications.install');
        signal.throwIfAborted();
        return applications.install(params, owner);
      }
      if (method === 'client.access') {
        const result = await server.setAccess(params);
        canImportLegacy = false;
        return result;
      }
      if (method === 'client.start') {
        const result = await server.start(params);
        canImportLegacy = false;
        return result;
      }
      if (method === 'client.stop') {
        if (local) return server.stop();
        setTimeout(() => {
          if (!closed)
            void serialized(() => {
              signal.throwIfAborted();
              return server.stop();
            }).catch((error) => recordManagement('service.stop.failed', error));
        }, 150);
        return { stopping: true, disconnects: true };
      }
      if (method === 'client.reconfigure') {
        const input = z
          .object({
            confirmDisconnect: z.literal(true),
            listener: z
              .object({
                bind: z.string(),
                port: clientEndpointSchema.shape.port,
                advertisedHost: clientEndpointSchema.shape.host.optional(),
              })
              .strict()
              .optional(),
            access: clientAccessSchema.optional(),
          })
          .strict()
          .parse(params);
        if (!input.listener && !input.access) throw new Error('未指定要修改的配置');
        if (
          input.listener &&
          ![
            '127.0.0.1',
            '::1',
            ...Object.values(networkInterfaces()).flatMap(
              (rows) => rows?.map((row) => row.address) ?? [],
            ),
          ].includes(input.listener.bind)
        )
          throw new Error('请选择当前 Agent 的真实网络接口');
        const status = server.status();
        const listener =
          input.listener ??
          (status.running && status.bind && status.port
            ? { bind: status.bind, port: status.port, advertisedHost: status.advertisedHost }
            : undefined);
        await recordManagement('configuration.change.accepted');
        setTimeout(() => {
          if (closed) return;
          void serialized(async () => {
            signal.throwIfAborted();
            await server.stop();
            if (input.access) await server.setAccess(input.access);
            if (listener) await server.start(listener);
            canImportLegacy = false;
            await recordManagement('configuration.changed');
          }).catch((error) => recordManagement('configuration.change.failed', error));
        }, 150);
        return {
          changing: true,
          disconnects: true,
          repair: '可在目标设备的本机 Agent 控制面板或 CLI 恢复配置',
        };
      }
      if (method === 'client.revoke')
        return server.revoke(
          typeof params === 'object' && params
            ? (params as { fingerprint?: string }).fingerprint
            : params,
        );
      if (method === 'hosting.save')
        return hosting.save(
          z.object({ config: hostingConfigSchema }).strict().parse(params).config,
        );
      if (method === 'hosting.start') {
        const input = z
          .object({
            id: z.string().uuid(),
            expectedRevision: z.number().int().min(0),
            allowCode: z.boolean().optional(),
          })
          .strict()
          .parse(params);
        return hosting.start(input.id, {
          expectedRevision: input.expectedRevision,
          allowCode: input.allowCode,
        });
      }
      if (method === 'hosting.stop') return hosting.stop(idInput(params));
      if (method === 'hosting.remove') return hosting.remove(idInput(params));
      if (method === 'relay.configure')
        return relay.configure(params);
      if (method === 'relay.start') return relay.start();
      if (method === 'relay.stop') return relay.stop();
      if (method === 'relay.rotateCredential') return relay.rotateCredential();
      if (method === 'relay.rotateRegistrationCredential')
        return relay.rotateRegistrationCredential(
          z
            .object({ targetId: z.string().min(1).max(100) })
            .strict()
            .parse(params),
        );
      if (method === 'relay.reverse.configure') return reverseRelay.configure(params);
      if (method === 'relay.reverse.start') return reverseRelay.start();
      if (method === 'relay.reverse.stop') return reverseRelay.stop();
      if (method === 'wsl.plan') return wsl.plan(params);
      if (method === 'wsl.install') return wsl.install(params);
      if (method === 'wsl.cancel') return wsl.cancel();
      if (method === 'wsl.account.initialize') return wsl.initializeAccount(params);
      if (method === 'wsl.network.save') return wslNetwork.save(params);
      if (method === 'wsl.network.apply') {
        z.object({ confirmDisconnect: z.literal(true) })
          .strict()
          .parse(params);
        await wslNetwork.shutdown();
        return { applied: true, disconnects: true };
      }
      if (method === 'legacy.import') {
        if (
          !local ||
          !canImportLegacy ||
          server.status().running ||
          server.status().passwordConfigured ||
          server.status().peers.length ||
          relay.status().running ||
          hosting.list().some((s) => s.running)
        )
          throw new Error('只可在新 Agent 首次配置前导入旧身份');
        const input = legacySchema.parse(params),
          certificate = new X509Certificate(input.identity.certificate);
        if (
          certificate.publicKey.export({ type: 'spki', format: 'pem' }) !==
          createPublicKey(input.identity.key).export({ type: 'spki', format: 'pem' })
        )
          throw new Error('旧设备证书与私钥不匹配');
        // Encrypted journal finishes interrupted migrations before loading any network service.
        await vault.write('legacy-import-pending', input);
        await finishLegacyImport(vault, input);
        await server.load();
        await relay.stop();
        relay = new AgentRelayService({ vault, identity: input.identity });
        await relay.load();
        canImportLegacy = false;
        return { imported: true, deviceId: server.status().deviceId };
      }
      throw new Error('不支持的 Agent 管理操作');
    });
  }
  async function close() {
    if (closed) return;
    closed = true;
    await control?.close();
    await mutation;
    await applications.dispose();
    await wsl.dispose();
    await hosting.dispose();
    await reverseRelay.stop();
    await relay.stop();
    await server.stop();
    await terminal.dispose();
    await vault.flush();
  }
  return {
    server,
    terminal,
    dispatch,
    async startControl() {
      if (control) throw new Error('本机控制服务已运行');
      control = await startAgentControl(directory, (m, p, s) => dispatch(m, p, s, true));
    },
    close,
    directory,
  };
}
