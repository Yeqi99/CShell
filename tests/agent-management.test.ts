import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { connect } from 'node:tls';
import { z } from 'zod';
import { createAgentRuntime } from '../src/agent/runtime';
import { agentCodec } from '../src/agent/storage';
import type { AgentTerminalProvider } from '../src/core/agent-terminal';
import { ClientProvider } from '../src/core/client/provider';
import { ClientVault, type ClientIdentity } from '../src/core/client/identity';
import { ConnectionRegistry } from '../src/core/connections/registry';
import type { ProviderConnection } from '../src/core/connections/contracts';
import { frames, send } from '../src/core/client/wire';
import { hostingConfigSchema, type HostingStatus } from '../src/shared/agent-hosting';
import { agentMethodOutputs } from '../src/core/api/agent-outputs';

const codec = {
  encrypt: async (v: string) => Buffer.from(v).toString('base64'),
  decrypt: async (v: string) => Buffer.from(v, 'base64').toString(),
};

test('Agent applications allow authenticated administration and preserve explicit opt-out', async () => {
  const f = await fixture();
  try {
    const { device } = await f.pair({ allowManage: true });
    const activity=await f.runtime.dispatch('update.status',{}) as {coordination:{activity:{terminals:number}}};
    assert.equal(activity.coordination.activity.terminals,1);
    const initial = await f.provider.call(device.deviceId, { method: 'applications.list' }) as { enabled: boolean };
    assert.equal(initial.enabled, true);
    await f.provider.call(device.deviceId, { method: 'applications.configure', params: { enabled: false } });
    await assert.rejects(f.provider.call(device.deviceId, { method: 'applications.plan', params: { app: 'git' } }), /denied|未授权|CAgent 请求失败：请检查远端权限和服务状态/);
    const owner = f.runtime.server.status().peers[0].fingerprint;
    await f.runtime.dispatch('applications.configure', { enabled: true, controllers: [owner] });
    const granted = await f.provider.call(device.deviceId, { method: 'applications.list' }) as { enabled: boolean };
    assert.equal(granted.enabled, true);
    await f.runtime.dispatch('applications.configure', { enabled: false });
    await assert.rejects(f.provider.call(device.deviceId, { method: 'applications.plan', params: { app: 'git' } }), /denied|未授权|CAgent 请求失败：请检查远端权限和服务状态/);
  } finally { await f.close(); }
});
const shell = process.platform === 'win32' ? 'cmd' : 'bash';
test('browser TLS transport can write while a read waits on the same authenticated channel', {timeout:15000}, async()=>{
  const f=await fixture();
  const echo=createServer(socket=>socket.pipe(socket));
  await new Promise<void>(resolve=>echo.listen(0,'127.0.0.1',resolve));
  let transport:Awaited<ReturnType<ClientProvider['browserTransport']>>|undefined;
  try {
    const {device}=await f.pair({allowHttp:true,allowManage:true});
    transport=await f.provider.browserTransport(device.deviceId);
    const channel=await transport.call('browser.open',{host:'127.0.0.1',port:(echo.address() as any).port}) as {id:string};
    const pending=transport.call('browser.read',channel);
    await transport.call('browser.write',{id:channel.id,sequence:0,data:Buffer.from('concurrent browser request').toString('base64')});
    let timer:ReturnType<typeof setTimeout>|undefined;
    try {
      const result=await Promise.race([pending,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('browser read blocked its write')),3000)})]) as {data:string};
      assert.equal(Buffer.from(result.data,'base64').toString(),'concurrent browser request');
    } finally {clearTimeout(timer);}
    await transport.call('browser.close',channel);
  } finally {transport?.close();await f.close();await new Promise<void>(resolve=>echo.close(()=>resolve()));}
});
async function freePort() {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  const port = (s.address() as { port: number }).port;
  await new Promise<void>((r) => s.close(() => r()));
  return port;
}
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'cshell-agent-management-'));
  const sessions = new Map<string, ProviderConnection>();
  let updateGuard=()=>false;
  const terminal = {
    id: 'test.terminal',
    version: '1.0.0',
    capabilities: ['terminal.interactive'],
    configuration: z.unknown(),
    get activity(){return sessions.size;},
    setUpdateGuard(guard:()=>boolean){updateGuard=guard;},
    setManagedEnvironment(_values: Record<string,string>) {},
    shells: async () => [
      { id: shell, label: shell, executable: 'fixture', args: [], environment: 'host' },
    ],
    connect: async () => {
      if(updateGuard())throw new Error('CAgent 正在完成更新，请稍后重试');
      const id = randomUUID();
      sessions.set(id, {
        target: { providerId: 'test.terminal', resourceId: id, identity: id, label: shell },
        tools: [],
        terminal: { input() {}, resize() {}, acknowledge() {} },
      });
      return id;
    },
    resolve: (id: string) => {
      const session = sessions.get(id);
      if (!session) throw new Error('Fixture terminal closed');
      return session;
    },
    disconnect: (id: string) => {
      sessions.delete(id);
    },
    dispose: () => sessions.clear(),
  } as unknown as AgentTerminalProvider;
  const runtime = await createAgentRuntime({ directory: join(directory, 'agent'), terminal });
  const vault = new ClientVault(join(directory, 'controller'), codec);
  const provider = new ClientProvider(vault, () => {});
  await provider.load();
  const port = await freePort();
  async function pair(grants: Record<string, boolean>) {
    await runtime.server.stop();
    await runtime.server.setAccess({
      password: 'protocol-management-test-2026',
      shells: [shell],
      ...grants,
    });
    await runtime.server.start({ bind: '127.0.0.1', port });
    const info = await provider.probe({ host: '127.0.0.1', port });
    const device = await provider.pairPassword(info, 'protocol-management-test-2026');
    const session = await provider.connect(
      { deviceId: device.deviceId, shell },
      undefined,
      new AbortController().signal,
    );
    return { device, session };
  }
  return {
    directory,
    runtime,
    provider,
    vault,
    port,
    pair,
    async close() {
      provider.dispose();
      await runtime.close();
      await rm(directory, { recursive: true, force: true, maxRetries: 5 });
    },
  };
}

