import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../src/core/store';
import { safeName, childPath } from '../src/core/paths';
import { parseMetrics } from '../src/core/metrics';
import { SshService } from '../src/core/ssh';
import { Transfers } from '../src/core/transfers';
import {
  profileSchema,
  preferencesSchema,
  defaults,
  type Profile,
  type SessionEvent,
  type Transfer,
} from '../src/shared/contracts';
import { fixture } from './fixture';
import { LocalFiles } from '../src/core/local-files';
const profile = (port = 22): Profile => ({
  id: randomUUID(),
  name: 'Test',
  host: '127.0.0.1',
  port,
  username: 'tester',
  group: '',
  auth: 'password',
  favorite: false,
});
const until = async (fn: () => boolean, timeout = 8000) => {
  const end = Date.now() + timeout;
  while (!fn()) {
    if (Date.now() > end) throw new Error('Timed out');
    await new Promise((r) => setTimeout(r, 25));
  }
};
test('validates profiles and hostile remote names', () => {
  assert.throws(() => profileSchema.parse({ ...profile(), port: 0 }));
  assert.throws(() => profileSchema.parse({ ...profile(), privateKey: 'unexpected' }));
  for (const name of ['../secret', '..', 'C:\\file', 'CON', 'file:stream', 'a/b', 'bad.'])
    assert.throws(() => safeName(name));
  assert.equal(safeName('中文.txt'), '中文.txt');
  assert.equal(childPath('/home', 'a'), '/home/a');
  assert.throws(() => childPath('/home', '../a'));
});
test('configuration round-trip, credential binding and corrupt-file preservation', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cshell-store-'));
  const codec = {
    encrypt: async (value: string) => Buffer.from(value).toString('base64'),
    decrypt: async (value: string) => Buffer.from(value, 'base64').toString(),
  };
  try {
    const store = new Store(dir, codec);
    await store.load();
    const p = profile();
    await store.saveProfile(p);
    await store.setSecret(p.id, { password: 'test-only' });
    assert.ok(!JSON.stringify(store.snapshot()).includes('test-only'));
    assert.equal((await store.secret(p.id))?.password, 'test-only');
    await store.saveProfile({ ...p, host: 'different.example' });
    assert.equal(await store.secret(p.id), undefined);
    await store.trust('test:22', 'SHA256:abc');
    await store.setTools({
      commandSuggestions: false,
      dockerEnabled: true,
      dockerSocket: '/run/user/1000/docker.sock',
    });
    const reloaded = new Store(dir, codec);
    await reloaded.load();
    assert.deepEqual(reloaded.snapshot().tools, {
      commandSuggestions: false,
      dockerEnabled: true,
      dockerSocket: '/run/user/1000/docker.sock',
    });
    assert.throws(() => preferencesSchema.parse({ ...defaults, dockerEnabled: true }));
    assert.equal(reloaded.host('test:22'), 'SHA256:abc');
    await writeFile(join(dir, 'config.json'), '{broken');
    await assert.rejects(() => reloaded.load(), /preserved/);
    assert.equal(await readFile(join(dir, 'config.json'), 'utf8'), '{broken');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('Linux resource parsing uses CPU deltas and handles unsupported hosts', () => {
  const parsed = parseMetrics(
    'cpu 100 0 0 100\nMemTotal: 1000\nMemAvailable: 250\n__DISK__\n/dev/sda 100 50 50 50% /',
    { total: 100, idle: 50 },
  );
  assert.equal(parsed.cpu, 50);
  assert.equal(parsed.memory, 75);
  assert.equal(parsed.disk, 50);
  assert.equal(parseMetrics('unsupported').cpu, null);
  assert.equal(parsed.memoryUsed, 750 * 1024);
  assert.equal(parsed.memoryTotal, 1000 * 1024);
  assert.equal(parsed.diskUsed, 50 * 1024);
  assert.equal(parsed.diskTotal, 100 * 1024);
  assert.equal(parsed.cpuCount, null);
});

test('resource capacities and logical CPUs stay unknown for missing or invalid data', () => {
  const unsupported = parseMetrics('unsupported');
  for (const key of [
    'cpuCount',
    'memory',
    'memoryUsed',
    'memoryTotal',
    'disk',
    'diskUsed',
    'diskTotal',
  ] as const)
    assert.equal(unsupported[key], null);
  const parsed = parseMetrics(
    'cpu 100 0 0 100 0 0 0 0 100\ncpu0 50 0 0 50\ncpu1 50 0 0 50\nMemTotal: 1000\nMemAvailable: 1500\n__DISK__\n/dev/root 100 101 -1 101% /',
  );
  assert.equal(parsed.cpuCount, 2);
  assert.equal(parseMetrics('__CORES__ 32\n').cpuCount, 32);
  assert.equal(parseMetrics('__CORES__ 0\n').cpuCount, null);
  assert.equal(parsed.sample?.total, 200); // Guest time is already included in user time.
  assert.equal(parsed.memory, null);
  assert.equal(parsed.memoryUsed, null);
  assert.equal(parsed.diskUsed, null);
  const full = parseMetrics(
    'MemTotal: 1024\nMemAvailable: 0\n__DISK__\n/dev/root 100 100 0 100% /',
  );
  assert.equal(full.memory, 100);
  assert.equal(full.disk, 100);
});
test('local directory capability, copy and conflict preservation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cshell-local-'));
  try {
    const local = new LocalFiles(),
      grant = await local.grant(directory);
    await writeFile(join(directory, 'source.txt'), 'local 中文');
    await assert.rejects(() => local.list(randomUUID(), '/'), /expired/);
    await assert.rejects(() => local.resolve(grant.root, 'C:\\Windows'), /Invalid/);
    await assert.rejects(() => local.resolve(grant.root, '/file:stream'), /Invalid/);
    assert.equal(await local.resolve(grant.root, '/../../'), await realpath(directory));
    await local.action(grant.root, 'mkdir', '/target');
    const controller = new AbortController();
    let bytes = 0;
    await local.copy(
      join(directory, 'source.txt'),
      join(directory, 'target', 'source.txt'),
      controller.signal,
      (done) => {
        bytes += done;
      },
    );
    assert.ok(bytes > 0);
    assert.equal(await readFile(join(directory, 'target', 'source.txt'), 'utf8'), 'local 中文');
    await assert.rejects(
      () =>
        local.copy(
          join(directory, 'source.txt'),
          join(directory, 'target', 'source.txt'),
          controller.signal,
          () => {},
        ),
      /already exists/,
    );
    await local.action(grant.root, 'rename', '/target/source.txt', '/target/new.txt');
    await local.action(grant.root, 'delete', '/target/new.txt');
    await assert.rejects(() => local.action(grant.root, 'delete', '/'), /root/);
    assert.equal((await local.list(grant.root, '/target')).entries.length, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test(
  'real SSH protocol: reject trust/auth, connect password/key, UTF-8, SFTP, transfer, teardown',
  { timeout: 30000 },
  async () => {
    const server = await fixture(),
      events: SessionEvent[] = [],
      jobs = new Map<string, Transfer>();
    const service = new SshService(
      (e) => events.push(e),
      async (_p, fingerprint) => fingerprint.startsWith('SHA256:'),
    );
    const rejected = new SshService(
      () => {},
      async () => false,
    );
    const dir = await mkdtemp(join(tmpdir(), 'cshell-transfer-'));
    const transfers = new Transfers(
      service,
      (state) => jobs.set(state.id, state),
      async () => false,
    );
    try {
      await assert.rejects(() =>
        rejected.connect(profile(server.port), { password: server.password }),
      );
      await assert.rejects(() => service.connect(profile(server.port), { password: 'wrong' }));
      const { sessionId } = await service.connect(profile(server.port), {
        password: server.password,
      });
      await until(() =>
        events
          .filter((e) => e.type === 'data')
          .map((e) => (e.type === 'data' ? e.data : ''))
          .join('')
          .includes('你好 🌏'),
      );
      service.input(sessionId, 'echo-test\r');
      service.resize(sessionId, 120, 40);
      await until(() => events.some((e) => e.type === 'data' && e.data.includes('echo-test')));
      assert.equal((await service.list(sessionId, '.')).entries[0].name, 'hello.txt');
      await service.action(sessionId, 'mkdir', '/new');
      await service.action(sessionId, 'rename', '/new', '/renamed');
      await service.action(sessionId, 'delete', '/renamed');
      await assert.rejects(
        () => service.action(sessionId, 'rename', '/hello.txt', '/hello.txt'),
        /exists/,
      );
      await mkdir(join(dir, 'upload'));
      await writeFile(join(dir, 'upload', 'nested.txt'), 'nested 中文');
      const uploadId = transfers.enqueue(sessionId, 'upload', join(dir, 'upload'), '/');
      await until(() => jobs.get(uploadId)?.state !== 'running');
      assert.equal(jobs.get(uploadId)?.state, 'done', jobs.get(uploadId)?.error || '');
      assert.equal(
        await readFile(join(server.root, 'upload', 'nested.txt'), 'utf8'),
        'nested 中文',
      );
      const downloadId = transfers.enqueue(sessionId, 'download', '/hello.txt', dir);
      await until(() => jobs.get(downloadId)?.state !== 'running');
      assert.equal(jobs.get(downloadId)?.state, 'done', jobs.get(downloadId)?.error || '');
      assert.equal(await readFile(join(dir, 'hello.txt'), 'utf8'), '你好，CShell 🌏\n');
      const remoteCopy = transfers.copyRemote(sessionId, '/upload', sessionId, '/copy');
      await until(() => jobs.get(remoteCopy)?.state !== 'running');
      assert.equal(jobs.get(remoteCopy)?.state, 'done', jobs.get(remoteCopy)?.error || '');
      assert.equal(await readFile(join(server.root, 'copy', 'nested.txt'), 'utf8'), 'nested 中文');
      const conflict = transfers.enqueue(sessionId, 'download', '/hello.txt', dir);
      await until(() => jobs.get(conflict)?.state !== 'running');
      assert.equal(jobs.get(conflict)?.state, 'failed');
      const cancel = transfers.enqueue(sessionId, 'download', '/hello.txt', dir);
      transfers.cancel(cancel);
      await until(() => jobs.get(cancel)?.state === 'cancelled');
      assert.equal((await service.monitor(sessionId)).memory, 40);
      const keySession = await service.connect(
        { ...profile(server.port), auth: 'key' },
        { privateKey: server.privateKey },
      );
      service.disconnect(keySession.sessionId);
      service.disconnect(sessionId);
      await until(() => events.some((e) => e.type === 'closed' && e.sessionId === sessionId));
      assert.throws(() => service.get(sessionId));
    } finally {
      transfers.dispose();
      service.dispose();
      rejected.dispose();
      await server.close();
      await rm(dir, { recursive: true, force: true });
    }
  },
);

test('old preferences migrate appearance defaults and reject external asset paths', () => {
  const old = {
    locale: 'zh-CN',
    theme: 'dark',
    uiFont: 'Segoe UI',
    terminalFont: 'Consolas',
    fontSize: 14,
  };
  const migrated = preferencesSchema.parse(old);
  assert.equal(migrated.backgroundAsset, null);
  assert.equal(migrated.uiFontAsset, null);
  assert.equal(migrated.backgroundOpacity, 0.15);
  assert.throws(() =>
    preferencesSchema.parse({
      ...defaults,
      backgroundAsset: { id: '../config.json', name: 'bad' },
    }),
  );
  assert.throws(() => preferencesSchema.parse({ ...defaults, backgroundOpacity: 1 }));
});
