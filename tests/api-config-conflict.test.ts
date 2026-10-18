import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/core/store';
import { McpService } from '../src/core/mcp';

test('concurrent settings drafts cannot overwrite a newer permission decision', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cshell-config-conflict-'));
  const store = new Store(directory, { encrypt: async (s) => s, decrypt: async (s) => s });
  await store.load();
  const service = new McpService(store, directory, async () => false);
  try {
    const original = service.status();
    const results = await Promise.allSettled([
      service.configure({ ...original.settings, review: 'mutations' }, original.revision),
      service.configure({ ...original.settings, review: 'authorized' }, original.revision),
    ]);
    assert.equal(results[0].status, 'fulfilled');
    assert.equal(results[1].status, 'rejected');
    if (results[1].status === 'rejected') assert.equal(results[1].reason.code, 'CONFLICT');
    assert.equal(service.status().settings.review, 'mutations');
    assert.equal(service.status().running, false);
    const current = service.status();
    assert.notEqual(current.revision, original.revision);
    await service.configure(current.settings, current.revision);
    assert.equal(service.status().revision, current.revision);
    const reloaded = new Store(directory, { encrypt: async (s) => s, decrypt: async (s) => s });
    await reloaded.load();
    assert.equal(reloaded.mcpSettings().review, 'mutations');
  } finally {
    await service.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
