import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { Client, SFTPWrapper } from 'ssh2';
import { SshService } from '../src/core/ssh';
import { fixture } from './fixture';

const profile = (port: number) => ({
  id: randomUUID(),
  name: 'SFTP',
  host: '127.0.0.1',
  port,
  username: 'tester',
  group: '',
  favorite: false,
  auth: 'password' as const,
});

test('parallel SFTP access shares one channel and replaces it after channel closure', async () => {
  const remote = await fixture();
  const ssh = new SshService(
    () => {},
    async () => true,
  );
  try {
    const { sessionId } = await ssh.connect(profile(remote.port), { password: remote.password });
    const client = ssh.get(sessionId).client;
    const open = client.sftp.bind(client);
    let opens = 0;
    client.sftp = (callback) => {
      opens++;
      return open(callback);
    };
    const first = await Promise.all(Array.from({ length: 8 }, () => ssh.sftp(sessionId)));
    assert.equal(opens, 1);
    assert.ok(first.every((channel) => channel === first[0]));
    const closed = once(first[0], 'close', { signal: AbortSignal.timeout(5000) });
    first[0].end();
    await closed;
    const second = await Promise.all(Array.from({ length: 8 }, () => ssh.sftp(sessionId)));
    assert.equal(opens, 2);
    assert.notEqual(second[0], first[0]);
    assert.ok(second.every((channel) => channel === second[0]));
    assert.ok((await ssh.list(sessionId, '.')).entries.some((entry) => entry.name === 'hello.txt'));
    assert.equal(ssh.size, 1, 'reopening SFTP preserves the SSH session');
  } finally {
    ssh.dispose();
    await remote.close();
  }
});

test('late SFTP creation after disconnect is closed and never cached', async () => {
  const remote = await fixture();
  const ssh = new SshService(
    () => {},
    async () => true,
  );
  try {
    const { sessionId } = await ssh.connect(profile(remote.port), { password: remote.password });
    const session = ssh.get(sessionId);
    let complete!: Parameters<Client['sftp']>[0];
    session.client.sftp = (callback) => {
      complete = callback;
      return session.client;
    };
    const pending = ssh.sftp(sessionId);
    ssh.disconnect(sessionId);
    let ended = 0;
    complete(undefined, {
      end: () => {
        ended++;
      },
    } as unknown as SFTPWrapper);
    await assert.rejects(pending, /closed/);
    assert.equal(ended, 1);
    assert.equal(session.sftp, undefined);
    assert.equal(session.sftpPending, undefined);
  } finally {
    ssh.dispose();
    await remote.close();
  }
});
