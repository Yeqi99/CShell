import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, stat, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { ApiLocalFiles } from '../src/core/api/local-file-read';
import {
  inspectLocalFile,
  localMutationInput,
  localMutationLocks,
  mutateLocalFile,
} from '../src/core/api/local-file-mutations';

test('local conditional writes reject sparse offsets and invalid paths; overlapping grants share lock identity', async () => {
  const path = await mkdtemp(join(tmpdir(), 'cshell-mutations-'));
  const info = await stat(path);
  const root = { id: randomUUID(), name: 'test', path, identity: `${info.dev}:${info.ino}` };
  const files = new ApiLocalFiles();
  const create = {
    action: 'create' as const,
    path: '/file',
    acceptNonAtomic: true as const,
    bodyBase64: 'YQ==',
  };
  try {
    for (const path of ['/', '/../escape', '/a/../escape', '/a//b', '/a\\b', '/C:secret']) {
      assert.equal(
        localMutationInput.safeParse({
          rootId: root.id,
          idempotencyKey: 'x',
          operation: { ...create, path },
        }).success,
        false,
      );
    }
    await mutateLocalFile(files, root, create, () => {});
    const before = await inspectLocalFile(files, root, '/file', () => {});
    await assert.rejects(
      mutateLocalFile(
        files,
        root,
        { ...create, action: 'write', revision: before.revision, offset: 9 },
        () => {},
      ),
      { code: 'CONFLICT' },
    );
    assert.equal(await readFile(join(path, 'file'), 'utf8'), 'a');
    await assert.rejects(
      mutateLocalFile(files, root, { ...create, path: '/cancelled' }, () => {
        throw new Error('revoked');
      }),
      /revoked/,
    );
    await assert.rejects(stat(join(path, 'cancelled')), { code: 'ENOENT' });
    await assert.rejects(mutateLocalFile(files, root, { ...create, path: '/partial' }, () => {
      if (existsSync(join(path, 'partial'))) throw new Error('cancel after creation');
    }), { code: 'OUTCOME_UNKNOWN' });
    assert.equal(await readFile(join(path, 'partial'), 'utf8'), '');
    await mkdir(join(path, 'nested'));
    await mutateLocalFile(files, root, { ...create, path: '/nested/child' }, () => {});
    const directory = await inspectLocalFile(files, root, '/nested', () => {});
    const move = { action: 'renameDirectory' as const, path: '/nested', destination: '/moved', revision: directory.revision, acceptNonAtomic: true as const };
    await assert.rejects(mutateLocalFile(files, root, { ...move, destination: '/nested/inside' }, () => {}), { code: 'INVALID_ARGUMENT' });
    await mutateLocalFile(files, root, move, () => {});
    assert.equal(await readFile(join(path, 'moved/child'), 'utf8'), 'a');
    await assert.rejects(stat(join(path, 'nested')), { code: 'ENOENT' });
    assert.deepEqual(
      localMutationLocks(root, { ...create, path: '/nested/file' }),
      localMutationLocks({ ...root, id: randomUUID(), path: join(path, 'nested') }, create),
    );
    assert.equal(
      localMutationLocks(root, {
        action: 'rename',
        path: '/file',
        destination: '/other',
        revision: before.revision,
        acceptNonAtomic: true,
      }).length,
      2,
    );
  } finally {
    await rm(path, { recursive: true, force: true });
  }
});
