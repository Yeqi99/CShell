import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ClientVault, fingerprint } from '../src/core/client/identity';
import { ClientServer } from '../src/core/client/server';
import { ClientProvider } from '../src/core/client/provider';
import type { ManagedProvider } from '../src/core/connections/manager';
import type { SessionEvent } from '../src/shared/contracts';
async function freePort() {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  const port = (s.address() as any).port;
  await new Promise<void>((r) => s.close(() => r()));
  return port;
}
const codec = {
  encrypt: async (value: string) => Buffer.from(value).toString('base64'),
  decrypt: async (value: string) => Buffer.from(value, 'base64').toString(),
};
test('Client authenticates mutual TLS, consumes invitations, scopes shells, revokes live terminals and persists trust', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cshell-client-protocol-'));
  const sessions = new Set<string>();
  let server: ClientServer;
  const input: string[] = [];
  const terminal: ManagedProvider = {
    id: 'test.terminal',
    version: '1.0.0',
    capabilities: ['terminal.interactive'],
    configuration: z.enum(['cmd', 'powershell']),
    async connect() {
      const id = randomUUID();
      sessions.add(id);
      return id;
    },
    disconnect(id) {
      sessions.delete(id);
    },
    resolve(id) {
      assert.ok(sessions.has(id));
      return {
        target: { providerId: 'test.terminal', resourceId: id, identity: id, label: id },
        tools: [],
        terminal: {
          input(data) {
            input.push(data);
            server.event({ type: 'data', sessionId: id, data });
          },
          resize() {},
          acknowledge() {},
        },
      };
    },
  };
  server = new ClientServer(new ClientVault(join(dir, 'server'), codec), terminal);
  await server.load();
  const events: SessionEvent[] = [];
  const client = new ClientProvider(new ClientVault(join(dir, 'controller'), codec), (e) =>
    events.push(e),
  );
  await client.load();
  const stranger = new ClientProvider(new ClientVault(join(dir, 'stranger'), codec), () => {});
  await stranger.load();
  try {
    assert.equal(server.status().running, false);
    const port = await freePort();
    await server.start({ bind: '127.0.0.1', port });
    const invite = server.invite({ host: '127.0.0.1', shells: ['cmd'] });
    const bad = JSON.parse(invite);
    bad.token = '0'.repeat(64);
    await assert.rejects(stranger.pair(JSON.stringify(bad)));
    const device = await client.pair(invite);
    assert.equal(server.status().peers.length, 1);
    await assert.rejects(stranger.pair(invite));
    await assert.rejects(
      client.connect(
        { deviceId: device.deviceId, shell: 'powershell' },
        undefined,
        new AbortController().signal,
      ),
    );
    assert.equal(sessions.size, 0);
    const id = await client.connect(
      { deviceId: device.deviceId, shell: 'cmd' },
      undefined,
      new AbortController().signal,
    );
    client.resolve(id).terminal!.input('你好 👋\r\n');
    await new Promise((r) => setTimeout(r, 100));
    assert.ok(input.includes('你好 👋\r\n'));
    assert.ok(events.some((e) => e.type === 'data' && e.data.includes('你好')));
    assert.equal(sessions.size, 1);
    await server.revoke(server.status().peers[0].fingerprint);
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(sessions.size, 0);
    assert.throws(() => client.resolve(id));
    await assert.rejects(
      client.connect(
        { deviceId: device.deviceId, shell: 'cmd' },
        undefined,
        new AbortController().signal,
      ),
    );
    const restored = new ClientServer(new ClientVault(join(dir, 'server'), codec), terminal);
    await restored.load();
    assert.equal(restored.status().peers.length, 0);
    assert.equal(restored.status().running, false);
    const persisted = await readFile(join(dir, 'server', 'peers.enc'), 'utf8');
    assert.ok(!persisted.includes(JSON.parse(invite).token));
    const invitation = JSON.parse(server.invite({ host: '127.0.0.1', shells: ['cmd'] }));
    invitation.expires = 1;
    await assert.rejects(stranger.pair(JSON.stringify(invitation)), /过期/);
  } finally {
    client.dispose();
    stranger.dispose();
    await server.stop();
    await rm(dir, { recursive: true, force: true, maxRetries: 5 });
  }
});

