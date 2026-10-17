import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, stat, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture } from './fixture';
import { SshService } from '../src/core/ssh';
import { inspectSftpTree, mutateSftpTree } from '../src/core/api/sftp-tree';

test('real SFTP tree preflight rejects changes and links; move and bounded bottom-up deletion use native operations', async () => {
  const server = await fixture();
  const ssh = new SshService(() => {}, async () => true);
  const signal = new AbortController().signal;
  try {
    const session = await ssh.connect({ id: randomUUID(), name: 'tree', host: '127.0.0.1', port: server.port, username: 'tester', auth: 'password', group: '', favorite: false }, { password: server.password });
    const sftp = await ssh.sftp(session.sessionId);
    await mkdir(join(server.root, 'tree/sub'), { recursive: true });
    await writeFile(join(server.root, 'tree/sub/a'), 'one');
    const first = await inspectSftpTree(sftp, { path: '/tree' }, signal);
    assert.equal(first.entries, 3);
    await writeFile(join(server.root, 'tree/sub/a'), 'changed length');
    await assert.rejects(mutateSftpTree(sftp, { path: '/tree', action: 'delete', revision: first.revision, acceptNonAtomic: true }, signal), { code: 'CONFLICT' });
    const fresh = await inspectSftpTree(sftp, { path: '/tree' }, signal);
    await assert.rejects(mutateSftpTree(sftp, { path: '/tree', action: 'rename', destination: '/tree/sub/moved', revision: fresh.revision, acceptNonAtomic: true }, signal), { code: 'INVALID_ARGUMENT' });
    const moved = await mutateSftpTree(sftp, { path: '/tree', action: 'rename', destination: '/moved', revision: fresh.revision, acceptNonAtomic: true }, signal);
    assert.equal(moved.affectedEntries, 3);
    assert.ok((await stat(join(server.root, 'moved/sub/a'))).isFile());
    const movedRevision = await inspectSftpTree(sftp, { path: '/moved' }, signal);
    const removed = await mutateSftpTree(sftp, { path: '/moved', action: 'delete', revision: movedRevision.revision, acceptNonAtomic: true }, signal);
    assert.equal(removed.affectedEntries, 3);
    await assert.rejects(stat(join(server.root, 'moved')), { code: 'ENOENT' });
    await mkdir(join(server.root, 'partial'));
    await writeFile(join(server.root, 'partial/a'), 'a');
    await writeFile(join(server.root, 'partial/b'), 'b');
    const partial = await inspectSftpTree(sftp, { path: '/partial' }, signal);
    const controller = new AbortController();
    const originalUnlink = sftp.unlink.bind(sftp);
    let submissions = 0;
    sftp.unlink = (path, callback) => originalUnlink(path, (error) => {
      submissions++; controller.abort(); callback(error);
    });
    try {
      await assert.rejects(mutateSftpTree(sftp, { path: '/partial', action: 'delete', revision: partial.revision, acceptNonAtomic: true }, controller.signal), { code: 'OUTCOME_UNKNOWN' });
      assert.equal(submissions, 1);
      assert.ok((await stat(join(server.root, 'partial'))).isDirectory());
    } finally { sftp.unlink = originalUnlink; }
    await mkdir(join(server.root, 'linked'));
    await symlink(join(server.root, 'linked'), join(server.root, 'link'), 'junction');
    await assert.rejects(inspectSftpTree(sftp, { path: '/link' }, signal), { code: 'CONFLICT' });
  } finally { ssh.dispose(); await server.close(); }
});
