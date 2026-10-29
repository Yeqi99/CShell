import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ConsoleRecovery,
  consoleRecoveryEligible,
  type ConsoleRecoveryState,
} from '../src/agent/system-desktop-recovery';
const ready: ConsoleRecoveryState = {
  sessionId: 2,
  consoleSessionId: 1,
  sourceState: 0,
  protocol: 2,
  sourceUnlocked: true,
  consoleOccupied: false,
  canAttempt: true,
  reason: 'READY_TO_ATTEMPT',
};
function fixture() {
  let calls = 0;
  let state = { ...ready };
  let granted = true;
  let time = 1000;
  let confirmed = true;
  let accepted = true;
  const service = new ConsoleRecovery(
    {
      inspect: async () => ({ ...state }),
      display: async () => ({ displayAvailable: false }),
      execute: async () => {
        calls++;
        return {
          accepted,
          confirmed,
          errorCode: accepted ? 0 : 5,
          sessionId: 2,
          consoleSessionId: confirmed ? 2 : 1,
        };
      },
    },
    () => granted,
    () => time,
  );
  return {
    service,
    get calls() {
      return calls;
    },
    setState: (s: Partial<ConsoleRecoveryState>) => Object.assign(state, s),
    revoke: () => (granted = false),
    expire: () => (time += 121000),
    refuse: () => {
      accepted = false;
      confirmed = false;
    },
  };
}
test('recovery requires an active unlocked RDP owner and vacant different console', () => {
  assert.equal(consoleRecoveryEligible(ready), true);
  for (const change of [
    { sourceUnlocked: false },
    { consoleOccupied: true },
    { sourceState: 4 },
    { protocol: 0 },
    { consoleSessionId: 2 },
    { consoleSessionId: 0xffffffff },
    { reason: 'UNSUPPORTED_WINDOWS' },
  ])
    assert.equal(consoleRecoveryEligible({ ...ready, ...change }), false);
});
test('plan is owner bound, explicitly confirmed and single use', async () => {
  const f = fixture(),
    p = await f.service.plan('alice');
  assert.equal(f.calls, 0);
  await assert.rejects(f.service.execute('bob', { planId: p.id, confirm: true }));
  await assert.rejects(f.service.execute('alice', { planId: p.id }));
  await assert.rejects(f.service.execute('alice', { planId: p.id, confirm: true, sessionId: 99 }));
  assert.equal(f.calls, 0);
  assert.equal((await f.service.execute('alice', { planId: p.id, confirm: true })).confirmed, true);
  await assert.rejects(f.service.execute('alice', { planId: p.id, confirm: true }));
  assert.equal(f.calls, 1);
});
test('expired plans, revoked grants and changed target never invoke WTS', async () => {
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => f.expire(),
    (f: ReturnType<typeof fixture>) => f.revoke(),
    (f: ReturnType<typeof fixture>) => f.setState({ consoleSessionId: 3 }),
    (f: ReturnType<typeof fixture>) => f.setState({ sourceUnlocked: false }),
  ]) {
    const f = fixture(),
      p = await f.service.plan('alice');
    mutate(f);
    await assert.rejects(f.service.execute('alice', { planId: p.id, confirm: true }));
    assert.equal(f.calls, 0);
  }
});
test('OS denial returns unconfirmed, consumes the plan and never retries', async () => {
  const f = fixture(),
    p = await f.service.plan('alice');
  f.refuse();
  const result = await f.service.execute('alice', { planId: p.id, confirm: true });
  assert.equal(result.confirmed, false);
  assert.equal(result.errorCode, 5);
  assert.equal(f.calls, 1);
  await assert.rejects(f.service.execute('alice', { planId: p.id, confirm: true }));
  assert.equal(f.calls, 1);
});
