import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { SFTPWrapper } from 'ssh2';
import { renameSftpFile } from '../src/core/api/sftp-rename';

const attrs = { size: 1, mtime: 2, mode: 33152, uid: 1, gid: 1, isFile: () => true };
const revision = createHash('sha256')
  .update(JSON.stringify(['source', 1, 2, 33152, 1, 1]))
  .digest('hex');
const input = { path: 'source', destination: 'destination', revision, acceptNonAtomic: true };
test('rename refuses stale source, links and existing destination before submitting', async () => {
  for (const state of ['stale', 'link', 'exists']) {
    let renamed = 0;
    const sftp = {
      lstat: (_path: string, cb: Function) =>
        cb(null, state === 'link' ? { ...attrs, isFile: () => false } : attrs),
      rename: () => {
        renamed++;
      },
    } as unknown as SFTPWrapper;
    await assert.rejects(
      renameSftpFile(
        sftp,
        state === 'stale' ? { ...input, revision: '0'.repeat(64) } : input,
        new AbortController().signal,
      ),
    );
    assert.equal(renamed, 0);
  }
});
test('rename checks cancellation after preflight and reports unknown after submission without retry', async () => {
  for (const phase of ['preflight', 'submitted']) {
    const controller = new AbortController();
    let renamed = 0;
    const sftp = {
      lstat: (path: string, cb: Function) => {
        if (path === 'source') return cb(null, attrs);
        if (phase === 'preflight') controller.abort();
        cb(Object.assign(new Error('absent'), { code: 2 }));
      },
      rename: (_from: string, _to: string, cb: Function) => {
        renamed++;
        controller.abort();
        cb();
      },
    } as unknown as SFTPWrapper;
    await assert.rejects(
      renameSftpFile(sftp, input, controller.signal),
      phase === 'submitted' ? { code: 'OUTCOME_UNKNOWN' } : { name: 'AbortError' },
    );
    assert.equal(renamed, phase === 'submitted' ? 1 : 0);
  }
});