// Bypass controller-side capability checks: the authenticated Agent server must reject independently.
test('Agent exported status results match concrete schemas and omit reverse relay secrets', async () => {
  const f = await fixture();
  try {
    const { session } = await f.pair({ allowManage: true, allowRelay: true, allowHosting: true });
    const connection = f.provider.resolve(session);
    for (const method of ['client.status', 'agent.shells', 'agent.logs', 'wsl.status', 'relay.status', 'relay.reverse.status', 'hosting.list']) {
      const tool = connection.tools.find((t) => t.name === (method.startsWith('relay.') ? 'agent_relay' : method.startsWith('hosting.') ? 'agent_hosting' : 'agent_manage'))!;
      const result = JSON.parse(await tool.invoke({ method }, new AbortController().signal));
      assert.ok(agentMethodOutputs[method].safeParse(result).success, method);
      assert.ok(tool.jsonOutput?.safeParse(result).success, method);
      if (method === 'relay.reverse.status') assert.equal('credential' in (result.config.relay ?? {}), false);
    }
    const relayTool = connection.tools.find((t) => t.name === 'agent_relay')!;
    const signal = new AbortController().signal;
    const before = JSON.parse(await relayTool.invoke({ method: 'relay.status' }, signal));
    const draft = { ...before.config, maxConnections: 9, expectedRevision: before.revision };
    const updated = JSON.parse(await relayTool.invoke({ method: 'relay.configure', params: draft }, signal));
    assert.notEqual(updated.revision, before.revision);
    await assert.rejects(relayTool.invoke({ method: 'relay.configure', params: { ...draft, maxConnections: 10 } }, signal));
    assert.equal(JSON.parse(await relayTool.invoke({ method: 'relay.status' }, signal)).config.maxConnections, 9);
  } finally { await f.close(); }
});

