import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { ConnectionManager, type ManagedProvider } from '../src/core/connections/manager';
import { ConnectionRegistry } from '../src/core/connections/registry';
import { providerContributionSchema } from '../src/shared/providers';
test('provider contributions cannot publish duplicate tools or undeclared capabilities', () => {
  const manifest = {
    protocol: 1,
    id: 'example.client',
    version: '1.0.0',
    hostApi: 1,
    configuration: { type: 'object' },
    secretFields: ['token'],
    capabilities: ['files.read'],
    tools: [
      {
        name: 'read_file',
        inputSchema: { type: 'object' },
        capability: 'files.read',
        risk: 'read',
      },
    ],
    views: [],
  };
  assert.equal(providerContributionSchema.parse(manifest).id, 'example.client');
  assert.throws(() =>
    providerContributionSchema.parse({
      ...manifest,
      tools: [...manifest.tools, ...manifest.tools],
    }),
  );
  assert.throws(() => providerContributionSchema.parse({ ...manifest, capabilities: [] }));
});
test('manager validates configuration, owns lifecycle and revokes tools without transport knowledge', async () => {
  const registry = new ConnectionRegistry(() => ({ id: 'resource', group: 'test' }));
  const manager = new ConnectionManager(registry);
  let closed = 0,
    alive = false;
  const connection = {
    target: {
      providerId: 'fixture.client',
      resourceId: 'resource',
      identity: 'key',
      label: 'Device',
    },
    tools: [],
  };
  const provider: ManagedProvider = {
    id: 'fixture.client',
    version: '1.0.0',
    capabilities: [],
    configuration: z.object({ address: z.string() }).strict(),
    connect: async () => {
      alive = true;
      return 'session';
    },
    disconnect: () => {
      alive = false;
      closed++;
    },
    resolve: () => {
      if (!alive) throw Error('closed');
      return connection;
    },
  };
  manager.register(provider);
  await assert.rejects(manager.connect(provider.id, { address: 42 }, {}));
  const id = await manager.connect(provider.id, { address: 'fixture' }, {});
  assert.equal(registry.describe(id).resourceId, 'resource');
  assert.throws(() => manager.unregister(provider.id));
  await manager.disconnect(id);
  assert.equal(closed, 1);
  assert.throws(() => registry.describe(id));
  const controller = new AbortController();
  provider.connect = async () => {
    alive = true;
    controller.abort();
    return 'aborted';
  };
  await assert.rejects(manager.connect(provider.id, { address: 'fixture' }, {}, controller.signal));
  assert.equal(closed, 2);
  manager.unregister(provider.id);
  assert.equal(manager.list().length, 0);
});
