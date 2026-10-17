import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SFTPWrapper, Stats } from 'ssh2';
import { readSftpChunk } from '../src/core/api/sftp-read';
import { DirectoryPages } from '../src/core/api/directory-page';
import { createSftpFile } from '../src/core/api/sftp-create';
import { writeSftpChunk } from '../src/core/api/sftp-write';
import { createHash } from 'node:crypto';

test('conditional writes reject stale revisions before mutation and report partial writes honestly', async () => {
  const abort = new AbortController();
  let writes = 0,
    closes = 0;
  const attrs = { size: 3, mtime: 1, mode: 33152, uid: 1, gid: 1, isFile: () => true };
  const revision = createHash('sha256')
    .update(JSON.stringify(['file', 3, 1, 33152, 1, 1]))
    .digest('hex');
  const sftp = {
    open: (_p: string, flags: string, cb: Function) => {
      assert.equal(flags, 'r+');
      cb(null, Buffer.from('h'));
    },
    fstat: (_h: Buffer, cb: Function) => cb(null, attrs),
    write: (_h: Buffer, _b: Buffer, _o: number, _l: number, _p: number, cb: Function) => {
      writes++;
      abort.abort();
      cb();
    },
    close: (_h: Buffer, cb: Function) => {
      closes++;
      cb();
    },
  } as unknown as SFTPWrapper;
  const input = {
    path: 'file',
    bodyBase64: 'eA==',
    offset: 0,
    revision: '0'.repeat(64),
    acceptNonAtomic: true,
  };
  await assert.rejects(
    writeSftpChunk(sftp, input, abort.signal),
    (e: any) => e.code === 'CONFLICT',
  );
  assert.equal(writes, 0);
  await assert.rejects(
    writeSftpChunk(sftp, { ...input, revision }, abort.signal),
    (e: any) => e.code === 'OUTCOME_UNKNOWN',
  );
  assert.equal(writes, 1);
  assert.equal(closes, 2);
});

test('exclusive creation cancellation reports unknown outcome and never deletes the target', async () => {
  const abort = new AbortController();
  let closed = 0,
    written = 0;
  const sftp = {
    open: (_path: string, flags: string, mode: number, done: Function) => {
      assert.equal(flags, 'wx');
      assert.equal(mode, 0o600);
      done(undefined, Buffer.from('file'));
    },
    write: (
      _handle: Buffer,
      _bytes: Buffer,
      _offset: number,
      length: number,
      _position: number,
      done: Function,
    ) => {
      written += length;
      abort.abort();
      done();
    },
    close: (_handle: Buffer, done: Function) => {
      closed++;
      done();
    },
    unlink: () => assert.fail('No implicit deletion'),
    end: () => assert.fail('No shared channel shutdown'),
  } as unknown as SFTPWrapper;
  await assert.rejects(
    createSftpFile(
      sftp,
      { path: 'new', bodyBase64: Buffer.alloc(32768).toString('base64') },
      abort.signal,
    ),
    (e: unknown) => (e as { code: string }).code === 'OUTCOME_UNKNOWN',
  );
  assert.equal(written, 16384);
  assert.equal(closed, 1);
});

test('invalid or oversized file content is rejected before opening a target', async () => {
  const sftp = {
    open: () => assert.fail('Must validate before opening'),
  } as unknown as SFTPWrapper;
  for (const bodyBase64 of ['%%%invalid', Buffer.alloc(32769).toString('base64')])
    await assert.rejects(
      createSftpFile(sftp, { path: 'new', bodyBase64 }, new AbortController().signal),
    );
});

test('directory pagination bounds JSON bytes and binds cursors to listing, path, connection and expiry', (context) => {
  let now = 1000;
  context.mock.method(Date, 'now', () => now);
  const pages = new DirectoryPages();
  const listing = {
    path: '/data',
    entries: Array.from({ length: 100 }, (_, i) => ({
      name: `${i}-${'😀'.repeat(400)}`,
      path: `/data/${i}`,
      directory: false,
      symlink: false,
      size: i,
      modified: 1,
    })),
  };
  const first = pages.page(listing, { path: '/data', limit: 100 });
  assert.ok(first.nextCursor);
  assert.ok(first.entries.length < 100);
  assert.ok(Buffer.byteLength(JSON.stringify(first)) <= 65536);
  const args = { path: '/data', cursor: first.nextCursor };
  const second = pages.page(listing, args);
  assert.equal(second.entries[0].size, first.entries.length);
  const expired = (e: unknown) => (e as { code: string }).code === 'CURSOR_EXPIRED';
  assert.throws(() => new DirectoryPages().page(listing, args), expired);
  assert.throws(() => pages.page(listing, { ...args, path: '/other' }), expired);
  assert.throws(() => pages.page({ ...listing, entries: listing.entries.slice(1) }, args), expired);
  now += 300001;
  assert.throws(() => pages.page(listing, args), expired);
});

test('file chunk cancellation releases its own handle without closing the shared channel', async () => {
  const abort = new AbortController();
  let closed = 0;
  const handle = Buffer.from('owned');
  const sftp = {
    open: (_path: string, _flags: string, done: Function) => done(undefined, handle),
    fstat: (_handle: Buffer, done: Function) => {
      abort.abort(new Error('Cancelled'));
      done(undefined, { size: 10, isFile: () => true });
    },
    close: (value: Buffer, done: Function) => {
      assert.equal(value, handle);
      closed++;
      done();
    },
    end: () => assert.fail('Must not close shared SFTP'),
  } as unknown as SFTPWrapper;
  await assert.rejects(readSftpChunk(sftp, { path: 'file' }, abort.signal), /Cancelled/);
  assert.equal(closed, 1);
});

test('file chunks handle short reads and detect mutation before returning bytes', async () => {
  let closed = 0,
    calls = 0,
    stats = 0;
  const bytes = Buffer.from([0, 255, 1, 2, 3, 4, 5]);
  const sftp = {
    open: (_path: string, _flags: string, done: Function) => done(undefined, Buffer.from('file')),
    fstat: (_handle: Buffer, done: Function) =>
      done(undefined, {
        size: bytes.length,
        mtime: ++stats === 1 ? 1 : 2,
        mode: 0o100644,
        uid: 0,
        gid: 0,
        isFile: () => true,
      } as Stats),
    read: (
      _handle: Buffer,
      target: Buffer,
      offset: number,
      length: number,
      position: number,
      done: Function,
    ) => {
      calls++;
      const count = Math.min(2, length);
      bytes.copy(target, offset, position, position + count);
      done(undefined, count);
    },
    close: (_handle: Buffer, done: Function) => {
      closed++;
      done();
    },
  } as unknown as SFTPWrapper;
  await assert.rejects(
    readSftpChunk(sftp, { path: 'file' }, new AbortController().signal),
    (e: unknown) => (e as { code: string }).code === 'CONFLICT',
  );
  assert.equal(calls, 4);
  assert.equal(closed, 1);
});