async function rawManage(
  port: number,
  identity: ClientIdentity,
  method: string,
  params?: unknown,
): Promise<unknown> {
  const socket = connect({
    host: '127.0.0.1',
    port,
    key: identity.key,
    cert: identity.certificate,
    rejectUnauthorized: false,
    minVersion: 'TLSv1.3',
  });
  socket.on('error', () => {});
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once('secureConnect', resolve);
      socket.once('error', reject);
    });
    const pending = new Map<
      string,
      { resolve: (v: unknown) => void; reject: (e: Error) => void }
    >();
    frames(socket, (value) => {
      const result = value as { id: string; result?: unknown; error?: string };
      const p = pending.get(result.id);
      if (!p) return;
      pending.delete(result.id);
      if (result.error) p.reject(new Error(result.error));
      else p.resolve(result.result);
    });
    const request = (op: string, payload: unknown) =>
      new Promise<unknown>((resolve, reject) => {
        const id = randomUUID();
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error('Protocol fixture timed out'));
        }, 5000);
        pending.set(id, {
          resolve: (v) => {
            clearTimeout(timer);
            resolve(v);
          },
          reject: (e) => {
            clearTimeout(timer);
            reject(e);
          },
        });
        send(socket, { id, op, payload });
      });
    await request('auth', { name: 'Management test' });
    return await request('manage', { method, params });
  } finally {
    socket.destroy();
  }
}

test('Agent native management, hosting and relay grants are independent on provider and TLS server', async () => {
  const f = await fixture();
  try {
    for (const [grant, allowed, denied, toolName] of [
      ['allowManage', 'client.status', ['hosting.list', 'relay.status'], 'agent_manage'],
      ['allowHosting', 'hosting.list', ['client.status', 'relay.status'], 'agent_hosting'],
      ['allowRelay', 'relay.status', ['client.status', 'hosting.list'], 'agent_relay'],
    ] as const) {
      const { device, session } = await f.pair({ allowHttp:false,allowManage:false,allowHosting:false,allowRelay:false,[grant]: true });
      const identity = await f.vault.identity();
      assert.ok(await f.provider.call(device.deviceId, { method: allowed }));
      assert.ok(await rawManage(f.port, identity, allowed));
      const registry = new ConnectionRegistry(() => ({
        id: device.deviceId,
        profileId: device.deviceId,
        group: 'fixture',
      }));
      registry.register(f.provider);
      registry.bind(session, f.provider.id);
      assert.deepEqual(
        registry
          .tools(session)
          .filter((t) => t.capability.startsWith('agent.'))
          .map((t) => t.name),
        [toolName],
      );
      const tool = registry.prepare(session, toolName, { method: allowed });
      assert.equal(tool.needsReview, false);
      await tool.execute(() => true, new AbortController().signal);
      const revoked = registry.prepare(session, toolName, { method: allowed });
      await assert.rejects(
        revoked.execute(() => false, new AbortController().signal),
        /scope revoked/,
      );
      for (const method of denied) {
        await assert.rejects(f.provider.call(device.deviceId, { method }), /未授予/);
        await assert.rejects(rawManage(f.port, identity, method), /denied|CAgent 请求失败：请检查远端权限和服务状态/);
      }
      // A hosting grant cannot edit listeners/passwords; a relay grant cannot publish services.
      if (grant !== 'allowManage')
        await assert.rejects(
          rawManage(f.port, identity, 'client.access', {
            password: 'changed-password-2026',
            shells: [shell],
            allowManage: true,
          }),
          /denied|CAgent 请求失败：请检查远端权限和服务状态/,
        );
      if (grant !== 'allowHosting')
        await assert.rejects(
          rawManage(f.port, identity, 'hosting.save', {
            config: hostingConfigSchema.parse({
              id: randomUUID(),
              name: 'denied',
              routes: [{ method: 'GET', path: '/' }],
            }),
          }),
          /denied|CAgent 请求失败：请检查远端权限和服务状态/,
        );
      f.provider.disconnect(session);
      await f.runtime.server.revoke(f.runtime.server.status().peers[0].fingerprint);
    }
  } finally {
    await f.close();
  }
});

