import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ActivityStore, exportActivity } from '../src/core/activity';

test('local history persists metadata, pause and clear; corrupt source is recoverable', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cshell-activity-'));
  try {
    const store = new ActivityStore(directory);
    await store.load();
    store.record({
      kind: 'connection',
      action: 'connect',
      status: 'success',
      provider: 'cshell.ssh',
    });
    await store.flush();
    await store.enable(false);
    store.record({ kind: 'ai', action: 'ai:send', status: 'success', provider: 'ai' });
    const restored = new ActivityStore(directory);
    await restored.load();
    assert.equal(restored.snapshot().events.length, 1);
    assert.equal(restored.snapshot().enabled, false);
    await restored.clear();
    assert.equal(restored.snapshot().events.length, 0);
    await writeFile(join(directory, 'activity.json'), 'broken');
    const damaged = new ActivityStore(directory);
    await damaged.load();
    assert.equal(damaged.snapshot().enabled, false);
    await damaged.enable(true);
    const backup = (await readdir(directory)).find((p) => p.startsWith('activity.corrupt-'))!;
    assert.equal(await readFile(join(directory, backup), 'utf8'), 'broken');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('exports escape HTML and spreadsheet formulas, reject unapproved data fields', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cshell-activity-'));
  try {
    const store = new ActivityStore(directory);
    await store.load();
    assert.throws(() =>
      store.record({
        kind: 'ai',
        action: 'ai:send',
        status: 'success',
        provider: 'ai',
        password: 'secret',
      } as any),
    );
    store.record({
      kind: 'tool',
      action: ' =HYPERLINK("bad")',
      status: 'success',
      provider: '<script>',
    });
    const events = store.snapshot().events;
    assert.ok(exportActivity(events, 'csv').includes("' =HYPERLINK"));
    assert.ok(!exportActivity(events, 'html').includes('<script>'));
    await store.flush();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
