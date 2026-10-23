import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from '../src/core/store';
test('moving profiles preserves credentials and identity; later editing preserves order', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cshell-order-'));
  const codec = { encrypt: async (s: string) => Buffer.from(s).toString('base64'), decrypt: async (s: string) => Buffer.from(s, 'base64').toString() };
  try {
    const store = new Store(directory, codec); await store.load();
    const profiles = ['A', 'B', 'C'].map(name => ({ id: randomUUID(), name, host: name + '.example', port: 22, username: 'root', auth: 'password' as const, group: 'One', favorite: false }));
    for (const p of profiles) await store.saveProfile(p);
    await store.setSecret(profiles[0].id, { password: 'keep-this' });
    await store.manageGroup({ type: 'create', name: 'Two' });
    await store.moveProfile(profiles[2].id, 'One', profiles[0].id);
    assert.deepEqual(store.snapshot().profiles.map(p => p.name), ['C', 'A', 'B']);
    await store.saveProfile({ ...store.profile(profiles[2].id), favorite: true });
    assert.deepEqual(store.snapshot().profiles.map(p => p.name), ['C', 'A', 'B']);
    await store.moveProfile(profiles[0].id, 'Two');
    assert.equal((await store.secret(profiles[0].id))?.password, 'keep-this');
    await assert.rejects(store.moveProfile(profiles[0].id, 'missing'));
    const restored = new Store(directory, codec); await restored.load();
    assert.equal(restored.profile(profiles[0].id).group, 'Two');
    assert.equal((await restored.secret(profiles[0].id))?.password, 'keep-this');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
