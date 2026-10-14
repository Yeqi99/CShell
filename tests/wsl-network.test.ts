import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  WslNetworkSettings,
  parseWslNetwork,
  updateWslNetwork,
  wslRevision,
} from '../src/desktop/wsl-network';
import { wslNetworkInput } from '../src/shared/wsl-network';
test('WSL network edit preserves unrelated sections, comments, BOM and line endings', () => {
  const source =
    '\uFEFF# keep\r\n[wsl2]\r\nmemory=8GB\r\nnetworkingMode=nat\r\nautoProxy=true\r\n[experimental]\r\nautoMemoryReclaim=gradual\r\n';
  const next = updateWslNetwork(source, { mode: 'mirrored', autoProxy: false });
  assert.ok(next.startsWith('\uFEFF# keep\r\n'));
  assert.ok(next.includes('memory=8GB\r\n'));
  assert.ok(next.includes('[experimental]\r\nautoMemoryReclaim=gradual'));
  assert.deepEqual(parseWslNetwork(next), { mode: 'mirrored', autoProxy: false });
  assert.equal((next.match(/networkingMode=/g) || []).length, 1);
  assert.deepEqual(parseWslNetwork(''), { mode: 'nat', autoProxy: true });
  assert.throws(() => parseWslNetwork('[wsl2]\n[wsl2]'));
  assert.equal(
    wslNetworkInput.safeParse({ revision: 'x', mode: 'nat', autoProxy: true }).success,
    false,
  );
});
test('WSL settings back up original, reject stale saves, and never restart on save', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cshell-wsl-config-'));
  const file = join(root, '.wslconfig');
  class Fixture extends WslNetworkSettings {
    override async read() {
      const text = await readFile(file, 'utf8').catch(() => '');
      return {
        ...parseWslNetwork(text),
        revision: wslRevision(text),
        mirroredSupported: true,
        localhostProxy: true,
      };
    }
    override async shutdown() {
      throw Error('Save must not shut down WSL');
    }
  }
  try {
    const service = new Fixture(root);
    await writeFile(file, '[wsl2]\nmemory=6GB\n');
    const state = await service.read();
    const saved = await service.save({
      revision: state.revision,
      mode: 'mirrored',
      autoProxy: true,
    });
    assert.equal(saved.mode, 'mirrored');
    assert.ok((await readFile(file, 'utf8')).includes('memory=6GB'));
    const backups = (await readdir(root)).filter((n) => n.endsWith('.bak'));
    assert.equal(backups.length, 1);
    assert.equal(await readFile(join(root, backups[0]), 'utf8'), '[wsl2]\nmemory=6GB\n');
    await assert.rejects(
      service.save({ revision: state.revision, mode: 'nat', autoProxy: false }),
      /changed/,
    );
    assert.equal((await service.read()).mode, 'mirrored');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
