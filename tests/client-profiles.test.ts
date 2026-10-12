import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from '../src/core/store';
import { syncClientProfiles } from '../src/core/client/profiles';
import { SshService } from '../src/core/ssh';
const codec = {
  encrypt: async (v: string) => Buffer.from(v).toString('base64'),
  decrypt: async (v: string) => Buffer.from(v, 'base64').toString(),
};
test('Client sidebar migration is idempotent and preserves names, groups, favorites and identity separation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cshell-client-profiles-'));
  try {
    const store = new Store(directory, codec);
    await store.load();
    const device = {
      protocol: 1 as const,
      deviceId: randomUUID(),
      name: 'old Client',
      host: '127.0.0.1',
      port: 47831,
      fingerprint: 'public fingerprint',
    };
    await syncClientProfiles(store, [device]);
    const original = store.profile(device.deviceId);
    assert.equal(original.protocol, 'client');
    await store.saveProfile({
      ...original,
      name: 'Office PC',
      group: 'Office',
      favorite: true,
      clientShell: 'cmd',
    });
    await syncClientProfiles(store, [device]);
    assert.equal(store.snapshot().profiles.length, 1);
    await syncClientProfiles(store, [{ ...device, host: '192.168.1.10' }]);
    assert.equal(store.profile(device.deviceId).name, 'Office PC');
    assert.equal(store.profile(device.deviceId).favorite, true);
    assert.equal(store.profile(device.deviceId).clientShell, 'cmd');
    await store.manageGroup({ type: 'rename', name: 'Office', next: 'Work' });
    const reloaded = new Store(directory, codec);
    await reloaded.load();
    assert.equal(reloaded.profile(device.deviceId).group, 'Work');
    await reloaded.manageGroup({ type: 'delete', name: 'Work' });
    assert.equal(reloaded.profile(device.deviceId).group, '');
    assert.equal(reloaded.profile(device.deviceId).id, device.deviceId);
    const contents = await readFile(join(directory, 'config.json'), 'utf8');
    assert.ok(!contents.includes('public fingerprint'));
    const ssh = new SshService(
      () => {},
      async () => true,
    );
    await assert.rejects(ssh.connect(reloaded.profile(device.deviceId), {}), /cannot use SSH/);
    assert.equal(ssh.size, 0);
    await reloaded.deleteProfile(device.deviceId);
    await syncClientProfiles(reloaded, []);
    assert.equal(reloaded.snapshot().profiles.length, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
