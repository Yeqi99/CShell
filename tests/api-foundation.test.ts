import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { CapabilityCatalog, type CapabilityDefinition } from '../src/core/api/catalog';
import { ApiError } from '../src/core/api/errors';
import { ApiScheduler } from '../src/core/api/scheduler';
import { ApiTasks } from '../src/core/api/tasks';

test('releasing settled output frees capacity but preserves idempotency and isolation', async () => {
  const tasks = new ApiTasks({
    total: 1,
    perOwner: 1,
    eventBytes: 1024,
    resultBytes: 1024,
    retentionMs: 900000,
  });
  let executed = 0;
  const run = async () => {
    executed++;
    return 'result';
  };
  const first = tasks.start('a', 'target', { action: 1 }, 'once', run);
  assert.throws(
    () => tasks.release('a', first.taskId),
    (e: any) => e.code === 'CONFLICT',
  );
  await tasks.flush();
  assert.throws(
    () => tasks.release('b', first.taskId),
    (e: any) => e.code === 'NOT_FOUND',
  );
  assert.equal(tasks.release('a', first.taskId).released, true);
  assert.equal(tasks.read('a', first.taskId).result, undefined);
  const retry = tasks.start('a', 'target', { action: 1 }, 'once', run);
  assert.equal(retry.taskId, first.taskId);
  assert.equal(retry.released, true);
  tasks.start('a', 'target', { action: 2 }, 'next', run);
  await tasks.flush();
  assert.equal(executed, 2);
});

