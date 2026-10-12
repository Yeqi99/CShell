import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { wslAccountSchema } from '../src/desktop/wsl-account';
import { ubuntuImage, downloadUbuntu } from '../src/desktop/wsl-download';
test('WSL account rejects shell injection and control characters without invoking system commands', () => {
  for (const username of ['root; id', 'a b', '-root', '$(id)'])
    assert.equal(
      wslAccountSchema.safeParse({ distribution: 'Ubuntu', username, password: 'sample' }).success,
      false,
    );
  assert.equal(
    wslAccountSchema.safeParse({ distribution: 'Ubuntu', username: 'dev', password: 'a\nb' })
      .success,
    false,
  );
});
test('WSL fallback downloads only official architecture image and validates digest before use', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cshell-wsl-download-')),
    image = Buffer.from('test-image');
  const manifest = {
    ModernDistributions: {
      Ubuntu: [
        {
          Name: 'Ubuntu',
          Amd64Url: {
            Url: 'https://releases.ubuntu.com/test.wsl',
            Sha256: createHash('sha256').update(image).digest('hex'),
          },
        },
      ],
    },
  };
  const requests: string[] = [];
  const fetcher = (async (url: string) => {
    requests.push(url);
    if (url.includes('raw.githubusercontent')) throw new Error('network');
    return url.includes('api.github') ? Response.json(manifest) : new Response(image);
  }) as typeof fetch;
  try {
    const path = join(directory, 'Ubuntu.wsl');
    await downloadUbuntu(path, fetcher, 'x64');
    assert.deepEqual(await readFile(path), image);
    assert.equal(requests.length, 3);
    assert.throws(() => ubuntuImage(manifest, 'arm64'), /架构/);
    manifest.ModernDistributions.Ubuntu[0].Amd64Url.Sha256 = '0'.repeat(64);
    const bad = join(directory, 'bad.wsl');
    await assert.rejects(downloadUbuntu(bad, fetcher, 'x64'), /校验失败/);
    await assert.rejects(readFile(bad));
    manifest.ModernDistributions.Ubuntu[0].Amd64Url.Url = 'https://example.com/arbitrary.wsl';
    assert.throws(() => ubuntuImage(manifest, 'x64'), /不受信任/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
