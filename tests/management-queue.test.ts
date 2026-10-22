import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ManagementQueue } from '../src/core/client/management-queue';
test('management requests are bounded per machine and cancelled queued work never executes', async () => {
  const queue = new ManagementQueue(),
    signal = new AbortController().signal;
  let active = 0,
    maximum = 0;
  await Promise.all(
    Array.from({ length: 20 }, () =>
      queue.run('a', signal, async () => {
        active++;
        maximum = Math.max(maximum, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
      }),
    ),
  );
  assert.equal(maximum, 2);
  let release!: () => void;
  const blocked = new Promise<void>((r) => (release = r));
  const running = [queue.run('a', signal, () => blocked), queue.run('a', signal, () => blocked)];
  const abort = new AbortController();
  let executed = false;
  const cancelled = queue.run('a', abort.signal, async () => {
    executed = true;
  });
  abort.abort();
  await assert.rejects(cancelled);
  assert.equal(await queue.run('b', signal, async () => 42), 42);
  release();
  await Promise.all(running);
  assert.equal(executed, false);
  assert.equal(await queue.run('a', signal, async () => 7), 7);
});
