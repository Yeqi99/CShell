import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { ConnectionRegistry } from '../src/core/connections/registry';
import type { ConnectionProvider, ProviderConnection } from '../src/core/connections/contracts';
import { createSshConnections } from '../src/core/connections/ssh-provider';
import { SshService } from '../src/core/ssh';
import { fixture } from './fixture';
import { randomUUID } from 'node:crypto';
import { ConnectionManager } from '../src/core/connections/manager';

test('connection ownership is established before initial output and rolled back on rejected readiness', async () => {
  const registry = new ConnectionRegistry(() => ({ id: 'target', group: '' }));
  const manager = new ConnectionManager(registry);
  const live = new Set<string>();
  let owner: string | undefined;
  let delivered = 0;
  manager.register({
    id: 'test.early',
    version: '1.0.0',
    capabilities: [],
    configuration: z.object({}),
    resolve: (id) => {
      if (!live.has(id)) throw new Error('Closed');
      return {
        target: {
          providerId: 'test.early',
          resourceId: 'target',
          identity: 'identity',
          label: 'Early',
        },
        tools: [],
      };
    },
    connect: async (_configuration, _credentials, _signal, ready) => {
      const id = randomUUID();
      live.add(id);
      ready?.(id);
      assert.equal(owner, id, 'initial output must already have an owner');
      assert.equal(registry.describe(id).identity, 'identity');
      delivered++;
      return id;
    },
    disconnect: (id) => {
      live.delete(id);
    },
  });
  const id = await manager.connect('test.early', {}, undefined, undefined, (id) => {
    owner = id;
  });
  assert.equal(delivered, 1);
  await manager.disconnect(id);
  await assert.rejects(
    manager.connect('test.early', {}, undefined, undefined, () => {
      throw new Error('Authorization changed');
    }),
    /Authorization changed/,
  );
  assert.equal(live.size, 0);
  assert.equal(delivered, 1, 'rejected readiness must prevent output delivery');
  manager.unregister('test.early');
});

test('declared JSON output contracts are enforced without replaying an executed operation', async () => {
  let count = 0;
  const connection: ProviderConnection = {
    target: {
      providerId: 'test.typed',
      resourceId: 'target',
      identity: 'identity',
      label: 'Typed',
    },
    tools: [
      {
        name: 'write',
        capability: 'files.create',
        description: 'Typed operation',
        input: z.object({}).strict(),
        jsonOutput: z.object({ bytes: z.number().int() }).strict(),
        needsReview: () => true,
        invoke: async () => {
          count++;
          return '{"bytes":"invalid","secret":"hidden"}';
        },
      },
    ],
  };
  const registry = new ConnectionRegistry(() => ({ id: 'target', group: '' }));
  registry.register({
    id: 'test.typed',
    version: '1.0.0',
    capabilities: ['files.create'],
    resolve: () => connection,
  });
  registry.bind('session', 'test.typed');
  const call = registry.prepare('session', 'write', {});
  await assert.rejects(
    call.execute(() => true, new AbortController().signal),
    (error: unknown) => {
      assert.equal((error as { code: string }).code, 'OUTCOME_UNKNOWN');
      assert.ok(!String(error).includes('hidden'));
      return true;
    },
  );
  await assert.rejects(
    call.execute(() => true, new AbortController().signal),
    /consumed/,
  );
  assert.equal(count, 1);
});

