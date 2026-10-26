import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classroomDiscoveryLifecycle } from '../src/core/classroom-discovery-lifecycle';

test('failed network start retries after bounded delay and does not reset successful UI choices', async () => {
  let time = 0, attempts = 0, healthy = false;
  const transitions: boolean[] = [];
  const tick = classroomDiscoveryLifecycle({ enabled: () => true, healthy: () => healthy, now: () => time,
    enable: async transition => { attempts++;transitions.push(transition);if (attempts === 1) throw Error('offline');healthy = true; }, disable: async () => {} });
  await tick();await tick();assert.equal(attempts, 1);
  time = 5000;await tick();await tick();assert.equal(attempts, 2);
  healthy = false;await tick();assert.equal(attempts, 2);time = 10000;await tick();assert.deepEqual(transitions, [true, true, false]);
});

test('disable cleans partially started services even when startup failed', async () => {
  let enabled = true, stopped = 0;
  const tick = classroomDiscoveryLifecycle({ enabled: () => enabled, healthy: () => false,
    enable: async () => { throw Error('second service failed'); }, disable: async () => { stopped++; } });
  await tick();enabled = false;await tick();await tick();assert.equal(stopped, 1);
});

test('pending network startup is single-flight and revoked when extension switches off', async () => {
  let enabled = true, stopped = 0, started = 0, release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const tick = classroomDiscoveryLifecycle({ enabled: () => enabled, healthy: () => true,
    enable: async () => { started++;await pending; }, disable: async () => { stopped++; } });
  const first = tick();await tick();enabled = false;release();await first;await tick();
  assert.equal(started, 1);assert.equal(stopped, 1);
});
