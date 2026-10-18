import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  desktopReleaseAssets,
  agentReleaseAssets,
  verifyReleaseAssets,
} from '../scripts/release-assets';

test('release gate rejects missing platforms, wrong versions and duplicate assets', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cshell-release-'));
  try {
    const expected = desktopReleaseAssets('0.6.0');
    assert.equal(expected.length, 10);
    assert.equal(agentReleaseAssets('0.6.0').length, 5);
    assert.ok(agentReleaseAssets('0.6.0').includes('CAgent-Setup-0.6.0-win-x64.zip'));
    assert.ok(expected.includes('CShell-0.6.0-linux-amd64.deb'));
    assert.throws(() => desktopReleaseAssets('../bad'));
    await assert.rejects(verifyReleaseAssets(dir, expected), /Missing/);
    const exe = Buffer.alloc(2048);
    exe.write('MZ');
    await writeFile(join(dir, expected[0]), exe);
    const report = await verifyReleaseAssets(dir, [expected[0]]);
    assert.equal(report[0].size, exe.length);
    assert.match(report[0].sha256, /^[a-f0-9]{64}$/);
    await assert.rejects(verifyReleaseAssets(dir, desktopReleaseAssets('0.5.0')), /Unexpected/);
    await mkdir(join(dir, 'duplicate'));
    await writeFile(join(dir, 'duplicate', expected[0]), exe);
    await assert.rejects(verifyReleaseAssets(dir, [expected[0]]), /Duplicate/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('release gate rejects a renamed text file posing as an installer', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cshell-release-'));
  try {
    const name = 'CShell-0.6.0-win-x64.exe';
    await writeFile(join(dir, name), 'error'.repeat(1000));
    await assert.rejects(verifyReleaseAssets(dir, [name]), /format mismatch/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
