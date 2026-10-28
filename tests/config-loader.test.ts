import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Config } from '../src/shared/contracts';
import { defaults } from '../src/shared/contracts';
import { toolsDefaults } from '../src/shared/docker';
import { ConfigLoader } from '../src/ui/config-loader';

function snapshot(name: string, size = 12): Config {
  return { groups: [name], profiles: [{ id: name, name, host: '127.0.0.1', port: 22,
    username: 'test', auth: 'password', favorite: false, group: name }],
    preferences: { ...defaults, sidebarFontSize: size }, savedCredentials: [], plugins: [], tools: toolsDefaults };
}
function fixture() {
  let current = snapshot('old');
  const reads: Array<(value: Config) => void> = [];
  const loader = new ConfigLoader(() => new Promise(resolve => reads.push(resolve)), update => { current = update(current); });
  return { loader, reads, current: () => current };
}

test('a delayed old configuration response cannot hide new groups and machines', async () => {
  const f = fixture();
  const old = f.loader.load(), latest = f.loader.load();
  f.reads[1](snapshot('new-machine'));
  await latest;
  f.reads[0](snapshot('old'));
  await old;
  assert.deepEqual(f.current().groups, ['new-machine']);
  assert.equal(f.current().profiles[0].id, 'new-machine');
});

test('changing sidebar size uses current connections, not an older render snapshot', async () => {
  const f = fixture();
  const capturedPreferences = f.current().preferences;
  const fresh = f.loader.load();
  f.reads[0](snapshot('new-machine'));
  await fresh;
  f.loader.previewPreferences({ ...capturedPreferences, sidebarFontSize: 18 });
  assert.equal(f.current().preferences.sidebarFontSize, 18);
  assert.deepEqual(f.current().groups, ['new-machine']);
  assert.equal(f.current().profiles[0].id, 'new-machine');
});

test('an in-flight snapshot cannot undo a new optimistic edit; cloud changes still refresh connections', async () => {
  const f = fixture();
  const old = f.loader.load();
  f.loader.previewPreferences({ ...defaults, sidebarFontSize: 18 });
  f.reads[0](snapshot('old'));
  await old;
  assert.equal(f.current().preferences.sidebarFontSize, 18);
  const cloud = f.loader.load();
  f.reads[1](snapshot('cloud-machine', 12));
  await cloud;
  assert.equal(f.current().profiles[0].id, 'cloud-machine');
  assert.equal(f.current().preferences.sidebarFontSize, 18);
});

test('only the latest preference save settles the preview, and reload restores the actual saved state after failure', async () => {
  const f = fixture();
  const first = f.loader.previewPreferences({ ...defaults, sidebarFontSize: 16 });
  const second = f.loader.previewPreferences({ ...defaults, sidebarFontSize: 18 });
  await f.loader.settlePreferences(first);
  assert.equal(f.reads.length, 0);
  assert.equal(f.current().preferences.sidebarFontSize, 18);
  const rollback = f.loader.settlePreferences(second);
  f.reads[0](snapshot('new-machine', 16));
  await rollback;
  assert.equal(f.current().preferences.sidebarFontSize, 16);
  assert.equal(f.current().profiles[0].id, 'new-machine');
});