test('provider dispatch is transport-independent, scoped, single-use and bound to connection generation', async () => {
  let alive = true,
    authorized = true,
    received = '',
    count = 0;
  const make = (): ProviderConnection => ({
    target: {
      providerId: 'fixture.client',
      resourceId: 'device-a',
      identity: 'public-device-key',
      label: 'Test client',
    },
    tools: [
      {
        name: 'execute_command',
        description: 'Fixture client command',
        capability: 'commands.execute',
        input: z.object({ command: z.string() }).strict(),
        needsReview: () => true,
        invoke: async (input) => {
          received = (input as { command: string }).command;
          count++;
          return 'ok';
        },
      },
    ],
  });
  let connection = make();
  const provider: ConnectionProvider = {
    id: 'fixture.client',
    version: '1.0.0',
    capabilities: ['commands.execute'],
    resolve: () => {
      if (!alive) throw new Error('Disconnected');
      return connection;
    },
  };
  const registry = new ConnectionRegistry((t) =>
    authorized ? { id: t.resourceId, group: 'Devices' } : undefined,
  );
  registry.register(provider);
  registry.bind('connection-a', provider.id);
  const args = { command: 'first' },
    call = registry.prepare('connection-a', 'execute_command', args);
  args.command = 'changed';
  assert.equal(await call.execute(() => authorized, new AbortController().signal), 'ok');
  assert.equal(received, 'first');
  await assert.rejects(
    call.execute(() => true, new AbortController().signal),
    /consumed/,
  );
  const revoked = registry.prepare('connection-a', 'execute_command', { command: 'blocked' });
  authorized = false;
  await assert.rejects(
    revoked.execute(() => !!registry.scope('connection-a'), new AbortController().signal),
    /revoked/,
  );
  authorized = true;
  const stale = registry.prepare('connection-a', 'execute_command', { command: 'stale' });
  connection = make();
  await assert.rejects(
    stale.execute(() => true, new AbortController().signal),
    /changed/,
  );
  const removed = registry.prepare('connection-a', 'execute_command', { command: 'removed' });
  registry.unregister(provider.id);
  await assert.rejects(
    removed.execute(() => true, new AbortController().signal),
    /provider/,
  );
  registry.register(provider);
  const rebound = registry.prepare('connection-a', 'execute_command', { command: 'rebound' });
  registry.unbind('connection-a');
  await assert.rejects(
    rebound.execute(() => true, new AbortController().signal),
    /provider/,
  );
  assert.throws(() => registry.prepare('connection-a', 'unknown', {}));
  registry.bind('connection-a', provider.id);
  assert.equal(registry.describe('connection-a').providerId, provider.id);
  registry.bind('connection-b', provider.id);
  const disconnected = registry.prepare('connection-b', 'execute_command', { command: 'lost' });
  alive = false;
  await assert.rejects(
    disconnected.execute(() => true, new AbortController().signal),
    /Disconnected/,
  );
  assert.equal(count, 1);
});
test('built-in SSH provider exposes real tools, validates inputs and revokes edited endpoint scope', async () => {
  const remote = await fixture(),
    ssh = new SshService(
      () => {},
      async () => true,
    );
  const profile = {
    id: randomUUID(),
    name: 'SSH test',
    host: '127.0.0.1',
    port: remote.port,
    username: 'tester',
    auth: 'password' as const,
    group: 'Dev',
    favorite: false,
  };
  try {
    const { sessionId } = await ssh.connect(profile, { password: remote.password });
    const registry = createSshConnections(ssh, () => [profile]);
    assert.equal(registry.describe(sessionId).providerId, 'cshell.ssh');
    for (const tool of registry.tools(sessionId)) {
      assert.equal(z.toJSONSchema(tool.input, { io: 'input' }).type, 'object');
      for (const example of tool.examples ?? [])
        assert.equal(tool.input.safeParse(example.input).success, true, `Invalid example for ${tool.name}`);
    }
    assert.throws(() =>
      registry.prepare(sessionId, 'execute_command', { command: 'pwd', unexpected: true }),
    );
    const result = await registry
      .prepare(sessionId, 'execute_command', { command: 'pwd' })
      .execute(() => !!registry.scope(sessionId), new AbortController().signal);
    assert.match(result, /__CPU__/);
    const listed = await registry
      .prepare(sessionId, 'list_files', { path: '.' })
      .execute(() => true, new AbortController().signal);
    assert.ok(Array.isArray(JSON.parse(listed).entries));
    const prepared = registry.prepare(sessionId, 'execute_command', { command: 'pwd' });
    profile.host = 'changed.example';
    assert.equal(registry.scope(sessionId), undefined);
    await assert.rejects(
      prepared.execute(() => !!registry.scope(sessionId), new AbortController().signal),
      /revoked/,
    );
    ssh.disconnect(sessionId);
    assert.throws(() => registry.tools(sessionId), /not connected/);
  } finally {
    ssh.dispose();
    await remote.close();
  }
});
