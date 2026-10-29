import {pingHost} from '../core/icmp-ping';
import { z } from 'zod';
import { probeNetwork } from '../core/network-probe';
import { probeSshNetwork } from '../core/ssh-network-probe';
import type { Store } from '../core/store';
import type { SshService } from '../core/ssh';
import type { ClientProvider } from '../core/client/provider';
import type { ConnectionRegistry } from '../core/connections/registry';
import { networkProbeResultSchema } from '../shared/network-probe';

export function registerNetworkDiagnostics(handle: (name: string, fn: (...args: any[]) => any) => void, store: Store, ssh: SshService, client: ClientProvider, registry: ConnectionRegistry) {
  const pendingPing=new Set<string>();
  handle('network:ping',async raw=>{
    const input=z.object({profileId:z.string().uuid().optional(),sessionId:z.string().min(1).max(100).optional()}).strict().parse(raw);
    if(Boolean(input.profileId)===Boolean(input.sessionId))throw Error('请选择一个目标');
    const profile=input.sessionId?ssh.get(input.sessionId).profile:store.profile(input.profileId!);
    if(profile.protocol==='http')throw Error('请选择机器连接');
    const host=profile.host;if(pendingPing.size>=2||pendingPing.has(host))throw Error('Ping 正在进行');
    pendingPing.add(host);try{return await pingHost(host)}finally{pendingPing.delete(host)}
  });
  const active = new Map<string, AbortController>();
  const sources = () => [
    { id: 'local', name: '本机 CShell' },
    ...registry.activeTargets().filter(t => t.providerId === 'cshell.ssh').map(t => ({ id: 'ssh:' + t.sessionId, name: t.label + ' · SSH' })),
    ...client.list().map(d => ({ id: 'agent:' + d.deviceId, name: d.name + ' · CAgent' })),
  ];
  handle('network:diagnostics', () => ({ sources: sources(), targets: store.snapshot().profiles.filter(p => p.protocol !== 'http').map(p => ({ id: p.id, name: p.name, host: p.host, port: p.port })) }));
  handle('network:probe', async raw => {
    const input = z.object({ id: z.string().uuid(), source: z.string().max(80), target: z.string().uuid() }).strict().parse(raw);
    if (active.size >= 2 || active.has(input.id)) throw new Error('已有网络检测正在进行');
    if (!sources().some(s => s.id === input.source)) throw new Error('来源连接已关闭或不可用');
    const target = store.profile(input.target);
    if (target.protocol === 'http') throw new Error('请选择机器连接');
    const params = { host: target.host, port: target.port, samples: 5, timeoutMs: 2000 };
    const controller = new AbortController(); active.set(input.id, controller);
    try {
      const value = input.source === 'local' ? await probeNetwork(params, controller.signal)
        : input.source.startsWith('ssh:') ? await probeSshNetwork(ssh, input.source.slice(4), params, controller.signal)
        : await client.call(input.source.slice(6), { method: 'network.probe', params }, controller.signal);
      controller.signal.throwIfAborted();
      const result = networkProbeResultSchema.parse(value);
      if (result.host !== params.host || result.port !== params.port || result.samples.length !== params.samples) throw new Error('来源机器返回了不匹配的检测结果');
      return result;
    } finally { active.delete(input.id); }
  });
  handle('network:probe-cancel', id => { active.get(z.string().uuid().parse(id))?.abort(new Error('已取消网络检测')); });
  return () => { for (const controller of active.values()) controller.abort(new Error('工作区已关闭')); active.clear(); };
}
