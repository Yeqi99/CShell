import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiScheduler } from '../src/core/api/scheduler';

test('multi-resource reservations are all-or-none, release on failure and do not deadlock in reverse order', async () => {
  const scheduler = new ApiScheduler();
  const signal = new AbortController().signal;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const active = scheduler.run('one', 'host', 'a', signal, () => gate);
  await new Promise<void>((resolve) => setImmediate(resolve));
  const events: string[] = [];
  const pair = scheduler.run('two', 'host', ['a', 'b', 'a'], signal, async () => {
    events.push('pair');
    throw new Error('expected failure');
  });
  const failed = assert.rejects(pair, /expected failure/);
  const reverse = scheduler.run('three', 'host', ['b', 'a'], signal, async () => {
    events.push('reverse');
  });
  try {
    await scheduler.run('four', 'host', 'b', signal, async () => {
      events.push('independent');
    });
    assert.deepEqual(events, ['independent']);
  } finally {
    release();
  }
  await Promise.all([active, failed, reverse]);
  assert.deepEqual(events, ['independent', 'pair', 'reverse']);
  assert.deepEqual(scheduler.snapshot(), { active: 0, queued: 0 });
});

test('cancelling a queued multi-resource operation reserves no domain', async () => {
  const scheduler = new ApiScheduler();
  let release!: () => void;
  const active = scheduler.run(
    'one',
    'host',
    ['a', 'b'],
    new AbortController().signal,
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  const cancel = new AbortController();
  const pending = scheduler.run('two', 'host', ['b', 'c'], cancel.signal, async () => {
    assert.fail('cancelled operation ran');
  });
  const rejected = assert.rejects(pending);
  cancel.abort();
  await rejected;
  await scheduler.run('three', 'host', 'c', new AbortController().signal, async () => {});
  release();
  await active;
  assert.deepEqual(scheduler.snapshot(), { active: 0, queued: 0 });
});
