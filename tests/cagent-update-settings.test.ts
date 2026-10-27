import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentUpdater } from '../src/agent/update';

const emptyCatalog = (async () => new Response('[]')) as typeof fetch;

test('rapid update preference changes persist in request order and survive restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cagent-update-settings-'));
  const updater = new AgentUpdater(directory, '0.8.13', emptyCatalog);
  const restored = new AgentUpdater(directory, '0.8.13', emptyCatalog);
  try {
    const values = Array.from({ length: 40 }, (_, i) => i % 2 === 0);
    const outcomes = await Promise.allSettled(values.map(value => updater.settings(value)));
    assert.deepEqual(outcomes.filter(result => result.status === 'rejected'), [], 'every accepted change must finish without sharing a temporary-file rename');
    assert.deepEqual(outcomes.map(result => result.status === 'fulfilled' && result.value.automatic), values);
    assert.equal((await updater.settings()).automatic, false);
    assert.deepEqual(JSON.parse(await readFile(join(directory, 'update-settings.json'), 'utf8')), { automatic: false });
    await restored.initialize();
    assert.equal(restored.status().automatic, false);
  } finally {
    updater.close(); restored.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('failed preference persistence keeps the previous value and permits later recovery', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cagent-update-settings-failure-'));
  const updater = new AgentUpdater(directory, '0.8.13', emptyCatalog);
  const file = join(directory, 'update-settings.json');
  try {
    await updater.settings(false);
    await rm(file);
    await mkdir(file); // Deterministic rename failure, including elevated Windows accounts.
    await assert.rejects(updater.settings(true));
    assert.equal(updater.status().automatic, false, 'failed persistence must not enable background update checks');
    assert.equal((await updater.settings()).automatic, false);
    await rm(file, { recursive: true });
    assert.equal((await updater.settings(true)).automatic, true);
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { automatic: true });
    updater.close();
    await assert.rejects(updater.settings(false), /更新服务已关闭/);
  } finally {
    updater.close();
    await rm(directory, { recursive: true, force: true });
  }
});