const definition = (id: string): CapabilityDefinition => ({
  id,
  name: id,
  description: `Read ${id}`,
  input: z.object({ path: z.string() }).strict(),
  output: { type: 'string' },
  permission: 'files.read',
  effects: 'read',
  target: 'connection',
  prerequisites: ['Connected target'],
  cancellation: 'Cooperative',
  retry: 'Safe for reads',
  examples: [{ input: { path: '.' }, explanation: 'Read the current directory' }],
});
test('discovery filters before counting and binds cursors to owner, policy, query and level', () => {
  const catalog = new CapabilityCatalog(['a', 'b', 'secret'].map(definition));
  const visible = (d: { id: string }) => d.id !== 'secret';
  const page = catalog.discover('alice', 'v1', visible, { limit: 1, level: 'names' });
  assert.equal(page.total, 2);
  assert.equal(page.items[0].id, 'a');
  assert.equal(page.items[0].name, 'a');
  assert.match(String(page.items[0].version), /^[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(page).includes('secret'));
  const detail = catalog.discover('alice', 'v1', visible, { capabilityId: 'b', level: 'contract' });
  assert.equal(detail.items.length, 1);
  assert.equal(detail.items[0].id, 'b');
  assert.ok(detail.items[0].inputSchema);
  assert.equal(catalog.discover('alice', 'v1', visible, { capabilityId: 'secret' }).total, 0);
  assert.deepEqual(
    catalog.discover('alice', 'v1', visible, { level: 'names', cursor: page.nextCursor }).items.map((item) => item.id),
    ['b'],
  );
  for (const [owner, revision] of [
    ['bob', 'v1'],
    ['alice', 'v2'],
  ]) {
    assert.throws(
      () => catalog.discover(owner, revision, visible, { level: 'names', cursor: page.nextCursor }),
      (e: unknown) => e instanceof ApiError && e.code === 'CURSOR_EXPIRED',
    );
  }
  assert.throws(() => catalog.discover('alice', 'v1', visible, { cursor: page.nextCursor }));
  assert.throws(() =>
    catalog.discover('alice', 'v1', visible, { level: 'names', cursor: page.nextCursor + 'bad' }),
  );
  assert.throws(() =>
    catalog.discover('alice', 'v1', visible, { level: 'names', cursor: page.nextCursor + '.extra' }),
  );
});
test('capability versions invalidate only changed contracts while revocation removes cached entries', () => {
  const initial = new CapabilityCatalog(['a', 'b', 'secret'].map(definition));
  const visible = (d: { id: string }) => d.id !== 'secret';
  const before = initial.discover('alice', 'policy1', visible, { level: 'names' });
  const updated = new CapabilityCatalog([
    definition('a'), { ...definition('b'), input: z.object({ path: z.string(), limit: z.number().int() }).strict() }, definition('secret'),
  ]);
  const after = updated.discover('alice', 'policy1', visible, { level: 'names' });
  assert.notEqual(before.revision, after.revision);
  assert.equal(before.items[0].version, after.items[0].version);
  assert.notEqual(before.items[1].version, after.items[1].version);
  const contract = updated.discover('alice', 'policy1', visible, { capabilityId: 'b', level: 'contract' });
  assert.equal(after.items[1].version, contract.items[0].version);
  const revoked = updated.discover('alice', 'policy2', (d) => d.id === 'a', { level: 'names' });
  assert.deepEqual(revoked.items.map((item) => item.id), ['a']);
  assert.notEqual(revoked.revision, after.revision);
  assert.ok(!JSON.stringify(revoked).includes('secret'));
  assert.equal(revoked.items[0].version, after.items[0].version);
});
test('response budget includes envelope and never truncates a schema', () => {
  const catalog = new CapabilityCatalog([
    { ...definition('a'), description: 'x'.repeat(1500) },
    definition('b'),
  ]);
  assert.throws(
    () => catalog.discover('a', '1', () => true, { level: 'contract', budgetBytes: 512 }),
    (e: unknown) => e instanceof ApiError && e.code === 'BUDGET_TOO_SMALL',
  );
  const page = catalog.discover('a', '1', () => true, { level: 'guide', budgetBytes: 2600 });
  assert.ok(Buffer.byteLength(JSON.stringify(page)) <= 2600);
  assert.deepEqual(
    page.items[0].inputSchema,
    z.toJSONSchema(definition('a').input, { io: 'input' }),
  );
  assert.ok(page.items[0].examples);
});
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { resolve, promise };
};
test('queue timeout removes waiting mutations without releasing an active conflict lock', async () => {
  const scheduler = new ApiScheduler(
    { total: 2, perOwner: 2, perTarget: 2, queued: 4, queuedPerOwner: 4 },
    25,
  );
  const gate = deferred(),
    entered = deferred();
  const signal = new AbortController().signal;
  const running = scheduler.run('a', 'host', 'file', signal, async () => {
    entered.resolve();
    await gate.promise;
  });
  await entered.promise;
  try {
    const waiting = scheduler.run('b', 'host', 'file', signal, async () => {
      assert.fail('Expired mutation executed');
    });
    await assert.rejects(
      waiting,
      (error: unknown) => error instanceof ApiError && error.code === 'DEADLINE_EXCEEDED',
    );
    assert.deepEqual(scheduler.snapshot(), { active: 1, queued: 0 });
    await scheduler.run('c', 'other', 'file', signal, async () => {});
    // A second waiter still cannot enter the active resource after the first expires.
    await assert.rejects(
      scheduler.run('b', 'host', 'file', signal, async () => {
        assert.fail('Active lock was released by a timeout');
      }),
      (error: unknown) => error instanceof ApiError && error.code === 'DEADLINE_EXCEEDED',
    );
  } finally {
    gate.resolve();
    await running;
  }
  await scheduler.run('b', 'host', 'file', signal, async () => {});
  assert.deepEqual(scheduler.snapshot(), { active: 0, queued: 0 });
});
test('scheduler serializes conflicting writes while independent targets progress', async () => {
  const scheduler = new ApiScheduler({
    total: 3,
    perOwner: 3,
    perTarget: 3,
    queued: 8,
    queuedPerOwner: 8,
  });
  const gate = deferred(),
    entered = deferred(),
    signal = new AbortController().signal;
  const order: string[] = [];
  const first = scheduler.run('a', 'host1', 'file', signal, async () => {
    order.push('first');
    entered.resolve();
    await gate.promise;
  });
  await entered.promise;
  const second = scheduler.run('b', 'host1', 'file', signal, async () => {
    order.push('second');
  });
  await scheduler.run('b', 'host2', 'file', signal, async () => {
    order.push('other');
  });
  assert.deepEqual(order, ['first', 'other']);
  gate.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(order, ['first', 'other', 'second']);
  assert.deepEqual(scheduler.snapshot(), { active: 0, queued: 0 });
});
test('queued cancellation never executes, saturation is bounded and other owners get a turn', async () => {
  const scheduler = new ApiScheduler({
    total: 1,
    perOwner: 1,
    perTarget: 1,
    queued: 3,
    queuedPerOwner: 2,
  });
  const gate = deferred(),
    entered = deferred(),
    signal = new AbortController().signal;
  const first = scheduler.run('a', 'x', undefined, signal, async () => {
    entered.resolve();
    await gate.promise;
  });
  await entered.promise;
  const cancelled = new AbortController();
  const pending = scheduler.run('a', 'x', undefined, cancelled.signal, async () => {
    assert.fail('Cancelled operation executed');
  });
  const rejection = assert.rejects(pending);
  const order: string[] = [];
  const a = scheduler.run('a', 'x', undefined, signal, async () => {
    order.push('a');
  });
  await assert.rejects(
    scheduler.run('a', 'x', undefined, signal, async () => {}),
    (e: unknown) => e instanceof ApiError && e.code === 'OVERLOADED',
  );
  const b = scheduler.run('b', 'x', undefined, signal, async () => {
    order.push('b');
  });
  cancelled.abort();
  await rejection;
  gate.resolve();
  await Promise.all([first, a, b]);
  assert.deepEqual(order, ['b', 'a']);
  assert.deepEqual(scheduler.snapshot(), { active: 0, queued: 0 });
});
test('scheduler rotates all pending owners instead of alternating only the first two', async () => {
  const scheduler = new ApiScheduler({
    total: 1,
    perOwner: 1,
    perTarget: 1,
    queued: 20,
    queuedPerOwner: 10,
  });
  const gate = deferred();
  const signal = new AbortController().signal;
  const first = scheduler.run('seed', 'host', undefined, signal, () => gate.promise);
  const order: string[] = [];
  const work = ['a1', 'a2', 'a3', 'b1', 'b2', 'b3', 'c1', 'c2', 'c3'].map((name) =>
    scheduler.run(name[0], 'host', undefined, signal, async () => {
      order.push(name);
    }),
  );
  gate.resolve();
  await Promise.all([first, ...work]);
  assert.deepEqual(order, ['a1', 'b1', 'c1', 'a2', 'b2', 'c2', 'a3', 'b3', 'c3']);
  assert.deepEqual(scheduler.snapshot(), { active: 0, queued: 0 });
});