test('Client rejects a substituted TLS identity before sending pairing secrets', async () => {
  const { createServer: tlsServer } = await import('node:tls');
  const { createIdentity } = await import('../src/core/client/identity');
  const dir = await mkdtemp(join(tmpdir(), 'cshell-client-pin-'));
  const expected = await createIdentity(),
    attacker = await createIdentity();
  let received = '';
  const server = tlsServer({ key: attacker.key, cert: attacker.certificate }, (socket) => {
    socket.on('error', () => {});
    socket.on('data', (chunk) => (received += chunk));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const client = new ClientProvider(new ClientVault(dir, codec), () => {});
  await client.load();
  try {
    const invite = {
      protocol: 1,
      deviceId: expected.id,
      name: 'test',
      host: '127.0.0.1',
      port: (server.address() as any).port,
      certificate: expected.certificate,
      token: '1'.repeat(64),
      expires: Date.now() + 10000,
    };
    await assert.rejects(client.pair(JSON.stringify(invite)), /identity changed/);
    assert.equal(received, '');
    assert.equal(client.list().length, 0);
  } finally {
    client.dispose();
    await new Promise<void>((r) => server.close(() => r()));
    await rm(dir, { recursive: true, force: true, maxRetries: 5 });
  }
});
test('Client terminal frames preserve Unicode surrogate pairs', async () => {
  const { textChunks } = await import('../src/core/client/wire');
  const text = 'x'.repeat(16383) + '👋' + '中文'.repeat(20000);
  const chunks = [...textChunks(text)];
  assert.equal(chunks.join(''), text);
  assert.ok(chunks.every((chunk) => chunk.length <= 16384 && !/[\uD800-\uDBFF]$/.test(chunk)));
});

test('Client password enrollment pins identity, limits attempts, persists access and clears grants on rotation', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cshell-client-password-'));
  const vault = new ClientVault(join(dir, 'server'), codec);
  const terminal = {
    id: 'fake',
    version: '1',
    capabilities: [],
    configuration: z.unknown(),
    connect: async () => 'unused',
    disconnect() {},
    resolve() {
      throw Error('unused');
    },
  } as ManagedProvider;
  let server = new ClientServer(vault, terminal);
  const controller = new ClientProvider(new ClientVault(join(dir, 'controller'), codec), () => {});
  const other = new ClientProvider(new ClientVault(join(dir, 'other'), codec), () => {});
  try {
    await server.load();
    await controller.load();
    await other.load();
    await assert.rejects(server.setAccess({ password: 'short', shells: ['cmd'] }));
    const password = 'test-password-very-long-2026';
    await server.setAccess({ password, shells: ['cmd'] });
    assert.equal(server.status().passwordConfigured, true);
    const stored = await vault.read('access', z.unknown());
    assert.equal(JSON.stringify(stored).includes(password), false);
    const port = await freePort();
    await server.start({ bind: '127.0.0.1', port });
    await assert.rejects(server.setAccess({ password, shells: ['powershell'] }));
    const info = await controller.probe({ host: '127.0.0.1', port });
    assert.equal(info.deviceId, server.status().deviceId);
    assert.equal(server.status().peers.length, 0);
    const copied = JSON.parse(server.connectionInfo('127.0.0.1'));
    assert.equal(fingerprint(copied.certificate), fingerprint(info.certificate));
    assert.equal(copied.password, undefined);
    for (let i = 0; i < 4; i++)
      await assert.rejects(controller.pairPassword(info, 'wrong-password-2026'));
    const device = await controller.pairPassword(info, password);
    assert.equal(device.deviceId, info.deviceId);
    await assert.rejects(other.pairPassword(info, password)); // global budget also bounds rotating client certificates
    await assert.rejects(
      controller.connect(
        { deviceId: device.deviceId, shell: 'powershell' },
        undefined,
        new AbortController().signal,
      ),
    );
    await server.stop();
    server = new ClientServer(vault, terminal);
    await server.load();
    assert.equal(server.status().running, false);
    assert.equal(server.status().passwordConfigured, true);
    assert.deepEqual(server.status().allowedShells, ['cmd']);
    assert.equal(server.status().peers.length, 1);
    await server.setAccess({ password: 'rotated-password-2026', shells: ['powershell'] });
    assert.equal(server.status().peers.length, 0);
    await server.start({ bind: '127.0.0.1', port });
    await assert.rejects(
      controller.connect(
        { deviceId: device.deviceId, shell: 'cmd' },
        undefined,
        new AbortController().signal,
      ),
    );
    await assert.rejects(other.pairPassword(info, password));
    await other.pairPassword(info, 'rotated-password-2026');
  } finally {
    controller.dispose();
    other.dispose();
    await server.stop();
    await rm(dir, { recursive: true, force: true });
  }
});
