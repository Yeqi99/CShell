import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Transfers } from '../src/core/transfers';
import type { SshService } from '../src/core/ssh';
import type { Transfer } from '../src/shared/contracts';
import { mkdtemp, mkdir, access, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const deferred = <T = void>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};
const directory = { isSymbolicLink: () => false, isDirectory: () => true, isFile: () => false };
test(
  'cancelling either endpoint cancels a queued cross-machine copy before opening SFTP',
  { timeout: 5000 },
  async () => {
    for (const endpoint of ['source', 'target']) {
      const gate = deferred(),
        done = deferred<Transfer>();
      let opens = 0,
        id = '';
      const transfers = new Transfers(
        {
          sftp: async () => {
            opens++;
            throw Error('Must not open');
          },
        } as unknown as SshService,
        (s) => {
          if (s.id === id && s.state !== 'running') done.resolve(s);
        },
        async () => false,
      );
      transfers.enqueueOperation('other', 'blocker', async () => gate.promise);
      id = transfers.copyRemote('source', '/data', 'target', '/copied');
      transfers.cancelSession(endpoint);
      gate.resolve();
      assert.equal((await done.promise).state, 'cancelled');
      assert.equal(opens, 0);
    }
  },
);
test(
  'cancellation during remote directory metadata does not create a destination',
  { timeout: 5000 },
  async () => {
    for (const endpoint of ['source', 'target']) {
      const requested = deferred(),
        metadata = deferred(),
        done = deferred<Transfer>();
      let creates = 0,
        id = '';
      const from = {
        lstat: (_path: string, callback: Function) => {
          requested.resolve();
          void metadata.promise.then(() => callback(null, directory));
        },
        readdir: (_path: string, callback: Function) => callback(null, []),
      };
      const to = {
        lstat: (_path: string, callback: Function) => callback({ code: 2 }),
        mkdir: (_path: string, callback: Function) => {
          creates++;
          callback();
        },
      };
      const transfers = new Transfers(
        { sftp: async (id: string) => (id === 'source' ? from : to) } as unknown as SshService,
        (s) => {
          if (s.id === id && s.state !== 'running') done.resolve(s);
        },
        async () => false,
      );
      id = transfers.copyRemote('source', '/data', 'target', '/copied');
      await requested.promise;
      transfers.cancelSession(endpoint);
      metadata.resolve();
      assert.equal((await done.promise).state, 'cancelled');
      assert.equal(creates, 0);
    }
  },
);
test(
  'cancelled upload and download do not create directories after metadata returns',
  { timeout: 5000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'cshell-transfer-cancel-'));
    try {
      const source = join(root, 'source'),
        destination = join(root, 'destination');
      await mkdir(source);
      await mkdir(destination);
      for (const direction of ['upload', 'download'] as const) {
        const requested = deferred(),
          metadata = deferred(),
          done = deferred<Transfer>();
        let creates = 0,
          id = '';
        const remote = {
          lstat: (_path: string, cb: Function) => {
            requested.resolve();
            void metadata.promise.then(() =>
              direction === 'upload' ? cb({ code: 2 }) : cb(null, directory),
            );
          },
          mkdir: (_path: string, cb: Function) => {
            creates++;
            cb();
          },
          readdir: (_path: string, cb: Function) => cb(null, []),
        };
        const transfers = new Transfers(
          { sftp: async () => remote } as unknown as SshService,
          (s) => {
            if (s.id === id && s.state !== 'running') done.resolve(s);
          },
          async () => false,
        );
        id = transfers.enqueue(
          'session',
          direction,
          direction === 'upload' ? source : '/source',
          direction === 'upload' ? '/destination' : destination,
        );
        await requested.promise;
        transfers.cancel(id);
        metadata.resolve();
        assert.equal((await done.promise).state, 'cancelled');
        assert.equal(creates, 0);
        await assert.rejects(access(join(destination, 'source')), { code: 'ENOENT' });
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
