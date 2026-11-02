import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture } from './fixture';
import { SshService } from '../src/core/ssh';
import { RemoteJobs } from '../src/core/remote-jobs';
import { SshConnectionProvider } from '../src/core/connections/ssh-provider';
import { ApiTasks } from '../src/core/api/tasks';

test(
  'real SSH nonzero result preserves stdout stderr exitCode; legacy callers still reject',
  { timeout: 15000 },
  async () => {
    const server = await fixture({
      execResult: { stdout: '部分输出 🌏\n', stderr: '失败原因\n', exitCode: 23 },
    });
    const ssh = new SshService(
      () => {},
      async () => true,
    );
    try {
      const { sessionId } = await ssh.connect(
        {
          id: randomUUID(),
          name: 'fixture',
          host: '127.0.0.1',
          port: server.port,
          username: 'tester',
          auth: 'password',
          group: '',
          favorite: false,
        },
        { password: server.password },
      );
      const provider = new SshConnectionProvider(ssh),
        connection = provider.resolve(sessionId);
      const tool = connection.tools.find((t) => t.name === 'execute_command')!;
      const result = JSON.parse(
        await tool.invoke({ command: 'failing-command' }, new AbortController().signal),
      );
      assert.deepEqual(result, {
        stdout: '部分输出 🌏\n',
        stderr: '失败原因\n',
        exitCode: 23,
        stdoutTruncated: false,
        stderrTruncated: false,
      });
      tool.jsonOutput!.parse(result);
      await assert.rejects(new RemoteJobs(ssh).exec(sessionId, 'same-failure'), /失败原因/);
    } finally {
      server.disconnectAll();
      await server.close();
    }
  },
);

test('task enumeration resumes retained owner results without leaking other owners or released entries', async () => {
  const tasks = new ApiTasks();
  let executions = 0;
  const a = tasks.start('alice', 'ssh-a', {}, 'once', async (_signal, output) => {
    executions++;
    output('private output');
    return 'private result';
  });
  tasks.start('bob', 'ssh-b', {}, 'once', async () => 'bob secret');
  await tasks.flush();
  const list = tasks.list('alice');
  assert.equal(list.tasks.length, 1);
  assert.equal(list.tasks[0].taskId, a.taskId);
  assert.equal(JSON.stringify(list).includes('private'), false);
  assert.equal(JSON.stringify(list).includes('bob'), false);
  assert.equal(tasks.list('alice', { target: 'ssh-b' }).tasks.length, 0);
  assert.equal(tasks.read('alice', list.tasks[0].taskId).result, 'private result');
  assert.throws(() => tasks.read('bob', a.taskId), /not available/);
  tasks.start('alice', 'ssh-a', {}, 'once', async () => {
    executions++;
    return 'wrong';
  });
  assert.equal(executions, 1);
  tasks.release('alice', a.taskId);
  assert.equal(tasks.list('alice').tasks.length, 0);
  assert.throws(() => tasks.list('alice', { limit: 101 }), /Invalid/);
});

test(
  'SSH structured success keeps stderr and marks bounded tails within task retention budget',
  { timeout: 15000 },
  async () => {
    const server = await fixture({
      execResult: { stdout: '\u0001'.repeat(20000), stderr: 'warning'.repeat(5000), exitCode: 0 },
    });
    const ssh = new SshService(
      () => {},
      async () => true,
    );
    try {
      const { sessionId } = await ssh.connect(
        {
          id: randomUUID(),
          name: 'fixture',
          host: '127.0.0.1',
          port: server.port,
          username: 'tester',
          auth: 'password',
          group: '',
          favorite: false,
        },
        { password: server.password },
      );
      const result = await new RemoteJobs(ssh).execResult(sessionId, 'success');
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout.length, 16000);
      assert.equal(result.stderr.length, 16000);
      assert.equal(result.stdoutTruncated, true);
      assert.equal(result.stderrTruncated, true);
      assert.ok(Buffer.byteLength(JSON.stringify(result)) < 262144);
    } finally {
      server.disconnectAll();
      await server.close();
    }
  },
);

test('task pages filter current authorization before counts and use owner-bound cursors', async () => {
  const tasks = new ApiTasks();
  for (let i = 0; i < 4; i++)
    tasks.start(
      'a',
      i === 0 ? 'revoked' : 'allowed',
      { i },
      undefined,
      async () => i,
      'commands.execute',
    );
  tasks.start('b', 'allowed', {}, undefined, async () => 0);
  await tasks.flush();
  const permitted = (t: { target: string }) => t.target === 'allowed';
  const first = tasks.list('a', { limit: 1 }, permitted);
  assert.equal(first.tasks.length, 1);
  assert.equal(first.hasMore, true);
  const second = tasks.list('a', { limit: 2, after: first.nextCursor! }, permitted);
  assert.equal(second.tasks.length, 2);
  assert.equal(second.hasMore, false);
  assert.equal(second.nextCursor, null);
  assert.ok(!second.tasks.some((t) => t.taskId === first.tasks[0].taskId));
  assert.throws(() => tasks.list('b', { after: first.nextCursor! }), /cursor/);
  assert.throws(() => tasks.list('a', { after: first.nextCursor! }, () => false), /cursor/);
});
