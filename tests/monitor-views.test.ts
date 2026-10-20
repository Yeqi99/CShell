import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { arrangeViewTiles, monitorViewSchema, viewShellCommand, type ViewTile } from '../src/shared/monitor-views';
import { Store } from '../src/core/store';
const tile = (): ViewTile => ({ id: randomUUID(), profileId: randomUUID(), label: 'Server', kind: 'ssh',
  displayId: 'display-A', column: 0, row: 0, width: 12, height: 12, directory: '', command: '', screen: '' });
test('all built-in layouts keep 1–12 sources visible without overlaps', () => {
  for (let n = 1; n <= 12; n++) for (const mode of ['grid', 'rows', 'focus'] as const) {
    const tiles = arrangeViewTiles(Array.from({ length: n }, tile), mode);
    assert.equal(tiles.length, n);
    assert.ok(monitorViewSchema.safeParse({ id: randomUUID(), name: 'Fleet', tiles }).success);
  }
});
test('saved views reject overlap, duplicate ids and credential payloads', () => {
  const t = tile(), base = { id: randomUUID(), name: 'Fleet', tiles: [t] };
  assert.equal(monitorViewSchema.safeParse({ ...base, tiles: [t, { ...tile(), column: 1, width: 5 }] }).success, false);
  assert.equal(monitorViewSchema.safeParse({ ...base, tiles: [t, { ...t, displayId: 'other' }] }).success, false);
  assert.equal(monitorViewSchema.safeParse({ ...base, password: 'secret' }).success, false);
});
test('directory and screen identifiers are literal shell arguments, screen never detaches other clients', () => {
  assert.equal(viewShellCommand({ ...tile(), directory: "/srv/it's a world", command: 'tail -F latest.log' }),
    "cd -- '/srv/it'\\''s a world' && tail -F latest.log");
  assert.equal(viewShellCommand({ ...tile(), screen: '$(touch unsafe)' }), "screen -x '$(touch unsafe)'");
});
test('views survive restart independently from appearance and contain only profile references', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cshell-views-test-'));
  const codec = { encrypt: async (s: string) => s, decrypt: async (s: string) => s };
  try {
    const a = new Store(dir, codec); await a.load();
    const v = { id: randomUUID(), name: 'Minecraft', tiles: [tile()] };
    await a.saveMonitorView(v);
    const b = new Store(dir, codec); await b.load();
    assert.deepEqual(b.monitorViews(), [v]);
    const copy = b.monitorViews(); copy[0].name = 'mutated';
    assert.equal(b.monitorViews()[0].name, 'Minecraft');
    await b.deleteMonitorView(v.id);
    assert.equal(JSON.parse(await readFile(join(dir, 'config.json'), 'utf8')).monitorViews.length, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