test('task idempotency is scoped, canonical and never repeats a mutation', async () => {
  const tasks = new ApiTasks();
  let count = 0;
  const fn = async () => {
    count++;
    return { done: true };
  };
  const first = tasks.start('a', 'host', { a: 1, b: 2 }, 'key', fn);
  assert.equal(tasks.start('a', 'host', { b: 2, a: 1 }, 'key', fn).taskId, first.taskId);
  assert.throws(
    () => tasks.start('a', 'host', { a: 2 }, 'key', fn),
    (e: unknown) => e instanceof ApiError && e.code === 'CONFLICT',
  );
  assert.throws(() => tasks.read('b', first.taskId));
  const other = tasks.start('b', 'host', { a: 1, b: 2 }, 'key', fn);
  assert.notEqual(other.taskId, first.taskId);
  await tasks.flush();
  assert.equal(count, 2);
  assert.equal(tasks.read('a', first.taskId).state, 'succeeded');
});
test('cancelled running task reports unknown outcome; output eviction has an explicit gap', async () => {
  const tasks = new ApiTasks({
    total: 4,
    perOwner: 2,
    eventBytes: 512,
    resultBytes: 1024,
    retentionMs: 900000,
  });
  const gate = deferred(),
    started = deferred();
  const task = tasks.start('a', 'host', {}, undefined, async (_signal, output) => {
    for (let i = 0; i < 100; i++) output('x'.repeat(100));
    started.resolve();
    await gate.promise;
    return { done: true };
  });
  await started.promise;
  assert.equal(tasks.read('a', task.taskId).gap, true);
  assert.equal(tasks.cancel('a', task.taskId).state, 'cancel_requested');
  assert.equal(tasks.read('a', task.taskId).settled, false);
  gate.resolve();
  await tasks.flush();
  assert.equal(tasks.read('a', task.taskId).state, 'unknown');
  assert.equal(tasks.read('a', task.taskId).settled, true);
});
test('cancel before dispatch does not run and task storage is bounded', async () => {
  const tasks = new ApiTasks({
    total: 1,
    perOwner: 1,
    eventBytes: 512,
    resultBytes: 1024,
    retentionMs: 900000,
  });
  const task = tasks.start('a', 'host', {}, undefined, async () => assert.fail('Must not execute'));
  tasks.cancel('a', task.taskId);
  await tasks.flush();
  assert.equal(tasks.read('a', task.taskId).state, 'cancelled');
  assert.throws(
    () => tasks.start('b', 'host', {}, undefined, async () => {}),
    (e: unknown) => e instanceof ApiError && e.code === 'OVERLOADED',
  );
});