test('Agent legacy peers retain identity but gain no new management or hosting grants on load', async () => {
  const f = await fixture();
  try {
    const { device, session } = await f.pair({
      allowManage: true,
      allowHosting: true,
      allowRelay: true,
    });
    f.provider.disconnect(session);
    await f.runtime.server.stop();
    const vault = new ClientVault(
      join(f.directory, 'agent'),
      await agentCodec(join(f.directory, 'agent')),
    );
    const identityBefore = await vault.identity();
    const peers = await vault.read(
      'peers',
      z.array(z.object({ fingerprint: z.string(), name: z.string(), shells: z.array(z.string()) })),
    );
    assert.ok(peers?.length);
    await vault.write('peers', peers!);
    await vault.flush();
    await f.runtime.server.load();
    await f.runtime.server.start({ bind: '127.0.0.1', port: f.port });
    assert.equal(f.runtime.server.status().deviceId, identityBefore.id);
    const connected = await f.provider.connect(
      { deviceId: device.deviceId, shell },
      undefined,
      new AbortController().signal,
    );
    assert.deepEqual(
      f.provider.resolve(connected).tools.filter((t) => t.capability.startsWith('agent.')),
      [],
    );
    for (const method of ['client.status', 'hosting.list', 'relay.status'] as const) {
      await assert.rejects(rawManage(f.port, await f.vault.identity(), method), /denied|CAgent 请求失败：请检查远端权限和服务状态/);
    }
    assert.equal(f.provider.list()[0].deviceId, device.deviceId);
  } finally {
    await f.close();
  }
});

test('Agent hosting AI tools bind reviewed config and revision, and backend denies stale direct starts', async () => {
  const f = await fixture();
  try {
    const { device, session } = await f.pair({ allowHosting: true });
    const registry = new ConnectionRegistry(() => ({
      id: device.deviceId,
      profileId: device.deviceId,
      group: 'fixture',
    }));
    registry.register(f.provider);
    registry.bind(session, f.provider.id);
    const input = hostingConfigSchema.parse({
      id: randomUUID(),
      name: 'reviewed HTTP',
      routes: [{ method: 'GET', path: '/', body: 'first' }],
    });
    const saved = (await f.provider.call(device.deviceId, {
      method: 'hosting.save',
      params: { config: input },
    })) as HostingStatus;
    const invocation = () =>
      registry.prepare(session, 'agent_hosting', {
        method: 'hosting.start',
        params: {
          id: input.id,
          expectedRevision: saved.config.revision,
          allowCode: false,
          reviewedConfig: saved.config,
        },
      });
    const stale = invocation();
    assert.equal(stale.needsReview, true);
    const updated = (await f.provider.call(device.deviceId, {
      method: 'hosting.save',
      params: {
        config: { ...saved.config, routes: [{ ...saved.config.routes[0], body: 'changed' }] },
      },
    })) as HostingStatus;
    await assert.rejects(
      stale.execute(() => true, new AbortController().signal),
      /配置已改变/,
    );
    await assert.rejects(
      rawManage(f.port, await f.vault.identity(), 'hosting.start', {
        id: input.id,
        expectedRevision: saved.config.revision,
      }),
      /denied|CAgent 请求失败：请检查远端权限和服务状态/,
    );
    const tampered = registry.prepare(session, 'agent_hosting', {
      method: 'hosting.start',
      params: {
        id: input.id,
        expectedRevision: updated.config.revision,
        allowCode: false,
        reviewedConfig: { ...updated.config, host: '0.0.0.0', allowExternal: true },
      },
    });
    await assert.rejects(
      tampered.execute(() => true, new AbortController().signal),
      /配置已改变/,
    );
    const current = registry.prepare(session, 'agent_hosting', {
      method: 'hosting.start',
      params: {
        id: input.id,
        expectedRevision: updated.config.revision,
        allowCode: false,
        reviewedConfig: updated.config,
      },
    });
    const started = JSON.parse(
      await current.execute(() => true, new AbortController().signal),
    ) as HostingStatus;
    assert.equal(await (await fetch(`http://127.0.0.1:${started.actualPort}/`)).text(), 'changed');
    await assert.rejects(
      current.execute(() => true, new AbortController().signal),
      /already consumed/,
    );
    await f.provider.call(device.deviceId, { method: 'hosting.stop', params: { id: input.id } });
  } finally {
    await f.close();
  }
});

