import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TerminalLog } from '../src/core/api/terminal-log';

test('terminal byte cursors reconstruct Unicode and ANSI output across page boundaries', () => {
  const log = new TerminalLog();
  const text = '\x1b[32m提示符🙂\x1b[0m> \r\n';
  log.append(text);
  const parts: Buffer[] = [];
  let cursor = 0;
  do {
    const page = log.read(cursor, 1);
    assert.equal(page.gap, false);
    parts.push(Buffer.from(page.data, 'base64'));
    cursor = page.nextCursor;
  } while (cursor < Buffer.byteLength(text));
  assert.equal(Buffer.concat(parts).toString('utf8'), text);
  assert.equal(log.read(cursor).data, '');
  assert.throws(() => log.read(cursor + 1));
  assert.throws(() => log.read(-1));
  assert.throws(() => log.read(0, 65537));
});

test('terminal ring retains exactly the bounded tail through wraps and oversized writes', () => {
  for (const capacity of [1, 2, 3, 7, 32, 255]) {
    const log = new TerminalLog(capacity);
    let reference = Buffer.alloc(0);
    for (const text of ['a', '你好🙂', '', 'x'.repeat(700), '终端\r\n', '🙂'.repeat(900)]) {
      log.append(text);
      reference = Buffer.concat([reference, Buffer.from(text)]);
      const page = log.read(0);
      const start = Math.max(0, reference.length - capacity);
      assert.deepEqual(Buffer.from(page.data, 'base64'), reference.subarray(start));
      assert.equal(page.latestCursor, reference.length);
      assert.equal(page.lostBytes, start);
      assert.equal(page.gap, start > 0);
      assert.ok(page.retainedBytes <= capacity);
      const tail = log.read(page.nextCursor);
      assert.equal(tail.data, '');
      assert.equal(tail.gap, false);
    }
  }
});

test('slow terminal readers report eviction without consuming another reader’s cursor', () => {
  const log = new TerminalLog(32);
  log.append('a'.repeat(20));
  const fast = log.read(0, 20);
  log.append('b'.repeat(20));
  const slow = log.read(0, 10);
  assert.equal(slow.gap, true);
  assert.equal(slow.lostBytes, 8);
  assert.equal(log.read(fast.nextCursor).gap, false);
  assert.deepEqual(log.read(0, 10), slow);
  log.append('z'.repeat(8 * 1024 * 1024));
  const page = log.read(fast.nextCursor);
  assert.equal(page.retainedBytes, 32);
  assert.equal(Buffer.from(page.data, 'base64').toString(), 'z'.repeat(32));
});
