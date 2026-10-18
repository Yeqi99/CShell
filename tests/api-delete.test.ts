import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { SFTPWrapper } from 'ssh2';
import { deleteSftpFile } from '../src/core/api/sftp-delete';

const attrs = { size: 1, mtime: 2, mode: 33152, uid: 1, gid: 1, isFile: () => true };
const revision = createHash('sha256')
  .update(JSON.stringify(['file', 1, 2, 33152, 1, 1]))
  .digest('hex');
const input = { path: 'file', revision, acceptNonAtomic: true };
test('deletion rejects stale metadata, nonfiles and preflight cancellation without unlink', async () => {
  for (const state of ['stale', 'nonfile', 'cancelled']) {
    const controller = new AbortController();
    let deletes = 0;
    const sftp = {
      lstat: (_p: string, cb: Function) => {
        if (state === 'cancelled') controller.abort();
        cb(null, { ...attrs, isFile: () => state !== 'nonfile' });
      },
      unlink: () => {
        deletes++;
      },
    } as unknown as SFTPWrapper;
    await assert.rejects(
      deleteSftpFile(
        sftp,
        state === 'stale' ? { ...input, revision: '0'.repeat(64) } : input,
        controller.signal,
      ),
    );
    assert.equal(deletes, 0);
  }
});
test('submitted deletion never retries or claims recovery on failure or cancellation', async () => {
  for (const state of ['failure', 'cancelled']) {
    const controller = new AbortController();
    let deletes = 0;
    const sftp = {
      lstat: (_p: string, cb: Function) => cb(null, attrs),
      unlink: (_p: string, cb: Function) => {
        deletes++;
        if (state === 'cancelled') controller.abort();
        cb(state === 'failure' ? new Error('connection lost') : undefined);
      },
    } as unknown as SFTPWrapper;
    await assert.rejects(deleteSftpFile(sftp, input, controller.signal), {
      code: 'OUTCOME_UNKNOWN',
    });
    assert.equal(deletes, 1);
  }
});