test('Agent provider reassembles bounded large management results across protocol frames', async () => {
  const f = await fixture();
  try {
    const { device, session } = await f.pair({ allowHosting: true });
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const input = hostingConfigSchema.parse({
        id: randomUUID(),
        name: `large-${i}`,
        routes: [{ method: 'GET', path: '/', body: '中文'.repeat(8000) }],
      });
      ids.push(input.id);
      await f.provider.call(device.deviceId, { method: 'hosting.save', params: { config: input } });
    }
    const services = (await f.provider.call(device.deviceId, {
      method: 'hosting.list',
    })) as HostingStatus[];
    assert.ok(Buffer.byteLength(JSON.stringify(services)) > 131072);
    assert.deepEqual(
      services.map((s) => s.config.id),
      ids,
    );
    assert.ok(services.every((s) => s.config.routes[0].body === '中文'.repeat(8000)));
    assert.ok(services.every((s) => !s.running));
    const tool = f.provider.resolve(session).tools.find((t) => t.name === 'agent_hosting')!;
    const toolResult = JSON.parse(
      await tool.invoke({ method: 'hosting.list' }, new AbortController().signal),
    ) as HostingStatus[];
    assert.deepEqual(
      toolResult.map((s) => s.config.id),
      ids,
      'tool path must preserve complete JSON across frames',
    );
    assert.ok(toolResult.every((s) => s.config.routes[0].body === '中文'.repeat(8000)));
    const burst=await Promise.all(Array.from({length:16},()=>f.provider.call(device.deviceId,{method:'hosting.list'})));
    assert.ok(burst.every(value=>Array.isArray(value)&&value.length===5),'parallel panels must not exceed the server channel limit');
  } finally {
    await f.close();
  }
});

test('Agent revocation during audit persistence prevents a queued management mutation', async () => {
  const f = await fixture();
  try {
    const { device } = await f.pair({ allowHosting: true });
    const server = f.runtime.server as unknown as {
      record: (action: string, peer: string) => Promise<unknown>;
    };
    const original = server.record.bind(server);
    let release!: () => void, entered!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const reached = new Promise<void>((resolve) => {
      entered = resolve;
    });
    server.record = async (action, peer) => {
      if (action === 'hosting.save') {
        entered();
        await held;
      }
      return original(action, peer);
    };
    try {
      const input = hostingConfigSchema.parse({
        id: randomUUID(),
        name: 'must not be created',
        routes: [{ method: 'GET', path: '/' }],
      });
      const result = f.provider
        .call(device.deviceId, { method: 'hosting.save', params: { config: input } })
        .then(
          () => 'unexpected success',
          (e) => String(e),
        );
      await reached;
      await f.runtime.server.revoke(f.runtime.server.status().peers[0].fingerprint);
      release();
      assert.match(await result, /disconnect|closed|denied/i);
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.deepEqual(await f.runtime.dispatch('hosting.list', undefined), []);
    } finally {
      release();
      server.record = original;
    }
  } finally {
    await f.close();
  }
});

