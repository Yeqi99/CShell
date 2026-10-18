import { app } from 'electron';
import { join } from 'node:path';
import { z } from 'zod';
import { callAgent, discoverAgent } from '../agent/control';
import { agentCallSchema, type AgentTarget } from '../shared/agent';
import { pluginEnabled } from '../shared/plugins';
import type { Store } from '../core/store';
import type { ClientProvider } from '../core/client/provider';
import type { ConnectionRegistry } from '../core/connections/registry';
import { ClientVault } from '../core/client/identity';
import { clientCodec } from './client-app';
import { DesktopViews } from '../core/desktop-views';
import type { DesktopTicket } from '../shared/agent-desktop';
import type { DesktopViewEvent } from '../shared/desktop-view';
import { connectDesktop } from '../core/desktop-client';
import { DesktopTargets } from '../core/desktop-targets';
import { desktopViewStartSchema } from '../shared/desktop-view';
import { spawn } from 'node:child_process';
import { bundledAgentExecutable } from '../core/bundled-agent';
export async function registerAgent(
  handle: (name: string, fn: (...args: any[]) => any) => void,
  store: Store,
  provider: ClientProvider,
  registry: ConnectionRegistry,
  publish: (event: DesktopViewEvent) => void,
) {
  const directory = process.env.CSHELL_AGENT_DATA;
  const bundledDirectory = app.isPackaged
    ? join(process.resourcesPath, 'cagent')
    : join(app.getAppPath(), 'release', app.getVersion(), 'agent-win32-x64');
  const bundledAvailable = process.platform === 'win32' && process.arch === 'x64' &&
    await bundledAgentExecutable(bundledDirectory, app.getVersion()).then(() => true, () => false);
  const guard = () => {
    if (!pluginEnabled(store.plugins(), 'agent')) throw new Error('请先启用 cagent 扩展');
  };
  const activeTarget = (target: string) =>
    registry
      .activeTargets()
      .find((t) => t.sessionId === target && t.providerId === 'cshell.client');
  const targets = new DesktopTargets({ active: activeTarget, devices: () => provider.list() });
  const views = new DesktopViews({
    publish,
    onStopped: (id) => targets.release(id),
    authorize: (target) => {
      guard();
      if (target !== 'local') targets.resolve(target);
    },
    open: async (input) => {
      if (input.target === 'local') {
        const status = (await callAgent('client.status', undefined, directory)) as {
          deviceId: string;
        };
        const desktop = (await callAgent('desktop.status', undefined, directory)) as {
          config: { bindAddress: string };
        };
        const ticket = (await callAgent(
          'desktop.open',
          { control: input.control, quality: input.quality },
          directory,
        )) as DesktopTicket;
        const bind = desktop.config.bindAddress,
          host = bind === '0.0.0.0' ? '127.0.0.1' : bind === '::' ? '::1' : bind;
        return {
          ticket,
          host,
          identity: status.deviceId,
          local: true,
          close: () => callAgent('desktop.close', { id: ticket.id }, directory),
        };
      }
      const deviceId = targets.resolve(input.target);
      const device = provider.list().find((d) => d.deviceId === deviceId);
      if (!device) throw new Error('未找到已验证的 Agent');
      const ticket = (await provider.call(deviceId, {
        method: 'desktop.open',
        params: { control: input.control, quality: input.quality, transport: 'management' },
      })) as DesktopTicket;
      return {
        ticket,
        host: device.host,
        identity: device.deviceId,
        local: false,
        connect: async () => {
          const controller = new AbortController(),
            timer = setTimeout(() => controller.abort(), 15000);
          try {
            targets.resolve(input.target);
            const stream = await provider.openDesktopStream(deviceId, controller.signal);
            try {
              return await connectDesktop(ticket, {
                host: device.host,
                expectedHostIdentity: device.deviceId,
                stream,
              });
            } catch (error) {
              stream.destroy();
              throw error;
            }
          } finally {
            clearTimeout(timer);
          }
        },
        close: () => {
          const controller = new AbortController(),
            timer = setTimeout(() => controller.abort(), 2000);
          return provider
            .call(
              deviceId,
              { method: 'desktop.close', params: { id: ticket.id } },
              controller.signal,
            )
            .finally(() => clearTimeout(timer));
        },
      };
    },
  });
  const stopTarget = (target: string) =>
    Promise.allSettled(
      targets.stopTarget(target).map((id) => views.stop(id, 'Agent 连接已由用户关闭')),
    );
  const offDisconnect = provider.onExplicitDisconnect((target) => {
    void stopTarget(target);
  });
  handle('desktop:view-start', async (raw) => {
    guard();
    const input = desktopViewStartSchema.parse(raw);
    targets.bind(input.id, input.target);
    try {
      return await views.start(input);
    } catch (error) {
      targets.release(input.id);
      throw error;
    }
  });
  handle('desktop:view-stop', (id) => views.stop(id));
  handle('desktop:view-input', (id, value, generation) => views.input(id, value, generation));
  handle('desktop:view-release', (id, generation) => views.release(id, generation));
  handle('desktop:view-ack', (id, sequence, decoded, decodeMs, generation) =>
    views.ack(id, sequence, decoded, decodeMs, generation),
  );
  handle('desktop:view-quality', (id, value, generation) => views.quality(id, value, generation));
  handle('agent:targets', async () => {
    guard();
    let local: AgentTarget = {
      id: 'local',
      name: '本机 cagent',
      local: true,
      available: false,
      bundledApp: bundledAvailable,
      reason: 'Agent 未运行',
    };
    try {
      if (await discoverAgent(directory)) {
        await callAgent('client.status', undefined, directory);
        local = { ...local, available: true, reason: undefined };
      }
    } catch {
      local.reason = 'Agent 控制服务无法连接';
    }
    return [
      local,
      ...registry
        .activeTargets()
        .filter((t) => t.providerId === 'cshell.client')
        .map((t) => ({ id: t.sessionId, name: t.label, local: false, available: true })),
    ];
  });
  let launching = false;
  handle('agent:launch', async () => {
    guard();
    if (!bundledAvailable) throw new Error('当前安装包没有可用的内置 cagent，请下载独立安装包');
    if (launching) return;
    launching = true;
    try {
      const executable = await bundledAgentExecutable(bundledDirectory, app.getVersion());
      const child = spawn(executable, [], { cwd: bundledDirectory, detached: true, stdio: 'ignore', windowsHide: false });
      await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
      child.unref();
    } finally {
      setTimeout(() => { launching = false; }, 2000).unref();
    }
  });
  handle('agent:call', async (target, raw) => {
    guard();
    const call = agentCallSchema.parse(raw);
    if (call.method === 'desktop.open') throw new Error('请从远程桌面入口连接');
    if (target === 'local') return callAgent(call.method, call.params, directory);
    const active = registry
      .activeTargets()
      .find((t) => t.sessionId === target && t.providerId === 'cshell.client');
    if (!active) throw new Error('请选择仍在连接的 Agent');
    return provider.call(active.resourceId, call);
  });
  handle('agent:shells', (id) => provider.shells(z.string().uuid().parse(id)));
  handle('agent:import', async () => {
    guard();
    const legacy = new ClientVault(
      join(app.getPath('appData'), 'CShell Client', 'client'),
      clientCodec,
    );
    const records: Record<string, unknown> = {};
    for (const name of ['identity', 'access', 'peers', 'listener']) {
      const record = await legacy.read(name, z.unknown());
      if (record !== undefined) records[name] = record;
    }
    if (!records.identity) throw new Error('没有发现旧 Client 身份');
    records.peers ??= [];
    await callAgent('legacy.import', { ...records, confirm: true }, directory);
  });
  for (const name of ['status', 'access', 'info', 'start', 'stop', 'revoke'])
    handle('client:' + name, (params) => {
      guard();
      return callAgent('client.' + name, params, directory);
    });
  return {
    stopTarget,
    dispose: () => {
      offDisconnect();
      return views.dispose();
    },
  };
}
