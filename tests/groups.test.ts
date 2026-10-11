import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from '../src/core/store';

test('groups persist empty names, migrate profile groups and preserve credentials when reorganized', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cshell-groups-'));
  const codec = {
    encrypt: async (value: string) => Buffer.from(value).toString('base64'),
    decrypt: async (value: string) => Buffer.from(value, 'base64').toString(),
  };
  try {
    const store = new Store(directory, codec);
    await store.load();
    await store.manageGroup({ type: 'create', name: 'Empty' });
    await assert.rejects(
      () => store.manageGroup({ type: 'create', name: ' Empty ' }),
      /GROUP_EXISTS/,
    );
    await assert.rejects(() => store.manageGroup({ type: 'create', name: ' ' }));
    const profile = {
      id: randomUUID(),
      name: 'server',
      host: '127.0.0.1',
      username: 'root',
      port: 22,
      auth: 'password' as const,
      favorite: false,
      group: 'Legacy',
    };
    await store.saveProfile(profile);
    await store.setSecret(profile.id, { password: 'test-only' });
    // Old files contain groups only on profiles.
    const old = JSON.parse(await readFile(join(directory, 'config.json'), 'utf8'));
    delete old.groups;
    await writeFile(join(directory, 'config.json'), JSON.stringify(old));
    await store.load();
    assert.deepEqual(store.snapshot().groups, ['Legacy']);
    await store.manageGroup({ type: 'create', name: 'Empty' });
    await store.manageGroup({ type: 'rename', name: 'Legacy', next: 'Production' });
    assert.equal(store.profile(profile.id).group, 'Production');
    assert.equal((await store.secret(profile.id))?.password, 'test-only');
    await assert.rejects(
      () => store.manageGroup({ type: 'rename', name: 'Production', next: 'Empty' }),
      /GROUP_EXISTS/,
    );
    await store.manageGroup({ type: 'delete', name: 'Production' });
    assert.equal(store.profile(profile.id).group, '');
    assert.equal((await store.secret(profile.id))?.password, 'test-only');
    await store.saveProfile({ ...profile, group: 'Last connection' });
    await store.saveProfile({ ...profile, group: '' });
    const reloaded = new Store(directory, codec);
    await reloaded.load();
    assert.deepEqual(reloaded.snapshot().groups, ['Empty', 'Last connection']);
    assert.equal(reloaded.snapshot().profiles.length, 1);
  } finally {
    assert.ok(directory.startsWith(join(tmpdir(), 'cshell-groups-')));
    await rm(directory, { recursive: true, force: true });
  }
});
