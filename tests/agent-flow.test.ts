import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { ClientServer } from '../src/core/client/server';
import { ClientProvider } from '../src/core/client/provider';
import { ClientVault } from '../src/core/client/identity';
test('Agent coalesces rapid output acknowledgements, keeps terminal alive and does not flush after closure', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cshell-agent-flow-'));
  const codec = {
    encrypt: async (v: string) => Buffer.from(v).toString('base64'),
    decrypt: async (v: string) => Buffer.from(v, 'base64').toString(),
  };
  let acknowledged = 0,
    closed = 0,
    id = '',
    received = 0;
  const terminalId = randomUUID();
  const terminal = {
    id: 'test.terminal',
    version: '1.0.0',
    capabilities: [],
    configuration: z.unknown(),
    connect: async () => terminalId,
    disconnect: () => {},
    resolve: () => ({
      target: {
        providerId: 'test.terminal',
        resourceId: terminalId,
        identity: terminalId,
        label: 'test',
      },
      tools: [],
      terminal: {
        input: () => {
          for (let i = 0; i < 1500; i++)
            server.event({ type: 'data', sessionId: terminalId, data: 'x' });
        },
        resize: () => {},
        acknowledge: (n: number) => {
          acknowledged += n;
        },
      },
    }),
  };
  const server = new ClientServer(new ClientVault(join(directory, 'server'), codec), terminal);
  const provider = new ClientProvider(
    new ClientVault(join(directory, 'client'), codec),
    (event) => {
      if (event.type === 'data') {
        received += event.data.length;
        provider.resolve(id).terminal!.acknowledge(event.data.length);
      } else if (event.type === 'closed') closed++;
    },
  );
  const free = createServer();
  await new Promise<void>((r) => free.listen(0, '127.0.0.1', r));
  const port = (free.address() as { port: number }).port;
  await new Promise<void>((r) => free.close(() => r()));
  try {
    await server.load();
    await server.setAccess({ password: 'flow-test-password', shells: ['cmd'] });
    await server.start({ bind: '127.0.0.1', port });
    await provider.load();
    const info = await provider.probe({ host: '127.0.0.1', port });
    await provider.pairPassword(info, 'flow-test-password');
    id = await provider.connect(
      { deviceId: info.deviceId, shell: 'cmd' },
      undefined,
      new AbortController().signal,
    );
    const connection = provider.resolve(id);
    connection.terminal!.input('test');
    for (let i = 0; i < 100 && acknowledged < 1500; i++) await delay(20);
    assert.equal(received, 1500);
    assert.equal(acknowledged, 1500);
    assert.equal(closed, 0);
    assert.equal(provider.resolve(id), connection);
    provider.disconnect(id);
    await delay(50);
    connection.terminal!.acknowledge(100);
    await delay(50);
    assert.equal(acknowledged, 1500);
  } finally {
    provider.dispose();
    await server.stop();
    await rm(directory, { recursive: true, force: true, maxRetries: 5 });
  }
});
