import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiScheduler, conflictKeysOverlap } from '../src/core/api/scheduler';

test('tree domains cover descendants without serializing sibling paths or other targets', async () => {
  const key = (target: string, path: string) => JSON.stringify([target, path]);
  assert.ok(conflictKeysOverlap(key('a', 'tree:/work'), key('a', 'file:/work/a')));
  assert.ok(conflictKeysOverlap(key('a', 'tree:/work/sub'), key('a', 'tree:/work')));
  assert.ok(!conflictKeysOverlap(key('a', 'tree:/work'), key('a', 'file:/worker/a')));
  assert.ok(!conflictKeysOverlap(key('a', 'tree:/work'), key('b', 'file:/work/a')));
  const scheduler = new ApiScheduler();
  const signal = new AbortController().signal;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tree = scheduler.run('one', 'a', 'tree:/work', signal, () => gate);
  await new Promise<void>((resolve) => setImmediate(resolve));
  let childRan = false;
  const child = scheduler.run('two', 'a', 'file:/work/sub/file', signal, async () => {
    childRan = true;
  });
  try {
    await scheduler.run('three', 'a', 'file:/elsewhere/file', signal, async () => {});
    assert.equal(childRan, false);
  } finally {
    release();
  }
  await Promise.all([tree, child]);
  assert.equal(childRan, true);
});
