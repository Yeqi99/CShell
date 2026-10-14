import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { SshService } from '../src/core/ssh';
import { ConnectionAttempts } from '../src/core/connection-attempts';
import { connectRequest } from '../src/ui/connect-request';
import {
  CONNECTION_CANCELLED,
  CONNECTION_TIMEOUT,
  connectionErrorMessage,
} from '../src/shared/connection-errors';
import type { Profile, SessionEvent } from '../src/shared/contracts';
import { fixture } from './fixture';
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Transfers } from '../src/core/transfers';
import type { Transfer } from '../src/shared/contracts';

const profile = (port: number): Profile => ({
  id: randomUUID(),
  name: 'Lifecycle',
  host: '127.0.0.1',
  port,
  username: 'tester',
  auth: 'password',
  group: '',
  favorite: false,
});
async function until(predicate: () => boolean) {
  for (let i = 0; i < 300; i++) {
    if (predicate()) return;
    await delay(10);
  }
  assert.fail('Condition did not settle');
}

test(
  'SSH cancellation closes a stalled socket promptly; timeout also releases it',
  { timeout: 10000 },
  async () => {
    const sockets = new Set<Socket>();
    const server = createServer((socket) => {
      sockets.add(socket);
      socket.on('error', () => {});
      socket.on('close', () => sockets.delete(socket));
      socket.resume();
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const target = profile((server.address() as { port: number }).port);
    const events: SessionEvent[] = [];
    const ssh = new SshService(
      (e) => events.push(e),
      async () => true,
    );
    const timed = new SshService(
      () => {},
      async () => true,
      { connectTimeoutMs: 100 },
    );
    try {
      const cancel = new AbortController();
      const pending = assert.rejects(
        ssh.connect(target, {}, cancel.signal),
        new RegExp(CONNECTION_CANCELLED),
      );
      await until(() => sockets.size === 1);
      cancel.abort();
      await pending;
      await until(() => sockets.size === 0);
      assert.equal(ssh.size, 0);
      assert.equal(events.filter((e) => e.type === 'closed').length, 1);
      await assert.rejects(timed.connect(target, {}), new RegExp(CONNECTION_TIMEOUT));
      await until(() => sockets.size === 0);
      assert.equal(timed.size, 0);
    } finally {
      ssh.dispose();
      timed.dispose();
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((r) => server.close(() => r()));
    }
  },
);

test(
  'SSH cancellation covers authentication, shell startup and pending identity approval',
  { timeout: 15000 },
  async () => {
    for (const options of [{ stallAuthentication: true }, { stallShell: true }, {}]) {
      const server = await fixture(options);
      let verificationSignal: AbortSignal | undefined;
      const verifying = !('stallAuthentication' in options) && !('stallShell' in options);
      const ssh = new SshService(
        () => {},
        async (_p, _f, signal) => {
          verificationSignal = signal;
          if (verifying)
            await new Promise<void>((r) =>
              signal.addEventListener('abort', () => r(), { once: true }),
            );
          return true;
        },
      );
      try {
        const controller = new AbortController();
        const pending = assert.rejects(
          ssh.connect(profile(server.port), { password: server.password }, controller.signal),
          new RegExp(CONNECTION_CANCELLED),
        );
        await until(() => !!verificationSignal);
        if ('stallAuthentication' in options)
          await until(() => server.authenticationRequests() > 0);
        if ('stallShell' in options) await until(() => server.shellRequests() > 0);
        controller.abort();
        await pending;
        await until(() => server.connectionsCount() === 0);
        assert.equal(ssh.size, 0);
        assert.equal(verificationSignal!.aborted, true);
      } finally {
        ssh.dispose();
        await server.close();
      }
    }
  },
);

test('cancelled requests cannot attach late sessions, cancel peers or reuse stale cancellation', async () => {
  const disconnected: string[] = [];
  const attempts = new ConnectionAttempts(async (id) => {
    disconnected.push(id);
  });
  let finish!: (result: { sessionId: string }) => void;
  const pending = attempts.run(
    'first',
    () =>
      new Promise((r) => {
        finish = r;
      }),
  );
  const rejection = assert.rejects(pending, new RegExp(CONNECTION_CANCELLED));
  attempts.cancel('first');
  assert.deepEqual(await attempts.run('second', async () => ({ sessionId: 'other' })), {
    sessionId: 'other',
  });
  finish({ sessionId: 'late' });
  await rejection;
  assert.deepEqual(disconnected, ['late']);
  assert.deepEqual(await attempts.run('first', async () => ({ sessionId: 'retry' })), {
    sessionId: 'retry',
  });

  const controller = new AbortController();
  const calls: string[] = [];
  const bridge = {
    connect: async () => {
      throw new Error('Must not save a temporary connection');
    },
    connectTemporary: () =>
      new Promise<{ sessionId: string }>((r) => {
        finish = r;
        calls.push('start');
      }),
    cancelConnect: async () => {
      calls.push('cancel');
    },
    disconnect: async (id: string) => {
      calls.push('disconnect:' + id);
    },
  };
  const request = connectRequest(
    bridge,
    profile(22),
    { remember: false },
    false,
    controller.signal,
  );
  const rejected = assert.rejects(request, new RegExp(CONNECTION_CANCELLED));
  controller.abort(new Error(CONNECTION_CANCELLED));
  finish({ sessionId: 'late-reply' });
  await rejected;
  assert.deepEqual(calls, ['start', 'cancel', 'disconnect:late-reply']);
});

test('network drop closes an established SSH session, and a new connection never replays input', async () => {
  const server = await fixture();
  const events: SessionEvent[] = [];
  const ssh = new SshService(
    (e) => events.push(e),
    async () => true,
  );
  try {
    const controller = new AbortController();
    const target = profile(server.port);
    const first = await ssh.connect(target, { password: server.password }, controller.signal);
    // A completed attempt no longer owns its established session.
    controller.abort();
    ssh.input(first.sessionId, 'one-command\r');
    await until(() => server.shellInputs.join('').includes('one-command'));
    server.disconnectAll();
    await until(() => events.some((e) => e.type === 'closed' && e.sessionId === first.sessionId));
    assert.throws(() => ssh.input(first.sessionId, 'must-not-send\r'));
    const second = await ssh.connect(target, { password: server.password });
    assert.notEqual(first.sessionId, second.sessionId);
    await delay(30);
    assert.equal(server.shellInputs.join(''), 'one-command\r');
  } finally {
    ssh.dispose();
    await server.close();
  }
});

test('connection errors explain cancellation, timeout, DNS and authentication in the selected language', () => {
  assert.match(connectionErrorMessage(new Error(CONNECTION_TIMEOUT), 'zh-CN'), /连接超时/);
  assert.match(
    connectionErrorMessage('All configured authentication methods failed', 'zh-CN'),
    /认证失败/,
  );
  assert.match(connectionErrorMessage('ENOTFOUND', 'en-US'), /Host not found/);
  assert.equal(
    connectionErrorMessage(
      "Error invoking remote method 'connect': Error: " + CONNECTION_CANCELLED,
      'zh-CN',
    ),
    '已取消连接。',
  );
});

test(
  'four SSH sessions drain large output independently with delayed renderer acknowledgements',
  { timeout: 15000 },
  async () => {
    const server = await fixture();
    const received = new Map<string, number>();
    const completed = new Set<string>();
    const ssh = new SshService(
      (e) => {
        if (e.type !== 'data') return;
        received.set(e.sessionId, (received.get(e.sessionId) ?? 0) + e.data.length);
        if (e.data.includes('END-OF-OUTPUT')) completed.add(e.sessionId);
        setTimeout(() => ssh.acknowledge(e.sessionId, e.data.length), 10);
      },
      async () => true,
    );
    try {
      const sessions = await Promise.all(
        Array.from({ length: 4 }, () =>
          ssh.connect(profile(server.port), { password: server.password }),
        ),
      );
      server.writeOutput('x'.repeat(2_100_000) + '\r\nEND-OF-OUTPUT\r\n');
      await until(() => completed.size === 4);
      for (const { sessionId } of sessions) assert.ok(received.get(sessionId)! > 2_100_000);
      ssh.input(sessions[0].sessionId, 'still-responsive\r');
      await until(() => server.shellInputs.join('').includes('still-responsive'));
    } finally {
      ssh.dispose();
      await server.close();
    }
  },
);

test(
  'SFTP disk-full and permission failures preserve original files and report failed transfers',
  { timeout: 10000 },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cshell-failure-'));
    await writeFile(join(dir, 'hello.txt'), 'replacement must not win');
    try {
      for (const writeFailure of ['full', 'permission'] as const) {
        const server = await fixture({ writeFailure });
        const ssh = new SshService(
          () => {},
          async () => true,
        );
        const jobs = new Map<string, Transfer>();
        const transfers = new Transfers(
          ssh,
          (state) => jobs.set(state.id, state),
          async () => true,
        );
        try {
          const { sessionId } = await ssh.connect(profile(server.port), {
            password: server.password,
          });
          const id = transfers.enqueue(sessionId, 'upload', join(dir, 'hello.txt'), '/');
          await until(() => jobs.get(id)?.state === 'failed');
          assert.match(jobs.get(id)!.error!, writeFailure === 'full' ? /space/ : /Permission/);
          assert.equal(await readFile(join(server.root, 'hello.txt'), 'utf8'), '你好，CShell 🌏\n');
          assert.deepEqual(await readdir(server.root), ['hello.txt']);
        } finally {
          transfers.dispose();
          ssh.dispose();
          await server.close();
        }
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);
