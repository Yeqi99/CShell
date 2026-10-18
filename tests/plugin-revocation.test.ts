import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PluginService } from '../src/core/plugins';
import type { Store } from '../src/core/store';
import type { InstalledPlugin } from '../src/shared/plugins';
import { builtinPlugins } from '../src/shared/plugins';
import { marketRoot } from '../src/shared/market';
import { createHash } from 'node:crypto';

test('a revoked plugin mutation does not write after waiting behind a desktop operation', async () => {
  let records: InstalledPlugin[] = [];
  let writes = 0;
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const store = {
    plugins: () => structuredClone(records),
    setPlugins: async (next: InstalledPlugin[]) => {
      writes++;
      records = next;
      if (writes === 1) await blocked;
    },
  } as unknown as Store;
  const plugins = new PluginService(store);
  const first = plugins.install('cshell.python');
  const controller = new AbortController();
  const queued = plugins.remove('cshell.python', () => controller.signal.throwIfAborted());
  const rejected = assert.rejects(queued, { name: 'AbortError' });
  controller.abort();
  release();
  await first;
  await rejected;
  assert.equal(writes, 1);
  assert.equal(records[0].manifest.id, 'cshell.python');
  await plugins.toggle('cshell.python', false);
  assert.equal(writes, 2);
  assert.equal(records[0].enabled, false);
});

test('a package revoked after download is verified never reaches the queued installation', async () => {
  let records: InstalledPlugin[] = [];
  let writes = 0;
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const service = new PluginService({
    plugins: () => structuredClone(records),
    setPlugins: async (next: InstalledPlugin[]) => {
      records = next;
      writes++;
      if (writes === 1) await blocked;
    },
  } as unknown as Store);
  const manifest = builtinPlugins.find((p) => p.id === 'cshell.python')!;
  const body = JSON.stringify(manifest);
  const entry = { manifest, url: `${marketRoot}/plugins/${manifest.id}.json`, sha256: createHash('sha256').update(body).digest('hex') };
  const controller = new AbortController();
  const oldFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(body);
    const desktop = service.install('cshell.conda');
    const download = service.download(entry, controller.signal);
    const rejected = assert.rejects(download, { name: 'AbortError' });
    await new Promise((resolve) => setImmediate(resolve));
    controller.abort();
    release();
    await desktop;
    await rejected;
    assert.equal(writes, 1);
    assert.equal(records.some((r) => r.manifest.id === manifest.id), false);
  } finally {
    release();
    globalThis.fetch = oldFetch;
  }
});
