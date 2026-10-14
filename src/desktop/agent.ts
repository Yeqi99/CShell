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
export async function registerAgent(
  handle: (name: string, fn: (...args: any[]) => any) => void,
  store: Store,
  provider: ClientProvider,
  registry: ConnectionRegistry,
) {
  const directory = process.env.CSHELL_AGENT_DATA;
  const guard = () => {
    if (!pluginEnabled(store.plugins(), 'agent')) throw new Error('请先启用 CShell Agent 扩展');
  };
  handle('agent:targets', async () => {
    guard();
    let local: AgentTarget = {
      id: 'local',
      name: '本机 Agent',
      local: true,
      available: false,
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
  handle('agent:call', async (target, raw) => {
    guard();
    const call = agentCallSchema.parse(raw);
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
  return { dispose: () => {} };
}
