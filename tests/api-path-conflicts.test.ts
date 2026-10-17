import { test } from 'node:test';
import assert from 'node:assert/strict';
import { remoteFileConflict } from '../src/core/paths';
import { ApiScheduler } from '../src/core/api/scheduler';

test('file lock aliases preserve remote symlink-sensitive parent traversal', () => {
  assert.equal(remoteFileConflict('./dir//./file.py'), remoteFileConflict('dir/file.py'));
  assert.equal(remoteFileConflict('/dir//./file.py'), remoteFileConflict('/dir/file.py'));
  assert.notEqual(remoteFileConflict('link/../file.py'), remoteFileConflict('file.py'));
  assert.notEqual(remoteFileConflict('/file.py'), remoteFileConflict('file.py'));
  assert.throws(() => remoteFileConflict('bad\0path'));
});

test('alias writes wait across callers while unrelated files and targets proceed', async () => {
  const scheduler = new ApiScheduler();
  const signal = new AbortController().signal;
  const order: string[] = [];
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const first = scheduler.run('one', 'host', remoteFileConflict('./dir/file'), signal, async () => {
    order.push('first');
    await held;
    order.push('released');
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  const second = scheduler.run('two', 'host', remoteFileConflict('dir//./file'), signal, async () => {
    order.push('second');
  });
  try {
    await Promise.all([
      scheduler.run('two', 'host', remoteFileConflict('dir/other'), signal, async () => { order.push('other-file'); }),
      scheduler.run('two', 'other-host', remoteFileConflict('dir/file'), signal, async () => { order.push('other-host'); }),
    ]);
    assert.deepEqual(order, ['first', 'other-file', 'other-host']);
  } finally {
    release();
    await Promise.all([first, second]);
  }
  assert.deepEqual(order.slice(-2), ['released', 'second']);
  assert.deepEqual(scheduler.snapshot(), { active: 0, queued: 0 });
});