test('lost remote outcome is distinct from a known failure and cannot replay via idempotency', async () => {
  const tasks = new ApiTasks();
  let executions = 0;
  const invoke = async () => {
    executions++;
    throw new ApiError('OUTCOME_UNKNOWN', 'Lost exit status', 'Inspect the target.');
  };
  const first = tasks.start('owner', 'host', {}, 'lost', invoke);
  await tasks.flush();
  assert.equal(tasks.read('owner', first.taskId).state, 'unknown');
  assert.equal(tasks.start('owner', 'host', {}, 'lost', invoke).taskId, first.taskId);
  assert.equal(executions, 1);
});

test('large output retains a bounded tail, exposes gaps and ignores output after settlement', async () => {
  const tasks = new ApiTasks({
    total: 4,
    perOwner: 4,
    eventBytes: 8192,
    resultBytes: 1024,
    retentionMs: 900000,
  });
  let lateOutput!: (text: string) => void;
  const result = { value: 'original' };
  const task = tasks.start('owner', 'host', {}, undefined, async (_signal, output) => {
    lateOutput = output;
    output('old prefix');
    output('x'.repeat(8 * 1024 * 1024) + 'TAIL');
    return result;
  });
  await tasks.flush();
  const before = tasks.read('owner', task.taskId);
  assert.equal(before.gap, true);
  assert.ok(Buffer.byteLength(JSON.stringify(before.events)) < 8300);
  assert.ok(
    before.events
      .filter((e) => e.type === 'output')
      .map((e) => e.data)
      .join('')
      .endsWith('TAIL'),
  );
  assert.equal(before.latestCursor, 4101);
  result.value = 'changed';
  lateOutput('LATE');
  assert.deepEqual(tasks.read('owner', task.taskId), before);
  (before.result as { value: string }).value = 'reader mutation';
  assert.equal((tasks.read('owner', task.taskId).result as { value: string }).value, 'original');
});

test('an unserializable result cannot turn a completed side effect into a safely retryable failure', async () => {
  const tasks = new ApiTasks();
  const result: { self?: unknown } = {};
  result.self = result;
  let count = 0;
  const execute = async () => {
    count++;
    return result;
  };
  const task = tasks.start('owner', 'host', {}, 'once', execute);
  await tasks.flush();
  assert.equal(tasks.read('owner', task.taskId).state, 'unknown');
  assert.equal(tasks.read('owner', task.taskId).error?.code, 'OUTCOME_UNKNOWN');
  assert.equal(tasks.start('owner', 'host', {}, 'once', execute).taskId, task.taskId);
  assert.equal(count, 1);
});

test('expired completed records cannot interrupt revocation of live tasks', async (context) => {
  let now = 1000;
  context.mock.method(Date, 'now', () => now);
  const tasks = new ApiTasks({
    total: 8,
    perOwner: 4,
    eventBytes: 1024,
    resultBytes: 1024,
    retentionMs: 10,
  });
  const expired = tasks.start('a', 'host', {}, undefined, async () => 'done');
  await tasks.flush();
  const gate = deferred();
  let signalA!: AbortSignal, signalB!: AbortSignal;
  const activeA = tasks.start('a', 'host', {}, undefined, async (signal) => {
    signalA = signal;
    await gate.promise;
    return 'a';
  });
  const activeB = tasks.start('b', 'host', {}, undefined, async (signal) => {
    signalB = signal;
    await gate.promise;
    return 'b';
  });
  await Promise.resolve();
  now += 20;
  assert.doesNotThrow(() => tasks.revoke('a'));
  assert.equal(signalA.aborted, true);
  assert.equal(signalB.aborted, false);
  assert.throws(() => tasks.read('a', expired.taskId));
  assert.equal(tasks.read('a', activeA.taskId).state, 'cancel_requested');
  assert.equal(tasks.read('b', activeB.taskId).state, 'running');
  assert.doesNotThrow(() => tasks.revoke());
  assert.equal(signalB.aborted, true);
  gate.resolve();
  await tasks.flush();
});
